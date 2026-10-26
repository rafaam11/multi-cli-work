// 출처: harness-manager src/main/services/repo-sync/cloud.ts — 계약 harness-manager docs/contracts/repo-sync.md.
// HM이 없는 PC의 대체 구현이다. 판정 순서·잠금·state.json이 HM과 같아야 하므로 HM 쪽이 바뀌면 같이 고친다.
import { execFile } from "node:child_process";
import { isWithin } from "./paths";

/**
 * 클라우드 동기화 폴더 안의 `.git`은 동기화 클라이언트가 파일을 하나씩 올리고 내리는 중에 깨지기 쉽다.
 * 그런 곳에서 fetch·merge를 돌리면 다른 PC로 반쯤 쓰인 객체가 퍼질 수 있어 아예 건드리지 않는다.
 */
const GOOGLE_DRIVE_SEGMENTS = ["my drive", "내 드라이브", "google drive", "shared drives", "공유 드라이브"];
const ONEDRIVE_ENV_KEYS = ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"];

/**
 * `reg query`는 시스템 코드 페이지(한국어 Windows면 CP949)로 출력해 한글 경로가 깨진다.
 * PowerShell에 UTF-8 출력을 시켜 마운트 지점만 한 줄에 하나씩 받는다.
 */
const MOUNT_POINT_SCRIPT = [
  "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
  String.raw`Get-ChildItem 'HKCU:\Software\SyncEngines\Providers\OneDrive' -ErrorAction SilentlyContinue |`,
  "  ForEach-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).MountPoint }",
].join("\n");

export function parseMountPoints(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * OneDrive 루트는 환경변수에 있지만, Teams·SharePoint 문서 라이브러리는 그 밖(`%USERPROFILE%\<조직명>\…`)에
 * 동기화된다. 그 위치는 OneDrive 클라이언트가 레지스트리 SyncEngines에 마운트 지점으로 적어 둔다.
 * 읽기 실패는 "추가 루트 없음"으로 본다 — 최신화를 막을 이유가 아니다.
 */
export async function readCloudRoots(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<string[]> {
  const roots = ONEDRIVE_ENV_KEYS.map((key) => env[key]).filter((root): root is string => Boolean(root));
  if (platform !== "win32") return roots;
  const output = await new Promise<string>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", MOUNT_POINT_SCRIPT],
      { windowsHide: true, timeout: 10_000, encoding: "utf8" },
      (error, stdout) => resolve(error ? "" : String(stdout)),
    );
  });
  return [...roots, ...parseMountPoints(output)];
}

export function isCloudSynced(
  repoPath: string,
  cloudRoots: readonly string[],
  excludePaths: readonly string[],
  platform: NodeJS.Platform = process.platform,
): boolean {
  const segments = repoPath.split(/[\\/]+/).map((segment) => segment.toLocaleLowerCase("en-US"));
  if (segments.some((segment) => GOOGLE_DRIVE_SEGMENTS.includes(segment))) return true;
  return [...cloudRoots, ...excludePaths].some((root) => root && isWithin(root, repoPath, platform));
}
