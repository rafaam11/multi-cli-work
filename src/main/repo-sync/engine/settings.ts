// 출처: harness-manager src/main/services/repo-sync/settings.ts — 계약 harness-manager docs/contracts/repo-sync.md.
// HM이 없는 PC의 대체 구현이다. 판정 순서·잠금·state.json이 HM과 같아야 하므로 HM 쪽이 바뀌면 같이 고친다.
import fs from "node:fs/promises";
import path from "node:path";

export interface RepoSyncSettings {
  /** 클라우드 자동 감지가 못 잡는 동기화 폴더 등, 최신화하지 않을 경로(그 아래 전부). */
  excludePaths: string[];
}

export const DEFAULT_REPO_SYNC_SETTINGS: RepoSyncSettings = { excludePaths: [] };

export function settingsFilePath(stateDir: string): string {
  return path.join(stateDir, "config.json");
}

/**
 * 사용자가 손으로 쓰는 파일이라 엔진은 읽기만 한다. 없거나 잘못됐으면 기본값으로 돈다 — 설정 오타 때문에
 * 세션 시작의 최신화가 통째로 멈추면 안 된다.
 */
export async function readRepoSyncSettings(stateDir: string): Promise<RepoSyncSettings> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(settingsFilePath(stateDir), "utf8"));
    const excludePaths = (parsed as { excludePaths?: unknown }).excludePaths;
    if (!Array.isArray(excludePaths)) return DEFAULT_REPO_SYNC_SETTINGS;
    return { excludePaths: excludePaths.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) };
  } catch {
    return DEFAULT_REPO_SYNC_SETTINGS;
  }
}
