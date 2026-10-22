/**
 * 문서 루트(`pcRoots.drive`)의 종류 — 아이콘과 문구의 이름을 정한다. 경로는 PC마다 Google Drive·OneDrive·NAS·
 * `D:\…`로 다를 수 있어서, 사용자가 고르지 않으면 경로를 보고 짐작한다.
 */
export const DRIVE_KINDS = [
  { id: "gdrive", label: "Google Drive" },
  { id: "onedrive", label: "OneDrive" },
  { id: "dropbox", label: "Dropbox" },
  { id: "icloud", label: "iCloud Drive" },
  { id: "teams", label: "Teams/SharePoint" },
  { id: "nas", label: "NAS" },
  { id: "local", label: "로컬 디스크" },
  { id: "folder", label: "폴더" },
  { id: "cloud", label: "클라우드" },
] as const;

export type DriveKind = (typeof DRIVE_KINDS)[number]["id"];

export function isDriveKind(value: unknown): value is DriveKind {
  return DRIVE_KINDS.some((kind) => kind.id === value);
}

export function driveKindLabel(kind: DriveKind): string {
  return DRIVE_KINDS.find((entry) => entry.id === kind)?.label ?? kind;
}

/** 경로만 보고 고른다. 모르면 `folder` — 클라우드라고 단정하지 않는다. */
export function inferDriveKind(root: string | null): DriveKind {
  if (!root) return "folder";
  if (/[\\/](내 드라이브|My Drive)([\\/]|$)/i.test(root)) return "gdrive";
  if (/onedrive/i.test(root)) return "onedrive";
  if (/dropbox/i.test(root)) return "dropbox";
  if (/icloud/i.test(root)) return "icloud";
  if (/sharepoint|teams/i.test(root)) return "teams";
  if (/^(\\\\|\/\/)/.test(root)) return "nas";
  return "folder";
}

/** 동기화되는 클라우드·공유 저장소인지 — 안에서 `git init`을 하면 안 되는 곳. 로컬 디스크·일반 폴더는 아니다. */
export function isSyncedDriveKind(kind: DriveKind): boolean {
  return kind !== "local" && kind !== "folder";
}
