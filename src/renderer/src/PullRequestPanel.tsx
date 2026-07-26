import type { GitHubRemote, PullRequestListItem, PullRequestStateFilter } from "@shared/github-types";
import { CheckCircle2, CircleDot, Clock3, GitMerge, RefreshCw, Search, TriangleAlert, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  hidden: boolean;
  projectId: string | null;
  selected?: { projectId: string; remoteName: string; prNumber: number } | null;
  onOpen(remoteName: string, item: PullRequestListItem): void;
}
interface Preferences { remote?: string; state?: PullRequestStateFilter; reviewRequested?: boolean; search?: string; }
const keyFor = (projectId: string) => `multi-cli-work.github-pr.v1:${projectId}`;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const fingerprint = (projectId: string, remote: string, state: PullRequestStateFilter, reviewRequested: boolean, search: string) => JSON.stringify([projectId, remote, state, reviewRequested, search.trim()]);

function StatusIcon({ item }: { item: PullRequestListItem }) {
  if (item.isDraft) return <CircleDot size={12} aria-label="초안" />;
  if (item.state === "MERGED") return <GitMerge size={12} aria-label="병합됨" />;
  if (item.state === "CLOSED") return <XCircle size={12} aria-label="닫힘" />;
  return <CircleDot size={12} aria-label="열림" />;
}

export function PullRequestPanel({ hidden, projectId, selected, onOpen }: Props) {
  const [remotes, setRemotes] = useState<GitHubRemote[]>([]);
  const [remoteName, setRemoteName] = useState("");
  const [state, setState] = useState<PullRequestStateFilter>("open");
  const [reviewRequested, setReviewRequested] = useState(false);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [items, setItems] = useState<PullRequestListItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [integration, setIntegration] = useState<string | null>(null);
  const sequence = useRef(0);
  const latestFingerprint = useRef("");
  const lastFetchedAt = useRef(0);
  const refreshAfterSearch = useRef(false);

  useEffect(() => {
    sequence.current += 1;
    setItems([]); setCursor(null); setRemotes([]); setRemoteName(""); setError(null);
    if (!projectId || hidden) return;
    let preferences: Preferences = {};
    try { preferences = JSON.parse(localStorage.getItem(keyFor(projectId)) ?? "{}"); } catch { /* defaults */ }
    const nextState = preferences.state ?? "open";
    const nextReviewRequested = preferences.reviewRequested ?? false;
    const nextSearch = preferences.search ?? "";
    setState(nextState); setReviewRequested(nextReviewRequested); setSearch(nextSearch); setAppliedSearch(nextSearch);
    const request = ++sequence.current;
    void window.multiCliWork.github.remotes(projectId).then((available) => {
      if (request !== sequence.current) return;
      setRemotes(available);
      setRemoteName(available.find((remote) => remote.name === preferences.remote)?.name ?? available[0]?.name ?? "");
    }).catch((cause) => { if (request === sequence.current) setError(message(cause)); });
  }, [projectId, hidden]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (options: { refresh?: boolean; cursor?: number; silent?: boolean } = {}) => {
    if (!projectId || !remoteName) return;
    const queryKey = fingerprint(projectId, remoteName, state, reviewRequested, appliedSearch);
    const request = ++sequence.current;
    latestFingerprint.current = queryKey;
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const status = await window.multiCliWork.github.status(projectId, remoteName);
      if (request !== sequence.current || latestFingerprint.current !== queryKey) return;
      setIntegration(status.state);
      if (status.state !== "ready") { setError(status.message ?? status.state); return; }
      const page = await window.multiCliWork.github.list(projectId, remoteName, {
        state, reviewRequested, search: appliedSearch,
        ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
        refresh: options.refresh,
      });
      if (request !== sequence.current || latestFingerprint.current !== queryKey) return;
      setItems((current) => {
        const source = options.cursor === undefined ? page.items : [...current, ...page.items];
        return [...new Map(source.map((item) => [item.number, item])).values()];
      });
      setCursor(page.nextCursor);
      lastFetchedAt.current = Date.now();
    } catch (cause) {
      if (request === sequence.current) setError(message(cause));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [projectId, remoteName, state, reviewRequested, appliedSearch]);

  useEffect(() => {
    if (!hidden && projectId && remoteName) { const refresh = refreshAfterSearch.current; refreshAfterSearch.current = false; setItems([]); setCursor(null); void load({ refresh }); }
  }, [hidden, projectId, remoteName, state, reviewRequested, appliedSearch, load]);

  useEffect(() => {
    if (projectId && remoteName) localStorage.setItem(keyFor(projectId), JSON.stringify({ remote: remoteName, state, reviewRequested, search }));
  }, [projectId, remoteName, state, reviewRequested, search]);

  useEffect(() => {
    if (hidden || !projectId || !remoteName) return;
    const focus = () => { if (Date.now() - lastFetchedAt.current >= 30_000) void load({ silent: true }); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [hidden, projectId, remoteName, load]);

  const flushSearch = () => {
    if (appliedSearch === search) void load({ refresh: true });
    else { refreshAfterSearch.current = true; setAppliedSearch(search); }
  };
  if (hidden) return null;
  return <div className="pr-panel-body">
    <div className="pr-filter-row">
      <select aria-label="GitHub remote" value={remoteName} onChange={(event) => setRemoteName(event.target.value)}>{remotes.map((remote) => <option key={remote.name} value={remote.name}>{remote.name} · {remote.host}</option>)}</select>
      <select aria-label="PR 상태" value={state} onChange={(event) => setState(event.target.value as PullRequestStateFilter)}><option value="open">Open</option><option value="all">All</option><option value="merged">Merged</option><option value="closed">Closed</option></select>
      <button className="icon-button" type="button" aria-label="PR 새로고침" onClick={flushSearch} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : undefined}/></button>
    </div>
    <form className="pr-search" onSubmit={(event) => { event.preventDefault(); flushSearch(); }}><Search size={13}/><input aria-label="PR 검색" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="PR 검색"/></form>
    <label className="pr-review-filter"><input type="checkbox" checked={reviewRequested} onChange={(event) => setReviewRequested(event.target.checked)}/>내 리뷰 요청</label>
    {error ? <div className="git-error-banner" role="alert"><TriangleAlert size={13}/><span>{error}</span>{integration === "unauthenticated" && projectId ? <button type="button" onClick={() => void window.multiCliWork.github.authenticate(projectId, remoteName)}>로그인</button> : null}</div> : null}
    <div className="pr-list">{items.map((item) => {
      const active = selected?.projectId === projectId && selected.remoteName === remoteName && selected.prNumber === item.number;
      const stateTone = item.isDraft ? "muted" : item.state.toLowerCase();
      const reviewTone = item.reviewDecision === "APPROVED" ? "success" : item.reviewDecision === "CHANGES_REQUESTED" ? "failure" : "pending";
      return <button type="button" className={`pr-row${active ? " active" : ""}`} aria-current={active ? "page" : undefined} key={item.number} onClick={() => onOpen(remoteName, item)}>
        <span className="pr-row-title"><StatusIcon item={item}/><strong>#{item.number}</strong><span>{item.title}</span></span>
        <span className="pr-badges"><span className={`pr-badge ${stateTone}`}>{item.isDraft ? "Draft" : item.state}</span><span className={`pr-badge ${reviewTone}`}>{item.reviewDecision || "리뷰 없음"}</span><span className={`pr-badge ${item.checksState}`}>{item.checksState === "success" ? <CheckCircle2 size={11}/> : item.checksState === "failure" ? <XCircle size={11}/> : <Clock3 size={11}/>}checks {item.checksState}</span></span>
        <small>{item.author} · {new Date(item.updatedAt).toLocaleString()}</small>
      </button>;
    })}{!loading && !error && items.length === 0 ? <div className="sidebar-empty">조건에 맞는 PR이 없습니다</div> : null}</div>
    {cursor !== null ? <button className="command-button pr-more" type="button" onClick={() => void load({ cursor })} disabled={loading}>더 보기</button> : null}
  </div>;
}
