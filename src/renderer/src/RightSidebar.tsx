import type { GitChangeEntry } from "@shared/api-types";
import type { FileExplorerTarget, FileTreeEntry } from "@shared/file-explorer-types";
import type { PullRequestListItem } from "@shared/github-types";
import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { SessionPreset } from "@shared/preset-types";
import { Files, GitBranch, MessagesSquare, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState, type ReactElement } from "react";
import { FileExplorer } from "./FileExplorer";
import { GitPanel, type GitWorktreeOption } from "./GitPanel";
import { TeamBoard } from "./TeamBoard";

export type RightSidebarTab = "files" | "git" | "board";

export interface RightSidebarProps {
  collapsed: boolean;
  onToggleCollapse(): void;
  activeTab: RightSidebarTab;
  onSelectTab(tab: RightSidebarTab): void;
  target: FileExplorerTarget | null;
  targetLabel: string | null;
  /** Passed to the file tree only — the git tab explains a missing folder on its own. */
  explorerUnavailableReason?: string | null;
  selectedRelativePath: string | null;
  vscodeAvailable: boolean;
  onOpenFile(entry: FileTreeEntry): void;
  onOpenFileInApp(entry: FileTreeEntry): void;
  onOpenFileExternal(entry: FileTreeEntry): void;
  onEntryDeleted(relativePath: string, kind: FileTreeEntry["kind"]): void;
  onEntryRenamed(relativePath: string, nextRelativePath: string, kind: FileTreeEntry["kind"]): void;
  worktreeOptions: GitWorktreeOption[];
  onSelectWorktreeOption(worktreeId: string | null): void;
  onOpenDiff(change: GitChangeEntry): void;
  onOpenGraph(): void;
  projectId: string | null;
  selectedPullRequest?: { projectId: string; remoteName: string; prNumber: number } | null;
  onOpenPullRequest(remoteName: string, item: PullRequestListItem): void;
  /** The folder whose team board the board tab shows — the selected folder, not a worktree. */
  boardProjectId: string | null;
  boardProjectLabel: string | null;
  sessions: TerminalSessionView[];
  agents: AgentView[];
  onFocusSession(session: TerminalSessionView): void;
  presets: readonly SessionPreset[];
  onStartPreset(presetId: string): void;
}

const TAB_TITLES: Record<RightSidebarTab, string> = { files: "파일 탐색기", git: "Git", board: "팀 보드" };

export function RightSidebar({
  collapsed,
  onToggleCollapse,
  activeTab,
  onSelectTab,
  target,
  targetLabel,
  explorerUnavailableReason = null,
  selectedRelativePath,
  vscodeAvailable,
  onOpenFile,
  onOpenFileInApp,
  onOpenFileExternal,
  onEntryDeleted,
  onEntryRenamed,
  worktreeOptions,
  onSelectWorktreeOption,
  onOpenDiff,
  onOpenGraph,
  projectId,
  selectedPullRequest,
  onOpenPullRequest,
  boardProjectId,
  boardProjectLabel,
  sessions,
  agents,
  onFocusSession,
  presets,
  onStartPreset,
}: RightSidebarProps) {
  const [boardUnread, setBoardUnread] = useState(0);
  const badge = (tab: RightSidebarTab) =>
    tab === "board" && boardUnread > 0 ? (
      <span className="right-sidebar-badge" aria-label={`새 글 ${boardUnread}개`}>
        {boardUnread > 99 ? "99+" : boardUnread}
      </span>
    ) : null;

  const railTab = (tab: RightSidebarTab, icon: ReactElement) => (
    <button
      type="button"
      className={`icon-button right-sidebar-rail-tab ${activeTab === tab ? "active" : ""}`}
      onClick={() => {
        onSelectTab(tab);
        onToggleCollapse();
      }}
      aria-label={`${TAB_TITLES[tab]} 탭 펼치기`}
      title={TAB_TITLES[tab]}
    >
      {icon}
      {badge(tab)}
    </button>
  );

  const headerTab = (tab: RightSidebarTab, icon: ReactElement, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === tab}
      className={`right-sidebar-tab ${activeTab === tab ? "active" : ""}`}
      onClick={() => onSelectTab(tab)}
      title={TAB_TITLES[tab]}
    >
      {icon}
      <span>{label}</span>
      {badge(tab)}
    </button>
  );

  return (
    <aside className={`file-explorer ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-top-row">
        {collapsed ? null : (
          <div className="right-sidebar-tabs" role="tablist" aria-label="우측 사이드바 탭">
            {headerTab("files", <Files size={14} />, "파일")}
            {headerTab("git", <GitBranch size={14} />, "Git")}
            {headerTab("board", <MessagesSquare size={14} />, "보드")}
          </div>
        )}
        <button
          type="button"
          className="icon-button sidebar-collapse-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "우측 사이드바 펼치기" : "우측 사이드바 접기"}
          title={collapsed ? "우측 사이드바 펼치기" : "우측 사이드바 접기"}
        >
          {collapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>
      </div>

      <div className="right-sidebar-body">
        {collapsed ? (
          <div className="right-sidebar-rail">
            {railTab("files", <Files size={16} />)}
            {railTab("git", <GitBranch size={16} />)}
            {railTab("board", <MessagesSquare size={16} />)}
          </div>
        ) : null}
        {/* Both panels stay mounted while hidden so the file tree's expansion state and the git
            panel's form state survive tab switches and sidebar collapse. */}
        <FileExplorer
          hidden={collapsed || activeTab !== "files"}
          target={target}
          targetLabel={targetLabel}
          unavailableReason={explorerUnavailableReason}
          selectedRelativePath={selectedRelativePath}
          vscodeAvailable={vscodeAvailable}
          onOpenFile={onOpenFile}
          onOpenFileInApp={onOpenFileInApp}
          onOpenFileExternal={onOpenFileExternal}
          onEntryDeleted={onEntryDeleted}
          onEntryRenamed={onEntryRenamed}
        />
        <GitPanel
          hidden={collapsed || activeTab !== "git"}
          target={target}
          targetLabel={targetLabel}
          worktreeOptions={worktreeOptions}
          onSelectWorktreeOption={onSelectWorktreeOption}
          onOpenDiff={onOpenDiff}
          onOpenGraph={onOpenGraph}
          projectId={projectId}
          selectedPullRequest={selectedPullRequest}
          onOpenPullRequest={onOpenPullRequest}
        />
        <TeamBoard
          hidden={collapsed || activeTab !== "board"}
          projectId={boardProjectId}
          projectLabel={boardProjectLabel}
          sessions={sessions}
          agents={agents}
          onFocusSession={onFocusSession}
          onUnreadChange={setBoardUnread}
          presets={presets}
          onStartPreset={onStartPreset}
        />
      </div>
    </aside>
  );
}
