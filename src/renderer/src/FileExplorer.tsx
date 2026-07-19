import type { FileExplorerTarget, FileTreeEntry } from "@shared/file-explorer-types";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { FileIcon } from "./file-icons";

export interface FileExplorerProps {
  collapsed: boolean;
  onToggleCollapse(): void;
  target: FileExplorerTarget | null;
  targetLabel: string | null;
  selectedRelativePath: string | null;
  onOpenFile(entry: FileTreeEntry): void;
}

type DirectoryState = FileTreeEntry[] | "loading" | "error";

function targetKey(target: FileExplorerTarget | null): string {
  return target ? `${target.kind}:${target.id}` : "";
}

function DirectoryChildren({
  state,
  depth,
  ...rest
}: {
  state: DirectoryState | undefined;
  depth: number;
} & Omit<TreeNodeSharedProps, "depth">) {
  const indent = { paddingLeft: `${depth * 14 + 8}px` } as CSSProperties;
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
  if (!state) return null;
  if (state.length === 0) {
    return (
      <div className="file-tree-state" style={indent}>
        <span>비어 있음</span>
      </div>
    );
  }
  return (
    <ul role="group">
      {state.map((entry) => (
        <TreeNode key={entry.relativePath} entry={entry} depth={depth} {...rest} />
      ))}
    </ul>
  );
}

interface TreeNodeSharedProps {
  expandedDirs: Set<string>;
  childrenByDir: Record<string, DirectoryState>;
  selectedRelativePath: string | null;
  onToggleDir(relativePath: string): void;
  onOpenFile(entry: FileTreeEntry): void;
}

function TreeNode({
  entry,
  depth,
  expandedDirs,
  childrenByDir,
  selectedRelativePath,
  onToggleDir,
  onOpenFile,
}: TreeNodeSharedProps & { entry: FileTreeEntry; depth: number }) {
  const isDirectory = entry.kind === "directory";
  const expanded = isDirectory && expandedDirs.has(entry.relativePath);
  const style = { paddingLeft: `${depth * 14 + 8}px` } as CSSProperties;
  return (
    <li>
      <button
        type="button"
        className={`file-tree-row ${!isDirectory && selectedRelativePath === entry.relativePath ? "selected" : ""}`}
        style={style}
        onClick={() => (isDirectory ? onToggleDir(entry.relativePath) : onOpenFile(entry))}
        title={entry.name}
      >
        {isDirectory ? (
          <span className="file-tree-toggle" aria-hidden="true">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        ) : (
          <span className="file-tree-toggle" aria-hidden="true" />
        )}
        {isDirectory ? expanded ? <FolderOpen size={14} /> : <Folder size={14} /> : <FileIcon extension={entry.extension} size={14} />}
        <span className="file-tree-name">{entry.name}</span>
      </button>
      {isDirectory && expanded ? (
        <DirectoryChildren
          state={childrenByDir[entry.relativePath]}
          depth={depth + 1}
          expandedDirs={expandedDirs}
          childrenByDir={childrenByDir}
          selectedRelativePath={selectedRelativePath}
          onToggleDir={onToggleDir}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </li>
  );
}

export function FileExplorer({
  collapsed,
  onToggleCollapse,
  target,
  targetLabel,
  selectedRelativePath,
  onOpenFile,
}: FileExplorerProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [childrenByDir, setChildrenByDir] = useState<Record<string, DirectoryState>>({});

  const loadDirectory = (loadTarget: FileExplorerTarget, relativePath: string) => {
    setChildrenByDir((current) => ({ ...current, [relativePath]: "loading" }));
    window.multiCliWork.workspaceFiles
      .listDirectory(loadTarget, relativePath)
      .then((entries) => setChildrenByDir((current) => ({ ...current, [relativePath]: entries })))
      .catch(() => setChildrenByDir((current) => ({ ...current, [relativePath]: "error" })));
  };

  // A different project/worktree invalidates every cached listing — relative paths are not
  // comparable across targets.
  useEffect(() => {
    setExpandedDirs(new Set());
    setChildrenByDir({});
    if (target && !collapsed) loadDirectory(target, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey(target)]);

  useEffect(() => {
    if (target && !collapsed && !childrenByDir[""]) loadDirectory(target, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

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
    loadDirectory(target, "");
  };

  return (
    <aside className={`file-explorer ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-top-row">
        <button
          type="button"
          className="icon-button sidebar-collapse-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "파일 탐색기 펼치기" : "파일 탐색기 접기"}
          title={collapsed ? "파일 탐색기 펼치기" : "파일 탐색기 접기"}
        >
          {collapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>
      </div>

      {collapsed ? null : (
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
          {!target ? (
            <div className="sidebar-empty">
              <span>폴더를 선택하면 파일을 볼 수 있습니다</span>
            </div>
          ) : (
            <div className="file-tree" role="tree" aria-label="파일 탐색기">
              <DirectoryChildren
                state={childrenByDir[""]}
                depth={0}
                expandedDirs={expandedDirs}
                childrenByDir={childrenByDir}
                selectedRelativePath={selectedRelativePath}
                onToggleDir={toggleDir}
                onOpenFile={onOpenFile}
              />
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
