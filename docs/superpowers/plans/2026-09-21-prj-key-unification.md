# PRJ-key 일원화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ws-root가 2026-09-05에 옮겨 간 PRJ-key 평면 구조(`C:\work\projects\PRJ-####-slug`)를 MCW가 다시 읽어, 업무 프로젝트 동기화와 세션 브리프를 PRJ 하나로 일원화한다.

**Architecture:** v2 Project를 **어댑터 하나**로 기존 `WorkspaceShellInfo`에 싣는다 — `channel = "projects"`(휴면 `"projects/_archive"`), `shell = <PRJ-key>`, `ref = "projects/<PRJ-key>"`. 그 위의 동기화·사이드바·브리프 코드는 v1과 같은 자료구조를 본다. 데이터 원본은 각 프로젝트의 `PROJECT.yaml`이고, `.ws-index.json`은 `roots`(특히 `drive`)를 얻는 데만 쓴다. 레지스트리 json 스키마는 한 글자도 바뀌지 않는다.

**Tech Stack:** TypeScript 5 · Electron(main/preload/renderer) · React 18 · Vitest 3 + jsdom · Playwright(e2e) · 의존성 추가 없음

**Spec:** `docs/superpowers/specs/2026-09-21-prj-key-unification-design.md`

## Global Constraints

이 절의 요구는 **모든 Task에 암묵적으로 포함된다.**

- **MCW는 `C:\work`·`C:\data`에 쓰지 않는다.** 읽기 전용 소비자다. 구현 중에도 그 두 트리를 수정하지 않는다.
- **`C:\work\_scripts\lib\ws-path.vectors.json`은 읽기만 한다.** 교차 저장소 계약의 정본이며 이 저장소에서 절대 고치지 않는다.
- **레지스트리 json 스키마 무변경.** `~/.multi-cli-work/`의 `projects.json`·`work-projects.json`·`workspace.json`·`project-tags.json`·`state.json`에 필드를 **추가하지도 빼지도 않는다.** 파서가 exact-keys라 구버전 앱이 파일 전체를 거부한다(`docs/superpowers/specs/registry-contract.md` §8).
- **새 의존성 금지.** YAML은 기존 `parseYamlFlat`(`src/shared/workspace-path.ts`)을 재사용한다. `package.json`의 `dependencies`·`devDependencies`에 아무것도 더하지 않는다. **의존성을 설치·변경하지 않는다 — `node_modules`는 본 저장소로의 정션이다.**
- **`C:\dev\multi-cli-work`(본 작업 트리)는 다른 세션이 쓰고 있다 — 거기서 읽지도 쓰지도 않는다.**
- **v2 `externalPaths`·`repos`는 논리 경로/이름이고 절대경로가 아니다.** work 쪽 `_scripts/lib/project-manifest.mjs:32` `ABS_OR_ESCAPE_RE`가 `validateManifest:317`에서 절대경로·탈출 경로를 위반으로 보고하고, `C:\work\CLAUDE.md` 56·86·131행이 "절대경로 금지"를 못박는다. v2 어댑터는 `externalPaths`의 각 값을 `resolveLogicalPath`로 풀어 싣고, 못 푸는 값은 **조용히 뺀다**(경고 없음). v1의 `external_paths`(절대경로 + `cleanWorkspacePath`)는 그대로 둔다.
- **`roots.drive`가 없으면 경고도 오류도 없이 조용히 생략한다.** DRIVE_ROOT 미설정은 정상 상태다(이 PC가 그렇다).
- **테스트는 실제 `C:\work`에 의존하지 않는다.** 전부 `fs.mkdtemp` 임시 디렉터리 픽스처로 만든다. 경로 스타일이 중요한 순수 함수 테스트는 `"win32"`를 명시해 CI(ubuntu)에서도 같은 답을 내게 한다.
- **커밋 메시지는 이 저장소의 영어 conventional 스타일**이다: `feat: …` · `fix: …` · `refactor: …` · `test: …` · `docs: …` · `chore: …`. 소문자로 시작하는 한 줄 요약, 마침표 없음.
- **push 하지 않고 태그도 만들지 않는다.** Task 7(릴리스)은 파일 준비까지만이다.

### 작업 위치 — worktree에서만 한다

**모든 작업은 `C:\dev\.worktrees\mcw-prj-key`에서 한다.** 이 worktree가 `feat/prj-key-unification`을
체크아웃하고 있고 HEAD는 `4f592d4`(스펙 커밋)다. `node_modules`는 본 저장소로의 정션이라 설치가
따로 필요 없다.

**`C:\dev\multi-cli-work`(본 작업 트리)는 읽지도 쓰지도 않는다.** 그 트리는 `main`을 체크아웃한 채
다른 세션이 `src/main/providers/`·`src/main/terminal/`·`src/main/runtime.ts`·`src/renderer/src/App.tsx`를
고치는 중이다(미커밋 12개 수정 + 6개 신규). 거기서 테스트를 돌리면 이 작업과 무관한 실패를 보게 된다.

```bash
cd C:/dev/.worktrees/mcw-prj-key
git branch --show-current   # feat/prj-key-unification
git rev-parse --short HEAD  # 4f592d4
```

새 브랜치를 만들지 않는다. worktree를 지우거나 옮기지 않는다.

### 검증 명령 (worktree에서 실제로 돌려 확인한 것)

| 목적 | 명령 | 확인한 기대 출력 |
|---|---|---|
| 파일 하나 | `npx vitest run src/shared/workspace-path.test.ts` | `Test Files 1 passed (1)` / `Tests 31 passed (31)` |
| 파일 여러 개 | `npx vitest run <path> <path>` | 각 파일 passed |
| 이름으로 좁히기 | `npx vitest run src/renderer/src/sidebar-tree.test.ts -t "defaultGroupingTags"` | `Tests 3 passed | 10 skipped (13)` |
| 전체 | `npm test` (= `vitest run`) | `Test Files 120 passed (120)` / `Tests 1387 passed (1387)` |
| 타입 | `npm run typecheck` | **출력 없음**(성공 시 조용하다). 실패하면 `tsc` 오류가 그대로 뜬다 |
| 빌드 | `npm run build` (= typecheck + electron-vite build) | Task 7에서 1회 |

**`4f592d4`의 기준선은 완전히 green이다** — worktree에서 `npm test`를 돌려 `120 passed (120)` /
`1387 passed (1387)`, `npm run typecheck`는 무출력을 확인했다. 알려진 불안정 테스트도, 미리 깨져 있는
테스트도 **없다**.

그래서 각 Task의 통과 기준은 단순하다.

1. 그 Task가 건드린 테스트 파일이 `npx vitest run <path>`로 green.
2. `npm run typecheck`가 무출력.
3. `npm test`가 **전부 green**. 하나라도 빨간 것이 있으면 내 변경 때문이다 — 고친다. 기준선이
   깨끗하므로 "원래 그랬다"는 변명이 통하지 않는다.

**e2e는 최종 검토 때 1회만 돈다.** `npm run test:e2e`는 `npm run build`(electron-vite 전체 빌드) 다음에 Playwright가 실제 Electron 창을 띄운다(`playwright.config.ts`: `workers: 1`, `fullyParallel: false`, timeout 45초). 디스플레이가 필요하고 수 분이 걸리므로 Task마다 돌리지 않는다. `e2e/desktop.spec.ts`의 `workspace` 문자열은 전부 창 안 그리드(`.workspace-grid`·`.workspace-title`)이고 ws-root 루트를 등록하지 않으므로 **이 계획은 e2e 파일을 수정하지 않는다.**

### 파일 구조

| 파일 | 이 작업에서의 책임 | Task |
|---|---|---|
| `src/shared/workspace-path.ts` | PRJ-key 정규식·파서, `classify`의 kind 어휘와 `projects/` 분류 | 1 |
| `src/shared/workspace-path.test.ts` | 위의 벡터(정본 `ws-path.vectors.json`을 옮긴 것) | 1 |
| `src/shared/workspace-types.ts` | `WorkspaceShellInfo`의 필드(메모리 전용 타입) | 2 |
| `src/main/projects/workspace-index.ts` | 루트 스캔 — v1 채널 경로와 v2 `projects/` 경로, 논리 경로 해석(`wikiSource`·`externalPaths`), 역인덱스와 중복 경고, 지문/캐시 | 2·3 |
| `src/main/projects/workspace-index.test.ts` | 스캔 계약 | 2·3 |
| `src/main/projects/work-project-service.ts` | `syncFromWorkspace` — 이름·태그 시드·휴면 제외 | 2·4 |
| `src/main/projects/work-project-workspace-sync.test.ts` | 동기화가 지키는 선 | 2·4 |
| `src/main/projects/workspace-brief.ts` | 워크스페이스 절 렌더링 | 2·5 |
| `src/main/projects/workspace-brief.test.ts` | 브리프 문구 계약 | 2·5 |
| `src/main/projects/work-project-brief.ts` | 업무 프로젝트 절 — 조건부 팀즈·노션 문장 | 5 |
| `src/main/projects/work-project-brief.test.ts` | 위 계약 | 5 |
| `src/main/runtime.ts` | 브리프 조립 호출부 | 5 |
| `src/renderer/src/sidebar-tree.ts` | 기본 묶기 라벨 순서 | 6 |
| `src/renderer/src/sidebar-tree.test.ts` | 위 계약 | 6 |
| `src/renderer/src/ProjectSidebar.tsx` | 기본 묶기 호출부 | 6 |
| `src/renderer/src/SettingsDialog.tsx` | 워크스페이스 탭 문구 | 6 |
| `src/renderer/src/SettingsDialog.test.tsx` | 워크스페이스 탭(지금 테스트가 하나도 없다 — 새로 만든다) | 6 |
| `src/renderer/src/App.test.tsx` | ws-root 픽스처 헬퍼 | 2 |
| `docs/release/v1.31.0.md` · `README.md` · `package.json` · `package-lock.json` | 릴리스 준비 | 7 |

---

### Task 1: `workspace-path.ts` — PRJ-key 파서와 `projects/` 분류

`ws-root`의 경로 규칙 미러를 v2로 올린다. 정본은 `C:\work\_scripts\lib\ws-path.mjs`와
`C:\work\_scripts\lib\ws-path.vectors.json`이고 **둘 다 읽기 전용**이다. 이 Task는
`WorkspaceShellInfo`를 건드리지 않으므로 다른 파일이 깨지지 않는다.

**Files:**
- Modify: `src/shared/workspace-path.ts` (정규식 블록 15-20행 부근, `WorkspacePathKind` 159-174행, `WorkspacePathClassification` 176-189행, `classifyWorkspacePath` 192-244행, `KIND_MAP` 274-290행)
- Test: `src/shared/workspace-path.test.ts` (기존 31 케이스 중 4줄 수정 + 새 describe 2개)

**Interfaces:**
- Consumes: 없음(첫 Task).
- Produces:
  - `export const PROJECT_KEY_RE: RegExp`
  - `export const PROJECTS_DIR = "projects"` · `export const ARCHIVE_DIR = "_archive"`
  - `export interface ParsedProjectKey { seq: number; slug: string; key: string }`
  - `export function parseProjectKey(key: string): ParsedProjectKey | null`
  - `WorkspacePathKind`에 `"projects-root" | "project" | "project-sub" | "project-archive" | "project-archive-sub" | "legacy-channel" | "legacy-shell" | "legacy-shell-sub"` (구 `"channel" | "shell" | "shell-sub"`는 **사라진다**)
  - `WorkspacePathClassification`에 `project?: string` · `parsedProject?: ParsedProjectKey` · `archived?: boolean`
  - `resolveShellRefForPath(`C:\work\projects\PRJ-0017-secondbrain\wiki`, …)` → `"projects/PRJ-0017-secondbrain"`
  - `WorkspaceLocationKind`는 **바뀌지 않는다**(`"shell" | "shell-sub" | "repo" | …`).

- [ ] **Step 1: 실패하는 테스트를 쓴다 — PRJ-key 파서**

`src/shared/workspace-path.test.ts`의 `import { … }`에 `parseProjectKey`를 더한다(알파벳 순서상 `parseShell` 앞).

```ts
  parseDataset,
  parseProjectKey,
  parseShell,
```

그리고 `describe("데이터셋 이름", …)` 블록 **바로 뒤**에 다음을 넣는다.

```ts
describe("PRJ 프로젝트 키", () => {
  it("일련번호와 슬러그로 쪼갠다", () => {
    expect(parseProjectKey("PRJ-0017-secondbrain")).toEqual({
      seq: 17,
      slug: "secondbrain",
      key: "PRJ-0017-secondbrain",
    });
    expect(parseProjectKey("PRJ-0014-coursework-selfstudy")?.slug).toBe("coursework-selfstudy");
    expect(parseProjectKey("PRJ-0001-a")?.seq).toBe(1);
  });

  it("규약 밖 이름은 거부한다", () => {
    expect(parseProjectKey("PRJ-17-x")).toBeNull();        // 4자리가 아니다
    expect(parseProjectKey("PRJ-0017-Second")).toBeNull(); // 슬러그는 소문자·숫자·하이픈만
    expect(parseProjectKey("PRJ-0017-")).toBeNull();
    expect(parseProjectKey("PRJ-0017")).toBeNull();
    expect(parseProjectKey("prj-0017-x")).toBeNull();
    expect(parseProjectKey("PRJ-0017--x")).toBeNull();     // 하이픈 연속 금지
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/shared/workspace-path.test.ts -t "PRJ 프로젝트 키"`
Expected: FAIL — `No "parseProjectKey" export is defined on the module` 또는 그에 준하는 임포트 오류.

- [ ] **Step 3: 파서를 구현한다**

`src/shared/workspace-path.ts`에서 `export const RESERVED_ROOT = …` 줄 **바로 아래**에 넣는다.

```ts
/** ws-path.mjs `PROJECT_KEY_RE`의 미러 — 정본 벡터는 `_scripts/lib/ws-path.vectors.json`이다. */
export const PROJECT_KEY_RE = /^PRJ-(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
export const PROJECTS_DIR = "projects";
export const ARCHIVE_DIR = "_archive";
```

그리고 `ParsedDataset` 인터페이스 아래(= `parseChannel` 정의 위)에 타입을, `parseDataset` 아래에 함수를 넣는다.

```ts
export interface ParsedProjectKey {
  seq: number;
  slug: string;
  key: string;
}
```

```ts
export function parseProjectKey(key: string): ParsedProjectKey | null {
  const match = PROJECT_KEY_RE.exec(key);
  return match ? { seq: Number(match[1]), slug: match[2], key } : null;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/shared/workspace-path.test.ts -t "PRJ 프로젝트 키"`
Expected: PASS (2 tests)

- [ ] **Step 5: 실패하는 테스트를 쓴다 — kind 개칭과 `projects/` 분류**

먼저 기존 4줄을 고친다(`legacy-` 접두). `describe("classifyWorkspacePath — 3루트 분류")` 안이다.

| 줄 | 기존 | 새 값 |
|---|---|---|
| `classify("O_SMCH").kind` | `"channel"` | `"legacy-channel"` |
| `classify("O_SMCH\\24_SMCH_VSP-1").kind` | `"shell"` | `"legacy-shell"` |
| `classify("O_SMCH\\24_SMCH_VSP-1\\wiki\\permanent").kind` | `"shell-sub"` | `"legacy-shell-sub"` |
| `classifyWorkspacePath(\`${ROOT}\\O_SMCH\\24_SMCH_VSP-1\`, nested, win).kind`(`dev·data가 work 안에 있던 예전 배치` it 안) | `"shell"` | `"legacy-shell"` |

`describe("deriveWorkspaceLocation")`의 `"shell"`·`"shell-sub"`·`"channel"` 기대값은 **고치지 않는다** — 그쪽은 `WorkspaceLocationKind`이고 바뀌지 않았다.

그다음 `describe("classifyWorkspacePath — 3루트 분류")` **바로 뒤**에 정본 벡터를 옮긴 describe를 넣는다.

```ts
/**
 * 벡터 정본은 `<ROOT>/_scripts/lib/ws-path.vectors.json`이다(읽기 전용 · 교차 저장소 계약).
 * 아래 케이스는 그 파일의 `cases` 배열을 그대로 옮긴 것이다 — 기대값을 손대지 말고 구현을 고친다.
 */
describe("classifyWorkspacePath — v2 PRJ 평면 구조", () => {
  it("projects 루트와 Project 폴더·하위를 쪼갠다", () => {
    expect(classify("projects")).toMatchObject({ kind: "projects-root", archived: false });
    expect(classify("projects\\PRJ-0005-neuropilot")).toMatchObject({
      kind: "project",
      project: "PRJ-0005-neuropilot",
      channel: "projects",
      shell: "PRJ-0005-neuropilot",
      archived: false,
    });
    expect(classify("projects\\PRJ-0005-neuropilot\\wiki\\permanent")).toMatchObject({
      kind: "project-sub",
      project: "PRJ-0005-neuropilot",
      channel: "projects",
      shell: "PRJ-0005-neuropilot",
    });
    expect(classify("projects\\PRJ-0005-neuropilot").parsedProject).toEqual({
      seq: 5,
      slug: "neuropilot",
      key: "PRJ-0005-neuropilot",
    });
  });

  it("휴면 Project는 projects/_archive 아래다", () => {
    expect(classify("projects\\_archive")).toMatchObject({ kind: "projects-root", archived: true });
    expect(classify("projects\\_archive\\PRJ-0001-kitu-undergraduate")).toMatchObject({
      kind: "project-archive",
      project: "PRJ-0001-kitu-undergraduate",
      channel: "projects/_archive",
      shell: "PRJ-0001-kitu-undergraduate",
      archived: true,
    });
    expect(classify("projects\\_archive\\PRJ-0001-kitu-undergraduate\\wiki")).toMatchObject({
      kind: "project-archive-sub",
      archived: true,
    });
  });

  it("키 규약을 어긴 폴더는 other + 경고다", () => {
    const bad = classify("projects\\not-a-key");
    expect(bad.kind).toBe("other");
    expect(bad.warning).toContain("프로젝트 키 규약 위반");
    const badArchived = classify("projects\\_archive\\nope");
    expect(badArchived.kind).toBe("other");
    expect(badArchived.warning).toContain("프로젝트 키 규약 위반");
  });

  it("점·밑줄로 시작하는 폴더는 경고 없이 other다", () => {
    expect(classify("projects\\.git")).toMatchObject({ kind: "other", warning: undefined });
    expect(classify("projects\\_local")).toMatchObject({ kind: "other", warning: undefined });
    expect(classify("projects\\_archive\\.obsidian")).toMatchObject({ kind: "other", warning: undefined });
  });

  it("legacy 채널·셸은 같은 루트에서 계속 분류된다", () => {
    expect(classify("O_SMCH").kind).toBe("legacy-channel");
    expect(classify("O_SMCH\\24_SMCH_VSP-1").kind).toBe("legacy-shell");
    expect(classify("O_SMCH\\24_SMCH_VSP-1\\wiki").kind).toBe("legacy-shell-sub");
    expect(classify("Z_Archive\\15_KITU_Undergraduate-1").kind).toBe("legacy-shell");
    expect(classify("wiki").kind).toBe("wiki");
    expect(classify("_templates").kind).toBe("other");
  });
});

describe("resolveShellRefForPath — v2 PRJ", () => {
  const lookup = {
    roots: [{ work: ROOT, dev: DEV, data: DATA }],
    repoOwners: {
      [workspacePathKey(`${DEV}\\multi-cli-work`, win)]: "projects/PRJ-0017-secondbrain",
    },
  };

  it("Project 폴더·그 하위·등록된 레포·레포 하위가 모두 같은 ref를 답한다", () => {
    expect(resolveShellRefForPath(`${ROOT}\\projects\\PRJ-0017-secondbrain`, lookup, win)).toBe(
      "projects/PRJ-0017-secondbrain",
    );
    expect(resolveShellRefForPath(`${ROOT}\\projects\\PRJ-0017-secondbrain\\wiki`, lookup, win)).toBe(
      "projects/PRJ-0017-secondbrain",
    );
    expect(resolveShellRefForPath(`${DEV}\\multi-cli-work`, lookup, win)).toBe("projects/PRJ-0017-secondbrain");
    expect(resolveShellRefForPath(`${DEV}\\multi-cli-work\\src\\main`, lookup, win)).toBe(
      "projects/PRJ-0017-secondbrain",
    );
  });

  it("휴면 Project의 ref는 _archive를 담는다", () => {
    expect(resolveShellRefForPath(`${ROOT}\\projects\\_archive\\PRJ-0001-kitu-undergraduate`, lookup, win)).toBe(
      "projects/_archive/PRJ-0001-kitu-undergraduate",
    );
  });

  it("projects 루트 자체는 어느 Project의 것도 아니다", () => {
    expect(resolveShellRefForPath(`${ROOT}\\projects`, lookup, win)).toBeNull();
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx vitest run src/shared/workspace-path.test.ts`
Expected: FAIL — `projects-root` 대신 `other`가 나오고(현재 `projects`는 채널 규약에 안 맞아 `other`다), `legacy-channel` 대신 `channel`이 나온다.

- [ ] **Step 7: kind 어휘를 개칭하고 `projects/` 절을 끼운다**

7-1. `WorkspacePathKind`를 이렇게 바꾼다(주석 포함).

```ts
/** ws-path.mjs `classify`의 kind 어휘. 그쪽 테스트 벡터가 이 값들을 그대로 검사한다. */
export type WorkspacePathKind =
  | "root"
  | "projects-root"
  | "project"
  | "project-sub"
  | "project-archive"
  | "project-archive-sub"
  | "legacy-channel"
  | "legacy-shell"
  | "legacy-shell-sub"
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
```

7-2. `WorkspacePathClassification`에 세 필드를 더한다(`repo?: string;` 다음 줄에).

```ts
  /** v2 Project의 PRJ-key. `ws-path.mjs`와 같은 필드명이다. */
  project?: string;
  parsedProject?: ParsedProjectKey;
  /** v2 Project가 `projects/_archive` 아래인가. 레포의 `archive`와 다른 축이다. */
  archived?: boolean;
```

7-3. `classifyWorkspacePath` 함수 **위**에 분류 도우미를 넣는다.

```ts
/**
 * `projects/…` 아래를 분류한다 — ws-path.mjs `classify`의 projects 절과 같은 판정·같은 순서.
 *
 * `channel`·`shell`을 함께 채우는 이유는 `resolveShellRefForPath`가 그 둘로 ref를 조립하기
 * 때문이다. 그래서 Project 하위 폴더도 `projects/<key>`라는 같은 전역 키를 받는다.
 */
function classifyProjectsPath(segments: readonly string[], rel: string): WorkspacePathClassification {
  const archiveChannel = `${PROJECTS_DIR}/${ARCHIVE_DIR}`;
  const [, second] = segments;
  if (!second) return { kind: "projects-root", rel, archived: false };
  if (second === ARCHIVE_DIR) {
    const key = segments[2];
    if (!key) return { kind: "projects-root", rel, archived: true };
    if (key.startsWith(".") || key.startsWith("_")) return { kind: "other", rel };
    const parsed = parseProjectKey(key);
    if (!parsed) return { kind: "other", rel, warning: `프로젝트 키 규약 위반: ${key}` };
    return {
      kind: segments.length === 3 ? "project-archive" : "project-archive-sub",
      channel: archiveChannel,
      shell: key,
      project: key,
      parsedProject: parsed,
      archived: true,
      rel,
    };
  }
  if (second.startsWith(".") || second.startsWith("_")) return { kind: "other", rel };
  const parsed = parseProjectKey(second);
  if (!parsed) return { kind: "other", rel, warning: `프로젝트 키 규약 위반: ${second}` };
  return {
    kind: segments.length === 2 ? "project" : "project-sub",
    channel: PROJECTS_DIR,
    shell: second,
    project: second,
    parsedProject: parsed,
    archived: false,
    rel,
  };
}
```

7-4. `classifyWorkspacePath`의 work 루트 분기에서 `wiki`/예약 폴더 판정 **다음, 채널 판정 앞**에 한 줄을 끼우고, 채널·셸 kind를 개칭한다. 기존 227-243행이 이렇게 된다.

```ts
  if (segments.length === 0) return { kind: "root", rel: "" };
  const [a, b] = segments;
  if (a === "wiki") return { kind: "wiki", rel };
  if (RESERVED_ROOT.has(a) || a.startsWith("_") || a.startsWith(".")) return { kind: "other", rel };
  // v2 평면 구조가 채널보다 먼저다 — `projects`는 채널 규약에 맞지 않아 아래로 내려가면 other가 된다.
  if (a === PROJECTS_DIR) return classifyProjectsPath(segments, rel);
  const channel = parseChannel(a);
  if (!channel) return { kind: "other", rel };
  if (!b) return { kind: "legacy-channel", channel: a, parsedChannel: channel, rel };
  const shell = parseShell(b, channel.slug);
  if (!shell) return { kind: "other", channel: a, rel, warning: `셸 이름 규약 위반: ${b}` };
  return {
    kind: segments.length === 2 ? "legacy-shell" : "legacy-shell-sub",
    channel: a,
    shell: b,
    parsedChannel: channel,
    parsedShell: shell,
    rel,
  };
```

7-5. `KIND_MAP`에서 `channel`·`shell`·`shell-sub` 세 줄을 지우고 여덟 줄을 넣는다.

```ts
const KIND_MAP: Record<WorkspacePathKind, WorkspaceLocationKind | null> = {
  root: "other",
  "projects-root": "other",
  // v2 Project는 앱 어휘에서 셸의 자리를 그대로 물려받는다 — 위 코드는 kind로 분기하지 않는다.
  project: "shell",
  "project-sub": "shell-sub",
  "project-archive": "shell",
  "project-archive-sub": "shell-sub",
  "legacy-channel": "channel",
  "legacy-shell": "shell",
  "legacy-shell-sub": "shell-sub",
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
```

7-6. 파일 맨 위 doc 주석의 `classifyWorkspacePath : ws-path.mjs의 classify와 1:1 (kind 어휘까지 동일)` 줄은 그대로 맞다 — 고치지 않는다.

- [ ] **Step 8: 통과를 확인한다**

Run: `npx vitest run src/shared/workspace-path.test.ts`
Expected: PASS — `Test Files 1 passed (1)`, 테스트 수가 31에서 38로 늘어난다.

Run: `npm run typecheck`
Expected: 출력 없음.

- [ ] **Step 9: 전체를 돌린다**

Run: `npm test`
Expected: `Test Files 120 passed (120)` — 전부 green. 하나라도 빨간 것이 있으면 내 변경 때문이다.

- [ ] **Step 10: 커밋**

```bash
git add src/shared/workspace-path.ts src/shared/workspace-path.test.ts
git commit -m "feat: classify PRJ-key project paths alongside legacy channel shells"
```

---

### Task 2: `WorkspaceShellInfo` 필드 개편 (동작 변경 없음)

`WorkspaceShellInfo`에 v2가 쓸 필드를 더하고, 죽은 `channelLetter`를 지우고, `channelLabel`을
`groupLabel`로 개칭한다. **이 Task는 동작을 하나도 바꾸지 않는다** — 새 필드는 v1 스캔에서 고정값
(`topics: []`, `mode: null`, `archived: false`, `drivePath: null`, `wikiPath: null`)으로 채워지고,
기존 테스트의 기대값은 필드 이름 말고는 바뀌지 않는다. 검토자는 "동작 무변경"만 보면 된다.

이 타입은 파일에 저장되지 않는 메모리 전용 타입이므로(`workspace-types.ts:51` 주석) 레지스트리
계약 §8의 다운그레이드 문제가 없다.

**Files:**
- Modify: `src/shared/workspace-types.ts:51-70` (`WorkspaceShellInfo`)
- Modify: `src/main/projects/workspace-index.ts:158-189` (`shellInfoFrom`)
- Modify: `src/main/projects/work-project-service.ts:412` (태그 시드)
- Modify: `src/main/projects/workspace-brief.ts:53` (채널 줄)
- Test: `src/main/projects/workspace-index.test.ts:102-104` (기대 필드명)
- Test: `src/main/projects/work-project-workspace-sync.test.ts:54-69, 112-118` (픽스처)
- Test: `src/main/projects/workspace-brief.test.ts:23-39, 137-147` (픽스처)
- Test: `src/renderer/src/App.test.tsx:189-202` (픽스처)

**Interfaces:**
- Consumes: Task 1의 `PROJECTS_DIR`·`ARCHIVE_DIR`은 아직 쓰지 않는다.
- Produces: `WorkspaceShellInfo`의 최종 형태. Task 3·4·5·6이 이 필드 이름을 그대로 쓴다.
  - `groupLabel: string` (구 `channelLabel`) · `topics: string[]` · `mode: string | null`
  - `archived: boolean` · `drivePath: string | null` · `wikiPath: string | null`
  - `channelLetter`는 **없다**.

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 기대 필드명을 바꾼다**

`src/main/projects/workspace-index.test.ts`의 `scans shell frontmatter and builds the repo reverse index`
안에서 두 줄을 한 줄로 바꾼다.

```ts
    expect(vsp).toMatchObject({
      title: "가상수술계획",
      status: "active",
      groupLabel: "용역",
      shell: "24_SMCH_VSP-1",
      repos: ["VSP_FastAPI", "VSP_MQ_v2"],
      data: ["DS-0001"],
      path: path.join(root, "O_SMCH", "24_SMCH_VSP-1"),
    });
```

(`channelLetter: "O",`와 `channelLabel: "용역",` 두 줄이 `groupLabel: "용역",` 한 줄이 된다.)

같은 파일의 같은 it에 v1 기본값 회귀 한 줄을 더한다(`path:` 기대 바로 다음).

```ts
    // v1 스캔은 v2 전용 필드를 고정값으로 채운다 — 동작이 v1.30과 같다는 뜻이다.
    expect(vsp).toMatchObject({
      topics: [],
      mode: null,
      archived: false,
      drivePath: null,
      wikiPath: null,
    });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/main/projects/workspace-index.test.ts -t "scans shell frontmatter"`
Expected: FAIL — `groupLabel`이 `undefined`라 `toMatchObject`가 깨진다.

- [ ] **Step 3: 타입을 바꾼다**

`src/shared/workspace-types.ts`의 `WorkspaceShellInfo`를 통째로 이렇게 바꾼다.

```ts
/** 루트를 훑어 만든 프로젝트(v1 어휘로는 셸) 한 칸. 파일이 아니라 스캔 결과라 저장하지 않는다. */
export interface WorkspaceShellInfo {
  /** 이 항목이 속한 루트(등록된 원형). */
  root: string;
  /**
   * 전역 키. **반드시 `${channel}/${shell}`이어야 한다** — `syncFromWorkspace`가 `shellLinks`를
   * 그 조합으로 키잉하고 이 값으로 조회하므로, 어긋나면 동기화마다 항목이 중복 생성된다.
   * v2: `projects/PRJ-0017-secondbrain` · v1: `O_SMCH/24_SMCH_VSP-1`
   */
  ref: string;
  /** v2: `"projects"` 또는 `"projects/_archive"` · v1: 채널 폴더명. `shellLink.channel`로 저장된다. */
  channel: string;
  /** v2: PRJ-key · v1: 셸 폴더명. `shellLink.shell`로 저장된다. */
  shell: string;
  /**
   * 태그 시드와 기본 묶기가 쓰는 묶음 라벨. v2는 `PROJECT.yaml`의 `primaryContext`,
   * v1은 채널 라벨(과제·용역·연구·기타·개인)이다. 없으면 빈 문자열이고 그때는 묶지 않는다.
   */
  groupLabel: string;
  /** v2: `PROJECT.yaml`의 `topics` · v1: 항상 []. `groupLabel`과 함께 태그로 심긴다. */
  topics: string[];
  /** v2: `PROJECT.yaml`의 `title` · v1: 셸 CLAUDE.md의 `title:`. 없으면 폴더명. */
  title: string;
  status: string | null;
  /**
   * v2: `PROJECT.yaml`의 `mode`(continuous/finite) · v1: null.
   * **브리프 한 줄로만 흘러가는 문자열이다 — 어떤 코드도 이 값으로 분기하지 않는다.**
   * (2026-09-03 태그 스펙의 "워크스페이스 도메인 개념을 앱에 넣지 않는다"와 공존하는 선)
   */
  mode: string | null;
  /** v2: `projects/_archive` 하위인가 · v1: 항상 false. 업무 프로젝트 생성 제외 판정에 쓴다. */
  archived: boolean;
  /** 프로젝트(셸) 폴더의 절대경로. */
  path: string;
  repos: string[];
  /** 프론트매터의 `externalPaths`/`external_paths` — 루트 밖 레포의 절대경로. */
  externalPaths: string[];
  /** 프론트매터의 `data:` — DS-#### id 목록. */
  data: string[];
  /**
   * `<roots.drive>\projects\<key>` — 그 폴더가 **실재할 때만** 값이 있다. `DRIVE_ROOT`가 설정되지
   * 않은 PC에서는 항상 null이고, 그것은 경고할 일이 아니라 정상 상태다.
   */
  drivePath: string | null;
  /** `PROJECT.yaml`의 `wikiSource` 논리 경로를 등록된 루트로 푼 절대경로. 못 풀면 null. */
  wikiPath: string | null;
}
```

- [ ] **Step 4: 생산 코드를 새 필드에 맞춘다**

4-1. `src/main/projects/workspace-index.ts`의 `shellInfoFrom` 반환 객체에서 `channelLetter`/`channelLabel`
두 줄을 지우고 여섯 줄을 넣는다. 함수 전체가 이렇게 된다(앞부분은 그대로).

```ts
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
```

4-2. `src/main/projects/work-project-service.ts`의 태그 시드 한 줄.

```ts
          tagSeeds.set(target.id, normalizeTags([shell.groupLabel]));
```

4-3. `src/main/projects/workspace-brief.ts`의 채널 줄 한 줄.

```ts
    `- 채널: ${shell.channel} (${shell.groupLabel})`,
```

- [ ] **Step 5: 테스트 픽스처를 새 필드에 맞춘다**

5-1. `src/main/projects/work-project-workspace-sync.test.ts`의 `shell()` 헬퍼.

```ts
function shell(overrides: Partial<WorkspaceShellInfo> & Pick<WorkspaceShellInfo, "channel" | "shell">): WorkspaceShellInfo {
  const ref = `${overrides.channel}/${overrides.shell}`;
  return {
    root: WORK_ROOT,
    ref,
    groupLabel: "용역",
    topics: [],
    title: overrides.shell,
    status: "active",
    mode: null,
    archived: false,
    path: path.win32.join(WORK_ROOT, overrides.channel, overrides.shell),
    repos: [],
    externalPaths: [],
    data: [],
    drivePath: null,
    wikiPath: null,
    ...overrides,
  };
}
```

같은 파일의 `CAREER`에서 `channelLabel: "개인",`을 `groupLabel: "개인",`으로 바꾼다.

5-2. `src/main/projects/workspace-brief.test.ts`의 `shellInfo()` 헬퍼.

```ts
function shellInfo(root: string, overrides: Partial<WorkspaceShellInfo> = {}): WorkspaceShellInfo {
  return {
    root,
    ref: "O_SMCH/24_SMCH_VSP-1",
    channel: "O_SMCH",
    groupLabel: "용역",
    topics: [],
    shell: "24_SMCH_VSP-1",
    title: "가상수술계획",
    status: "active",
    mode: null,
    archived: false,
    path: path.join(root, "O_SMCH", "24_SMCH_VSP-1"),
    repos: ["VSP_FastAPI", "VSP_MQ_v2"],
    externalPaths: [],
    data: ["DS-0001"],
    drivePath: null,
    wikiPath: null,
    ...overrides,
  };
}
```

같은 파일의 `P_Personal` override에서 `channelLetter: "P",`와 `channelLabel: "개인",` 두 줄을
`groupLabel: "개인",` 한 줄로 바꾼다.

5-3. `src/renderer/src/App.test.tsx`의 `shellInfo` 헬퍼.

```ts
const shellInfo = (channel: string, name: string, title: string, repos: string[] = []) => ({
  root: WS_ROOT,
  ref: channel + "/" + name,
  channel,
  groupLabel: channel.startsWith("O") ? "용역" : "개인",
  topics: [] as string[],
  shell: name,
  title,
  status: "active",
  mode: null,
  archived: false,
  path: join(WS_ROOT, channel, name),
  repos,
  externalPaths: [] as string[],
  data: [] as string[],
  drivePath: null,
  wikiPath: null,
});
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npx vitest run src/main/projects/workspace-index.test.ts src/main/projects/work-project-workspace-sync.test.ts src/main/projects/workspace-brief.test.ts src/renderer/src/App.test.tsx`
Expected: PASS — 4 파일 모두 passed. **기대 문자열이 바뀐 것은 하나도 없다**(필드명뿐이다).

Run: `npm run typecheck`
Expected: 출력 없음. (`channelLetter`를 아직 읽는 곳이 남아 있으면 여기서 잡힌다.)

- [ ] **Step 7: 전체를 돌린다**

Run: `npm test`
Expected: 전부 green — 빨간 파일이 하나도 없다.

- [ ] **Step 8: 커밋**

```bash
git add src/shared/workspace-types.ts src/main/projects/workspace-index.ts src/main/projects/work-project-service.ts src/main/projects/workspace-brief.ts src/main/projects/workspace-index.test.ts src/main/projects/work-project-workspace-sync.test.ts src/main/projects/workspace-brief.test.ts src/renderer/src/App.test.tsx
git commit -m "refactor: rename the workspace group label and drop the dead channel letter"
```

---

### Task 3: `workspace-index.ts` — v2 `projects/` 스캔

`<root>/projects` 아래 Project를 읽어 `WorkspaceShellInfo`로 만든다. 데이터 원본은 각 프로젝트의
`PROJECT.yaml`이고, `.ws-index.json`은 `roots`(특히 `drive`·`onedrive`)를 얻는 데만 쓴다. v1 채널
경로와 그 테스트는 **한 줄도 바뀌지 않는다**.

**Files:**
- Modify: `src/main/projects/workspace-index.ts` (임포트, 새 함수 4개, `scanRoot` 재구성, `snapshot`의 역인덱스에 중복 경고)
- Test: `src/main/projects/workspace-index.test.ts` (새 describe 2개 + 헬퍼 3개)

**Interfaces:**
- Consumes: Task 1의 `PROJECTS_DIR`·`ARCHIVE_DIR`·`parseProjectKey`, Task 2의 `WorkspaceShellInfo` 필드.
- Produces:
  - `export function resolveLogicalPath(root: WorkspaceRoot, extra: { drive: string | null; onedrive: string | null }, logical: string): string | null`
  - 스냅샷이 v2 Project를 담는다: `ref === "projects/<key>"`, 휴면은 `"projects/_archive/<key>"`.
  - `WorkspaceShellInfo.externalPaths`는 v2에서 **논리 경로를 푼 절대경로**만 담는다(못 푼 값은 없다).
  - 경고 5종: `[project-key] …`, `[project-yaml] …`, `[legacy-layout] …`, `[path-owner] …`, `[repo-owner] …`.

- [ ] **Step 1: 실패하는 테스트를 쓴다 — v2 스캔**

`src/main/projects/workspace-index.test.ts`의 임포트에 `resolveLogicalPath`를 더한다.

```ts
import { WorkspaceIndex, readDatasetPaths, resolveLogicalPath, resolveWorkspaceRoots } from "./workspace-index";
```

`shellClaude` 헬퍼 **바로 아래**에 v2 픽스처 헬퍼를 넣는다.

```ts
/** PROJECT.yaml은 `---` 울타리가 없는 순수 YAML이다 — 셸 CLAUDE.md와 모양이 다르다. */
function projectYaml(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

/** 액티브 Project 하나를 만든다. */
async function writeProject(root: string, key: string, fields: Record<string, string>): Promise<void> {
  await writeFile(path.join(root, "projects", key, "PROJECT.yaml"), projectYaml(fields));
}

/** 휴면 Project 하나를 만든다. */
async function writeArchivedProject(root: string, key: string, fields: Record<string, string>): Promise<void> {
  await writeFile(path.join(root, "projects", "_archive", key, "PROJECT.yaml"), projectYaml(fields));
}
```

파일 맨 끝에 새 describe 두 개를 붙인다.

```ts
/**
 * 2026-09-05에 ws-root가 옮겨 간 평면 구조. v1 describe들을 그대로 두는 것이 폴백 회귀 테스트다.
 */
describe("WorkspaceIndex — v2 PRJ 평면 구조", () => {
  const SECONDBRAIN = {
    schema: "1",
    key: "PRJ-0017-secondbrain",
    slug: "secondbrain",
    title: "세컨드브레인(LLMwiki·atlas·bolt)",
    mode: "continuous",
    status: "active",
    primaryContext: "개인",
    topics: "[지식관리, 자동화]",
    repos: "[multi-cli-work, llmwiki]",
    externalPaths: "[]",
    data: "[DS-0001]",
    wikiSource: "dev/llmwiki/wiki",
  };

  it("PROJECT.yaml을 읽어 ref·채널·표시명·컨텍스트·mode를 만든다", async () => {
    const root = await tempWorkspace("v2-scan");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));

    expect(snapshot.shells).toHaveLength(1);
    expect(snapshot.shells[0]).toMatchObject({
      ref: "projects/PRJ-0017-secondbrain",
      channel: "projects",
      shell: "PRJ-0017-secondbrain",
      groupLabel: "개인",
      topics: ["지식관리", "자동화"],
      title: "세컨드브레인(LLMwiki·atlas·bolt)",
      status: "active",
      mode: "continuous",
      archived: false,
      path: path.join(root, "projects", "PRJ-0017-secondbrain"),
      repos: ["multi-cli-work", "llmwiki"],
      data: ["DS-0001"],
      drivePath: null,
    });
    expect(snapshot.warnings).toEqual([]);
  });

  it("레포 역인덱스에 dev 루트와 dev/_archive 두 자리를 모두 등록한다", async () => {
    const root = await tempWorkspace("v2-repos");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));

    expect(snapshot.repoOwners[workspacePathKey(path.join(root, "dev", "multi-cli-work"))]).toBe(
      "projects/PRJ-0017-secondbrain",
    );
    expect(snapshot.repoOwners[workspacePathKey(path.join(root, "dev", "_archive", "llmwiki"))]).toBe(
      "projects/PRJ-0017-secondbrain",
    );
  });

  /**
   * v2의 `externalPaths`는 **논리 경로**다 — work 쪽 `project-manifest.mjs`의 `ABS_OR_ESCAPE_RE`가
   * 절대경로를 거부하므로 `C:\…`가 올 수 없다. v1의 `external_paths`(절대경로)와 의미가 다르다.
   */
  it("externalPaths의 논리 경로를 절대경로로 풀어 역인덱스에 넣는다", async () => {
    const root = await tempWorkspace("v2-external");
    const onedrive = await tempWorkspace("v2-external-onedrive");
    const shared = "수행프로젝트(기술연구소) - 문서/O_삼성서울병원";
    await writeProject(root, "PRJ-0006-vsp", {
      key: "PRJ-0006-vsp",
      title: "가상수술계획",
      status: "active",
      primaryContext: "병원 공동연구",
      // 한글·공백·괄호가 든 상대경로가 그대로 풀려야 한다.
      externalPaths: `[onedrive/${shared}, dev/side-repo]`,
    });
    await writeFile(
      path.join(root, ".ws-index.json"),
      JSON.stringify({
        schemaVersion: 2,
        roots: { work: root, dev: path.join(root, "dev"), data: path.join(root, "data"), onedrive },
      }),
    );

    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    const resolved = path.join(onedrive, "수행프로젝트(기술연구소) - 문서", "O_삼성서울병원");
    expect(snapshot.shells[0].externalPaths).toEqual([resolved, path.join(root, "dev", "side-repo")]);
    expect(snapshot.repoOwners[workspacePathKey(resolved)]).toBe("projects/PRJ-0006-vsp");
    expect(snapshot.warnings).toEqual([]);
  });

  it("못 푸는 논리 경로는 조용히 뺀다 — onedrive 루트가 없을 때", async () => {
    const root = await tempWorkspace("v2-external-unresolved");
    await writeProject(root, "PRJ-0006-vsp", {
      key: "PRJ-0006-vsp",
      title: "가상수술계획",
      status: "active",
      primaryContext: "병원 공동연구",
      externalPaths: "[onedrive/수행프로젝트/O_삼성서울병원, dev/side-repo]",
    });
    // `.ws-index.json`이 없으니 onedrive 루트를 알 수 없다.
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells[0].externalPaths).toEqual([path.join(root, "dev", "side-repo")]);
    // DRIVE_ROOT·ONEDRIVE_ROOT 미설정은 경고할 일이 아니다.
    expect(snapshot.warnings).toEqual([]);
  });

  /**
   * 한 폴더가 여러 Project의 `externalPaths`에 동시에 들어간다(실제로 `O_삼성서울병원` 하나가
   * PRJ-0006·0010·0011 셋에 들어간다). `WorkProject.members`가 "한 폴더는 한 업무 프로젝트에만
   * 속한다"를 SSOT로 두므로 누군가는 이겨야 하고, v1부터의 규칙은 **마지막에 쓴 것이 이긴다**다.
   */
  it("같은 경로를 여러 Project가 등록하면 마지막이 이기고 경고 한 줄이 선다", async () => {
    const root = await tempWorkspace("v2-shared-path");
    const onedrive = await tempWorkspace("v2-shared-onedrive");
    for (const key of ["PRJ-0006-vsp", "PRJ-0010-foaa", "PRJ-0011-navi"]) {
      await writeProject(root, key, {
        key,
        title: key,
        status: "active",
        primaryContext: "병원 공동연구",
        externalPaths: "[onedrive/공유/O_삼성서울병원]",
      });
    }
    await writeFile(
      path.join(root, ".ws-index.json"),
      JSON.stringify({
        schemaVersion: 2,
        roots: { work: root, dev: path.join(root, "dev"), data: path.join(root, "data"), onedrive },
      }),
    );

    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    const shared = path.join(onedrive, "공유", "O_삼성서울병원");
    // 폴더 이름 정렬이라 PRJ-0011-navi가 마지막이다 — 실행마다 같은 답이다.
    expect(snapshot.repoOwners[workspacePathKey(shared)]).toBe("projects/PRJ-0011-navi");
    expect(snapshot.warnings).toEqual([
      `[path-owner] ${shared}: 3개 프로젝트가 같은 경로를 등록했다(projects/PRJ-0006-vsp · projects/PRJ-0010-foaa · projects/PRJ-0011-navi) — projects/PRJ-0011-navi가 이긴다`,
    ]);
  });

  it("같은 레포 이름을 두 Project가 등록하면 경고가 한 줄만 선다", async () => {
    const root = await tempWorkspace("v2-shared-repo");
    await writeProject(root, "PRJ-0006-vsp", {
      key: "PRJ-0006-vsp",
      title: "가상수술계획",
      status: "active",
      primaryContext: "병원 공동연구",
      repos: "[shared-lib]",
    });
    await writeProject(root, "PRJ-0011-navi", {
      key: "PRJ-0011-navi",
      title: "내비게이션",
      status: "active",
      primaryContext: "병원 공동연구",
      repos: "[shared-lib]",
    });

    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.repoOwners[workspacePathKey(path.join(root, "dev", "shared-lib"))]).toBe(
      "projects/PRJ-0011-navi",
    );
    // 레포 하나가 역인덱스 키 둘(`dev/x`·`dev/_archive/x`)을 만들지만 경고는 이름 단위로 한 줄이다.
    expect(snapshot.warnings).toEqual([
      "[repo-owner] shared-lib: 2개 프로젝트가 같은 레포를 등록했다(projects/PRJ-0006-vsp · projects/PRJ-0011-navi) — projects/PRJ-0011-navi가 이긴다",
    ]);
  });

  it("휴면 Project는 projects/_archive를 담은 ref와 archived 표식을 받는다", async () => {
    const root = await tempWorkspace("v2-archived");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    await writeArchivedProject(root, "PRJ-0001-kitu-undergraduate", {
      key: "PRJ-0001-kitu-undergraduate",
      title: "(휴면) 금오공대 학부 자료",
      status: "archived",
      mode: "finite",
      primaryContext: "대학원 학사",
    });
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));

    const dormant = snapshot.shells.find((shell) => shell.archived)!;
    expect(dormant).toMatchObject({
      ref: "projects/_archive/PRJ-0001-kitu-undergraduate",
      channel: "projects/_archive",
      shell: "PRJ-0001-kitu-undergraduate",
      archived: true,
      status: "archived",
      path: path.join(root, "projects", "_archive", "PRJ-0001-kitu-undergraduate"),
    });
  });

  it("표시명이 없으면 PRJ-key로, 컨텍스트가 없으면 빈 라벨로 떨어진다", async () => {
    const root = await tempWorkspace("v2-untitled");
    await writeProject(root, "PRJ-0016-finance", { key: "PRJ-0016-finance", status: "active" });
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells[0]).toMatchObject({
      title: "PRJ-0016-finance",
      groupLabel: "",
      topics: [],
      mode: null,
      wikiPath: null,
    });
  });

  it("키 규약 위반과 PROJECT.yaml 없음을 경고로 남기고, 점·밑줄 폴더는 조용히 넘긴다", async () => {
    const root = await tempWorkspace("v2-warn");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    await fs.mkdir(path.join(root, "projects", "not-a-key"), { recursive: true });
    await fs.mkdir(path.join(root, "projects", "PRJ-0099-empty"), { recursive: true });
    await fs.mkdir(path.join(root, "projects", "_local"), { recursive: true });
    await fs.mkdir(path.join(root, "projects", ".obsidian"), { recursive: true });
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));

    expect(snapshot.shells.map((shell) => shell.shell)).toEqual(["PRJ-0017-secondbrain"]);
    expect(snapshot.warnings).toEqual([
      "[project-yaml] projects/PRJ-0099-empty: PROJECT.yaml 없음",
      "[project-key] projects/not-a-key: 프로젝트 키 규약 위반(PRJ-####-slug)",
    ]);
  });

  it("v2 루트에 남은 legacy 채널 폴더는 무시하고 한 줄 경고한다", async () => {
    const root = await tempWorkspace("v2-mixed");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    await writeFile(
      path.join(root, "O_SMCH", "24_SMCH_VSP-1", "CLAUDE.md"),
      shellClaude({ title: "가상수술계획", channel: "O_SMCH" }),
    );
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));

    expect(snapshot.shells.map((shell) => shell.ref)).toEqual(["projects/PRJ-0017-secondbrain"]);
    expect(snapshot.warnings).toEqual([
      "[legacy-layout] O_SMCH: projects/ 평면 구조로 옮긴 뒤 남은 폴더",
    ]);
  });

  it("projects/ 가 없으면 v1 채널 스캔으로 떨어진다", async () => {
    const root = await fixture("v2-fallback");
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells.map((shell) => shell.ref).sort()).toEqual([
      "O_ATNC/24_ATNC_NeuroPilot-1",
      "O_SMCH/24_SMCH_VSP-1",
    ]);
  });

  it("PROJECT.yaml의 mtime으로 캐시를 판정한다", async () => {
    const root = await tempWorkspace("v2-cache");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    const yaml = path.join(root, "projects", "PRJ-0017-secondbrain", "PROJECT.yaml");
    const index = new WorkspaceIndex();
    const titleOf = async () => (await index.snapshot(registryFor(root))).shells[0]?.title;

    await touch(yaml, 1_000);
    expect(await titleOf()).toBe("세컨드브레인(LLMwiki·atlas·bolt)");

    // 내용만 바꾸고 mtime을 되돌리면 캐시가 유지된다 — 판정이 mtime이라는 증거.
    await fs.writeFile(yaml, projectYaml({ ...SECONDBRAIN, title: "새 이름" }), "utf8");
    await touch(yaml, 1_000);
    expect(await titleOf()).toBe("세컨드브레인(LLMwiki·atlas·bolt)");

    await touch(yaml, 9_000);
    expect(await titleOf()).toBe("새 이름");
  });

  it("drive 루트가 선언되고 그 폴더가 실재할 때만 drive 경로를 준다", async () => {
    const root = await tempWorkspace("v2-drive");
    const drive = await tempWorkspace("v2-drive-root");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    await writeProject(root, "PRJ-0016-finance", {
      key: "PRJ-0016-finance",
      title: "가계부",
      status: "active",
      primaryContext: "개인",
    });
    // 짝 폴더는 PRJ-0017에만 있다.
    await fs.mkdir(path.join(drive, "projects", "PRJ-0017-secondbrain"), { recursive: true });
    await writeFile(
      path.join(root, ".ws-index.json"),
      JSON.stringify({ schemaVersion: 2, roots: { work: root, dev: path.join(root, "dev"), data: path.join(root, "data"), drive } }),
    );

    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    const byKey = new Map(snapshot.shells.map((shell) => [shell.shell, shell]));
    expect(byKey.get("PRJ-0017-secondbrain")?.drivePath).toBe(path.join(drive, "projects", "PRJ-0017-secondbrain"));
    expect(byKey.get("PRJ-0016-finance")?.drivePath).toBeNull();
    // DRIVE_ROOT 미설정도, 짝 폴더 없음도 경고할 일이 아니다.
    expect(snapshot.warnings).toEqual([]);
  });

  it("drive 선언이 없으면 조용히 null이다", async () => {
    const root = await tempWorkspace("v2-no-drive");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    await writeFile(
      path.join(root, ".ws-index.json"),
      JSON.stringify({ schemaVersion: 2, roots: { work: root, dev: path.join(root, "dev"), data: path.join(root, "data") } }),
    );
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells[0].drivePath).toBeNull();
    expect(snapshot.warnings).toEqual([]);
  });

  it("wikiSource의 dev/ 논리 경로를 등록된 dev 루트로 푼다", async () => {
    const root = await tempWorkspace("v2-wiki");
    await writeProject(root, "PRJ-0017-secondbrain", SECONDBRAIN);
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells[0].wikiPath).toBe(path.join(root, "dev", "llmwiki", "wiki"));
  });

  it("drive/ 논리 경로는 drive 루트가 없으면 null이다 — work 기준으로 떨어지지 않는다", async () => {
    const root = await tempWorkspace("v2-wiki-drive");
    await writeProject(root, "PRJ-0013-readingarchive", {
      key: "PRJ-0013-readingarchive",
      title: "독서기록",
      status: "active",
      primaryContext: "개인",
      wikiSource: "drive/reading/wiki",
    });
    const snapshot = await new WorkspaceIndex().snapshot(registryFor(root));
    expect(snapshot.shells[0].wikiPath).toBeNull();
  });
});

describe("resolveLogicalPath", () => {
  const root = { work: "C:\\work", dev: "C:\\dev", data: "C:\\data", label: "work-root" };
  const extra = { drive: "G:\\내 드라이브", onedrive: "C:\\OneDrive" };

  it("dev·data·drive·onedrive 접두를 각 루트로 푼다", () => {
    expect(resolveLogicalPath(root, extra, "dev/llmwiki/wiki")).toBe(path.join("C:\\dev", "llmwiki", "wiki"));
    expect(resolveLogicalPath(root, extra, "data/patient")).toBe(path.join("C:\\data", "patient"));
    expect(resolveLogicalPath(root, extra, "drive/reading")).toBe(path.join("G:\\내 드라이브", "reading"));
    expect(resolveLogicalPath(root, extra, "onedrive/팀즈")).toBe(path.join("C:\\OneDrive", "팀즈"));
  });

  it("한글·공백·괄호가 든 실제 externalPaths 값을 그대로 푼다", () => {
    // work 쪽이 2026-09-21에 등록한 값 — PRJ-0006·0010·0011이 공유하는 폴더다.
    expect(resolveLogicalPath(root, extra, "onedrive/수행프로젝트(기술연구소) - 문서/O_삼성서울병원")).toBe(
      path.join("C:\\OneDrive", "수행프로젝트(기술연구소) - 문서", "O_삼성서울병원"),
    );
    expect(resolveLogicalPath(root, extra, "onedrive/수행프로젝트(기술연구소) - 문서/G_보건의료과제")).toBe(
      path.join("C:\\OneDrive", "수행프로젝트(기술연구소) - 문서", "G_보건의료과제"),
    );
  });

  it("접두가 없으면 work 기준이고, 역슬래시 입력도 같은 답이다", () => {
    expect(resolveLogicalPath(root, extra, "wiki/entities")).toBe(path.join("C:\\work", "wiki", "entities"));
    expect(resolveLogicalPath(root, extra, "wiki\\entities")).toBe(path.join("C:\\work", "wiki", "entities"));
  });

  it("미설정 drive·onedrive는 null이다 — work 기준 유령 경로를 만들지 않는다", () => {
    const none = { drive: null, onedrive: null };
    expect(resolveLogicalPath(root, none, "drive/reading")).toBeNull();
    expect(resolveLogicalPath(root, none, "onedrive/x")).toBeNull();
    expect(resolveLogicalPath(root, none, "dev/llmwiki")).toBe(path.join("C:\\dev", "llmwiki"));
  });

  it("빈 값은 null이다", () => {
    expect(resolveLogicalPath(root, extra, "")).toBeNull();
    expect(resolveLogicalPath(root, extra, "   ")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/main/projects/workspace-index.test.ts`
Expected: FAIL — `resolveLogicalPath` 임포트가 없어 파일 수집 단계에서 깨진다.

- [ ] **Step 3: 임포트를 늘린다**

`src/main/projects/workspace-index.ts`의 `workspace-path` 임포트를 이렇게 바꾼다.

```ts
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
```

- [ ] **Step 4: v2 스캔을 구현한다**

`const WS_INDEX_FILE = ".ws-index.json";` 아래에 상수를 더한다.

```ts
const PROJECT_YAML_FILE = "PROJECT.yaml";
```

`interface ShellStat { … }` 아래에 타입 두 개를 더한다.

```ts
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
```

`statShells` 함수 **바로 아래**에 v2 스캔 3종을 넣는다.

```ts
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
  const segments = logical
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
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
```

- [ ] **Step 5: `scanRoot`를 레이아웃별로 나눈다**

`WorkspaceIndex.scanRoot`를 통째로 이렇게 바꾼다.

```ts
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
```

`shellsFromWsIndex`의 doc 주석 첫 줄을 이렇게 고쳐 v1 전용임을 남긴다.

```ts
/**
 * v1 `.ws-index.json`의 `shells[]`를 셸 목록으로 옮긴다 — **v1 전용 지름길이다.** v2는
 * `PROJECT.yaml`을 직접 읽으므로 이 경로를 타지 않는다(스펙 D3). 절대경로(`path`)는 생성한 PC의
 * 것이라 다시 만든다 — 연구실PC는 `D:\`, 개인PC는 `C:\ws`이므로 파일에 적힌 경로를 믿으면
 * 다른 PC에서 어긋난다.
 */
```

파일 맨 위 doc 주석의 "두 경로가 있다" 목록도 v2를 반영해 고친다.

```
 * 세 경로가 있다:
 *  1. v2 평면 구조: `<root>/projects/<PRJ-key>/PROJECT.yaml` (휴면은 `projects/_archive/`)를 읽는다.
 *     `.ws-index.json`은 `roots`(특히 `drive`)를 얻는 데만 쓴다.
 *  2. v1 지름길: `<root>/.ws-index.json`의 `shells[]`가 있고 최신이면 그걸 읽는다.
 *  3. v1 스캔: 없거나 셸 CLAUDE.md보다 오래됐으면 `<root>/<채널>/<셸>/CLAUDE.md`를 직접 훑는다.
```

- [ ] **Step 6: 역인덱스의 중복 등록을 경고로 드러낸다**

`WorkspaceIndex.snapshot`의 역인덱스 블록(`const repoOwners: Record<string, string> = {};`부터
`return { registry, shells, repoOwners, warnings };` 앞까지)을 이렇게 바꾼다. **소유권 규칙은 바뀌지
않는다** — 여전히 마지막에 쓴 것이 이긴다. 달라지는 것은 그 사실이 보인다는 것뿐이다.

```ts
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
```

경고에 적는 경로는 정규화 키(win32에서 소문자)가 아니라 **처음 본 원본 표기**다 — 사용자가 읽는
문장이다.

- [ ] **Step 7: 통과를 확인한다**

Run: `npx vitest run src/main/projects/workspace-index.test.ts`
Expected: PASS — v1 describe 전부 + 새 describe 2개.

Run: `npm run typecheck`
Expected: 출력 없음.

- [ ] **Step 8: 전체를 돌린다**

Run: `npm test`
Expected: 전부 green — 빨간 파일이 하나도 없다.

- [ ] **Step 9: 커밋**

```bash
git add src/main/projects/workspace-index.ts src/main/projects/workspace-index.test.ts
git commit -m "feat: scan PRJ-key project folders from PROJECT.yaml"
```

---

### Task 4: `syncFromWorkspace` — 이름·태그 시드·휴면 제외

Project를 업무 프로젝트로 옮겨 적는 규칙 세 줄을 바꾼다. **사용자가 손으로 만든 항목을 덮어쓰지
않는다**는 기존 선은 한 줄도 건드리지 않는다.

**Files:**
- Modify: `src/main/projects/work-project-service.ts:376-421` (upsert 루프 3곳)
- Test: `src/main/projects/work-project-workspace-sync.test.ts` (새 describe 1개)

**Interfaces:**
- Consumes: Task 2·3의 `WorkspaceShellInfo`(`title`·`groupLabel`·`topics`·`archived`).
- Produces: `WorkspaceSyncResult`는 **그대로**다(`{ workProjects, created, skipped }`). `skipped`는 계속 `ref`를 담는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/main/projects/work-project-workspace-sync.test.ts`의 `REPO_PROJECT` 정의들 **아래**, `afterEach` 위에
v2 픽스처를 더한다.

```ts
/** v2 PRJ 어댑터가 주는 모양 — channel은 "projects", ref는 `${channel}/${key}`다. */
function prj(
  key: string,
  overrides: Partial<WorkspaceShellInfo> = {},
): WorkspaceShellInfo {
  const channel = overrides.archived ? "projects/_archive" : "projects";
  return {
    root: WORK_ROOT,
    ref: `${channel}/${key}`,
    channel,
    shell: key,
    groupLabel: "개인",
    topics: [],
    title: key,
    status: "active",
    mode: "continuous",
    archived: false,
    path: path.win32.join(WORK_ROOT, channel, key),
    repos: [],
    externalPaths: [],
    data: [],
    drivePath: null,
    wikiPath: null,
    ...overrides,
    channel,
    ref: `${channel}/${key}`,
  };
}

const SECONDBRAIN = prj("PRJ-0017-secondbrain", {
  title: "세컨드브레인(LLMwiki·atlas·bolt)",
  groupLabel: "개인",
  topics: ["지식관리"],
  repos: ["VSP_FastAPI"],
});
const DORMANT = prj("PRJ-0001-kitu-undergraduate", {
  title: "(휴면) 금오공대 학부 자료",
  status: "archived",
  mode: "finite",
  groupLabel: "대학원 학사",
  archived: true,
});
```

`describe("syncFromWorkspace")` 블록이 닫힌 **뒤**에 새 describe를 붙인다.

```ts
describe("syncFromWorkspace — v2 PRJ", () => {
  it("업무 프로젝트 이름은 PROJECT.yaml의 title이고, 링크는 projects/<key>로 적힌다", async () => {
    const paths = await tempPaths("prj-create");
    const result = await service(paths).syncFromWorkspace(snapshot([SECONDBRAIN]), [REPO_PROJECT]);

    expect(result.created).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(result.workProjects.workProjects[IDS[0]]).toMatchObject({
      name: "세컨드브레인(LLMwiki·atlas·bolt)",
      members: [{ projectId: REPO_PROJECT.id, role: "repo" }],
    });
    const workspace = await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath });
    expect(workspace.shellLinks).toEqual([
      { workProjectId: IDS[0], root: WORK_ROOT, channel: "projects", shell: "PRJ-0017-secondbrain" },
    ]);
  });

  it("태그 시드는 컨텍스트와 topic을 함께 심는다", async () => {
    const paths = await tempPaths("prj-tags");
    await service(paths).syncFromWorkspace(snapshot([SECONDBRAIN]), []);
    const tags = await readProjectTags({ registryPath: paths.projectTagsPath });
    expect(tags.tags).toEqual({ [IDS[0]]: ["개인", "지식관리"] });
  });

  it("컨텍스트가 비어 있으면 아무 태그도 심지 않는다", async () => {
    const paths = await tempPaths("prj-tags-empty");
    await service(paths).syncFromWorkspace(
      snapshot([prj("PRJ-0016-finance", { title: "가계부", groupLabel: "" })]),
      [],
    );
    const tags = await readProjectTags({ registryPath: paths.projectTagsPath });
    expect(tags.tags).toEqual({ [IDS[0]]: [] });
  });

  it("휴면 Project는 업무 프로젝트를 새로 만들지 않는다", async () => {
    const paths = await tempPaths("prj-dormant");
    const result = await service(paths).syncFromWorkspace(snapshot([SECONDBRAIN, DORMANT]), []);

    expect(result.created).toBe(1);
    expect(Object.values(result.workProjects.workProjects).map((workProject) => workProject.name)).toEqual([
      "세컨드브레인(LLMwiki·atlas·bolt)",
    ]);
    const workspace = await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath });
    expect(workspace.shellLinks.map((link) => link.shell)).toEqual(["PRJ-0017-secondbrain"]);
  });

  it("휴면으로 바뀐 링크된 Project는 그대로 남고 멤버도 계속 갱신된다", async () => {
    const paths = await tempPaths("prj-became-dormant");
    await service(paths).syncFromWorkspace(snapshot([SECONDBRAIN]), []);
    const links = (await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath })).shellLinks;

    // 같은 ref가 휴면으로 바뀌었다(work 쪽에서 _archive로 옮기면 ref도 바뀌지만, 여기서는 상태만
    // 바뀐 중간 상태를 본다 — 링크가 살아 있는 한 지우지 않는다는 것이 요점이다).
    const dormantSame = { ...SECONDBRAIN, status: "archived", archived: true };
    const second = await service(paths, [IDS[1]]).syncFromWorkspace(
      snapshot([dormantSame], links),
      [REPO_PROJECT],
    );

    expect(second.created).toBe(0);
    expect(second.workProjects.workProjects[IDS[0]]).toMatchObject({
      name: "세컨드브레인(LLMwiki·atlas·bolt)",
      members: [{ projectId: REPO_PROJECT.id, role: "repo" }],
    });
  });

  it("title이 바뀌어도 이름을 덮어쓰지 않는다 — 이름은 만들 때 한 번이다", async () => {
    const paths = await tempPaths("prj-rename");
    await service(paths).syncFromWorkspace(snapshot([SECONDBRAIN]), []);
    const links = (await readWorkspaceRegistry({ registryPath: paths.workspaceRegistryPath })).shellLinks;

    const renamed = { ...SECONDBRAIN, title: "세컨드브레인 v2" };
    const second = await service(paths, [IDS[1]]).syncFromWorkspace(snapshot([renamed], links), []);

    expect(second.created).toBe(0);
    expect(second.workProjects.workProjects[IDS[0]].name).toBe("세컨드브레인(LLMwiki·atlas·bolt)");
  });

  it("수제 업무 프로젝트가 같은 이름을 쓰고 있으면 건너뛴다", async () => {
    const paths = await tempPaths("prj-collision");
    const manual = service(paths, [MANUAL_ID]);
    await manual.createWorkProject({ name: "세컨드브레인(LLMwiki·atlas·bolt)", category: "상품개발" });

    const result = await service(paths).syncFromWorkspace(snapshot([SECONDBRAIN]), [REPO_PROJECT]);

    expect(result.created).toBe(0);
    expect(result.skipped).toEqual(["projects/PRJ-0017-secondbrain"]);
    expect(Object.keys(result.workProjects.workProjects)).toEqual([MANUAL_ID]);
    expect(result.workProjects.workProjects[MANUAL_ID].category).toBe("상품개발");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/main/projects/work-project-workspace-sync.test.ts -t "v2 PRJ"`
Expected: FAIL — 이름이 `projects/PRJ-0017-secondbrain`(ref)으로 만들어지고, 휴면 Project도 생성되고, 태그가 `["개인"]`이다.

- [ ] **Step 3: upsert 루프를 고친다**

`src/main/projects/work-project-service.ts`의 `for (const shell of snapshot.shells) {` 블록 앞부분을 이렇게 바꾼다.

```ts
      for (const shell of snapshot.shells) {
        // 이름은 워크스페이스의 표시명이다 — v2는 PROJECT.yaml의 title, v1은 셸 프론트매터의 title.
        const name = shell.title;
        const link = linksByKey.get(linkKey(shell.root, shell.ref));
        let target = link ? next[link.workProjectId] : undefined;
        // 휴면 Project는 새로 만들지 않는다 — 사이드바에 멤버 0인 줄이 서지 않게. 스냅샷에는
        // 남아 있으므로 `_archive` 레포의 역인덱스와 브리프는 계속 답한다. 이미 링크된 항목은
        // 아래로 내려가 멤버가 갱신된다: 상태가 바뀌었다고 사용자 데이터를 지우지 않는다.
        if (!target && shell.archived) continue;
        if (!target) {
          if (Object.values(next).some((workProject) => workProject.name === name)) {
            skipped.push(shell.ref);
            continue;
          }
```

그리고 태그 시드 줄과 그 위 주석을 이렇게 바꾼다.

```ts
        // 묶음 라벨과 topic을 태그로 한 번만 심는다. 표식은 "행이 아직 없다"는 사실 하나다 —
        // 사용자가 태그를 전부 지우면 빈 행이 남고, 그때부터 여기는 손대지 않는다. 구분(category)이
        // 만들 때 한 번만 정해지는 것(위 L26-27)과 같은 약속이다.
        if (!Object.prototype.hasOwnProperty.call(tagRegistry.tags, target.id)) {
          tagSeeds.set(target.id, normalizeTags([shell.groupLabel, ...shell.topics]));
        }
```

`syncFromWorkspace`의 doc 주석 첫 문단도 v2 어휘로 고친다.

```ts
  /**
   * ws-root 워크스페이스의 Project(v1 어휘로는 셸)를 업무 프로젝트로 옮겨 적는다. 루트 CLAUDE.md가
   * 프론트매터의 `repos:`를 레포→프로젝트 역인덱스의 SSOT로 정했으므로, 여기서는 그 사실을 앱의
   * 어휘로 반복할 뿐이다.
   *
   * 지키는 선:
   *  - **사용자가 손으로 만든 항목은 절대 건드리지 않는다.** 이름이 같은 항목이 이미 있으면 그
   *    Project는 건너뛴다(덮어쓰지도, 같은 이름을 하나 더 만들지도 않는다).
   *  - 자동 생성분도 **`members`만** 갱신한다. 이름·구분·상태·메모·노션 링크·순서는 만들 때 한 번
   *    정해지고 그 뒤로는 사용자의 것이다 — 워크스페이스의 `title`이 바뀌어도 덮어쓰지 않는다.
   *  - 휴면 Project는 새로 만들지 않는다. 이미 링크된 것은 그대로 둔다.
   *  - 수동 업무 프로젝트에 이미 속한 폴더는 가져오지 않는다 — 사용자가 옮겨 둔 자리가 이긴다.
   *  - 출처 표식은 `workspace.json`의 `shellLinks`에 둔다. `work-projects.json` 스키마는
   *    그대로다(레지스트리 계약 §8).
   */
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/main/projects/work-project-workspace-sync.test.ts`
Expected: PASS — 기존 v1 describe(14 케이스)와 새 v2 describe(7 케이스) 모두.

기존 v1 케이스 중 이름을 `ref`로 기대하던 것들이 이제 `title`을 본다는 점에 주의한다.
`work-project-workspace-sync.test.ts`의 `shell()` 헬퍼는 `title: overrides.shell`을 기본값으로 두므로
`VSP`는 `title: "가상수술계획"`이고, 이름을 `"O_SMCH/24_SMCH_VSP-1"`로 기대하던 세 곳이 깨진다.
다음과 같이 고친다.

| it | 기존 기대 | 새 기대 |
|---|---|---|
| `creates one work project per shell, with the default 구분 when no getter is wired` | `["O_SMCH/24_SMCH_VSP-1", "기타"], ["P_Personal/26_Personal_Career-1", "기타"]` | `["가상수술계획", "기타"], ["진로", "기타"]` |
| `skips a shell whose name a manual work project already uses, without overwriting it` | `createWorkProject({ name: "O_SMCH/24_SMCH_VSP-1", … })` | `createWorkProject({ name: "가상수술계획", … })` (`skipped` 기대 `["O_SMCH/24_SMCH_VSP-1"]`는 ref라 **그대로 둔다**) |

- [ ] **Step 5: 전체를 돌린다**

Run: `npm run typecheck`
Expected: 출력 없음.

Run: `npm test`
Expected: 전부 green. (`App.test.tsx`는 사이드바가 `workspaceShells`의 `title`을 쓰므로 영향이 없다 — 이미 title로 부르고 있었다.)

- [ ] **Step 6: 커밋**

```bash
git add src/main/projects/work-project-service.ts src/main/projects/work-project-workspace-sync.test.ts
git commit -m "feat: name synced work projects after the project title and skip dormant ones"
```

---

### Task 5: 브리프 2종 — PRJ 어휘와 조건부 팀즈·노션 문장

**Files:**
- Modify: `src/main/projects/workspace-brief.ts:18-131`
- Modify: `src/main/projects/work-project-brief.ts:23-63`
- Modify: `src/main/runtime.ts:299-306` (4번째 인수)
- Test: `src/main/projects/workspace-brief.test.ts`
- Test: `src/main/projects/work-project-brief.test.ts`

**Interfaces:**
- Consumes: Task 2·3의 `WorkspaceShellInfo`(`mode`·`groupLabel`·`drivePath`·`wikiPath`·`archived`).
- Produces:
  - `WorkspaceBriefInput.siblingShells`가 **`siblingProjects`로 개칭**된다(타입은 그대로 `WorkspaceBriefSibling[]`).
  - `renderWorkProjectBrief(workProject, members, tags?, options?: { teamsSyncRoot?: string | null })`.

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 워크스페이스 절**

`src/main/projects/workspace-brief.test.ts`의 `describe("renderWorkspaceBrief")`를 통째로 이렇게 바꾼다.

```ts
describe("renderWorkspaceBrief", () => {
  it("PRJ 머리 줄과 레포·형제 프로젝트·데이터셋·데이터 명세를 적는다", () => {
    const brief = renderWorkspaceBrief({
      shell: shellInfo("C:\\work", {
        ref: "projects/PRJ-0017-secondbrain",
        channel: "projects",
        shell: "PRJ-0017-secondbrain",
        groupLabel: "개인",
        title: "세컨드브레인(LLMwiki·atlas·bolt)",
        status: "active",
        mode: "continuous",
        path: path.join("C:\\work", "projects", "PRJ-0017-secondbrain"),
        drivePath: path.join("G:\\drive", "projects", "PRJ-0017-secondbrain"),
        wikiPath: path.join("C:\\dev", "llmwiki", "wiki"),
      }),
      rootPrinciplesPath: path.join("C:\\work", "CLAUDE.md"),
      siblingRepos: [{ name: "llmwiki", path: path.join("C:\\dev", "llmwiki") }],
      siblingProjects: [
        { title: "가계부", ref: "projects/PRJ-0016-finance", path: path.join("C:\\work", "projects", "PRJ-0016-finance") },
      ],
      datasets: [
        { id: "DS-0001", path: path.join("C:\\data", "patient", "26_SMCH_Occlusion-1") },
        { id: "DS-9999", path: null },
      ],
      dataNotes: "# 데이터\n- 교합 케이스 10건",
    });

    expect(brief).toContain("# 워크스페이스: projects/PRJ-0017-secondbrain");
    expect(brief).toContain("- 표시명: 세컨드브레인(LLMwiki·atlas·bolt)");
    expect(brief).toContain("- 상태: active");
    expect(brief).toContain("- 진행 방식: continuous");
    expect(brief).toContain("- 컨텍스트: 개인");
    expect(brief).toContain(`- 프로젝트 폴더: ${path.join("C:\\work", "projects", "PRJ-0017-secondbrain")}`);
    expect(brief).toContain(
      `- 프로젝트 문서: ${path.join("C:\\work", "projects", "PRJ-0017-secondbrain", "CLAUDE.md")}`,
    );
    expect(brief).toContain(`- drive 폴더: ${path.join("G:\\drive", "projects", "PRJ-0017-secondbrain")}`);
    expect(brief).toContain(`- 지식 정본: ${path.join("C:\\dev", "llmwiki", "wiki")}`);
    expect(brief).toContain(`- 루트 원칙: ${path.join("C:\\work", "CLAUDE.md")}`);
    expect(brief).toContain("## 이 프로젝트의 레포 (로컬 절대경로)");
    expect(brief).toContain(`- llmwiki: ${path.join("C:\\dev", "llmwiki")}`);
    expect(brief).toContain("## 같은 컨텍스트(개인)의 다른 프로젝트");
    expect(brief).toContain("- 가계부 (projects/PRJ-0016-finance)");
    expect(brief).toContain("## 이 프로젝트가 쓰는 데이터셋");
    expect(brief).toContain("- DS-9999: (data/index.md에 없음)");
    expect(brief).toContain("- 교합 케이스 10건");
    // 채널은 v2에 없는 개념이다.
    expect(brief).not.toContain("- 채널:");
  });

  it("값이 없는 줄과 절을 생략한다", () => {
    const brief = renderWorkspaceBrief({
      shell: shellInfo("C:\\work", { status: null, mode: null, groupLabel: "", repos: [], data: [] }),
      rootPrinciplesPath: path.join("C:\\work", "CLAUDE.md"),
      siblingRepos: [],
      siblingProjects: [],
      datasets: [],
      dataNotes: null,
    });
    expect(brief).not.toContain("- 상태:");
    expect(brief).not.toContain("- 진행 방식:");
    expect(brief).not.toContain("- 컨텍스트:");
    expect(brief).not.toContain("- drive 폴더:");
    expect(brief).not.toContain("- 지식 정본:");
    expect(brief).not.toContain("## 이 프로젝트의 레포");
    expect(brief).not.toContain("## 같은 컨텍스트");
    expect(brief).not.toContain("## 이 프로젝트가 쓰는 데이터셋");
    expect(brief).not.toContain("데이터 명세 발췌");
  });
});
```

그리고 `describe("buildWorkspaceBrief")`의 첫 it에서 절 제목 기대 두 줄을 고친다.

```ts
    // 형제는 같은 묶음 라벨만 — 다른 컨텍스트의 프로젝트는 이 세션과 무관하다.
    expect(brief).toContain("- FOAA (O_SMCH/25_SMCH_FOAA-1)");
    expect(brief).not.toContain("P_Personal/26_Personal_Career-1");
```

(이 픽스처는 `O_SMCH` 둘이 `groupLabel: "용역"`, `P_Personal`이 `"개인"`이라 기대값이 그대로 맞는다.)

같은 describe에 v2 케이스 두 개를 더한다.

```ts
  it("같은 묶음 라벨의 프로젝트만 형제로 세우고, 휴면끼리만 묶는다", async () => {
    const root = await tempWorkspace("brief-siblings");
    const base = (key: string, groupLabel: string, archived = false) =>
      shellInfo(root, {
        ref: `${archived ? "projects/_archive" : "projects"}/${key}`,
        channel: archived ? "projects/_archive" : "projects",
        shell: key,
        groupLabel,
        title: key,
        archived,
        path: path.join(root, archived ? path.join("projects", "_archive") : "projects", key),
        repos: key === "PRJ-0017-secondbrain" ? ["multi-cli-work"] : [],
        data: [],
      });
    const snapshot = snapshotFor(root, [
      base("PRJ-0017-secondbrain", "개인"),
      base("PRJ-0016-finance", "개인"),
      base("PRJ-0006-vsp", "병원 공동연구"),
      base("PRJ-0009-old", "개인", true),
    ]);

    const brief = await buildWorkspaceBrief(path.join(root, "dev", "multi-cli-work"), snapshot);
    expect(brief).toContain("## 같은 컨텍스트(개인)의 다른 프로젝트");
    expect(brief).toContain("PRJ-0016-finance");
    expect(brief).not.toContain("PRJ-0006-vsp");
    expect(brief).not.toContain("PRJ-0009-old");
  });

  it("묶음 라벨이 비어 있으면 형제 절이 없다", async () => {
    const root = await tempWorkspace("brief-no-label");
    const snapshot = snapshotFor(root, [
      shellInfo(root, { groupLabel: "", repos: ["VSP_FastAPI"], data: [] }),
      shellInfo(root, { ref: "O_SMCH/25_SMCH_FOAA-1", shell: "25_SMCH_FOAA-1", groupLabel: "", repos: [], data: [] }),
    ]);
    const brief = await buildWorkspaceBrief(path.join(root, "dev", "VSP_FastAPI"), snapshot);
    expect(brief).not.toContain("## 같은 컨텍스트");
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/main/projects/workspace-brief.test.ts`
Expected: FAIL — `siblingProjects`가 `WorkspaceBriefInput`에 없어 타입·실행 모두 깨진다.

- [ ] **Step 3: 워크스페이스 절을 구현한다**

`src/main/projects/workspace-brief.ts`의 `WorkspaceBriefInput`과 `renderWorkspaceBrief`를 이렇게 바꾼다.

```ts
export interface WorkspaceBriefInput {
  shell: WorkspaceShellInfo;
  /** 루트 마스터 원칙 파일(`<root>/CLAUDE.md`)의 절대경로. */
  rootPrinciplesPath: string;
  siblingRepos: WorkspaceBriefRepo[];
  /** 같은 묶음 라벨(v2 컨텍스트 · v1 채널 라벨)을 가진 다른 프로젝트. */
  siblingProjects: WorkspaceBriefSibling[];
  datasets: WorkspaceBriefDataset[];
  /** 프로젝트 `wiki/data.md` 앞부분. 없으면 null. */
  dataNotes: string | null;
}

export function renderWorkspaceBrief(input: WorkspaceBriefInput): string {
  const { shell } = input;
  const lines = [
    `# 워크스페이스: ${shell.ref}`,
    "",
    `- 표시명: ${shell.title}`,
    ...(shell.status ? [`- 상태: ${shell.status}`] : []),
    // mode는 여기 한 줄로만 쓰인다 — 앱의 어떤 코드도 이 값으로 분기하지 않는다.
    ...(shell.mode ? [`- 진행 방식: ${shell.mode}`] : []),
    ...(shell.groupLabel ? [`- 컨텍스트: ${shell.groupLabel}`] : []),
    `- 프로젝트 폴더: ${shell.path}`,
    `- 프로젝트 문서: ${path.join(shell.path, "CLAUDE.md")}`,
    // drive 짝 폴더는 DRIVE_ROOT가 설정되고 그 폴더가 실재할 때만 값이 있다.
    ...(shell.drivePath ? [`- drive 폴더: ${shell.drivePath}`] : []),
    ...(shell.wikiPath ? [`- 지식 정본: ${shell.wikiPath}`] : []),
    `- 루트 원칙: ${input.rootPrinciplesPath}`,
  ];
  if (input.siblingRepos.length > 0) {
    lines.push("", "## 이 프로젝트의 레포 (로컬 절대경로)");
    lines.push(...input.siblingRepos.map((repo) => `- ${repo.name}: ${repo.path}`));
  }
  if (input.siblingProjects.length > 0) {
    lines.push("", `## 같은 컨텍스트(${shell.groupLabel})의 다른 프로젝트`);
    lines.push(...input.siblingProjects.map((sibling) => `- ${sibling.title} (${sibling.ref}): ${sibling.path}`));
  }
  if (input.datasets.length > 0) {
    lines.push("", "## 이 프로젝트가 쓰는 데이터셋");
    lines.push(
      ...input.datasets.map((dataset) =>
        dataset.path ? `- ${dataset.id}: ${dataset.path}` : `- ${dataset.id}: (data/index.md에 없음)`,
      ),
    );
  }
  if (input.dataNotes) {
    lines.push("", `## 데이터 명세 발췌 (wiki/data.md 앞 ${DATA_NOTE_LINES}줄)`, input.dataNotes);
  }
  lines.push(
    "",
    "코드는 `dev/` 레포에, 문서·지식·데이터 명세는 프로젝트 폴더에 둔다. 다른 프로젝트의 지식은",
    "링크하지 말고 `/wiki-borrow`로 재검토·복제한다. 루트 원칙 파일이 이 워크스페이스의 상위 규칙이다.",
    "",
  );
  return lines.join("\n");
}
```

`buildWorkspaceBrief`의 `siblingShells` 블록을 이렇게 바꾼다.

```ts
    // 형제는 같은 묶음 라벨 + 같은 휴면 상태다. v1의 "같은 채널"보다 약간 넓지만(같은 라벨을 쓰는
    // 채널 둘이 한데 선다) v2에는 채널이 없고 `channel`은 모든 Project에 `"projects"`라 쓸 수 없다.
    siblingProjects:
      shell.groupLabel.length === 0
        ? []
        : snapshot.shells
            .filter(
              (candidate) =>
                candidate.groupLabel === shell.groupLabel &&
                candidate.archived === shell.archived &&
                candidate.ref !== shell.ref,
            )
            .map((candidate) => ({ title: candidate.title, ref: candidate.ref, path: candidate.path })),
```

파일 맨 위 doc 주석의 "그 셸이 무엇이고 옆에 무엇이 있는지" 문장에서 "셸"을 "프로젝트"로 바꾼다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/main/projects/workspace-brief.test.ts`
Expected: PASS

- [ ] **Step 5: 실패하는 테스트를 쓴다 — 업무 프로젝트 절의 조건부 문장**

`src/main/projects/work-project-brief.test.ts`의 `describe("renderWorkProjectBrief")` 첫 it에서
절 제목 기대 한 줄을 고친다(이 호출은 `teamsSyncRoot`를 넘기지 않는다).

```ts
    // Docs section precedes repos so the official-document location leads.
    expect(brief.indexOf("## 문서 폴더")).toBeGreaterThanOrEqual(0);
    expect(brief.indexOf("## 문서 폴더")).toBeLessThan(brief.indexOf("개발 레포"));
```

그리고 같은 describe 끝에 네 케이스를 더한다.

```ts
  it("팀즈 루트가 설정돼 있으면 제목과 맺음에 팀즈를 쓴다", () => {
    const brief = renderWorkProjectBrief(
      WORK_PROJECT,
      [{ project: project("2", path.join("C:", "Teams", "스마트팩토리")), role: "docs" }],
      [],
      { teamsSyncRoot: path.join("C:", "Teams") },
    );
    expect(brief).toContain("## 팀즈 문서 폴더 (공식 문서: 계획서·보고서·발표자료)");
    expect(brief).toContain("문서 작업은 팀즈 폴더, 진행 관리는 노션를 기준으로 한다.");
  });

  it("팀즈 루트가 없으면 어디에도 팀즈라는 말이 없다", () => {
    const brief = renderWorkProjectBrief(
      { ...WORK_PROJECT, notionLinks: [] },
      [{ project: project("2", path.join("C:", "work", "projects", "PRJ-0017-secondbrain")), role: "docs" }],
    );
    expect(brief).not.toContain("팀즈");
    expect(brief).toContain("## 문서 폴더 (공식 문서: 계획서·보고서·발표자료)");
    expect(brief).toContain("문서 작업은 위 문서 폴더를 기준으로 한다.");
  });

  it("노션 링크가 없으면 맺음에 노션이 없다", () => {
    const brief = renderWorkProjectBrief({ ...WORK_PROJECT, notionLinks: [] }, [
      { project: project("1", path.join("C:", "dev", "bolt")), role: "repo" },
    ]);
    expect(brief).toContain("코드는 위 레포 경로를 기준으로 한다.");
    expect(brief).not.toContain("노션");
  });

  it("문서·노션·레포가 모두 없으면 맺음이 첫 문장 하나다", () => {
    const brief = renderWorkProjectBrief({ ...WORK_PROJECT, notionLinks: [] }, []);
    expect(brief).toContain("이 세션은 위 업무 프로젝트에 소속된 작업 공간에서 실행 중이다.");
    expect(brief).not.toContain("를 기준으로 한다");
  });
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx vitest run src/main/projects/work-project-brief.test.ts`
Expected: FAIL — 네 번째 인수를 받지 않아 타입이 깨지고, 맺음이 여전히 고정 문구다.

- [ ] **Step 7: 업무 프로젝트 절을 구현한다**

`src/main/projects/work-project-brief.ts`의 `renderWorkProjectBrief`를 통째로 이렇게 바꾼다.

```ts
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
```

- [ ] **Step 8: 호출부에 팀즈 루트를 넘긴다**

`src/main/runtime.ts`의 `getWorkProjectBrief` 안 `renderWorkProjectBrief(` 호출을 이렇게 바꾼다.

```ts
      const workProjectSection = workProject
        ? renderWorkProjectBrief(
            workProject,
            workProject.members
              .map((member) => ({ project: registry.projects[member.projectId] ?? null, role: member.role }))
              .filter((member): member is WorkProjectBriefMember => member.project !== null),
            tags,
            // 팀즈 어휘를 쓸지는 이 설정 하나로 결정된다 — 없으면 브리프가 팀즈를 언급하지 않는다.
            { teamsSyncRoot: workProjectRegistry.teamsSyncRoot },
          )
        : null;
```

같은 함수의 doc 주석에서 "ws-root 워크스페이스(채널·셸·형제 레포·데이터셋)"를
"ws-root 워크스페이스(프로젝트·형제 레포·데이터셋)"로 바꾼다.

- [ ] **Step 9: 통과를 확인한다**

Run: `npx vitest run src/main/projects/work-project-brief.test.ts src/main/projects/workspace-brief.test.ts`
Expected: PASS — 2 파일.

Run: `npm run typecheck`
Expected: 출력 없음.

Run: `npm test`
Expected: 전부 green — 빨간 파일이 하나도 없다.

- [ ] **Step 10: 커밋**

```bash
git add src/main/projects/workspace-brief.ts src/main/projects/workspace-brief.test.ts src/main/projects/work-project-brief.ts src/main/projects/work-project-brief.test.ts src/main/runtime.ts
git commit -m "feat: speak PRJ vocabulary in session briefs and drop unconditional Teams and Notion copy"
```

---

### Task 6: 렌더러 — 기본 묶기 라벨 순서와 워크스페이스 탭 문구

**Files:**
- Modify: `src/renderer/src/sidebar-tree.ts:31-36, 47-51, 138-150`
- Modify: `src/renderer/src/ProjectSidebar.tsx:52-61(임포트), 74-79(주석), 486-494`
- Modify: `src/renderer/src/SettingsDialog.tsx:232, 236-241, 255, 290`
- Test: `src/renderer/src/sidebar-tree.test.ts:141-158` (재작성) + 새 describe
- Test: `src/renderer/src/SettingsDialog.test.tsx` (새 describe — 이 탭에는 지금 테스트가 없다)

**Interfaces:**
- Consumes: Task 2의 `WorkspaceShellInfo.groupLabel`.
- Produces:
  - `export const LEGACY_LABEL_ORDER` (구 `CHANNEL_LABEL_ORDER`)
  - `export function orderWorkspaceLabels(shells: readonly { groupLabel: string }[]): string[]`
  - `export function defaultGroupingTags(tagsByWorkProject, orderedLabels: readonly string[]): string[]` — 2번째 인수가 `boolean`에서 라벨 배열로 바뀐다.

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 라벨 순서**

`src/renderer/src/sidebar-tree.test.ts`의 임포트에 `orderWorkspaceLabels`를 더한다.

```ts
  defaultGroupingTags,
  groupKeys,
  orderWorkspaceLabels,
```

그리고 `describe("defaultGroupingTags")` 블록을 통째로 이렇게 바꾼다.

```ts
describe("orderWorkspaceLabels", () => {
  it("옛 채널 라벨을 앞으로 세운다 — 채널 층이 있던 때의 화면 순서가 그대로다", () => {
    expect(
      orderWorkspaceLabels([{ groupLabel: "개인" }, { groupLabel: "용역" }, { groupLabel: "과제" }]),
    ).toEqual(["과제", "용역", "개인"]);
  });

  it("v2 컨텍스트는 처음 나온 순서를 그대로 따른다", () => {
    expect(
      orderWorkspaceLabels([
        { groupLabel: "개인" },
        { groupLabel: "병원 공동연구" },
        { groupLabel: "개인" },
        { groupLabel: "외부기관 협업" },
      ]),
    ).toEqual(["개인", "병원 공동연구", "외부기관 협업"]);
  });

  it("옛 라벨과 새 컨텍스트가 섞이면 옛 라벨이 먼저다", () => {
    expect(
      orderWorkspaceLabels([{ groupLabel: "병원 공동연구" }, { groupLabel: "개인" }, { groupLabel: "디지트랙" }]),
    ).toEqual(["개인", "병원 공동연구", "디지트랙"]);
  });

  it("빈 라벨과 중복은 빠진다", () => {
    expect(orderWorkspaceLabels([{ groupLabel: "" }, { groupLabel: "개인" }, { groupLabel: "개인" }])).toEqual([
      "개인",
    ]);
    expect(orderWorkspaceLabels([])).toEqual([]);
  });
});

describe("defaultGroupingTags", () => {
  it("묶을 라벨이 없으면 묶지 않는다 — 이 기능이 없던 때와 같은 평면 트리다", () => {
    expect(defaultGroupingTags({ "wp-a": ["용역", "개인"] }, [])).toEqual([]);
  });

  it("실제로 붙어 있는 라벨만 준 순서대로 고른다", () => {
    expect(
      defaultGroupingTags({ "wp-a": ["개인"], "wp-b": ["용역"], "wp-c": ["과제"] }, ["과제", "용역", "개인"]),
    ).toEqual(["과제", "용역", "개인"]);
  });

  it("붙어 있지 않은 라벨은 기본값에 끼지 않는다", () => {
    expect(defaultGroupingTags({ "wp-a": ["AI", "연구"] }, ["연구", "개인"])).toEqual(["연구"]);
    expect(defaultGroupingTags({ "wp-a": ["AI"] }, ["연구", "개인"])).toEqual([]);
  });

  it("v2 컨텍스트 라벨도 똑같이 고른다", () => {
    expect(
      defaultGroupingTags({ "wp-a": ["개인", "지식관리"], "wp-b": ["병원 공동연구"] }, [
        "개인",
        "병원 공동연구",
        "디지트랙",
      ]),
    ).toEqual(["개인", "병원 공동연구"]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/renderer/src/sidebar-tree.test.ts`
Expected: FAIL — `orderWorkspaceLabels` 임포트가 없다.

- [ ] **Step 3: `sidebar-tree.ts`를 고친다**

3-1. 32-34행 주석의 `CHANNEL_LABEL_ORDER`를 `LEGACY_LABEL_ORDER`로 바꾼다.

3-2. 47-51행을 이렇게 바꾼다.

```ts
/**
 * 옛 ws-root 채널 라벨의 고정 순서. 기본 묶기가 이 라벨들을 **앞으로** 세우기 때문에, 채널 층이
 * 있던 때의 화면 순서가 그대로 보존된다(루트 CLAUDE.md §1의 채널 어휘). v2 PRJ 구조의 컨텍스트
 * 라벨은 사용자 데이터라 여기 적지 않는다 — 스냅샷에 나온 순서를 그대로 따른다.
 */
export const LEGACY_LABEL_ORDER = ["과제", "용역", "연구", "기타", "개인"] as const;
```

3-3. 파일 끝의 `defaultGroupingTags`를 주석까지 이렇게 바꾼다.

```ts
/**
 * 워크스페이스가 심어 주는 묶음 라벨을 기본 묶기 순서로 정렬한다. 옛 채널 라벨이 먼저, 나머지는
 * 처음 나온 순서대로. 빈 라벨(컨텍스트 미기재)은 묶을 이름이 없으므로 빠진다.
 */
export function orderWorkspaceLabels(shells: readonly { groupLabel: string }[]): string[] {
  const seen: string[] = [];
  for (const shell of shells) {
    if (shell.groupLabel.length > 0 && !seen.includes(shell.groupLabel)) seen.push(shell.groupLabel);
  }
  const rank = (label: string) => {
    const index = LEGACY_LABEL_ORDER.indexOf(label as (typeof LEGACY_LABEL_ORDER)[number]);
    return index < 0 ? LEGACY_LABEL_ORDER.length : index;
  };
  return seen
    .map((label, index) => ({ label, index }))
    .sort((left, right) => rank(left.label) - rank(right.label) || left.index - right.index)
    .map((entry) => entry.label);
}

/**
 * 저장된 선호가 없을 때 도는 묶기. 워크스페이스가 심어 둔 라벨 중 **실제로 붙어 있는 것만** 준
 * 순서대로 쓰고, 라벨이 없으면 묶지 않는다 — 이 기능이 없던 때와 같은 평면 트리다. 렌더마다
 * 파생하는 값이라 저장하지 않으며, 사용자가 한 번 고르면 그때부터 저장된 값이 이긴다.
 */
export function defaultGroupingTags(
  tagsByWorkProject: Readonly<Record<string, readonly string[]>>,
  orderedLabels: readonly string[],
): string[] {
  const present = new Set(Object.values(tagsByWorkProject).flatMap((tags) => [...tags]));
  return orderedLabels.filter((label) => present.has(label));
}
```

- [ ] **Step 4: `ProjectSidebar.tsx` 호출부를 고친다**

4-1. `./sidebar-tree` 임포트 목록에 `orderWorkspaceLabels`를 더한다(`groupKeys` 다음 줄).

```ts
  groupKeys,
  orderWorkspaceLabels,
  GROUP_KEY_PREFIX,
```

4-2. 486-494행을 이렇게 바꾼다.

```ts
  /**
   * 저장된 선호(`groupingTags`)가 있으면 그것이 이기고, 없을 때만 파생 기본값이 돈다 — 워크스페이스
   * 프로젝트가 심어 둔 묶음 라벨로, 라벨이 하나도 없으면 평면으로.
   */
  const orderedLabels = useMemo(() => orderWorkspaceLabels(Object.values(workspaceShells)), [workspaceShells]);
  const effectiveGrouping = useMemo(
    () => groupingTags ?? defaultGroupingTags(tagsByWorkProject, orderedLabels),
    [groupingTags, tagsByWorkProject, orderedLabels],
  );
```

4-3. `workspaceShells` prop의 doc 주석(74-79행)을 이렇게 바꾼다.

```ts
  /**
   * ws-root 워크스페이스의 프로젝트에서 만들어진 업무 프로젝트만, id → 그 프로젝트. 여기 있는
   * 항목은 워크스페이스의 한글 `title`로 불린다. 하나라도 있으면 저장된 묶기 선호가 없을 때 그
   * 묶음 라벨이 기본 묶기로 돌고, 비어 있으면(루트 미등록) 트리는 이 기능이 없던 때와 똑같이
   * 평면으로 그려진다.
   */
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run src/renderer/src/sidebar-tree.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: 출력 없음. (`hasWorkspaceShells`를 아직 읽는 곳이 남아 있으면 여기서 잡힌다.)

- [ ] **Step 6: 실패하는 테스트를 쓴다 — 워크스페이스 탭 문구**

`src/renderer/src/SettingsDialog.test.tsx` 맨 끝에 새 describe를 붙인다.

```tsx
/**
 * 이 탭에는 지금까지 테스트가 없었다 — 문구가 v2 어휘로 바뀌는 지점이라 여기서 못박는다.
 * `WorkspaceSettings`는 내부 컴포넌트이므로 대화상자를 띄워 탭을 눌러 들어간다.
 */
describe("워크스페이스 탭", () => {
  const prjShell = (key: string, title: string, groupLabel: string) => ({
    root: "C:\\work",
    ref: `projects/${key}`,
    channel: "projects",
    shell: key,
    groupLabel,
    topics: [],
    title,
    status: "active",
    mode: "continuous",
    archived: false,
    path: `C:\\work\\projects\\${key}`,
    repos: [],
    externalPaths: [],
    data: [],
    drivePath: null,
    wikiPath: null,
  });

  const snapshotOf = (warnings: string[] = []) => ({
    registry: {
      schemaVersion: 1,
      updatedAt: "2026-09-21T00:00:00.000Z",
      roots: [{ work: "C:\\work", dev: "C:\\dev", data: "C:\\data", label: "work-root" }],
      shellLinks: [],
    },
    shells: [
      prjShell("PRJ-0017-secondbrain", "세컨드브레인", "개인"),
      prjShell("PRJ-0006-vsp", "가상수술계획", "병원 공동연구"),
    ],
    repoOwners: {},
    warnings,
  });

  const list = vi.fn();
  const sync = vi.fn();

  beforeEach(() => {
    list.mockReset().mockResolvedValue(snapshotOf());
    sync.mockReset().mockResolvedValue({ workspace: snapshotOf(), workProjects: null });
    window.multiCliWork = {
      ...window.multiCliWork,
      workspace: { list, add: vi.fn(), remove: vi.fn(), sync },
    } as unknown as MultiCliWorkApi;
  });

  const openTab = async () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "워크스페이스" }));
    await waitFor(() => expect(list).toHaveBeenCalled());
  };

  it("루트 한 줄에 dev·data와 프로젝트 수를 적는다", async () => {
    await openTab();
    await waitFor(() => expect(screen.getByText(/프로젝트 2개/)).toBeInTheDocument());
    expect(screen.queryByText(/셸 2개/)).toBeNull();
  });

  it("다시 읽기 알림이 프로젝트 어휘를 쓴다", async () => {
    await openTab();
    fireEvent.click(screen.getByRole("button", { name: "다시 읽기" }));
    await waitFor(() => expect(screen.getByText("프로젝트를 다시 읽었습니다")).toBeInTheDocument());
  });

  it("스캔 경고를 그대로 보여 준다", async () => {
    list.mockResolvedValue(
      snapshotOf(["[project-key] projects/not-a-key: 프로젝트 키 규약 위반(PRJ-####-slug)"]),
    );
    await openTab();
    await waitFor(() =>
      expect(
        screen.getByText("[project-key] projects/not-a-key: 프로젝트 키 규약 위반(PRJ-####-slug)"),
      ).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 7: 실패를 확인한다**

Run: `npx vitest run src/renderer/src/SettingsDialog.test.tsx -t "워크스페이스 탭"`
Expected: FAIL — `프로젝트 2개`가 없다(현재는 `셸 2개`다), 알림 문구가 `셸을 다시 읽었습니다`다.

- [ ] **Step 8: `SettingsDialog.tsx` 문구를 고친다**

8-1. 232행.

```ts
  const projectsOf = (work: string) => (snapshot?.shells ?? []).filter((shell) => shell.root === work).length;
```

8-2. 237-241행의 안내문.

```tsx
      <p className="settings-hint">
        Project 폴더(<code>projects/PRJ-####-slug</code>)와 <code>dev/</code> 레포가 사는 폴더입니다.
        등록하면 사이드바가 레포를 소속 프로젝트 아래로 묶고, 세션 브리프에 형제 레포·데이터셋
        경로가 붙습니다. 워크스페이스의 파일은 읽기만 합니다.
      </p>
```

8-3. 254-256행의 요약 줄.

```tsx
                <span className="settings-hint">
                  dev {root.dev} · data {root.data} · 프로젝트 {projectsOf(root.work)}개
                </span>
```

8-4. 290행의 알림 문구.

```ts
              run(async () => (await window.multiCliWork.workspace.sync()).workspace, "프로젝트를 다시 읽었습니다")
```

8-5. 191행 부근 `WorkspaceSettings`의 doc 주석에서 "ws-root 워크스페이스 루트"는 그대로 두고, 그
아래에 한 줄을 더한다.

```ts
 * 2026-09-05부터 루트의 단위는 `projects/PRJ-####-slug` 평면 구조다 — 옛 `<채널>/<셸>` 배치는
 * `workspace-index.ts`의 폴백이 계속 읽는다.
```

- [ ] **Step 9: 통과를 확인한다**

Run: `npx vitest run src/renderer/src/SettingsDialog.test.tsx src/renderer/src/sidebar-tree.test.ts src/renderer/src/App.test.tsx`
Expected: PASS — 3 파일.

Run: `npm run typecheck`
Expected: 출력 없음.

Run: `npm test`
Expected: 전부 green — 빨간 파일이 하나도 없다.

- [ ] **Step 10: 커밋**

```bash
git add src/renderer/src/sidebar-tree.ts src/renderer/src/sidebar-tree.test.ts src/renderer/src/ProjectSidebar.tsx src/renderer/src/SettingsDialog.tsx src/renderer/src/SettingsDialog.test.tsx
git commit -m "feat: derive default grouping labels from the workspace and rename channel copy"
```

---

### Task 7: 릴리스 v1.31.0 준비

파일만 준비한다. **push 하지 않고 태그도 만들지 않는다.**

**Files:**
- Create: `docs/release/v1.31.0.md`
- Modify: `README.md:254` (최신 변경 링크)
- Modify: `package.json` · `package-lock.json` (`version`)

**Interfaces:**
- Consumes: Task 1-6의 결과.
- Produces: `v1.31.0` 태그를 푸시할 준비가 된 작업 트리.

- [ ] **Step 1: 전체 검증을 돌려 숫자를 확보한다**

Run: `npm test`
Expected: 전부 green. 마지막 두 줄의 `Test Files …` / `Tests …` 숫자를 그대로 적어 둔다 —
Step 2의 릴리스 노트가 그 두 숫자를 쓴다. 기준선이 `120 passed` / `1387 passed`였으므로 이 계획이
더한 테스트만큼 늘어 있어야 한다.

Run: `npm run typecheck`
Expected: 출력 없음.

Run: `npm run build`
Expected: `electron-vite build`가 오류 없이 끝난다.

- [ ] **Step 2: 릴리스 노트를 쓴다**

`docs/release/v1.31.0.md`를 만든다. `<테스트 파일 수>`·`<테스트 수>`는 Step 1에서 적어 둔 숫자로 채운다.

```markdown
# v1.31.0 — ws-root PRJ-key 구조 재연동

2026-09-05에 워크스페이스가 옛 `<채널>/<셸>` 2단 구조에서 `projects/PRJ-####-slug` 평면 구조로 옮겨 가면서 끊겼던 업무 프로젝트 자동 동기화가 다시 돈다. 세션 브리프도 PRJ 어휘로 말하고, 설정되지 않은 팀즈·노션을 더 이상 언급하지 않는다.

- 워크스페이스 루트를 훑을 때 `projects/<PRJ-key>/PROJECT.yaml`(휴면은 `projects/_archive/`)을 읽는다. 옛 `<채널>/<셸>` 배치는 그대로 폴백으로 남아 있어, 아직 옮기지 않은 루트도 지금까지처럼 동작한다.
- 업무 프로젝트 이름이 `PROJECT.yaml`의 `title`이 된다(예전에는 `O_SMCH/24_SMCH_VSP-1` 같은 폴더 경로였다). 이름·구분·상태·메모는 만들 때 한 번 정해지고 그 뒤로는 사용자의 것이다 — 워크스페이스에서 `title`이 바뀌어도 덮어쓰지 않는다.
- 태그 자동 시드가 채널 라벨 대신 `primaryContext`와 `topics`를 심는다. 저장된 묶기 선호가 없으면 그 라벨들로 기본 묶기가 돈다.
- 휴면(`projects/_archive/`) 프로젝트는 업무 프로젝트를 새로 만들지 않는다. 다만 `dev/_archive/` 레포의 소속과 세션 브리프는 계속 답한다.
- 세션 브리프의 워크스페이스 절이 PRJ-key·표시명·상태·진행 방식·컨텍스트·프로젝트 폴더·프로젝트 문서·루트 원칙을 적고, `DRIVE_ROOT`가 설정되고 짝 폴더가 실재할 때만 drive 폴더 줄을, `wikiSource`가 풀릴 때만 지식 정본 줄을 더한다.
- 업무 프로젝트 절의 맺음 문장을 실제로 실린 절에서 조립한다. 팀즈 동기화 루트가 설정되지 않았으면 "팀즈"라는 말이 브리프 어디에도 나오지 않고, 노션 링크가 없으면 노션을 언급하지 않는다.
- 설정 › 워크스페이스의 "셸" 어휘가 "프로젝트"로 바뀌었다.

## 업그레이드 절차 (한 번)

이 버전은 저장 파일 형식을 바꾸지 않으므로 그냥 올려도 된다. 다만 워크스페이스 루트를 등록해 두지 않았고 업무 프로젝트를 손으로 만들어 쓰고 있었다면, 아래 절차로 한 번 합치면 분류가 PRJ 하나로 모인다.

1. 설정 › 워크스페이스 루트에서 `C:\work`를 등록한다. 활성 프로젝트마다 업무 프로젝트가 생긴다(멤버는 아직 0개다 — 폴더들이 기존 수제 업무 프로젝트에 속해 있기 때문이다).
2. 기존 수제 업무 프로젝트를 삭제한다. 폴더 목록은 그대로 남고 미분류로 내려앉는다.
3. 설정 › **다시 읽기**. 각 폴더가 `PROJECT.yaml`의 `repos:`에 따라 제 프로젝트 아래로 붙는다.
4. 세 루트(`work`·`dev`·`data`) 밖에 있는 폴더는 붙을 자리가 없다. 필요하면 수제 업무 프로젝트 하나에 모아 둔다.

## 검증

- 전체 Vitest(<테스트 파일 수>개 파일, <테스트 수>개 테스트) 및 TypeScript(main/renderer 양쪽) 통과
- Electron E2E 전체 통과
- 수동 확인: 루트 등록 후 첫 동기화, 다시 읽기, 기본 묶기 라벨, 세션 브리프의 drive·지식 정본 줄 유무, 팀즈 루트 미설정 상태의 브리프

## 릴리스 자산

- `Multi-CLI-Work-Setup-1.31.0.exe` 및 blockmap
- `Multi-CLI-Work-1.31.0-linux-x64.deb` / `.AppImage`
- `latest.yml`, `latest-linux.yml`
```

- [ ] **Step 3: README의 최신 변경 링크를 옮긴다**

`README.md` 254행 끝의 두 곳을 `v1.30.1` → `v1.31.0`으로 바꾼다.

```
최신 변경은 [`docs/release/v1.31.0.md`](docs/release/v1.31.0.md)에서 확인한다.
```

- [ ] **Step 4: 버전을 올린다**

Run: `npm --no-git-tag-version version 1.31.0`
Expected: `v1.31.0`이 출력되고 `package.json`·`package-lock.json`의 `version`이 함께 올라간다.
커밋도 태그도 만들어지지 않는다(`--no-git-tag-version`). 이 저장소에는 `version` 계열 npm 라이프사이클
스크립트가 없어 부수효과가 없다.

Run: `git diff --stat package.json package-lock.json`
Expected: 두 파일만, 각각 소수의 줄.

- [ ] **Step 5: e2e를 1회 돌린다**

Run: `npm run test:e2e`
Expected: 전체 통과. 이 계획은 `e2e/desktop.spec.ts`를 수정하지 않았으므로 기대값 변경이 없다.
실패하면 Global Constraints의 e2e 절을 다시 읽고 원인이 이 작업인지 환경인지 가린다.

- [ ] **Step 6: 커밋**

```bash
git add docs/release/v1.31.0.md README.md package.json package-lock.json
git commit -m "chore: prepare v1.31.0 release"
```

- [ ] **Step 7: 넘길 것을 정리한다**

push·태그는 하지 않는다. 다음 두 줄을 사람에게 보고한다.

- `git log --oneline 4f592d4..HEAD` 결과(7개 커밋)
- Step 1·5에서 확인한 테스트·타입·빌드·e2e 결과

---

## 자기검토

**1. 스펙 커버리지**

| 스펙 결정 | Task |
|---|---|
| D1 어댑터(`channel = "projects"`) | 1·3 |
| D2 `ref = channel/shell` | 1·3 (Task 4 테스트가 링크 재사용으로 못박는다) |
| D3 `PROJECT.yaml`이 원본, 인덱스는 `roots`만 | 3 |
| D4 `parseYamlFlat` 재사용, 의존성 없음 | 3 (Global Constraints) |
| D5 타입 필드 개편 | 2 |
| D6 `groupLabel = primaryContext` | 3 |
| D7 태그 시드 `[primaryContext, ...topics]` | 4 |
| D8 `mode`는 문자열 전용 | 2(주석)·5(브리프 한 줄) |
| D9 휴면은 스냅샷에 넣고 생성만 제외 | 3(스캔)·4(제외) |
| D10 마이그레이션 코드 없음, 수동 절차 | 7(릴리스 노트의 업그레이드 절차) |
| D11 `name = title`, set-once | 4 |
| D12 kind 어휘를 정본에 맞춤 | 1 |
| D13 UI 문구 교체 | 6 |
| D14 조건부 팀즈·노션 맺음 | 5 |
| D15 v2 `externalPaths`는 논리 경로 — `resolveLogicalPath`로 풀고 못 푸는 값은 조용히 뺀다 | 3 (테스트 3케이스 + `resolveLogicalPath` 한글·괄호 벡터) |
| D16 한 경로·레포를 여러 Project가 등록하면 마지막이 이긴다 + `[path-owner]`/`[repo-owner]` 경고 | 3 (테스트 2케이스) |
| 오류·경계 표 (인덱스 없음·v1 인덱스·drive 없음·키 위반·YAML 없음·title 없음·컨텍스트 없음·혼재·archived) | 3(9케이스)·4(2케이스)·5(2케이스) |
| 다운그레이드 안전성 | Global Constraints + Task 2의 "메모리 전용 타입" 근거 |
| 릴리스 v1.31.0 | 7 |
| 하지 않는 것 (`datasets[]` 대신 `data/index.md` 유지, `legacy.*` 자동 연결 없음, `WorkspaceRoot`에 drive 추가 없음) | 어느 Task도 건드리지 않는다 |

빠진 요구는 없다.

**2. 플레이스홀더 점검**

"TBD"·"추후"·"적절히"·"비슷하게"는 없다. 릴리스 노트의 `<테스트 파일 수>`·`<테스트 수>`는 Task 7 Step 1이
어느 명령의 어느 줄에서 읽어 채우는지 지정한 실측값 자리다.

**3. 타입 일관성**

- `groupLabel`·`topics`·`mode`·`archived`·`drivePath`·`wikiPath`는 Task 2에서 정의한 이름 그대로 Task 3·4·5·6에서 쓰인다.
- `resolveLogicalPath(root, extra, logical)`의 인수 순서와 `ExtraRoots`의 필드 이름(`drive`·`onedrive`)이 Task 3 안에서 일치하고, `wikiPath`·`externalPaths` 두 호출이 같은 시그니처를 쓴다.
- `cleanWorkspacePath`는 v1 경로(`shellInfoFrom`)에만 남고 v2는 `resolveLogicalPath`만 쓴다 — 그래서 Task 3의 임포트 목록에 둘 다 있다.
- 경고 접두는 다섯 개(`[project-key]`·`[project-yaml]`·`[legacy-layout]`·`[repo-owner]`·`[path-owner]`)이고 Task 3의 구현·테스트·`Produces` 세 곳이 같은 문자열을 쓴다.
- `siblingProjects`는 Task 5에서 한 번에 개칭되고, 그 뒤 어느 Task도 `siblingShells`를 쓰지 않는다.
- `defaultGroupingTags`의 2번째 인수는 Task 6에서 `boolean` → `readonly string[]`으로 한 번에 바뀌고, 호출부(`ProjectSidebar.tsx`)가 같은 Task에서 함께 바뀐다.
- `LEGACY_LABEL_ORDER`는 Task 6 안에서만 쓰이며, 구 이름 `CHANNEL_LABEL_ORDER`의 남은 참조는 같은 Task의 주석 수정으로 사라진다.
- Task 2가 타입과 그 모든 읽기·쓰기 지점을 한 커밋에 담으므로, 각 Task 끝에서 `npm run typecheck`가 green이다.
