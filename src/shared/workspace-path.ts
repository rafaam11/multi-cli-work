/**
 * ws-root(워크스페이스 루트)의 경로·이름 규칙. `<ROOT>/_scripts/lib/ws-path.mjs`의 이식본이며,
 * 정규식·분류 결과·프론트매터 파서는 그 파일과 **같아야 한다** (테스트 벡터: `ws-path.test.mjs`).
 *
 * 순수 함수만 둔다 — 렌더러도 임포트하므로 `node:path`/`node:fs`를 쓰지 않는다. 파일을 읽는 쪽은
 * 메인 프로세스의 `workspace-index.ts`다.
 *
 * 두 층으로 나뉜다:
 *  - `classifyWorkspacePath`  : ws-path.mjs의 `classify`와 1:1 (kind 어휘까지 동일)
 *  - `deriveWorkspaceLocation`: 앱이 쓰는 축약형. 루트 목록에서 소속 루트를 고르고 kind를 좁힌다.
 */

export const CHANNEL_RE = /^([GORZP])_([A-Za-z][A-Za-z0-9]*)$/;
// YY_<channelSlug>(_<Topic>)?(-<n>)? — channelSlug 검증은 parseShell(name, channelSlug)에서
export const SHELL_RE = /^(\d{2})_([A-Za-z][A-Za-z0-9]*)(?:_([A-Za-z0-9]+))?(?:-(\d+))?$/;
export const DATASET_RE = /^(\d{2})_([A-Za-z][A-Za-z0-9]*)_([A-Za-z0-9]+)(?:-(\d+))?$/;
export const DS_ID_RE = /^DS-\d{4}$/;
export const RESERVED_ROOT = new Set(["wiki", "_templates", "_scripts", "_local"]);

export type ChannelLetter = "G" | "O" | "R" | "Z" | "P";

export const CHANNEL_LETTER_LABEL: Record<ChannelLetter, string> = {
  G: "과제",
  O: "용역",
  R: "연구",
  Z: "기타",
  P: "개인",
};

export interface ParsedChannel {
  letter: ChannelLetter;
  slug: string;
  name: string;
}

export interface ParsedShell {
  yy: string;
  channelSlug: string;
  topic: string | null;
  n: number | null;
  name: string;
}

export interface ParsedDataset {
  yy: string;
  source: string;
  dataset: string;
  n: number | null;
  name: string;
}

export function parseChannel(name: string): ParsedChannel | null {
  const match = CHANNEL_RE.exec(name);
  return match ? { letter: match[1] as ChannelLetter, slug: match[2], name } : null;
}

/** channelSlug를 주면 셸 이름의 두 번째 토큰이 그 슬러그와 같아야 한다(루트 CLAUDE.md §2). */
export function parseShell(name: string, channelSlug?: string): ParsedShell | null {
  const match = SHELL_RE.exec(name);
  if (!match) return null;
  if (channelSlug && match[2] !== channelSlug) return null;
  return {
    yy: match[1],
    channelSlug: match[2],
    topic: match[3] ?? null,
    n: match[4] ? Number(match[4]) : null,
    name,
  };
}

export function parseDataset(name: string): ParsedDataset | null {
  const match = DATASET_RE.exec(name);
  return match
    ? { yy: match[1], source: match[2], dataset: match[3], n: match[4] ? Number(match[4]) : null, name }
    : null;
}

// ---------- 경로 정규화 (레지스트리 계약 §7) ----------

export type WorkspacePathStyle = "win32" | "posix";

/**
 * 스타일을 명시하지 않은 호출(주로 테스트)을 위한 추정. 실사용 호출부는 플랫폼을 직접 넘긴다 —
 * 메인은 `process.platform`, 렌더러는 `window.multiCliWork.platform`.
 */
export function detectPathStyle(candidate: string): WorkspacePathStyle {
  return /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith("\\\\") || candidate.includes("\\")
    ? "win32"
    : "posix";
}

export function pathStyleFor(platform: string): WorkspacePathStyle {
  return platform === "win32" ? "win32" : "posix";
}

function separator(style: WorkspacePathStyle): string {
  return style === "win32" ? "\\" : "/";
}

/**
 * 구분자를 통일하고 중복 구분자를 접고 후행 구분자를 떼되 **대소문자는 보존한다**.
 *
 * 중복 구분자 접기가 필수인 이유: 셸 프론트매터의 `external_paths: ["C:\\NeuroPilot\\x"]`는
 * ws-path.mjs의 `parseScalar`가 따옴표만 벗기고 이스케이프를 풀지 않아 백슬래시가 두 개인 채로
 * 읽힌다. `path.normalize`가 그렇듯 여기서 접어 주면 실제 경로와 맞아떨어진다.
 */
export function cleanWorkspacePath(candidate: string, style: WorkspacePathStyle = detectPathStyle(candidate)): string {
  const sep = separator(style);
  let value = style === "win32" ? candidate.replace(/\//g, "\\") : candidate.replace(/\\/g, "/");
  // UNC(`\\server\share`)의 선행 두 개만 남기고 나머지 연속 구분자는 하나로 접는다.
  const uncPrefix = style === "win32" && value.startsWith("\\\\") ? "\\\\" : "";
  value = uncPrefix + value.slice(uncPrefix.length).replace(/[\\/]{2,}/g, sep);
  // 루트 자체(`C:\`, `/`)는 후행 구분자가 곧 경로다.
  const rootLength = style === "win32" ? (/^[A-Za-z]:\\/.test(value) ? 3 : uncPrefix.length) : 1;
  while (value.length > rootLength && value.endsWith(sep)) value = value.slice(0, -1);
  return value;
}

/** 중복 판정용 키. Windows는 대소문자를 구분하지 않는다(계약 §7). */
export function workspacePathKey(candidate: string, style: WorkspacePathStyle = detectPathStyle(candidate)): string {
  const cleaned = cleanWorkspacePath(candidate, style);
  return style === "win32" ? cleaned.toLocaleLowerCase("en-US") : cleaned;
}

/** `child`가 `parent`와 같거나 그 아래면 남은 세그먼트를, 아니면 null을 준다(원본 대소문자 유지). */
export function relativeSegments(
  parent: string,
  child: string,
  style: WorkspacePathStyle = detectPathStyle(parent),
): string[] | null {
  const parentKey = workspacePathKey(parent, style);
  const childKey = workspacePathKey(child, style);
  if (parentKey === childKey) return [];
  const sep = separator(style);
  const prefix = parentKey.endsWith(sep) ? parentKey : parentKey + sep;
  if (!childKey.startsWith(prefix)) return null;
  return cleanWorkspacePath(child, style)
    .slice(prefix.length)
    .split(sep)
    .filter((segment) => segment.length > 0);
}

export function joinWorkspacePath(
  base: string,
  segments: readonly string[],
  style: WorkspacePathStyle = detectPathStyle(base),
): string {
  const sep = separator(style);
  const cleanedBase = cleanWorkspacePath(base, style);
  if (segments.length === 0) return cleanedBase;
  return cleanedBase + (cleanedBase.endsWith(sep) ? "" : sep) + segments.join(sep);
}

// ---------- 분류 ----------

/** ws-path.mjs `classify`의 kind 어휘. 그쪽 테스트 벡터가 이 값들을 그대로 검사한다. */
export type WorkspacePathKind =
  | "root"
  | "channel"
  | "shell"
  | "shell-sub"
  | "dev-dir"
  | "repo"
  | "repo-archive"
  | "repo-sub"
  | "data-root"
  | "data-purpose"
  | "dataset"
  | "dataset-sub"
  | "wiki"
  | "other"
  | "outside";

export interface WorkspacePathClassification {
  kind: WorkspacePathKind;
  rel: string;
  channel?: string;
  shell?: string;
  repo?: string;
  archive?: boolean;
  purpose?: string;
  dataset?: string;
  parsedChannel?: ParsedChannel;
  parsedShell?: ParsedShell;
  parsedDataset?: ParsedDataset | null;
  warning?: string;
}

/**
 * 워크스페이스의 세 루트(루트 CLAUDE.md §1). 관례상 형제 폴더(`C:\work` · `C:\dev` · `C:\data`)
 * 지만 PC별 설정값이므로 추측하지 않고 받는다 — 예전의 중첩 배치(`<work>/dev`)도 이 모양으로
 * 표현되면 같은 코드가 그대로 답한다.
 */
export interface WorkspaceRoots {
  work: string;
  dev: string;
  data: string;
}

/** 절대경로를 세 루트 기준으로 분류한다 — ws-path.mjs `classify`와 같은 판정·같은 kind·같은 순서. */
export function classifyWorkspacePath(
  absPath: string,
  roots: WorkspaceRoots,
  style: WorkspacePathStyle = detectPathStyle(roots.work),
): WorkspacePathClassification {
  const sep = separator(style);
  // dev 루트를 먼저 본다: 예전 배치에서 dev가 work 안에 있으면 그쪽이 이겨야 레포가 셸로 읽히지 않는다.
  const devSegments = relativeSegments(roots.dev, absPath, style);
  if (devSegments !== null) {
    const rel = devSegments.join(sep);
    const [a, b] = devSegments;
    if (!a) return { kind: "dev-dir", rel };
    if (a === "_archive") {
      if (!b) return { kind: "dev-dir", rel, archive: true };
      return { kind: devSegments.length === 2 ? "repo-archive" : "repo-sub", repo: b, archive: true, rel };
    }
    return { kind: devSegments.length === 1 ? "repo" : "repo-sub", repo: a, archive: false, rel };
  }
  const dataSegments = relativeSegments(roots.data, absPath, style);
  if (dataSegments !== null) {
    const rel = dataSegments.join(sep);
    const [a, b] = dataSegments;
    if (!a) return { kind: "data-root", rel };
    if (!b) return { kind: "data-purpose", purpose: a, rel };
    return {
      kind: dataSegments.length === 2 ? "dataset" : "dataset-sub",
      purpose: a,
      dataset: b,
      parsedDataset: parseDataset(b),
      rel,
    };
  }
  const segments = relativeSegments(roots.work, absPath, style);
  if (segments === null) return { kind: "outside", rel: cleanWorkspacePath(absPath, style) };
  const rel = segments.join(sep);
  if (segments.length === 0) return { kind: "root", rel: "" };
  const [a, b] = segments;
  if (a === "wiki") return { kind: "wiki", rel };
  if (RESERVED_ROOT.has(a) || a.startsWith("_") || a.startsWith(".")) return { kind: "other", rel };
  const channel = parseChannel(a);
  if (!channel) return { kind: "other", rel };
  if (!b) return { kind: "channel", channel: a, parsedChannel: channel, rel };
  const shell = parseShell(b, channel.slug);
  if (!shell) return { kind: "other", channel: a, rel, warning: `셸 이름 규약 위반: ${b}` };
  return {
    kind: segments.length === 2 ? "shell" : "shell-sub",
    channel: a,
    shell: b,
    parsedChannel: channel,
    parsedShell: shell,
    rel,
  };
}

// ---------- 앱이 쓰는 축약형 ----------

/** 등록된 루트 하나 — 세 경로를 함께 들고 다닌다. `WorkspaceRoot`가 이 모양을 만족한다. */
export interface WorkspaceRootRef {
  path: string;
  devPath: string;
  dataPath: string;
}

/** 등록 레코드를 분류기가 받는 모양으로. */
export function rootsOf(root: WorkspaceRootRef): WorkspaceRoots {
  return { work: root.path, dev: root.devPath, data: root.dataPath };
}

/**
 * 앱이 다루는 kind는 여덟 가지로 좁혔다. `classifyWorkspacePath`의 나머지(root·dev-dir·data-root·
 * data-purpose·wiki)는 전부 `other`로 접히고, `dataset-sub`는 그 데이터셋 안이라는 뜻이므로
 * `dataset`으로 접어 `purpose`/`dataset`을 잃지 않는다.
 */
export type WorkspaceLocationKind =
  | "shell"
  | "shell-sub"
  | "repo"
  | "repo-archive"
  | "repo-sub"
  | "dataset"
  | "channel"
  | "other";

export interface WorkspaceLocation {
  /** 이 경로를 품은 루트의 경로(등록된 원형 그대로). */
  root: string;
  kind: WorkspaceLocationKind;
  channel?: string;
  shell?: string;
  repoName?: string;
  purpose?: string;
  dataset?: string;
}

const KIND_MAP: Record<WorkspacePathKind, WorkspaceLocationKind | null> = {
  root: "other",
  channel: "channel",
  shell: "shell",
  "shell-sub": "shell-sub",
  "dev-dir": "other",
  repo: "repo",
  "repo-archive": "repo-archive",
  "repo-sub": "repo-sub",
  "data-root": "other",
  "data-purpose": "other",
  dataset: "dataset",
  "dataset-sub": "dataset",
  wiki: "other",
  other: "other",
  outside: null,
};

/**
 * 등록된 루트 중 이 경로를 품은 것을 골라 분류한다. 루트가 중첩돼 있으면 **더 깊은 쪽**이 이긴다 —
 * 하위 루트를 따로 등록한 사용자의 의도가 상위 루트보다 구체적이기 때문.
 * 어느 루트에도 속하지 않으면 null.
 */
export function deriveWorkspaceLocation(
  rootPath: string,
  roots: readonly WorkspaceRootRef[],
  style: WorkspacePathStyle = detectPathStyle(rootPath),
): WorkspaceLocation | null {
  let best: { root: WorkspaceRootRef; depth: number } | null = null;
  for (const candidate of roots) {
    const trio = rootsOf(candidate);
    // 세 루트 중 어느 것에라도 들어가면 이 루트의 일이다. 가장 깊게 맞는 것이 이긴다.
    const depths = [trio.work, trio.dev, trio.data]
      .map((base) => (relativeSegments(base, rootPath, style) === null ? -1 : cleanWorkspacePath(base, style).length));
    const depth = Math.max(...depths);
    if (depth < 0) continue;
    if (!best || depth > best.depth) best = { root: candidate, depth };
  }
  if (!best) return null;
  const classified = classifyWorkspacePath(rootPath, rootsOf(best.root), style);
  const kind = KIND_MAP[classified.kind];
  if (kind === null) return null;
  return {
    root: best.root.path,
    kind,
    ...(classified.channel !== undefined ? { channel: classified.channel } : {}),
    ...(classified.shell !== undefined ? { shell: classified.shell } : {}),
    ...(classified.repo !== undefined ? { repoName: classified.repo } : {}),
    ...(classified.purpose !== undefined ? { purpose: classified.purpose } : {}),
    ...(classified.dataset !== undefined ? { dataset: classified.dataset } : {}),
  };
}

/** 셸을 가리키는 전역 키. `.ws-index.json`의 `ref`와 같은 표기다. */
export function shellRef(channel: string, shell: string): string {
  return `${channel}/${shell}`;
}

/** 자기 자신부터 위로 올라가며 조상 경로를 준다. 파일시스템 루트에서 멈춘다. */
export function ancestorPaths(target: string, style: WorkspacePathStyle = detectPathStyle(target)): string[] {
  const sep = separator(style);
  const paths: string[] = [];
  let current = cleanWorkspacePath(target, style);
  for (;;) {
    paths.push(current);
    const cut = current.lastIndexOf(sep);
    if (cut < 0) break;
    const parent = cleanWorkspacePath(current.slice(0, cut + 1), style);
    if (parent === current) break;
    current = parent;
  }
  return paths;
}

export interface ShellLookup {
  roots: readonly WorkspaceRootRef[];
  /** 정규화된 절대경로 → 셸 ref (`WorkspaceSnapshot.repoOwners`). */
  repoOwners: Readonly<Record<string, string>>;
}

/**
 * 이 경로가 어느 셸의 일인지 답한다. 폴더 자체가 셸(또는 그 하위)이면 그 셸이고, 아니면 등록된
 * 레포 경로를 위로 올라가며 찾는다 — worktree나 레포 하위 폴더를 열어 둔 세션도 같은 답을 받는다.
 */
export function resolveShellRefForPath(
  targetPath: string,
  lookup: ShellLookup,
  style: WorkspacePathStyle = detectPathStyle(targetPath),
): string | null {
  for (const ancestor of ancestorPaths(targetPath, style)) {
    const owner = lookup.repoOwners[workspacePathKey(ancestor, style)];
    if (owner) return owner;
    const location = deriveWorkspaceLocation(ancestor, lookup.roots, style);
    if (location?.channel && location.shell) return shellRef(location.channel, location.shell);
  }
  return null;
}

// ---------- 최소 YAML 프론트매터 (ws-path.mjs와 동일) ----------
// 지원: 스칼라(문자열·숫자·불리언·null), 인라인 배열 [a, b], 따옴표 문자열, 빈 값.
// 중첩 객체는 지원하지 않는다.

export type FrontmatterValue = string | number | boolean | null | Array<string | number | boolean | null>;
export type Frontmatter = Record<string, FrontmatterValue>;

export interface SplitFrontmatter {
  fm: Frontmatter | null;
  raw: string;
  body: string;
}

export function splitFrontmatter(text: string): SplitFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { fm: null, raw: "", body: text };
  return { fm: parseYamlFlat(match[1]), raw: match[1], body: text.slice(match[0].length) };
}

export function parseYamlFlat(raw: string): Frontmatter {
  const out: Frontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = parseScalar(match[2].replace(/\s+#.*$/, "").trim());
  }
  return out;
}

export function parseScalar(value: string): FrontmatterValue {
  if (value === "" || value === "~" || value === "null") return null;
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner
      ? inner.split(",").map((item) => parseScalar(item.trim()) as string | number | boolean | null)
      : [];
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** 프론트매터 값을 문자열 배열로 — 스칼라 하나든 인라인 배열이든 같은 모양으로 받는다. */
export function frontmatterStrings(value: FrontmatterValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== "").map((item) => String(item));
  return value === "" ? [] : [String(value)];
}

export function frontmatterString(value: FrontmatterValue | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  return Array.isArray(value) ? null : String(value);
}
