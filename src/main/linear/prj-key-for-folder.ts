import { resolveShellRefForPath, type WorkspacePathStyle } from "../../shared/workspace-path";
import type { WorkspaceRegistryV1, WorkspaceSnapshot } from "../../shared/workspace-types";
import { resolveWorkspaceRoots } from "../projects/workspace-index";

const PRJ_KEY = /^PRJ-\d{4}/;

/**
 * 폴더가 속한 PRJ의 키(`PRJ-0017`). ws-root `PROJECT.yaml`의 `repos:`가 레포 → PRJ의 정본이다 —
 * 레포를 PRJ에 잇는 방법은 `/ws-link-repo`이고, 앱에는 따로 매핑 칸을 두지 않는다.
 * 보관된 PRJ와 어디에도 속하지 않는 폴더는 null이다.
 */
export function prjKeyForFolder(folderPath: string, snapshot: WorkspaceSnapshot, style: WorkspacePathStyle): string | null {
  const ref = resolveShellRefForPath(folderPath, { roots: snapshot.registry.roots, repoOwners: snapshot.repoOwners }, style);
  if (!ref) return null;
  const owner = snapshot.shells.find((shell) => shell.ref === ref);
  if (!owner || owner.archived) return null;
  return PRJ_KEY.exec(owner.shell)?.[0] ?? null;
}

/**
 * ws-root 하나짜리 합성 레지스트리. **`workspace.json`에 쓰지 않는다** — 등록하면 업무 프로젝트 동기화가
 * 빈 업무 프로젝트를 만든다(v1.31 D9/D10). `WorkspaceIndex.snapshot`에 넘겨 읽기만 한다.
 */
export async function linearLookupRegistry(workRoot: string): Promise<WorkspaceRegistryV1> {
  const { dev, data } = await resolveWorkspaceRoots(workRoot);
  return {
    schemaVersion: 1,
    updatedAt: "",
    roots: [{ label: "work", work: workRoot, dev, data }],
    shellLinks: [],
  };
}
