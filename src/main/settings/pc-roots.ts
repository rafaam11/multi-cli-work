import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inferDriveKind, type DriveKind } from "../../shared/drive-kind";
import type { LogicalRoots } from "../../shared/logical-path";
import type { PcRootsInfo } from "../../shared/pc-roots-types";
import { PC_ROOT_KEYS, type PcRootsSettings } from "../../shared/settings-types";

export interface PcRootsDetectOptions {
  platform?: NodeJS.Platform;
  home?: string;
  isDirectory?: (candidate: string) => boolean;
}

function defaultIsDirectory(candidate: string): boolean {
  try {
    return existsSync(candidate) && statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/** 드라이브 문자 순서 — 관례(C 개인 PC, D 연구실)를 먼저 보고 나머지를 훑는다. */
const LOCAL_DRIVE_LETTERS = ["C", "D", "E", "F"];
/** Google Drive for desktop은 기본이 G:지만 이미 쓰는 문자면 다른 글자를 잡는다. */
const DRIVE_LETTERS = "GHIJKLMNOPQRSTUVWXYZDEF".split("");
const DRIVE_FOLDER_NAMES = ["내 드라이브", "My Drive"];

/**
 * 이 PC의 루트를 찾는다. 관례 위치만 확인하고 없으면 null — 추측해서 만들어 내지 않는다.
 * 사용자가 지정한 값이 언제나 이긴다(`resolvePcRoots`).
 */
export function detectPcRoots(options: PcRootsDetectOptions = {}): PcRootsSettings {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const isDirectory = options.isDirectory ?? defaultIsDirectory;
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const first = (candidates: string[]) => candidates.find((candidate) => isDirectory(candidate)) ?? null;

  if (platform !== "win32") {
    return {
      dev: first([join(home, "dev")]),
      data: first([join(home, "data")]),
      work: first([join(home, "work")]),
      drive: first(DRIVE_FOLDER_NAMES.map((name) => join(home, "Google Drive", name))),
    };
  }
  const local = (name: string) => first(LOCAL_DRIVE_LETTERS.map((letter) => `${letter}:\\${name}`));
  return {
    dev: local("dev"),
    data: local("data"),
    work: local("work"),
    drive: first([
      ...DRIVE_LETTERS.flatMap((letter) => DRIVE_FOLDER_NAMES.map((name) => `${letter}:\\${name}`)),
      // 미러 모드는 드라이브 문자 없이 사용자 폴더 아래에 둔다.
      ...DRIVE_FOLDER_NAMES.map((name) => join(home, name)),
    ]),
  };
}

export function resolvePcRoots(
  configured: PcRootsSettings,
  detected: PcRootsSettings,
  home: string,
  configuredKind: DriveKind | null = null,
): PcRootsInfo {
  const effective = { ...detected };
  for (const key of PC_ROOT_KEYS) effective[key] = configured[key] ?? detected[key];
  const driveKind = { configured: configuredKind, effective: configuredKind ?? inferDriveKind(effective.drive) };
  return { configured, detected, effective, driveKind, home };
}

export function logicalRootsOf(info: PcRootsInfo): LogicalRoots {
  return { ...info.effective, home: info.home };
}

/**
 * 탐지 결과 캐시 — 드라이브 문자 수십 개를 stat하므로 매 요청마다 돌리지 않는다. 설정 화면의
 * "다시 찾기"와 앱 시작이 갱신한다.
 */
export class PcRootsProvider {
  private detected: PcRootsSettings | null = null;
  private readonly home: string;

  constructor(
    private readonly configured: () => PcRootsSettings,
    private readonly options: PcRootsDetectOptions = {},
    private readonly configuredKind: () => DriveKind | null = () => null,
  ) {
    this.home = options.home ?? os.homedir();
  }

  info(): PcRootsInfo {
    this.detected ??= detectPcRoots(this.options);
    return resolvePcRoots(this.configured(), this.detected, this.home, this.configuredKind());
  }

  redetect(): PcRootsInfo {
    this.detected = null;
    return this.info();
  }

  logicalRoots(): LogicalRoots {
    return logicalRootsOf(this.info());
  }
}
