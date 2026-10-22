import type { DriveKind } from "@shared/drive-kind";
import { Cloud, Folder, HardDrive, Server } from "lucide-react";
import { DropboxIcon, GoogleDriveIcon, ICloudIcon, OneDriveIcon, TeamsIcon } from "./brand-icons";

/** 문서 루트 종류의 아이콘. 브랜드는 제 색을, 일반 아이콘은 글자색을 따른다. */
export function DriveKindIcon({ kind, size = 14 }: { kind: DriveKind; size?: number }) {
  switch (kind) {
    case "gdrive":
      return <GoogleDriveIcon size={size} className="brand-icon-gdrive" />;
    case "onedrive":
      return <OneDriveIcon size={size} />;
    case "dropbox":
      return <DropboxIcon size={size} />;
    case "icloud":
      return <ICloudIcon size={size} />;
    case "teams":
      return <TeamsIcon size={size} className="brand-icon-teams" />;
    case "nas":
      return <Server size={size} aria-hidden="true" />;
    case "local":
      return <HardDrive size={size} aria-hidden="true" />;
    case "cloud":
      return <Cloud size={size} aria-hidden="true" />;
    case "folder":
      return <Folder size={size} aria-hidden="true" />;
  }
}
