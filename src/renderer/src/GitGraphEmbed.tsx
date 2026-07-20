import type { GitCommitDetails, GitGraphCommit } from "@shared/api-types";
import type { FileExplorerTarget } from "@shared/file-explorer-types";
import { computeGitGraphLanes } from "@shared/git-graph-lanes";
import { Check, Copy, FileWarning, GitBranch, GitCommit, MoreHorizontal, RefreshCw, Tag, TriangleAlert, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

export interface GitGraphEmbedProps {
  target: FileExplorerTarget;
  targetLabel: string | null;
}

const PAGE_SIZE = 200;
const LANE_GAP = 16;
const LANE_START = 12;
const LANE_COLORS = ["#4fb7a4", "#d9a441", "#8e75d1", "#d46a6a", "#5f9ed1", "#72b65b"];

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

function GraphCell({ commit, row }: { commit: GitGraphCommit; row: ReturnType<typeof computeGitGraphLanes>[number] }) {
  const width = Math.max(row.lanesBefore.length, row.lanesAfter.length, 1) * LANE_GAP + 10;
  const x = (lane: number) => LANE_START + lane * LANE_GAP;
  return (
    <svg className="native-graph-cell" width={width} height="38" aria-hidden="true">
      {row.lanesBefore.map((hash, index) => {
        if (hash === commit.hash) return null;
        const after = row.lanesAfter.indexOf(hash);
        return after < 0 ? null : <path key={hash} d={`M ${x(index)} 0 L ${x(after)} 38`} stroke={LANE_COLORS[index % LANE_COLORS.length]} />;
      })}
      {commit.parents.map((parent, index) => {
        const parentLane = row.lanesAfter.indexOf(parent);
        return <path key={parent} d={`M ${x(row.lane)} 19 C ${x(row.lane)} 27, ${x(parentLane)} 29, ${x(parentLane)} 38`} stroke={LANE_COLORS[(row.lane + index) % LANE_COLORS.length]} />;
      })}
      {row.lanesBefore.slice(row.lane, row.lane + 1).map(() => <path key="top" d={`M ${x(row.lane)} 0 L ${x(row.lane)} 19`} stroke={LANE_COLORS[row.lane % LANE_COLORS.length]} />)}
      <circle cx={x(row.lane)} cy="19" r="4" fill={LANE_COLORS[row.lane % LANE_COLORS.length]} />
    </svg>
  );
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

export function GitGraphEmbed({ target, targetLabel }: GitGraphEmbedProps) {
  const [commits, setCommits] = useState<GitGraphCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ commit: GitGraphCommit; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const lanes = useMemo(() => computeGitGraphLanes(commits), [commits]);

  const load = async (append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const page = await window.multiCliWork.gitGraph.list(target, { offset: append ? commits.length : 0, limit: PAGE_SIZE });
      setCommits((current) => append ? [...current, ...page.commits] : page.commits);
      setHasMore(page.hasMore);
    } catch (cause) { setError(message(cause)); }
    finally { setLoading(false); setLoadingMore(false); }
  };

  useEffect(() => { setCommits([]); setSelectedHash(null); void load(false); }, [targetKey(target)]);
  useEffect(() => {
    const refresh = () => void load(false);
    window.addEventListener("focus", refresh);
    window.addEventListener("mcw:git-refresh", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("mcw:git-refresh", refresh); };
  });

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

  return <section className="git-graph-embed" aria-label="Git Graph">
    <header className="native-graph-header"><div><GitCommit size={17} /><strong>Git Graph</strong><span title={targetLabel ?? ""}>{targetLabel}</span></div><button type="button" className="icon-button" onClick={() => void load(false)} disabled={loading} aria-label="Git Graph 새로고침"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button></header>
    {error ? <div className="git-error-banner native-graph-error" role="alert"><TriangleAlert size={14} /><span>{error}</span><button type="button" className="icon-button" onClick={() => setError(null)} aria-label="오류 닫기">×</button></div> : null}
    <div className="native-graph-list">
      {loading && commits.length === 0 ? <div className="git-graph-status"><RefreshCw className="spin" size={20} /><p>커밋 불러오는 중…</p></div> : commits.length === 0 ? <div className="git-graph-status"><GitCommit size={20} /><p>아직 커밋이 없습니다</p></div> : commits.map((commit, index) => <div className="native-graph-item" key={commit.hash}>
        <button type="button" className={`native-graph-row ${selectedHash === commit.hash ? "selected" : ""}`} onClick={() => setSelectedHash((current) => current === commit.hash ? null : commit.hash)} onContextMenu={(event) => { event.preventDefault(); setMenu({ commit, x: event.clientX, y: event.clientY }); }}>
          <GraphCell commit={commit} row={lanes[index]} />
          <div className="native-graph-summary"><div className="native-graph-subject">{commit.refs.map((ref) => <span className={`native-graph-ref ref-${ref.kind}`} key={`${ref.kind}:${ref.fullName}`} {...(ref.kind === "local" ? { role: "button", tabIndex: 0, title: `${ref.name} checkout`, onClick: (event: React.MouseEvent) => { event.stopPropagation(); void checkoutRef(ref.name); }, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); void checkoutRef(ref.name); } } } : { title: ref.fullName })}>{ref.kind === "head" ? <Check size={10} /> : ref.kind === "tag" ? <Tag size={10} /> : <GitBranch size={10} />}{ref.name}</span>)}<span>{commit.subject}</span></div><div className="native-graph-meta"><span>{commit.authorName}</span><time title={new Date(commit.authoredAt).toLocaleString()}>{relativeTime(commit.authoredAt)}</time><code>{commit.hash.slice(0, 8)}</code></div></div>
          <span className="native-graph-more" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ commit, x: rect.right, y: rect.bottom }); }}><MoreHorizontal size={16} /></span>
        </button>
        {selectedHash === commit.hash ? <CommitDetails target={target} hash={commit.hash} /> : null}
      </div>)}
      {hasMore ? <button type="button" className="command-button native-graph-load-more" disabled={loadingMore} onClick={() => void load(true)}>{loadingMore ? "불러오는 중…" : "더 불러오기"}</button> : null}
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
