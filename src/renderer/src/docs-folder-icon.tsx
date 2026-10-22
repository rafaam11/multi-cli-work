import { isUnderRoot } from "@shared/logical-path";
import { BookOpen } from "lucide-react";
import { GoogleDriveIcon, TeamsIcon } from "./brand-icons";
import { DriveKindIcon } from "./drive-kind-icon";
import { useDriveRoot } from "./drive-root-context";

export type DocsFolderKind = "drive" | "teams" | "folder";

/**
 * 문서 폴더가 어디에 사는지 경로만 보고 고른다 — 이 PC의 문서 루트 밖(다른 PC에서 옮겨 온 경로, 레거시 팀즈)에 쓰는
 * 판정이다. Google Drive for desktop은 어느 PC에서나 `…\내 드라이브\` 또는 `…\My Drive\`로 보이고, Teams
 * 문서는 OneDrive 동기화 폴더(`…\노바테크\수행프로젝트…`, `OneDrive - …`) 아래에 있었다.
 */
export function docsFolderKind(rootPath: string): DocsFolderKind {
  if (/[\\/](내 드라이브|My Drive)([\\/]|$)/i.test(rootPath)) return "drive";
  if (/onedrive|sharepoint|teams|수행프로젝트/i.test(rootPath)) return "teams";
  return "folder";
}

/** 이 PC의 문서 루트 아래면 사용자가 고른 종류의 아이콘, 아니면 경로로 판정한 아이콘. */
export function DocsFolderIcon({ rootPath, size = 14 }: { rootPath: string; size?: number }) {
  const drive = useDriveRoot();
  if (isUnderRoot(rootPath, drive.root)) return <DriveKindIcon kind={drive.kind} size={size} />;
  const kind = docsFolderKind(rootPath);
  if (kind === "drive") return <GoogleDriveIcon size={size} className="brand-icon-gdrive" />;
  if (kind === "teams") return <TeamsIcon size={size} className="brand-icon-teams" />;
  return <BookOpen size={size} className="brand-icon-docs" aria-hidden="true" />;
}
