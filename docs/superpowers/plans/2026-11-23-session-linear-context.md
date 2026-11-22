# 세션 브리프의 Linear 맥락 + 커밋 후 기록 리마인드 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업무 폴더에서 claude·codex 세션을 열면, 그 폴더가 속한 PRJ의 Linear 맥락(열린 이슈·최근 업데이트·댓글)이 브리프에 실린다. Claude 세션이 새 커밋을 남기고 멈추면 Linear에 기록하라는 리마인드가 한 번 들어온다.

**Architecture:**
- main 프로세스의 `LinearService`가 Linear GraphQL을 부른다. 상한은 3초이고 결과는 5분 캐시한다.
- 폴더 → PRJ-key 매핑은 ws-root의 `PROJECT.yaml` `repos:`를 **읽기 전용 스냅샷**으로 조회한다. 이 스냅샷은 `workspace.json`에 등록하지 않는다.
- 렌더한 절은 기존 `writeSessionBrief` 섹션 배열에 하나로 끼운다.
- 리마인드는 기존 Claude 상태 훅이 맡는다. Stop 이벤트에서 `HEAD`를 비교해 `decision:"block"`을 낸다.

**Tech Stack:** Electron 43 · TypeScript 5 · React 18 · vitest · PowerShell 5.1 / Python 3 훅

**Spec:** `docs/superpowers/specs/2026-11-23-session-linear-context-design.md` (상위: `C:/dev/llmwiki/docs/superpowers/specs/2026-11-23-linear-notion-agent-context-design.md` §4)

## Global Constraints

- 세션 시작 지연 상한은 **3초**다. 실패·키 없음·시간 초과면 Linear 절을 조용히 뺀다. 세션 시작은 절대 막지 않는다.
- 캐시는 **5분**(프로젝트 키별)이다. 키를 바꾸거나 지우면 캐시를 비운다.
- 브리프 절 상한:
  - 열린 이슈 최대 **8**개
  - 프로젝트 업데이트 최대 **2**건
  - 댓글 최대 **5**건
  - 절 전체 **30줄**
  - 제목 **80자**
- 정렬 규칙: `repo:<폴더 레포 이름>` 라벨이 붙은 이슈 → 우선순위(1 긴급 … 4 낮음, 0 없음은 맨 뒤) → 기한 오름차순(없으면 뒤).
- 인증: Linear 개인 API 키는 `Authorization: <key>` 헤더로 보낸다(**Bearer 없음**). 엔드포인트는 `https://api.linear.app/graphql`.
- 키 보관:
  - safeStorage 암호문으로 `userData/linear-credentials.json`에 둔다.
  - 렌더러에는 "설정됨/안 됨"만 돌려준다.
  - 세션 환경변수로 넘기지 않는다.
- PRJ-key 매칭: Linear 프로젝트 **이름**이 정확히 `PRJ-####`로 시작하고, 그 뒤가 공백이거나 끝인 것을 고른다.
- 새 jk 도구는 만들지 않는다. 세션은 `linear` CLI를 직접 쓴다. MCW는 CLI를 설치하지 않는다.
- PS1 훅에는 한글 리터럴을 넣지 않는다. BOM 없는 .ps1에서 한글이 깨진다. stdout에 내보내는 JSON은 `\uXXXX`로 이스케이프한다(기존 SessionStart 패턴).
- 리마인드 문구(정확한 문구):
  - `방금 새 커밋이 생겼다. 관련 Linear 이슈에 진행·결정·다음 할 일을 댓글 1건으로 남겨라(첫 줄은 [mcw-claude]). 이미 남겼으면 바로 멈춰라.`
- 브리프 마커 `<!-- mcw:linear-record -->`: Linear 절이 실리고 리마인드 설정이 켜졌을 때만 절 끝에 붙인다.
- 새 설정 두 개(`general`)는 둘 다 기본값 `true`다.
  - `linearBrief`: 브리프에 Linear 맥락 싣기
  - `linearRecordReminder`: 커밋 후 기록 리마인드
- 테스트는 `npx vitest run <파일> --pool=threads`로 돌린다. 전체 스위트는 `npx vitest run --pool=threads --maxWorkers=2`다.

## Review Focus

1. **Linear가 느리거나 오프라인일 때**: 세션은 3.5초 안에 Linear 절 없이 떠야 한다. Task 4의 `briefSection returns null after the deadline`이 고정한다.
2. **키가 중간에 폐기됐을 때(401)**: 절이 빠지고, 설정의 연동 상태에 사유가 한 줄 보이고, 다음 성공에서 사유가 지워진다. Task 4의 `records and clears lastError`.
3. **열린 이슈가 50개를 넘거나 제목이 길 때(한글 포함)**: 8개, 80자, 30줄 상한을 지킨다. Task 3의 `caps issues, titles and total lines`.
4. **세션 cwd가 매핑된 레포의 하위 폴더이거나 worktree 경로일 때**: 조상 경로로 PRJ를 찾는다. 등록된 폴더 경로로 조회한다. Task 5의 `maps a nested path through its ancestor repo`.
5. **git이 아닌 폴더, 커밋이 없는 새 레포, git 미설치**: Stop 훅은 아무것도 출력하지 않고 종료 코드 0으로 끝난다. Task 6의 `stays silent outside a git repository`.

---

### Task 1: 암호화 토큰 저장소 일반화 + Linear 키 저장소

**Files:**
- Create: `src/main/storage/encrypted-token-store.ts`
- Modify: `src/main/notion/notion-token-store.ts` (지금 구현을 일반 팩토리로 옮기고 래퍼만 남김)
- Create: `src/main/linear/linear-key-store.ts`
- Test: `src/main/linear/linear-key-store.test.ts` (기존 `src/main/notion/notion-token-store.test.ts`는 그대로 통과해야 함)

**Interfaces:**
- Produces:
  - `createEncryptedTokenStore(filePath: string, safeStorage: SafeStorageLike, labels: { label: string; displayName: string }): EncryptedTokenStore`
  - `EncryptedTokenStore` = 지금 `NotionTokenStore`와 같은 모양: `encryptionAvailable() / read() / write(token) / clear()`
  - `SafeStorageLike`는 `encrypted-token-store.ts`로 옮기고 `notion-token-store.ts`에서 다시 export한다
  - `createLinearKeyStore(filePath: string, safeStorage: SafeStorageLike): LinearKeyStore`. `type LinearKeyStore = EncryptedTokenStore`이고 labels는 `{ label: "linear credentials", displayName: "Linear 자격 증명" }`

- [ ] **Step 1: 실패하는 테스트 작성** — `linear-key-store.test.ts`. 가짜 safeStorage는 notion 테스트의 것을 복사한다.
  - `write → read`가 원문을 돌려준다.
  - 파일에 원문이 없다.
  - `clear` 뒤 `read`는 `null`이다.
  - 암호화를 쓸 수 없으면 `write`가 던진다.
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `npx vitest run src/main/linear/linear-key-store.test.ts --pool=threads`
  - Expected: FAIL (모듈 없음)
- [ ] **Step 3: 구현**
  - `notion-token-store.ts`의 본문을 `createEncryptedTokenStore`로 옮긴다. 오류 클래스·라벨만 매개변수로 받는다.
  - `createNotionTokenStore`는 `createEncryptedTokenStore(filePath, safeStorage, { label: "notion credentials", displayName: "노션 자격 증명" })`를 돌려준다.
- [ ] **Step 4: 두 테스트 통과 확인**
  - Run: `npx vitest run src/main/linear/linear-key-store.test.ts src/main/notion/notion-token-store.test.ts --pool=threads`
  - Expected: PASS
- [ ] **Step 5: Commit** — `refactor: one encrypted token store for Notion and Linear keys`

### Task 2: Linear GraphQL 클라이언트

**Files:**
- Create: `src/shared/linear-types.ts`
- Create: `src/main/linear/linear-client.ts`
- Test: `src/main/linear/linear-client.test.ts`

**Interfaces:**
- Produces (`linear-types.ts`):
  ```ts
  export interface LinearKeyStatus { configured: boolean; encryptionAvailable: boolean; lastError: string | null }
  export type LinearHealth = "onTrack" | "atRisk" | "offTrack";
  export interface LinearIssueSummary { identifier: string; title: string; stateName: string; stateType: string; dueDate: string | null; priority: number; labels: string[] }
  export interface LinearUpdateSummary { health: LinearHealth | null; body: string; createdAt: string }
  export interface LinearCommentSummary { issueIdentifier: string; body: string; createdAt: string }
  export interface LinearProjectContext { name: string; url: string; issues: LinearIssueSummary[]; updates: LinearUpdateSummary[]; comments: LinearCommentSummary[] }
  ```
- Produces (`linear-client.ts`):
  - `LinearClientOptions { fetch?: FetchLike; timeoutMs?: number }`. 기본 timeout은 15000ms. `FetchLike`는 `notion-client.ts`와 같은 시그니처로 여기서 선언한다.
  - `verifyLinearKey(key: string, options?: LinearClientOptions): Promise<void>`
    - 질의는 `viewer { id }`.
    - 실패하면 한국어 메시지로 던진다: 인증 실패 "Linear API 키가 거부됐습니다", 한도 "Linear 요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요", 그 밖 "Linear에 연결할 수 없습니다".
  - `fetchLinearProjectContext(key: string, prjKey: string, options?: LinearClientOptions): Promise<LinearFetchResult>`
  - `type LinearFetchResult = { kind: "ok"; context: LinearProjectContext } | { kind: "no-project" } | { kind: "unauthorized" } | { kind: "rate-limited" } | { kind: "network-error" }`
  - `linearFailureMessage(kind: Exclude<LinearFetchResult["kind"], "ok">): string`. 메시지는 위 세 가지에 "no-project" → "이 PRJ의 Linear 프로젝트를 찾지 못했습니다"를 더한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `fetch`는 모의 함수로 넣는다.
  - `sends the key without Bearer`: 헤더 `Authorization === "lin_api_x"`, `Content-Type: application/json`, POST, URL `https://api.linear.app/graphql`
  - `filters projects by name prefix and picks the exact key`: 이름이 `PRJ-00170 x`와 `PRJ-0017 세컨드브레인`인 노드 둘 중 뒤엣것을 고른다. 변수 `prjKey`는 `"PRJ-0017"`이다.
  - `flattens issues, labels, updates and comments`: 댓글은 모든 이슈의 것을 모아 `createdAt` 내림차순으로 정렬한다. `issueIdentifier`가 채워진다.
  - `maps 401 and AUTHENTICATION_ERROR to unauthorized`: HTTP 401과, 200 응답에 `errors[0].extensions.code === "AUTHENTICATION_ERROR"`인 경우 둘 다
  - `maps 429 and RATELIMITED to rate-limited`
  - `maps abort and non-JSON to network-error`
  - `returns no-project when no name matches`
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `npx vitest run src/main/linear/linear-client.test.ts --pool=threads`
  - Expected: FAIL
- [ ] **Step 3: 구현**
  - 질의는 하나다.
    ```graphql
    query($prjKey: String!) {
      projects(filter: { name: { startsWith: $prjKey } }, first: 5) {
        nodes {
          name
          url
          projectUpdates(first: 2) { nodes { health body createdAt } }
          issues(first: 50, filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
            nodes {
              identifier title dueDate priority
              state { name type }
              labels { nodes { name } }
              comments(first: 3) { nodes { body createdAt } }
            }
          }
        }
      }
    }
    ```
  - 정확한 키 판정은 `/^PRJ-\d{4}(\s|$)/`에 맞고 그 앞 8글자가 `prjKey`와 같은 것이다.
  - 타임아웃·응답 원문은 결과에 담지 않는다(키가 섞일 여지를 없앤다).
- [ ] **Step 4: 통과 확인** — 같은 명령. Expected: PASS
- [ ] **Step 5: Commit** — `feat: Linear GraphQL client for project context`

### Task 3: 브리프 절 렌더러 (순수 함수)

**Files:**
- Create: `src/main/linear/linear-brief.ts`
- Test: `src/main/linear/linear-brief.test.ts`

**Interfaces:**
- Consumes: Task 2의 `LinearProjectContext`
- Produces:
  - `export const LINEAR_RECORD_MARKER = "<!-- mcw:linear-record -->"`
  - `renderLinearBrief(input: { prjKey: string; repoName: string | null; context: LinearProjectContext; fetchedAt: Date; recordReminder: boolean }): string`

- [ ] **Step 1: 실패하는 테스트 작성** — 기대 출력의 모양은 스펙 §4.4 예시를 따른다.
  - `renders header, health, issues, recent records and the CLI instruction`
    - 첫 줄: `## Linear 맥락 (PRJ-0017 세컨드브레인 · 조회 MM-DD HH:mm)`
    - 업데이트 줄: `- 프로젝트 상태: 정상 — "<본문 첫 줄>" (MM-DD)`. health 매핑은 onTrack→정상, atRisk→위험, offTrack→이탈, null→상태 없음.
    - 이슈 줄: `  - SB-41 [진행 중] 제목 · repo:multi-cli-work · 기한 11-30`. 기한·라벨이 없으면 그 조각을 뺀다. 라벨은 `repo:`로 시작하는 것만 보인다.
    - 댓글 줄: `  - MM-DD SB-35 "<본문 첫 줄 60자>"`
    - 지시 두 줄이 들어 있다. 스펙 §4.4의 마지막 3줄과 같되, 첫 줄의 CLI 예시는 `` `linear --help`로 명령을 확인하고 `linear issue view <키>` 등으로 더 읽는다 ``로 바꾼다.
  - `orders issues by repo label, then priority (0 last), then due date (null last)`
  - `caps issues, titles and total lines`: 이슈 12개에 120자 한글 제목을 넣으면 이슈 8개·제목 80자(말줄임표 포함)·전체 30줄 이하가 된다.
  - `appends the record marker only when recordReminder is true`
  - `writes 열린 이슈 없음 when there are no open issues`
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `npx vitest run src/main/linear/linear-brief.test.ts --pool=threads`
  - Expected: FAIL
- [ ] **Step 3: 구현** — 시각은 로컬 시간대로 `MM-DD HH:mm`이다. 30줄을 넘으면 댓글부터 줄이고, 그다음 이슈를 줄인다.
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: Commit** — `feat: render the Linear context section of a session brief`

### Task 4: LinearService (키·상태·상한·캐시) + IPC

**Files:**
- Create: `src/main/linear/linear-service.ts`
- Test: `src/main/linear/linear-service.test.ts`
- Modify:
  - `src/main/ipc.ts` (`notion:*` 옆에 `linear:status`·`linear:set-key`·`linear:clear-key`, 입력 검증은 `notion:set-token`과 같다)
  - `src/main/ipc-gateways.ts` (`LinearGateway`)
  - `src/shared/api-types.ts` (`linear: { status(); setKey(key); clearKey() }`)
  - `src/preload/index.ts`
  - `src/main/runtime.ts` (`createLinearService(createLinearKeyStore(path.join(userData, "linear-credentials.json"), safeStorage))`, ipc 의존성에 `linear`)
- Test: `src/main/ipc.test.ts`에 linear 채널 3개 등록·검증 케이스를 추가

**Interfaces:**
- Consumes: Task 1 `LinearKeyStore`, Task 2 `verifyLinearKey`·`fetchLinearProjectContext`·`linearFailureMessage`, Task 3 `renderLinearBrief`
- Produces:
  ```ts
  export interface LinearServiceOptions extends LinearClientOptions { deadlineMs?: number; cacheTtlMs?: number; now?: () => number }
  export interface LinearService {
    status(): Promise<LinearKeyStatus>;
    setKey(key: string): Promise<LinearKeyStatus>;   // verify → write → 캐시·lastError 비움
    clearKey(): Promise<LinearKeyStatus>;            // 캐시·lastError 비움
    briefSection(input: { prjKey: string; repoName: string | null; recordReminder: boolean }): Promise<string | null>;
  }
  export function createLinearService(store: LinearKeyStore, options?: LinearServiceOptions): LinearService
  ```
  - 기본값은 `deadlineMs = 3000`, `cacheTtlMs = 300000`이다.
  - 캐시에는 렌더한 문자열이 아니라 `LinearProjectContext`를 `prjKey`별로 둔다. 레포마다 정렬이 다르기 때문이다.

- [ ] **Step 1: 실패하는 테스트 작성** — fetch는 모의 함수, `now`는 주입한다.
  - `returns null without a key and never calls fetch`
  - `returns the rendered section and caches it for five minutes`: 같은 키를 두 번 부르면 fetch는 1회다. `now`를 300001ms 앞으로 옮기면 2회가 된다.
  - `briefSection returns null after the deadline`: fetch가 끝나지 않는 Promise를 돌려주고, `deadlineMs: 50`이면 50ms 근처에서 `null`이 된다.
  - `records and clears lastError`: 401 → `status().lastError === "Linear API 키가 거부됐습니다"`. 다음 성공 → `null`.
  - `setKey verifies before writing`: 검증이 실패하면 `store.write`를 부르지 않고 던진다.
  - `setKey and clearKey drop the cache`
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `npx vitest run src/main/linear/linear-service.test.ts --pool=threads`
  - Expected: FAIL
- [ ] **Step 3: 구현** — 상한은 `repo-sync-brief.ts`의 `Promise.race` + `setTimeout` 패턴을 따르고 `finally`에서 `clearTimeout`한다. 예외는 모두 `null`로 끝낸다. IPC·preload·gateway는 노션의 것을 그대로 본뜬다.
- [ ] **Step 4: 통과 확인**
  - Run: `npx vitest run src/main/linear/linear-service.test.ts src/main/ipc.test.ts --pool=threads`
  - Expected: PASS
- [ ] **Step 5: Commit** — `feat: Linear service with a 3-second brief deadline and IPC`

### Task 5: 폴더 → PRJ-key 매핑 + 브리프 배선 + 설정 플래그

**Files:**
- Create: `src/main/linear/prj-key-for-folder.ts`
- Test: `src/main/linear/prj-key-for-folder.test.ts`
- Modify:
  - `src/shared/settings-types.ts`: `GeneralSettings`에 `linearBrief: boolean; linearRecordReminder: boolean`을 넣는다. 기본값은 둘 다 `true`, `readBoolean`으로 읽는다.
  - `src/shared/settings-types.test.ts`: 기본값과 타입 불일치 복원
  - `src/main/runtime.ts`의 `getWorkProjectBrief`(416행 부근)
  - `README.md`의 외부 통신 문단: "Linear API 키를 넣었을 때 세션 시작 브리프용 이슈 조회(`api.linear.app`, 프로젝트별 5분 캐시)"
  - `docs/local-data.md`: `linear-credentials.json`, `session-linear/`
  - 스펙 `docs/superpowers/specs/2026-11-23-session-linear-context-design.md` §4.2: 수동 매핑 칸을 빼고 "레포를 PRJ에 잇는 방법은 `/ws-link-repo`(PROJECT.yaml `repos:`)"로 고친다. 프로젝트 찾기는 이름 접두사만 쓰고 설명 줄 매칭은 하지 않는다(이 계획의 결정).

**Interfaces:**
- Consumes:
  - `WorkspaceIndex.snapshot(registry: WorkspaceRegistryV1)` (`src/main/projects/workspace-index.ts:432`)
  - `resolveWorkspaceRoots(workRoot)` (`workspace-index.ts:127`)
  - `resolveShellRefForPath(path, { roots, repoOwners }, style)`·`parseProjectKey` (`src/shared/workspace-path.ts`)
  - `pcRoots.info().effective.work`
  - Task 4 `LinearService.briefSection`
- Produces:
  - `prjKeyForFolder(folderPath: string, snapshot: WorkspaceSnapshot, style: WorkspacePathStyle): string | null`
    - `"PRJ-0017"`처럼 **키 앞 8글자**를 돌려준다.
    - 보관(`archived`) 프로젝트이거나 매칭이 없으면 `null`.
  - `linearLookupRegistry(workRoot: string): Promise<WorkspaceRegistryV1>`
    - 루트 하나짜리 합성 레지스트리다(`label: "work"`). 파일에 쓰지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성** — `prj-key-for-folder.test.ts`. `WorkspaceSnapshot`은 직접 만든다.
  - `maps a repo path to its PRJ key`
  - `maps a nested path through its ancestor repo`
  - `returns null for archived projects and unmapped folders`
  - `uses win32 path keys case-insensitively`
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `npx vitest run src/main/linear/prj-key-for-folder.test.ts src/shared/settings-types.test.ts --pool=threads`
  - Expected: FAIL
- [ ] **Step 3: 구현**
  - `prj-key-for-folder.ts`와 설정 필드를 만든다.
  - `getWorkProjectBrief`에 Linear 절을 넣는다. `repoSyncSection`처럼 **먼저 시작해 두고** 끝에서 기다린다.
  - 다음 조건을 모두 만족할 때만 부른다.
    - `launch.agentId`가 `claude` 또는 `codex`
    - `settings.general.linearBrief`가 켜짐
    - 프로젝트가 있음
    - `pcRoots.info().effective.work`가 있음
  - 절은 `prjKeyForFolder(project.rootPath, await workspaceIndex.snapshot(await linearLookupRegistry(work)), process.platform)`로 키를 구한 뒤 `linear.briefSection({ prjKey, repoName: path.basename(project.rootPath), recordReminder: settings.general.linearRecordReminder })`로 만든다.
  - 예외는 `null`로 끝낸다.
  - `writeSessionBrief`의 섹션 순서는 `[workProjectSection, linearSection, repoSyncSection, workspaceSection]`이다.
- [ ] **Step 4: 통과 확인** — 같은 명령에 `npm run typecheck`를 더한다. Expected: PASS
- [ ] **Step 5: Commit** — `feat: put the folder's Linear context into the session brief`

### Task 6: Stop 훅의 커밋 후 기록 리마인드 (PS1·Python)

**Files:**
- Modify:
  - `src/main/providers/claude-integration.ts` (`CLAUDE_STATUS_HOOK`·`CLAUDE_STATUS_HOOK_PYTHON`)
  - `src/main/runtime.ts`의 `sessionEnvironment`(380행 부근): `MULTI_CLI_WORK_LINEAR_STATE_DIR: path.join(userData, "session-linear")`
- Test: `src/main/providers/claude-integration.test.ts` (기존 훅 실행 하네스를 쓴다)

**Interfaces:**
- Consumes: Task 3 `LINEAR_RECORD_MARKER`(브리프 파일에 있는지로 판정), `MULTI_CLI_WORK_PROJECT_BRIEF`, `MULTI_CLI_WORK_LINEAR_STATE_DIR`
- Produces:
  - `export const LINEAR_RECORD_REMINDER = "방금 새 커밋이 생겼다. …"` (Global Constraints의 정확한 문구)
  - 상태 파일 `<stateDir>/<sessionId>.head`(sha 한 줄)

- [ ] **Step 1: 실패하는 테스트 작성** — 임시 폴더에 `git init`, 커밋 1개를 만든다. 브리프 파일에 마커를 넣는다. 훅은 기존 테스트처럼 `execFileAsync`로 돌린다(타임아웃 20s).
  - `records HEAD at SessionStart and stays silent at Stop with the same HEAD`: SessionStart 뒤 `.head` 파일이 HEAD와 같다. Stop에서는 stdout이 비어 있다.
  - `blocks once after a new commit`: 커밋을 하나 더 하고 Stop을 보내면 stdout JSON이 `{ decision: "block", reason: LINEAR_RECORD_REMINDER }`다. 한글이 그대로 복원된다. 같은 HEAD로 Stop을 다시 보내면 stdout이 빈다.
  - `respects stop_hook_active`: 입력에 `stop_hook_active: true`가 있으면 stdout이 빈다.
  - `ignores sessions whose brief has no marker`
  - `stays silent outside a git repository`: cwd가 git이 아닌 폴더면 stdout이 비고 종료 코드는 0이다.
  - PS1 파일에 `[^\x00-\x7F]` 문자가 없다(`expect(CLAUDE_STATUS_HOOK).not.toMatch(/[^\x00-\x7F]/)`).
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `npx vitest run src/main/providers/claude-integration.test.ts --pool=threads`
  - Expected: FAIL
- [ ] **Step 3: 구현**
  - 두 스크립트에 같은 규칙을 넣는다.
    1. SessionStart: 브리프에 마커가 있으면 `git -C <cwd> rev-parse HEAD`를 `.head`에 쓴다.
    2. Stop: 아래 조건을 모두 만족하면 `.head`를 갱신하고 `{"decision":"block","reason":…}`를 출력한다.
       - `stop_hook_active`가 거짓
       - 마커가 있다
       - HEAD를 읽을 수 있다
       - `.head`가 있고 값이 HEAD와 다르다
    3. `.head`가 없으면 HEAD만 기록하고 아무것도 출력하지 않는다.
  - PS1
    - 문구는 TS에서 `\uXXXX`로 바꾼 ASCII 문자열로 끼운다. 스크립트 안에서는 `[regex]::Unescape('…')`로 복원한다.
    - 출력은 기존 SessionStart처럼 ConvertTo-Json 뒤 비ASCII를 이스케이프한다.
    - git 실패는 `$LASTEXITCODE`로 걸러낸다.
  - Python: `subprocess.run([...], capture_output=True, timeout=3)`. 문구는 `json.dumps`로 넣는다.
- [ ] **Step 4: 통과 확인** — 같은 명령. Expected: PASS(Windows는 PS1 경로, CI Linux는 Python 경로)
- [ ] **Step 5: Commit** — `feat: remind Claude sessions to record in Linear after a new commit`

### Task 7: 설정 화면의 Linear 탭

**Files:**
- Modify:
  - `src/renderer/src/SettingsDialog.tsx`: 탭 목록에 `{ id: "linear", label: "Linear" }`를 넣는다. `LinearSettings` 컴포넌트는 `NotionSettings`(105행 부근)를 본뜬다.
  - `src/renderer/src/SettingsSearch.tsx`: `{ tab: "linear", title: "Linear 연결", keywords: "linear 리니어 API 키 이슈 브리프 기록", target: "settings-linear-key", phase: "저장 후 적용" }`
- Test: `src/renderer/src/SettingsDialog.test.tsx`

**Interfaces:**
- Consumes: Task 4 `window.multiCliWork.linear.{status,setKey,clearKey}`, Task 5 `general.linearBrief`·`general.linearRecordReminder`(기존 general 토글과 같은 저장 경로)

- [ ] **Step 1: 실패하는 테스트 작성**
  - `saves a Linear key and shows 설정됨`: 입력 `#settings-linear-key`에 키를 넣고 "저장"을 누르면 `setKey`가 호출되고 상태 문구가 바뀐다.
  - `shows lastError from status`: `status()`가 `lastError: "Linear API 키가 거부됐습니다"`를 주면 그 문구가 보인다.
  - `toggles linearBrief and linearRecordReminder`: 두 체크박스가 설정 저장을 부른다. 키가 없으면 둘 다 `disabled`다.
- [ ] **Step 2: 실행해서 실패 확인**
  - Run: `npx vitest run src/renderer/src/SettingsDialog.test.tsx --pool=threads`
  - Expected: FAIL
- [ ] **Step 3: 구현**
  - 안내 문구: "Linear 설정 › Security & access › Personal API keys에서 발급한다. 키는 이 PC의 OS 자격 증명으로 암호화해 저장하고, 세션에는 넘기지 않는다."
  - 두 체크박스 이름: "브리프에 Linear 맥락 싣기", "커밋 후 기록 리마인드(Claude)"
- [ ] **Step 4: 통과 확인** — 같은 명령. Expected: PASS
- [ ] **Step 5: Commit** — `feat: Linear key and brief toggles in settings`

### Task 8: 전체 검증과 실기 확인

**Files:** 없음(검증만). 결과를 보고한다.

- [ ] **Step 1: 전체 테스트와 타입 검사**
  - Run: `npx vitest run --pool=threads --maxWorkers=2`, 이어서 `npm run typecheck`
  - Expected: 실패 0
- [ ] **Step 2: 빌드**
  - Run: `npm run build`
  - Expected: 성공
- [ ] **Step 3: 실기 확인(Linear 키가 있을 때)**
  - 탐색용 Playwright 하네스(메모리 `exploratory-playwright-harness`)로 격리 인스턴스를 띄운다.
  - 확인할 것:
    1. 설정에 키를 넣으면 "설정됨"이 된다.
    2. multi-cli-work 폴더에서 claude 세션을 연다 → 첫 컨텍스트에 `## Linear 맥락 (PRJ-0017` 절이 있다.
    3. codex 세션에서도 같은 절이 실린다.
    4. 커밋을 만들고 턴을 끝낸다 → 리마인드가 1회 들어온다.
    5. 키를 지우거나 네트워크를 끊고 세션을 연다 → 3.5초 안에 뜨고 절이 없다.
  - 사용자 키가 아직 없으면 이 단계는 건너뛰었다고 보고한다.
- [ ] **Step 4: 보고** — 통과·건너뜀을 그대로 적는다. 배포는 "배포 ㄱ" 때만 한다.
