import type { GitPanelData } from "@shared/api-types";
import type { FileExplorerTarget, FileTreeEntry } from "@shared/file-explorer-types";
import { ChevronDown, ChevronRight, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { FileIcon, FolderIcon } from "./file-icons";
import { fileExtensionOf } from "./file-tabs";
import { buildGitOverlay, gitRowClass, type FileTreeGitOverlay } from "./file-tree-git";
import { FileTreeContextMenu, type FileTreeCopyKind } from "./FileTreeContextMenu";

export interface FileExplorerProps {
  /** True while another right-sidebar tab is active or the sidebar is collapsed to its rail. */
  hidden: boolean;
  target: FileExplorerTarget | null;
  targetLabel: string | null;
  selectedRelativePath: string | null;
  /** Greys out "VS Code로 열기" when no editor was found, exactly as the folder menu does. */
  vscodeAvailable: boolean;
  onOpenFile(entry: FileTreeEntry): void;
  /** A folder reports its own path; every open tab at or below it belongs to the deleted subtree. */
  onEntryDeleted(relativePath: string, kind: FileTreeEntry["kind"]): void;
  onEntryRenamed(relativePath: string, nextRelativePath: string, kind: FileTreeEntry["kind"]): void;
}

type DirectoryState = FileTreeEntry[] | "loading" | "error";

/** The one inline field the tree shows at a time — a new entry being named, or an old one renamed. */
type EditingState =
  | { mode: "create"; parentRelativePath: string; kind: FileTreeEntry["kind"] }
  | { mode: "rename"; entry: FileTreeEntry };

interface MenuState {
  /** Null for a right-click on empty space, which targets the root folder. */
  entry: FileTreeEntry | null;
  x: number;
  y: number;
}

interface DeleteRequest {
  entry: FileTreeEntry;
  /** How many entries a folder holds, once the listing answers; null while it is unknown. */
  childCount: number | null;
  busy: boolean;
}

function targetKey(target: FileExplorerTarget | null): string {
  return target ? `${target.kind}:${target.id}` : "";
}

function parentRelativePathOf(relativePath: string): string {
  const cut = relativePath.lastIndexOf("/");
  return cut < 0 ? "" : relativePath.slice(0, cut);
}

/** True for the entry itself and, when it is a folder, for everything below it. */
function isAtOrBelow(relativePath: string, root: string): boolean {
  return relativePath === root || relativePath.startsWith(`${root}/`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Pixels one level of nesting adds. Rows read it as padding, the guide line as its x position. */
const INDENT_STEP = 14;

/**
 * The inline field used for both renaming and creating. It wears the row's own class so the caret
 * lines up with the names above and below it, and it cancels on blur like every other inline rename
 * in the app — a half-typed name is never worth a file on disk.
 */
function FileTreeNameInput({
  kind,
  initialName,
  onSubmit,
  onCancel,
}: {
  kind: FileTreeEntry["kind"];
  initialName: string;
  onSubmit(name: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initialName);
  const label = kind === "directory" ? "폴더 이름" : "파일 이름";
  // Renaming `report.md` puts the caret over `report`: the extension is rarely what changes.
  const stemEnd = initialName.lastIndexOf(".") > 0 ? initialName.lastIndexOf(".") : initialName.length;
  return (
    <form
      className="file-tree-row file-tree-edit"
      onSubmit={(event) => {
        event.preventDefault();
        const name = value.trim();
        if (name) onSubmit(name);
        else onCancel();
      }}
    >
      <span className="file-tree-toggle" aria-hidden="true" />
      {kind === "directory" ? (
        <FolderIcon name={value} open={false} size={16} />
      ) : (
        <FileIcon name={value} extension={fileExtensionOf(value)} size={16} />
      )}
      <input
        type="text"
        aria-label={label}
        value={value}
        autoFocus
        onFocus={(event) => event.currentTarget.setSelectionRange(0, stemEnd)}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        onBlur={onCancel}
      />
    </form>
  );
}

function DirectoryChildren({
  state,
  depth,
  dirPath,
  ...rest
}: {
  state: DirectoryState | undefined;
  depth: number;
  /** The folder this listing belongs to; "" for the root group. */
  dirPath: string;
} & TreeNodeSharedProps) {
  // The rows read their padding off this variable; a state row is not inside the group's own <ul>,
  // so it carries the same value inline.
  const indent = { paddingLeft: `${depth * INDENT_STEP + 8}px` } as CSSProperties;
  const editing = rest.editing;
  const creating = editing?.mode === "create" && editing.parentRelativePath === dirPath ? editing : null;
  if (state === "loading") {
    return (
      <div className="file-tree-state" style={indent}>
        <RefreshCw className="spin" size={12} />
        <span>불러오는 중</span>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="file-tree-state file-tree-error" style={indent}>
        <TriangleAlert size={12} />
        <span>불러오지 못했습니다</span>
      </div>
    );
  }
  if (!state && !creating) return null;
  const entries = state === undefined ? [] : state;
  if (entries.length === 0 && !creating) {
    return (
      <div className="file-tree-state" style={indent}>
        <span>비어 있음</span>
      </div>
    );
  }
  return (
    <ul
      role="group"
      data-depth={depth}
      style={{ "--file-tree-indent": `${depth * INDENT_STEP + 8}px` } as CSSProperties}
    >
      {creating ? (
        <li>
          <FileTreeNameInput
            kind={creating.kind}
            initialName=""
            onSubmit={rest.onSubmitEdit}
            onCancel={rest.onCancelEdit}
          />
        </li>
      ) : null}
      {entries.map((entry) => (
        <TreeNode key={entry.relativePath} entry={entry} depth={depth} {...rest} />
      ))}
    </ul>
  );
}

interface TreeNodeSharedProps {
  expandedDirs: Set<string>;
  childrenByDir: Record<string, DirectoryState>;
  selectedRelativePath: string | null;
  git: FileTreeGitOverlay;
  editing: EditingState | null;
  menuTargetPath: string | null;
  onToggleDir(relativePath: string): void;
  onOpenFile(entry: FileTreeEntry): void;
  onOpenMenu(event: ReactMouseEvent, entry: FileTreeEntry): void;
  onSubmitEdit(name: string): void;
  onCancelEdit(): void;
}

function TreeNode({
  entry,
  depth,
  expandedDirs,
  childrenByDir,
  selectedRelativePath,
  git,
  editing,
  menuTargetPath,
  onToggleDir,
  onOpenFile,
  onOpenMenu,
  onSubmitEdit,
  onCancelEdit,
}: TreeNodeSharedProps & { entry: FileTreeEntry; depth: number }) {
  const isDirectory = entry.kind === "directory";
  const expanded = isDirectory && expandedDirs.has(entry.relativePath);
  const selected = !isDirectory && selectedRelativePath === entry.relativePath;
  const renaming = editing?.mode === "rename" && editing.entry.relativePath === entry.relativePath;
  const rowClass = [
    "file-tree-row",
    selected ? "selected" : "",
    menuTargetPath === entry.relativePath ? "menu-target" : "",
    gitRowClass(git, entry.relativePath, entry.kind) ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li>
      {renaming ? (
        <FileTreeNameInput kind={entry.kind} initialName={entry.name} onSubmit={onSubmitEdit} onCancel={onCancelEdit} />
      ) : (
        <button
          type="button"
          className={rowClass}
          onClick={() => (isDirectory ? onToggleDir(entry.relativePath) : onOpenFile(entry))}
          onContextMenu={(event) => onOpenMenu(event, entry)}
          title={entry.name}
        >
          {isDirectory ? (
            <span className="file-tree-toggle" aria-hidden="true">
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
          ) : (
            <span className="file-tree-toggle" aria-hidden="true" />
          )}
          {isDirectory ? (
            <FolderIcon name={entry.name} open={expanded} size={16} />
          ) : (
            <FileIcon name={entry.name} extension={entry.extension} size={16} />
          )}
          <span className="file-tree-name">{entry.name}</span>
        </button>
      )}
      {isDirectory && expanded ? (
        <DirectoryChildren
          state={childrenByDir[entry.relativePath]}
          depth={depth + 1}
          dirPath={entry.relativePath}
          expandedDirs={expandedDirs}
          childrenByDir={childrenByDir}
          selectedRelativePath={selectedRelativePath}
          git={git}
          editing={editing}
          menuTargetPath={menuTargetPath}
          onToggleDir={onToggleDir}
          onOpenFile={onOpenFile}
          onOpenMenu={onOpenMenu}
          onSubmitEdit={onSubmitEdit}
          onCancelEdit={onCancelEdit}
        />
      ) : null}
    </li>
  );
}

export function FileExplorer({
  hidden,
  target,
  targetLabel,
  selectedRelativePath,
  vscodeAvailable,
  onOpenFile,
  onEntryDeleted,
  onEntryRenamed,
}: FileExplorerProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [childrenByDir, setChildrenByDir] = useState<Record<string, DirectoryState>>({});
  const [gitData, setGitData] = useState<GitPanelData | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const git = useMemo(() => buildGitOverlay(gitData), [gitData]);

  const loadDirectory = (loadTarget: FileExplorerTarget, relativePath: string) => {
    setChildrenByDir((current) => ({ ...current, [relativePath]: "loading" }));
    window.multiCliWork.workspaceFiles
      .listDirectory(loadTarget, relativePath)
      .then((entries) => setChildrenByDir((current) => ({ ...current, [relativePath]: entries })))
      .catch(() => setChildrenByDir((current) => ({ ...current, [relativePath]: "error" })));
  };

  /**
   * The same read the git tab makes. The two tabs are exclusive, so this never duplicates work
   * that is on screen, and a repository that cannot be read just leaves the tree unmarked.
   */
  const loadGit = (loadTarget: FileExplorerTarget) => {
    window.multiCliWork.git
      .panelData(loadTarget)
      .then(setGitData)
      .catch(() => setGitData(null));
  };

  const loadTree = (loadTarget: FileExplorerTarget) => {
    loadDirectory(loadTarget, "");
    loadGit(loadTarget);
  };

  // A different project/worktree invalidates every cached listing — relative paths are not
  // comparable across targets.
  useEffect(() => {
    setExpandedDirs(new Set());
    setChildrenByDir({});
    setGitData(null);
    setMenu(null);
    setEditing(null);
    setDeleteRequest(null);
    setActionError(null);
    if (target && !hidden) loadTree(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey(target)]);

  useEffect(() => {
    if (target && !hidden && !childrenByDir[""]) loadTree(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  const toggleDir = (relativePath: string) => {
    if (!target) return;
    setExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
        if (!childrenByDir[relativePath]) loadDirectory(target, relativePath);
      }
      return next;
    });
  };

  const refresh = () => {
    if (!target) return;
    setChildrenByDir({});
    setExpandedDirs(new Set());
    loadTree(target);
  };

  /**
   * A renamed or trashed folder invalidates every cached path under it. Rather than rewriting those
   * listings, the subtree is forgotten and collapsed; reopening the folder reads it fresh.
   */
  const forgetSubtree = (relativePath: string) => {
    setExpandedDirs((current) => new Set([...current].filter((path) => !isAtOrBelow(path, relativePath))));
    setChildrenByDir((current) =>
      Object.fromEntries(Object.entries(current).filter(([path]) => !isAtOrBelow(path, relativePath))),
    );
  };

  /** Every file operation reports failure the same way and re-reads what it may have changed. */
  const runAction = (action: (activeTarget: FileExplorerTarget) => Promise<void>) => {
    if (!target) return;
    const activeTarget = target;
    setActionError(null);
    action(activeTarget).catch((error) => setActionError(errorMessage(error)));
  };

  const reloadAfterChange = (activeTarget: FileExplorerTarget, parentRelativePath: string) => {
    loadDirectory(activeTarget, parentRelativePath);
    loadGit(activeTarget);
  };

  const openMenu = (event: ReactMouseEvent, entry: FileTreeEntry | null) => {
    event.preventDefault();
    event.stopPropagation();
    setEditing(null);
    setMenu({ entry, x: event.clientX, y: event.clientY });
  };

  const startCreate = (parentRelativePath: string, kind: FileTreeEntry["kind"]) => {
    if (!target) return;
    // The field lives inside the folder's own group, so a collapsed folder has to open first.
    if (parentRelativePath !== "" && !expandedDirs.has(parentRelativePath)) {
      setExpandedDirs((current) => new Set(current).add(parentRelativePath));
      if (!childrenByDir[parentRelativePath]) loadDirectory(target, parentRelativePath);
    }
    setEditing({ mode: "create", parentRelativePath, kind });
  };

  const submitEdit = (name: string) => {
    const active = editing;
    setEditing(null);
    if (!active) return;
    runAction(async (activeTarget) => {
      if (active.mode === "create") {
        await window.multiCliWork.workspaceFiles.create(activeTarget, active.parentRelativePath, name, active.kind);
        reloadAfterChange(activeTarget, active.parentRelativePath);
        return;
      }
      const { entry } = active;
      if (entry.name === name) return;
      const nextRelativePath = await window.multiCliWork.workspaceFiles.rename(activeTarget, entry.relativePath, name);
      if (entry.kind === "directory") forgetSubtree(entry.relativePath);
      onEntryRenamed(entry.relativePath, nextRelativePath, entry.kind);
      reloadAfterChange(activeTarget, parentRelativePathOf(entry.relativePath));
    });
  };

  const copyEntry = (entry: FileTreeEntry | null, kind: FileTreeCopyKind) => {
    runAction(async (activeTarget) => {
      const relativePath = entry?.relativePath ?? "";
      const text =
        kind === "absolute"
          ? await window.multiCliWork.workspaceFiles.absolutePath(activeTarget, relativePath)
          : kind === "relative"
            ? relativePath
            : (entry?.name ?? "");
      await window.multiCliWork.clipboard.writeText(text);
    });
  };

  const duplicateEntry = (entry: FileTreeEntry) => {
    runAction(async (activeTarget) => {
      await window.multiCliWork.workspaceFiles.duplicate(activeTarget, entry.relativePath);
      reloadAfterChange(activeTarget, parentRelativePathOf(entry.relativePath));
    });
  };

  const requestDelete = (entry: FileTreeEntry) => {
    setDeleteRequest({ entry, childCount: null, busy: false });
    if (entry.kind !== "directory" || !target) return;
    // A count the user can see before agreeing; a folder that cannot be read just shows none.
    void window.multiCliWork.workspaceFiles
      .listDirectory(target, entry.relativePath)
      .then((entries) =>
        setDeleteRequest((current) =>
          current && current.entry.relativePath === entry.relativePath ? { ...current, childCount: entries.length } : current,
        ),
      )
      .catch(() => undefined);
  };

  const confirmDelete = () => {
    const request = deleteRequest;
    if (!request || !target) return;
    const activeTarget = target;
    const { entry } = request;
    setDeleteRequest({ ...request, busy: true });
    setActionError(null);
    window.multiCliWork.workspaceFiles
      .trash(activeTarget, entry.relativePath)
      .then(() => {
        setDeleteRequest(null);
        if (entry.kind === "directory") forgetSubtree(entry.relativePath);
        onEntryDeleted(entry.relativePath, entry.kind);
        reloadAfterChange(activeTarget, parentRelativePathOf(entry.relativePath));
      })
      .catch((error) => {
        setDeleteRequest(null);
        setActionError(errorMessage(error));
      });
  };

  if (hidden) return null;

  return (
    <div className="file-explorer-body">
      <div className="section-heading">
        <span>{targetLabel ?? "파일 탐색기"}</span>
        <button
          className="icon-button"
          type="button"
          onClick={refresh}
          disabled={!target}
          aria-label="파일 목록 새로고침"
          title="파일 목록 새로고침"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {actionError ? (
        <div className="action-error" role="alert">
          <TriangleAlert size={14} />
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} aria-label="오류 닫기">
            닫기
          </button>
        </div>
      ) : null}
      {!target ? (
        <div className="sidebar-empty">
          <span>폴더를 선택하면 파일을 볼 수 있습니다</span>
        </div>
      ) : (
        <div
          className="file-tree"
          role="tree"
          aria-label="파일 탐색기"
          onContextMenu={(event) => openMenu(event, null)}
        >
          <DirectoryChildren
            state={childrenByDir[""]}
            depth={0}
            dirPath=""
            expandedDirs={expandedDirs}
            childrenByDir={childrenByDir}
            selectedRelativePath={selectedRelativePath}
            git={git}
            editing={editing}
            menuTargetPath={menu?.entry?.relativePath ?? null}
            onToggleDir={toggleDir}
            onOpenFile={onOpenFile}
            onOpenMenu={openMenu}
            onSubmitEdit={submitEdit}
            onCancelEdit={() => setEditing(null)}
          />
        </div>
      )}
      {menu && target ? (
        <FileTreeContextMenu
          entry={menu.entry}
          expanded={menu.entry ? expandedDirs.has(menu.entry.relativePath) : true}
          x={menu.x}
          y={menu.y}
          vscodeAvailable={vscodeAvailable}
          onOpen={() => menu.entry && onOpenFile(menu.entry)}
          onToggle={() => menu.entry && toggleDir(menu.entry.relativePath)}
          onCreate={(kind) =>
            startCreate(
              menu.entry && menu.entry.kind === "directory" ? menu.entry.relativePath : "",
              kind,
            )
          }
          onCopy={(kind) => copyEntry(menu.entry, kind)}
          onReveal={() =>
            runAction((activeTarget) =>
              window.multiCliWork.workspaceFiles.reveal(activeTarget, menu.entry?.relativePath ?? ""),
            )
          }
          onOpenInEditor={() =>
            runAction((activeTarget) =>
              window.multiCliWork.workspaceFiles.openInEditor(activeTarget, menu.entry?.relativePath ?? ""),
            )
          }
          onRename={() => menu.entry && setEditing({ mode: "rename", entry: menu.entry })}
          onDuplicate={() => menu.entry && duplicateEntry(menu.entry)}
          onDelete={() => menu.entry && requestDelete(menu.entry)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {deleteRequest ? (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="휴지통으로 이동">
            <h2>{deleteRequest.entry.name}을(를) 휴지통으로 보낼까요?</h2>
            <p>
              {deleteRequest.entry.relativePath}
              {deleteRequest.entry.kind === "directory" && deleteRequest.childCount !== null
                ? ` · 항목 ${deleteRequest.childCount}개`
                : ""}
            </p>
            <footer className="confirm-dialog-actions">
              <button type="button" disabled={deleteRequest.busy} onClick={() => setDeleteRequest(null)}>
                취소
              </button>
              <button type="button" className="danger-button" disabled={deleteRequest.busy} onClick={confirmDelete}>
                {deleteRequest.busy ? "이동 중" : "휴지통으로 이동"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
