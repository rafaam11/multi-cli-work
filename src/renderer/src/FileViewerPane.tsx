import { Eye, Pencil, RefreshCw, Save, TriangleAlert, X } from "lucide-react";
import { useMemo, useState, type ElementType } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OpenFileTab } from "./file-tabs";
import { analyzeMarkdown, resolveMarkdownLink, toggleMarkdownTask } from "./markdown-document";

interface FileViewerPaneProps {
  tab: OpenFileTab;
  onChangeContent(content: string): void;
  onAutoSaveContent(content: string): void;
  onSave(): void;
  onClose(): void;
  onForceOpen(): void;
  onOpenRelativePath(relativePath: string, anchor: string | null): void;
}

function imageMimeSubtype(extension: string | null): string {
  if (extension === "svg") return "svg+xml";
  if (extension === "jpg") return "jpeg";
  return extension ?? "png";
}

function FileViewerContent({
  tab,
  markdownMode,
  onChangeContent,
  onAutoSaveContent,
  onOpenRelativePath,
  onMarkdownError,
}: {
  tab: OpenFileTab;
  markdownMode: "preview" | "edit";
  onChangeContent(content: string): void;
  onAutoSaveContent(content: string): void;
  onOpenRelativePath(relativePath: string, anchor: string | null): void;
  onMarkdownError(message: string | null): void;
}) {
  const markdown = tab.content ?? "";
  const analysis = useMemo(() => analyzeMarkdown(markdown), [markdown]);

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
    let taskIndex = 0;
    let headingFallbackIndex = 0;
    const headingByOffset = new Map(
      analysis.headings
        .filter((heading) => heading.sourceOffset !== null)
        .map((heading) => [heading.sourceOffset, heading.slug]),
    );
    const heading = (Tag: ElementType): Components["h1"] =>
      ({ node, children, ...props }) => {
        const sourceOffset = node?.position?.start.offset;
        const fallback = analysis.headings[headingFallbackIndex++]?.slug;
        const id =
          (typeof sourceOffset === "number" ? headingByOffset.get(sourceOffset) : undefined) ??
          fallback;
        return <Tag {...props} id={id}>{children}</Tag>;
      };
    const components: Components = {
      h1: heading("h1"),
      h2: heading("h2"),
      h3: heading("h3"),
      h4: heading("h4"),
      h5: heading("h5"),
      h6: heading("h6"),
      input: ({ node: _node, ...props }) => {
        if (props.type !== "checkbox") return <input {...props} />;
        const currentIndex = taskIndex++;
        const task = analysis.tasks[currentIndex];
        return (
          <input
            {...props}
            type="checkbox"
            disabled={false}
            checked={task?.checked ?? Boolean(props.checked)}
            aria-label={`작업 ${currentIndex + 1}`}
            onChange={(event) => {
              try {
                onMarkdownError(null);
                onAutoSaveContent(toggleMarkdownTask(markdown, currentIndex, event.currentTarget.checked));
              } catch (error) {
                onMarkdownError(error instanceof Error ? error.message : String(error));
              }
            }}
          />
        );
      },
      a: ({ node: _node, href, children, ...props }) => (
        <a
          {...props}
          href={href}
          onClick={(event) => {
            event.preventDefault();
            const target = resolveMarkdownLink(tab.relativePath, href ?? "");
            if (target.kind === "blocked") {
              onMarkdownError(target.reason);
              return;
            }
            onMarkdownError(null);
            if (target.kind === "anchor") {
              const element = document.getElementById(target.anchor);
              if (!element) {
                onMarkdownError("문서에서 해당 위치를 찾을 수 없습니다.");
                return;
              }
              element.scrollIntoView?.({ block: "start" });
              return;
            }
            if (target.kind === "file") {
              onOpenRelativePath(target.relativePath, target.anchor);
              return;
            }
            void window.multiCliWork.shell.openExternal(target.url).catch((error: unknown) => {
              onMarkdownError(error instanceof Error ? error.message : String(error));
            });
          }}
        >
          {children}
        </a>
      ),
    };
    return (
      <div className="file-viewer-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
          {markdown}
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
export function FileViewerPane({
  tab,
  onChangeContent,
  onAutoSaveContent,
  onSave,
  onClose,
  onForceOpen,
  onOpenRelativePath,
}: FileViewerPaneProps) {
  const [markdownMode, setMarkdownMode] = useState<"preview" | "edit">("preview");
  const [markdownError, setMarkdownError] = useState<string | null>(null);
  const isMarkdown = tab.category === "markdown";
  const editable = (isMarkdown || tab.category === "text") && tab.encoding === "utf8" && !tab.truncated;

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
          {isMarkdown && editable ? (
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
          {editable ? (
            <button
              type="button"
              className="icon-button"
              onClick={onSave}
              disabled={!tab.dirty || tab.saving || tab.loading}
              aria-label={tab.saving ? "저장 중" : "저장"}
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
            {markdownError ? (
              <p className="file-viewer-notice file-viewer-error" role="alert">
                {markdownError}
              </p>
            ) : null}
            {tab.category === "unsupported" ? (
              <div className="file-viewer-state">
                <span>이 파일 형식은 아직 읽지 않았습니다.</span>
                <button type="button" onClick={onForceOpen}>텍스트로 강제 열기</button>
              </div>
            ) : tab.encoding !== "utf8" && tab.category !== "image" ? (
              <div className="file-viewer-state file-viewer-error">
                <TriangleAlert size={18} />
                <span>UTF-8 텍스트가 아니거나 바이너리 파일이라 편집할 수 없습니다.</span>
              </div>
            ) : (
              <FileViewerContent
                tab={tab}
                markdownMode={markdownMode}
                onChangeContent={onChangeContent}
                onAutoSaveContent={onAutoSaveContent}
                onOpenRelativePath={onOpenRelativePath}
                onMarkdownError={setMarkdownError}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
