import type { GitCommitDetails, GitGraphCommit } from "@shared/api-types";
import type { FileExplorerTarget } from "@shared/file-explorer-types";
import { layoutGitGraph } from "@shared/git-graph-layout";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  GitBranch,
  GitCommit,
  MoreHorizontal,
  RefreshCw,
  Search,
  Tag,
  TriangleAlert,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitGraphSvg, gutterWidth, ROW_HEIGHT } from "./GitGraphSvg";

export interface GitGraphEmbedProps {
  target: FileExplorerTarget;
  targetLabel: string | null;
}

const PAGE_SIZE = 200;
const OVERSCAN = 8;
/** How close to the bottom the scroller gets before the next page is pulled. */
const LOAD_MORE_MARGIN = 300;
/** Stands in for the real viewport before it is measured, so the first paint is not blank. */
const ASSUMED_VIEWPORT = 800;

function targetKey(target: FileExplorerTarget) {
  return `${target.kind}:${target.id}`;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function relativeTime(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31_536_000], ["month", 2_592_000], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  return formatter.format(seconds, "second");
}

const GitCommitDiff = lazy(() => import("./GitCommitDiff").then((module) => ({ default: module.GitCommitDiff })));

function CommitDetails({ target, hash }: { target: FileExplorerTarget; hash: string }) {
  const [details, setDetails] = useState<GitCommitDetails | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setDetails(null); setSelectedFile(null); setError(null);
    window.multiCliWork.gitGraph.commitDetails(target, hash).then((value) => !cancelled && setDetails(value), (cause) => !cancelled && setError(message(cause)));
    return () => { cancelled = true; };
  }, [targetKey(target), hash]);
  if (error) return <div className="native-graph-details native-graph-inline-state"><TriangleAlert size={14} />{error}</div>;
  if (!details) return <div className="native-graph-details native-graph-inline-state"><RefreshCw className="spin" size={14} />상세 불러오는 중</div>;
  return (
    <section className="native-graph-details" aria-label={`${details.subject} 커밋 상세`}>
      <pre className="native-graph-message">{details.message}</pre>
      <dl>
        <div><dt>작성자</dt><dd>{details.authorName} &lt;{details.authorEmail}&gt; · {new Date(details.authoredAt).toLocaleString()}</dd></div>
        <div><dt>커미터</dt><dd>{details.committerName} &lt;{details.committerEmail}&gt; · {new Date(details.committedAt).toLocaleString()}</dd></div>
        <div><dt>부모</dt><dd>{details.parents.length ? details.parents.join(", ") : "없음 (root commit)"}</dd></div>
      </dl>
      <div className="native-graph-files">
        {details.files.map((file) => <button type="button" key={file.path} className={selectedFile === file.path ? "active" : ""} onClick={() => setSelectedFile((current) => current === file.path ? null : file.path)}><span className={`git-status-badge status-${file.status}`}>{file.status}</span><span>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span></button>)}
      </div>
      {selectedFile ? <Suspense fallback={<div className="native-graph-inline-state"><RefreshCw className="spin" size={14} />diff 불러오는 중</div>}><GitCommitDiff target={target} hash={hash} path={selectedFile} /></Suspense> : null}
    </section>
  );
}

type DialogState = { kind: "branch" | "tag" | "cherry-pick" | "revert"; commit: GitGraphCommit } | null;

function GraphDialog({ state, busy, onClose, onRun }: { state: NonNullable<DialogState>; busy: boolean; onClose(): void; onRun(name?: string, checkout?: boolean): void }) {
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);
  const named = state.kind === "branch" || state.kind === "tag";
  const title = state.kind === "branch" ? "커밋에서 브랜치 만들기" : state.kind === "tag" ? "Lightweight tag 만들기" : state.kind === "cherry-pick" ? "커밋 Cherry-pick" : "커밋 Revert";
  return <div className="modal-backdrop"><form className="native-graph-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={(event) => { event.preventDefault(); onRun(name.trim(), checkout); }}>
    <header><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="대화상자 닫기"><X size={16} /></button></header>
    <p><code>{state.commit.hash.slice(0, 10)}</code> {state.commit.subject}</p>
    {named ? <label>{state.kind === "branch" ? "브랜치 이름" : "태그 이름"}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label> : <p>이 Git 작업을 실행하시겠습니까?</p>}
    {state.kind === "branch" ? <label className="native-graph-check"><input type="checkbox" checked={checkout} onChange={(event) => setCheckout(event.target.checked)} /><span>생성 후 checkout</span></label> : null}
    <footer><button type="button" className="command-button" onClick={onClose}>취소</button><button type="submit" className="command-button" disabled={busy || (named && !name.trim())}>{busy ? "실행 중…" : "확인"}</button></footer>
  </form></div>;
}

function RefBadge({ commit, onCheckout }: { commit: GitGraphCommit; onCheckout(branch: string): void }) {
  return <>{commit.refs.map((ref) => {
    const icon = ref.kind === "head" ? <Check size={10} /> : ref.kind === "tag" ? <Tag size={10} /> : <GitBranch size={10} />;
    // Local branches double as a checkout control; the rest are labels. Either way they are siblings
    // of the row rather than nested inside it, so neither nests one control within another.
    return ref.kind === "local"
      ? <button type="button" className={`native-graph-ref ref-${ref.kind}`} key={`${ref.kind}:${ref.fullName}`} title={`${ref.name} checkout`} onClick={(event) => { event.stopPropagation(); onCheckout(ref.name); }}>{icon}{ref.name}</button>
      : <span className={`native-graph-ref ref-${ref.kind}`} key={`${ref.kind}:${ref.fullName}`} title={ref.fullName}>{icon}{ref.name}</span>;
  })}</>;
}

export function GitGraphEmbed({ target, targetLabel }: GitGraphEmbedProps) {
  const [commits, setCommits] = useState<GitGraphCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncommittedCount, setUncommittedCount] = useState(0);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [detailsHeight, setDetailsHeight] = useState(0);
  const [menu, setMenu] = useState<{ commit: GitGraphCommit; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  /** Bumped by every refresh so a page that is still in flight cannot overwrite the newer list. */
  const generationRef = useRef(0);

  const refresh = useCallback(() => {
    const generation = ++generationRef.current;
    const current = () => generation === generationRef.current;
    setLoading(true);
    setError(null);
    window.multiCliWork.gitGraph
      .list(target, { offset: 0, limit: PAGE_SIZE })
      .then((page) => { if (current()) { setCommits(page.commits); setHasMore(page.hasMore); } })
      .catch((cause) => { if (current()) setError(message(cause)); })
      .finally(() => { if (current()) { setLoading(false); loadingMoreRef.current = false; } });
    // Reuses the git tab's read rather than adding an IPC channel for one number.
    window.multiCliWork.git
      .panelData(target)
      .then((data) => { if (current()) setUncommittedCount(data.isRepo ? data.changes.length : 0); })
      .catch(() => { /* The graph is still usable without the pending-changes row. */ });
  }, [targetKey(target)]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    const generation = generationRef.current;
    const offset = commits.length;
    window.multiCliWork.gitGraph
      .list(target, { offset, limit: PAGE_SIZE })
      .then((page) => {
        if (generation !== generationRef.current) return;
        // Appending only when the list is still the length we asked from makes a duplicated scroll
        // event a no-op rather than a doubled page.
        setCommits((list) => (list.length === offset ? [...list, ...page.commits] : list));
        setHasMore(page.hasMore);
      })
      .catch((cause) => { if (generation === generationRef.current) setError(message(cause)); })
      .finally(() => { loadingMoreRef.current = false; });
  }, [targetKey(target), hasMore, commits.length]);

  useEffect(() => {
    setCommits([]);
    setSelectedHash(null);
    setQuery("");
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("focus", handler);
    window.addEventListener("mcw:git-refresh", handler);
    return () => {
      window.removeEventListener("focus", handler);
      window.removeEventListener("mcw:git-refresh", handler);
    };
  }, [refresh]);

  useEffect(() => {
    const host = scrollRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewportHeight(host.clientHeight));
    observer.observe(host);
    setViewportHeight(host.clientHeight);
    return () => observer.disconnect();
  }, []);

  // The expanded block is measured rather than assumed, because the rows below it and the graph
  // overlay both have to shift by exactly its height.
  useEffect(() => {
    const host = detailsRef.current;
    if (!host) { setDetailsHeight(0); return; }
    if (typeof ResizeObserver === "undefined") { setDetailsHeight(host.offsetHeight); return; }
    const observer = new ResizeObserver(() => setDetailsHeight(host.offsetHeight));
    observer.observe(host);
    setDetailsHeight(host.offsetHeight);
    return () => observer.disconnect();
  }, [selectedHash]);

  const layout = useMemo(() => layoutGitGraph(commits), [commits]);
  const headHash = useMemo(() => commits.find((commit) => commit.refs.some((ref) => ref.kind === "head"))?.hash ?? null, [commits]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const found: number[] = [];
    commits.forEach((commit, index) => {
      if (
        commit.subject.toLowerCase().includes(needle) ||
        commit.authorName.toLowerCase().includes(needle) ||
        commit.hash.startsWith(needle) ||
        commit.refs.some((ref) => ref.name.toLowerCase().includes(needle))
      ) found.push(index);
    });
    return found;
  }, [commits, query]);

  const expandedRow = selectedHash === null ? -1 : commits.findIndex((commit) => commit.hash === selectedHash);
  const pendingOffset = uncommittedCount > 0 ? ROW_HEIGHT : 0;
  const expansion = expandedRow >= 0 ? detailsHeight : 0;
  /** Rows, the expanded block and the graph overlay all derive their Y from this one function. */
  const rowTop = (row: number) => pendingOffset + row * ROW_HEIGHT + (expandedRow >= 0 && row > expandedRow ? detailsHeight : 0);
  const rowY = (row: number) => rowTop(row) + ROW_HEIGHT / 2;
  const contentHeight = pendingOffset + commits.length * ROW_HEIGHT + expansion;

  const rowAt = (y: number) => {
    const local = y - pendingOffset;
    if (expandedRow < 0 || local < (expandedRow + 1) * ROW_HEIGHT + detailsHeight) return Math.floor(local / ROW_HEIGHT);
    return Math.floor((local - detailsHeight) / ROW_HEIGHT);
  };
  const measuredHeight = viewportHeight || ASSUMED_VIEWPORT;
  const first = Math.max(0, rowAt(scrollTop) - OVERSCAN);
  const last = Math.min(commits.length - 1, rowAt(scrollTop + measuredHeight) + OVERSCAN);

  const scrollToRow = (row: number) => {
    const host = scrollRef.current;
    if (!host) return;
    host.scrollTop = Math.max(0, rowTop(row) - (host.clientHeight || ASSUMED_VIEWPORT) / 2);
    setScrollTop(host.scrollTop);
  };

  const gotoMatch = (delta: number) => {
    if (matches.length === 0) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    scrollToRow(matches[next]);
  };

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const host = event.currentTarget;
    setScrollTop(host.scrollTop);
    if (host.scrollHeight - host.scrollTop - host.clientHeight <= LOAD_MORE_MARGIN) loadMore();
  };

  const runAction = async (name?: string, checkout?: boolean) => {
    if (!dialog) return;
    setBusy(true); setError(null);
    try {
      if (dialog.kind === "branch") await window.multiCliWork.gitGraph.createBranch(target, dialog.commit.hash, name ?? "", checkout ?? true);
      else if (dialog.kind === "tag") await window.multiCliWork.gitGraph.createTag(target, dialog.commit.hash, name ?? "");
      else if (dialog.kind === "cherry-pick") await window.multiCliWork.gitGraph.cherryPick(target, dialog.commit.hash);
      else await window.multiCliWork.gitGraph.revert(target, dialog.commit.hash);
      setDialog(null);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); window.dispatchEvent(new Event("mcw:git-refresh")); }
  };

  const checkoutRef = async (branch: string) => {
    setBusy(true); setError(null);
    try { await window.multiCliWork.git.checkout(target, branch); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); window.dispatchEvent(new Event("mcw:git-refresh")); }
  };

  const gutter = gutterWidth(layout.laneCount);
  const activeMatch = matches[matchIndex] ?? -1;

  return <section className="git-graph-embed" aria-label="Git Graph">
    <header className="native-graph-header">
      <div><GitCommit size={17} /><strong>Git Graph</strong><span title={targetLabel ?? ""}>{targetLabel}</span></div>
      <div className="native-graph-find">
        <Search size={13} />
        <input
          type="search"
          value={query}
          placeholder="커밋 검색"
          aria-label="커밋 검색"
          onChange={(event) => { setQuery(event.target.value); setMatchIndex(0); }}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); gotoMatch(event.shiftKey ? -1 : 1); } }}
        />
        {query.trim() ? <span className="native-graph-find-count">{matches.length === 0 ? "결과 없음" : `${matchIndex + 1}/${matches.length}`}</span> : null}
        <button type="button" className="icon-button" onClick={() => gotoMatch(-1)} disabled={matches.length === 0} aria-label="이전 결과"><ChevronUp size={14} /></button>
        <button type="button" className="icon-button" onClick={() => gotoMatch(1)} disabled={matches.length === 0} aria-label="다음 결과"><ChevronDown size={14} /></button>
      </div>
      <button type="button" className="icon-button" onClick={refresh} disabled={loading} aria-label="Git Graph 새로고침"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button>
    </header>

    {error ? <div className="git-error-banner native-graph-error" role="alert"><TriangleAlert size={14} /><span>{error}</span><button type="button" className="icon-button" onClick={() => setError(null)} aria-label="오류 닫기">×</button></div> : null}

    {query.trim() && matches.length > 0 ? <p className="native-graph-find-note">불러온 {commits.length}개 커밋에서 검색합니다. 목록은 그래프가 끊기지 않도록 그대로 둡니다.</p> : null}

    <div className="native-graph-list" ref={scrollRef} onScroll={handleScroll}>
      {loading && commits.length === 0 ? <div className="git-graph-status"><RefreshCw className="spin" size={20} /><p>커밋 불러오는 중…</p></div>
        : commits.length === 0 ? <div className="git-graph-status"><GitCommit size={20} /><p>아직 커밋이 없습니다</p></div>
        : <div className="native-graph-content" style={{ height: contentHeight }}>
          <GitGraphSvg
            layout={layout}
            first={first}
            last={last}
            height={contentHeight}
            rowY={rowY}
            headHash={headHash}
            uncommittedY={uncommittedCount > 0 ? ROW_HEIGHT / 2 : null}
          />

          {uncommittedCount > 0 ? (
            <div className="native-graph-row native-graph-pending" style={{ top: 0, paddingLeft: gutter }}>
              <span className="native-graph-subject">미커밋 변경 {uncommittedCount}건</span>
            </div>
          ) : null}

          {commits.slice(first, last + 1).map((commit, offset) => {
            const index = first + offset;
            const classes = ["native-graph-row"];
            if (commit.hash === selectedHash) classes.push("selected");
            if (matches.includes(index)) classes.push("matched");
            if (index === activeMatch) classes.push("active-match");
            return (
              <div
                key={commit.hash}
                className={classes.join(" ")}
                style={{ top: rowTop(index), paddingLeft: gutter }}
                role="button"
                tabIndex={0}
                aria-expanded={commit.hash === selectedHash}
                onClick={() => setSelectedHash((current) => current === commit.hash ? null : commit.hash)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedHash((current) => current === commit.hash ? null : commit.hash); } }}
                onContextMenu={(event) => { event.preventDefault(); setMenu({ commit, x: event.clientX, y: event.clientY }); }}
              >
                <span className="native-graph-subject"><RefBadge commit={commit} onCheckout={(branch) => void checkoutRef(branch)} /><span>{commit.subject}</span></span>
                <time className="native-graph-date" title={new Date(commit.authoredAt).toLocaleString()}>{relativeTime(commit.authoredAt)}</time>
                <span className="native-graph-author" title={commit.authorName}>{commit.authorName}</span>
                <code className="native-graph-hash">{commit.hash.slice(0, 8)}</code>
                <button
                  type="button"
                  className="icon-button native-graph-more"
                  aria-label={`${commit.subject} 커밋 작업`}
                  onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ commit, x: rect.right, y: rect.bottom }); }}
                ><MoreHorizontal size={15} /></button>
              </div>
            );
          })}

          {expandedRow >= 0 && selectedHash ? (
            <div className="native-graph-details-slot" ref={detailsRef} style={{ top: rowTop(expandedRow) + ROW_HEIGHT }}>
              <CommitDetails target={target} hash={selectedHash} />
            </div>
          ) : null}
        </div>}
    </div>

    {menu ? <div className="provider-menu native-graph-menu" role="menu" aria-label="커밋 작업" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 240) }} onMouseLeave={() => setMenu(null)}>
      <button role="menuitem" type="button" onClick={() => { void window.multiCliWork.clipboard.writeText(menu.commit.hash); setMenu(null); }}><Copy size={13} />해시 복사</button>
      <button role="menuitem" type="button" onClick={() => { setDialog({ kind: "branch", commit: menu.commit }); setMenu(null); }}><GitBranch size={13} />브랜치 만들기</button>
      <button role="menuitem" type="button" onClick={() => { setDialog({ kind: "tag", commit: menu.commit }); setMenu(null); }}><Tag size={13} />태그 만들기</button>
      <button role="menuitem" type="button" disabled={menu.commit.parents.length > 1} title={menu.commit.parents.length > 1 ? "Merge commit은 mainline 선택이 필요합니다" : undefined} onClick={() => { setDialog({ kind: "cherry-pick", commit: menu.commit }); setMenu(null); }}>Cherry-pick</button>
      <button role="menuitem" type="button" disabled={menu.commit.parents.length > 1} title={menu.commit.parents.length > 1 ? "Merge commit은 mainline 선택이 필요합니다" : undefined} onClick={() => { setDialog({ kind: "revert", commit: menu.commit }); setMenu(null); }}>Revert</button>
    </div> : null}
    {dialog ? <GraphDialog state={dialog} busy={busy} onClose={() => setDialog(null)} onRun={(name, checkout) => void runAction(name, checkout)} /> : null}
  </section>;
}
