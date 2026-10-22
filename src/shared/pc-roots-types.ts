import type { DriveKind } from "./drive-kind";
import type { PcRootsSettings } from "./settings-types";

/** 설정 화면이 보여 주는 루트 세 겹 — 지정값, 탐지값, 실제로 쓰는 값(지정값이 이긴다). */
export interface PcRootsInfo {
  configured: PcRootsSettings;
  detected: PcRootsSettings;
  effective: PcRootsSettings;
  /** 문서 루트(drive)의 종류. 지정하지 않으면 실제 경로로 짐작한 값이 effective다. */
  driveKind: { configured: DriveKind | null; effective: DriveKind };
  /** 사용자 홈 — 논리 경로 `home/`의 기준. */
  home: string;
}
