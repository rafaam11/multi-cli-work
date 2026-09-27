import fs from "node:fs/promises";
import path from "node:path";
import type {
  WorkspaceRegistryV1,
  WorkspaceRoot,
  WorkspaceShellInfo,
  WorkspaceSnapshot,
} from "../../shared/workspace-types";
import {
  ARCHIVE_DIR,
  CHANNEL_LETTER_LABEL,
  cleanWorkspacePath,
  frontmatterString,
  frontmatterStrings,
  parseChannel,
  parseProjectKey,
  parseShell,
  parseYamlFlat,
  pathStyleFor,
  PROJECTS_DIR,
  shellRef,
  splitFrontmatter,
  workspacePathKey,
  type ChannelLetter,
} from "../../shared/workspace-path";

/**
 * 레포 → 셸 역인덱스. 루트 CLAUDE.md §3이 셸 프론트매터의 `repos:`를 SSOT로 못박았으므로,
 * 여기서 하는 일은 그 값을 모으는 것뿐이다 — 워크스페이스에는 아무것도 쓰지 않는다.
 *
 * 세 경로가 있다:
 *  1. v2 평면 구조: `<root>/projects/<PRJ-key>/PROJECT.yaml` (휴면은 `projects/_archive/`)를 읽는다.
 *     `.ws-index.json`은 `roots`(특히 `drive`)를 얻는 데만 쓴다.
 *  2. v1 지름길: `<root>/.ws-index.json`의 `shells[]`가 있고 최신이면 그걸 읽는다.
 *  3. v1 스캔: 없거나 셸 CLAUDE.md보다 오래됐으면 `<root>/<채널>/<셸>/CLAUDE.md`를 직접 훑는다.
 *
 * 어느 쪽이든 결과는 같은 모양이고, 스캔이 정답이다 — `.ws-index.json`은 지름길일 뿐이다.
 */

const WS_INDEX_FILE = ".ws-index.json";
const PROJECT_YAML_FILE = "PROJECT.yaml";

export interface WorkspaceIndexOptions {
  platform?: NodeJS.Platform;
}

interface ShellStat {
  channel: string;
  shell: string;
  claudePath: string;
  mtimeMs: number;
}

interface RootScan {
  /** 이 루트가 지금 어떤 상태인지 요약한 값. 바뀌면 캐시를 버린다. */
  fingerprint: string;
  shells: WorkspaceShellInfo[];
  warnings: string[];
}

interface ProjectStat {
  key: string;
  archived: boolean;
  yamlPath: string;
  mtimeMs: number;
}

/** `.ws-index.json`의 `roots`에서만 알 수 있는 루트. 둘 다 이 PC에 없을 수 있다. */
interface ExtraRoots {
  drive: string | null;
  onedrive: string | null;
}

async function listDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function mtimeOf(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * work 루트 옆의 dev·data 루트를 **찾아본다**. 관례는 형제 폴더지만(루트 CLAUDE.md §1) 배치가
 * 옮겨지는 중일 수 있어 추측하지 않는다:
 *  1. `<root>/.ws-index.json`의 `roots` — `ws-index.mjs`가 적어 둔 이 PC의 답이 가장 정확하다.
 *  2. `<root>/dev` — 예전의 중첩 배치.
 *  3. 형제 `<parent>/dev` — 관례값. 아직 없어도 이 값을 적어 둔다.
 * 결과는 workspace.json에 남으므로 렌더러의 순수 함수도 같은 답을 본다.
 */
export async function resolveWorkspaceRoots(rootPath: string): Promise<{ dev: string; data: string }> {
  const declared = await readWsIndexRoots(rootPath);
  const resolve = async (name: "dev" | "data") => {
    const fromIndex = declared?.[name];
    if (fromIndex && (await isDirectory(fromIndex))) return fromIndex;
    const nested = path.join(rootPath, name);
    if (await isDirectory(nested)) return nested;
    return path.join(path.dirname(path.resolve(rootPath)), name);
  };
  return { dev: await resolve("dev"), data: await resolve("data") };
}

async function readWsIndexRoots(rootPath: string): Promise<Record<string, string> | null> {
  const text = await readText(path.join(rootPath, WS_INDEX_FILE));
  if (!text) return null;
  try {
    const roots = (JSON.parse(text) as { roots?: unknown }).roots;
    if (typeof roots !== "object" || roots === null) return null;
    return Object.fromEntries(
      Object.entries(roots as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return null;
  }
}

/**
 * 셸 폴더를 열거하고 각 CLAUDE.md의 mtime만 잰다. 파일을 읽지 않으므로 캐시 확인 비용이 낮고,
 * `.ws-index.json`이 뒤처졌는지 판단할 근거가 된다.
 */
async function statShells(root: string): Promise<{ shells: ShellStat[]; warnings: string[] }> {
  const shells: ShellStat[] = [];
  const warnings: string[] = [];
  for (const channelName of await listDirectories(root)) {
    const channel = parseChannel(channelName);
    if (!channel) continue;
    const channelDir = path.join(root, channelName);
    for (const shellName of await listDirectories(channelDir)) {
      if (shellName.startsWith(".") || shellName.startsWith("_")) continue;
      // ws-index.mjs와 같은 관용: Z_Archive 안 셸은 원래 슬러그를 유지하므로 슬러그를 대조하지 않는다.
      const parsed = parseShell(shellName, channel.slug === "Archive" ? undefined : channel.slug);
      const ref = shellRef(channelName, shellName);
      if (!parsed) {
        warnings.push(`[shell-name] ${ref}: 셸 이름 규약 위반(YY_<채널슬러그>_<Topic>-<n>)`);
        continue;
      }
      const claudePath = path.join(channelDir, shellName, "CLAUDE.md");
      const mtimeMs = await mtimeOf(claudePath);
      if (mtimeMs === null) {
        warnings.push(`[shell-claude] ${ref}: CLAUDE.md 없음`);
        continue;
      }
      shells.push({ channel: channelName, shell: shellName, claudePath, mtimeMs });
    }
  }
  return { shells, warnings };
}

/**
 * `<root>/projects` 아래에 PRJ-key 폴더가 하나라도 있으면 v2 평면 구조다. 없으면 v1 채널 스캔으로
 * 떨어진다 — 그 폴백이 다운그레이드와 컷오버 중간 상태를 동시에 덮는다.
 */
async function detectLayout(root: string): Promise<"v1" | "v2"> {
  const projectsDir = path.join(root, PROJECTS_DIR);
  const names = await listDirectories(projectsDir);
  if (names.some((name) => parseProjectKey(name) !== null)) return "v2";
  if (!names.includes(ARCHIVE_DIR)) return "v1";
  const archived = await listDirectories(path.join(projectsDir, ARCHIVE_DIR));
  return archived.some((name) => parseProjectKey(name) !== null) ? "v2" : "v1";
}

/**
 * Project 폴더를 열거하고 각 `PROJECT.yaml`의 mtime만 잰다 — v1 `statShells`와 같은 역할이다.
 * 파일을 읽지 않으므로 캐시 확인 비용이 낮다.
 */
async function statProjects(root: string): Promise<{ projects: ProjectStat[]; warnings: string[] }> {
  const projects: ProjectStat[] = [];
  const warnings: string[] = [];
  const projectsDir = path.join(root, PROJECTS_DIR);
  const scan = async (dir: string, archived: boolean, label: string) => {
    for (const name of await listDirectories(dir)) {
      // `_archive`는 아래에서 따로 훑고, 그 밖의 점·밑줄 폴더는 워크스페이스의 살림살이다.
      if (name.startsWith(".") || name.startsWith("_")) continue;
      if (!parseProjectKey(name)) {
        warnings.push(`[project-key] ${label}/${name}: 프로젝트 키 규약 위반(PRJ-####-slug)`);
        continue;
      }
      const yamlPath = path.join(dir, name, PROJECT_YAML_FILE);
      const mtimeMs = await mtimeOf(yamlPath);
      if (mtimeMs === null) {
        warnings.push(`[project-yaml] ${label}/${name}: PROJECT.yaml 없음`);
        continue;
      }
      projects.push({ key: name, archived, yamlPath, mtimeMs });
    }
  };
  await scan(projectsDir, false, PROJECTS_DIR);
  await scan(path.join(projectsDir, ARCHIVE_DIR), true, `${PROJECTS_DIR}/${ARCHIVE_DIR}`);
  // v2 루트에 남은 채널 폴더는 컷오버 잔재다 — 조용히 먹어 버리지 않고 한 줄 남긴다.
  for (const name of await listDirectories(root)) {
    if (parseChannel(name)) {
      warnings.push(`[legacy-layout] ${name}: ${PROJECTS_DIR}/ 평면 구조로 옮긴 뒤 남은 폴더`);
    }
  }
  return { projects, warnings };
}

/**
 * 매핑표·설정에 쓰는 논리 접두 경로(`dev/` `data/` `drive/` `onedrive/`, 그 외는 work 기준)를
 * 절대경로로 — `ws-path.mjs`의 `resolveLogical` 축약본이다.
 *
 * 원본은 미설정 루트에 대해 **던지지만** 여기서는 `null`을 준다: 브리프 한 줄이 빠지는 것이 세션
 * 시작이 깨지는 것보다 낫다. 대신 work 기준으로 떨어뜨리지는 않는다 — `C:\work\drive\…` 같은
 * 유령 경로가 되기 때문이고, 원본이 던지는 이유도 그것이다.
 */
export function resolveLogicalPath(root: WorkspaceRoot, extra: ExtraRoots, logical: string): string | null {
  const normalized = logical.trim().replace(/\\/g, "/");
  // 논리 경로는 루트 안의 상대경로뿐이다 — 절대경로·드라이브 문자는 받지 않는다.
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return null;
  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  // `..`로 루트 밖에 닿는 값은 푸는 대신 버린다 — work 쪽 `ABS_OR_ESCAPE_RE`와 같은 선.
  if (segments.includes("..")) return null;
  const [head, ...rest] = segments;
  if (head === "dev") return path.join(root.dev, ...rest);
  if (head === "data") return path.join(root.data, ...rest);
  if (head === "drive") return extra.drive === null ? null : path.join(extra.drive, ...rest);
  if (head === "onedrive") return extra.onedrive === null ? null : path.join(extra.onedrive, ...rest);
  return path.join(root.work, ...segments);
}

/**
 * `PROJECT.yaml`을 읽어 Project 한 칸을 만든다. `.ws-index.json`의 `projects[]`를 쓰지 않는 이유는
 * 거기에 `externalPaths`가 없고(루트 밖 레포가 소속을 잃는다) `drive` 불리언이 생성한 PC의 답이기
 * 때문이다. 지문 계산이 어차피 같은 파일들을 stat하므로 읽는 비용도 사실상 그대로다.
 */
async function scanProjects(
  root: WorkspaceRoot,
  stats: readonly ProjectStat[],
  extra: ExtraRoots,
): Promise<WorkspaceShellInfo[]> {
  const projects: WorkspaceShellInfo[] = [];
  for (const stat of stats) {
    const text = await readText(stat.yamlPath);
    if (text === null) continue;
    // PROJECT.yaml은 `---` 울타리가 없는 순수 YAML이라 평면 파서를 직접 부른다. 중첩 블록
    // (`legacy:`·`atlas:`)은 들여쓴 줄이 파서의 정규식에 걸리지 않아 조용히 건너뛰어진다.
    const fields = parseYamlFlat(text);
    const channel = stat.archived ? `${PROJECTS_DIR}/${ARCHIVE_DIR}` : PROJECTS_DIR;
    const title = frontmatterString(fields.title);
    const wikiSource = frontmatterString(fields.wikiSource);
    const driveCandidate = extra.drive === null ? null : path.join(extra.drive, PROJECTS_DIR, stat.key);
    projects.push({
      root: root.work,
      ref: shellRef(channel, stat.key),
      channel,
      shell: stat.key,
      groupLabel: frontmatterString(fields.primaryContext) ?? "",
      topics: frontmatterStrings(fields.topics),
      title: title && title.length > 0 ? title : stat.key,
      status: frontmatterString(fields.status),
      mode: frontmatterString(fields.mode),
      archived: stat.archived,
      path: path.join(root.work, channel, stat.key),
      repos: frontmatterStrings(fields.repos),
      // v2의 `externalPaths`는 **논리 경로**다 — work 쪽 `project-manifest.mjs:32`의
      // `ABS_OR_ESCAPE_RE`가 절대경로를 거부하므로 `C:\…`가 올 수 없다(v1의 `external_paths`와
      // 의미가 다르다). 못 푸는 값(`onedrive` 루트가 이 PC에 없을 때 등)은 조용히 뺀다.
      externalPaths: frontmatterStrings(fields.externalPaths)
        .map((external) => resolveLogicalPath(root, extra, external))
        .filter((external): external is string => external !== null),
      data: frontmatterStrings(fields.data),
      // 인덱스의 `drive` 불리언은 생성한 PC의 답이다 — 이 PC에서 직접 확인한다.
      drivePath: driveCandidate !== null && (await isDirectory(driveCandidate)) ? driveCandidate : null,
      wikiPath: wikiSource === null ? null : resolveLogicalPath(root, extra, wikiSource),
    });
  }
  return projects;
}

function shellInfoFrom(
  root: WorkspaceRoot,
  channel: string,
  shell: string,
  fields: {
    title?: string | null;
    status?: string | null;
    repos?: string[];
    externalPaths?: string[];
    data?: string[];
  },
): WorkspaceShellInfo {
  const parsed = parseChannel(channel);
  const letter = (parsed?.letter ?? "Z") as ChannelLetter;
  return {
    root: root.work,
    ref: shellRef(channel, shell),
    channel,
    shell,
    groupLabel: CHANNEL_LETTER_LABEL[letter],
    // v1 셸에는 topic·mode·휴면 축·drive 짝 폴더·지식 정본이라는 개념이 없다. v2 스캔만 채운다.
    topics: [],
    mode: null,
    archived: false,
    // 한글 표시명은 폴더가 아니라 프론트매터에 있다(루트 §2). 없으면 폴더명으로 떨어진다.
    title: fields.title && fields.title.length > 0 ? fields.title : shell,
    status: fields.status ?? null,
    path: path.join(root.work, channel, shell),
    repos: fields.repos ?? [],
    // 프론트매터의 따옴표 경로는 이스케이프가 풀리지 않은 채로 온다 — ws-path.mjs의 parseScalar가
    // 따옴표만 벗기므로 백슬래시가 둘로 남는다. 여기서 접어 두면 역인덱스도 브리프도 실경로를 본다.
    externalPaths: (fields.externalPaths ?? []).map((external) => cleanWorkspacePath(external)),
    data: fields.data ?? [],
    drivePath: null,
    wikiPath: null,
  };
}

async function scanShells(root: WorkspaceRoot, stats: ShellStat[]): Promise<WorkspaceShellInfo[]> {
  const shells: WorkspaceShellInfo[] = [];
  for (const stat of stats) {
    const text = await readText(stat.claudePath);
    if (text === null) continue;
    const { fm } = splitFrontmatter(text);
    const fields = fm ?? {};
    shells.push(
      shellInfoFrom(root, stat.channel, stat.shell, {
        title: frontmatterString(fields.title),
        status: frontmatterString(fields.status),
        repos: frontmatterStrings(fields.repos),
        externalPaths: frontmatterStrings(fields.external_paths),
        data: frontmatterStrings(fields.data),
      }),
    );
  }
  return shells;
}

/**
 * v1 `.ws-index.json`의 `shells[]`를 셸 목록으로 옮긴다 — **v1 전용 지름길이다.** v2는
 * `PROJECT.yaml`을 직접 읽으므로 이 경로를 타지 않는다(스펙 D3). 절대경로(`path`)는 생성한 PC의
 * 것이라 다시 만든다 — 연구실PC는 `D:\`, 개인PC는 `C:\ws`이므로 파일에 적힌 경로를 믿으면
 * 다른 PC에서 어긋난다.
 */
function shellsFromWsIndex(root: WorkspaceRoot, parsed: unknown): WorkspaceShellInfo[] | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const shells = (parsed as { shells?: unknown }).shells;
  if (!Array.isArray(shells)) return null;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  return shells.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.channel !== "string" || typeof row.name !== "string") return [];
    return [
      shellInfoFrom(root, row.channel, row.name, {
        title: typeof row.title === "string" ? row.title : null,
        status: typeof row.status === "string" ? row.status : null,
        repos: strings(row.repos),
        externalPaths: strings(row.external_paths),
        data: strings(row.data),
      }),
    ];
  });
}

/** `<data 루트>/index.md`의 표에서 `DS-#### → 절대경로`를 읽는다(발급대장은 그 파일이 SSOT다). */
export async function readDatasetPaths(dataPath: string): Promise<Record<string, string>> {
  const text = await readText(path.join(dataPath, "index.md"));
  if (!text) return {};
  const rows: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!/^\|\s*DS-\d{4}\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const [id, , , , , , relative] = cells;
    if (id && relative) rows[id] = path.join(dataPath, relative.split("/").join(path.sep));
  }
  return rows;
}

export class WorkspaceIndex {
  private readonly platform: NodeJS.Platform;
  private readonly cache = new Map<string, RootScan>();

  constructor(options: WorkspaceIndexOptions = {}) {
    this.platform = options.platform ?? process.platform;
  }

  /** 다음 조회 때 다시 훑는다. 루트를 주지 않으면 전부. */
  invalidate(rootPath?: string): void {
    if (rootPath === undefined) this.cache.clear();
    else this.cache.delete(workspacePathKey(rootPath, pathStyleFor(this.platform)));
  }

  async snapshot(registry: WorkspaceRegistryV1): Promise<WorkspaceSnapshot> {
    const style = pathStyleFor(this.platform);
    const shells: WorkspaceShellInfo[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();
    for (const root of registry.roots) {
      const scan = await this.scanRoot(root);
      shells.push(...scan.shells);
      warnings.push(...scan.warnings);
      seen.add(workspacePathKey(root.work, style));
    }
    // 등록이 풀린 루트의 스캔 결과는 들고 있을 이유가 없다.
    for (const key of [...this.cache.keys()]) if (!seen.has(key)) this.cache.delete(key);

    const repoOwners: Record<string, string> = {};
    /**
     * 한 경로·레포를 여러 프로젝트가 등록하면 **마지막에 쓴 것이 이긴다** — 아래 대입이 앞의 것을
     * 덮는다. `WorkProject.members`가 "한 폴더는 한 업무 프로젝트에만 속한다"를 SSOT로 두므로
     * 누군가는 이겨야 하고, 순서는 프로젝트 폴더 이름 정렬이라 실행마다 같다. 다만 조용히 두면
     * 사이드바에서 폴더 줄이 어느 프로젝트 아래에 선 까닭이 아무 데도 나오지 않으므로 한 줄 남긴다.
     *
     * 레포는 **이름 단위로** 센다: 이름 하나가 `<dev>\<name>`과 `<dev>\_archive\<name>` 두 키를
     * 만들어서, 경로 단위로 세면 같은 충돌이 두 줄로 나온다.
     */
    const repoClaims = new Map<string, string[]>();
    const pathClaims = new Map<string, { display: string; refs: string[] }>();
    const devRootOf = new Map(registry.roots.map((root) => [workspacePathKey(root.work, style), root.dev]));
    for (const shell of shells) {
      const devPath = devRootOf.get(workspacePathKey(shell.root, style)) ?? shell.root;
      for (const repo of shell.repos) {
        repoOwners[workspacePathKey(path.join(devPath, repo), style)] = shell.ref;
        // 휴면 레포는 _archive/ 아래로 옮겨져도 같은 프로젝트 소속이다(루트 §10).
        repoOwners[workspacePathKey(path.join(devPath, "_archive", repo), style)] = shell.ref;
        repoClaims.set(repo, [...(repoClaims.get(repo) ?? []), shell.ref]);
      }
      // 루트 밖 경로: v1은 프론트매터의 절대경로, v2는 논리 경로를 푼 절대경로다(루트 §10).
      for (const external of shell.externalPaths) {
        const key = workspacePathKey(external, style);
        repoOwners[key] = shell.ref;
        const claim = pathClaims.get(key);
        pathClaims.set(key, { display: claim?.display ?? external, refs: [...(claim?.refs ?? []), shell.ref] });
      }
    }
    for (const [repo, refs] of repoClaims) {
      if (refs.length < 2) continue;
      warnings.push(
        `[repo-owner] ${repo}: ${refs.length}개 프로젝트가 같은 레포를 등록했다(${refs.join(" · ")}) — ${refs[refs.length - 1]}가 이긴다`,
      );
    }
    for (const { display, refs } of pathClaims.values()) {
      if (refs.length < 2) continue;
      warnings.push(
        `[path-owner] ${display}: ${refs.length}개 프로젝트가 같은 경로를 등록했다(${refs.join(" · ")}) — ${refs[refs.length - 1]}가 이긴다`,
      );
    }
    return { registry, shells, repoOwners, warnings };
  }

  private async scanRoot(root: WorkspaceRoot): Promise<RootScan> {
    const rootPath = root.work;
    const key = workspacePathKey(rootPath, pathStyleFor(this.platform));
    // `.ws-index.json`은 v1의 지름길이고 v2에서는 roots(특히 drive)의 출처다. 어느 쪽이든 그
    // 파일이 바뀌면 다시 읽어야 하므로 두 지문 모두 mtime을 담는다.
    const wsIndexPath = path.join(rootPath, WS_INDEX_FILE);
    const wsIndexMtime = await mtimeOf(wsIndexPath);
    if ((await detectLayout(rootPath)) === "v2") {
      const { projects: stats, warnings } = await statProjects(rootPath);
      const fingerprint = JSON.stringify([
        "v2",
        wsIndexMtime,
        stats.map((stat) => [stat.key, stat.archived, stat.mtimeMs]),
      ]);
      const cached = this.cache.get(key);
      if (cached && cached.fingerprint === fingerprint) return cached;
      const declared = await readWsIndexRoots(rootPath);
      const extra: ExtraRoots = {
        drive: declared?.drive ?? null,
        onedrive: declared?.onedrive ?? null,
      };
      const scan: RootScan = { fingerprint, shells: await scanProjects(root, stats, extra), warnings };
      this.cache.set(key, scan);
      return scan;
    }

    const { shells: stats, warnings } = await statShells(rootPath);
    const fingerprint = JSON.stringify([
      "v1",
      wsIndexMtime,
      stats.map((stat) => [stat.channel, stat.shell, stat.mtimeMs]),
    ]);
    const cached = this.cache.get(key);
    if (cached && cached.fingerprint === fingerprint) return cached;

    const newestShell = stats.reduce((newest, stat) => Math.max(newest, stat.mtimeMs), 0);
    let shells: WorkspaceShellInfo[] | null = null;
    // 생성물이 셸 CLAUDE.md보다 최신일 때만 지름길을 쓴다. 뒤처졌으면 직접 훑는 쪽이 정답이다.
    if (wsIndexMtime !== null && wsIndexMtime >= newestShell) {
      const text = await readText(wsIndexPath);
      try {
        shells = text === null ? null : shellsFromWsIndex(root, JSON.parse(text));
      } catch {
        shells = null;
      }
      // 파일이 셸 폴더 목록과 어긋나면(새 셸 추가 등) 믿지 않는다.
      if (shells && shells.length !== stats.length) shells = null;
    }
    const scan: RootScan = {
      fingerprint,
      shells: shells ?? (await scanShells(root, stats)),
      warnings,
    };
    this.cache.set(key, scan);
    return scan;
  }
}
