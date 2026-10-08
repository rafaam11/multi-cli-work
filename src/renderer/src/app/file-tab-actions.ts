import type { SlotViewState } from "@shared/app-state-types";
import { needsRunConfirmation, type FileExplorerTarget, type FileTreeEntry } from "@shared/file-explorer-types";
import type { AppSettings } from "@shared/settings-types";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { categorizeFile, fileExtensionOf, fileTabId, type OpenFileTab } from "../file-tabs";
import { errorMessage } from "../ipc-error";
import { documentPaneId } from "../pane-items";
import type { Shelves } from "../shelves";
import { renamePaneId } from "../slot-view";
import { documentTargetKey } from "./app-model";

export interface RunConfirmRequest {
  target: FileExplorerTarget;
  entry: FileTreeEntry;
  mode: "run" | "open";
  error: string | null;
  running: boolean;
}

export interface FileTabContext {
  openFileTabs: OpenFileTab[];
  setOpenFileTabs: Dispatch<SetStateAction<OpenFileTab[]>>;
  appSettings: AppSettings;
  /** 그리드에 패인을 연다(이미 있으면 그리로 간다). */
  openPane(paneId: string): void;
  /** 닫은 문서를 모든 배치에서 뺀다. */
  dropPaneEverywhere(paneId: string): void;
  setRunConfirmRequest: Dispatch<SetStateAction<RunConfirmRequest | null>>;
  setPendingFileAnchor: Dispatch<SetStateAction<{ tabId: string; anchor: string } | null>>;
  setFileTabCloseRequest: Dispatch<SetStateAction<OpenFileTab | null>>;
  setActionError: Dispatch<SetStateAction<string | null>>;
  setFolderViews: Dispatch<SetStateAction<Record<string, SlotViewState>>>;
  setShelves: Dispatch<SetStateAction<Shelves>>;
  setFocusedPaneId: Dispatch<SetStateAction<string | null>>;
  fileWriteQueuesRef: MutableRefObject<Map<string, Promise<boolean>>>;
  pendingFileWriteCountsRef: MutableRefObject<Map<string, number>>;
}

/**
 * 파일 탭을 열고, 고치고, 저장하고, 닫고, 탐색기의 이름 변경·삭제를 따라가게 하는 동작들. App이 매
 * 렌더 부르며, 동작은 그 렌더의 상태를 본다 — App 안에 두었을 때와 같다.
 */
export function createFileTabActions(context: FileTabContext) {
  const {
    openFileTabs,
    setOpenFileTabs,
    appSettings,
    openPane,
    dropPaneEverywhere,
    setRunConfirmRequest,
    setPendingFileAnchor,
    setFileTabCloseRequest,
    setActionError,
    setFolderViews,
    setShelves,
    setFocusedPaneId,
    fileWriteQueuesRef,
    pendingFileWriteCountsRef,
  } = context;

  const openFile = (target: FileExplorerTarget, targetLabel: string, entry: FileTreeEntry): string => {
    if (entry.executable) {
      setRunConfirmRequest({ target, entry, mode: "run", error: null, running: false });
      return fileTabId(target, entry.relativePath);
    }
    // 확장자별 기본 열기 대상이 지정돼 있으면 인앱 탭 대신 그리로 보낸다. "in-app"/미지정은 아래로 통과.
    const openWith = appSettings.files.openWith[entry.extension ?? ""];
    if (openWith === "os") {
      openWithOs(target, entry);
      return fileTabId(target, entry.relativePath);
    }
    if (openWith === "vscode") {
      void window.multiCliWork.workspaceFiles
        .openInEditor(target, entry.relativePath)
        .catch((error) => setActionError(errorMessage(error)));
      return fileTabId(target, entry.relativePath);
    }
    const id = fileTabId(target, entry.relativePath);
    const paneId = documentPaneId("file", id);
    if (openFileTabs.some((tab) => tab.id === id)) {
      openPane(paneId);
      return id;
    }
    const category = categorizeFile(entry.name, entry.extension);
    if (category === "unsupported" && appSettings.files.unsupportedOpensWithOs) {
      openWithOs(target, entry);
      return id;
    }
    const tab: OpenFileTab = {
      id,
      target,
      targetLabel,
      relativePath: entry.relativePath,
      name: entry.name,
      extension: entry.extension,
      category,
      encoding: "utf8",
      content: null,
      originalContent: null,
      dirty: false,
      loading: category !== "unsupported",
      saving: false,
      loadError: null,
      saveError: null,
      truncated: false,
    };
    setOpenFileTabs((current) => [...current, tab]);
    openPane(paneId);
    if (category === "unsupported") return id;
    void window.multiCliWork.workspaceFiles
      .readFile(target, entry.relativePath)
      .then((result) => {
        setOpenFileTabs((current) =>
          current.map((candidate) =>
            candidate.id === id
              ? {
                  ...candidate,
                  content: result.content,
                  originalContent: result.content,
                  encoding: result.encoding,
                  truncated: result.truncated,
                  loading: false,
                }
              : candidate,
          ),
        );
      })
      .catch((error) => {
        setOpenFileTabs((current) =>
          current.map((candidate) =>
            candidate.id === id ? { ...candidate, loading: false, loadError: errorMessage(error) } : candidate,
          ),
        );
      });
    return id;
  };

  /** Opens `entry` with its OS-associated program — same result as a double-click in the file explorer. */
  const openWithOs = (target: FileExplorerTarget, entry: FileTreeEntry) => {
    if (needsRunConfirmation(entry.name, window.multiCliWork.platform, entry.executable)) {
      setRunConfirmRequest({ target, entry, mode: "open", error: null, running: false });
      return;
    }
    void window.multiCliWork.workspaceFiles
      .openEntry(target, entry.relativePath, { confirmedRun: false })
      .catch((error) => setActionError(errorMessage(error)));
  };

  const openRelativeFile = (sourceTab: OpenFileTab, relativePath: string, anchor: string | null) => {
    const name = relativePath.split("/").at(-1) ?? relativePath;
    const extension = fileExtensionOf(name);
    const tabId = openFile(sourceTab.target, sourceTab.targetLabel, {
      name,
      relativePath,
      kind: "file",
      extension,
      // A Markdown link may open a file, but it can never execute one.
      executable: false,
      // Not read from a directory listing, so no real mtime is known here.
      mtimeMs: 0,
    });
    if (anchor) setPendingFileAnchor({ tabId, anchor });
  };

  const forceOpenFileTab = (tabId: string) => {
    const tab = openFileTabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.loading) return;
    setOpenFileTabs((current) => current.map((candidate) => candidate.id === tabId ? { ...candidate, loading: true, loadError: null } : candidate));
    void window.multiCliWork.workspaceFiles.readFile(tab.target, tab.relativePath).then((result) => {
      setOpenFileTabs((current) => current.map((candidate) => candidate.id === tabId ? (
        result.encoding === "utf8" && !result.truncated
          ? { ...candidate, category: "text", encoding: result.encoding, content: result.content, originalContent: result.content, truncated: false, loading: false }
          : { ...candidate, encoding: result.encoding, truncated: result.truncated, loading: false, loadError: result.truncated ? "파일이 너무 커서 강제로 열 수 없습니다." : "UTF-8 텍스트가 아니거나 바이너리 파일입니다." }
      ) : candidate));
    }).catch((error) => setOpenFileTabs((current) => current.map((candidate) => candidate.id === tabId ? { ...candidate, loading: false, loadError: errorMessage(error) } : candidate)));
  };

  const updateFileTabContent = (tabId: string, content: string) => {
    setOpenFileTabs((current) =>
      current.map((tab) => (tab.id === tabId ? { ...tab, content, dirty: content !== tab.originalContent } : tab)),
    );
  };

  const saveFileTab = (tabId: string, contentOverride?: string): Promise<boolean> => {
    const tab = openFileTabs.find((candidate) => candidate.id === tabId);
    const content = contentOverride ?? tab?.content;
    if (!tab || content === null || content === undefined || tab.truncated || tab.encoding !== "utf8" || !["markdown", "html", "text"].includes(tab.category)) return Promise.resolve(false);
    const pendingCount = (pendingFileWriteCountsRef.current.get(tabId) ?? 0) + 1;
    pendingFileWriteCountsRef.current.set(tabId, pendingCount);
    setOpenFileTabs((current) =>
      current.map((candidate) =>
        candidate.id === tabId
          ? {
              ...candidate,
              ...(contentOverride === undefined ? {} : { content, dirty: content !== candidate.originalContent }),
              saving: true,
              saveError: null,
            }
          : candidate,
      ),
    );
    const previous = fileWriteQueuesRef.current.get(tabId) ?? Promise.resolve(true);
    const write = previous.then(async () => {
      let succeeded = false;
      try {
        await window.multiCliWork.workspaceFiles.writeFile(tab.target, tab.relativePath, content);
        succeeded = true;
        setOpenFileTabs((current) =>
          current.map((candidate) =>
            candidate.id === tabId
              ? {
                  ...candidate,
                  originalContent: content,
                  dirty: candidate.content !== content,
                  saveError: null,
                }
              : candidate,
          ),
        );
      } catch (error) {
        setOpenFileTabs((current) =>
          current.map((candidate) =>
            candidate.id === tabId
              ? { ...candidate, dirty: candidate.content !== candidate.originalContent, saveError: errorMessage(error) }
              : candidate,
          ),
        );
      } finally {
        const remaining = Math.max(0, (pendingFileWriteCountsRef.current.get(tabId) ?? 1) - 1);
        if (remaining === 0) pendingFileWriteCountsRef.current.delete(tabId);
        else pendingFileWriteCountsRef.current.set(tabId, remaining);
        setOpenFileTabs((current) =>
          current.map((candidate) => (candidate.id === tabId ? { ...candidate, saving: remaining > 0 } : candidate)),
        );
      }
      return succeeded;
    });
    fileWriteQueuesRef.current.set(tabId, write);
    void write.finally(() => {
      if (fileWriteQueuesRef.current.get(tabId) === write) fileWriteQueuesRef.current.delete(tabId);
    });
    return write;
  };

  const closeFileTabImmediately = (tabId: string) => {
    setOpenFileTabs((current) => current.filter((tab) => tab.id !== tabId));
    dropPaneEverywhere(documentPaneId("file", tabId));
  };

  const requestCloseFileTab = (tab: OpenFileTab) => {
    if (tab.dirty) {
      setFileTabCloseRequest(tab);
      return;
    }
    closeFileTabImmediately(tab.id);
  };

  /** The tabs an explorer operation touched: the file itself, or everything under a folder. */
  const fileTabsUnder = (target: FileExplorerTarget, relativePath: string, kind: "file" | "directory") => {
    const key = documentTargetKey(target);
    return openFileTabs.filter(
      (tab) =>
        documentTargetKey(tab.target) === key &&
        (kind === "directory"
          ? tab.relativePath === relativePath || tab.relativePath.startsWith(`${relativePath}/`)
          : tab.relativePath === relativePath),
    );
  };

  const closeFileTabsUnder = (target: FileExplorerTarget, relativePath: string, kind: "file" | "directory") => {
    const affected = fileTabsUnder(target, relativePath, kind);
    for (const tab of affected.filter((tab) => !tab.dirty)) closeFileTabImmediately(tab.id);
    // Unsaved edits outlive the file on disk, so they go through the usual close confirmation. The
    // dialog holds one tab at a time; any others stay open rather than losing their content to a
    // queue nobody can see.
    const dirty = affected.find((tab) => tab.dirty);
    if (dirty) setFileTabCloseRequest(dirty);
  };

  /**
   * A renamed file keeps its pane. Both the tab id and the pane id are derived from the path, so
   * every arrangement holding the old id is rewritten in place instead of losing the pane.
   */
  const moveFileTabs = (
    target: FileExplorerTarget,
    relativePath: string,
    nextRelativePath: string,
    kind: "file" | "directory",
  ) => {
    const affected = fileTabsUnder(target, relativePath, kind);
    if (affected.length === 0) return;
    const movedPath = (path: string) => nextRelativePath + path.slice(relativePath.length);
    const renames = affected.map((tab) => ({
      from: documentPaneId("file", tab.id),
      to: documentPaneId("file", fileTabId(tab.target, movedPath(tab.relativePath))),
    }));
    const applyRenames = (view: SlotViewState) =>
      renames.reduce((current, rename) => renamePaneId(current, rename.from, rename.to), view);
    setOpenFileTabs((current) =>
      current.map((tab) => {
        if (!affected.some((candidate) => candidate.id === tab.id)) return tab;
        const moved = movedPath(tab.relativePath);
        const name = moved.split("/").at(-1) ?? moved;
        const extension = fileExtensionOf(name);
        return {
          ...tab,
          id: fileTabId(tab.target, moved),
          relativePath: moved,
          name,
          extension,
          category: categorizeFile(name, extension),
        };
      }),
    );
    setFolderViews((current) =>
      Object.fromEntries(Object.entries(current).map(([key, view]) => [key, applyRenames(view)])),
    );
    setShelves((current) => ({ active: applyRenames(current.active), hidden: applyRenames(current.hidden) }));
    setFocusedPaneId((current) => renames.find((rename) => rename.from === current)?.to ?? current);
  };

  return {
    openFile,
    openWithOs,
    openRelativeFile,
    forceOpenFileTab,
    updateFileTabContent,
    saveFileTab,
    closeFileTabImmediately,
    requestCloseFileTab,
    fileTabsUnder,
    closeFileTabsUnder,
    moveFileTabs,
  };
}
