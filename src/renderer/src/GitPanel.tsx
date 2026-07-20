import type { GitChangeEntry, GitPanelData } from "@shared/api-types";
import type { FileExplorerTarget } from "@shared/file-explorer-types";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CloudUpload,
  FolderGit2,
  GitBranch,
  GitGraph,
  Plus,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface GitWorktreeOption {
  /** null selects the project's main repository. */
  worktreeId: string | null;
  label: string;
}

export interface GitPanelProps {
  /** True while another right-sidebar tab is active or the sidebar is collapsed to its rail. */
  hidden: boolean;
  target: FileExplorerTarget | null;
  targetLabel: string | null;
  worktreeOptions: GitWorktreeOption[];
  onSelectWorktreeOption(worktreeId: string | null): void;
  onOpenDiff(change: GitChangeEntry): void;
  onOpenGraph(): void;
}

/** How often the panel re-reads git while it is the visible tab. */
const POLL_INTERVAL_MS = 10_000;

function targetKey(target: FileExplorerTarget | null): string {
  return target ? `${target.kind}:${target.id}` : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Same dismissal contract as WorkspaceHeader's menus: any press outside the anchor closes. */
function useDismissable(onDismiss: () => void) {
  const anchor = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!anchor.current?.contains(event.target as Node)) onDismiss();
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [onDismiss]);
  return anchor;
}

const STATUS_TITLES: Record<GitChangeEntry["status"], string> = {
  M: "수정됨",
  A: "추가됨",
  D: "삭제됨",
  R: "이름 변경됨",
  U: "충돌",
  "?": "추적 안 됨",
};

function pathParts(filePath: string): { name: string; parent: string } {
  const normalized = filePath.replace(/\\/g, "/");
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? { name: normalized, parent: "" } : { name: normalized.slice(separator + 1), parent: normalized.slice(0, separator) };
}

function StatusBadge({ status }: { status: GitChangeEntry["status"] }) {
  return (
    <span className={`git-status-badge status-${status === "?" ? "untracked" : status}`} title={STATUS_TITLES[status]}>
      {status}
    </span>
  );
}

export function GitPanel({
  hidden,
  target,
  targetLabel,
  worktreeOptions,
  onSelectWorktreeOption,
  onOpenDiff,
  onOpenGraph,
}: GitPanelProps) {
  const [data, setData] = useState<GitPanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Opt-out set: every change is checked unless the user unticked it, GitHub Desktop style. */
  const [uncheckedPaths, setUncheckedPaths] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [worktreeMenuOpen, setWorktreeMenuOpen] = useState(false);
  const branchAnchor = useDismissable(() => setBranchMenuOpen(false));
  const worktreeAnchor = useDismissable(() => setWorktreeMenuOpen(false));

  const load = (loadTarget: FileExplorerTarget, options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    window.multiCliWork.git
      .panelData(loadTarget)
      .then(setData)
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setLoading(false));
  };

  // A different project/worktree is a different repository — drafts and tick state do not carry.
  useEffect(() => {
    setData(null);
    setError(null);
    setUncheckedPaths(new Set());
    setSummary("");
    setDescription("");
    setBranchMenuOpen(false);
    setWorktreeMenuOpen(false);
    if (target && !hidden) load(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey(target)]);

  useEffect(() => {
    if (target && !hidden && !data) load(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  // The tab re-reads git on a slow tick and whenever the window regains focus, so edits made from
  // terminals or other apps show up without a manual refresh. No file watcher by design.
  useEffect(() => {
    if (hidden || !target) return;
    const tick = () => load(target, { silent: true });
    const interval = window.setInterval(tick, POLL_INTERVAL_MS);
    window.addEventListener("focus", tick);
    window.addEventListener("mcw:git-refresh", tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
      window.removeEventListener("mcw:git-refresh", tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, targetKey(target)]);

  if (hidden) return null;

  const run = (operation: () => Promise<void>) => {
    if (!target) return;
    setBusy(true);
    setError(null);
    operation()
      .then(() => {
        if (target) load(target, { silent: true });
      })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => {
        setBusy(false);
        window.dispatchEvent(new Event("mcw:git-refresh"));
      });
  };

  const changes = data?.isRepo ? data.changes : [];
  const checkedPaths = changes.filter((change) => !uncheckedPaths.has(change.path)).map((change) => change.path);
  const allChecked = changes.length > 0 && checkedPaths.length === changes.length;
  const currentWorktreeId = target?.kind === "worktree" ? target.id : null;
  const currentWorktreeLabel =
    worktreeOptions.find((option) => option.worktreeId === currentWorktreeId)?.label ?? "메인";
  const filteredBranches = data?.isRepo
    ? data.branches.filter((branch) => branch.toLowerCase().includes(branchFilter.trim().toLowerCase()))
    : [];
  const canCommit = !busy && summary.trim().length > 0 && checkedPaths.length > 0;

  const toggleAll = () => {
    setUncheckedPaths(allChecked ? new Set(changes.map((change) => change.path)) : new Set());
  };

  const togglePath = (path: string) => {
    setUncheckedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const checkoutBranch = (branch: string) => {
    setBranchMenuOpen(false);
    setBranchFilter("");
    run(() => window.multiCliWork.git.checkout(target!, branch));
  };

  const createBranch = () => {
    const name = newBranchName.trim();
    if (!name) return;
    setBranchMenuOpen(false);
    setBranchFilter("");
    setNewBranchName("");
    run(() => window.multiCliWork.git.createBranch(target!, name));
  };

  const commit = () => {
    if (!canCommit) return;
    run(async () => {
      await window.multiCliWork.git.commit(target!, {
        summary: summary.trim(),
        description: description.trim(),
        paths: checkedPaths,
      });
      setSummary("");
      setDescription("");
      setUncheckedPaths(new Set());
    });
  };

  return (
    <div className="git-panel">
      <div className="section-heading">
        <span title={targetLabel ?? "Git"}>{targetLabel ?? "Git"}</span>
        <button
          className="icon-button"
          type="button"
          onClick={() => target && load(target)}
          disabled={!target || loading || busy}
          aria-label="Git 상태 새로고침"
          title="Git 상태 새로고침"
        >
          <RefreshCw size={16} className={loading ? "spin" : undefined} />
        </button>
      </div>

      {!target ? (
        <div className="sidebar-empty">
          <span>프로젝트나 워크트리를 선택하면 Git 상태를 볼 수 있습니다</span>
        </div>
      ) : data && !data.isRepo ? (
        <div className="sidebar-empty">
          <span>Git 저장소가 아닙니다</span>
        </div>
      ) : (
        <div className="git-panel-body">
          {error ? (
            <div className="git-error-banner" role="alert">
              <TriangleAlert size={13} />
              <span>{error}</span>
              <button type="button" className="icon-button" onClick={() => setError(null)} aria-label="오류 닫기">
                ×
              </button>
            </div>
          ) : null}

          <div className="git-toolbar">
            <div className="session-menu-anchor git-dropdown-anchor" ref={branchAnchor}>
              <button
                type="button"
                className="git-dropdown-button"
                onClick={() => setBranchMenuOpen((open) => !open)}
                disabled={busy || !data}
                aria-expanded={branchMenuOpen}
                aria-haspopup="menu"
                title="브랜치 전환"
              >
                <GitBranch size={13} />
                <span className="git-dropdown-label">{data?.currentBranch ?? "(detached)"}</span>
                <ChevronDown size={12} />
              </button>
              {branchMenuOpen && data ? (
                <div className="provider-menu git-dropdown-menu" role="menu" aria-label="브랜치 선택">
                  <input
                    type="text"
                    className="git-menu-filter"
                    placeholder="브랜치 검색"
                    value={branchFilter}
                    onChange={(event) => setBranchFilter(event.target.value)}
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  <div className="git-menu-scroll">
                    {filteredBranches.map((branch) => (
                      <button
                        key={branch}
                        type="button"
                        role="menuitem"
                        onClick={() => checkoutBranch(branch)}
                        disabled={branch === data.currentBranch}
                      >
                        {branch === data.currentBranch ? <Check size={13} /> : <GitBranch size={13} />}
                        <span>{branch}</span>
                      </button>
                    ))}
                    {filteredBranches.length === 0 ? <div className="git-menu-empty">일치하는 브랜치 없음</div> : null}
                  </div>
                  <div className="git-menu-create">
                    <input
                      type="text"
                      placeholder="새 브랜치 이름"
                      value={newBranchName}
                      onChange={(event) => setNewBranchName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") createBranch();
                      }}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      onClick={createBranch}
                      disabled={newBranchName.trim().length === 0}
                      aria-label="브랜치 만들기"
                      title="브랜치 만들기"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="git-toolbar-secondary">
              <div className="session-menu-anchor git-dropdown-anchor" ref={worktreeAnchor}>
                <button
                type="button"
                className="git-dropdown-button"
                onClick={() => setWorktreeMenuOpen((open) => !open)}
                disabled={busy || worktreeOptions.length === 0}
                aria-expanded={worktreeMenuOpen}
                aria-haspopup="menu"
                title="워크트리 전환 — 파일 탐색기도 함께 전환됩니다"
              >
                <FolderGit2 size={13} />
                <span className="git-dropdown-label">{currentWorktreeLabel}</span>
                <ChevronDown size={12} />
                </button>
                {worktreeMenuOpen ? (
                  <div className="provider-menu git-dropdown-menu" role="menu" aria-label="워크트리 선택">
                    {worktreeOptions.map((option) => (
                      <button
                      key={option.worktreeId ?? "__main__"}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setWorktreeMenuOpen(false);
                        onSelectWorktreeOption(option.worktreeId);
                      }}
                      disabled={option.worktreeId === currentWorktreeId}
                    >
                      {option.worktreeId === currentWorktreeId ? <Check size={13} /> : <FolderGit2 size={13} />}
                      <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className="icon-button git-graph-button"
                onClick={onOpenGraph}
                disabled={busy || !data?.isRepo}
                aria-label="Git Graph 열기"
                title="Git Graph 열기"
              >
                <GitGraph size={15} />
              </button>
            </div>
          </div>

          <div className="git-sync-row">
            {data?.upstream ? (
              <>
                <span className="git-ahead-behind" title={`업스트림: ${data.upstream}`}>
                  <ArrowUp size={12} />
                  {data.ahead ?? 0}
                  <ArrowDown size={12} />
                  {data.behind ?? 0}
                </span>
                <button type="button" className="command-button" onClick={() => run(() => window.multiCliWork.git.push(target!))} disabled={busy}>
                  Push
                </button>
                <button type="button" className="command-button" onClick={() => run(() => window.multiCliWork.git.fetch(target!))} disabled={busy}>
                  Fetch
                </button>
                <button type="button" className="command-button" onClick={() => run(() => window.multiCliWork.git.pull(target!))} disabled={busy}>
                  Pull
                </button>
              </>
            ) : (
              <button
                type="button"
                className="command-button"
                onClick={() => run(() => window.multiCliWork.git.push(target!))}
                disabled={busy || !data?.currentBranch}
                title="원격에 브랜치를 게시합니다 (push -u origin)"
              >
                <CloudUpload size={13} />
                <span>Publish branch</span>
              </button>
            )}
          </div>

          <div className="git-changes-heading">
            <label className="git-check-all">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={changes.length === 0} />
              <span>변경사항 ({changes.length})</span>
            </label>
          </div>

          <div className="git-changes-list">
            {changes.length === 0 ? (
              <div className="git-menu-empty">커밋할 변경사항이 없습니다</div>
            ) : (
              changes.map((change) => {
                const parts = pathParts(change.path);
                return <div key={change.path} className="git-change-row" title={change.renamedFrom ? `${change.renamedFrom} → ${change.path}` : change.path}>
                  <input
                    type="checkbox"
                    checked={!uncheckedPaths.has(change.path)}
                    onChange={() => togglePath(change.path)}
                    aria-label={`${change.path} 커밋에 포함`}
                  />
                  <button
                    type="button"
                    className="git-change-path"
                    onClick={() => onOpenDiff(change)}
                    title="변경 내용 비교 열기"
                  >
                    <strong>{parts.name}</strong>
                    {parts.parent ? <span>{parts.parent}</span> : null}
                  </button>
                  <StatusBadge status={change.status} />
                </div>;
              })
            )}
          </div>

          <form
            className="git-commit-form"
            onSubmit={(event) => {
              event.preventDefault();
              commit();
            }}
          >
            <input
              type="text"
              placeholder="요약 (필수)"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              disabled={busy}
            />
            <textarea
              placeholder="설명 (선택)"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              disabled={busy}
            />
            <button type="submit" className="command-button git-commit-button" disabled={!canCommit}>
              <Check size={13} />
              <span>
                Commit to <strong>{data?.currentBranch ?? "?"}</strong>
              </span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
