import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { categoryForCode, parsePrefixedName } from "../../shared/category-code";
import { driveKindLabel, type DriveKind } from "../../shared/drive-kind";
import type { DriveFolderEntry, DriveLegacyDocs, DriveOverview, DriveProjectStatus } from "../../shared/drive-types";
import { folderNameError, folderTemplatePathError, normalizeFolderTemplatePath } from "../../shared/folder-template";
import { isUnderRoot } from "../../shared/logical-path";
import type { SharedProject } from "../../shared/project-types";
import type { ProjectCategorySetting } from "../../shared/settings-types";
import type { WorkProject } from "../../shared/work-project-types";
import { normalizeProjectPath } from "./project-registry";

/** 드라이브 폴더 이름 비교 — 맥에서 올라온 이름은 NFD일 수 있다. */
export function driveNameKey(name: string): string {
  return name.normalize("NFC").trim();
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function listDirectories(parent: string): Promise<string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "ko"));
  } catch {
    return [];
  }
}

/**
 * 최상위 `<코드>_<이름>` 폴더만 고른다. `_archive`·`share` 같은 비프로젝트 폴더는 접두어 규칙에
 * 맞지 않아 저절로 빠진다. 코드가 설정에 없는 폴더도 목록에는 남긴다(구분 없음으로 가져올 수 있게).
 */
export async function scanDriveFolders(
  root: string | null,
  categories: readonly ProjectCategorySetting[],
  workProjects: readonly WorkProject[],
): Promise<DriveOverview> {
  if (root === null || !(await isDirectory(root))) return { root, available: false, folders: [] };
  const byName = new Map(workProjects.map((workProject) => [driveNameKey(workProject.name), workProject.id]));
  const folders: DriveFolderEntry[] = [];
  for (const name of await listDirectories(root)) {
    const parsed = parsePrefixedName(name);
    if (parsed === null) continue;
    folders.push({
      name,
      code: parsed.code,
      category: categoryForCode(categories, parsed.code)?.name ?? null,
      workProjectId: byName.get(driveNameKey(name)) ?? null,
    });
  }
  folders.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { root, available: true, folders };
}

export interface DriveStatusInput {
  root: string | null;
  workProject: WorkProject;
  /** 멤버 id로 찾을 폴더 프로젝트 — projects.json 전체. */
  projects: Readonly<Record<string, SharedProject>>;
  platform?: NodeJS.Platform;
}

export async function driveProjectStatus(input: DriveStatusInput): Promise<DriveProjectStatus> {
  const { root, workProject, projects } = input;
  const platform = input.platform ?? process.platform;
  const folderPath = root === null ? null : path.join(root, driveNameKey(workProject.name));
  const exists = folderPath !== null && (await isDirectory(folderPath));
  const docs = workProject.members
    .filter((member) => member.role === "docs")
    .map((member) => projects[member.projectId])
    .filter((project): project is SharedProject => project !== undefined);
  const target = folderPath === null ? null : normalizeProjectPath(folderPath, platform);
  const linked = target === null ? undefined : docs.find((project) => normalizeProjectPath(project.rootPath, platform) === target);

  const registered = new Set(Object.values(projects).map((project) => normalizeProjectPath(project.rootPath, platform)));
  const legacyDocs: DriveLegacyDocs[] = [];
  for (const project of docs) {
    if (root !== null && isUnderRoot(project.rootPath, root)) continue;
    const candidates = root === null ? [] : [path.join(root, path.basename(project.rootPath)), ...(folderPath ? [folderPath] : [])];
    let suggestedPath: string | null = null;
    for (const candidate of candidates) {
      if (registered.has(normalizeProjectPath(candidate, platform))) continue;
      if (await isDirectory(candidate)) {
        suggestedPath = candidate;
        break;
      }
    }
    legacyDocs.push({ projectId: project.id, rootPath: project.rootPath, suggestedPath, exists: await isDirectory(project.rootPath) });
  }

  const subfolders = exists && folderPath !== null
    ? (await listDirectories(folderPath)).map((name) => ({ name, path: path.join(folderPath, name) }))
    : [];
  return { root, folderPath, exists, subfolders, linkedProjectId: linked?.id ?? null, legacyDocs };
}

/** Windows 파일 이름에 쓸 수 없는 문자와 끝 공백·점을 막는다 — 드라이브는 세 PC 모두 Windows다. */
export function assertDriveFolderName(name: string): string {
  const trimmed = driveNameKey(name);
  if (trimmed.length === 0 || trimmed.length > 120) throw new Error("드라이브 폴더 이름이 비었거나 너무 깁니다");
  if (folderNameError(trimmed) !== null) throw new Error(`드라이브 폴더 이름으로 쓸 수 없습니다: ${trimmed}`);
  return trimmed;
}

function claudeStub(name: string, category: string, kind: DriveKind): string {
  return [
    `# ${name}`,
    "",
    `- 구분: ${category}`,
    `- 문서 원본은 이 폴더(${driveKindLabel(kind)})에, 코드는 각 PC의 dev 루트에 둔다. 이 폴더 안에서 \`git init\`·커밋을 하지 않는다.`,
    "- 폴더 규약은 드라이브 루트의 `README.md`를 따른다.",
    "",
  ].join("\n");
}

/**
 * `<root>\<name>`을 만든다. 이미 있으면 그대로 두고 빠진 템플릿 폴더만 채운다 — 사용자 파일은
 * 절대 덮어쓰지 않는다(CLAUDE.md도 없을 때만 쓴다). `templateFolders`가 null이면 템플릿 없이 만든다.
 * 템플릿 경로는 설정 파서가 이미 걸렀지만, 폴더를 만드는 마지막 관문이라 한 번 더 확인한다.
 */
export async function createDriveProjectFolder(
  root: string,
  name: string,
  category: string,
  templateFolders: readonly string[] | null,
  kind: DriveKind = "folder",
): Promise<string> {
  if (!(await isDirectory(root))) throw new Error(`드라이브 루트를 열 수 없습니다: ${root}`);
  const folderPath = path.join(root, assertDriveFolderName(name));
  const subfolders = (templateFolders ?? []).map((entry) => {
    const normalized = normalizeFolderTemplatePath(entry);
    const error = folderTemplatePathError(normalized);
    if (error !== null) throw new Error(`템플릿 폴더 경로로 쓸 수 없습니다(${entry}): ${error}`);
    return path.join(folderPath, ...normalized.split("/"));
  });
  await mkdir(folderPath, { recursive: true });
  if (templateFolders !== null) {
    for (const subfolder of subfolders) await mkdir(subfolder, { recursive: true });
    await writeFile(path.join(folderPath, "CLAUDE.md"), claudeStub(path.basename(folderPath), category, kind), {
      encoding: "utf8",
      flag: "wx",
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  return folderPath;
}
