import type { GitChangeStatus } from "@shared/api-types";
import type { FileExplorerTarget } from "@shared/file-explorer-types";
import { FileWarning, MessageSquarePlus, RefreshCw, Send, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LocalDiffNote } from "./app/diff-notes";
import { attachDiffNoteGutter, type DiffNoteGutter, type DiffSide } from "./diff-note-gutter";
import { monaco, monacoThemeName } from "./monaco-setup";
import { MONACO_DIFF_TYPOGRAPHY } from "./renderer-typography";
import { errorMessage } from "./ipc-error";
import { currentTheme, useResolvedTheme } from "./theme";

export interface GitDiffFile {
  target: FileExplorerTarget;
  path: string;
  status: GitChangeStatus;
  /** Renames only: HEAD still knows the file by this path. */
  renamedFrom?: string;
  targetLabel: string | null;
}

/** A line note as the pane hands it up: the caller adds the checkout and the bookkeeping. */
export interface DiffNoteInput {
  path: string;
  side: DiffSide;
  line: number;
  lineText: string;
  body: string;
}

export interface GitDiffNotesProps {
  /** Every note of this checkout, every file — the list below the diff shows the drafts. */
  notes: readonly LocalDiffNote[];
  onAdd(note: DiffNoteInput): void;
  onUpdate(id: string, body: string): void;
  onDelete(id: string): void;
  /** Live sessions of the same checkout, the ones the notes can go to. */
  targets: ReadonlyArray<{ id: string; label: string }>;
  defaultTarget: string | null;
  onSend(sessionId: string, notes: LocalDiffNote[]): void;
}

export interface GitDiffPaneProps {
  file: GitDiffFile;
  onClose(): void;
  /** Line notes; without them the pane is the plain read-only diff it always was. */
  notes?: GitDiffNotesProps;
}

interface DiffContents {
  original: string;
  modified: string;
  truncated: boolean;
  binary: boolean;
}

interface NoteDraft {
  side: DiffSide;
  line: number;
  lineText: string;
  body: string;
  /** Set when an existing note is being edited. */
  id: string | null;
}

function fileKey(file: GitDiffFile): string {
  return `${file.target.kind}:${file.target.id}:${file.path}`;
}

/** Fresh models per open; a stale model under the same URI would shadow the new content. */
function createModel(content: string, side: "original" | "modified", path: string) {
  const uri = monaco.Uri.parse(`mcw-diff://${side}/${path}`);
  monaco.editor.getModel(uri)?.dispose();
  return monaco.editor.createModel(content, undefined, uri);
}

const sideLabel = (side: DiffSide) => (side === "RIGHT" ? "작업 트리" : "HEAD");

export function GitDiffPane({ file, onClose, notes }: GitDiffPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<DiffNoteGutter | null>(null);
  const [contents, setContents] = useState<DiffContents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const theme = useResolvedTheme();
  const notesRef = useRef(notes);
  notesRef.current = notes;

  // Monaco themes are global: switching one switches every open diff at once.
  useEffect(() => {
    monaco.editor.setTheme?.(monacoThemeName(theme));
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    setContents(null);
    setError(null);
    setDraft(null);
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
      theme: monacoThemeName(currentTheme()),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      ...MONACO_DIFF_TYPOGRAPHY,
      renderOverviewRuler: false,
      // VS Code's default look: two panes, without the width heuristic collapsing them to inline.
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
    });
    editor.setModel({ original: originalModel, modified: modifiedModel });
    if (notesRef.current) {
      // A click on a line number (or the margin beside it) opens that line's note, new or existing.
      gutterRef.current = attachDiffNoteGutter(editor, (side, line, lineText) => {
        const existing = notesRef.current?.notes.find(
          (note) => note.status === "draft" && note.path === file.path && note.side === side && note.line === line,
        );
        setDraft({ side, line, lineText, body: existing?.body ?? "", id: existing?.id ?? null });
      });
    }
    return () => {
      gutterRef.current?.dispose();
      gutterRef.current = null;
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contents]);

  const drafts = notes ? notes.notes.filter((note) => note.status === "draft") : [];
  const fileDrafts = drafts.filter((note) => note.path === file.path);
  useEffect(() => {
    gutterRef.current?.setNotes(fileDrafts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contents, fileDrafts.map((note) => `${note.id}:${note.side}:${note.line}:${note.body}`).join("|")]);

  // The user's pick while it is still alive; otherwise the session last typed into, then the first.
  const chosenTarget = !notes
    ? null
    : target && notes.targets.some((candidate) => candidate.id === target)
      ? target
      : (notes.targets.find((candidate) => candidate.id === notes.defaultTarget)?.id ?? notes.targets[0]?.id ?? null);

  const saveDraft = () => {
    if (!notes || !draft) return;
    const body = draft.body.trim();
    if (draft.id) {
      if (body) notes.onUpdate(draft.id, body);
      else notes.onDelete(draft.id);
    } else if (body) {
      notes.onAdd({ path: file.path, side: draft.side, line: draft.line, lineText: draft.lineText, body });
    }
    setDraft(null);
  };

  return (
    <section className="git-diff-pane" aria-label="Git 변경 비교">
      <header className="git-diff-header">
        <div className="git-diff-title">
          <span className="git-diff-path" title={file.renamedFrom ? `${file.renamedFrom} → ${file.path}` : file.path}>
            {file.path}
          </span>
          <span className="git-diff-caption">
            {file.targetLabel ? `${file.targetLabel} · ` : ""}HEAD ↔ 작업 트리
            {notes ? " · 줄 번호를 눌러 메모" : ""}
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

      {notes && draft ? (
        <div className="diff-note-editor" role="group" aria-label="줄 메모 편집">
          <div className="diff-note-editor-place">
            <MessageSquarePlus size={13} aria-hidden="true" />
            <span>
              {sideLabel(draft.side)} {draft.line}줄
            </span>
            <code title={draft.lineText}>{draft.lineText || "(빈 줄)"}</code>
          </div>
          <textarea
            aria-label="줄 메모"
            rows={3}
            autoFocus
            value={draft.body}
            placeholder="이 줄에서 에이전트가 할 일"
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) saveDraft();
              if (event.key === "Escape") setDraft(null);
            }}
          />
          <div className="diff-note-editor-actions">
            <button type="button" onClick={() => setDraft(null)}>
              취소
            </button>
            <button type="button" onClick={saveDraft}>
              {draft.id ? "고치기" : "메모 남기기"}
            </button>
          </div>
        </div>
      ) : null}

      {notes && drafts.length > 0 ? (
        <div className="diff-notes" role="region" aria-label="줄 메모 목록">
          <ul className="diff-notes-list">
            {drafts.map((note) => (
              <li key={note.id} className={note.path === file.path ? "diff-note current-file" : "diff-note"}>
                <button
                  type="button"
                  className="diff-note-place"
                  disabled={note.path !== file.path}
                  title={note.path !== file.path ? "다른 파일의 메모 — 그 파일의 비교에서 고친다" : "메모 고치기"}
                  onClick={() => setDraft({ side: note.side, line: note.line, lineText: note.lineText, body: note.body, id: note.id })}
                >
                  {note.path} · {sideLabel(note.side)} {note.line}줄
                </button>
                <span className="diff-note-body">{note.body}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${note.path} ${note.line}줄 메모 삭제`}
                  onClick={() => notes.onDelete(note.id)}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
          <div className="diff-notes-send">
            {notes.targets.length === 0 ? (
              <span className="diff-notes-empty">이 체크아웃에서 실행 중인 세션이 없습니다</span>
            ) : (
              <select aria-label="보낼 세션" value={chosenTarget ?? ""} onChange={(event) => setTarget(event.target.value)}>
                {notes.targets.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              disabled={!chosenTarget}
              onClick={() => chosenTarget && notes.onSend(chosenTarget, drafts)}
            >
              <Send size={12} aria-hidden="true" />
              메모 {drafts.length}개 보내기
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
