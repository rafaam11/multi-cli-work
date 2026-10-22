import type { DriveKind } from "@shared/drive-kind";
import { createContext, useContext } from "react";

/** 이 PC의 문서 루트와 그 종류 — App이 PC 루트 설정에서 읽어 내려 준다. 읽기 전에는 루트 없음·Google Drive. */
export interface DriveRootInfo {
  root: string | null;
  kind: DriveKind;
}

export const DriveRootContext = createContext<DriveRootInfo>({ root: null, kind: "gdrive" });

export function useDriveRoot(): DriveRootInfo {
  return useContext(DriveRootContext);
}
