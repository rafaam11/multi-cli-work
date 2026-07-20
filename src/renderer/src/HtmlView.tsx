import { Code2, Eye, RefreshCw, RotateCw, Save, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OpenFileTab } from "./file-tabs";

interface HtmlViewProps {
  tab: OpenFileTab;
  onChangeContent(content: string): void;
  onSave(): void;
  onClose(): void;
}

type HtmlViewMode = "preview" | "source";
type PreviewStatus = "loading" | "ready" | "error";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * html files open as a browser-rendered preview by default — a sandboxed main-process WebContentsView
 * draws over the "hole" below, resolving relative CSS/JS/images against the file's own folder. The
 * "소스" toggle swaps in the same editable textarea every other text file gets; saving there and
 * toggling back reloads the page from disk. The native view only exists while this component is in
 * preview mode, so leaving the file (or switching to source) tears it down.
 */
export function HtmlView({ tab, onChangeContent, onSave, onClose }: HtmlViewProps) {
  const [mode, setMode] = useState<HtmlViewMode>("preview");
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const holeRef = useRef<HTMLDivElement | null>(null);
  const editable = tab.encoding === "utf8" && !tab.truncated;

  useEffect(() => {
    if (mode !== "preview") return;
    const hole = holeRef.current;
    if (!hole) return;
    let disposed = false;
    setStatus("loading");
    setError(null);

    const sendBounds = () => {
      const rect = hole.getBoundingClientRect();
      void window.multiCliWork.htmlPreview.setBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    };

    const rect = hole.getBoundingClientRect();
    window.multiCliWork.htmlPreview
      .open(tab.target, tab.relativePath, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      .then(() => {
        if (!disposed) setStatus("ready");
      })
      .catch((openError) => {
        if (disposed) return;
        setStatus("error");
        setError(messageOf(openError));
      });

    const observer = new ResizeObserver(sendBounds);
    observer.observe(hole);
    window.addEventListener("resize", sendBounds);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", sendBounds);
      void window.multiCliWork.htmlPreview.close();
    };
    // tab.target is a stable object per tab; key on its identity fields plus the path.
  }, [mode, tab.target.kind, tab.target.id, tab.relativePath]);

  return (
    <section className="html-view" aria-label={`${tab.name} html 미리보기`}>
      <header className="file-viewer-header">
        <div className="file-viewer-title">
          <span className="file-viewer-name" title={tab.relativePath}>
            {tab.name}
          </span>
          {tab.dirty ? <span className="file-viewer-dirty" title="저장하지 않은 변경" aria-hidden="true" /> : null}
        </div>
        <div className="file-viewer-actions">
          <div className="html-view-toggle" role="group" aria-label="보기 모드">
            <button
              type="button"
              className={mode === "preview" ? "is-active" : ""}
              onClick={() => setMode("preview")}
              aria-pressed={mode === "preview"}
            >
              <Eye size={14} />
              미리보기
            </button>
            <button
              type="button"
              className={mode === "source" ? "is-active" : ""}
              onClick={() => setMode("source")}
              aria-pressed={mode === "source"}
            >
              <Code2 size={14} />
              소스
            </button>
          </div>
          {mode === "preview" ? (
            <button
              type="button"
              className="icon-button"
              onClick={() => void window.multiCliWork.htmlPreview.reload()}
              disabled={status !== "ready"}
              aria-label="새로 고침"
              title="새로 고침"
            >
              <RotateCw size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="icon-button"
              onClick={onSave}
              disabled={!editable || !tab.dirty || tab.saving || tab.loading}
              aria-label="저장"
              title="저장 (Ctrl+S)"
            >
              <Save size={16} />
            </button>
          )}
          <button type="button" className="icon-button" onClick={onClose} aria-label="파일 닫기" title="파일 닫기">
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="html-view-body">
        {mode === "preview" ? (
          <div className="html-preview">
            {status === "loading" ? (
              <div className="git-graph-status">
                <RefreshCw className="spin" size={20} />
                <p>미리보기를 여는 중…</p>
                <span>{tab.relativePath}</span>
              </div>
            ) : status === "error" ? (
              <div className="git-graph-status">
                <TriangleAlert size={20} />
                <p>미리보기를 열 수 없습니다</p>
                <span>{error}</span>
              </div>
            ) : null}
            {/* The native view is drawn over this hole; it must stay in the layout to be measured. */}
            <div className="html-preview-hole" ref={holeRef} aria-hidden="true" />
          </div>
        ) : (
          <div className="html-source">
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
                {editable ? (
                  <textarea
                    className="file-editor-textarea"
                    spellCheck={false}
                    value={tab.content ?? ""}
                    onChange={(event) => onChangeContent(event.target.value)}
                    aria-label={`${tab.name} 편집`}
                  />
                ) : (
                  <div className="file-viewer-state file-viewer-error">
                    <TriangleAlert size={18} />
                    <span>UTF-8 텍스트가 아니거나 너무 커서 편집할 수 없습니다.</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
