import type { GitChangeEntry } from "@shared/api-types";
import type { FileExplorerTarget, FileTreeEntry } from "@shared/file-explorer-types";
import { Files, GitBranch, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ReactElement } from "react";
import { FileExplorer } from "./FileExplorer";
import { GitPanel, type GitWorktreeOption } from "./GitPanel";

export type RightSidebarTab = "files" | "git";

export interface RightSidebarProps {
  collapsed: boolean;
  onToggleCollapse(): void;
  activeTab: RightSidebarTab;
  onSelectTab(tab: RightSidebarTab): void;
  target: FileExplorerTarget | null;
  targetLabel: string | null;
  selectedRelativePath: string | null;
  onOpenFile(entry: FileTreeEntry): void;
  worktreeOptions: GitWorktreeOption[];
  onSelectWorktreeOption(worktreeId: string | null): void;
  onOpenDiff(change: GitChangeEntry): void;
  onOpenGraph(): void;
}

const TAB_TITLES: Record<RightSidebarTab, string> = { files: "파일 탐색기", git: "Git" };

export function RightSidebar({
  collapsed,
  onToggleCollapse,
  activeTab,
  onSelectTab,
  target,
  targetLabel,
  selectedRelativePath,
  onOpenFile,
  worktreeOptions,
  onSelectWorktreeOption,
  onOpenDiff,
  onOpenGraph,
}: RightSidebarProps) {
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
    </button>
  );

  return (
    <aside className={`file-explorer ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-top-row">
        {collapsed ? null : (
          <div className="right-sidebar-tabs" role="tablist" aria-label="우측 사이드바 탭">
            {headerTab("files", <Files size={14} />, "파일")}
            {headerTab("git", <GitBranch size={14} />, "Git")}
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
          </div>
        ) : null}
        {/* Both panels stay mounted while hidden so the file tree's expansion state and the git
            panel's form state survive tab switches and sidebar collapse. */}
        <FileExplorer
          hidden={collapsed || activeTab !== "files"}
          target={target}
          targetLabel={targetLabel}
          selectedRelativePath={selectedRelativePath}
          onOpenFile={onOpenFile}
        />
        <GitPanel
          hidden={collapsed || activeTab !== "git"}
          target={target}
          targetLabel={targetLabel}
          worktreeOptions={worktreeOptions}
          onSelectWorktreeOption={onSelectWorktreeOption}
          onOpenDiff={onOpenDiff}
          onOpenGraph={onOpenGraph}
        />
      </div>
    </aside>
  );
}
