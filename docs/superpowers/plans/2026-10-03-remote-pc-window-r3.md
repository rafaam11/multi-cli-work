# 원격 PC 이어받기 R3 (알림) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원격 창을 닫아 둔 동안에도, 등록해 둔 다른 PC의 세션이 입력·승인을 기다리거나 끝나면 이 PC에 알림이 뜨고, 누르면 그 세션이 원격 창으로 열린다.

**Architecture:** 이 PC의 main이 페어링된 호스트마다 WS 연결 하나를 유지하되 **attach하지 않는다**. hub는 `sessions`·`status`·`title`·`exit`·`created`를 인증된 모든 연결에 보내고 터미널 출력은 attach한 세션에만 보내므로, 지금 배포된 호스트(v1.35.x) 그대로 상태 전용 연결이 된다. 재연결은 웹 UI가 쓰는 `RemoteClient`를 shared로 옮겨 같이 쓴다. 알림 판단은 이 PC의 알림 설정과 기존 dedupe를 재사용한다.

**Tech Stack:** Electron 43 · TypeScript 5.7 · React 18 · `ws` 8 · vitest 3 · Playwright 1.61

**Spec:** `docs/superpowers/specs/2026-10-03-remote-pc-window-design.md` §7·§8과 §9의 R3. 선행: R1·R2 계획.

> 형식은 R2 계획과 같다 — 코드 전문 대신 인터페이스·동작 규칙·테스트 사양을 적는다(같은 세션이 쓰고 곧바로 실행한다).

## Global Constraints

- 상태 연결은 `hello{mode: "ui", protocolVersion: 1}`만 보낸다. `attach`·`write` 등 다른 메시지는 보내지 않는다. `mode: "status"`는 만들지 않는다(구버전 파서가 거절한다).
- 모르는 서버 메시지 `type`은 무시한다. 서버 메시지는 추가만 한다는 규칙을 `remote-types.ts`에 적는다.
- 호스트의 버전 검사는 범위(`REMOTE_MIN_PROTOCOL_VERSION ≤ v ≤ REMOTE_PROTOCOL_VERSION`, 지금은 둘 다 1)로 바꾼다. 지금 통과하던 것은 그대로 통과하고 거절되던 것은 그대로 거절된다.
- 알림은 **상태가 바뀌는 메시지**(`status`)에서만 낸다. 연결할 때 받는 `sessions` 목록에 이미 대기 중인 세션이 있어도 알림을 내지 않는다(앱을 켤 때 알림이 쏟아지지 않게) — 그 수는 사이드바에만 보인다.
- 알림을 내기 전 확인 순서: 호스트의 `notify` → 이 PC의 `notifications.desktop`·상태별 토글·`notificationsMuted` → 그 호스트의 원격 창에 포커스가 없음 → dedupe.
- 토큰이 거절되면(4401·4403) 그 호스트의 토큰을 비우고 링크를 닫는다(R1의 "다시 페어링 필요"). 4400은 재시도하지 않는다.
- 좁은 화면(폰) 웹 UI와 `e2e/mobile.spec.ts`의 동작은 바뀌지 않는다. `RemoteClient`를 옮겨도 웹 UI의 import 경로는 그대로 둔다(재수출).
- 기존 관례: main 테스트 첫 줄 `// @vitest-environment node`, 사용자 문구 한국어, vitest `--pool=threads`(전체는 `--maxWorkers=2`), git·npm은 PowerShell, main 단일, push·릴리스 없음. 커밋 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **앱을 켜거나 재연결했을 때 이미 대기 중인 세션이 여럿인 호스트** — 알림이 한꺼번에 쏟아지면 안 된다. → Task 2 "does not notify for sessions already waiting when it connects"
2. **같은 세션이 대기 상태를 유지하는 동안 같은 상태가 다시 오는 경우**(재연결 뒤 hub가 다시 알림) — 같은 알림을 반복하면 안 되고, 상태가 풀렸다 다시 걸리면 다시 알려야 한다. → Task 2 "notifies once per wait, and again after the session moved on"
3. **호스트가 이 기기를 철회한 경우** — 끝없이 재연결하지 않고 "다시 페어링 필요"가 되어야 한다. → Task 2 "stops and reports a rejected token", Task 3 "drops the token of a host that rejected the link"
4. **그 호스트의 원격 창을 보고 있는 중** — 눈앞의 화면에 대한 OS 알림은 내지 않는다. → Task 2 "stays quiet while the host's window is focused"
5. **꺼져 있는 호스트** — 연결이 안 되는 동안 사이드바가 "연결됨"으로 보이거나 오류 알림을 내면 안 되고, 조용히 재시도해야 한다. → Task 2 "keeps retrying a host that is offline without notifying"

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/shared/remote-types.ts` (수정) | `REMOTE_MIN_PROTOCOL_VERSION`, `REMOTE_STATUS_PROTOCOL_VERSION`, `RemoteHostLink`, `RemoteHostView`, 규칙 주석 |
| `src/shared/remote-client.ts` (신규, 이동) | `RemoteClient` — 재연결·백오프. 브라우저와 main이 같이 쓴다 |
| `src/shared/remote-session-list.ts` (신규, 이동) | `applySessionMessage` |
| `src/renderer/src/mobile/remote-client.ts` · `session-list-model.ts` (수정) | 옮긴 것을 재수출, 브라우저 전용 부분만 남김 |
| `src/main/remote/remote-session-hub.ts` (수정) | 버전 범위 검사 |
| `src/main/remote-client/host-status-link.ts` (신규) | 호스트 하나의 상태 연결과 알림 판단 |
| `src/main/remote-client/host-status-links.ts` (신규) | 호스트별 링크의 생성·정리, 상태 스냅숏 |
| `src/main/remote-client/remote-windows.ts` (수정) | `isFocused(hostId)` |
| `src/main/remote-client/remote-hosts-service.ts` (수정) | 링크 상태 합치기, `setNotify`, 링크 갱신 |
| `src/main/ipc.ts` · `src/preload/index.ts` · `src/shared/api-types.ts` · `src/main/runtime.ts` (수정) | `remote-hosts:set-notify`, 배선, 알림 표시 |
| `src/renderer/src/RemoteHostsSection.tsx` · `RemoteHostsSettings.tsx` · `index.css` (수정) | 연결 상태·대기 수, 알림 토글 |
| `e2e/remote-window.spec.ts` (수정) | 등록 뒤 사이드바가 "연결됨"이 되는지 |

---

### Task 1: shared로 옮기기와 버전 규칙

**Interfaces — Produces:**

```ts
// remote-types.ts
export const REMOTE_MIN_PROTOCOL_VERSION = 1;
/** 상태 연결이 보내는 버전. 앱이 올라가도 이 값은 올리지 않는다 — 구버전 호스트에도 붙어야 한다. */
export const REMOTE_STATUS_PROTOCOL_VERSION = 1;
export type RemoteHostLink = "off" | "connecting" | "open" | "reconnecting" | "incompatible";
export interface RemoteHostView extends RemoteHostInfo { link: RemoteHostLink; awaiting: number }

// remote-client.ts (shared)
export type RemoteClientState = "connecting" | "open" | "reconnecting" | "unauthorized" | "incompatible";
export interface RemoteSocketLike {
  onopen: ((event: any) => void) | null;
  onmessage: ((event: any) => void) | null;
  onclose: ((event: any) => void) | null;
  send(data: string): void;
  close(code?: number): void;
}
export interface RemoteClientOptions {
  url: string; token: string;
  createSocket?: (url: string) => RemoteSocketLike;
  delaysMs?: readonly number[];
  protocolVersion?: number;   // 기본 REMOTE_PROTOCOL_VERSION
}
export class RemoteClient { /* state(), onMessage(), onState(), connect(), send(), close() — 기존 그대로 */ }

// remote-session-list.ts (shared)
export function applySessionMessage(sessions: RemoteSessionSummary[], message: RemoteServerMessage): RemoteSessionSummary[];
```

- [ ] 테스트 먼저:
  - `remote-session-hub.test.ts`: 버전 0과 99는 4400, 1은 통과(기존 테스트에 0 추가).
  - `src/renderer/src/mobile/remote-client.test.ts`: "stops as incompatible on 4400"(재연결 타이머가 서지 않는다), "says hello with the version it was given".
- [ ] 구현: 클래스와 `applySessionMessage`를 shared로 옮기고, `mobile/remote-client.ts`·`mobile/session-list-model.ts`는 재수출한다(웹 UI의 import와 기존 테스트는 그대로). `SessionList.tsx`의 `CONNECTION_LABEL`에 `incompatible: "호스트와 버전이 맞지 않습니다"`. hub `authenticate`의 검사를 범위로. `remote-types.ts` 머리 주석에 "서버 메시지는 추가만, 클라이언트는 모르는 type을 무시" 규칙.
- [ ] `npx vitest run --pool=threads src/shared src/main/remote src/renderer/src/mobile` + typecheck → 커밋 `refactor: share the remote client and accept a range of protocol versions`

### Task 2: 상태 연결

**Interfaces:**

```ts
// remote-windows.ts
isFocused(hostId: string): boolean;

// host-status-link.ts
export interface HostStatusLinkOptions {
  host: HostPairing;                                    // hostId, hostName, address, deviceId, token
  createSocket(url: string): RemoteSocketLike;
  delaysMs?: readonly number[];
  /** 지금 알려도 되는지: 호스트의 notify, 이 PC의 알림 설정, 원격 창 포커스. */
  shouldNotify(status: NotifiableStatus): boolean;
  notify(input: { hostId: string; hostName: string; sessionId: string; label: string; status: NotifiableStatus }): void;
  onChange(): void;                                     // link 상태나 대기 수가 바뀌었다
  onRejected(): void;                                   // 4401·4403
}
export class HostStatusLink {
  constructor(options: HostStatusLinkOptions);
  start(): void;
  close(): void;
  snapshot(): { link: RemoteHostLink; awaiting: number };
}

// host-status-links.ts
export class HostStatusLinks {
  constructor(options: {
    createLink(host: HostPairing, hooks: { onChange(): void; onRejected(): void }): Pick<HostStatusLink, "start" | "close" | "snapshot">;
    onChange(): void;
    onRejected(hostId: string): void;
  });
  /** 페어링된 호스트 목록에 맞춘다: 새 호스트는 붙이고, 사라졌거나 주소·토큰이 바뀐 것은 닫는다. */
  sync(hosts: HostPairing[]): void;
  snapshot(hostId: string): { link: RemoteHostLink; awaiting: number };   // 링크가 없으면 { link: "off", awaiting: 0 }
  closeAll(): void;
}
```

**동작 규칙 (`HostStatusLink`):**

- 주소 `ws://<address>/ws`, `RemoteClient`에 `protocolVersion: REMOTE_STATUS_PROTOCOL_VERSION`.
- 목록은 `applySessionMessage`로 유지한다. `awaiting`은 `awaiting-input`·`awaiting-approval` 세션 수.
- `status` 메시지가 알릴 수 있는 상태(`awaiting-input`·`awaiting-approval`·`exited`·`error`)면: `shouldNotify(status)`가 true이고 `createTerminalNotificationDeduper`가 처음이라고 할 때만 `notify`. 그 밖의 상태가 오면 그 세션의 dedupe를 푼다(다음 대기는 다시 알린다). `shouldNotify`가 false여서 건너뛴 경우에는 dedupe에 기록하지 않는다.
- `sessions`(연결 시 목록)에서는 알리지 않는다. 다만 목록에 없어진 세션의 dedupe는 정리한다.
- 상태 `unauthorized` → `onRejected()` 뒤 더 시도하지 않는다. `incompatible` → 재시도 없음, `link: "incompatible"`. 그 밖의 끊김 → `reconnecting`으로 조용히 재시도(알림·오류 없음), 이때 `awaiting`은 0으로 본다(모르는 것을 아는 척하지 않는다).
- `link`·`awaiting`이 실제로 바뀔 때만 `onChange()`.

- [ ] 테스트 먼저 (`host-status-link.test.ts`, 가짜 소켓): "says hello and never attaches" / "counts waiting sessions and reports changes" / "does not notify for sessions already waiting when it connects" / "notifies once per wait, and again after the session moved on" / "stays quiet while the host's window is focused"(shouldNotify false → notify 없음, 포커스가 풀린 뒤 같은 상태가 다시 오면 알림) / "stops and reports a rejected token" / "keeps retrying a host that is offline without notifying" / "does not retry an incompatible host".
  `host-status-links.test.ts`: "links every paired host and drops the ones that went away" / "replaces a link whose address or token changed" / "reports off for a host it has no link to".
  `remote-windows.test.ts`: "knows whether a host's window is focused".
- [ ] 구현 → `npx vitest run --pool=threads src/main/remote-client` + typecheck → 커밋 `feat: watch paired hosts over a status-only connection`

### Task 3: 서비스·IPC·알림 배선

- `remote-hosts-service.ts`: `list()`와 `announce`가 `RemoteHostView`(레지스트리 정보 + `links.snapshot`)를 돌려준다. `setNotify(hostId, notify)` 추가. `add`·`remove`·`unpaired` 뒤와 시작 시 `links.sync(await registry.pairings())`. 링크의 `onRejected(hostId)` → `unpaired(hostId)`. 링크의 `onChange` → announce.
- `host-registry.ts`: `pairings(): Promise<HostPairing[]>`(토큰이 있는 호스트 전부), `notifyEnabled(hostId)`를 위해 `list()` 결과를 쓴다.
- `ipc.ts`: `remote-hosts:set-notify`(hostId 문자열, notify boolean 검증). preload·`api-types.ts`: `setNotify`, 반환 타입을 `RemoteHostView`로.
- `runtime.ts`:
  - 알림 표시 함수를 로컬 알림과 같이 쓰게 뺀다(`NOTIFICATION_BODY` 재사용). 제목은 `<호스트 이름> · <세션 이름>`.
  - `createLink`: `new HostStatusLink({ host, createSocket: (url) => new WebSocket(url) /* ws */, shouldNotify, notify, … })`.
  - `shouldNotify(status)`: 그 호스트의 `notify`(서비스가 들고 있는 최신 목록) && `settings.notifications.desktop` && `statuses[status]` && `!notificationsMuted(...)` && `!remoteWindows.isFocused(hostId)`.
  - 알림 클릭 → `remoteWindows.open(hostId, sessionId)`.
  - 종료 시 `links.closeAll()`.
- [ ] 테스트 먼저: 서비스 "lists hosts with their link state" / "turns a host's notifications on and off" / "drops the token of a host that rejected the link" / "re-links after a host is added or removed"; ipc "validates set-notify".
- [ ] 구현 → `npx vitest run --pool=threads src/main/remote-client src/main/ipc.test.ts` + typecheck → 커밋 `feat: notify when a session on a paired host needs attention`

### Task 4: 화면

- `RemoteHostsSection.tsx`: 호스트 행에 연결 상태 점(`aria-label`: "연결됨"·"연결 중"·"연결 끊김"·"버전이 맞지 않음")과 대기 수 배지(0이면 없음, `aria-label` "대기 중인 세션 N개").
- `RemoteHostsSettings.tsx`: 호스트 행에 "알림" 체크박스(`aria-label` "<이름> 알림") → `setNotify`.
- [ ] 테스트 먼저: 섹션 "shows the link state and how many sessions wait" / 설정 "turns a host's notifications off". 기존 두 테스트의 fixture에 `link`·`awaiting` 추가.
- [ ] 구현 → `npx vitest run --pool=threads src/renderer/src` + typecheck → 커밋 `feat: show host link state and waiting sessions in the sidebar`

### Task 5: e2e, 문서, 전체 검증

- [ ] e2e: 호스트 추가 직후 사이드바 호스트 행의 상태가 "연결됨"이 된다(상태 연결이 실제 hub에 붙었다). 철회 뒤에는 "다시 페어링 필요"이고 상태 점이 없다. 셸 세션은 대기 상태가 되지 않으므로 알림 자체는 단위 테스트가 맡는다.
- [ ] `npm run typecheck`, `npx vitest run --pool=threads --maxWorkers=2`, `npm run build; npx playwright test` 전부 PASS, `git diff --stat e2e/mobile.spec.ts` 비어 있음.
- [ ] 문서: `docs/installation.md` "다른 PC에서 이어받기"에 알림 문단(이 PC의 알림 설정을 따른다, 호스트별로 끌 수 있다, 원격 창을 보고 있으면 뜨지 않는다). 설계 문서 상태 줄 `R1·R2·R3 구현됨`, §7을 구현과 맞춘다(연결 시 목록으로는 알리지 않음, 끊긴 동안 대기 수 0).
- [ ] 커밋 `test: cover the host status link end to end; document notifications and sync the spec`
