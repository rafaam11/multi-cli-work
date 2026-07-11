export type ProjectSource = "manual" | "claude" | "codex";
export type ProjectStatus = "진행중" | "보류" | "완료" | "보관";

export interface ProjectTodo {
  id: string;
  text: string;
  done: boolean;
}

export interface ProjectTrack {
  id: string;
  title: string;
  items: ProjectTodo[];
}

export interface SharedProject {
  id: string;
  rootPath: string;
  displayName: string | null;
  sources: ProjectSource[];
  providerRefs: {
    claude: string[];
    codex: string[];
  };
  status: ProjectStatus | null;
  memo: string;
  tracks: ProjectTrack[];
  hidden: boolean;
  order: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRegistryV1 {
  schemaVersion: 1;
  updatedAt: string;
  migratedFromBoardAt?: string;
  projects: Record<string, SharedProject>;
}

export interface ProjectRegistrySnapshot {
  registry: ProjectRegistryV1;
  source: "primary" | "backup" | "empty";
  writable: boolean;
  warning?: string;
}

export interface ProjectDiscovery {
  rootPath: string;
  source: ProjectSource;
  providerRef?: string;
  displayName?: string | null;
}

