import type { GitChangeStatus } from "@shared/api-types";
import type { FileExplorerTarget } from "@shared/file-explorer-types";
import { FileWarning, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { monaco } from "./monaco-setup";

export interface GitDiffFile {
  target: FileExplorerTarget;
  path: string;
  status: GitChangeStatus;
  /** Renames only: HEAD still knows the file by this path. */
  renamedFrom?: string;
  targetLabel: string | null;
}

export interface GitDiffPaneProps {
  file: GitDiffFile;
  onClose(): void;
}

interface DiffContents {
  original: string;
  modified: string;
  truncated: boolean;
  binary: boolean;
}

function fileKey(file: GitDiffFile): string {
  return `${file.target.kind}:${file.target.id}:${file.path}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fresh models per open; a stale model under the same URI would shadow the new content. */
function createModel(content: string, side: "original" | "modified", path: string) {
  const uri = monaco.Uri.parse(`mcw-diff://${side}/${path}`);
  monaco.editor.getModel(uri)?.dispose();
  return monaco.editor.createModel(content, undefined, uri);
}

export function GitDiffPane({ file, onClose }: GitDiffPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [contents, setContents] = useState<DiffContents | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContents(null);
    setError(null);
    const load = async () => {
      // New/untracked files have no HEAD side; deleted files have no working-tree side.
      const originalPath = file.renamedFrom ?? file.path;
      const original =
        file.status === "?" || file.status === "A"
          ? { content: "", truncated: false }
          : await window.multiCliWork.git.fileOriginal(file.target, originalPath);
      let modified = "";
      let binary = false;
      let truncated = original.truncated;
      if (file.status !== "D") {
        const working = await window.multiCliWork.workspaceFiles.readFile(file.target, file.path);
        if (working.encoding === "base64") {
          binary = true;
        } else {
          modified = working.content;
          truncated = truncated || working.truncated;
        }
      }
      if (!cancelled) setContents({ original: original.content, modified, truncated, binary });
    };
    load().catch((cause) => {
      if (!cancelled) setError(errorMessage(cause));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey(file)]);

  useEffect(() => {
    if (!contents || contents.binary || !containerRef.current) return;
    const originalModel = createModel(contents.original, "original", file.renamedFrom ?? file.path);
    const modifiedModel = createModel(contents.modified, "modified", file.path);
    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      automaticLayout: true,
      readOnly: true,
      theme: "mcw-dark",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12,
      renderOverviewRuler: false,
      // VS Code's default look: two panes, without the width heuristic collapsing them to inline.
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
    });
    editor.setModel({ original: originalModel, modified: modifiedModel });
    return () => {
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contents]);

  return (
    <section className="git-diff-pane" aria-label="Git 변경 비교">
      <header className="git-diff-header">
        <div className="git-diff-title">
          <span className="git-diff-path" title={file.renamedFrom ? `${file.renamedFrom} → ${file.path}` : file.path}>
            {file.path}
          </span>
          <span className="git-diff-caption">
            {file.targetLabel ? `${file.targetLabel} · ` : ""}HEAD ↔ 작업 트리
          </span>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="변경 비교 닫기" title="변경 비교 닫기">
          <X size={16} />
        </button>
      </header>

      {contents?.truncated ? (
        <div className="git-diff-notice">
          <TriangleAlert size={13} />
          <span>파일이 커서 일부만 표시됩니다</span>
        </div>
      ) : null}

      {error ? (
        <div className="git-diff-state">
          <TriangleAlert size={18} />
          <span>{error}</span>
        </div>
      ) : contents?.binary ? (
        <div className="git-diff-state">
          <FileWarning size={18} />
          <span>바이너리 파일은 비교를 표시할 수 없습니다</span>
        </div>
      ) : !contents ? (
        <div className="git-diff-state">
          <RefreshCw className="spin" size={18} />
          <span>불러오는 중</span>
        </div>
      ) : (
        <div className="git-diff-editor" ref={containerRef} />
      )}
    </section>
  );
}
