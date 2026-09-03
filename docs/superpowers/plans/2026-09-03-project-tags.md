# 업무 프로젝트 태그와 "태그로 묶어 보기" — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업무 프로젝트에 자유 태그를 붙이고, 사이드바 "묶기"로 고른 태그 순서대로 트리를 임시로 묶어 보며, ws-root 채널 층을 그 일반 태그 묶음으로 대체한다.

**Architecture:** 태그는 별도 레지스트리 `~/.multi-cli-work/project-tags.json`(`json-store` 프로토콜, exact-keys 최상위)에 살고 `project-tags:list`/`set` IPC로 오간다. 순수 함수(`project-tags-types.ts` 정규화·조회, `tag-color.ts` 해시 팔레트, `sidebar-tree.ts` 태그 묶음·기본 묶기)가 계약을 지고, 컴포넌트(`TagEditor`·`TagChips`·`TagGroupingPicker`)는 그리기만 한다. ws-root 동기화는 "태그 행이 없을 때만" 채널 라벨을 심는다. `WorkProject` 타입·`work-projects.json`·기존 레지스트리는 불변.

**Tech Stack:** Electron + electron-vite, React 18 + TypeScript, vitest(콜로케이션, @testing-library/react), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-09-03-project-tags-design.md`

## Global Constraints

- **`work-projects.json`·`projects.json`·`state.json`·`workspace.json`·`worktrees.json` 스키마와 `WorkProject` 타입은 바꾸지 않는다**(레지스트리 계약 §8). 태그는 `project-tags.json`에만.
- 태그 정규화 규칙: trim → 빈 값 제거 → 32자 절단(`MAX_TAG_LENGTH = 32`) → 중복 제거(대소문자 구분, 첫 등장 순서 유지). 파서·저장·편집기·동기화 전부 `normalizeTags` 하나를 쓴다.
- **빈 배열 행(`tags[id] = []`)은 파서·`set`·`prune` 어디서도 지우지 않는다** — 행의 존재가 "사용자가 태그를 손댔다"는 표식이고, 동기화는 행이 없을 때만 채널 라벨을 심는다.
- 묶기 규칙: 고른 순서대로 첫 일치 태그 아래 한 번만; 어느 태그도 없으면 `기타`(항상 마지막); 미분류 폴더 묶음은 묶음 밖 최상위, 기타보다 뒤; 묶음은 첫 구성원의 자리를 차지한다. 접힘 키 `tag:<이름>`, 기타는 `tag:`. 기본 묶기 = 저장된 선호가 없고 ws-root 셸이 있을 때 실제로 붙어 있는 채널 라벨 태그를 `["과제","용역","연구","기타","개인"]` 순으로; 파생값이며 저장하지 않는다.
- 사용자 문구(한국어, 그대로): 상세 페이지 라벨 `태그`, 입력 `aria-label="태그 추가"`, 칩 제거 `"{태그} 태그 제거"`; 묶기 버튼 `aria-label="묶기 설정"`, 표시 `묶기: a › b` / `묶기: 없음`, 메뉴 항목 `묶기 해제`; 묶음 노드 토글 `"{라벨} 접기"`/`"{라벨} 펼치기"`, 기타 묶음 라벨 `기타`; 트리 컨트롤 title `모든 묶음과 프로젝트 펼치기` / `모든 묶음과 프로젝트 접기` / `작업중인 폴더가 있는 묶음과 프로젝트만 펼치기`; 빠른 열기 종류 라벨 `프로젝트`; 브리프 줄 `- 태그: a, b`.
- 세션 패널·세션 행·폴더 행의 접근성 이름과 클래스는 손대지 않는다. `multi-cli-work.sidebar.v1`은 버전 1 유지, `groupingTags` 키만 추가(없으면 `null`).
- 커밋: 브랜치 `feat/project-tags`에 태스크마다 커밋. 제목 `feat(tags): …` / `refactor(sidebar): …` / `test(...)` 한국어 요약, 본문 한두 문장, 마지막 줄 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `git add`는 명시한 파일만, `--amend`·push·merge 금지. `package-lock.json`이 바뀌어 있으면 `git checkout -- package-lock.json`.
- 이 머신의 Git Bash는 간헐적으로 `fork` 오류를 내므로 git·npm은 PowerShell로. 검증은 `npx vitest run <파일>`, `npm test`, `npm run typecheck`(lint 스크립트 없음). 워크트리에서도 `npm run test:e2e:smoke`가 동작한다.
- shared 코드는 renderer에서 `@shared/...`, main에서 상대경로로 import. 테스트는 소스 옆 콜로케이션. 코드 주석은 이 레포 관례대로 *왜*를 적는다.

---

### Task 1: 공유 타입과 정규화 (`project-tags-types.ts`)

**Files:**
- Create: `src/shared/project-tags-types.ts`
- Test: `src/shared/project-tags-types.test.ts`

**Interfaces:**
- Consumes: 없음(Electron·DOM 의존 금지).
- Produces:
  ```ts
  export const MAX_TAG_LENGTH = 32;
  export interface ProjectTagsV1 { schemaVersion: 1; updatedAt: string; tags: Record<string, string[]> }
  export function normalizeTags(values: readonly unknown[]): string[];
  export function tagsOf(registry: ProjectTagsV1 | null | undefined, workProjectId: string): string[];
  export function tagsByWorkProject(registry: ProjectTagsV1 | null | undefined, knownIds: Iterable<string>): Record<string, string[]>;
  export function knownTags(byWorkProject: Readonly<Record<string, readonly string[]>>): string[];
  ```

- [ ] **Step 1: 실패하는 테스트** — `src/shared/project-tags-types.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MAX_TAG_LENGTH, knownTags, normalizeTags, tagsByWorkProject, tagsOf, type ProjectTagsV1 } from "./project-tags-types";

const registry: ProjectTagsV1 = {
  schemaVersion: 1,
  updatedAt: "2026-09-03T00:00:00.000Z",
  tags: { "wp-a": ["개인", "AI"], "wp-b": ["AI"], "wp-gone": ["연구"], "wp-empty": [] },
};

describe("normalizeTags", () => {
  it("앞뒤 공백을 지우고 빈 값과 문자열 아닌 값을 버린다", () => {
    expect(normalizeTags([" 연구 ", "", "   ", 3, null, undefined, "AI"])).toEqual(["연구", "AI"]);
  });
  it("공백만 다른 값은 하나로 합치되 대소문자는 구분한다", () => {
    expect(normalizeTags(["연구", "연구 ", "Research", "research"])).toEqual(["연구", "Research", "research"]);
  });
  it("32자에서 자른 뒤 중복을 제거하고 첫 등장 순서를 지킨다", () => {
    const long = "a".repeat(MAX_TAG_LENGTH + 1);
    expect(normalizeTags([long, "b", "a".repeat(MAX_TAG_LENGTH)])).toEqual(["a".repeat(MAX_TAG_LENGTH), "b"]);
  });
});

describe("tagsOf / tagsByWorkProject", () => {
  it("행이 없거나 레지스트리가 없으면 빈 배열이다", () => {
    expect(tagsOf(registry, "missing")).toEqual([]);
    expect(tagsOf(null, "wp-a")).toEqual([]);
    expect(tagsOf(registry, "wp-a")).toEqual(["개인", "AI"]);
  });
  it("아는 업무 프로젝트의 행만 남기고 빈 행은 빈 배열로 남긴다", () => {
    expect(tagsByWorkProject(registry, ["wp-a", "wp-b", "wp-empty", "wp-new"])).toEqual({
      "wp-a": ["개인", "AI"], "wp-b": ["AI"], "wp-empty": [],
    });
  });
});

describe("knownTags", () => {
  it("많이 쓰인 태그가 앞, 동률이면 이름순이다", () => {
    expect(knownTags({ a: ["개인", "AI"], b: ["AI"], c: ["연구", "AI"], d: ["가나"] })).toEqual(["AI", "가나", "개인", "연구"]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/shared/project-tags-types.test.ts` → 모듈 없음.

- [ ] **Step 3: 구현** — `src/shared/project-tags-types.ts`

```ts
/**
 * 업무 프로젝트 자유 태그. `work-projects.json`이 아니라 **별도 파일**(`project-tags.json`)에 산다 —
 * 그 파일의 파서가 exact-keys라 필드를 하나 더하면 구버전 앱이 목록 전체를 거부하기 때문이다
 * (docs/superpowers/specs/registry-contract.md §8). 구버전은 모르는 파일을 그냥 무시한다.
 */
export const MAX_TAG_LENGTH = 32;

export interface ProjectTagsV1 {
  schemaVersion: 1;
  updatedAt: string;
  /**
   * workProjectId → 태그. **빈 배열 행을 지우지 않는다** — 행이 있다는 사실이 "사용자가 한 번은
   * 태그를 손댔다"는 표식이고, ws-root 동기화는 그 표식만 보고 채널 라벨을 다시 심을지 정한다.
   * 사라진 업무 프로젝트의 행은 읽는 쪽이 지나치고 동기화가 정리한다.
   */
  tags: Record<string, string[]>;
}

/** trim → 빈 값 제거 → 32자 절단 → 중복 제거(대소문자 구분, 첫 등장 순서). 절단이 중복 제거보다 먼저다. */
export function normalizeTags(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const tag = value.trim().slice(0, MAX_TAG_LENGTH);
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

export function tagsOf(registry: ProjectTagsV1 | null | undefined, workProjectId: string): string[] {
  return registry?.tags[workProjectId] ?? [];
}

/** 트리·배지가 쓰는 조회 맵. 지금 존재하는 업무 프로젝트의 행만 남는다. */
export function tagsByWorkProject(
  registry: ProjectTagsV1 | null | undefined,
  knownIds: Iterable<string>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!registry) return result;
  for (const id of knownIds) {
    const tags = registry.tags[id];
    if (tags) result[id] = [...tags];
  }
  return result;
}

/** 자동완성·묶기 후보. 많이 쓰인 태그가 앞, 동률이면 이름순 — 고르는 목록은 예측 가능해야 한다. */
export function knownTags(byWorkProject: Readonly<Record<string, readonly string[]>>): string[] {
  const counts = new Map<string, number>();
  for (const tags of Object.values(byWorkProject)) {
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ko"))
    .map(([tag]) => tag);
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npm run typecheck` 통과.
- [ ] **Step 5: 커밋** — `git add src/shared/project-tags-types.ts src/shared/project-tags-types.test.ts`, `feat(tags): 업무 프로젝트 태그 타입과 정규화 순수 함수`.

---

### Task 2: 메인 레지스트리 `project-tags.json`

**Files:**
- Create: `src/main/projects/project-tags-registry.ts`
- Test: `src/main/projects/project-tags-registry.test.ts`

**Interfaces:**
- Consumes: Task 1의 `ProjectTagsV1`·`normalizeTags`; `src/main/storage/json-store.ts`의 `readJsonStore`/`updateJsonStore`/`restoreJsonStoreBackup`/`JsonStoreSpec`(`workspace-registry.ts`가 쓰는 그대로).
- Produces:
  ```ts
  export const PROJECT_TAGS_PATH: string;                 // ~/.multi-cli-work/project-tags.json
  export class ProjectTagsRegistryError extends Error {}
  export function parseProjectTags(value: unknown): ProjectTagsV1;
  export function emptyProjectTags(now?: string): ProjectTagsV1;
  export interface ProjectTagsOptions { registryPath?: string; lockRetryMs?: number; now?: () => string }
  export async function readProjectTags(options?: ProjectTagsOptions): Promise<ProjectTagsV1>;
  export async function updateProjectTags(update: (r: ProjectTagsV1) => ProjectTagsV1 | Promise<ProjectTagsV1>, options?: ProjectTagsOptions): Promise<ProjectTagsV1>;
  export async function restoreProjectTagsFromBackup(options?: ProjectTagsOptions): Promise<ProjectTagsV1>;
  export async function setProjectTags(workProjectId: string, tags: readonly string[], options?: ProjectTagsOptions): Promise<ProjectTagsV1>;
  export async function pruneProjectTags(knownIds: ReadonlySet<string>, options?: ProjectTagsOptions): Promise<ProjectTagsV1>;
  ```

- [ ] **Step 1: 실패하는 테스트** — `src/main/projects/project-tags-registry.test.ts` (`// @vitest-environment node`, `workspace-registry.test.ts`의 `fs.mkdtemp` 픽스처와 `.bak` 케이스를 본떠 작성)

케이스(각각 `it`): 없는 파일 → `emptyProjectTags` 모양 / `setProjectTags` 후 `readProjectTags` 왕복 / 모르는 최상위 키(`{schemaVersion:1, updatedAt, tags:{}, extra:1}`)는 `ProjectTagsRegistryError` / `schemaVersion: 2` 거부 / 손편집 값 `[" 연구 ", "연구", ""]`가 `["연구"]`로 읽힌다 / 빈 키(`""`) 거부 / `setProjectTags("wp", [" ", ""])`가 `tags.wp = []` **행을 남긴다** / `pruneProjectTags(new Set(["wp-keep"]))`가 다른 행을 지우고, 지울 게 없으면 `updatedAt`이 그대로다 / 깨진 primary(`{`)에 정상 `.bak`이 있으면 `.bak` 내용을 읽는다.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/projects/project-tags-registry.test.ts` → 모듈 없음.

- [ ] **Step 3: 구현** — `workspace-registry.ts`와 문장 단위로 같은 구조(경로 상수 → `REGISTRY_KEYS = ["schemaVersion","updatedAt","tags"]` → 에러 클래스 → `isRecord`/`assertExactKeys`/`isoString` → `parseProjectTags` → `emptyProjectTags` → `STORE` → 옵션·`registryPathOf`·`nowOf` → read/update/restore → 도메인 함수). 핵심:

```ts
function parseTagsRecord(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) throw new ProjectTagsRegistryError("Project tags must be an object");
  const tags: Record<string, string[]> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (id.length === 0) throw new ProjectTagsRegistryError("Project tags key must be a non-empty string");
    if (!Array.isArray(raw)) throw new ProjectTagsRegistryError(`Project tags for ${id} must be an array`);
    // 손편집 파일도 앱과 같은 답을 내도록 파서가 정규화까지 한다. 빈 배열은 **남긴다**(타입 주석 참고).
    tags[id] = normalizeTags(raw);
  }
  return tags;
}

export async function setProjectTags(workProjectId, tags, options = {}) {
  const now = nowOf(options);
  return updateProjectTags((registry) => ({
    ...registry, updatedAt: now,
    // 정규화 결과가 비어도 행은 남는다 — "지웠다"와 "없다"를 구분하는 유일한 표식이다.
    tags: { ...registry.tags, [workProjectId]: normalizeTags(tags) },
  }), options);
}

export async function pruneProjectTags(knownIds, options = {}) {
  const current = await readProjectTags(options);
  const stale = Object.keys(current.tags).filter((id) => !knownIds.has(id));
  // workspace:sync가 매번 도는 경로다 — 버릴 게 없으면 잠금도 쓰기도 하지 않는다.
  if (stale.length === 0) return current;
  const now = nowOf(options);
  return updateProjectTags((registry) => ({
    ...registry, updatedAt: now,
    tags: Object.fromEntries(Object.entries(registry.tags).filter(([id]) => knownIds.has(id))),
  }), options);
}
```

- [ ] **Step 4: 통과 확인** — PASS, `npm run typecheck`.
- [ ] **Step 5: 커밋** — `feat(tags): project-tags.json 레지스트리 (잠금·원자 쓰기·.bak)`.

---

### Task 3: IPC · preload · api-types · runtime 배선

**Files:**
- Modify: `src/main/ipc.ts`(`WorkspaceGateway` L82 옆, deps L237 옆, 핸들러 L800 뒤), `src/preload/index.ts`(L44 `workspace` 옆), `src/shared/api-types.ts`(`MultiCliWorkApi`의 `workProjects` 블록 뒤), `src/main/runtime.ts`(L165 env, L166 `WorkProjectService` 옵션, L428 `registerMainIpc` deps)
- Test: `src/main/ipc.test.ts`(`setup()`의 deps에 `projectTags` 목 + 검증 2건), `src/renderer/src/App.test.tsx`(`createApi` L261: 옵션 `projectTags?: Record<string, string[]>`와 `api.projectTags` 목 — 없으면 `MultiCliWorkApi` 타입 에러)

**Interfaces:**
- Produces:
  ```ts
  // ipc.ts
  interface ProjectTagsGateway { list(): Promise<ProjectTagsV1>; set(workProjectId: string, tags: readonly string[]): Promise<ProjectTagsV1> }
  // 채널 "project-tags:list", "project-tags:set"(workProjectId: string, tags: string[])
  // api-types.ts
  projectTags: { list(): Promise<ProjectTagsV1>; set(workProjectId: string, tags: string[]): Promise<ProjectTagsV1> };
  // runtime.ts: process.env.MULTI_CLI_WORK_PROJECT_TAGS_PATH → ProjectTagsOptions.registryPath; WorkProjectService 옵션 projectTagsPath(Task 4에서 소비)
  ```

- [ ] **Step 1: 실패하는 테스트** — `ipc.test.ts`: `project-tags:set`이 배열 아닌 두 번째 인자와 문자열 아닌 원소를 `Error`로 거부하고, 정상 호출은 `dependencies.projectTags.set("wp", ["a"])`로 전달되며 반환값을 돌려준다; `project-tags:list`가 게이트웨이를 부른다.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/ipc.test.ts` (타입 에러 포함).
- [ ] **Step 3: 구현** — 핸들러:
  ```ts
  ipc.handle("project-tags:list", () => dependencies.projectTags.list());
  ipc.handle("project-tags:set", async (_event, workProjectId: unknown, tags: unknown) => {
    if (!Array.isArray(tags)) throw new Error("Project tags must be an array");
    // 빈 문자열은 여기서 거부하지 않는다 — 지우는 일은 normalizeTags의 몫이고, 칩 편집기가
    // 공백 하나를 흘렸다고 오류 배너가 뜨면 안 된다.
    return dependencies.projectTags.set(
      nonEmptyString(workProjectId, "Work project id"),
      tags.map((tag) => { if (typeof tag !== "string") throw new Error("Project tag must be a string"); return tag; }),
    );
  });
  ```
  (`nonEmptyString` 같은 검증 헬퍼는 ipc.ts에 이미 있는 것을 쓴다.) preload: `projectTags: { list: () => ipcRenderer.invoke("project-tags:list"), set: (id, tags) => ipcRenderer.invoke("project-tags:set", id, tags) }`. runtime: `const projectTagsPath = process.env.MULTI_CLI_WORK_PROJECT_TAGS_PATH; const projectTagsOptions = projectTagsPath ? { registryPath: projectTagsPath } : {};`, `WorkProjectService`에 `...(projectTagsPath ? { projectTagsPath } : {})`, deps에 `projectTags: { list: () => readProjectTags(projectTagsOptions), set: (id, tags) => setProjectTags(id, tags, projectTagsOptions) }`. `validateWorkProjectPatch`는 손대지 않는다.
- [ ] **Step 4: 통과 확인** — `npm test`, `npm run typecheck`(App.test의 `createApi` 목 포함).
- [ ] **Step 5: 커밋** — `feat(tags): project-tags IPC·preload·runtime 배선`.

---

### Task 4: ws-root 동기화가 채널 라벨을 태그로 심는다

**Files:**
- Modify: `src/main/projects/work-project-service.ts`(`WorkProjectServiceOptions` L49-57에 `projectTagsPath?: string`, `syncFromWorkspace` L320-428)
- Test: `src/main/projects/work-project-workspace-sync.test.ts`(`tempPaths` L26-33·`service()` L35-43에 `projectTagsPath`)

**Interfaces:**
- Consumes: Task 2의 `readProjectTags`/`updateProjectTags`, Task 1의 `normalizeTags`; `WorkspaceShellInfo.channelLabel`(`src/shared/workspace-types.ts` L59).
- Produces: 동기화 후 `project-tags.json`에 **행이 없던** 셸 기반 업무 프로젝트마다 `[channelLabel]` 행; 사라진 업무 프로젝트의 행 제거. `CHANNEL_CATEGORY`(L29-35)와 L378의 category 결정은 그대로.

- [ ] **Step 1: 실패하는 테스트** — 신규 4건: (1) 새로 만들어진 업무 프로젝트에 `channelLabel`이 태그로 붙는다 (2) 업무 프로젝트는 이미 있는데 태그 행이 없으면(업그레이드) 한 번 붙는다 (3) `tags[id] = []`(사용자가 지움)면 다시 붙지 않는다 (4) 사라진 업무 프로젝트의 행이 정리되고, 정리할 게 없으면 파일의 `updatedAt`이 그대로다. 기존 케이스는 `projectTagsPath`만 추가되고 단언은 그대로.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/projects/work-project-workspace-sync.test.ts`.
- [ ] **Step 3: 구현** — `syncFromWorkspace` 시작에 `const tagRegistry = await readProjectTags(tagOptions);`(쓰기 **전**의 사실이어야 한다). 업무 프로젝트가 확정되는 지점(생성/기존 두 갈래가 합류하는 곳, L396 `created += 1` 블록 뒤)에:
  ```ts
  // 채널 라벨을 태그로 한 번만 심는다. 표식은 "행이 아직 없다"는 사실 하나다 — 사용자가 태그를
  // 전부 지우면 빈 행이 남고, 그때부터 여기는 손대지 않는다. 구분(category)이 만들 때 한 번만
  // 정해지는 것(위 L26-27)과 같은 약속이다.
  if (!Object.prototype.hasOwnProperty.call(tagRegistry.tags, target.id)) {
    tagSeeds.set(target.id, normalizeTags([shell.channelLabel]));
  }
  ```
  `setWorkspaceShellLinks`(L425) 뒤에 마지막 쓰기:
  ```ts
  // 업무 프로젝트 → 셸 연결 → 태그 순. 태그는 업무 프로젝트 id를 가리키므로 가장 나중에 쓴다.
  const known = new Set(Object.keys(nextRegistry.workProjects));
  const stale = Object.keys(tagRegistry.tags).some((id) => !known.has(id));
  if (tagSeeds.size > 0 || stale) {
    await updateProjectTags((registry) => ({
      ...registry, updatedAt: now,
      tags: { ...Object.fromEntries(Object.entries(registry.tags).filter(([id]) => known.has(id))), ...Object.fromEntries(tagSeeds) },
    }), tagOptions);
  }
  ```
  `tagOptions`는 `workspaceOptions`처럼 `this.options.projectTagsPath`·`platform`에서 만든다.
- [ ] **Step 4: 통과 확인** — `npm test`, `npm run typecheck`.
- [ ] **Step 5: 커밋** — `feat(tags): ws-root 동기화가 채널 라벨을 태그로 한 번 심는다`.

---

### Task 5: SessionStart 브리프의 `- 태그:` 줄

**Files:**
- Modify: `src/main/projects/work-project-brief.ts`(L23 시그니처, L30 뒤), `src/main/runtime.ts`(`getWorkProjectBrief` L268-298)
- Test: `src/main/projects/work-project-brief.test.ts`(2건; 기존 4개 호출부는 기본 인자로 무변경)

**Interfaces:**
- Produces: `renderWorkProjectBrief(workProject, members, tags: readonly string[] = [])` — `- 상태:` 다음에 `- 태그: a, b`(비면 줄 생략).

- [ ] **Step 1: 실패하는 테스트** — 태그가 있으면 `- 상태:` 바로 뒤 줄이 `- 태그: 개인, AI` / 태그가 비면 `- 태그:` 줄이 없다.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/main/projects/work-project-brief.test.ts`.
- [ ] **Step 3: 구현** — 배열 리터럴에 `...(tags.length > 0 ? [`- 태그: ${tags.join(", ")}`] : [])`. runtime: `const tags = workProject ? tagsOf(await readProjectTags(projectTagsOptions), workProject.id) : [];`(업무 프로젝트가 없는 폴더에는 파일을 열지 않는다) → `renderWorkProjectBrief(workProject, members, tags)`.
- [ ] **Step 4: 통과 확인** — `npm test`, `npm run typecheck`. **여기까지 main 완결.**
- [ ] **Step 5: 커밋** — `feat(tags): 세션 브리프에 태그 줄`.

---

### Task 6: 태그 색 (`tag-color.ts`) + CSS 토큰

> 2026-09-03 개정(Task 14의 D1): 팔레트는 태그·구분이 **공용**으로 쓴다. 클래스는 `accent-n`, 인덱스→클래스 매핑은 `src/shared/accent-palette.ts`(Task 14가 만든다; Task 6이 먼저면 Task 6이 만든다)에 하나만 둔다.

**Files:**
- Create(없으면): `src/shared/accent-palette.ts`(`ACCENT_COLOR_COUNT = 7`, `ACCENT_INDEXES = [1..7]`, `accentClass(index: number): string /* "accent-n", 범위 밖은 "accent-1" */`) + `src/shared/accent-palette.test.ts`
- Create: `src/renderer/src/tag-color.ts`, Test: `src/renderer/src/tag-color.test.ts`
- Modify: `src/renderer/src/index.css`(`:root`에 `--accent-6`·`--accent-7` 토큰, `.category-*`(L61-79) 뒤에 `.accent-1`…`.accent-7`이 `--category-accent`를 세팅 — 1~5는 기존 `--category-government/outsourcing/research/product/etc` 별칭. 5번은 회색이다)

**Interfaces:**
- Produces: `export const TAG_ACCENT_COUNT = ACCENT_COLOR_COUNT; export function tagAccentIndex(tag: string): number /* 1..7 */; export function tagAccentClass(tag: string): string /* accentClass(tagAccentIndex(tag)) = "accent-n" */;` — FNV-1a 32bit over `tag.trim()`.

- [ ] **Step 1: 실패하는 테스트** — 같은 입력 → 같은 클래스(고정 입력 3개 `"개인"`, `"AI"`, `"연구"`의 결과 문자열 `"accent-n"`을 **하드코딩**해 해시 변경을 잡는다; 구현 후 실제 값으로 채운다) / 100개 임의 문자열이 전부 `1..7` / 앞뒤 공백 무시(`"AI"`와 `" AI "` 같음) / 한국어 태그 8개(`개인·회사·대학원·연구실·AI·로보틱스·재무·건강`)가 5종 이상으로 흩어진다. `accent-palette.test.ts`: `accentClass(1) === "accent-1"`, `accentClass(7) === "accent-7"`, 범위 밖(`0`, `8`, `1.5`, `NaN`)은 `"accent-1"`, `ACCENT_INDEXES`가 `[1..7]`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/tag-color.test.ts src/shared/accent-palette.test.ts`.
- [ ] **Step 3: 구현**
  ```ts
  // src/shared/accent-palette.ts
  /**
   * 태그와 구분이 함께 쓰는 팔레트. 한 화면에 색 계열이 둘이면 색이 무엇을 뜻하는지 흐려진다 —
   * 채널 색이 구분 팔레트를 다시 쓴 것과 같은 이유다. shared에 사는 것은 설정 파서(1..7 검증)와
   * 렌더러(클래스 이름) 둘 다 이 숫자를 알아야 하기 때문이다.
   */
  export const ACCENT_COLOR_COUNT = 7;
  export const ACCENT_INDEXES: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
  /** 1..7 → CSS 클래스. 범위 밖은 1로 접는다 — 파서가 이미 막으므로 여기는 마지막 그물이다. */
  export function accentClass(index: number): string {
    const safe = Number.isInteger(index) && index >= 1 && index <= ACCENT_COLOR_COUNT ? index : 1;
    return `accent-${safe}`;
  }

  // src/renderer/src/tag-color.ts
  import { ACCENT_COLOR_COUNT, accentClass } from "@shared/accent-palette";
  /**
   * 태그 색은 뜻이 아니라 구별 표시다 — 자유 문자열에 의미론적 이름을 붙일 수 없으므로 클래스도
   * 번호다. 팔레트는 구분과 같은 것이다(accent-palette.ts).
   */
  export const TAG_ACCENT_COUNT = ACCENT_COLOR_COUNT;
  /** FNV-1a — 로케일·플랫폼과 무관해야 같은 태그가 어느 화면에서나 같은 색이 된다. */
  export function tagAccentIndex(tag: string): number {
    let hash = 0x811c9dc5;
    for (const char of tag.trim()) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return (hash % TAG_ACCENT_COUNT) + 1;
  }
  export function tagAccentClass(tag: string): string { return accentClass(tagAccentIndex(tag)); }
  ```
- [ ] **Step 4: 통과 확인** — PASS(하드코딩 값 채운 뒤), `npm run typecheck`.
- [ ] **Step 5: 커밋** — `feat(tags): 태그 이름 해시 팔레트`.

---

### Task 7: 태그 편집기와 상세 페이지

**Files:**
- Create: `src/renderer/src/TagEditor.tsx`, Test: `src/renderer/src/TagEditor.test.tsx`
- Modify: `src/renderer/src/WorkProjectDetailPage.tsx`(props, 상태 select L366-379 뒤·노션 L380 앞에 배치), Test: `src/renderer/src/WorkProjectDetailPage.test.tsx`(`renderPage` 헬퍼에 새 props, 1건)

**Interfaces:**
- Produces:
  ```tsx
  export interface TagEditorProps { tags: readonly string[]; suggestions: readonly string[]; disabled?: boolean; onChange(tags: string[]): void }
  export function TagEditor(props: TagEditorProps): JSX.Element;
  // WorkProjectDetailPage 새 props: tags: readonly string[]; tagSuggestions: readonly string[]; onTagsChanged(registry: ProjectTagsV1): void
  ```
- 마크업: 칩 `<span className={`tag-editor-chip ${tagAccentClass(tag)}`}>{tag}<button type="button" aria-label={`${tag} 태그 제거`}>×</button></span>`; 입력 `<input type="text" maxLength={MAX_TAG_LENGTH} list={listId} aria-label="태그 추가" placeholder="태그 추가…" />` + `<datalist id={listId}>{suggestions.filter(s => !tags.includes(s)).map(...)}</datalist>`(`useId()`). `Enter`·`,`로 커밋(`event.nativeEvent.isComposing`이면 무시 — 한글 조합 확정용 Enter), 빈 입력 `Backspace` → 마지막 칩 제거, 커밋은 항상 `onChange(normalizeTags([...tags, draft]))`(중복은 조용히 무시). 상세 페이지: `const [tags, setTags] = useState([...props.tags])` + 리싱크 effect(L122-129 패턴), 저장은 즉시 `onTagsChanged(await window.multiCliWork.projectTags.set(workProject.id, next))`, 실패는 기존 `setSaveError`. 라벨 `<label id={`wp-tags-${id}`}>태그</label>` + `role="group" aria-labelledby`.

- [ ] **Step 1: 실패하는 테스트** — `TagEditor.test.tsx`: 입력 후 Enter로 칩 추가(정규화된 값으로 `onChange`) / `,`로 커밋 / 중복 입력은 `onChange` 없음 / `isComposing` Enter 무시(`fireEvent.keyDown(input, { key: "Enter", isComposing: true })` — jsdom에서 `nativeEvent.isComposing` 전달 여부를 확인하고 안 되면 `KeyboardEvent` 생성자로 dispatch) / 빈 입력 Backspace로 마지막 칩 제거 / `maxLength`가 32 / datalist에 이미 붙은 태그는 빠진다. `WorkProjectDetailPage.test.tsx`: 칩을 추가하면 `projectTags.set(workProject.id, ["개인"])`가 호출되고 `onTagsChanged`가 반환값을 받는다.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/TagEditor.test.tsx src/renderer/src/WorkProjectDetailPage.test.tsx`.
- [ ] **Step 3: 구현** — 위 마크업. CSS `.tag-editor`, `.tag-editor-chip`(`--category-accent` 배경 흐리게), `.tag-editor-input`.
- [ ] **Step 4: 통과 확인** — `npm test`, `npm run typecheck`.
- [ ] **Step 5: 커밋** — `feat(tags): 상세 페이지 태그 편집기`.

---

### Task 8: 사이드바 — 태그 묶음이 채널 묶음을 대체한다 (쪼개지 않음)

`sidebar-tree.ts`에서 `ChannelNode`를 없애는 순간 `ProjectSidebar.tsx`의 import가 깨지므로 한 태스크다.

**Files:**
- Modify: `src/renderer/src/sidebar-tree.ts`(전면), `src/renderer/src/ProjectSidebar.tsx`(props L66 옆, `readSidebarState` L158, 상태 L265-271, `persist` L273-291과 호출부 L295·301·411·864·870, `keepNonChannelKeys` L413·컨트롤 L416-430, `renderChannel` L559-592, 렌더 분기 L1027, tree-controls L983-996), `src/renderer/src/work-project-accent.ts`(L36-54 삭제), `src/renderer/src/index.css`(`.channel-*` L85-103과 채널 노드 스타일 ~L1905-1953 → `.tag-group-*`, `.grouping-picker-*`)
- Create: `src/renderer/src/TagGroupingPicker.tsx`, Test: `src/renderer/src/TagGroupingPicker.test.tsx`
- Test: `src/renderer/src/sidebar-tree.test.ts`(전면 재작성), `src/renderer/src/work-project-accent.test.ts`(channel describe 삭제), `src/renderer/src/App.test.tsx`(`describe("ws-root 채널")` L1678 → `"태그 묶음"`, `channelNode` 헬퍼 L3618, `getByTitle` 문구 L3718·3749·3762·3792, 신규 2건)

**Interfaces:**
- Produces(`sidebar-tree.ts`):
  ```ts
  export interface TagGroupNode { kind: "group"; key: string; tag: string | null; label: string; sections: TreeSection[] }
  export const GROUP_KEY_PREFIX = "tag:"; export const OTHER_GROUP_KEY = "tag:";
  export type TreeNode = TagGroupNode | { kind: "section"; key: string; section: TreeSection };
  export interface TreeGrouping { tags: readonly string[]; tagsByWorkProject: Readonly<Record<string, readonly string[]>> }
  export function buildTreeSections(...): TreeSection[];                      // 변경 없음
  export function buildTreeNodes(sections: readonly TreeSection[], grouping: TreeGrouping): TreeNode[];
  export function groupKeys(nodes: readonly TreeNode[]): string[];
  export function collapsedGroupKeysForWorking(nodes: readonly TreeNode[], workingProjectIds: ReadonlySet<string>): Set<string>;
  export const CHANNEL_LABEL_ORDER = ["과제", "용역", "연구", "기타", "개인"] as const;
  export function defaultGroupingTags(tagsByWorkProject: Readonly<Record<string, readonly string[]>>, hasWorkspaceShells: boolean): string[];
  ```
  핵심: `const tag = grouping.tags.find((t) => (grouping.tagsByWorkProject[wp.id] ?? []).includes(t)) ?? null;` — 묶음은 첫 구성원 자리, `기타`(`tag: null`, key `OTHER_GROUP_KEY`, label `기타`)는 항상 마지막, `workProject === null`(미분류) 섹션은 묶음 밖 최상위·기타보다 뒤. `grouping.tags`가 비면 전부 `kind: "section"`.
- Produces(`TagGroupingPicker.tsx`): `{ available: readonly string[]; selected: readonly string[]; isDefault: boolean; onChange(tags: string[]): void }` — 버튼 `aria-label="묶기 설정"` `aria-expanded`, 텍스트 `묶기: {selected.join(" › ") || "없음"}`(`isDefault`면 `(자동)` 접미), 패널 `role="menu"`에 `role="menuitemcheckbox" aria-checked` 항목(고르면 끝에 추가, 해제하면 제거), 맨 아래 `묶기 해제`, 바깥 mousedown·Escape로 닫힘(`ProjectContextMenu.tsx`의 패턴). 순서 재배치 없음.
- `ProjectSidebar` 새 prop `tagsByWorkProject: Record<string, readonly string[]>`; `readSidebarState`에 `groupingTags: string[] | null`(키 없으면 `null`, 있으면 배열 그대로); `persist`를 `persist(patch: Partial<SidebarPrefs>)`로(레코드 전체를 쓰고 `version: 1` 유지); 상태 `groupingTags`, `effectiveGrouping = groupingTags ?? defaultGroupingTags(tagsByWorkProject, Object.keys(workspaceShells).length > 0)`, `availableTags = knownTags(tagsByWorkProject)`, `treeNodes = buildTreeNodes(treeSections, { tags: effectiveGrouping, tagsByWorkProject })`; `renderGroup(node)`이 `renderChannel`을 대체(`<li className={`tag-group-node ${node.tag ? tagAccentClass(node.tag) : "tag-group-other"}`} role="treeitem" aria-expanded>`, 토글 `aria-label={`${node.label} ${collapsed ? "펼치기" : "접기"}`}`, 아이콘 lucide `Tag`, `<ul className="tag-group-children" role="group" aria-label={node.label}>`); `keepNonChannelKeys` → `keepNonGroupKeys`(`!key.startsWith(GROUP_KEY_PREFIX)`), `channelKeys`→`groupKeys`, `collapsedChannelKeysForWorking`→`collapsedGroupKeysForWorking`; tree-controls title 3개 교체; 같은 줄 오른쪽에 `<TagGroupingPicker available={availableTags} selected={effectiveGrouping} isDefault={groupingTags === null} onChange={(tags) => { setGroupingTags(tags); persist({ groupingTags: tags }); }} />`. `workspaceShells`·`workProjectLabel`은 유지.

- [ ] **Step 1: 실패하는 테스트** — `sidebar-tree.test.ts` 전면: 묶기 비면 전부 section / 고른 순서대로 묶이고 묶음이 첫 구성원 자리 / 태그 둘 가진 프로젝트가 **앞 태그 묶음에만** / 없으면 기타, 기타 마지막 / 미분류는 묶음 밖·기타 뒤 / `groupKeys` / `collapsedGroupKeysForWorking` / `defaultGroupingTags`(셸 없으면 `[]`, 있으면 존재하는 라벨만 고정 순서). `TagGroupingPicker.test.tsx`: 열기·고르기(끝에 추가)·해제·묶기 해제·Escape. `App.test.tsx`: `"ws-root 채널"` describe를 `"태그 묶음"`으로 — `.channel-node`→`.tag-group-node`, `toHaveClass("channel-service")`→`toHaveClass(tagAccentClass("용역"))`(import해서 호출), `"O_SMCH 접기/펼치기"`→`"용역 접기/펼치기"`, "손으로 만든 것은 최상위" 케이스를 (a) 묶기 비면 최상위 (b) 묶기 있고 태그 없으면 `기타` 아래로 분리(`createApi({ projectTags: {...} })`로 태그 주입 — 셸 기반 프로젝트에는 동기화가 아니라 픽스처로 라벨 태그를 준다), `channelNode()`→`groupNode(label)`, `getByTitle` 4곳 문구 교체; 신규: 묶기 메뉴로 둘을 고르면 그 순서로 묶이고 재시작 후 유지(localStorage `groupingTags`) / 저장된 선호 없고 셸+라벨 태그 있으면 채널 라벨 기본값으로 묶인다(버튼 텍스트에 `(자동)`).
- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/sidebar-tree.test.ts src/renderer/src/TagGroupingPicker.test.tsx` 그리고 `npx vitest run src/renderer/src/App.test.tsx -t "태그 묶음"`.
- [ ] **Step 3: 구현** — 위 Interfaces대로. CSS: `.channel-*`(L85-103) 삭제, 채널 노드 스타일을 `.tag-group-node/.tag-group-row/.tag-group-copy/.tag-group-name/.tag-group-children`로 옮기고(레일 색은 `--category-accent`를 `.accent-n`이 세팅), `.tag-group-other`는 회색, `.grouping-picker`·`.grouping-picker-menu`·`.grouping-picker-item` 신규.
- [ ] **Step 4: 통과 확인** — `npm test`, `npm run typecheck`. 접근성 이름 동결 테스트(세션 행·폴더 행)가 손대지 않고 통과해야 한다.
- [ ] **Step 5: 커밋** — `refactor(sidebar): 채널 묶음을 태그 묶음으로 일반화하고 묶기 메뉴를 단다`.

---

### Task 9: App 배선과 태그 칩

**Files:**
- Create: `src/renderer/src/TagChips.tsx`
- Modify: `src/renderer/src/App.tsx`(상태·`loadWorkspace` L640 `Promise.all`·L646·`projectMembership` L408 뒤 useMemo·`<ProjectSidebar>` L2820·`<WorkProjectDetailPage>` L3076·`<HomeDashboard>` L3151), `src/renderer/src/ProjectSidebar.tsx`(업무 프로젝트 행 `.project-copy` 안 이름 뒤), `src/renderer/src/HomeDashboard.tsx`(L139 `category-chip` 뒤; prop `tagsByWorkProject?` 기본 `{}`), `index.css`(`.tag-chip`, `.tag-chip-more`, 칩당 `max-width`+말줄임, 이름이 먼저 줄지 않도록 `flex: 0 1 auto`)
- Test: `App.test.tsx`(행 칩 1건), `HomeDashboard.test.tsx`(카드 칩 1건)

**Interfaces:**
- Produces: `export function TagChips({ tags, max = 3 }: { tags: readonly string[]; max?: number }): JSX.Element | null` — 넘치면 `+N`(`title`에 나머지), 빈 목록이면 `null`. App: `const [projectTags, setProjectTags] = useState<ProjectTagsV1 | null>(null)`, `Promise.all`에 `window.multiCliWork.projectTags.list()`, `tagsByWorkProjectId = tagsByWorkProject(projectTags, workProjects.map(wp => wp.id))`, `tagSuggestions = knownTags(tagsByWorkProjectId)`; 사이드바 `tagsByWorkProject={tagsByWorkProjectId}`, 홈 `tagsByWorkProject={tagsByWorkProjectId}`, 상세 `tags={tagsByWorkProjectId[selectedWorkProject.id] ?? []} tagSuggestions={tagSuggestions} onTagsChanged={setProjectTags}`.

- [ ] **Step 1: 실패하는 테스트** — App: 태그가 붙은 업무 프로젝트의 트리 행 안에 `.tag-chip` 텍스트가 보이고 4개면 `+1`이 뜬다(행 버튼의 접근성 이름은 그대로). Home: 카드에 칩.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/App.test.tsx -t "칩" src/renderer/src/HomeDashboard.test.tsx`.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — `npm test`, `npm run typecheck`.
- [ ] **Step 5: 커밋** — `feat(tags): 트리·홈 카드 태그 칩과 App 배선`.

---

### Task 10: 빠른 열기 `#태그`

**Files:**
- Modify: `src/renderer/src/quick-open.ts`(L4 `kind`에 `"workProject"`), `src/renderer/src/QuickOpenPalette.tsx`(L4 `KIND_LABELS.workProject = "프로젝트"`), `src/renderer/src/App.tsx`(`quickOpenItems` L2233: `workProjectItems` 추가 — `key: work-project:<id>`, `label: workspaceShells[id]?.title ?? name`, `detail: tags.map(t => `#${t}`).join(" ") || null`; 순서 `[...sessionItems, ...workspaceItems, ...projectItems, ...workProjectItems, ...commandItems]`, 의존성 추가; `handleQuickOpenSelect` L2283에 `work-project` 분기 → `selectWorkProject(rest.join(":"))`)
- Test: `quick-open.test.ts`(`#연구`와 `연구` 둘 다 `detail`로 매칭), `App.test.tsx`(팔레트에 `#개인` 입력 → 업무 프로젝트 항목 선택 → 상세 페이지 열림)

- [ ] **Step 1: 실패하는 테스트** / **Step 2: 실패 확인** / **Step 3: 구현**(`rankQuickOpen`·`fuzzyScore`는 손대지 않는다 — `label+detail`이 한 건초더미다) / **Step 4: 통과 확인** / **Step 5: 커밋** — `feat(tags): 빠른 열기에서 #태그로 업무 프로젝트 찾기`.

---

### Task 11: 문서

**Files:**
- Modify: `docs/superpowers/specs/registry-contract.md` §8 예시 목록에 `project-tags.json` 한 줄.

- [ ] **Step 1:** 예시(`worktrees.json`, `agents.json`) 뒤에 "업무 프로젝트 태그는 `~/.multi-cli-work/project-tags.json`" 추가.
- [ ] **Step 2: 커밋** — `docs: 레지스트리 계약 §8 예시에 project-tags.json`.

---

### Task 12 (선택): 시작 동기화 완료 이벤트

`runtime.ts`의 시작 동기화(`workspace` sync fire-and-forget, ~L618-627)가 렌더러의 첫 `projectTags.list()`와 경합하면 업그레이드 첫 실행 한 번만 평면 트리로 뜬다(= 오늘의 콜드스타트와 같은 열화). 없애려면: 동기화 끝에 `window.webContents.send("workspace:synced")`, preload `onWorkspaceSynced(listener)`(`settings:changed` 패턴), App에서 구독해 `loadWorkspace()` 재호출. 기존 문제("시작 동기화로 처음 생긴 업무 프로젝트가 다음 실행까지 안 보임")도 함께 해소. 빼도 기능은 성립한다.

---

---

# 후속 (2026-09-03 승인): Task 13~17 — 세션 헤더 클릭 범위 + 업무 프로젝트 "구분" 범용화

> 사용자 인터뷰 결정: 구분은 **유지**(프로젝트당 하나, 레일·카드·칩 색 결정)하되 목록은 **설정 창 "프로젝트" 탭**의 사용자 정의 목록(이름·색·순서·기본 구분); 기본 목록은 **범용값 업무·개인·연구·기타**(목록에 없는 옛 값은 그대로 표시, 회색); ws-root 동기화의 채널 글자→구분 매핑은 **제거**(새 프로젝트는 설정의 기본 구분; 채널 라벨은 Task 4대로 태그로만).
>
> 선행 결정 — **D1** 팔레트 공용화: `src/shared/accent-palette.ts`의 `accentClass(index) → "accent-n"`을 태그·구분이 함께 쓴다(Task 6 개정 참조). **D2** 팔레트 5번은 회색(`--category-etc`): 기본 목록의 `기타`가 지금과 같은 색. **D3** 구분 이름 편집은 허용하되 기존 프로젝트의 `category` 문자열은 이관하지 않는다(설정 탭에 안내; 자동 이관은 별도 작업).
>
> 실행 순서: T3 → T4 → T5 → **T13** → **T14** → T6 → T7 → T8 → T9 → T10 → **T15** → **T16** → T11 → **T17** → (선택) T12. Task 13은 태그 태스크와 파일이 겹치지 않는다. Task 16은 반드시 T6·T8 뒤.

### Task 13: 세션 패널 헤더의 남는 폭 전체로 작업공간 열기

**Files:**
- Modify: `src/renderer/src/SessionPanel.tsx`(L217-226 제목 버튼·배지), `src/renderer/src/index.css`(L2356-2388 `.session-panel-title`·`.session-panel-wait`·`.session-panel-scope`)
- Create: `src/renderer/src/SessionPanel.test.tsx`(콜로케이션 테스트가 아직 없다 — `renderPanel(overrides?: Partial<SessionPanelProps>)` 헬퍼로 필수 props 전부 `vi.fn`/기본값)
- Modify: `e2e/desktop.spec.ts`(@smoke 테스트의 폴더 행 배치 블록(~L254-267) 뒤에 배치 측정; 비-smoke `moves panes by sidebar row…`(~L904) 앞머리에 실제 클릭)

**Interfaces:** `SessionPanelProps` 불변. 접근성 이름 `세션 작업공간 열기 (패인 N개)` 불변(e2e 3곳·App.test 15곳이 이 문자열에 걸려 있다).

- [ ] **Step 1: 실패하는 테스트** — `SessionPanel.test.tsx`: (1) `대기 배지가 제목 버튼 안에 있어 배지를 눌러도 작업공간이 열린다` — `title = getByRole("button", { name: "세션 작업공간 열기 (패인 2개)" })`, `within(title).getByText("대기 1")`, 배지 클릭 → `onSelectWorkspace` 1회 (2) `접기 토글과 범위 버튼은 제목 버튼 밖에 남는다` — `title.querySelector(".tree-toggle")`·`.session-panel-scope`가 null, 헤더 직계 자식 순서 `tree-toggle → session-panel-title → session-panel-scope`(jsdom엔 레이아웃이 없으니 실제 폭은 e2e가 잰다고 주석) (3) `토글과 범위 버튼은 각자만 부른다` (4) `접근성 이름에 대기 수가 새지 않는다` — `toHaveAccessibleName("세션 작업공간 열기 (패인 2개)")`. e2e: @smoke에 `.session-panel-heading` 안 `.session-panel-title`/`.session-panel-scope`의 `getBoundingClientRect`로 제목 폭 ≥ 헤더 폭×0.5, 범위 버튼과의 간격 ≤ 8px, 제목 높이 ≥ 헤더 높이−1; 비-smoke에 `await openFolder(); const box = await page.locator(".session-panel-title").boundingBox(); await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2); await expect(page.locator(".workspace-title")).toHaveText("작업공간");`.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/SessionPanel.test.tsx`.
- [ ] **Step 3: 구현** — 마크업:
  ```tsx
  {/* 제목 버튼이 토글과 범위 버튼 사이의 남는 폭을 전부 먹는다 — 숨김 셸프 행(.workspace-shelf-select)이
      아이콘·이름·개수를 한 버튼에 품는 것과 같은 구조다. 배지가 버튼 밖이면 헤더에서 가장 눌리기 쉬운
      자리가 죽은 공간이 된다. */}
  <button className="session-panel-title" type="button" onClick={onSelectWorkspace} aria-label={`세션 작업공간 열기 (패인 ${items.length}개)`}>
    <span className="session-panel-name">세션</span>
    {/* 접혀 있어도 보인다 — 그래야 접어 둔 채로도 무엇이 기다리는지 알 수 있다. */}
    {waiting > 0 ? <span className="session-panel-wait">대기 {waiting}</span> : null}
  </button>
  ```
  CSS: `.session-panel-title { display: flex; min-width: 0; flex: 1 1 auto; align-self: stretch; align-items: center; justify-content: flex-start; gap: 6px; padding: 0; border: 0; color: inherit; background: transparent; font: inherit; text-align: left; text-transform: inherit; cursor: pointer; }`, `.session-panel-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`, `.session-panel-wait { flex: 0 0 auto; white-space: nowrap; …기존 값 }`(헤더 직계가 아니게 되어 `.section-heading > span` 말줄임 규칙이 안 닿는다), `.session-panel-scope { flex: 0 0 auto; display: inline-flex; gap: 2px; }`(`margin-left: auto` 제거). 드롭 핸들러는 헤더 div에 그대로 — 버튼 위 이벤트가 버블링하므로 App.test의 헤더 drop 테스트는 그대로 통과.
- [ ] **Step 4: 통과 확인** — `npm test`, `npm run typecheck`, `npx playwright test --list`.
- [ ] **Step 5: 커밋** — `fix(session-panel): 세션 헤더의 남는 폭 전체로 작업공간을 연다`.

### Task 14: 설정 모델 — `projects.categories` / `defaultCategory`

**Files:**
- Create(없으면): `src/shared/accent-palette.ts`(+test) — Task 6 개정 참조
- Modify: `src/shared/settings-types.ts`(타입 L36-53, `DEFAULT_SETTINGS`, `parseSettings` L97-164, `mergeSettingsPatch` L166-177), `src/main/ipc.ts`(`validateSettingsPatch` ~L494-582)
- Test: `src/shared/settings-types.test.ts`, `src/main/ipc.test.ts`

**Interfaces:**
```ts
export interface ProjectCategorySetting { name: string; /** 팔레트 인덱스 1..ACCENT_COLOR_COUNT — 색이 아니라 인덱스인 것은 테마가 색을 정하기 때문 */ color: number }
export interface ProjectSettings { categories: ProjectCategorySetting[]; /** 항상 categories 안의 이름(파서가 보장) */ defaultCategory: string }
export interface AppSettings { …; projects: ProjectSettings }
export interface AppSettingsPatch { …; /** categories는 통째 교체 — 삭제·순서 변경은 부분 병합으로 표현할 수 없다 */ projects?: { categories?: ProjectCategorySetting[]; defaultCategory?: string } }
export const MAX_CATEGORY_NAME_LENGTH = 32;
export const DEFAULT_PROJECT_CATEGORIES: readonly ProjectCategorySetting[] = [{ name: "업무", color: 1 }, { name: "개인", color: 4 }, { name: "연구", color: 3 }, { name: "기타", color: 5 }];
// DEFAULT_SETTINGS.projects = { categories: [...DEFAULT_PROJECT_CATEGORIES], defaultCategory: "기타" }
```
파서 규칙(`readProjectSettings(raw.projects)`): ① `categories`가 배열이 아니면 기본 목록 ② 항목: 객체가 아니거나 `name`이 문자열이 아니면 버림 → `name.trim().slice(0, 32)` → 빈 값·중복(첫 등장 유지) 버림 ③ `color`가 정수 1..7이 아니면 순환 기본 `((살아남은 인덱스) % 7) + 1` ④ 살아남은 목록이 비면 기본 목록 ⑤ `defaultCategory` trim, 목록에 있으면 그대로, 없으면 `categories[0].name`. `mergeSettingsPatch`는 얕은 병합(`projects: { ...current.projects, ...patch.projects }`) — 정규화는 파서 몫이고 `json-store`가 쓰기 경로에서도 파서를 돌리므로(`updateJsonStore`) 디스크와 `current()` 모두 고쳐진 값을 갖는다(주석+테스트). IPC `validateSettingsPatch`: `exactObject` 키에 `projects`; 하위 `exactObject(["categories","defaultCategory"])`; `categories`는 배열이어야 하고 항목은 `exactObject(["name","color"])`에 `name` nonEmptyString, `color` 정수 1..7; `defaultCategory` nonEmptyString(엄격 — 파서가 고쳐 주는 것과 IPC가 받아 주는 것은 다른 문제).

- [ ] **Step 1: 실패하는 테스트** — `accent-palette.test.ts`(Task 6 개정의 4건); `settings-types.test.ts` 7건: 기본 목록이 범용값·기본 구분 기타·색 4개 서로 다름 / `parseSettings({}).projects`가 기본값(구버전 파일) / `{categories:[{name:" 업무 ",color:2},{name:"업무",color:3},{name:"",color:1},{name:"연구",color:0},{name:"기타",color:"파랑"}], defaultCategory:"없는 것"}` → `[{업무,2},{연구,2},{기타,3}]`·`defaultCategory === "업무"` / 빈 목록 → 기본 목록(+`defaultCategory:"업무"`는 기본 목록에 있으므로 유지) / `parseSettings(mergeSettingsPatch(DEFAULT_SETTINGS, { projects: { categories: [{ name: "업무", color: 1 }] } })).projects.defaultCategory === "업무"` / `projects` 없는 패치는 기존 목록 유지 / 이름 32자 절단. `ipc.test.ts`: `settings:update`가 `{ projects: { categories: [{name:"업무",color:1}], defaultCategory:"업무" } }`를 그대로 전달; 거부 5종(`color: 9`, `name: ""`, 항목에 모르는 키, `projects: { theme: 1 }`, `categories: "업무"`) — 전부 게이트웨이 미호출.
- [ ] **Step 2: 실패 확인** / **Step 3: 구현** / **Step 4: 통과 확인** — `npm test`, `npm run typecheck`.
- [ ] **Step 5: 커밋** — `feat(settings): 업무 프로젝트 구분 목록을 설정 스키마에 넣는다`.

### Task 15: 설정 창 "프로젝트" 탭

**Files:**
- Modify: `src/renderer/src/SettingsDialog.tsx`(`SettingsTab`·`TABS` L21-30에 `{ id: "projects", label: "프로젝트" }`를 워크스페이스 앞에; `WorkspaceSettings` 뒤에 `ProjectsSettings`; 본문 분기), `src/renderer/src/index.css`(`.settings-category-row { gap: 8px }`, `.settings-category-row > input[type="text"] { width: 140px }`, `.settings-swatches { display: inline-flex; gap: 4px }`, `.settings-swatch { width: 16px; height: 16px; padding: 0; border: 2px solid transparent; border-radius: 50%; background: var(--category-accent, var(--muted)); cursor: pointer }`, `.settings-swatch.selected { border-color: var(--text) }`)
- Test: `src/renderer/src/SettingsDialog.test.tsx`

**Interfaces:** `function ProjectsSettings({ projects, onChange }: { projects: ProjectSettings; onChange(next: AppSettingsPatch["projects"]): void })`; 본문 `tab === "projects"` → `<ProjectsSettings projects={settings.projects} onChange={(next) => update({ projects: next })} />`. 저장 버튼 없음(다른 탭과 같이 즉시).

마크업/문구: `<h2>프로젝트 구분</h2>`, 힌트 `업무 프로젝트의 구분입니다. 사이드바 레일, 홈 카드, 상세 페이지 칩의 색을 정합니다.`; `<ul className="settings-list" aria-label="구분 목록">` 행마다 `<li className="settings-row settings-category-row">`: 이름 `<input type="text" aria-label={`구분 ${index+1} 이름`} maxLength={32}>`(로컬 드래프트, blur 커밋, Enter는 `isComposing` 아니면 blur, 빈 값이면 원복 — `WorkProjectDetailPage`의 이름 필드 관례), 색 `<span role="radiogroup" aria-label={`${name} 색`}>`에 `ACCENT_INDEXES.map` → `<button type="button" role="radio" aria-checked aria-label={`색 ${n}`} className={`settings-swatch ${accentClass(n)}${selected ? " selected" : ""}`}>`(즉시 저장), 동작 `<span className="settings-key-controls">`에 `"{name} 위로"`(첫 행 disabled)·`"{name} 아래로"`(끝 행 disabled)·`"{name} 삭제"`(목록이 1개면 disabled); 목록 아래 `구분 추가`(끝에 `새 구분`/`새 구분 2`…, 색 `((길이 % 7) + 1)`, 새 행 입력에 포커스); `<label htmlFor="settings-default-category">기본 구분</label><select id=…>`(목록 이름만, 즉시 저장); 힌트 `새로 만들어지는 업무 프로젝트가 받는 구분입니다. 이미 있는 프로젝트의 구분은 바뀌지 않습니다. 이름을 바꿔도 마찬가지입니다 — 목록에서 빠진 구분은 회색으로 보이고, 상세 페이지에서 다시 고를 수 있습니다.` 삭제한 항목이 기본 구분이면 목록만 보내고 파서가 첫 항목으로 되돌린다(UI가 중복 계산하지 않음).

- [ ] **Step 1: 실패하는 테스트** — `openProjects()` = `프로젝트` 탭 버튼 클릭. (1) 기본 목록 4행 순서·첫 행 이름 `업무`·`radiogroup "업무 색"`의 `radio "색 1"`이 `aria-checked="true"` (2) `색 6` 클릭 → `update({ projects: { categories: [{name:"업무",color:6}, …나머지 그대로] } })` (3) `개인 위로` → `categories[0].name === "개인"` (4) 삭제가 항목을 빼고 하나 남으면 `삭제` disabled (5) `구분 추가` → 5개, 마지막 `새 구분` (6) 이름은 blur에 저장(change만으로는 미호출), 빈 값 blur는 미호출+원복 (7) 기본 구분 select → `update({ projects: { defaultCategory: "연구" } })` (8) 기존 탭 회귀 — 기존 케이스 무변경 통과.
- [ ] **Step 2~4** — `npx vitest run src/renderer/src/SettingsDialog.test.tsx`, `npm test`, `npm run typecheck`.
- [ ] **Step 5: 커밋** — `feat(settings): 설정 창 프로젝트 탭에서 구분 목록을 편집한다`.

### Task 16: 소비처 전환 + 채널 매핑 제거 + 기본 구분 주입 (T6·T8 뒤)

**Files:**
- Modify: `src/renderer/src/work-project-accent.ts`(`WorkProjectAccent`·`CATEGORY_ACCENTS` 삭제, `categoryAccentClass(category, categories)`), `src/renderer/src/ProjectSidebar.tsx`(prop `categories`, 업무 프로젝트 노드 레일), `src/renderer/src/HomeDashboard.tsx`(prop `categories`, 카드·칩), `src/renderer/src/WorkProjectDetailPage.tsx`(prop `categories`; select 옵션 = 설정 목록 + 현재 값; 칩), `src/renderer/src/pane-context.ts`(`PaneContextSources.categories` — **다섯 번째 소비처**), `src/renderer/src/App.tsx`(`const projectCategories = appSettings.projects.categories;`를 사이드바·홈·상세·`paneContexts` sources/deps에), `src/shared/work-project-types.ts`(`WORK_PROJECT_CATEGORIES` 삭제 — `WorkProjectDetailPage` import도 같은 커밋), `src/renderer/src/index.css`(`.category-government/outsourcing/research/product` 클래스 삭제; `.category-etc`와 `--category-*` 토큰 5개는 유지 — `.accent-1..5` 별칭), `src/main/projects/work-project-service.ts`(`CHANNEL_CATEGORY`·`ChannelLetter` import 삭제; 옵션 `defaultCategory?: () => string`(게터 — 설정이 언제든 바뀌므로); `private defaultCategory()`가 게터 값 trim → 비면 `DEFAULT_SETTINGS.projects.defaultCategory`; `createWorkProject`의 `input.category === undefined ? this.defaultCategory() : input.category`; `syncFromWorkspace` 시작에서 한 번 뽑아 `category: defaultCategory`), `src/main/runtime.ts`(`new WorkProjectService({ …, defaultCategory: () => settingsService.current().projects.defaultCategory })` — 동기 캐시)
- Test: `work-project-accent.test.ts`(재작성: 목록 이름→`accent-n`, 없는 값·빈 문자열→`category-etc`, 공백 무시, 서로 다른 색은 서로 다른 클래스, 빈 목록이면 전부 회색), `pane-context.test.ts`(`SOURCES.categories`, `category-government`→`accent-1`), `WorkProjectDetailPage.test.tsx`(`renderPage`에 `categories`; 픽스처 `정부지원과제`는 그대로 — 옛 값 사례; 신규: 옛 구분은 현재 값으로 남고 회색 / 목록에서 고르면 즉시 `accent-3`), `HomeDashboard.test.tsx`(`baseProps.categories`; 신규: 카드가 설정 색·없는 값은 회색), `App.test.tsx`(`describe("work project categories")`의 어휘 교체 `정부지원과제→업무, 외주개발→개인, 상품개발→연구`; `toHaveClass("category-government")`→`"accent-1"` 등; "reads a legacy or custom 구분 as 기타"는 제목만 `설정 목록에 없는 구분은 회색으로 남는다`로, `category-etc` 단언 유지; 신규: `emitSettings({ ...DEFAULT_SETTINGS, projects: { categories: [{name:"업무",color:6}], defaultCategory:"업무" } })` 뒤 그룹 노드가 `accent-6`), `work-project-workspace-sync.test.ts`(`service()`에 `defaultCategory` 통과; 채널→구분 단언을 전부 기본 구분으로; "maps every channel letter onto a category" 삭제 → `셸에서 만들어지는 업무 프로젝트는 설정의 기본 구분을 받는다`(`defaultCategory: () => "업무"`); 사용자가 손본 구분이 살아남는 테스트는 그대로), `work-project-service.test.ts`(신규: `defaultCategory: () => "업무"`면 `createWorkProject({ name })`이 `업무`, 명시 `category: "연구"`가 이김).

- [ ] **Step 1: 실패하는 테스트** / **Step 2: 실패 확인** / **Step 3: 구현**(`categoryAccentClass`: `const key = category.trim(); const found = categories.find((c) => c.name === key); return found ? accentClass(found.color) : "category-etc";` — 두 번째 인자는 **필수**(옵셔널이면 빠진 소비처가 조용히 회색이 된다); 상세 페이지 `const names = categories.map(c => c.name); const categoryOptions = names.includes(category) ? names : [category, ...names];` 주석: 목록에서 빠진 옛 구분도 사라지지 않는다 — 화면에 없는 값을 담은 select는 다음 저장 때 조용히 값을 바꾼다) / **Step 4: 통과 확인** — `npm test`, `npm run typecheck`(필수 인자가 소비처 5곳을 잡는지가 핵심 신호).
- [ ] **Step 5: 커밋** — `refactor(work-projects): 구분 색과 기본값을 설정 목록에서 읽는다`.

### Task 17: 문서 · 릴리스 노트

**Files:**
- Modify: `docs/local-data.md`(`work-projects.json` 설명에서 "카테고리 색" 제거 → "업무 프로젝트(폴더 묶음)와 소속 폴더"; `userData` 표에 `settings.json | 언어·터미널·알림·단축키·업무 프로젝트 구분 목록` 행), `docs/superpowers/specs/2026-08-13-settings-window-design.md`(설정 분류에 "프로젝트" 한 줄), `docs/superpowers/specs/registry-contract.md` §8(Task 11과 합쳐도 됨)
- Create: `docs/release/v1.29.0.md` 초안 — 변경 사항(구분을 설정에서 직접 만든다: 설정 › 프로젝트 탭에서 이름·색(7색)·순서·기본 구분 / 기본 목록이 범용값 업무·개인·연구·기타 / ws-root 셸의 새 업무 프로젝트는 채널 글자가 아니라 설정의 기본 구분, 채널 정보는 태그로 / 세션 패널 헤더의 남는 폭 전체를 눌러 작업공간을 연다(숨김 행과 같은 규칙), 대기 배지도 같은 과녁) + 태그 플랜의 릴리즈 노트 초안 병합. **업그레이드 시 보이는 변화**: v1.28 이전에 만든 `정부지원과제`·`외주개발`·`상품개발` 프로젝트는 새 기본 목록에 없어 회색으로 보인다 — 값은 그대로고 상세 select에 현재 값으로 남으며, 설정 › 프로젝트에서 같은 이름을 추가하거나 프로젝트마다 새 구분을 고르면 색을 되찾는다 / `기타`는 지금까지와 같은 회색 / 구버전으로 되돌리면 `settings.json`의 구분 목록이 지워질 수 있다(모르는 필드를 버리는 파일; 업무 프로젝트에 저장된 구분 값은 무관).

- [ ] **Step 1: 문서 수정·초안 작성** / **Step 2: 커밋** — `docs: 구분 설정과 세션 헤더 변경을 문서·릴리스 노트에 반영`.

### Task 18: 폴더 아래 세션·문서 행과 worktree 층 복원 (사용자 피드백 2026-09-03; T8·T9 뒤, T15 앞)

> 사용자 결정: 좌측 트리에서 **폴더 아래에 세션(·문서) 행을 다시** 보이고, worktree가 있는 레포는 폴더 아래에 `메인 · branch` / `⎇ branch` 층으로 나눠 그 안에 세션을, **worktree가 하나도 없으면 그 층 없이** 바로 세션 행을 둔다. 상단 세션(작업공간) 패널은 **그대로**(작업공간에 담긴 패인 + 대기 N + 전체/여기). 같은 세션이 두 곳에 보이되 역할이 다르다(위 = 지금 화면에 모은 것, 아래 = 어느 폴더의 것).
>
> 판정 **R8** 접근성 이름 분리: 트리 행은 v1.26의 이름 `{라벨} 세션 열기[ (읽지 않음)]` / `{라벨} 문서 열기[ (저장 안 됨)]` / `{라벨} 닫기`, 상단 패널 행은 v1.26 셸프의 이름 `{라벨} 패인 열기`(문서도)로 바꾼다 — 한 화면에 같은 이름의 버튼이 둘이면 `getByRole` 정확 일치가 전부 깨진다. 패널 행을 겨냥하던 테스트(App.test·e2e)는 `패인 열기`로, 트리 행 테스트는 `세션 열기`로. **R9** 폴더 접힘·"이미 보는 행을 다시 누르면 접힘"(`gridProjectId`)을 v1.26 그대로 되살리고, 접힘 저장 키는 일부러 지우지 않았던 `multi-cli-work.projects.v1`(`COLLAPSED_PROJECTS_KEY`)을 다시 읽는다 — 업그레이드 전 배치가 그대로 돌아온다.

**Files:**
- Create: `src/renderer/src/PaneRows.tsx`(+`.test.tsx`) — `SessionRow`·`DocumentRow`를 `SessionPanel.tsx`의 `renderSession`(L110-158)·`renderDocument`(L165-195)에서 추출해 패널·트리가 공유
- Modify: `src/renderer/src/SessionPanel.tsx`(행 렌더를 `PaneRows`로 교체, 접근성 이름 `패인 열기`), `src/renderer/src/ProjectSidebar.tsx`(폴더 노드 L692-795: 체버론·`aria-expanded` 복원, 폴더/worktree 아래 `session-tree`; worktree 층 블록은 `git show v1.26.2:src/renderer/src/ProjectSidebar.tsx` L932-990을 본으로; props `worktrees`·`activeReviews`·`workspaceViews`·`selectedWorktreeId`·`onSelectWorktree`·`onWorktreeContextMenu`·`expandedProjects`·`onToggleProject`·`gridProjectId`·`documentPanes`·`onSelectSession`·`onSelectDocument`·`onCloseDocument`·`unread` 복원), `src/renderer/src/App.tsx`(`COLLAPSED_PROJECTS_KEY = "multi-cli-work.projects.v1"`, `expandedProjects`/`collapsedProjectIds`/`toggleProject`/`applyExpansion(expandedProjectIds, expandedWorkProjectIds)`/`expandAll`/`collapseAll`/`expandWorking`(폴더 포함), `gridProjectId`, 복원 시 `setExpandedProjects` — `git show v1.26.2:src/renderer/src/App.tsx` L175, L290-298, L1365-1427, L2344-2347과 호출부(`selectProject`·`revealPane`·`selectWorktree`·복원 2곳·폴더 추가/재연결·컨텍스트 메뉴 이름변경)를 본으로; 사이드바 props 전달), `src/renderer/src/index.css`(v1.26.2의 `.worktree-tree`(L2488-2492)·`.worktree-row.two-line`(L2581-2584)·`.workspace-select`(L2585-2603)·`.workspace-meta`(L2605-2618)·`.worktree-row.selected`(L2638-2642)·`.worktree-sessions`(L2307) 규칙 복원 — `git show v1.26.2:src/renderer/src/index.css`)
- Test: `src/renderer/src/App.test.tsx`(v1.26.2의 `nests worktree sessions under a third tree level and scopes the grid and detail page to it`·`hangs an opened document under its folder in the tree, and closes it from there`·`keeps folders with a running agent open and closes the rest, across the group and folder layers alike`·`collapses and re-expands both layers at once, and remembers it across a restart`·`folds the row already on screen instead of opening it again, on both layers`를 `git show v1.26.2:src/renderer/src/App.test.tsx`에서 가져와 채널 대신 태그 묶음(T8) 기준으로 손본다; 패널 행을 겨냥하던 기존 테스트는 `패인 열기`로; 신규: `worktree가 없는 폴더는 세션이 폴더 바로 아래에 선다(worktree 층 없음)`, `worktree가 하나라도 있으면 메인·worktree 층이 생기고 각자 자기 세션만 품는다`), `e2e/desktop.spec.ts`(`paneRow`(L77)는 트리 행(`세션 열기`)을 겨냥하므로 그대로; 패널 행을 누르던 단계가 있으면 `패인 열기`로; worktree 카드 경로(Task 4 이전 작업)는 그대로 두되 트리 worktree 행 우클릭이 다시 가능해졌으므로 스모크는 손대지 않는다)

**Interfaces:**
```tsx
// src/renderer/src/PaneRows.tsx — 마크업·클래스(session-row, status-*, current, on-screen, .status-dot, .session-name, .session-status, .unread-dot, .file-tab-row/.file-tab-open/.file-tab-close/.file-tab-dot)는 지금 SessionPanel의 것 그대로
export interface SessionRowProps {
  session: TerminalSessionView; label: string; place?: string | null; branch?: string | null;
  agent: AgentView | undefined; tool: boolean; attention: SessionAttention | null;
  current: boolean; onScreen: boolean;
  /** 접근성 이름의 동사 — 트리는 "세션 열기", 패널은 "패인 열기"(R8). */
  verb: "세션 열기" | "패인 열기";
  onSelect(): void; onContextMenu(event: ReactMouseEvent): void;
  renaming: boolean; initialName: string; onRename(name: string | null): void; onCancelRename(): void;
  dragProps: { draggable: boolean; onDragStart(e: ReactDragEvent<HTMLElement>): void; onDragEnd(): void };
  /** 행 오른쪽 끝 — 패널은 숨김(눈) 버튼, 트리는 없음. */
  trailing?: ReactNode;
}
export function SessionRow(props: SessionRowProps): JSX.Element;
export interface DocumentRowProps { pane: DocumentPane; label: string; place?: string | null; branch?: string | null; current: boolean; onScreen: boolean; verb: "문서 열기" | "패인 열기"; onOpen(): void; dragProps: …; trailing?: ReactNode /* 트리: `{label} 닫기` ✕, 패널: 숨김 버튼 */ }
export function DocumentRow(props: DocumentRowProps): JSX.Element;
```
사이드바 트리: 폴더 `<li className="project-node" role="treeitem" aria-expanded={expanded}>`에 `tree-toggle`(`"{이름} 접기/펼치기"`) 복원; `showing = gridProjectId === project.id`면 클릭이 접기. `projectWorktrees.length === 0`이면 `<ul className="session-tree" role="group" aria-label="{이름} 패인">`에 폴더 세션(`worktreeId === undefined`)·문서(`owner.kind === "project"`); 있으면 `<ul className="worktree-tree" role="group" aria-label="{이름} worktree">`에 `메인 · {branch}` 행(`workspace-select`, `"{이름} 메인 선택"`… v1.26의 `메인 펼치기/접기` 토글, 클릭 `onSelectProject`)과 worktree 행(`"{branch} worktree 선택"`, 우클릭 `onWorktreeContextMenu`, `변경 N · 세션 N`, `PR #n · 임시`·locked·missing·prunable)이 각자 `session-tree worktree-sessions`에 자기 세션·문서를 품는다. 접힘 키는 옛 `main:<workspaceKey>`/`worktree:<id>`(`expandedWorkspaces`, 키 있으면 접힘; 선택 중이면 항상 펼침 — v1.26 L944·986). 세션 행: `label = sessionLabel(session, projectSessions, agents)`, `attention = unread[session.id]`, `current = focusedPaneId === id`, `onScreen = onScreenPaneIds.has(id)`, 클릭 `onSelectSession(session)`(=`revealSession`), 드래그 `paneDragProps`.

- [ ] **Step 1: 실패하는 테스트** — `PaneRows.test.tsx`(세션 행: 접근성 이름이 `verb`에 따라 `X 세션 열기`/`X 패인 열기`, 읽지 않음 접미, `current`/`on-screen` 클래스, 이름 변경 모드에서 `SessionNameInput`, `trailing` 렌더; 문서 행: `문서 열기`/`닫기`, dirty 접미) + App.test 재작성·신규(위 목록) + 패널 테스트의 이름 교체.
- [ ] **Step 2: 실패 확인** / **Step 3: 구현** / **Step 4: 통과 확인** — `npm test`, `npm run typecheck`, `npx playwright test --list`.
- [ ] **Step 5: 커밋** — `feat(sidebar): 폴더 아래 세션·문서 행과 worktree 층을 되살린다`.

---

## 검증 (전체)

- `npm test`(기준선 106 파일/1153), `npm run typecheck`, `npm run test:e2e:smoke`(채널 참조가 없어 e2e 수정 불필요; Task 13의 헤더 배치 단언은 여기서 돈다), `npm run test:e2e`(Task 13의 헤더 클릭 단언, Task 18 뒤 트리 행 경로).
- 설치 후 수동: 상세 페이지 태그 추가/제거·자동완성·한글 Enter, 묶기로 둘 고르면 순서대로 묶이고 기타·미분류 위치, 업그레이드 직후 채널 라벨 묶음 `(자동)`, 묶기 해제 시 평면, 재시작 후 유지, 트리 행·홈 카드 칩, `Ctrl+P` `#태그`, Claude 세션 브리프 `- 태그:` 줄.
