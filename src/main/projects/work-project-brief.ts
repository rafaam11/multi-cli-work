import fs from "node:fs/promises";
import path from "node:path";
import type { SharedProject } from "../../shared/project-types";
import type { WorkProject, WorkProjectRole } from "../../shared/work-project-types";

export interface WorkProjectBriefMember {
  project: SharedProject;
  role: WorkProjectRole;
}

function memberLine(member: WorkProjectBriefMember): string {
  const name = member.project.displayName ?? path.basename(member.project.rootPath);
  return `- ${name}: ${member.project.rootPath}`;
}

/**
 * The markdown handed to a CLI session as project context. Everything the agent needs to move
 * between the three tools: where the Teams documents live, which Notion page tracks the project,
 * and which repos (with local paths) belong to it. Absolute paths are intentional — the brief is
 * personal to this machine (see the v1 sharing decision in the design doc).
 */
export function renderWorkProjectBrief(workProject: WorkProject, members: WorkProjectBriefMember[]): string {
  const repos = members.filter((member) => member.role === "repo");
  const docs = members.filter((member) => member.role === "docs");
  const lines = [
    `# 업무 프로젝트: ${workProject.name}`,
    "",
    `- 구분: ${workProject.category}`,
    ...(workProject.status ? [`- 상태: ${workProject.status}`] : []),
    ...(workProject.notionUrl ? [`- 노션(프로젝트 관리): ${workProject.notionUrl}`] : []),
  ];
  if (docs.length > 0) {
    lines.push("", "## 팀즈 문서 폴더 (공식 문서: 계획서·보고서·발표자료)");
    lines.push(...docs.map(memberLine));
  }
  if (repos.length > 0) {
    lines.push("", "## 개발 레포 (로컬 경로)");
    lines.push(...repos.map(memberLine));
  }
  if (workProject.memo.trim().length > 0) {
    lines.push("", "## 메모", workProject.memo.trim());
  }
  lines.push(
    "",
    "이 세션은 위 업무 프로젝트에 소속된 작업 공간에서 실행 중이다. 문서 작업은 팀즈 폴더,",
    "진행 관리는 노션, 코드는 위 레포 경로를 기준으로 한다.",
    "",
  );
  return lines.join("\n");
}

/**
 * Rewritten on every session launch rather than cached: the file is tiny, and stale briefs after a
 * metadata edit would be worse than the extra write. Returns the absolute path for the env variable.
 */
export async function writeWorkProjectBrief(
  briefDir: string,
  workProject: WorkProject,
  members: WorkProjectBriefMember[],
): Promise<string> {
  await fs.mkdir(briefDir, { recursive: true });
  const briefPath = path.join(briefDir, `${workProject.id}.md`);
  await fs.writeFile(briefPath, renderWorkProjectBrief(workProject, members), "utf8");
  return briefPath;
}
