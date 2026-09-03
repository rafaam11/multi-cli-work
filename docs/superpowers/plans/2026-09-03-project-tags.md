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

**Files:**
- Create: `src/renderer/src/tag-color.ts`, Test: `src/renderer/src/tag-color.test.ts`
- Modify: `src/renderer/src/index.css`(`:root`에 `--tag-accent-6`·`--tag-accent-7` 토큰, `.category-*`(L61-79) 뒤에 `.tag-accent-1`…`.tag-accent-7`이 `--category-accent`를 세팅 — 1~5는 기존 `--category-*` 별칭)

**Interfaces:**
- Produces: `export const TAG_ACCENT_COUNT = 7; export function tagAccentIndex(tag: string): number /* 1..7 */; export function tagAccentClass(tag: string): string /* "tag-accent-n" */;` — FNV-1a 32bit over `tag.trim()`.

- [ ] **Step 1: 실패하는 테스트** — 같은 입력 → 같은 클래스(고정 입력 3개 `"개인"`, `"AI"`, `"연구"`의 결과 문자열을 **하드코딩**해 해시 변경을 잡는다; 구현 후 실제 값으로 채운다) / 100개 임의 문자열이 전부 `1..7` / 앞뒤 공백 무시(`"AI"`와 `" AI "` 같음) / 한국어 태그 8개(`개인·회사·대학원·연구실·AI·로보틱스·재무·건강`)가 5종 이상으로 흩어진다.
- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/tag-color.test.ts`.
- [ ] **Step 3: 구현**
  ```ts
  /**
   * 태그 색은 뜻이 아니라 구별 표시다 — 자유 문자열에 의미론적 이름을 붙일 수 없으므로 클래스도
   * 번호다. 팔레트는 index.css의 --category-* 계열을 다시 쓴다: 한 화면에 색 계열이 둘이면 색이
   * 무엇을 뜻하는지 흐려진다(채널 색이 같은 이유로 그 팔레트를 썼다).
   */
  export const TAG_ACCENT_COUNT = 7;
  /** FNV-1a — 로케일·플랫폼과 무관해야 같은 태그가 어느 화면에서나 같은 색이 된다. */
  export function tagAccentIndex(tag: string): number {
    let hash = 0x811c9dc5;
    for (const char of tag.trim()) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return (hash % TAG_ACCENT_COUNT) + 1;
  }
  export function tagAccentClass(tag: string): string { return `tag-accent-${tagAccentIndex(tag)}`; }
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
- [ ] **Step 3: 구현** — 위 Interfaces대로. CSS: `.channel-*`(L85-103) 삭제, 채널 노드 스타일을 `.tag-group-node/.tag-group-row/.tag-group-copy/.tag-group-name/.tag-group-children`로 옮기고(레일 색은 `--category-accent`를 `.tag-accent-n`이 세팅), `.tag-group-other`는 회색, `.grouping-picker`·`.grouping-picker-menu`·`.grouping-picker-item` 신규.
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

## 검증 (전체)

- `npm test`(기준선 106 파일/1153), `npm run typecheck`, `npm run test:e2e:smoke`(채널 참조가 없어 e2e 수정 불필요).
- 설치 후 수동: 상세 페이지 태그 추가/제거·자동완성·한글 Enter, 묶기로 둘 고르면 순서대로 묶이고 기타·미분류 위치, 업그레이드 직후 채널 라벨 묶음 `(자동)`, 묶기 해제 시 평면, 재시작 후 유지, 트리 행·홈 카드 칩, `Ctrl+P` `#태그`, Claude 세션 브리프 `- 태그:` 줄.
