import fs from "node:fs/promises";
import path from "node:path";
import type {
  WorkspaceRegistryV1,
  WorkspaceRoot,
  WorkspaceShellInfo,
  WorkspaceSnapshot,
} from "../../shared/workspace-types";
import {
  CHANNEL_LETTER_LABEL,
  cleanWorkspacePath,
  frontmatterString,
  frontmatterStrings,
  parseChannel,
  parseShell,
  pathStyleFor,
  shellRef,
  splitFrontmatter,
  workspacePathKey,
  type ChannelLetter,
} from "../../shared/workspace-path";

/**
 * 레포 → 셸 역인덱스. 루트 CLAUDE.md §3이 셸 프론트매터의 `repos:`를 SSOT로 못박았으므로,
 * 여기서 하는 일은 그 값을 모으는 것뿐이다 — 워크스페이스에는 아무것도 쓰지 않는다.
 *
 * 두 경로가 있다:
 *  1. `<root>/.ws-index.json` (`_scripts/ws-index.mjs` 생성물)이 있고 최신이면 그걸 읽는다.
 *  2. 없거나 셸 CLAUDE.md보다 오래됐으면 `<root>/<채널>/<셸>/CLAUDE.md`를 직접 훑는다.
 *
 * 어느 쪽이든 결과는 같은 모양이고, 스캔이 정답이다 — `.ws-index.json`은 지름길일 뿐이다.
 */

const WS_INDEX_FILE = ".ws-index.json";

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
export async function resolveWorkspaceRoots(
  rootPath: string,
): Promise<{ devPath: string; dataPath: string }> {
  const declared = await readWsIndexRoots(rootPath);
  const resolve = async (name: "dev" | "data") => {
    const fromIndex = declared?.[name];
    if (fromIndex && (await isDirectory(fromIndex))) return fromIndex;
    const nested = path.join(rootPath, name);
    if (await isDirectory(nested)) return nested;
    return path.join(path.dirname(path.resolve(rootPath)), name);
  };
  return { devPath: await resolve("dev"), dataPath: await resolve("data") };
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
    root: root.path,
    ref: shellRef(channel, shell),
    channel,
    channelLetter: letter,
    channelLabel: CHANNEL_LETTER_LABEL[letter],
    shell,
    // 한글 표시명은 폴더가 아니라 프론트매터에 있다(루트 §2). 없으면 폴더명으로 떨어진다.
    title: fields.title && fields.title.length > 0 ? fields.title : shell,
    status: fields.status ?? null,
    path: path.join(root.path, channel, shell),
    repos: fields.repos ?? [],
    // 프론트매터의 따옴표 경로는 이스케이프가 풀리지 않은 채로 온다 — ws-path.mjs의 parseScalar가
    // 따옴표만 벗기므로 백슬래시가 둘로 남는다. 여기서 접어 두면 역인덱스도 브리프도 실경로를 본다.
    externalPaths: (fields.externalPaths ?? []).map((external) => cleanWorkspacePath(external)),
    data: fields.data ?? [],
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
 * `.ws-index.json`을 셸 목록으로 옮긴다. 절대경로(`path`)는 생성한 PC의 것이라 다시 만든다 —
 * 연구실PC는 `D:\`, 개인PC는 `C:\ws`이므로 파일에 적힌 경로를 믿으면 다른 PC에서 어긋난다.
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
      seen.add(workspacePathKey(root.path, style));
    }
    // 등록이 풀린 루트의 스캔 결과는 들고 있을 이유가 없다.
    for (const key of [...this.cache.keys()]) if (!seen.has(key)) this.cache.delete(key);

    const repoOwners: Record<string, string> = {};
    const devPathOf = new Map(registry.roots.map((root) => [workspacePathKey(root.path, style), root.devPath]));
    for (const shell of shells) {
      const devPath = devPathOf.get(workspacePathKey(shell.root, style)) ?? shell.root;
      for (const repo of shell.repos) {
        repoOwners[workspacePathKey(path.join(devPath, repo), style)] = shell.ref;
        // 휴면 레포는 _archive/ 아래로 옮겨져도 같은 셸 소속이다(루트 §10).
        repoOwners[workspacePathKey(path.join(devPath, "_archive", repo), style)] = shell.ref;
      }
      // 루트 밖 레포(빌드 경로 제약 등)는 셸이 절대경로로 들고 있다(루트 §10).
      for (const external of shell.externalPaths) {
        repoOwners[workspacePathKey(external, style)] = shell.ref;
      }
    }
    return { registry, shells, repoOwners, warnings };
  }

  private async scanRoot(root: WorkspaceRoot): Promise<RootScan> {
    const rootPath = root.path;
    const key = workspacePathKey(rootPath, pathStyleFor(this.platform));
    const { shells: stats, warnings } = await statShells(rootPath);
    const wsIndexPath = path.join(rootPath, WS_INDEX_FILE);
    const wsIndexMtime = await mtimeOf(wsIndexPath);
    const fingerprint = JSON.stringify([
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
