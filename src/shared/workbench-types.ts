export interface PromptEntry {
  id: string;
  name: string;
  text: string;
  tags: string[];
  favorite: boolean;
  agentId: string | null;
}
export interface WorkbenchState {
  launchProfiles?: import("./launch-profile").LaunchProfile[];
  defaultLaunchProfiles?: Partial<Record<"claude" | "codex", string>>;
  savedViews?: SavedViewPreset[];
  schemaVersion: 1;
  prompts: PromptEntry[];
  drafts: Record<string, string>;
  forks?: Record<string, string>;
  pinnedPaneIds?: string[];
}
export interface SavedViewPreset {
  id: string;
  name: string;
  layoutId: string;
  sidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  rightSidebarTab: "files" | "git" | "records";
}
export interface WorkbenchSnapshot {
  state: WorkbenchState;
  writable: boolean;
  warning?: string;
}
