import { Eye, Pencil, RefreshCw, Save, TriangleAlert, X } from "lucide-react";
import { useState, type AnchorHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OpenFileTab } from "./file-tabs";

interface FileViewerPaneProps {
  tab: OpenFileTab;
  onChangeContent(content: string): void;
  onSave(): void;
  onClose(): void;
}

function imageMimeSubtype(extension: string | null): string {
  if (extension === "svg") return "svg+xml";
  if (extension === "jpg") return "jpeg";
  return extension ?? "png";
}

/** Markdown links open in the OS browser through the same allowlisted IPC as "GitHub에서 열기" — never `window.open`, which `secureBrowserWindow` blocks anyway. */
function MarkdownLink({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (href) void window.multiCliWork.shell.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

function FileViewerContent({
  tab,
  markdownMode,
  onChangeContent,
}: {
  tab: OpenFileTab;
  markdownMode: "preview" | "edit";
  onChangeContent(content: string): void;
}) {
  if (tab.category === "markdown") {
    if (markdownMode === "edit") {
      return (
        <textarea
          className="file-editor-textarea"
          spellCheck={false}
          value={tab.content ?? ""}
          onChange={(event) => onChangeContent(event.target.value)}
          aria-label={`${tab.name} 편집`}
        />
      );
    }
    return (
      <div className="file-viewer-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MarkdownLink }}>
          {tab.content ?? ""}
        </ReactMarkdown>
      </div>
    );
  }
  if (tab.category === "image") {
    return (
      <div className="file-viewer-image">
        <img
          src={`data:image/${imageMimeSubtype(tab.extension)};base64,${tab.content ?? ""}`}
          alt={tab.name}
        />
      </div>
    );
  }
  if (tab.category === "text") {
    return <pre className="file-viewer-plain">{tab.content ?? ""}</pre>;
  }
  return (
    <div className="file-viewer-state">
      <span>이 파일 형식은 미리보기를 지원하지 않습니다</span>
    </div>
  );
}

/**
 * Markdown gets edit + preview; every other supported category is read-only — no editor library,
 * no syntax highlighting, matching the "don't build what's hard to represent well" scope this was
 * built to.
 */
export function FileViewerPane({ tab, onChangeContent, onSave, onClose }: FileViewerPaneProps) {
  const [markdownMode, setMarkdownMode] = useState<"preview" | "edit">("preview");
  const isMarkdown = tab.category === "markdown";

  return (
    <section className="file-viewer-pane" aria-label={`${tab.name} 파일 보기`}>
      <header className="file-viewer-header">
        <div className="file-viewer-title">
          <span className="file-viewer-name" title={tab.relativePath}>
            {tab.name}
          </span>
          {tab.dirty ? <span className="file-viewer-dirty" title="저장하지 않은 변경" aria-hidden="true" /> : null}
        </div>
        <div className="file-viewer-actions">
          {isMarkdown ? (
            <button
              type="button"
              className="icon-button"
              onClick={() => setMarkdownMode((mode) => (mode === "preview" ? "edit" : "preview"))}
              aria-label={markdownMode === "preview" ? "편집" : "미리보기"}
              title={markdownMode === "preview" ? "편집" : "미리보기"}
            >
              {markdownMode === "preview" ? <Pencil size={16} /> : <Eye size={16} />}
            </button>
          ) : null}
          {isMarkdown ? (
            <button
              type="button"
              className="icon-button"
              onClick={onSave}
              disabled={!tab.dirty || tab.saving || tab.loading}
              aria-label="저장"
              title="저장 (Ctrl+S)"
            >
              <Save size={16} />
            </button>
          ) : null}
          <button type="button" className="icon-button" onClick={onClose} aria-label="파일 닫기" title="파일 닫기">
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="file-viewer-body">
        {tab.loading ? (
          <div className="file-viewer-state">
            <RefreshCw className="spin" size={18} />
            <span>불러오는 중</span>
          </div>
        ) : tab.loadError ? (
          <div className="file-viewer-state file-viewer-error">
            <TriangleAlert size={18} />
            <span>{tab.loadError}</span>
          </div>
        ) : (
          <>
            {tab.truncated ? (
              <p className="file-viewer-notice" role="status">
                파일이 너무 커서 일부만 표시합니다
              </p>
            ) : null}
            {tab.saveError ? (
              <p className="file-viewer-notice file-viewer-error" role="alert">
                {tab.saveError}
              </p>
            ) : null}
            <FileViewerContent tab={tab} markdownMode={markdownMode} onChangeContent={onChangeContent} />
          </>
        )}
      </div>
    </section>
  );
}
