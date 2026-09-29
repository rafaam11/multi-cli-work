import fs from "node:fs/promises";
import path from "node:path";
import type { ShellRelease } from "../../shared/remote-types";

export interface ShellArtifact {
  release: ShellRelease;
  apkPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseShellRelease(value: unknown): ShellRelease | null {
  if (!isRecord(value)) return null;
  const { versionCode, versionName, sha256 } = value;
  if (typeof versionCode !== "number" || !Number.isInteger(versionCode) || versionCode < 1) return null;
  if (typeof versionName !== "string" || versionName.length === 0) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  return { versionCode, versionName, sha256 };
}

/**
 * 설치본에 동봉된 셸(`resources/mobile/`, dev에서는 `build/mobile/`). 둘 중 하나라도 없으면 null —
 * 그 PC는 /install에서 안내만 하고, 폰의 업데이트 확인은 이 PC를 건너뛴다.
 */
export async function readShellArtifact(dir: string): Promise<ShellArtifact | null> {
  const apkPath = path.join(dir, "shell.apk");
  try {
    const [manifest] = await Promise.all([fs.readFile(path.join(dir, "shell.json"), "utf8"), fs.access(apkPath)]);
    const release = parseShellRelease(JSON.parse(manifest));
    return release ? { release, apkPath } : null;
  } catch {
    return null;
  }
}
