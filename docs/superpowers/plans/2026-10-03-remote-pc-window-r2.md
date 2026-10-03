# 원격 PC 이어받기 R2 (세션 관리) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원격 창과 폰에서 호스트 PC의 세션을 새로 띄우고, 중지하고, 끝난 세션을 다시 시작하고, 삭제할 수 있게 한다.

**Architecture:** 기존 WS 프로토콜에 메시지를 추가만 한다(`REMOTE_PROTOCOL_VERSION`은 1 그대로 — 이 메시지를 쓰는 웹 UI와 hub는 같은 빌드에서 나온다). hub가 `TerminalCoordinator`의 `create`·`resume`·`stop`·`remove`를 호스트 화면의 선택을 건드리지 않는 방식으로 부르고, 코디네이터는 삭제를 새 `removed` 이벤트로 알린다. 화면은 호스트가 서빙하는 웹 UI(`src/renderer/src/mobile/`)에 넣어 원격 창과 폰이 같이 얻는다.

**Tech Stack:** Electron 43 · TypeScript 5.7 · React 18 · xterm.js 6 · `ws` · vitest 3 · Playwright 1.61

**Spec:** `docs/superpowers/specs/2026-10-03-remote-pc-window-design.md` §5와 §9의 R2. 선행: R1 계획 `2026-10-03-remote-pc-window-r1.md`.

> **이 문서의 형식에 대해.** 사용자는 2026-10-03에 "계획 문서 검토를 위해 다시 멈추지 않고 바로 구현"을 승인했고, 실행자는 이 문서를 쓴 세션 자신이다. 그래서 R1 계획과 달리 코드 전문을 싣지 않고, 태스크마다 **인터페이스·동작 규칙·테스트 사양**을 정확히 적는다. 코드는 실행 중에 테스트 먼저 쓴다.

## Global Constraints

- 프로토콜은 **추가만** 한다. 기존 메시지의 모양과 `REMOTE_PROTOCOL_VERSION = 1`은 바꾸지 않는다. 모르는 클라이언트 메시지는 지금처럼 `error{code: "bad-message"}`로 답하고 연결을 끊지 않는다.
- 원격에서 만들거나 재시작한 세션은 호스트 데스크톱의 선택·그리드를 바꾸지 않는다(`{ updateSelection: false }`).
- 새 세션의 크기는 호스트가 정한다: `DEFAULT_TERMINAL_SIZE`(80×24). 재시작은 그 세션의 마지막 크기, 없으면 기본값. 만든 기기는 크기 소유자가 되지 않는다.
- 진행 중인 PR 리뷰 세션은 원격에서도 지울 수 없다 — IPC와 같은 검사, 같은 문구.
- `window.confirm`을 쓰지 않는다(Android WebView가 조용히 거절한다). 삭제 확인은 화면 안의 두 단계다.
- 좁은 화면(폰)의 기존 동작과 `e2e/mobile.spec.ts`는 바꾸지 않는다. 세션 관리 버튼은 좁은 화면에도 **추가**된다.
- 기존 관례: main 테스트 첫 줄 `// @vitest-environment node`, 사용자 문구 한국어, vitest는 `npx vitest run --pool=threads <파일>`(전체는 `--maxWorkers=2`), git·npm은 PowerShell, 브랜치는 main 단일, push·릴리스 없음.
- 모든 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Spec 대비 R2 결정 (Task 6에서 spec에 반영)

- `create`·`resume` 메시지에 `cols`·`rows`를 넣지 않는다 — 만드는 시점에는 클라이언트에 터미널이 없어 잴 수 없다. 크기는 호스트가 정하고 소유자는 호스트로 둔다(위 Global Constraints).
- 중지·재시작·삭제는 목록 행이 아니라 세션 화면의 머리줄에 둔다. 폰의 목록 행에는 버튼 셋을 더 넣을 자리가 없다.
- 호스트가 보낸 `error`를 화면 아래 알림으로 보인다(지금은 버려진다).

## Review Focus

1. **원격에서 지운 세션이 호스트 화면에 떠 있는 경우** — 호스트의 목록·패인에서 사라지고, 그 세션이 선택돼 있었어도 화면이 죽지 않아야 한다. → Task 2 `App.test.tsx` "drops a session removed elsewhere"
2. **재시작한 세션을 보고 있던 화면** — 새 프로세스의 출력이 이전 출력의 sequence에 밀려 버려지면 안 된다. → Task 5 `SessionScreen.test.tsx` "attaches again when its session is restarted"
3. **돌고 있는 세션에 재시작, 끝난 세션에 중지를 보낸 경우**(두 기기가 같은 세션을 보고 있을 때 생긴다) — 프로세스를 둘 띄우거나 조용히 무시하지 말고 이유를 알려야 한다. → Task 4 hub "refuses to restart a running session / stop a finished one"
4. **새 세션을 만든 폰** — "폰 크기로"가 켜진 것처럼 보이면서 80열로 그려지는 어중간한 상태가 되면 안 된다. → Task 4 hub "a created session is sized by the host and owned by the desktop"
5. **등록된 폴더가 없거나 쓸 수 있는 에이전트가 없는 호스트** — 새 세션 폼이 빈 선택지로 "시작"을 누르게 두면 안 된다. → Task 5 `NewSessionForm.test.tsx` "cannot start without a folder and an agent"

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/main/remote-client/remote-windows.ts` · `pair-host.ts` · 테스트 (수정) | R1에서 미룬 것 |
| `src/shared/agent-types.ts` (수정) | `AGENT_ID_PATTERN`을 여기서 내보낸다(`ipc.ts`·`app-state.ts`의 사본 대체) |
| `src/shared/terminal-types.ts` (수정) | `removed` 이벤트, `DEFAULT_TERMINAL_SIZE` |
| `src/shared/remote-types.ts` (수정) | 새 메시지·파서·`RemoteCatalog` |
| `src/main/terminal/terminal-coordinator.ts` (수정) | `remove()`가 `removed` 발행 |
| `src/main/terminal/review-guard.ts` (신규) | PR 리뷰 세션 삭제 금지 검사 |
| `src/main/remote/remote-catalog.ts` (신규) | 폴더·에이전트 → 카탈로그 |
| `src/main/remote/size-arbiter.ts` (수정) | 호스트가 정한 크기 기록 |
| `src/main/remote/remote-session-hub.ts` (수정) | 다섯 메시지 처리, `removed` 방송 |
| `src/main/runtime.ts` · `src/main/ipc.ts` (수정) | gateway 배선, 검사 공유, attention 정리 |
| `src/renderer/src/App.tsx` (수정) | `removed` 반영, `DEFAULT_TERMINAL_SIZE` import |
| `src/renderer/src/mobile/session-list-model.ts` · `MobileApp.tsx` · `SessionList.tsx` · `SessionScreen.tsx` · `mobile.css` (수정), `NewSessionForm.tsx` (신규) | 화면 |
| `e2e/remote-window.spec.ts` (수정) | 새 세션→중지→재시작→삭제 |

---

### Task 0: R1에서 미뤄 둔 것

**Files:** `src/main/remote-client/remote-windows.ts` + test, `src/main/remote-client/pair-host.ts` + test, `docs/local-data.md`, `docs/installation.md`

- [ ] 테스트 먼저:
  - `remote-windows.test.ts` "opens a locked-down window…"에 `expect(options.useContentSize).toBe(true)` 추가.
  - `pair-host.test.ts`의 거부 표를 바꾼다: `"100.64.0.9"` → "포트가 빠졌습니다", `"100.64.0.999:47821"` → "0~255", 나머지는 그대로.
- [ ] 구현:
  - `createWindow({ …, useContentSize: true })` — `minWidth: 900`이 콘텐츠 폭 기준이 되어 최소 크기에서도 넓은 화면이 유지된다.
  - `normalizeAddress`: 포트 없는 IPv4(`^\d{1,3}(\.\d{1,3}){3}$`)는 "포트가 빠졌습니다. 100.x.y.z:포트 형식으로 입력하세요", 옥텟 > 255는 "IP 주소의 각 숫자는 0~255여야 합니다". 검사 순서: 형식 → 옥텟 → Tailscale 대역 → 포트 범위.
- [ ] 문서: `docs/local-data.md`의 `userData` 표에 `remote-hosts.json`("이 PC가 접속하려고 등록한 다른 PC. 기기 토큰은 safeStorage 암호문")과 `remote-devices.json`("이 PC에 접속을 허용한 기기. 토큰의 해시만"). `docs/installation.md` "다른 PC에서 이어받기"에 "호스트가 v1.35.x면 폰 화면으로 보이고 창 크기 맞춤·복사 키·페어링 링크 복사가 없다 — 호스트도 업데이트한다" 한 문단.
- [ ] `npx vitest run --pool=threads src/main/remote-client` PASS → 커밋 `fix: keep the wide layout at the minimum window size and say what is wrong with an address`

### Task 1: 프로토콜 타입과 파서

**Files:** `src/shared/agent-types.ts`, `src/shared/terminal-types.ts`, `src/shared/remote-types.ts` + `remote-types.test.ts`, `src/main/ipc.ts`, `src/main/state/app-state.ts`, `src/renderer/src/App.tsx`

**Interfaces — Produces:**

```ts
// agent-types.ts
export const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

// terminal-types.ts
export const DEFAULT_TERMINAL_SIZE = { cols: 80, rows: 24 } as const;
export type TerminalEvent = … | { type: "removed"; sessionId: string };

// remote-types.ts
export interface RemoteCatalog {
  projects: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; label: string }>;
}
export type RemoteClientMessage = …
  | { type: "catalog" }
  | { type: "create"; projectId: string; kind: string }
  | { type: "stop"; sessionId: string }
  | { type: "resume"; sessionId: string }
  | { type: "remove"; sessionId: string };
export type RemoteServerMessage = …
  | ({ type: "catalog" } & RemoteCatalog)
  | { type: "started"; sessionId: string }
  | { type: "removed"; sessionId: string };
```

- [ ] 테스트 먼저 — `remote-types.test.ts`: 새 다섯 메시지가 그대로 파싱된다 / `create`는 `projectId` 없음·`kind`가 패턴 밖(`"Claude"`, `"../x"`, 33자)이면 null / `stop`·`resume`·`remove`는 빈 `sessionId`면 null / 여분 필드는 버린다.
- [ ] 구현. `ipc.ts:329`와 `app-state.ts:19`의 지역 `AGENT_ID_PATTERN`을 import로 바꾼다. `App.tsx:171`의 `DEFAULT_TERMINAL_SIZE`를 지우고 shared에서 import한다.
- [ ] `npx vitest run --pool=threads src/shared src/main/ipc.test.ts src/main/state` + `npm run typecheck` → 커밋 `feat: add session management messages to the remote protocol`

### Task 2: "삭제됨" 이벤트

**Files:** `src/main/terminal/terminal-coordinator.ts` + test, `src/renderer/src/App.tsx` + `App.test.tsx`, `src/main/runtime.ts`

- [ ] 테스트 먼저:
  - `terminal-coordinator.test.ts`: 세션을 만들고 `remove(id)` → 구독자가 `{ type: "removed", sessionId: id }`를 **마지막** 이벤트로 받는다. 모르는 id의 `remove`는 아무것도 발행하지 않는다.
  - `App.test.tsx` "drops a session removed elsewhere": 세션 둘이 있고 하나가 선택된 상태에서 하네스의 `terminals.onEvent` 리스너로 `{ type: "removed", sessionId }`를 보낸다 → 그 세션의 패인·사이드바 항목이 사라지고 다른 세션은 남으며 오류 문구가 없다.
- [ ] 구현:
  - `remove()` 맨 끝(`this.pendingReleases.delete` 뒤)에 `this.publish({ type: "removed", sessionId })`.
  - `App.tsx` 이벤트 구독의 `created` 분기 앞에: 목록에서 빼고, `setFocusedPaneId`·`setSelectedSessionId`를 그 id였을 때만 null로. 주석: 자기가 지운 경우(`removeSessionById`)도 같은 이벤트를 받지만 그쪽이 뒤이어 다음 선택을 정한다.
  - `runtime.ts` `coordinator.onEvent`: `if (event.type === "exit" || event.type === "removed") attention.clear(event.sessionId);`
- [ ] `npx vitest run --pool=threads src/main/terminal/terminal-coordinator.test.ts src/renderer/src/App.test.tsx` + typecheck → 커밋 `feat: announce removed sessions to every listener`

### Task 3: 카탈로그와 리뷰 보호

**Files:** `src/main/remote/remote-catalog.ts` + test (신규), `src/main/terminal/review-guard.ts` + test (신규), `src/main/ipc.ts`

**Interfaces — Produces:**

```ts
// remote-catalog.ts
export function buildRemoteCatalog(
  projects: Array<Pick<SharedProject, "id" | "displayName" | "rootPath" | "hidden" | "order">>,
  agents: Array<Pick<AgentView, "id" | "label" | "available">>,
): RemoteCatalog;

// review-guard.ts
export const REVIEW_SESSION_MESSAGE = "진행 중인 PR 리뷰 세션은 '리뷰 완료' 흐름에서 정리하세요.";
export function assertNotReviewSession(reviews: ReadonlyArray<{ sessionId: string | null }>, sessionId: string): void;
```

- [ ] 테스트 먼저:
  - 카탈로그: 숨긴 폴더 제외 / `order` 오름차순(null은 뒤), 같으면 이름 가나다순 / `displayName`이 null이면 `rootPath`의 마지막 조각(`C:\dev\app`·`/home/u/app` 둘 다 `app`) / `available: false` 에이전트 제외.
  - 보호: 리뷰 목록에 그 세션이 있으면 `REVIEW_SESSION_MESSAGE`로 throw, 없으면 통과.
- [ ] 구현. `ipc.ts`의 `terminals:remove`가 `assertNotReviewSession(await dependencies.github.activeReviews(), id)`를 쓰게 바꾼다(기존 ipc 테스트의 문구 단언은 그대로 통과해야 한다).
- [ ] `npx vitest run --pool=threads src/main/remote/remote-catalog.test.ts src/main/terminal/review-guard.test.ts src/main/ipc.test.ts` → 커밋 `feat: build the remote catalog and share the review-session guard`

### Task 4: hub와 배선

**Files:** `src/main/remote/size-arbiter.ts` + test, `src/main/remote/remote-session-hub.ts` + test, `src/main/runtime.ts`

**Interfaces:**

```ts
// size-arbiter.ts — 호스트가 정한 크기로 막 시작한 세션. 소유자는 데스크톱이고, 기기가 가져갔다 돌려주면 이 크기로 돌아온다.
hostStarted(sessionId: string, cols: number, rows: number): void;

// remote-session-hub.ts — RemoteHubGateway에 추가
catalog(): Promise<RemoteCatalog>;
create(input: { projectId: string; kind: string; cols: number; rows: number }): Promise<TerminalSessionView>;
resume(input: { sessionId: string; cols: number; rows: number }): Promise<TerminalSessionView>;
stop(sessionId: string): Promise<void>;
remove(sessionId: string): Promise<void>;
```

**동작 규칙 (hub `handle`):**

| 메시지 | 처리 |
|---|---|
| `catalog` | `send({ type: "catalog", ...(await gateway.catalog()) })` |
| `create` | `gateway.create({ projectId, kind, ...DEFAULT_TERMINAL_SIZE })` → `sizes.hostStarted(id, 80, 24)` → 요청한 연결에 `started{sessionId}` |
| `stop` | 세션이 없으면 "세션을 찾을 수 없습니다", 이미 끝났으면(`pid === null` 또는 `exited`·`error`) "이미 끝난 세션입니다"로 throw. 아니면 `gateway.stop` |
| `resume` | 세션이 없으면 위와 같은 문구, 돌고 있으면 "이미 실행 중인 세션입니다"로 throw. 크기는 `sizes.current(id)`의 값, 없으면 기본값. `gateway.resume` 뒤 크기 기록이 없었을 때만 `sizes.hostStarted`. 요청한 연결에 `started{sessionId}` |
| `remove` | `gateway.remove(sessionId)` |

throw는 기존 `receive`의 catch가 `error{code: "failed", message}`로 바꿔 보낸다. `forward`: `removed` → 모든 연결의 `attached`에서 그 세션을 빼고 `removed{sessionId}` 방송.

- [ ] 테스트 먼저:
  - arbiter: `hostStarted` 뒤 `current()`가 그 크기·`owner: "desktop"`, apply(실제 resize)는 부르지 않음 / 그 뒤 기기가 resize했다가 release하면 `hostStarted`의 크기로 되돌아감.
  - hub: "answers a catalog request" / "starts a session without touching the host's selection … sized by the host and owned by the desktop"(gateway.create 인자가 80×24, 이어지는 attach의 `attached`가 `cols: 80, rows: 24, sizeOwner: "desktop"`) / "tells only the requester which session started"(두 번째 연결은 `started`를 받지 않음) / "refuses to restart a running session and to stop a finished one"(gateway를 부르지 않고 `error`) / "restarts a finished session at its last size" / "says why a session could not be removed"(gateway.remove가 `REVIEW_SESSION_MESSAGE`로 reject → 그 문구의 `error`) / "broadcasts a removed session and forgets it"(`removed` 방송, 이후 그 세션의 `data`는 가지 않음).
- [ ] 구현. `runtime.ts:496` gateway:
  - `catalog`: `buildRemoteCatalog(Object.values((await readProjectRegistry({ registryPath })).registry.projects), (await listAgents()).agents)`
  - `create`·`resume`: `coordinator.create/resume(input, { updateSelection: false })`
  - `stop`: `coordinator.stop`
  - `remove`: `assertNotReviewSession(await github.activeReviews(), id)` 뒤 `coordinator.remove(id)`
- [ ] `npx vitest run --pool=threads src/main/remote` + typecheck → 커밋 `feat: create, stop, restart and remove sessions over the remote protocol`

### Task 5: 웹 UI

**Files:** `src/renderer/src/mobile/session-list-model.ts` + test, `NewSessionForm.tsx` + test (신규), `SessionList.tsx` + test, `MobileApp.tsx` + test, `SessionScreen.tsx` + test, `mobile.css`

**Interfaces:**

```tsx
// NewSessionForm.tsx
export function NewSessionForm(props: {
  catalog: RemoteCatalog | null;          // null이면 "불러오는 중…"
  onStart(projectId: string, kind: string): void;
  onCancel(): void;
}): JSX.Element;

// SessionList.tsx — 추가 props
onNewSession(): void;                      // 머리줄의 "새 세션" 버튼
children?: ReactNode;                      // 머리줄 아래에 그리는 폼
```

**동작 규칙:**

- `applySessionMessage`: `removed` → 그 세션을 뺀다.
- `MobileApp`: "새 세션"을 누르면 `client.send({ type: "catalog" })`하고 폼을 연다. `catalog` 메시지 → 폼에 전달. 폼의 시작 → `create` 전송, 폼 닫기. `started` → 그 세션을 연다. `error`(코드 `failed`·`not-attached`·`bad-message`) → 화면 아래 알림(`role="alert"`, "닫기" 버튼). 열려 있던 세션이 `removed`로 사라지면 목록으로 돌아간다(기존 `openSession` 계산이 null이 된다).
- `NewSessionForm`: 폴더·에이전트 `<select>`(`aria-label` "폴더"·"에이전트")와 "시작"·"취소". 폴더가 없으면 "호스트에 등록된 폴더가 없습니다", 에이전트가 없으면 "호스트에서 실행할 수 있는 에이전트가 없습니다"를 보이고 "시작"은 비활성.
- `SessionScreen` 머리줄: 상태가 `exited`·`error`면 "재시작"(→ `resume`), 아니면 "중지"(→ `stop`). "삭제"를 누르면 "정말 삭제"·"취소"로 바뀌고, "정말 삭제"가 `remove`를 보낸다. 이 화면의 세션에 대한 `started`를 받으면 `gate.reset()` 뒤 다시 `attach`한다 — 새 프로세스의 sequence는 처음부터 다시 센다.
- CSS: 머리줄의 버튼은 넓은 화면에서 줄바꿈하지 않는다(터미널 영역의 높이가 바뀌면 자동 맞춤이 다시 돈다 — R1의 교훈). 삭제 확인 전후로 머리줄 높이가 같아야 한다.

- [ ] 테스트 먼저:
  - `session-list-model.test.ts`: "drops a removed session".
  - `NewSessionForm.test.tsx`: "starts a session in the chosen folder with the chosen agent" / "cannot start without a folder and an agent"(빈 카탈로그 두 경우) / "waits for the catalog"(null).
  - `MobileApp.test.tsx`(R1의 가짜 소켓): "asks for the catalog and starts a session"(보낸 메시지에 `catalog`, 폼 제출 뒤 `create`) / "opens the session the host says was started" / "shows what the host refused and lets it be dismissed" / "goes back to the list when the open session is removed".
  - `SessionScreen.test.tsx`(R1의 가짜 xterm): "offers stop for a running session and restart for a finished one" / "asks twice before removing"("삭제"만으로는 `remove`가 안 감, "취소"로 되돌아감) / "attaches again when its session is restarted".
- [ ] 구현.
- [ ] `npx vitest run --pool=threads src/renderer/src/mobile` + typecheck → 커밋 `feat: manage sessions from the remote window and the phone`

### Task 6: e2e, 문서, 전체 검증

**Files:** `e2e/remote-window.spec.ts`, `docs/installation.md`, `README.md`(필요하면), 설계 문서

- [ ] e2e — 기존 테스트의 철회 단계 **앞**에 넣는다(철회하면 창이 닫힌다):
  1. 호스트의 선택 기억: `before = await page.evaluate(() => window.multiCliWork.terminals.state())`.
  2. 원격 창 "새 세션" → 폴더 "Sample Project", 에이전트 `SHELL_LABEL` → "시작".
  3. 원격 목록에 세션이 둘, 새 세션의 터미널이 열림. 호스트 `terminals.list()` 길이 2, `terminals.state().state.selectedSessionId`는 그대로.
  4. 새 세션에서 `echo MCW_NEW_SESSION` → 출력 확인.
  5. "중지" → 상태 배지 "종료됨", 버튼이 "재시작"으로. 호스트 목록에서 그 세션 `status === "exited"`.
  6. "재시작" → 배지가 "종료됨"이 아님, `echo MCW_AFTER_RESTART` 출력 확인(재-attach가 됐다는 뜻).
  7. "삭제" → "정말 삭제" → 원격 목록 1개, 호스트 `terminals.list()` 길이 1.
- [ ] `npm run build; if ($?) { npx playwright test }` — 26개 + 확장된 원격 창 테스트 전부 PASS, `git diff --stat e2e/mobile.spec.ts` 비어 있음.
- [ ] `npm run typecheck`, `npx vitest run --pool=threads --maxWorkers=2` 전체 PASS.
- [ ] 문서: `docs/installation.md` "다른 PC에서 이어받기"에 새 세션·중지·재시작·삭제 사용법 한 문단. 설계 문서: 상태 줄 `R1·R2 구현됨 · R3 구현 전`, §5를 "Spec 대비 R2 결정" 세 항목으로 고친다(메시지 표에서 `cols, rows` 제거, 크기 규칙, 버튼 위치, `error` 표시).
- [ ] 커밋 `test: cover remote session management end to end; document it and sync the spec`
