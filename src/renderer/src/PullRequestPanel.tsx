import type { GitHubRemote, PullRequestListItem, PullRequestStateFilter } from "@shared/github-types";
import { RefreshCw, Search, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

interface Props { hidden: boolean; projectId: string | null; onOpen(remoteName: string, item: PullRequestListItem): void; }
interface Preferences { remote?: string; state?: PullRequestStateFilter; reviewRequested?: boolean; search?: string; }
const keyFor = (projectId: string) => `multi-cli-work.github-pr.v1:${projectId}`;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function PullRequestPanel({ hidden, projectId, onOpen }: Props) {
  const [remotes, setRemotes] = useState<GitHubRemote[]>([]); const [remoteName, setRemoteName] = useState("");
  const [state, setState] = useState<PullRequestStateFilter>("open"); const [reviewRequested, setReviewRequested] = useState(false);
  const [search, setSearch] = useState(""); const [items, setItems] = useState<PullRequestListItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null); const [integration, setIntegration] = useState<string | null>(null);

  useEffect(() => {
    setItems([]); setRemotes([]); setError(null); if (!projectId || hidden) return;
    let preferences: Preferences = {}; try { preferences = JSON.parse(localStorage.getItem(keyFor(projectId)) ?? "{}"); } catch { /* defaults */ }
    setState(preferences.state ?? "open"); setReviewRequested(preferences.reviewRequested ?? false); setSearch(preferences.search ?? "");
    void window.multiCliWork.github.remotes(projectId).then((available) => {
      setRemotes(available); const selected = available.find((remote) => remote.name === preferences.remote)?.name ?? available[0]?.name ?? ""; setRemoteName(selected);
    }).catch((cause) => setError(message(cause)));
  }, [projectId, hidden]);

  const load = async (refresh = false, nextCursor?: number) => {
    if (!projectId || !remoteName) return; setLoading(true); setError(null);
    try {
      const status = await window.multiCliWork.github.status(projectId, remoteName); setIntegration(status.state);
      if (status.state !== "ready") { setError(status.message ?? status.state); return; }
      const page = await window.multiCliWork.github.list(projectId, remoteName, { state, reviewRequested, search, ...(nextCursor !== undefined ? { cursor: nextCursor } : {}), refresh });
      setItems((current) => nextCursor === undefined ? page.items : [...current, ...page.items]); setCursor(page.nextCursor);
      localStorage.setItem(keyFor(projectId), JSON.stringify({ remote: remoteName, state, reviewRequested, search }));
    } catch (cause) { setError(message(cause)); } finally { setLoading(false); }
  };
  useEffect(() => { if (!hidden && projectId && remoteName) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [hidden, projectId, remoteName, state, reviewRequested]);
  useEffect(() => { if (projectId && remoteName) localStorage.setItem(keyFor(projectId), JSON.stringify({ remote: remoteName, state, reviewRequested, search })); }, [projectId, remoteName, state, reviewRequested, search]);
  useEffect(() => { if (hidden || !projectId || !remoteName) return; const focus = () => void load(); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [hidden, projectId, remoteName, state, reviewRequested, search]);
  if (hidden) return null;
  return <div className="pr-panel-body">
    <div className="pr-filter-row">
      <select aria-label="GitHub remote" value={remoteName} onChange={(event) => setRemoteName(event.target.value)}>{remotes.map((remote) => <option key={remote.name} value={remote.name}>{remote.name} · {remote.host}</option>)}</select>
      <select aria-label="PR 상태" value={state} onChange={(event) => setState(event.target.value as PullRequestStateFilter)}><option value="open">Open</option><option value="all">All</option><option value="merged">Merged</option><option value="closed">Closed</option></select>
      <button className="icon-button" type="button" aria-label="PR 새로고침" onClick={() => void load(true)} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : undefined}/></button>
    </div>
    <form className="pr-search" onSubmit={(event) => { event.preventDefault(); void load(true); }}><Search size={13}/><input aria-label="PR 검색" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="PR 검색"/></form>
    <label className="pr-review-filter"><input type="checkbox" checked={reviewRequested} onChange={(event) => setReviewRequested(event.target.checked)}/>내 리뷰 요청</label>
    {error ? <div className="git-error-banner" role="alert"><TriangleAlert size={13}/><span>{error}</span>{integration === "unauthenticated" && projectId ? <button type="button" onClick={() => void window.multiCliWork.github.authenticate(projectId, remoteName)}>로그인</button> : null}</div> : null}
    <div className="pr-list">{items.map((item) => <button type="button" className="pr-row" key={item.number} onClick={() => onOpen(remoteName, item)}>
      <span className="pr-row-meta"><strong>#{item.number}</strong> · {item.isDraft ? "Draft" : item.state} · {item.author}</span><span>{item.title}</span><small>{item.reviewDecision || "리뷰 없음"} · checks {item.checksState} · {new Date(item.updatedAt).toLocaleString()}</small>
    </button>)}{!loading && !error && items.length === 0 ? <div className="sidebar-empty">PR이 없습니다</div> : null}</div>
    {cursor !== null ? <button className="command-button pr-more" type="button" onClick={() => void load(false, cursor)} disabled={loading}>더 보기</button> : null}
  </div>;
}
