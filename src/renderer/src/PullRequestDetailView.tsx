import type {
  ActivePullRequestReview,
  PullRequestDetail,
  PullRequestDiffFile,
  PullRequestReviewAnnotation,
  PullRequestReviewAnnotationInput,
  PullRequestTimelineItem,
} from "@shared/github-types";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  FileDiff,
  GitCommit,
  GitPullRequest,
  History,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseDiffFile, type DiffFileView, type DiffLine } from "./diff-parse";
import {
  clampDiffSidebarWidth,
  DIFF_SIDEBAR_STORAGE_KEY,
  labelStyle,
} from "./pull-request-ui";

type Tab = "overview" | "conversation" | "files" | "checks";
interface Props {
  projectId: string;
  remoteName: string;
  prNumber: number;
  onReviewOpened(sessionId: string): void;
  onWorkspaceChanged(): void;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const requestKey = (projectId: string, remoteName: string, prNumber: number) =>
  `${projectId}:${remoteName}:${prNumber}`;
const lineId = (path: string, side: "old" | "new", line: number) =>
  `pr-line-${encodeURIComponent(path)}-${side}-${line}`;

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ href, children: content }) => (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              if (href) void window.multiCliWork.shell.openExternal(href);
            }}
          >
            {content}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function ErrorBanner({
  children,
  onRetry,
}: {
  children: string;
  onRetry?: () => void;
}) {
  return (
    <div className="action-error" role="alert">
      <TriangleAlert size={14} />
      <span>{children}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          다시 시도
        </button>
      ) : null}
    </div>
  );
}

function DiffRow({
  line,
  path,
  highlighted,
  annotation,
  editor,
  readOnly,
  busy,
  onOpen,
  onEditorBody,
  onSave,
  onCancel,
}: {
  line: DiffLine;
  path: string;
  highlighted: boolean;
  annotation: PullRequestReviewAnnotation | null;
  editor: { body: string } | null;
  readOnly: boolean;
  busy: boolean;
  onOpen(input: PullRequestReviewAnnotationInput): void;
  onEditorBody(body: string): void;
  onSave(): void;
  onCancel(): void;
}) {
  const marker =
    line.kind === "add"
      ? "+"
      : line.kind === "del"
        ? "−"
        : line.kind === "hunk"
          ? "@@"
          : " ";
  const id =
    line.newLine !== null
      ? lineId(path, "new", line.newLine)
      : line.oldLine !== null
        ? lineId(path, "old", line.oldLine)
        : undefined;
  const target =
    line.kind === "del" && line.oldLine !== null
      ? { side: "LEFT" as const, line: line.oldLine }
      : (line.kind === "add" || line.kind === "context") &&
          line.newLine !== null
        ? { side: "RIGHT" as const, line: line.newLine }
        : null;
  const lineText =
    line.kind === "add" || line.kind === "del" || line.kind === "context"
      ? line.text.slice(1)
      : line.text;
  return (
    <>
      <div
        id={id}
        className={`pr-diff-line ${line.kind}${highlighted ? " highlighted" : ""}${annotation ? " annotated" : ""}`}
      >
        <span className="pr-diff-gutter">{line.oldLine ?? ""}</span>
        <span className="pr-diff-gutter">{line.newLine ?? ""}</span>
        <span className="pr-diff-marker">{marker}</span>
        <span className="pr-annotation-gutter">
          {target ? (
            <button
              type="button"
              disabled={readOnly}
              aria-label={`${path} ${target.side} ${target.line}줄 line note ${annotation ? "편집" : "추가"}`}
              title={
                readOnly
                  ? "이전 head의 notes는 읽기 전용입니다"
                  : "Line note 추가"
              }
              onClick={() =>
                onOpen({
                  ...(annotation ? { id: annotation.id } : {}),
                  headSha: annotation?.headSha ?? "",
                  path,
                  side: target.side,
                  line: target.line,
                  lineText,
                  body: annotation?.body ?? "",
                })
              }
            >
              {annotation ? (
                <span aria-hidden="true">●</span>
              ) : (
                <Plus size={12} />
              )}
            </button>
          ) : null}
        </span>
        <code>{lineText}</code>
      </div>
      {editor && target ? (
        <form
          className="pr-inline-note-editor"
          aria-label={`${path} ${target.line}줄 line note 편집`}
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div>
            <strong>
              {path}:{target.line}
            </strong>
            <span>{target.side}</span>
          </div>
          <textarea
            autoFocus
            aria-label="Line note 본문"
            value={editor.body}
            maxLength={4000}
            onChange={(event) => onEditorBody(event.target.value)}
            placeholder="리뷰 agent에게 전달할 수정 요청을 입력하세요"
          />
          <div>
            <button type="button" onClick={onCancel} disabled={busy}>
              취소
            </button>
            <button type="submit" disabled={busy || !editor.body.trim()}>
              {busy ? "저장 중…" : "Draft 저장"}
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

export function PullRequestDetailView({
  projectId,
  remoteName,
  prNumber,
  onReviewOpened,
  onWorkspaceChanged,
}: Props) {
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [diff, setDiff] = useState<PullRequestDiffFile[] | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [detailLoading, setDetailLoading] = useState(true);
  const [diffLoading, setDiffLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewStarting, setReviewStarting] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [posting, setPosting] = useState<Set<string>>(new Set());
  const [activeReview, setActiveReview] =
    useState<ActivePullRequestReview | null>(null);
  const [reviewPrompt, setReviewPrompt] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<PullRequestReviewAnnotation[]>(
    [],
  );
  const [annotationEditor, setAnnotationEditor] =
    useState<PullRequestReviewAnnotationInput | null>(null);
  const [annotationDrawerOpen, setAnnotationDrawerOpen] = useState(false);
  const [annotationBusy, setAnnotationBusy] = useState(false);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(
    () => Number(localStorage.getItem(DIFF_SIDEBAR_STORAGE_KEY)) || 240,
  );
  const [highlightedLine, setHighlightedLine] = useState<string | null>(null);
  const [pendingLine, setPendingLine] = useState<{
    path: string;
    side: "old" | "new";
    line: number | null;
  } | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const postingRef = useRef(new Set<string>());
  const sequence = useRef(0);
  const diffSequence = useRef(0);
  const currentKey = requestKey(projectId, remoteName, prNumber);

  const loadDetail = useCallback(
    async (silent = false) => {
      const key = requestKey(projectId, remoteName, prNumber);
      const request = ++sequence.current;
      if (!silent) setDetailLoading(true);
      setDetailError(null);
      const detailRequest = window.multiCliWork.github
        .detail(projectId, remoteName, prNumber)
        .then((value) => {
          if (
            request === sequence.current &&
            key === requestKey(projectId, remoteName, prNumber)
          )
            setDetail(value);
        })
        .catch((cause) => {
          if (request === sequence.current) setDetailError(message(cause));
        });
      const reviewRequest = window.multiCliWork.github
        .activeReviews()
        .then((reviews) => {
          if (request === sequence.current)
            setActiveReview(
              reviews.find(
                (review) =>
                  review.projectId === projectId &&
                  review.remoteName === remoteName &&
                  review.pullRequestNumber === prNumber,
              ) ?? null,
            );
        })
        .catch((cause) => {
          if (request === sequence.current) setReviewError(message(cause));
        });
      await Promise.all([detailRequest, reviewRequest]);
      if (request === sequence.current) setDetailLoading(false);
    },
    [projectId, remoteName, prNumber],
  );

  const loadDiff = useCallback(
    async (preserveSelection = true) => {
      const request = ++diffSequence.current;
      setDiffLoading(true);
      setDiffError(null);
      try {
        const value = await window.multiCliWork.github.diff(
          projectId,
          remoteName,
          prNumber,
        );
        if (request !== diffSequence.current) return;
        setDiff(value);
        setSelectedPath((current) =>
          preserveSelection &&
          current &&
          value.some((file) => file.path === current)
            ? current
            : (value[0]?.path ?? null),
        );
      } catch (cause) {
        if (request === diffSequence.current) setDiffError(message(cause));
      } finally {
        if (request === diffSequence.current) setDiffLoading(false);
      }
    },
    [projectId, remoteName, prNumber],
  );

  const loadAnnotations = useCallback(async () => {
    try {
      const snapshot = await window.multiCliWork.github.annotations(
        projectId,
        remoteName,
        prNumber,
      );
      setAnnotations(snapshot.annotations);
      setAnnotationError(null);
    } catch (cause) {
      setAnnotationError(message(cause));
    }
  }, [projectId, remoteName, prNumber]);

  useEffect(() => {
    sequence.current += 1;
    diffSequence.current += 1;
    setDetail(null);
    setDiff(null);
    setTab("overview");
    setDetailError(null);
    setDiffError(null);
    setActionError(null);
    setReviewError(null);
    postingRef.current.clear();
    setDraft("");
    setReplyDrafts({});
    setPosting(new Set());
    setActiveReview(null);
    setReviewPrompt(null);
    setAnnotations([]);
    setAnnotationEditor(null);
    setAnnotationDrawerOpen(false);
    setAnnotationError(null);
    setFileSearch("");
    setSelectedPath(null);
    setHighlightedLine(null);
    setPendingLine(null);
    void loadDetail();
    void loadAnnotations();
  }, [currentKey, loadDetail, loadAnnotations]);

  useEffect(() => {
    if (tab === "files" && !diff && !diffLoading) void loadDiff(false);
  }, [tab, diff, diffLoading, loadDiff]);
  useEffect(() => {
    if (tab !== "files") return;
    const clamp = () =>
      setSidebarWidth((width) =>
        clampDiffSidebarWidth(width, splitRef.current?.clientWidth || 1000),
      );
    clamp();
    window.addEventListener("resize", clamp);
    const observer =
      typeof ResizeObserver === "undefined" || !splitRef.current
        ? null
        : new ResizeObserver(clamp);
    observer?.observe(splitRef.current!);
    return () => {
      window.removeEventListener("resize", clamp);
      observer?.disconnect();
    };
  }, [tab]);

  const refresh = async () => {
    await Promise.all([loadDetail(true), loadDiff(true), loadAnnotations()]);
  };
  const startReview = async (agent: "claude" | "codex") => {
    if (reviewStarting) return;
    setReviewStarting(true);
    setReviewError(null);
    try {
      const result = await window.multiCliWork.github.startReview(
        projectId,
        remoteName,
        prNumber,
        agent,
      );
      setActiveReview(result.review);
      setReviewPrompt(result.prompt);
      onWorkspaceChanged();
      onReviewOpened(result.session.id);
    } catch (cause) {
      setReviewError(message(cause));
    } finally {
      setReviewStarting(false);
    }
  };
  const finish = async (
    allowUnverifiedReview = false,
    discardChanges = false,
  ): Promise<void> => {
    if (!activeReview) return;
    try {
      const result = await window.multiCliWork.github.finishReview(
        activeReview.id,
        { allowUnverifiedReview, discardChanges },
      );
      if (
        result.state === "review-unverified" ||
        result.state === "verification-unavailable"
      ) {
        if (window.confirm(`${result.message}\n그래도 정리하시겠습니까?`))
          await finish(true, discardChanges);
        return;
      }
      if (result.state === "dirty") {
        if (
          window.confirm(
            `${result.message}\n변경을 버리고 강제 제거하시겠습니까?`,
          )
        )
          await finish(true, true);
        return;
      }
      const finishedHead = activeReview.headSha;
      setActiveReview(null);
      setAnnotations((current) =>
        current.filter((annotation) => annotation.headSha !== finishedHead),
      );
      onWorkspaceChanged();
    } catch (cause) {
      setReviewError(message(cause));
    }
  };

  const saveAnnotation = async () => {
    if (!annotationEditor || !detail || annotationBusy) return;
    setAnnotationBusy(true);
    setAnnotationError(null);
    try {
      const saved = await window.multiCliWork.github.upsertAnnotation(
        projectId,
        remoteName,
        prNumber,
        {
          ...annotationEditor,
          headSha: detail.headRefOid,
        },
      );
      setAnnotations((current) => [
        ...current.filter((annotation) => annotation.id !== saved.id),
        saved,
      ]);
      setAnnotationEditor(null);
    } catch (cause) {
      setAnnotationError(message(cause));
    } finally {
      setAnnotationBusy(false);
    }
  };

  const deleteAnnotation = async (annotation: PullRequestReviewAnnotation) => {
    if (annotationBusy) return;
    setAnnotationBusy(true);
    setAnnotationError(null);
    try {
      await window.multiCliWork.github.deleteAnnotation(
        projectId,
        remoteName,
        prNumber,
        annotation.id,
      );
      setAnnotations((current) =>
        current.filter((item) => item.id !== annotation.id),
      );
      if (annotationEditor?.id === annotation.id) setAnnotationEditor(null);
    } catch (cause) {
      setAnnotationError(message(cause));
    } finally {
      setAnnotationBusy(false);
    }
  };

  const resendAnnotation = async (annotation: PullRequestReviewAnnotation) => {
    if (annotationBusy) return;
    setAnnotationBusy(true);
    setAnnotationError(null);
    try {
      const saved = await window.multiCliWork.github.upsertAnnotation(
        projectId,
        remoteName,
        prNumber,
        {
          id: annotation.id,
          headSha: annotation.headSha,
          path: annotation.path,
          side: annotation.side,
          line: annotation.line,
          lineText: annotation.lineText,
          body: annotation.body,
        },
      );
      setAnnotations((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
    } catch (cause) {
      setAnnotationError(message(cause));
    } finally {
      setAnnotationBusy(false);
    }
  };

  const sendDraftAnnotations = async () => {
    if (annotationBusy) return;
    setAnnotationBusy(true);
    setAnnotationError(null);
    try {
      const result = await window.multiCliWork.github.sendDraftAnnotations(
        projectId,
        remoteName,
        prNumber,
      );
      setAnnotations(result.annotations);
    } catch (cause) {
      setAnnotationError(message(cause));
    } finally {
      setAnnotationBusy(false);
    }
  };

  const parsedFiles = useMemo(
    () =>
      (diff ?? []).map((file) =>
        parseDiffFile(file.path, file.patch, file.truncated),
      ),
    [diff],
  );
  const filteredFiles = useMemo(
    () =>
      parsedFiles.filter((file) =>
        file.path.toLowerCase().includes(fileSearch.trim().toLowerCase()),
      ),
    [parsedFiles, fileSearch],
  );
  useEffect(() => {
    if (
      filteredFiles.length &&
      !filteredFiles.some((file) => file.path === selectedPath)
    )
      setSelectedPath(filteredFiles[0].path);
  }, [filteredFiles, selectedPath]);
  const selectedFile: DiffFileView | null =
    filteredFiles.find((file) => file.path === selectedPath) ?? null;
  const selectedMeta = detail?.files.find((file) => file.path === selectedPath);
  const currentHeadAnnotations = annotations.filter(
    (annotation) => annotation.headSha === detail?.headRefOid,
  );
  const draftAnnotationCount = currentHeadAnnotations.filter(
    (annotation) => annotation.status === "draft",
  ).length;
  const sentAnnotationCount = currentHeadAnnotations.filter(
    (annotation) => annotation.status === "sent",
  ).length;
  const reviewIsStale = Boolean(
    activeReview && detail && activeReview.headSha !== detail.headRefOid,
  );
  const annotationAt = (filePath: string, line: DiffLine) => {
    const side = line.kind === "del" ? "LEFT" : "RIGHT";
    const lineNumber = line.kind === "del" ? line.oldLine : line.newLine;
    if (lineNumber === null || !["add", "del", "context"].includes(line.kind))
      return null;
    return (
      currentHeadAnnotations.find(
        (annotation) =>
          annotation.path === filePath &&
          annotation.side === side &&
          annotation.line === lineNumber,
      ) ?? null
    );
  };
  const selectedIndex = filteredFiles.findIndex(
    (file) => file.path === selectedPath,
  );
  const moveFile = (delta: number) => {
    if (!filteredFiles.length) return;
    setSelectedPath(
      filteredFiles[
        (selectedIndex + delta + filteredFiles.length) % filteredFiles.length
      ].path,
    );
    setHighlightedLine(null);
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        tab !== "files" ||
        !event.altKey ||
        !["ArrowUp", "ArrowDown"].includes(event.key) ||
        target?.matches("input, textarea, select")
      )
        return;
      event.preventDefault();
      moveFile(event.key === "ArrowDown" ? 1 : -1);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  const navigateInline = (
    item: Extract<PullRequestTimelineItem, { kind: "inline" }>,
  ) => {
    setTab("files");
    setFileSearch("");
    setSelectedPath(item.path);
    const value = item.line ?? item.originalLine;
    const side = item.side === "LEFT" ? "old" : "new";
    setPendingLine({ path: item.path, side, line: value });
  };

  useEffect(() => {
    if (!pendingLine || diffLoading || selectedPath !== pendingLine.path)
      return;
    const id =
      pendingLine.line === null
        ? null
        : lineId(pendingLine.path, pendingLine.side, pendingLine.line);
    const target = id ? document.getElementById(id) : null;
    setHighlightedLine(target ? id : null);
    (
      target ?? document.querySelector(".pr-selected-file-header")
    )?.scrollIntoView({ block: "center" });
    setPendingLine(null);
  }, [pendingLine, diffLoading, selectedPath, selectedFile]);

  const submit = async (
    id: string,
    operation: () => Promise<void>,
    clear: () => void,
  ) => {
    if (postingRef.current.has(id)) return;
    postingRef.current.add(id);
    setPosting((current) => new Set(current).add(id));
    setActionError(null);
    try {
      await operation();
      clear();
      await loadDetail(true);
    } catch (cause) {
      setActionError(message(cause));
    } finally {
      postingRef.current.delete(id);
      setPosting((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const timeline = (item: PullRequestTimelineItem) => (
    <article
      key={`${item.kind}-${item.id}`}
      className={`pr-timeline-item ${item.kind}`}
    >
      <header>
        {item.author.login} ·{" "}
        {item.kind === "review" ? (
          item.state
        ) : item.kind === "inline" ? (
          <button
            type="button"
            className="pr-inline-link"
            onClick={() => navigateInline(item)}
          >
            {item.path}:{item.line ?? item.originalLine ?? "?"}
          </button>
        ) : (
          "댓글"
        )}
      </header>
      <Markdown>{item.body}</Markdown>
      {item.kind === "inline" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const body = replyDrafts[item.id]?.trim();
            if (body)
              void submit(
                `reply-${item.id}`,
                () =>
                  window.multiCliWork.github.reply(
                    projectId,
                    remoteName,
                    prNumber,
                    item.id,
                    body,
                  ),
                () =>
                  setReplyDrafts((current) => ({ ...current, [item.id]: "" })),
              );
          }}
        >
          <textarea
            aria-label={`${item.id} 답글`}
            value={replyDrafts[item.id] ?? ""}
            onChange={(event) =>
              setReplyDrafts((current) => ({
                ...current,
                [item.id]: event.target.value,
              }))
            }
          />
          <button type="submit" disabled={posting.has(`reply-${item.id}`)}>
            답글
          </button>
        </form>
      ) : null}
    </article>
  );
  if (detailLoading && !detail)
    return <div className="pr-detail-empty">PR을 불러오는 중…</div>;
  if (!detail)
    return (
      <div className="pr-detail-empty" role="alert">
        {detailError ?? "PR을 열 수 없습니다"}
        <button type="button" onClick={() => void loadDetail()}>
          다시 시도
        </button>
      </div>
    );
  const additions = detail.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = detail.files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <section className="pr-detail" aria-label={`PR #${prNumber} 상세`}>
      <header className="pr-detail-header">
        <div className="pr-heading">
          <span
            className={`pr-state-badge ${detail.isDraft ? "muted" : detail.state.toLowerCase()}`}
          >
            <GitPullRequest size={14} />
            {detail.isDraft ? "Draft" : detail.state}
          </span>
          <h2>
            <small>#{detail.number}</small> {detail.title}
          </h2>
          <span>
            {detail.authorDetail.name || detail.author} ·{" "}
            <code>{detail.baseRefName}</code> ←{" "}
            <code>{detail.headRefName}</code> · {detail.headRefOid.slice(0, 7)}
          </span>
        </div>
        <div className="pr-detail-actions">
          <div className="pr-review-actions">
            {activeReview ? (
              <>
                <button
                  type="button"
                  onClick={() => onReviewOpened(activeReview.sessionId)}
                >
                  진행 중 리뷰 열기
                </button>
                {!activeReview.promptDelivered ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void window.multiCliWork.github
                          .refillReview(activeReview.id)
                          .then(setReviewPrompt)
                          .catch((cause) => setReviewError(message(cause)))
                      }
                    >
                      프롬프트 다시 채우기
                    </button>
                    {reviewPrompt ? (
                      <button
                        type="button"
                        onClick={() =>
                          void window.multiCliWork.clipboard.writeText(
                            reviewPrompt,
                          )
                        }
                      >
                        프롬프트 복사
                      </button>
                    ) : null}
                  </>
                ) : null}
                <button type="button" onClick={() => void finish()}>
                  리뷰 완료
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={reviewStarting}
                  onClick={() => void startReview("claude")}
                >
                  {reviewStarting ? "리뷰 시작 중…" : "Claude Code 리뷰"}
                </button>
                <button
                  type="button"
                  disabled={reviewStarting}
                  onClick={() => void startReview("codex")}
                >
                  Codex 리뷰
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            aria-label="웹에서 열기"
            onClick={() =>
              void window.multiCliWork.shell.openExternal(detail.url)
            }
          >
            <ExternalLink size={14} />
          </button>
          <button
            type="button"
            aria-label="PR 새로고침"
            onClick={() => void refresh()}
          >
            <RefreshCw
              size={14}
              className={detailLoading || diffLoading ? "spin" : undefined}
            />
          </button>
        </div>
      </header>
      {detailError ? (
        <ErrorBanner onRetry={() => void loadDetail(true)}>
          {detailError}
        </ErrorBanner>
      ) : null}
      {reviewError ? <ErrorBanner>{reviewError}</ErrorBanner> : null}
      {annotationError ? <ErrorBanner>{annotationError}</ErrorBanner> : null}
      {actionError ? <ErrorBanner>{actionError}</ErrorBanner> : null}
      {reviewIsStale ? (
        <div className="pr-stale-review-banner" role="status">
          <TriangleAlert size={14} /> PR HEAD가 변경되었습니다. 이전 review와
          notes는 읽기 전용입니다. 기존 리뷰를 완료한 뒤 새 head 리뷰를
          시작하세요.
        </div>
      ) : null}
      <nav className="pr-detail-tabs" role="tablist">
        {(["overview", "conversation", "files", "checks"] as Tab[]).map(
          (value) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === value}
              key={value}
              onClick={() => setTab(value)}
            >
              {
                {
                  overview: "개요",
                  conversation: "대화·리뷰",
                  files: `변경 파일 (${detail.files.length})`,
                  checks: `체크 (${detail.checks.length})`,
                }[value]
              }
            </button>
          ),
        )}
      </nav>
      {tab === "overview" ? (
        <div className="pr-detail-body">
          <div className="pr-summary-grid">
            <div>
              <strong className="add">+{additions}</strong>
              <span>추가</span>
            </div>
            <div>
              <strong className="del">−{deletions}</strong>
              <span>삭제</span>
            </div>
            <div>
              <strong>{detail.files.length}</strong>
              <span>파일</span>
            </div>
            <div>
              <strong>{detail.commits.length}</strong>
              <span>커밋</span>
            </div>
            <div>
              <strong>{detail.reviewDecision || "없음"}</strong>
              <span>리뷰</span>
            </div>
            <div>
              <strong>{detail.checksState}</strong>
              <span>체크</span>
            </div>
          </div>
          <div className="pr-labels">
            {detail.labels.map((label) => (
              <span key={label.name} style={labelStyle(label.color)}>
                {label.name}
              </span>
            ))}
          </div>
          <section className="pr-card">
            <header>
              <MessageSquare size={15} />
              본문
            </header>
            <div className="file-viewer-markdown">
              <Markdown>{detail.body || "본문이 없습니다."}</Markdown>
            </div>
          </section>
          <section className="pr-card">
            <header>
              <GitCommit size={15} />
              커밋
            </header>
            {detail.commits.length ? (
              detail.commits.map((commit) => (
                <div className="pr-commit" key={commit.oid}>
                  <code>{commit.oid.slice(0, 7)}</code> {commit.message}
                </div>
              ))
            ) : (
              <div className="pr-detail-empty">커밋이 없습니다</div>
            )}
          </section>
        </div>
      ) : tab === "conversation" ? (
        <div className="pr-detail-body">
          <form
            className="pr-comment-form"
            onSubmit={(event) => {
              event.preventDefault();
              const body = draft.trim();
              if (body)
                void submit(
                  "comment",
                  () =>
                    window.multiCliWork.github.comment(
                      projectId,
                      remoteName,
                      prNumber,
                      body,
                    ),
                  () => setDraft(""),
                );
            }}
          >
            <textarea
              aria-label="새 PR 댓글"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="댓글 추가"
            />
            <button type="submit" disabled={posting.has("comment")}>
              댓글 게시
            </button>
          </form>
          {detail.timeline.length ? (
            detail.timeline.map(timeline)
          ) : (
            <div className="pr-detail-empty">대화나 리뷰가 없습니다</div>
          )}
        </div>
      ) : tab === "checks" ? (
        <div className="pr-detail-body">
          {detail.checks.length ? (
            detail.checks.map((check) => {
              const failed =
                check.conclusion &&
                !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(check.conclusion);
              const icon = failed ? (
                <XCircle />
              ) : check.conclusion ? (
                <CheckCircle2 />
              ) : (
                <CircleDot />
              );
              return (
                <button
                  type="button"
                  className={`pr-check ${failed ? "failure" : check.conclusion ? "success" : "pending"}`}
                  key={`${check.name}-${check.detailsUrl}`}
                  disabled={!check.detailsUrl}
                  onClick={() =>
                    check.detailsUrl &&
                    void window.multiCliWork.shell.openExternal(
                      check.detailsUrl,
                    )
                  }
                >
                  {icon}
                  <strong>{check.name}</strong>
                  <span>
                    {check.state} · {check.conclusion ?? "진행 중"}
                  </span>
                  {check.detailsUrl ? <ExternalLink size={13} /> : null}
                </button>
              );
            })
          ) : (
            <div className="pr-detail-empty">
              <ShieldCheck size={24} />
              보고된 체크가 없습니다
            </div>
          )}
        </div>
      ) : (
        <div
          className="pr-files-split"
          ref={splitRef}
          style={
            {
              "--pr-file-list-width": `${sidebarWidth}px`,
            } as React.CSSProperties
          }
        >
          <aside className="pr-file-list">
            <label className="pr-file-search">
              <Search size={13} />
              <input
                aria-label="변경 파일 검색"
                value={fileSearch}
                onChange={(event) => setFileSearch(event.target.value)}
                placeholder="파일 경로 검색"
              />
            </label>
            <div>
              {filteredFiles.map((file) => {
                const meta = detail.files.find(
                  (item) => item.path === file.path,
                );
                return (
                  <button
                    type="button"
                    key={file.path}
                    className={file.path === selectedPath ? "active" : ""}
                    onClick={() => {
                      setSelectedPath(file.path);
                      setHighlightedLine(null);
                    }}
                  >
                    <span>
                      <FileDiff size={13} />
                      <strong>{file.path}</strong>
                    </span>
                    <small>
                      {meta?.changeType ?? file.changeType}{" "}
                      <b className="add">+{meta?.additions ?? 0}</b>{" "}
                      <b className="del">−{meta?.deletions ?? 0}</b>
                    </small>
                  </button>
                );
              })}
              {!diffLoading && !diffError && filteredFiles.length === 0 ? (
                <div className="pr-detail-empty">검색 결과가 없습니다</div>
              ) : null}
            </div>
          </aside>
          <div
            className="pr-file-separator"
            role="separator"
            tabIndex={0}
            aria-label="변경 파일 목록 너비 조절"
            aria-valuemin={180}
            aria-valuemax={360}
            aria-valuenow={sidebarWidth}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              const width = clampDiffSidebarWidth(
                sidebarWidth + (event.key === "ArrowRight" ? 10 : -10),
                splitRef.current?.clientWidth ?? 1000,
              );
              setSidebarWidth(width);
              localStorage.setItem(DIFF_SIDEBAR_STORAGE_KEY, String(width));
            }}
            onPointerDown={(event) => {
              const startX = event.clientX;
              const startWidth = sidebarWidth;
              const move = (next: PointerEvent) =>
                setSidebarWidth(
                  clampDiffSidebarWidth(
                    startWidth + next.clientX - startX,
                    splitRef.current?.clientWidth ?? 1000,
                  ),
                );
              const up = (next: PointerEvent) => {
                const width = clampDiffSidebarWidth(
                  startWidth + next.clientX - startX,
                  splitRef.current?.clientWidth ?? 1000,
                );
                setSidebarWidth(width);
                localStorage.setItem(DIFF_SIDEBAR_STORAGE_KEY, String(width));
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          />
          <main className="pr-selected-diff">
            <div className="pr-selected-diff-scroll">
              {diffError ? (
                <ErrorBanner onRetry={() => void loadDiff(true)}>
                  {diffError}
                </ErrorBanner>
              ) : diffLoading && !selectedFile ? (
                <div className="pr-detail-empty">diff 불러오는 중…</div>
              ) : selectedFile ? (
                <>
                  <header className="pr-selected-file-header">
                    <div>
                      <strong>{selectedFile.path}</strong>
                      <span>
                        {selectedMeta?.changeType ?? selectedFile.changeType} ·{" "}
                        <b className="add">+{selectedMeta?.additions ?? 0}</b>{" "}
                        <b className="del">−{selectedMeta?.deletions ?? 0}</b>
                        {selectedFile.truncated ? " · diff 잘림" : ""}
                      </span>
                    </div>
                    <nav>
                      <button
                        type="button"
                        onClick={() => moveFile(-1)}
                        disabled={filteredFiles.length < 2}
                        aria-label="이전 파일"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveFile(1)}
                        disabled={filteredFiles.length < 2}
                        aria-label="다음 파일"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </nav>
                  </header>
                  {selectedFile.binary ? (
                    <div className="pr-detail-empty">
                      바이너리 파일은 diff를 표시할 수 없습니다
                    </div>
                  ) : selectedFile.lines.length ? (
                    <div className="pr-unified-diff">
                      {selectedFile.lines.map((line) => (
                        <DiffRow
                          key={line.id}
                          line={line}
                          path={selectedFile.path}
                          highlighted={Boolean(
                            highlightedLine &&
                              (line.newLine !== null
                                ? lineId(selectedFile.path, "new", line.newLine)
                                : line.oldLine !== null
                                  ? lineId(
                                      selectedFile.path,
                                      "old",
                                      line.oldLine,
                                    )
                                  : "") === highlightedLine,
                          )}
                          annotation={annotationAt(selectedFile.path, line)}
                          editor={
                            annotationEditor &&
                            annotationEditor.path === selectedFile.path &&
                            annotationEditor.side ===
                              (line.kind === "del" ? "LEFT" : "RIGHT") &&
                            annotationEditor.line ===
                              (line.kind === "del"
                                ? line.oldLine
                                : line.newLine)
                              ? annotationEditor
                              : null
                          }
                          readOnly={false}
                          busy={annotationBusy}
                          onOpen={(input) =>
                            setAnnotationEditor({
                              ...input,
                              headSha: detail.headRefOid,
                            })
                          }
                          onEditorBody={(body) =>
                            setAnnotationEditor((current) =>
                              current ? { ...current, body } : current,
                            )
                          }
                          onSave={() => void saveAnnotation()}
                          onCancel={() => setAnnotationEditor(null)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="pr-detail-empty">
                      표시할 텍스트 diff가 없습니다
                    </div>
                  )}
                  {selectedFile.truncated ? (
                    <div className="pr-diff-notice">
                      <TriangleAlert size={14} />
                      크기 제한으로 diff 일부만 표시됩니다
                    </div>
                  ) : null}
                  {selectedFile.noNewline ? (
                    <div className="pr-diff-notice">
                      파일 끝에 줄바꿈이 없습니다
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="pr-detail-empty">변경 파일이 없습니다</div>
              )}
            </div>
            <div
              className="pr-annotation-sticky"
              role="region"
              aria-label="PR line notes"
            >
              <button
                type="button"
                aria-expanded={annotationDrawerOpen}
                aria-controls="pr-annotation-drawer"
                onClick={() => setAnnotationDrawerOpen((open) => !open)}
              >
                <History size={14} /> 이력 {annotations.length}
              </button>
              <span>
                <b>Draft {draftAnnotationCount}</b>
                <b>Sent {sentAnnotationCount}</b>
              </span>
              <small>
                {!activeReview
                  ? "리뷰 먼저 시작하면 Draft를 agent에 전송할 수 있습니다."
                  : reviewIsStale
                    ? "기존 리뷰를 완료한 뒤 새 head 리뷰를 시작하세요."
                    : "GitHub에는 게시하지 않고 review PTY로만 전송합니다."}
              </small>
              <button
                type="button"
                className="primary"
                disabled={
                  annotationBusy ||
                  draftAnnotationCount === 0 ||
                  !activeReview ||
                  reviewIsStale
                }
                onClick={() => void sendDraftAnnotations()}
              >
                <Send size={14} /> {annotationBusy ? "처리 중…" : "Draft 전송"}
              </button>
            </div>
            {annotationDrawerOpen ? (
              <aside
                id="pr-annotation-drawer"
                className="pr-annotation-drawer"
                role="dialog"
                aria-label="PR line notes 이력"
              >
                <header>
                  <div>
                    <History size={15} />
                    <strong>Line notes 이력</strong>
                  </div>
                  <button
                    type="button"
                    aria-label="Line notes 이력 닫기"
                    onClick={() => setAnnotationDrawerOpen(false)}
                  >
                    <X size={15} />
                  </button>
                </header>
                <div>
                  {annotations.length ? (
                    annotations.map((annotation) => {
                      const stale = annotation.headSha !== detail.headRefOid;
                      return (
                        <article
                          key={annotation.id}
                          className={stale ? "stale" : ""}
                        >
                          <header>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPath(annotation.path);
                                setPendingLine({
                                  path: annotation.path,
                                  side:
                                    annotation.side === "LEFT" ? "old" : "new",
                                  line: annotation.line,
                                });
                                setAnnotationDrawerOpen(false);
                              }}
                            >
                              {annotation.path}:{annotation.line}
                            </button>
                            <span className={annotation.status}>
                              {annotation.status === "draft" ? "Draft" : "Sent"}
                            </span>
                            <code>{annotation.headSha.slice(0, 7)}</code>
                          </header>
                          <pre>{annotation.lineText || "(빈 줄)"}</pre>
                          <p>{annotation.body}</p>
                          {stale ? (
                            <small>이전 head · 읽기 전용</small>
                          ) : (
                            <footer>
                              {annotation.status === "sent" ? (
                                <button
                                  type="button"
                                  disabled={annotationBusy}
                                  onClick={() =>
                                    void resendAnnotation(annotation)
                                  }
                                >
                                  <RotateCcw size={13} /> 재전송
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={annotationBusy}
                                onClick={() =>
                                  void deleteAnnotation(annotation)
                                }
                              >
                                <Trash2 size={13} /> 삭제
                              </button>
                            </footer>
                          )}
                        </article>
                      );
                    })
                  ) : (
                    <div className="pr-detail-empty">
                      저장된 line note가 없습니다.
                    </div>
                  )}
                </div>
              </aside>
            ) : null}
          </main>
        </div>
      )}
    </section>
  );
}
