import fs from "node:fs";
import path from "node:path";
import type { ProjectRegistryV1 } from "../../shared/project-types";
import type { WorkProject } from "../../shared/work-project-types";
import { pathStyleFor, shellLinkKey } from "../../shared/workspace-path";
import type { WorkspaceSnapshot } from "../../shared/workspace-types";
import { shellDevPath } from "../projects/workspace-index";
import { repoSyncKey } from "./engine/paths";

/**
 * 업무 프로젝트 하나를 최신화할 레포 경로 목록으로 푼다. 매핑은 mcw만 갖고 있으므로(registry-contract §0)
 * HM 엔진에는 이 목록만 넘긴다. 세 출처를 합친다:
 *  - `role: "repo"` 멤버 폴더
 *  - 링크된 셸의 `repos:` → `<dev>/<repo>`
 *  - 링크된 셸의 `external_paths:`
 *
 * 레포인지·있는지는 여기서 거르지 않는다 — 엔진이 `missing`/`not-a-repo`로 보고하는 편이 사용자에게
 * 이유를 보여 준다. 예외는 `_archive/`로 옮겨진 휴면 레포 하나뿐이다: 매번 "경로 없음"으로 뜨면 소음이다.
 */
export function resolveWorkProjectRepoPaths(
  workProject: WorkProject,
  registry: ProjectRegistryV1,
  snapshot: WorkspaceSnapshot | null,
  platform: NodeJS.Platform = process.platform,
  exists: (candidate: string) => boolean = fs.existsSync,
): string[] {
  const candidates: string[] = [];
  for (const member of workProject.members) {
    if (member.role !== "repo") continue;
    const project = registry.projects[member.projectId];
    if (project) candidates.push(project.rootPath);
  }

  if (snapshot) {
    const style = pathStyleFor(platform);
    const join = platform === "win32" ? path.win32.join : path.posix.join;
    const linked = new Set(
      snapshot.registry.shellLinks
        .filter((link) => link.workProjectId === workProject.id)
        .map((link) => shellLinkKey(link.root, link.channel, link.shell, style)),
    );
    for (const shell of snapshot.shells) {
      if (!linked.has(shellLinkKey(shell.root, shell.channel, shell.shell, style))) continue;
      const devPath = shellDevPath(snapshot.registry.roots, shell.root, style);
      for (const repo of shell.repos) {
        const active = join(devPath, repo);
        if (!exists(active) && exists(join(devPath, "_archive", repo))) continue;
        candidates.push(active);
      }
      candidates.push(...shell.externalPaths);
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = repoSyncKey(candidate, platform);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
