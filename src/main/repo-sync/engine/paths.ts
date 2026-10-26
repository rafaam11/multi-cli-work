// 출처: harness-manager src/main/services/repo-sync/paths.ts — 계약 harness-manager docs/contracts/repo-sync.md.
// HM이 없는 PC의 대체 구현이다. 판정 순서·잠금·state.json이 HM과 같아야 하므로 HM 쪽이 바뀌면 같이 고친다.
import path from "node:path";

/**
 * 같은 레포를 가리키는 서로 다른 표기를 하나로 모으는 키. multi-cli-work `workspacePathKey`와 같은 규칙이다:
 * resolve → 구분자 통일 → 후행 구분자 제거 → Windows에서는 소문자.
 * 저장·출력되는 경로 자체는 `path.resolve`한 원형이다. 키는 비교·잠금 이름에만 쓴다.
 */
export function repoSyncKey(candidate: string, platform: NodeJS.Platform = process.platform): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  let resolved = p.resolve(candidate);
  if (platform === "win32") resolved = resolved.replace(/\//g, "\\");
  const root = p.parse(resolved).root;
  while (resolved.length > root.length && /[\\/]$/.test(resolved)) resolved = resolved.slice(0, -1);
  return platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

/** `child`가 `parent`와 같거나 그 아래인지(키 기준). */
export function isWithin(parent: string, child: string, platform: NodeJS.Platform = process.platform): boolean {
  const parentKey = repoSyncKey(parent, platform);
  const childKey = repoSyncKey(child, platform);
  if (parentKey === childKey) return true;
  const sep = platform === "win32" ? "\\" : "/";
  return childKey.startsWith(parentKey.endsWith(sep) ? parentKey : parentKey + sep);
}
