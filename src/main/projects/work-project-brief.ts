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
 * between the tools: where the documents live, which Notion page tracks the project, which repos
 * (with local paths) belong to it, and which folders on this machine it merely refers to.
 * Absolute paths are intentional — the brief is personal to this machine (see the v1 sharing
 * decision in the design doc).
 *
 * 맺음 문장은 **실제로 실린 절에서만** 조립한다. v1.30까지는 팀즈·노션을 무조건 찍었고, 팀즈 루트도
 * 노션 링크도 없는 사용자에게는 매 세션 틀린 문장이 들어갔다.
 */
export function renderWorkProjectBrief(
  workProject: WorkProject,
  members: WorkProjectBriefMember[],
  tags: readonly string[] = [],
  options: { teamsSyncRoot?: string | null } = {},
): string {
  const repos = members.filter((member) => member.role === "repo");
  const docs = members.filter((member) => member.role === "docs");
  // 팀즈는 그 루트가 설정된 사용자의 어휘다. v2 PRJ의 docs 멤버는 `C:\work\projects\…`다.
  const teams = Boolean(options.teamsSyncRoot);
  const lines = [
    `# 업무 프로젝트: ${workProject.name}`,
    "",
    `- 구분: ${workProject.category}`,
    ...(workProject.status ? [`- 상태: ${workProject.status}`] : []),
    ...(tags.length > 0 ? [`- 태그: ${tags.join(", ")}`] : []),
    ...workProject.notionLinks.map((link) => `- 노션(${link.label}): ${link.url}`),
  ];
  if (docs.length > 0) {
    lines.push(
      "",
      teams
        ? "## 팀즈 문서 폴더 (공식 문서: 계획서·보고서·발표자료)"
        : "## 문서 폴더 (공식 문서: 계획서·보고서·발표자료)",
    );
    lines.push(...docs.map(memberLine));
  }
  if (repos.length > 0) {
    lines.push("", "## 개발 레포 (로컬 경로)");
    lines.push(...repos.map(memberLine));
  }
  if (workProject.localFolders.length > 0) {
    lines.push("", "## 참고 로컬 폴더 (이 PC 기준, 읽기 참조용)");
    lines.push(...workProject.localFolders.map((folder) => `- ${folder.label}: ${folder.path}`));
  }
  if (workProject.memo.trim().length > 0) {
    lines.push("", "## 메모", workProject.memo.trim());
  }
  const anchors = [
    ...(docs.length > 0 ? [teams ? "문서 작업은 팀즈 폴더" : "문서 작업은 위 문서 폴더"] : []),
    ...(workProject.notionLinks.length > 0 ? ["진행 관리는 노션"] : []),
    ...(repos.length > 0 ? ["코드는 위 레포 경로"] : []),
  ];
  lines.push(
    "",
    anchors.length > 0
      ? `이 세션은 위 업무 프로젝트에 소속된 작업 공간에서 실행 중이다. ${anchors.join(", ")}를 기준으로 한다.`
      : "이 세션은 위 업무 프로젝트에 소속된 작업 공간에서 실행 중이다.",
    ...(workProject.localFolders.length > 0
      ? ["참고 로컬 폴더는 읽기 참조용이며 산출물을 그곳에 쓰지 않는다."]
      : []),
    "",
  );
  return lines.join("\n");
}

/**
 * Rewritten on every session launch rather than cached: the file is tiny, and stale briefs after a
 * metadata edit would be worse than the extra write. Returns the absolute path for the env variable.
 *
 * Keyed by the *folder*, not by the work project: a session also carries the ws-root workspace
 * section (`workspace-brief.ts`), whose sibling repos and datasets differ per folder even when two
 * folders share one work project.
 */
export async function writeSessionBrief(
  briefDir: string,
  key: string,
  sections: readonly (string | null)[],
): Promise<string | null> {
  const body = sections.filter((section): section is string => Boolean(section && section.trim().length > 0));
  if (body.length === 0) return null;
  await fs.mkdir(briefDir, { recursive: true });
  const briefPath = path.join(briefDir, `${key}.md`);
  await fs.writeFile(briefPath, body.join("\n"), "utf8");
  return briefPath;
}
