import type { ProjectStatus } from "./project-types";
import type { WorkProjectNotionLink, WorkProjectRole } from "./work-project-types";

/**
 * 설정 프로필 — 3대 PC 사이에 손으로 옮기는 스냅샷(기본 위치 `<drive>\_config\multi-cli-work\profile.json`).
 * 계속 동기화하지 않는다: 한 PC에서 내보내고 다른 PC에서 불러올 때만 쓴다.
 *
 * 경로는 PC마다 다르므로 모두 논리 경로(`dev/x`, `drive/R_DOTORI`)로 적는다. 어느 루트에도 속하지
 * 않는 경로(`C:\NeuroPilot\…`)는 절대경로 그대로 적고, 불러오는 PC에 그 폴더가 있을 때만 쓴다.
 */
export const PROFILE_FORMAT = "mcw-profile";
export const PROFILE_VERSION = 1;

/** 프로필로 옮기지 않는 설정 — PC마다 다른 값이다(원격 포트, 이 PC의 루트와 문서 루트 종류). */
export const PROFILE_EXCLUDED_SETTINGS = ["remote", "pcRoots", "driveKind"] as const;

export interface ProfileFolderProject {
  path: string;
  displayName: string | null;
  status: ProjectStatus | null;
  memo: string;
  hidden: boolean;
}

export interface ProfileWorkProject {
  id: string;
  name: string;
  category: string;
  status: ProjectStatus | null;
  memo: string;
  notionLinks: WorkProjectNotionLink[];
  localFolders: { label: string; path: string }[];
  members: { path: string; role: WorkProjectRole }[];
  tags: string[];
}

export interface MultiCliWorkProfileV1 {
  format: typeof PROFILE_FORMAT;
  version: typeof PROFILE_VERSION;
  exportedAt: string;
  /** 내보낸 PC의 이름(호스트명) — 불러올 때 어디서 온 것인지 보여 준다. */
  exportedFrom: string;
  /** `PROFILE_EXCLUDED_SETTINGS`를 뺀 AppSettings. 불러올 때 파서가 다시 정리한다. */
  settings: Record<string, unknown>;
  folderProjects: ProfileFolderProject[];
  workProjects: ProfileWorkProject[];
}

export type ProfileFolderAction = "add" | "exists" | "missing";

export interface ProfileImportPreview {
  path: string;
  exportedAt: string;
  exportedFrom: string;
  /** 값이 달라지는 설정 섹션 이름. */
  settingsChanged: string[];
  workProjects: { name: string; action: "add" | "update" }[];
  folders: { path: string; resolvedPath: string | null; action: ProfileFolderAction }[];
}

export interface ProfileImportResult {
  addedWorkProjects: number;
  updatedWorkProjects: number;
  addedFolders: number;
  /** 이 PC에 없어서 건너뛴 폴더(프로필의 논리 경로). */
  missingFolders: string[];
  /** 불러오기 직전 파일들을 복사해 둔 폴더. */
  backupDir: string;
}

export interface ProfileExportResult {
  path: string;
  folderCount: number;
  workProjectCount: number;
}
