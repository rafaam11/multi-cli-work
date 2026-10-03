# 원격 PC 이어받기 R1 (원격 창) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이 PC의 multi-cli-work에서 다른 PC(호스트)를 등록하고, 그 PC가 서빙하는 세션 화면을 별도 창으로 열어 창 크기에 맞는 터미널에서 키보드로 이어 작업할 수 있게 한다.

**Architecture:** 데스크톱 앱이 Android 셸과 같은 역할(호스트 목록·토큰 보관·`window.McwShell` 브리지)을 맡는다. main의 `src/main/remote-client/`가 호스트 레지스트리·페어링·원격 창을 관리하고, 원격 창은 호스트의 `/mobile/` 번들을 로드한다. 그 번들(`src/renderer/src/mobile/`)에 넓은 화면 레이아웃과 자동 맞춤을 더한다. 호스트 서버·프로토콜(`src/main/remote/`)은 바꾸지 않는다.

**Tech Stack:** Electron 43 · TypeScript 5.7 · React 18 · xterm.js 6 · vitest 3 · Playwright 1.61

**Spec:** `docs/superpowers/specs/2026-10-03-remote-pc-window-design.md` (이 계획은 §3·§4·§6과 §9의 R1을 구현한다. R2·R3는 각자 계획을 따로 쓴다)

## Global Constraints

- 원격 창의 `webPreferences`는 `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webviewTag: false`, 호스트별 `partition: "remote-<hostId>"`다. 탐색은 등록된 호스트 출처로만 허용하고 `window.open`·권한 요청·다운로드는 모두 거부한다.
- 토큰을 줄지는 **main이** 정한다: sender가 열려 있는 원격 창이고, 메인 프레임이고, 프레임 출처가 그 호스트일 때만. preload는 묻기만 한다.
- 이 PC의 클립보드를 읽는 브리지를 만들지 않는다.
- 호스트 주소는 `100.64.0.0/10` IPv4와 포트만 받는다. loopback은 env `MULTI_CLI_WORK_REMOTE_BIND`가 설정돼 있을 때만 허용한다.
- 호스트 토큰은 `safeStorage` 암호문으로만 `userData/remote-hosts.json`에 둔다. 렌더러로 가는 `RemoteHostInfo`에는 토큰이 없다.
- 넓은 화면 판정은 `(min-width: 900px) and (pointer: fine)`이다. 좁은 화면의 동작은 바꾸지 않는다 — `e2e/mobile.spec.ts`는 수정 없이 통과해야 한다.
- `window.McwShell`의 `bridgeVersion`은 `1`이다. 호스트 서버·프로토콜(`REMOTE_PROTOCOL_VERSION = 1`)은 이 단계에서 바꾸지 않는다.
- 기존 코드 관례를 따른다: main 테스트 첫 줄은 `// @vitest-environment node`, 사용자 문구는 한국어, 저장 파일은 `src/main/storage/json-store.ts`의 `readJsonStore`/`updateJsonStore`를 쓴다.
- vitest는 `npx vitest run --pool=threads <파일>`로 돌린다. 전체 스위트는 `npx vitest run --pool=threads --maxWorkers=2`로 돌린다.
- git·npm 명령은 PowerShell로 실행한다. 브랜치는 main 단일이고 워크트리는 만들지 않는다. push·릴리스는 하지 않는다.
- 모든 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`를 붙인다.

## Spec 대비 R1 결정 (Task 9에서 spec에 반영)

- 복사 키는 데스크톱 `TerminalPane`과 같은 규칙으로 한다: 선택 영역이 있으면 **Ctrl+C도 복사**(없으면 인터럽트), Ctrl+Shift+C는 언제나 복사 키. spec §3.3은 Ctrl+Shift+C만 적었다.
- 주소 입력란은 호스트 설정이 보여 주는 `http://100.x.y.z:47821/mobile/`을 그대로 붙여 넣어도 받는다(스킴과 경로를 떼어 낸다).
- 호스트 역할 쪽 체크박스 문구는 "모바일 연결 켜기"에서 **"원격 접속 허용"**으로 바꾼다. Android 셸의 안내 문구("설정 ▸ 모바일")는 다음 셸 릴리스에서 고친다 — 문구 하나로 `shellVersion`을 올리지 않는다.
- 알림 토글 UI와 IPC `remote-hosts:set-notify`는 R3에서 넣는다. R1은 레지스트리에 `notify` 필드(기본 `true`)만 둔다.

## Review Focus

1. **원격 창에 포커스가 있는 동안 이 PC의 로컬 세션이 입력 대기가 되는 경우** — 로컬 알림이 떠야 한다(원격 창 포커스가 로컬 알림을 억제하면 안 된다). → Task 1 `mainWindowState` 테스트 "reports the main window only"
2. **호스트가 이 기기를 철회한 뒤** — 열려 있던 원격 창은 닫히고, 목록에는 "다시 페어링 필요"로 남으며, 그 호스트는 다시 열리지 않아야 한다. → Task 2 "keeps a rejected host but drops its token", Task 4 "refuses a host that needs pairing again"·"clears the pairing when the page reports it was rejected"
3. **하위 프레임이나 다른 출처가 토큰을 요구하는 경우** — 빈 문자열만 받아야 한다. → Task 4 "hands the token only to the host's own main frame"
4. **호스트가 크기를 되찾은 뒤** — 원격 창이 곧바로 다시 resize를 보내 호스트와 번갈아 크기를 바꾸면 안 된다. → Task 8 "pauses when the host takes the size back"
5. **주소를 잘못 넣은 경우**(포트 누락, Tailscale 밖 IP, 255 넘는 옥텟) — 호스트에 요청을 보내지 않고 무엇이 틀렸는지 한국어로 알려야 하며, 아무것도 저장되지 않아야 한다. → Task 3 "rejects addresses outside Tailscale", Task 5 "does not pair or save when the address is wrong"

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/main/main-window.ts` (신규) | 메인 창 상태·전송·sender 판정 헬퍼 |
| `src/main/window-security.ts` (수정) | 탐색 판정 함수 주입, `isSameOriginNavigation` |
| `src/main/updater.ts` · `src/main/index.ts` (수정) | 업데이터 방송을 메인 창으로 |
| `src/shared/remote-types.ts` (수정) | `RemoteHostInfo`, `RemoteHostAddInput` |
| `src/main/remote-client/host-registry.ts` (신규) | 호스트 목록·토큰 암호화 저장 |
| `src/main/remote-client/pair-host.ts` (신규) | 입력 파싱·주소 검증·`POST /pair` |
| `src/main/remote-client/remote-windows.ts` (신규) | 호스트별 원격 창, 브리지 IPC, 창 보안 |
| `src/main/remote-client/remote-hosts-service.ts` (신규) | 추가·삭제·열기·철회 흐름 조립 |
| `src/preload/remote-shell.ts` (신규) · `electron.vite.config.ts` (수정) | 원격 창에 심는 `window.McwShell` |
| `src/main/ipc.ts` · `src/preload/index.ts` · `src/shared/api-types.ts` · `src/main/runtime.ts` (수정) | sender 검사, `remote-hosts:*`, 배선 |
| `src/renderer/src/RemoteHostsSettings.tsx` (신규) · `RemoteSettings.tsx` · `SettingsDialog.tsx` (수정) | 설정 "원격" 탭 |
| `src/renderer/src/RemoteHostsSection.tsx` (신규) · `ProjectSidebar.tsx` · `App.tsx` · `index.css` (수정) | 사이드바 "원격 PC" |
| `src/renderer/src/mobile/wide-layout.ts` (신규) · `MobileApp.tsx` · `SessionList.tsx` · `mobile.css` (수정) | 넓은 화면 2단, 해시 딥링크 |
| `src/renderer/src/mobile/auto-fit.ts` (신규) · `SessionScreen.tsx` · `terminal-input.ts` (수정) | 자동 맞춤, 클립보드 키, 입력 도구 접기 |
| `e2e/remote-window.spec.ts` (신규) | 등록→원격 창→입력→크기 회수→복사·붙여넣기→철회 |

---

### Task 1: 메인 창 격리

원격 창을 추가하기 전에, main이 "창은 하나"를 전제한 곳을 메인 창 기준으로 좁힌다.

**Files:**
- Create: `src/main/main-window.ts`, `src/main/main-window.test.ts`
- Modify: `src/main/window-security.ts:100-117`, `src/main/window-security.test.ts`
- Modify: `src/main/ipc.ts:272-308, 835`, `src/main/ipc.test.ts:10, 253-285`
- Modify: `src/main/updater.ts:1-35`, `src/main/index.ts:256`
- Modify: `src/main/runtime.ts:430, 436-441, 456-462, 478-483, 544, 550, 740, 749, 791` + `registerMainIpc` 인자

**Interfaces:**
- Produces: `MainWindowLike`, `mainWindowState(window): { visible: boolean; focused: boolean }`, `sendToMainWindow(window, channel, ...args): void`, `isMainWindowSender(window, event): boolean` (`src/main/main-window.ts`)
- Produces: `isSameOriginNavigation(navigationUrl: string, origin: string): boolean`, `secureBrowserWindow(window, loadedAppUrl, isAllowed?)` (`src/main/window-security.ts`)
- Produces: `MainIpcDependencies.isTrustedSender?(event: unknown): boolean`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/main-window.test.ts`:

```ts
// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { isMainWindowSender, mainWindowState, sendToMainWindow } from "./main-window";

function fakeWindow(state: Partial<{ destroyed: boolean; visible: boolean; focused: boolean }> = {}) {
  const current = { destroyed: false, visible: true, focused: true, ...state };
  return {
    webContents: { send: vi.fn() },
    isDestroyed: () => current.destroyed,
    isVisible: () => current.visible,
    isFocused: () => current.focused,
  };
}

describe("mainWindowState", () => {
  it("reports the main window only", () => {
    expect(mainWindowState(fakeWindow())).toEqual({ visible: true, focused: true });
    // 원격 창에 포커스가 가 있으면 메인 창은 보이지만 포커스가 없다 — 로컬 알림이 억제되면 안 된다.
    expect(mainWindowState(fakeWindow({ focused: false }))).toEqual({ visible: true, focused: false });
  });

  it("treats a missing, destroyed, or hidden window as unfocused", () => {
    expect(mainWindowState(null)).toEqual({ visible: false, focused: false });
    expect(mainWindowState(fakeWindow({ destroyed: true }))).toEqual({ visible: false, focused: false });
    expect(mainWindowState(fakeWindow({ visible: false }))).toEqual({ visible: false, focused: false });
  });
});

describe("sendToMainWindow", () => {
  it("sends to a live window and does nothing otherwise", () => {
    const window = fakeWindow();
    sendToMainWindow(window, "terminal:event", { type: "data" });
    expect(window.webContents.send).toHaveBeenCalledWith("terminal:event", { type: "data" });

    const gone = fakeWindow({ destroyed: true });
    sendToMainWindow(gone, "terminal:event", {});
    sendToMainWindow(null, "terminal:event", {});
    expect(gone.webContents.send).not.toHaveBeenCalled();
  });
});

describe("isMainWindowSender", () => {
  it("accepts only the main window's own webContents", () => {
    const window = fakeWindow();
    expect(isMainWindowSender(window, { sender: window.webContents })).toBe(true);
    expect(isMainWindowSender(window, { sender: fakeWindow().webContents })).toBe(false);
    expect(isMainWindowSender(window, {})).toBe(false);
    expect(isMainWindowSender(null, { sender: window.webContents })).toBe(false);
    expect(isMainWindowSender(fakeWindow({ destroyed: true }), {})).toBe(false);
  });
});
```

`src/main/window-security.test.ts`의 import에 `isSameOriginNavigation`을 더하고 파일 끝에 추가:

```ts
describe("isSameOriginNavigation", () => {
  it("allows navigation within the given origin", () => {
    expect(isSameOriginNavigation("http://100.64.0.9:47821/mobile/#session=a", "http://100.64.0.9:47821")).toBe(true);
  });

  it.each([
    "http://100.64.0.9:47822/mobile/",
    "http://100.64.0.10:47821/mobile/",
    "https://100.64.0.9:47821/mobile/",
    "http://user:pw@100.64.0.9:47821/mobile/",
    "file:///C:/Windows/win.ini",
    "javascript:alert(1)",
    "not a url",
  ])("rejects %s", (value) => {
    expect(isSameOriginNavigation(value, "http://100.64.0.9:47821")).toBe(false);
  });
});

describe("secureBrowserWindow with a custom rule", () => {
  it("uses the rule it was given", () => {
    const listeners = new Map<string, (event: Electron.Event, url: string) => void>();
    const window = {
      webContents: {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn((name: string, listener: (event: Electron.Event, url: string) => void) => {
          listeners.set(name, listener);
        }),
      },
    } as unknown as Electron.BrowserWindow;

    secureBrowserWindow(window, "http://100.64.0.9:47821", isSameOriginNavigation);

    const inside = { preventDefault: vi.fn() } as unknown as Electron.Event;
    listeners.get("will-navigate")?.(inside, "http://100.64.0.9:47821/mobile/");
    expect(inside.preventDefault).not.toHaveBeenCalled();

    const outside = { preventDefault: vi.fn() } as unknown as Electron.Event;
    listeners.get("will-navigate")?.(outside, "http://example.com/");
    expect(outside.preventDefault).toHaveBeenCalledOnce();
  });
});
```

`src/main/ipc.test.ts`: `setup`의 옵션 타입에 `isTrustedSender?: (event: unknown) => boolean`을 더하고, `registerMainIpc(ipc, { … })` 인자에 `isTrustedSender: options.isTrustedSender,`를 넣는다. 그리고 "exposes remote access status…" 테스트 옆에 추가:

```ts
  it("rejects requests that do not come from the main window", async () => {
    const { handlers } = setup({ isTrustedSender: (event) => (event as { trusted?: boolean }).trusted === true });
    expect(await handlers.get("remote:status")!({ trusted: true })).toMatchObject({ state: "off" });
    expect(() => handlers.get("remote:status")!({})).toThrow(/Untrusted sender/);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/main-window.test.ts src/main/window-security.test.ts src/main/ipc.test.ts`
Expected: FAIL — `./main-window`를 찾지 못하고, `isSameOriginNavigation`이 export되지 않았고, sender 테스트가 throw하지 않는다.

- [ ] **Step 3: 구현** — `src/main/main-window.ts`:

```ts
/** BrowserWindow에서 여기서 쓰는 부분만. 테스트가 가짜를 넣는다. */
export interface MainWindowLike {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isFocused(): boolean;
  webContents: { send(channel: string, ...args: unknown[]): void };
}

/**
 * 이 PC의 세션에 관한 판단과 방송은 메인 창만 본다. 원격 창은 다른 PC가 서빙한 페이지라, 거기에
 * 포커스가 있다고 로컬 알림을 억제하거나 이 PC의 터미널 출력을 그쪽으로 보내면 안 된다.
 */
export function mainWindowState(
  window: Pick<MainWindowLike, "isDestroyed" | "isVisible" | "isFocused"> | null,
): { visible: boolean; focused: boolean } {
  if (!window || window.isDestroyed()) return { visible: false, focused: false };
  const visible = window.isVisible();
  return { visible, focused: visible && window.isFocused() };
}

export function sendToMainWindow(
  window: Pick<MainWindowLike, "isDestroyed" | "webContents"> | null,
  channel: string,
  ...args: unknown[]
): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, ...args);
}

/** IPC 요청이 메인 창의 렌더러에서 왔는지. */
export function isMainWindowSender(
  window: Pick<MainWindowLike, "isDestroyed" | "webContents"> | null,
  event: unknown,
): boolean {
  if (!window || window.isDestroyed()) return false;
  return (event as { sender?: unknown } | null)?.sender === window.webContents;
}
```

`src/main/window-security.ts` — `isAllowedRendererNavigation` 아래에 추가하고 `secureBrowserWindow`를 바꾼다:

```ts
/** 원격 창용: 등록된 호스트 출처 안에서만 움직인다. */
export function isSameOriginNavigation(navigationUrl: string, origin: string): boolean {
  try {
    const navigation = new URL(navigationUrl);
    if (navigation.protocol !== "http:" && navigation.protocol !== "https:") return false;
    if (navigation.username || navigation.password) return false;
    return navigation.origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function secureBrowserWindow(
  window: BrowserWindow,
  loadedAppUrl: string,
  isAllowed: (navigationUrl: string, loadedAppUrl: string) => boolean = isAllowedRendererNavigation,
): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const preventExternalNavigation = (
    event: Electron.Event,
    navigationUrl: string,
  ): void => {
    if (!isAllowed(navigationUrl, loadedAppUrl)) {
      event.preventDefault();
    }
  };

  window.webContents.on("will-navigate", preventExternalNavigation);
  window.webContents.on("will-redirect", preventExternalNavigation);
}
```

`src/main/ipc.ts` — `MainIpcDependencies`에 필드를 더하고(`onSessionSelected?` 아래):

```ts
  /** 메인 창의 렌더러가 보낸 요청인지. 없으면(테스트) 모든 요청을 받는다. */
  isTrustedSender?(event: unknown): boolean;
```

`registerMainIpc`의 첫 줄을 바꾼다. 매개변수 이름만 `registrar`로 바꾸고 같은 이름 `ipc`를 감싼 것으로 다시 만들면, 아래의 `ipc.handle(...)` 호출은 손대지 않아도 된다:

```ts
export function registerMainIpc(registrar: IpcRegistrar, dependencies: MainIpcDependencies): void {
  // 원격 창처럼 메인 렌더러가 아닌 곳에서 온 요청은 어떤 채널도 받지 않는다.
  const ipc: IpcRegistrar = {
    handle: (channel, listener) =>
      registrar.handle(channel, (event, ...args) => {
        if (dependencies.isTrustedSender && !dependencies.isTrustedSender(event)) {
          throw new Error(`Untrusted sender for ${channel}`);
        }
        return listener(event, ...args);
      }),
  };
```

`src/main/updater.ts` — import에서 `BrowserWindow`를 빼고 `publish`와 `initUpdater` 머리를 바꾼다:

```ts
import { app, shell } from "electron";
```

```ts
import { sendToMainWindow, type MainWindowLike } from "./main-window";
```

```ts
let currentStatus: UpdaterStatus = { state: "idle" };
let getWindow: () => MainWindowLike | null = () => null;

function publish(status: UpdaterStatus): void {
  currentStatus = status;
  sendToMainWindow(getWindow(), "updater:event", status);
}
```

```ts
export function initUpdater(options: { autoCheck?: boolean; getWindow?: () => MainWindowLike | null } = {}): void {
  if (options.getWindow) getWindow = options.getWindow;
  if (!app.isPackaged) return;
```

`src/main/index.ts:256`:

```ts
      initUpdater({
        autoCheck: runtime?.settings.current().general.autoCheckUpdates ?? true,
        getWindow: () => mainWindow,
      });
```

`src/main/runtime.ts` — import 추가:

```ts
import { isMainWindowSender, mainWindowState, sendToMainWindow } from "./main-window";
```

그리고 아래 자리를 각각 바꾼다.

```ts
    // 430행: HTML 미리보기의 부모
    getWindow: () => host.getMainWindow(),
```

```ts
  // 436-441행
  const publishAttention = (snapshot: AttentionSnapshot) => {
    applyAttention(snapshot);
    sendToMainWindow(host.getMainWindow(), "attention:event", snapshot.unread);
  };
```

```ts
    // 456-462행
    windowState: () => mainWindowState(host.getMainWindow()),
```

```ts
    // 478-483행
    navigate(sessionId) {
      showMainWindow();
      sendToMainWindow(host.getMainWindow(), "navigation:session-requested", { sessionId });
    },
```

```ts
    // 544행
    sendToMainWindow(host.getMainWindow(), "settings:changed", next);
```

```ts
  // 549-551행
  const announceWorkspaceChange = () => {
    sendToMainWindow(host.getMainWindow(), "workspace:changed");
  };
```

```ts
      // 740행과 749행 (chooseDirectory, saveTextFile): 대화상자의 부모는 메인 창이다.
      const window = host.getMainWindow();
```

```ts
    // 791행
    sendToMainWindow(host.getMainWindow(), "terminal:event", event);
```

`registerMainIpc(ipcMain, { … })` 인자 끝(`onSessionSelected` 아래)에 추가:

```ts
    isTrustedSender: (event) => isMainWindowSender(host.getMainWindow(), event),
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/main/main-window.test.ts src/main/window-security.test.ts src/main/ipc.test.ts src/main/updater.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: 오류 없음. `runtime.ts`에서 `BrowserWindow.getAllWindows`가 더 남아 있지 않은지 `rg "getAllWindows" src/main --glob "!*.test.ts"`로 확인한다(결과 없음).

- [ ] **Step 5: 커밋**

```powershell
git add src/main/main-window.ts src/main/main-window.test.ts src/main/window-security.ts src/main/window-security.test.ts src/main/ipc.ts src/main/ipc.test.ts src/main/updater.ts src/main/index.ts src/main/runtime.ts
git commit -m @'
refactor: scope main-process broadcasts and IPC to the main window

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
'@
```

---

### Task 2: 호스트 레지스트리

**Files:**
- Modify: `src/shared/remote-types.ts` (파일 끝)
- Create: `src/main/remote-client/host-registry.ts`, `src/main/remote-client/host-registry.test.ts`

**Interfaces:**
- Consumes: `SafeStorageLike` (`src/main/notion/notion-token-store.ts`), `readJsonStore`/`updateJsonStore`/`JsonStoreSpec` (`src/main/storage/json-store.ts`)
- Produces: `RemoteHostInfo { hostId, name, address, notify, paired, addedAt }`, `RemoteHostAddInput = { address: string; code: string } | { uri: string }` (`src/shared/remote-types.ts`)
- Produces: `class RemoteHostRegistry { canStore(): boolean; list(): Promise<RemoteHostInfo[]>; save(input: NewRemoteHost): Promise<RemoteHostInfo>; remove(hostId): Promise<void>; setNotify(hostId, notify): Promise<void>; clearToken(hostId): Promise<void>; pairing(hostId): Promise<HostPairing | null> }`, `NewRemoteHost { hostId, name, address, deviceId, token }`, `HostPairing { hostId, hostName, address, deviceId, token }`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/remote-client/host-registry.test.ts`:

```ts
// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SafeStorageLike } from "../notion/notion-token-store";
import { RemoteHostRegistry } from "./host-registry";

/** 실제 safeStorage 대신 쓰는 되돌릴 수 있는 변환 — 평문이 파일에 남지 않는지 보기 위한 것이다. */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`sealed:${[...text].reverse().join("")}`, "utf8"),
    decryptString: (buffer) => {
      const text = buffer.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("not sealed by this account");
      return [...text.slice("sealed:".length)].reverse().join("");
    },
  };
}

const HOST = { hostId: "host-1", name: "회사PC", address: "100.64.0.9:47821", deviceId: "dev-1", token: "tok-secret" };

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-remote-hosts-"));
  filePath = path.join(dir, "remote-hosts.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("RemoteHostRegistry", () => {
  it("stores the token encrypted and never lists it", async () => {
    const registry = new RemoteHostRegistry(filePath, fakeSafeStorage(), () => "2026-10-03T00:00:00.000Z");
    const info = await registry.save(HOST);
    expect(info).toEqual({
      hostId: "host-1",
      name: "회사PC",
      address: "100.64.0.9:47821",
      notify: true,
      paired: true,
      addedAt: "2026-10-03T00:00:00.000Z",
    });
    expect(await registry.list()).toEqual([info]);
    expect(await fs.readFile(filePath, "utf8")).not.toContain("tok-secret");
    expect(await registry.pairing("host-1")).toEqual({
      hostId: "host-1",
      hostName: "회사PC",
      address: "100.64.0.9:47821",
      deviceId: "dev-1",
      token: "tok-secret",
    });
  });

  it("refuses to save when the token cannot be encrypted", async () => {
    const registry = new RemoteHostRegistry(filePath, fakeSafeStorage(false));
    expect(registry.canStore()).toBe(false);
    await expect(registry.save(HOST)).rejects.toThrow("안전하게 저장할 수 없습니다");
    expect(await registry.list()).toEqual([]);
  });

  it("replaces a host that is added again, keeping its place and settings", async () => {
    let now = "2026-10-03T00:00:00.000Z";
    const registry = new RemoteHostRegistry(filePath, fakeSafeStorage(), () => now);
    await registry.save(HOST);
    await registry.save({ ...HOST, hostId: "host-2", name: "집PC" });
    await registry.setNotify("host-1", false);
    now = "2026-10-04T00:00:00.000Z";
    await registry.save({ ...HOST, address: "100.64.0.9:50000", deviceId: "dev-2", token: "tok-new" });

    const hosts = await registry.list();
    expect(hosts.map((host) => host.hostId)).toEqual(["host-1", "host-2"]);
    expect(hosts[0]).toMatchObject({ address: "100.64.0.9:50000", notify: false, addedAt: "2026-10-03T00:00:00.000Z" });
    expect((await registry.pairing("host-1"))?.token).toBe("tok-new");
  });

  it("keeps a rejected host but drops its token", async () => {
    const registry = new RemoteHostRegistry(filePath, fakeSafeStorage());
    await registry.save(HOST);
    await registry.clearToken("host-1");
    expect(await registry.list()).toMatchObject([{ hostId: "host-1", paired: false }]);
    expect(await registry.pairing("host-1")).toBeNull();
  });

  it("removes a host", async () => {
    const registry = new RemoteHostRegistry(filePath, fakeSafeStorage());
    await registry.save(HOST);
    await registry.remove("host-1");
    expect(await registry.list()).toEqual([]);
    expect(await registry.pairing("host-1")).toBeNull();
  });

  it("treats a token sealed by another account as no pairing", async () => {
    const registry = new RemoteHostRegistry(filePath, fakeSafeStorage());
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        hosts: [
          { hostId: "host-1", name: "회사PC", address: "100.64.0.9:47821", deviceId: "d", token: Buffer.from("other").toString("base64"), notify: true, addedAt: "x" },
          { hostId: 7, name: "깨진 항목" },
        ],
      }),
      "utf8",
    );
    expect(await registry.list()).toHaveLength(1);
    expect(await registry.pairing("host-1")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote-client/host-registry.test.ts`
Expected: FAIL — `./host-registry`를 찾지 못한다.

- [ ] **Step 3: 구현** — `src/shared/remote-types.ts` 끝에 추가:

```ts
/** 이 PC가 클라이언트로서 등록해 둔 다른 PC. 토큰은 main 밖으로 나가지 않는다. */
export interface RemoteHostInfo {
  hostId: string;
  name: string;
  /** "100.x.y.z:47821" */
  address: string;
  notify: boolean;
  /** false면 호스트가 이 기기를 거절했다 — 다시 페어링해야 한다. */
  paired: boolean;
  addedAt: string;
}

/** "PC 추가" 입력: 접속 주소와 코드, 또는 호스트 설정에서 복사한 mcw://pair 링크. */
export type RemoteHostAddInput = { address: string; code: string } | { uri: string };
```

`src/main/remote-client/host-registry.ts`:

```ts
import type { RemoteHostInfo } from "../../shared/remote-types";
import type { SafeStorageLike } from "../notion/notion-token-store";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";

interface StoredHost {
  hostId: string;
  name: string;
  /** "100.x.y.z:47821" */
  address: string;
  deviceId: string;
  /** safeStorage 암호문의 base64. 호스트가 이 기기를 거절했으면 null. */
  token: string | null;
  notify: boolean;
  addedAt: string;
}

interface RemoteHostsFileV1 {
  version: 1;
  hosts: StoredHost[];
}

export interface NewRemoteHost {
  hostId: string;
  name: string;
  address: string;
  deviceId: string;
  /** 호스트가 발급한 기기 토큰 원문. */
  token: string;
}

/** 원격 창과 상태 연결이 호스트에 붙을 때 쓰는 것. main 안에서만 돈다. */
export interface HostPairing {
  hostId: string;
  hostName: string;
  address: string;
  deviceId: string;
  token: string;
}

class RemoteHostRegistryError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredHost(value: unknown): value is StoredHost {
  return (
    isRecord(value) &&
    typeof value.hostId === "string" &&
    typeof value.name === "string" &&
    typeof value.address === "string" &&
    typeof value.deviceId === "string" &&
    (value.token === null || typeof value.token === "string") &&
    typeof value.notify === "boolean" &&
    typeof value.addedAt === "string"
  );
}

function parseHostsFile(value: unknown): RemoteHostsFileV1 {
  const raw = isRecord(value) ? value : {};
  return { version: 1, hosts: Array.isArray(raw.hosts) ? raw.hosts.filter(isStoredHost) : [] };
}

const spec: JsonStoreSpec<RemoteHostsFileV1> = {
  label: "remote host registry",
  displayName: "원격 PC 목록(remote-hosts.json)",
  parse: parseHostsFile,
  empty: () => parseHostsFile(undefined),
  error: (message, options) => new RemoteHostRegistryError(message, options),
  isContentError: (error) => error instanceof RemoteHostRegistryError,
};

function toInfo(host: StoredHost): RemoteHostInfo {
  return {
    hostId: host.hostId,
    name: host.name,
    address: host.address,
    notify: host.notify,
    paired: host.token !== null,
    addedAt: host.addedAt,
  };
}

/**
 * 이 PC가 클라이언트로서 등록해 둔 다른 PC들. 기기 토큰은 시크릿이라 safeStorage로 암호화해 두고,
 * 렌더러에는 토큰이 없는 RemoteHostInfo만 내보낸다. 원문은 pairing()으로 main 안에서만 꺼낸다.
 */
export class RemoteHostRegistry {
  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  canStore(): boolean {
    return this.safeStorage.isEncryptionAvailable();
  }

  async list(): Promise<RemoteHostInfo[]> {
    return (await readJsonStore(spec, this.filePath)).value.hosts.map(toInfo);
  }

  /** 같은 hostId가 이미 있으면 그 자리에서 새 토큰·주소로 바꾼다. */
  async save(input: NewRemoteHost): Promise<RemoteHostInfo> {
    if (!this.canStore()) throw new Error("이 환경에서는 토큰을 안전하게 저장할 수 없습니다");
    const token = this.safeStorage.encryptString(input.token).toString("base64");
    const file = await updateJsonStore(spec, this.filePath, (current) => {
      const existing = current.hosts.find((host) => host.hostId === input.hostId);
      const next: StoredHost = {
        hostId: input.hostId,
        name: input.name,
        address: input.address,
        deviceId: input.deviceId,
        token,
        notify: existing?.notify ?? true,
        addedAt: existing?.addedAt ?? this.now(),
      };
      return {
        ...current,
        hosts: existing
          ? current.hosts.map((host) => (host.hostId === input.hostId ? next : host))
          : [...current.hosts, next],
      };
    });
    return toInfo(file.hosts.find((host) => host.hostId === input.hostId)!);
  }

  async remove(hostId: string): Promise<void> {
    await updateJsonStore(spec, this.filePath, (current) => ({
      ...current,
      hosts: current.hosts.filter((host) => host.hostId !== hostId),
    }));
  }

  async setNotify(hostId: string, notify: boolean): Promise<void> {
    await this.patch(hostId, { notify });
  }

  /** 호스트가 이 기기를 거절했다. 항목은 남겨 "다시 페어링 필요"로 보이게 한다. */
  async clearToken(hostId: string): Promise<void> {
    await this.patch(hostId, { token: null });
  }

  async pairing(hostId: string): Promise<HostPairing | null> {
    const host = (await readJsonStore(spec, this.filePath)).value.hosts.find((candidate) => candidate.hostId === hostId);
    if (!host || host.token === null) return null;
    try {
      return {
        hostId: host.hostId,
        hostName: host.name,
        address: host.address,
        deviceId: host.deviceId,
        token: this.safeStorage.decryptString(Buffer.from(host.token, "base64")),
      };
    } catch {
      // 다른 OS 계정이 쓴 암호문은 풀리지 않는다 — 페어링이 없는 것과 같이 다룬다.
      return null;
    }
  }

  private async patch(hostId: string, change: Partial<StoredHost>): Promise<void> {
    await updateJsonStore(spec, this.filePath, (current) => ({
      ...current,
      hosts: current.hosts.map((host) => (host.hostId === hostId ? { ...host, ...change } : host)),
    }));
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/main/remote-client/host-registry.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```powershell
git add src/shared/remote-types.ts src/main/remote-client/host-registry.ts src/main/remote-client/host-registry.test.ts
git commit -m @'
feat: keep paired remote hosts with encrypted tokens

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
'@
```

---

### Task 3: 페어링 입력 파싱과 `POST /pair`

**Files:**
- Create: `src/main/remote-client/pair-host.ts`, `src/main/remote-client/pair-host.test.ts`

**Interfaces:**
- Consumes: `RemoteHostAddInput`, `RemotePairResponse` (`src/shared/remote-types.ts`), `isTailscaleAddress` (`src/main/remote/tailscale-address.ts`)
- Produces: `PairTarget { address: string; code: string; expectedHostId: string | null }`, `parsePairInput(input: RemoteHostAddInput, options: { allowLoopback: boolean }): PairTarget`, `pairWithHost(target: PairTarget, deviceName: string, fetchImpl?: typeof fetch): Promise<RemotePairResponse>`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/remote-client/pair-host.test.ts`:

```ts
// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { pairWithHost, parsePairInput } from "./pair-host";

const STRICT = { allowLoopback: false };

describe("parsePairInput", () => {
  it("accepts an address and a code", () => {
    expect(parsePairInput({ address: " 100.64.0.9:47821 ", code: " abcd-efgh " }, STRICT)).toEqual({
      address: "100.64.0.9:47821",
      code: "abcd-efgh",
      expectedHostId: null,
    });
  });

  it("accepts the URL the host's settings show", () => {
    expect(parsePairInput({ address: "http://100.64.0.9:47821/mobile/", code: "ABCD-EFGH" }, STRICT).address).toBe(
      "100.64.0.9:47821",
    );
  });

  it.each([
    ["100.64.0.9", "100.x.y.z:포트"],
    ["office-pc:47821", "100.x.y.z:포트"],
    ["192.168.0.5:47821", "Tailscale 주소"],
    ["8.8.8.8:47821", "Tailscale 주소"],
    ["100.64.0.999:47821", "Tailscale 주소"],
    ["127.0.0.1:47821", "Tailscale 주소"],
    ["100.64.0.9:0", "포트"],
    ["100.64.0.9:70000", "포트"],
  ])("rejects addresses outside Tailscale: %s", (address, message) => {
    expect(() => parsePairInput({ address, code: "ABCD-EFGH" }, STRICT)).toThrow(message);
  });

  it("allows loopback only for tests and development", () => {
    expect(parsePairInput({ address: "127.0.0.1:5000", code: "x" }, { allowLoopback: true }).address).toBe("127.0.0.1:5000");
  });

  it("requires a code", () => {
    expect(() => parsePairInput({ address: "100.64.0.9:47821", code: "  " }, STRICT)).toThrow("페어링 코드");
  });

  it("reads a pairing link", () => {
    expect(
      parsePairInput({ uri: "mcw://pair?host=100.64.0.9:47821&name=%ED%9A%8C%EC%82%ACPC&code=ABCDEFGH&fp=host-1" }, STRICT),
    ).toEqual({ address: "100.64.0.9:47821", code: "ABCDEFGH", expectedHostId: "host-1" });
  });

  it.each([
    "https://pair?host=100.64.0.9:47821&code=A&fp=h",
    "mcw://other?host=100.64.0.9:47821&code=A&fp=h",
    "mcw://pair?host=100.64.0.9:47821&code=A",
    "mcw://pair?code=A&fp=h",
    "nonsense",
  ])("rejects a malformed link: %s", (uri) => {
    expect(() => parsePairInput({ uri }, STRICT)).toThrow("페어링 링크");
  });

  it("applies the address rules to a link too", () => {
    expect(() => parsePairInput({ uri: "mcw://pair?host=192.168.0.5:47821&code=A&fp=h" }, STRICT)).toThrow("Tailscale 주소");
  });
});

function response(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

const TARGET = { address: "100.64.0.9:47821", code: "ABCD-EFGH", expectedHostId: null };
const PAIRED = { token: "tok", deviceId: "dev-1", hostId: "host-1", hostName: "회사PC" };

describe("pairWithHost", () => {
  it("posts the code and returns the host's answer", async () => {
    const fetchImpl = vi.fn(async () => response(200, PAIRED));
    expect(await pairWithHost(TARGET, "내 노트북", fetchImpl as unknown as typeof fetch)).toEqual(PAIRED);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://100.64.0.9:47821/pair");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ code: "ABCD-EFGH", deviceName: "내 노트북" });
  });

  it.each([
    [401, "코드가 맞지 않거나 만료되었습니다"],
    [429, "시도가 너무 많습니다"],
    [500, "페어링에 실패했습니다 (500)"],
  ])("explains a %i", async (status, message) => {
    const fetchImpl = vi.fn(async () => response(status, "no"));
    await expect(pairWithHost(TARGET, "x", fetchImpl as unknown as typeof fetch)).rejects.toThrow(message);
  });

  it("explains an unreachable host", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(pairWithHost(TARGET, "x", fetchImpl as unknown as typeof fetch)).rejects.toThrow("호스트에 연결하지 못했습니다");
  });

  it("rejects an answer it cannot read", async () => {
    const fetchImpl = vi.fn(async () => response(200, { token: "tok" }));
    await expect(pairWithHost(TARGET, "x", fetchImpl as unknown as typeof fetch)).rejects.toThrow("응답을 읽을 수 없습니다");
  });

  it("rejects a host that is not the one the link named", async () => {
    const fetchImpl = vi.fn(async () => response(200, PAIRED));
    await expect(
      pairWithHost({ ...TARGET, expectedHostId: "host-other" }, "x", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("다른 PC");
    expect(await pairWithHost({ ...TARGET, expectedHostId: "host-1" }, "x", fetchImpl as unknown as typeof fetch)).toEqual(PAIRED);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote-client/pair-host.test.ts`
Expected: FAIL — `./pair-host`를 찾지 못한다.

- [ ] **Step 3: 구현** — `src/main/remote-client/pair-host.ts`:

```ts
import type { RemoteHostAddInput, RemotePairResponse } from "../../shared/remote-types";
import { isTailscaleAddress } from "../remote/tailscale-address";

export interface PairTarget {
  /** "100.x.y.z:47821" */
  address: string;
  code: string;
  /** 페어링 링크로 추가했을 때 그 링크가 가리킨 호스트. 응답이 다르면 저장하지 않는다. */
  expectedHostId: string | null;
}

const PAIR_TIMEOUT_MS = 10_000;
const BAD_LINK = "페어링 링크를 읽을 수 없습니다";

/**
 * 호스트 주소는 Tailscale IPv4와 포트만 받는다 — 호스트가 그 주소에만 bind하는 것과 같은 규칙이다.
 * 호스트 설정이 보여 주는 "http://…/mobile/"을 그대로 붙여 넣어도 되게 스킴과 경로는 떼어 낸다.
 */
function normalizeAddress(raw: string, allowLoopback: boolean): string {
  const bare = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
  const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(bare);
  if (!match) throw new Error("주소는 100.x.y.z:포트 형식이어야 합니다");
  const ip = match[1]!;
  const port = Number(match[2]);
  const validOctets = ip.split(".").every((octet) => Number(octet) <= 255);
  const allowed = validOctets && (isTailscaleAddress(ip) || (allowLoopback && ip === "127.0.0.1"));
  if (!allowed) throw new Error("Tailscale 주소(100.64.0.0/10)만 등록할 수 있습니다");
  if (port < 1 || port > 65535) throw new Error("포트가 올바르지 않습니다");
  return `${ip}:${port}`;
}

export function parsePairInput(input: RemoteHostAddInput, options: { allowLoopback: boolean }): PairTarget {
  if ("uri" in input) {
    let url: URL;
    try {
      url = new URL(input.uri.trim());
    } catch {
      throw new Error(BAD_LINK);
    }
    const host = url.searchParams.get("host");
    const code = url.searchParams.get("code");
    const hostId = url.searchParams.get("fp");
    if (url.protocol !== "mcw:" || url.hostname !== "pair" || !host || !code || !hostId) throw new Error(BAD_LINK);
    return { address: normalizeAddress(host, options.allowLoopback), code, expectedHostId: hostId };
  }
  const code = input.code.trim();
  if (code.length === 0) throw new Error("페어링 코드를 입력하세요");
  return { address: normalizeAddress(input.address, options.allowLoopback), code, expectedHostId: null };
}

/** 호스트의 POST /pair로 일회용 코드를 기기 토큰과 바꾼다. */
export async function pairWithHost(
  target: PairTarget,
  deviceName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RemotePairResponse> {
  let response: Response;
  try {
    response = await fetchImpl(`http://${target.address}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: target.code, deviceName }),
      signal: AbortSignal.timeout(PAIR_TIMEOUT_MS),
    });
  } catch {
    throw new Error("호스트에 연결하지 못했습니다. 주소, Tailscale 연결, 그 PC의 원격 접속 허용을 확인하세요");
  }
  if (response.status === 401) throw new Error("코드가 맞지 않거나 만료되었습니다");
  if (response.status === 429) throw new Error("시도가 너무 많습니다. 잠시 후 다시 시도하세요");
  if (!response.ok) throw new Error(`페어링에 실패했습니다 (${response.status})`);
  const body = (await response.json().catch(() => null)) as Partial<RemotePairResponse> | null;
  if (
    !body ||
    typeof body.token !== "string" ||
    typeof body.deviceId !== "string" ||
    typeof body.hostId !== "string" ||
    typeof body.hostName !== "string"
  ) {
    throw new Error("호스트의 응답을 읽을 수 없습니다");
  }
  if (target.expectedHostId !== null && body.hostId !== target.expectedHostId) {
    throw new Error("페어링 링크가 가리킨 PC와 다른 PC가 응답했습니다");
  }
  return { token: body.token, deviceId: body.deviceId, hostId: body.hostId, hostName: body.hostName };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/main/remote-client/pair-host.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```powershell
git add src/main/remote-client/pair-host.ts src/main/remote-client/pair-host.test.ts
git commit -m @'
feat: pair this PC with a remote host

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
'@
```

---

### Task 4: 원격 창과 셸 브리지 preload

**Files:**
- Create: `src/main/remote-client/remote-windows.ts`, `src/main/remote-client/remote-windows.test.ts`
- Create: `src/preload/remote-shell.ts`
- Modify: `electron.vite.config.ts:17-24`

**Interfaces:**
- Consumes: `HostPairing` (Task 2), `secureBrowserWindow`·`isSameOriginNavigation` (Task 1)
- Produces: `REMOTE_SHELL_CHANNELS = { pairing: "remote-shell:pairing", unpaired: "remote-shell:unpaired", back: "remote-shell:back" }`, `remoteWindowUrl(address: string, sessionId?: string): string`, `RemoteShellEvent`, `RemoteWindowsOptions`, `class RemoteWindows { open(hostId: string, sessionId?: string): Promise<void>; closeHost(hostId: string): void; closeAll(): void }`
- Produces: 빌드 산출물 `out/preload/remote-shell.js`, 그 안의 `window.McwShell { bridgeVersion(): number; pairingJson(): string; unpaired(): void; backToHosts(): void }`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/remote-client/remote-windows.test.ts`:

```ts
// @vitest-environment node

import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { HostPairing } from "./host-registry";
import { REMOTE_SHELL_CHANNELS, remoteWindowUrl, RemoteWindows, type RemoteShellEvent } from "./remote-windows";

type Listener = (...args: any[]) => unknown;

function fakeWindow(id: number) {
  const contents = new Map<string, Listener>();
  const windowEvents = new Map<string, Listener>();
  const sessionEvents = new Map<string, Listener>();
  let destroyed = false;
  const close = () => {
    destroyed = true;
    windowEvents.get("closed")?.();
  };
  const session = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    on: vi.fn((name: string, listener: Listener) => sessionEvents.set(name, listener)),
  };
  const window = {
    webContents: {
      id,
      session,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((name: string, listener: Listener) => contents.set(name, listener)),
    },
    on: vi.fn((name: string, listener: Listener) => windowEvents.set(name, listener)),
    loadURL: vi.fn(async (_url: string) => undefined),
    isDestroyed: () => destroyed,
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(close),
    destroy: vi.fn(close),
  };
  return { window, contents, windowEvents, sessionEvents, session };
}

const PAIRING: HostPairing = { hostId: "host-1", hostName: "회사PC", address: "100.64.0.9:47821", deviceId: "dev-1", token: "tok" };

function setup(pairing: HostPairing | null = PAIRING) {
  const fakes: Array<ReturnType<typeof fakeWindow>> = [];
  const channels = new Map<string, (event: RemoteShellEvent) => void>();
  const createWindow = vi.fn((_options: Electron.BrowserWindowConstructorOptions) => {
    const fake = fakeWindow(100 + fakes.length);
    fakes.push(fake);
    return fake.window as unknown as BrowserWindow;
  });
  const onUnpaired = vi.fn(async (_hostId: string) => undefined);
  const showMainWindow = vi.fn();
  const windows = new RemoteWindows({
    createWindow,
    ipc: { on: (channel, listener) => channels.set(channel, listener) },
    preloadPath: "/out/preload/remote-shell.js",
    pairing: vi.fn(async () => pairing),
    onUnpaired,
    showMainWindow,
  });
  const ask = (channel: string, event: Omit<RemoteShellEvent, "returnValue">) => {
    const full: RemoteShellEvent = { ...event };
    channels.get(channel)!(full);
    return full.returnValue;
  };
  return { windows, fakes, createWindow, onUnpaired, showMainWindow, ask };
}

const HOST_FRAME = { url: "http://100.64.0.9:47821/mobile/", parent: null };

describe("remoteWindowUrl", () => {
  it("points at the host's served UI, optionally at one session", () => {
    expect(remoteWindowUrl("100.64.0.9:47821")).toBe("http://100.64.0.9:47821/mobile/");
    expect(remoteWindowUrl("100.64.0.9:47821", "a b")).toBe("http://100.64.0.9:47821/mobile/#session=a%20b");
  });
});

describe("RemoteWindows", () => {
  it("opens a locked-down window on the host's page", async () => {
    const { windows, fakes, createWindow } = setup();
    await windows.open("host-1");
    const options = createWindow.mock.calls[0]![0];
    expect(options.webPreferences).toEqual({
      preload: "/out/preload/remote-shell.js",
      partition: "remote-host-1",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    });
    expect(options.title).toBe("회사PC — 원격");
    const fake = fakes[0]!;
    expect(fake.window.loadURL).toHaveBeenCalledWith("http://100.64.0.9:47821/mobile/");
    expect(fake.window.show).toHaveBeenCalled();

    // 다른 출처로는 못 간다.
    const away = { preventDefault: vi.fn() };
    fake.contents.get("will-navigate")!(away, "http://example.com/");
    expect(away.preventDefault).toHaveBeenCalledOnce();
    const stay = { preventDefault: vi.fn() };
    fake.contents.get("will-navigate")!(stay, "http://100.64.0.9:47821/mobile/#session=x");
    expect(stay.preventDefault).not.toHaveBeenCalled();
    const popup = fake.window.webContents.setWindowOpenHandler.mock.calls[0]![0] as () => { action: string };
    expect(popup()).toEqual({ action: "deny" });

    // 권한 요청과 다운로드는 모두 거부한다.
    const callback = vi.fn();
    (fake.session.setPermissionRequestHandler.mock.calls[0]![0] as Listener)({}, "media", callback);
    expect(callback).toHaveBeenCalledWith(false);
    expect((fake.session.setPermissionCheckHandler.mock.calls[0]![0] as Listener)()).toBe(false);
    const download = { preventDefault: vi.fn() };
    fake.sessionEvents.get("will-download")!(download);
    expect(download.preventDefault).toHaveBeenCalledOnce();
  });

  it("hands the token only to the host's own main frame", async () => {
    const { windows, ask } = setup();
    await windows.open("host-1");
    const channel = REMOTE_SHELL_CHANNELS.pairing;
    expect(JSON.parse(String(ask(channel, { sender: { id: 100 }, senderFrame: HOST_FRAME })))).toEqual({
      token: "tok",
      deviceId: "dev-1",
      hostName: "회사PC",
    });
    expect(ask(channel, { sender: { id: 100 }, senderFrame: { url: "http://evil.example/", parent: null } })).toBe("");
    expect(ask(channel, { sender: { id: 100 }, senderFrame: { ...HOST_FRAME, parent: {} } })).toBe("");
    expect(ask(channel, { sender: { id: 100 }, senderFrame: null })).toBe("");
    expect(ask(channel, { sender: { id: 999 }, senderFrame: HOST_FRAME })).toBe("");
  });

  it("refuses a host that needs pairing again", async () => {
    const { windows, createWindow } = setup(null);
    await expect(windows.open("host-1")).rejects.toThrow("다시 페어링");
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("brings the open window forward instead of opening a second one", async () => {
    const { windows, fakes, createWindow } = setup();
    await windows.open("host-1");
    await windows.open("host-1", "s2");
    expect(createWindow).toHaveBeenCalledOnce();
    expect(fakes[0]!.window.loadURL).toHaveBeenLastCalledWith("http://100.64.0.9:47821/mobile/#session=s2");
    expect(fakes[0]!.window.focus).toHaveBeenCalled();
  });

  it("clears the pairing when the page reports it was rejected", async () => {
    const { windows, fakes, onUnpaired, ask } = setup();
    await windows.open("host-1");
    ask(REMOTE_SHELL_CHANNELS.unpaired, { sender: { id: 100 }, senderFrame: { url: "http://evil.example/", parent: null } });
    expect(onUnpaired).not.toHaveBeenCalled();
    ask(REMOTE_SHELL_CHANNELS.unpaired, { sender: { id: 100 }, senderFrame: HOST_FRAME });
    expect(onUnpaired).toHaveBeenCalledWith("host-1");
    expect(fakes[0]!.window.close).toHaveBeenCalled();
    // 닫힌 창은 더 이상 토큰을 받지 못한다.
    expect(ask(REMOTE_SHELL_CHANNELS.pairing, { sender: { id: 100 }, senderFrame: HOST_FRAME })).toBe("");
  });

  it("goes back to the main window on request", async () => {
    const { windows, fakes, showMainWindow, ask } = setup();
    await windows.open("host-1");
    ask(REMOTE_SHELL_CHANNELS.back, { sender: { id: 100 }, senderFrame: HOST_FRAME });
    expect(fakes[0]!.window.close).toHaveBeenCalled();
    expect(showMainWindow).toHaveBeenCalled();
  });

  it("closes the window and says so when the host cannot be reached", async () => {
    const { windows, fakes, createWindow } = setup();
    createWindow.mockImplementationOnce(() => {
      const fake = fakeWindow(100);
      fake.window.loadURL.mockRejectedValueOnce(new Error("ERR_CONNECTION_REFUSED"));
      fakes.push(fake);
      return fake.window as unknown as BrowserWindow;
    });
    await expect(windows.open("host-1")).rejects.toThrow("호스트에 연결하지 못했습니다");
    expect(fakes[0]!.window.destroy).toHaveBeenCalled();
    expect(fakes[0]!.window.show).not.toHaveBeenCalled();
  });

  it("closes a host's window, or all of them", async () => {
    const { windows, fakes } = setup();
    await windows.open("host-1");
    windows.closeHost("host-other");
    expect(fakes[0]!.window.close).not.toHaveBeenCalled();
    windows.closeHost("host-1");
    expect(fakes[0]!.window.close).toHaveBeenCalledOnce();
    await windows.open("host-1");
    windows.closeAll();
    expect(fakes[1]!.window.close).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote-client/remote-windows.test.ts`
Expected: FAIL — `./remote-windows`를 찾지 못한다.

- [ ] **Step 3: 구현** — `src/main/remote-client/remote-windows.ts`:

```ts
import type { BrowserWindow, BrowserWindowConstructorOptions, Session } from "electron";
import { isSameOriginNavigation, secureBrowserWindow } from "../window-security";
import type { HostPairing } from "./host-registry";

/** preload(src/preload/remote-shell.ts)와 맞춘 채널. 그 파일은 electron만 import하므로 문자열을 따로 적는다. */
export const REMOTE_SHELL_CHANNELS = {
  pairing: "remote-shell:pairing",
  unpaired: "remote-shell:unpaired",
  back: "remote-shell:back",
} as const;

/** ipcMain 이벤트에서 여기서 보는 부분. */
export interface RemoteShellEvent {
  sender: { id: number };
  senderFrame: { url: string; parent: unknown } | null;
  returnValue?: unknown;
}

export interface RemoteWindowsOptions {
  createWindow(options: BrowserWindowConstructorOptions): BrowserWindow;
  ipc: { on(channel: string, listener: (event: RemoteShellEvent) => void): unknown };
  /** out/preload/remote-shell.js */
  preloadPath: string;
  pairing(hostId: string): Promise<HostPairing | null>;
  /** 호스트가 이 기기의 토큰을 거절했다. */
  onUnpaired(hostId: string): Promise<void>;
  showMainWindow(): void;
}

interface OpenWindow {
  hostId: string;
  origin: string;
  /** 브리지가 동기로 달라고 하므로 창을 열 때 만들어 둔다. */
  pairingJson: string;
  window: BrowserWindow;
}

const UNREACHABLE = "호스트에 연결하지 못했습니다. 그 PC의 앱이 켜져 있는지와 Tailscale 연결을 확인하세요";

export function remoteWindowUrl(address: string, sessionId?: string): string {
  return `http://${address}/mobile/${sessionId ? `#session=${encodeURIComponent(sessionId)}` : ""}`;
}

/**
 * 다른 PC가 서빙한 세션 화면을 띄우는 창들. 호스트마다 하나다. 그 페이지는 이 PC의 것이 아니므로
 * 샌드박스에 가두고, 자기 호스트 밖으로 못 나가게 하고, 토큰은 그 호스트의 메인 프레임에만 준다.
 */
export class RemoteWindows {
  /** webContents id → 창. */
  private readonly windows = new Map<number, OpenWindow>();
  private readonly securedSessions = new WeakSet<Session>();

  constructor(private readonly options: RemoteWindowsOptions) {
    options.ipc.on(REMOTE_SHELL_CHANNELS.pairing, (event) => {
      event.returnValue = this.trusted(event)?.pairingJson ?? "";
    });
    options.ipc.on(REMOTE_SHELL_CHANNELS.unpaired, (event) => {
      const entry = this.trusted(event);
      if (!entry) return;
      this.closeWindow(entry);
      void this.options.onUnpaired(entry.hostId).catch(() => undefined);
    });
    options.ipc.on(REMOTE_SHELL_CHANNELS.back, (event) => {
      const entry = this.trusted(event);
      if (!entry) return;
      this.closeWindow(entry);
      this.options.showMainWindow();
    });
  }

  async open(hostId: string, sessionId?: string): Promise<void> {
    const pairing = await this.options.pairing(hostId);
    if (!pairing) throw new Error("이 PC는 다시 페어링해야 합니다");
    const url = remoteWindowUrl(pairing.address, sessionId);
    const existing = [...this.windows.values()].find((entry) => entry.hostId === hostId && !entry.window.isDestroyed());
    if (existing) {
      // 같은 문서에서 해시만 바뀐다 — 웹 UI가 hashchange로 그 세션을 연다.
      if (sessionId) await existing.window.loadURL(url).catch(() => undefined);
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.show();
      existing.window.focus();
      return;
    }

    const window = this.options.createWindow({
      width: 1200,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      show: false,
      backgroundColor: "#101214",
      title: `${pairing.hostName} — 원격`,
      webPreferences: {
        preload: this.options.preloadPath,
        partition: `remote-${hostId}`,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });
    const contents = window.webContents;
    const id = contents.id;
    const origin = new URL(url).origin;
    this.windows.set(id, {
      hostId,
      origin,
      pairingJson: JSON.stringify({ token: pairing.token, deviceId: pairing.deviceId, hostName: pairing.hostName }),
      window,
    });
    window.on("closed", () => this.windows.delete(id));
    // 어느 PC의 창인지가 제목이다 — 페이지의 <title>이 덮어쓰지 못하게 한다.
    window.on("page-title-updated", (event) => event.preventDefault());
    secureBrowserWindow(window, origin, isSameOriginNavigation);
    this.secureSession(contents.session);

    try {
      await window.loadURL(url);
    } catch {
      window.destroy();
      this.windows.delete(id);
      throw new Error(UNREACHABLE);
    }
    window.show();
  }

  closeHost(hostId: string): void {
    for (const entry of [...this.windows.values()]) {
      if (entry.hostId === hostId) this.closeWindow(entry);
    }
  }

  closeAll(): void {
    for (const entry of [...this.windows.values()]) this.closeWindow(entry);
  }

  private closeWindow(entry: OpenWindow): void {
    if (!entry.window.isDestroyed()) entry.window.close();
  }

  /** 요청한 쪽이 열려 있는 원격 창의 메인 프레임이고, 그 창에 등록된 호스트 출처일 때만 창을 돌려준다. */
  private trusted(event: RemoteShellEvent): OpenWindow | null {
    const entry = this.windows.get(event.sender.id);
    const frame = event.senderFrame;
    if (!entry || !frame || frame.parent !== null) return null;
    try {
      return new URL(frame.url).origin === entry.origin ? entry : null;
    } catch {
      return null;
    }
  }

  private secureSession(session: Session): void {
    if (this.securedSessions.has(session)) return;
    this.securedSessions.add(session);
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    // 호스트는 /shell.apk도 서빙한다 — 이 창에서는 아무것도 내려받지 않는다.
    session.on("will-download", (event) => event.preventDefault());
  }
}
```

`src/preload/remote-shell.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";

// 다른 PC가 서빙한 페이지에 심는 셸 브리지. Android 셸(McwShellBridge.kt)과 같은 계약이고,
// 웹 UI는 src/renderer/src/mobile/shell-bridge.ts로 읽는다. 토큰을 줄지는 main이 요청한 프레임의
// 출처를 보고 정한다(remote-windows.ts) — 여기서는 묻기만 한다.
// 이 파일은 electron 말고 아무것도 import하지 않는다: sandbox preload는 분리된 청크를 불러올 수 없다.
contextBridge.exposeInMainWorld("McwShell", {
  bridgeVersion: () => 1,
  pairingJson: () => {
    const value: unknown = ipcRenderer.sendSync("remote-shell:pairing");
    return typeof value === "string" ? value : "";
  },
  unpaired: () => ipcRenderer.send("remote-shell:unpaired"),
  backToHosts: () => ipcRenderer.send("remote-shell:back"),
});
```

`electron.vite.config.ts`의 `preload` 블록:

```ts
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          // 원격 창(다른 PC가 서빙한 페이지)에 심는 셸 브리지.
          "remote-shell": resolve("src/preload/remote-shell.ts"),
        },
      },
    },
  },
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/main/remote-client/remote-windows.test.ts`
Expected: PASS (8 tests)

Run: `npm run build`
Expected: 성공. `Get-ChildItem out/preload`에 `index.js`와 `remote-shell.js` 두 파일만 있다(공유 청크 디렉터리가 생기지 않았다). `Select-String -Path out/preload/remote-shell.js -Pattern 'require\("\.'`의 결과가 없다.

- [ ] **Step 5: 커밋**

```powershell
git add src/main/remote-client/remote-windows.ts src/main/remote-client/remote-windows.test.ts src/preload/remote-shell.ts electron.vite.config.ts
git commit -m @'
feat: open a remote host's sessions in a sandboxed window

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
'@
```

---

### Task 5: 서비스·IPC·preload API·runtime 배선

**Files:**
- Create: `src/main/remote-client/remote-hosts-service.ts`, `src/main/remote-client/remote-hosts-service.test.ts`
- Modify: `src/main/ipc.ts` (`RemoteGateway` 아래, `MainIpcDependencies`, `remote:revoke-device` 핸들러 아래), `src/main/ipc.test.ts`
- Modify: `src/shared/api-types.ts:533-538`, `src/preload/index.ts:216-221`
- Modify: `src/main/runtime.ts` (import, 520행 뒤, `registerMainIpc` 인자, `createRetryableDisposer` 목록)
- Modify: `src/renderer/src/App.test.tsx:394-399` (하네스에 `remoteHosts` 추가)

**Interfaces:**
- Consumes: `RemoteHostRegistry`(Task 2), `parsePairInput`·`pairWithHost`·`PairTarget`(Task 3), `RemoteWindows`(Task 4), `sendToMainWindow`(Task 1)
- Produces: `createRemoteHostsService(options): { list(): Promise<RemoteHostInfo[]>; add(input: RemoteHostAddInput): Promise<RemoteHostInfo>; remove(hostId: string): Promise<void>; open(hostId: string): Promise<void>; unpaired(hostId: string): Promise<void> }`
- Produces: IPC `remote-hosts:list` · `remote-hosts:add` · `remote-hosts:remove` · `remote-hosts:open`, 이벤트 `remote-hosts:changed`(payload `RemoteHostInfo[]`)
- Produces: `window.multiCliWork.remoteHosts { list(); add(input); remove(hostId); open(hostId); onChanged(listener): () => void }`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/remote-client/remote-hosts-service.test.ts`:

```ts
// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { RemoteHostInfo } from "../../shared/remote-types";
import { createRemoteHostsService } from "./remote-hosts-service";

const INFO: RemoteHostInfo = {
  hostId: "host-1",
  name: "회사PC",
  address: "100.64.0.9:47821",
  notify: true,
  paired: true,
  addedAt: "2026-10-03T00:00:00.000Z",
};

function setup(overrides: { canStore?: boolean; pairFails?: boolean } = {}) {
  const registry = {
    canStore: vi.fn(() => overrides.canStore ?? true),
    list: vi.fn(async () => [INFO]),
    save: vi.fn(async () => INFO),
    remove: vi.fn(async () => undefined),
    clearToken: vi.fn(async () => undefined),
  };
  const windows = { open: vi.fn(async () => undefined), closeHost: vi.fn() };
  const pair = vi.fn(async () => {
    if (overrides.pairFails) throw new Error("코드가 맞지 않거나 만료되었습니다");
    return { token: "tok", deviceId: "dev-1", hostId: "host-1", hostName: "회사PC" };
  });
  const announce = vi.fn();
  const service = createRemoteHostsService({
    registry,
    windows,
    pair,
    deviceName: "내 노트북",
    allowLoopback: false,
    announce,
  });
  return { service, registry, windows, pair, announce };
}

describe("remote hosts service", () => {
  it("pairs, saves, drops the stale window, and announces", async () => {
    const { service, registry, windows, pair, announce } = setup();
    expect(await service.add({ address: "100.64.0.9:47821", code: "ABCD-EFGH" })).toEqual(INFO);
    expect(pair).toHaveBeenCalledWith({ address: "100.64.0.9:47821", code: "ABCD-EFGH", expectedHostId: null }, "내 노트북");
    expect(registry.save).toHaveBeenCalledWith({
      hostId: "host-1",
      name: "회사PC",
      address: "100.64.0.9:47821",
      deviceId: "dev-1",
      token: "tok",
    });
    expect(windows.closeHost).toHaveBeenCalledWith("host-1");
    expect(announce).toHaveBeenCalledWith([INFO]);
  });

  it("does not pair or save when the address is wrong", async () => {
    const { service, registry, pair, announce } = setup();
    await expect(service.add({ address: "192.168.0.5:47821", code: "ABCD-EFGH" })).rejects.toThrow("Tailscale 주소");
    expect(pair).not.toHaveBeenCalled();
    expect(registry.save).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it("saves nothing when the host refuses the code", async () => {
    const { service, registry, announce } = setup({ pairFails: true });
    await expect(service.add({ address: "100.64.0.9:47821", code: "WRONG" })).rejects.toThrow("코드가 맞지 않거나");
    expect(registry.save).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it("does not register a device on the host when the token could not be stored", async () => {
    const { service, pair } = setup({ canStore: false });
    await expect(service.add({ address: "100.64.0.9:47821", code: "ABCD-EFGH" })).rejects.toThrow("안전하게 저장할 수 없습니다");
    expect(pair).not.toHaveBeenCalled();
  });

  it("closes the window before removing a host", async () => {
    const { service, registry, windows, announce } = setup();
    await service.remove("host-1");
    expect(windows.closeHost).toHaveBeenCalledWith("host-1");
    expect(registry.remove).toHaveBeenCalledWith("host-1");
    expect(announce).toHaveBeenCalledOnce();
  });

  it("opens a host and marks a rejected one", async () => {
    const { service, registry, windows, announce } = setup();
    await service.open("host-1");
    expect(windows.open).toHaveBeenCalledWith("host-1");
    await service.unpaired("host-1");
    expect(registry.clearToken).toHaveBeenCalledWith("host-1");
    expect(announce).toHaveBeenCalledOnce();
  });
});
```

`src/main/ipc.test.ts` — `setup` 안 `remoteGateway` 아래에 mock을 만들고, `registerMainIpc` 인자에 `remoteHosts: remoteHostsGateway,`를, 반환 객체에 `remoteHostsGateway,`를 더한다:

```ts
  const remoteHostsGateway = {
    list: vi.fn(async () => []),
    add: vi.fn(async (_input: unknown) => ({ hostId: "h1" })),
    remove: vi.fn(async (_hostId: string) => undefined),
    open: vi.fn(async (_hostId: string) => undefined),
  };
```

테스트 추가:

```ts
  it("validates remote host requests", async () => {
    const { handlers, remoteHostsGateway } = setup();
    expect(await handlers.get("remote-hosts:list")!({})).toEqual([]);
    await handlers.get("remote-hosts:add")!({}, { address: "100.64.0.9:47821", code: "ABCD-EFGH", extra: 1 });
    expect(remoteHostsGateway.add).toHaveBeenLastCalledWith({ address: "100.64.0.9:47821", code: "ABCD-EFGH" });
    await handlers.get("remote-hosts:add")!({}, { uri: "mcw://pair?host=h&code=c&fp=f" });
    expect(remoteHostsGateway.add).toHaveBeenLastCalledWith({ uri: "mcw://pair?host=h&code=c&fp=f" });
    await expect(handlers.get("remote-hosts:add")!({}, { address: "100.64.0.9:47821" })).rejects.toThrow(/Pairing code/);
    await expect(handlers.get("remote-hosts:add")!({}, "nope")).rejects.toThrow(/Remote host/);
    await handlers.get("remote-hosts:open")!({}, "h1");
    expect(remoteHostsGateway.open).toHaveBeenCalledWith("h1");
    await handlers.get("remote-hosts:remove")!({}, "h1");
    expect(remoteHostsGateway.remove).toHaveBeenCalledWith("h1");
    expect(() => handlers.get("remote-hosts:remove")!({}, "")).toThrow(/Host id/);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote-client/remote-hosts-service.test.ts src/main/ipc.test.ts`
Expected: FAIL — 서비스 모듈이 없고 `remote-hosts:*` 핸들러가 등록되지 않았다.

- [ ] **Step 3: 구현** — `src/main/remote-client/remote-hosts-service.ts`:

```ts
import type { RemoteHostAddInput, RemoteHostInfo, RemotePairResponse } from "../../shared/remote-types";
import type { NewRemoteHost } from "./host-registry";
import { parsePairInput, type PairTarget } from "./pair-host";

export interface RemoteHostsServiceOptions {
  registry: {
    canStore(): boolean;
    list(): Promise<RemoteHostInfo[]>;
    save(input: NewRemoteHost): Promise<RemoteHostInfo>;
    remove(hostId: string): Promise<void>;
    clearToken(hostId: string): Promise<void>;
  };
  windows: {
    open(hostId: string, sessionId?: string): Promise<void>;
    closeHost(hostId: string): void;
  };
  pair(target: PairTarget, deviceName: string): Promise<RemotePairResponse>;
  /** 호스트의 기기 목록에 보일 이 PC의 이름. */
  deviceName: string;
  allowLoopback: boolean;
  /** 목록이 바뀔 때마다 메인 창에 알린다. */
  announce(hosts: RemoteHostInfo[]): void;
}

/** 이 PC가 클라이언트로서 다른 PC를 등록·삭제·여는 흐름. 저장은 레지스트리, 창은 RemoteWindows가 맡는다. */
export function createRemoteHostsService(options: RemoteHostsServiceOptions) {
  const announce = async () => options.announce(await options.registry.list());
  return {
    list: () => options.registry.list(),

    async add(input: RemoteHostAddInput): Promise<RemoteHostInfo> {
      // 저장할 수 없는 환경이면 호스트에 기기를 등록시키기 전에 멈춘다.
      if (!options.registry.canStore()) throw new Error("이 환경에서는 토큰을 안전하게 저장할 수 없습니다");
      const target = parsePairInput(input, { allowLoopback: options.allowLoopback });
      const paired = await options.pair(target, options.deviceName);
      const info = await options.registry.save({
        hostId: paired.hostId,
        name: paired.hostName,
        address: target.address,
        deviceId: paired.deviceId,
        token: paired.token,
      });
      // 열려 있던 창은 옛 토큰을 들고 있다.
      options.windows.closeHost(paired.hostId);
      await announce();
      return info;
    },

    async remove(hostId: string): Promise<void> {
      options.windows.closeHost(hostId);
      await options.registry.remove(hostId);
      await announce();
    },

    open: (hostId: string) => options.windows.open(hostId),

    /** 호스트가 토큰을 거절했다(원격 창의 브리지가 알린다). */
    async unpaired(hostId: string): Promise<void> {
      await options.registry.clearToken(hostId);
      await announce();
    },
  };
}
```

`src/main/ipc.ts` — `../shared/remote-types` import에 `RemoteHostAddInput, RemoteHostInfo`를 더하고, `RemoteGateway` 아래에:

```ts
/** 이 PC가 클라이언트로서 붙는 다른 PC들. */
interface RemoteHostsGateway {
  list(): Promise<RemoteHostInfo[]>;
  add(input: RemoteHostAddInput): Promise<RemoteHostInfo>;
  remove(hostId: string): Promise<void>;
  open(hostId: string): Promise<void>;
}
```

`MainIpcDependencies`의 `remote: RemoteGateway;` 아래에 `remoteHosts: RemoteHostsGateway;`. `validateSettingsPatch` 근처(파일의 다른 `validate*` 함수 옆)에:

```ts
function validateRemoteHostAdd(value: unknown): RemoteHostAddInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Remote host request must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.uri !== undefined) return { uri: nonEmptyString(raw.uri, "Pairing link") };
  return { address: nonEmptyString(raw.address, "Host address"), code: nonEmptyString(raw.code, "Pairing code") };
}
```

`remote:revoke-device` 핸들러 아래에:

```ts
  ipc.handle("remote-hosts:list", () => dependencies.remoteHosts.list());
  // async라 잘못된 입력의 throw가 rejected invoke로 렌더러에 도달한다.
  ipc.handle("remote-hosts:add", async (_event, input: unknown) =>
    dependencies.remoteHosts.add(validateRemoteHostAdd(input)),
  );
  ipc.handle("remote-hosts:remove", (_event, hostId: unknown) =>
    dependencies.remoteHosts.remove(nonEmptyString(hostId, "Host id")),
  );
  ipc.handle("remote-hosts:open", (_event, hostId: unknown) =>
    dependencies.remoteHosts.open(nonEmptyString(hostId, "Host id")),
  );
```

`src/shared/api-types.ts` — `../shared/remote-types`(이 파일에서는 `./remote-types`) import에 `RemoteHostAddInput, RemoteHostInfo`를 더하고 `remote: { … };` 아래에:

```ts
  /** 이 PC가 클라이언트로서 등록해 둔 다른 PC. 토큰은 main에만 있다. */
  remoteHosts: {
    list(): Promise<RemoteHostInfo[]>;
    add(input: RemoteHostAddInput): Promise<RemoteHostInfo>;
    remove(hostId: string): Promise<void>;
    /** 그 PC의 세션 화면을 별도 창으로 연다. */
    open(hostId: string): Promise<void>;
    onChanged(listener: (hosts: RemoteHostInfo[]) => void): () => void;
  };
```

`src/preload/index.ts` — type import에 `import type { RemoteHostInfo } from "../shared/remote-types";`를 더하고 `remote: { … },` 아래에:

```ts
  remoteHosts: {
    list: () => ipcRenderer.invoke("remote-hosts:list"),
    add: (input) => ipcRenderer.invoke("remote-hosts:add", input),
    remove: (hostId) => ipcRenderer.invoke("remote-hosts:remove", hostId),
    open: (hostId) => ipcRenderer.invoke("remote-hosts:open", hostId),
    onChanged(listener) {
      const handler = (_event: Electron.IpcRendererEvent, hosts: RemoteHostInfo[]) => listener(hosts);
      ipcRenderer.on("remote-hosts:changed", handler);
      return () => ipcRenderer.removeListener("remote-hosts:changed", handler);
    },
  },
```

`src/renderer/src/App.test.tsx` — 하네스의 `remote: { … },` 아래에:

```ts
    remoteHosts: {
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn(() => () => undefined),
    },
```

`src/main/runtime.ts` — electron import에 `nativeImage`를 더하고, import 추가:

```ts
import { RemoteHostRegistry } from "./remote-client/host-registry";
import { pairWithHost } from "./remote-client/pair-host";
import { createRemoteHostsService } from "./remote-client/remote-hosts-service";
import { RemoteWindows } from "./remote-client/remote-windows";
import { trayIconDataUrl } from "./tray-icon";
```

`void remoteAccess.apply(settingsService.current().remote);` 아래에:

```ts
  // 이 PC가 클라이언트로서 다른 PC에 붙는 쪽. 위의 호스트 역할(remoteAccess)과는 독립이다.
  const remoteHostRegistry = new RemoteHostRegistry(path.join(userData, "remote-hosts.json"), safeStorage);
  const remoteWindows = new RemoteWindows({
    createWindow: (options) =>
      new BrowserWindow({ ...options, icon: nativeImage.createFromDataURL(trayIconDataUrl(32)) }),
    ipc: { on: (channel, listener) => ipcMain.on(channel, (event) => listener(event)) },
    preloadPath: path.join(__dirname, "../preload/remote-shell.js"),
    pairing: (hostId) => remoteHostRegistry.pairing(hostId),
    onUnpaired: (hostId) => remoteHosts.unpaired(hostId),
    showMainWindow,
  });
  const remoteHosts = createRemoteHostsService({
    registry: remoteHostRegistry,
    windows: remoteWindows,
    pair: (target, deviceName) => pairWithHost(target, deviceName),
    deviceName: os.hostname(),
    // 서버를 loopback에 띄우는 e2e·개발 실행에서만 loopback 호스트를 받는다.
    allowLoopback: Boolean(process.env.MULTI_CLI_WORK_REMOTE_BIND),
    announce: (hosts) => sendToMainWindow(host.getMainWindow(), "remote-hosts:changed", hosts),
  });
```

`registerMainIpc` 인자에(`remote: …` 옆):

```ts
    remoteHosts: {
      list: () => remoteHosts.list(),
      add: (input) => remoteHosts.add(input),
      remove: (hostId) => remoteHosts.remove(hostId),
      open: (hostId) => remoteHosts.open(hostId),
    },
```

`createRetryableDisposer([ … ])` 목록에서 `() => remoteAccess.dispose(),` 위에:

```ts
    () => remoteWindows.closeAll(),
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/main/remote-client src/main/ipc.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: 오류 없음.

- [ ] **Step 5: 커밋**

```powershell
git add src/main/remote-client/remote-hosts-service.ts src/main/remote-client/remote-hosts-service.test.ts src/main/ipc.ts src/main/ipc.test.ts src/shared/api-types.ts src/preload/index.ts src/main/runtime.ts src/renderer/src/App.test.tsx
git commit -m @'
feat: wire remote hosts into the main process and preload API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
'@
```

---

### Task 6: 설정 "원격" 탭과 사이드바 "원격 PC"

**Files:**
- Create: `src/renderer/src/RemoteHostsSettings.tsx`, `src/renderer/src/RemoteHostsSettings.test.tsx`
- Create: `src/renderer/src/RemoteHostsSection.tsx`, `src/renderer/src/RemoteHostsSection.test.tsx`
- Modify: `src/renderer/src/RemoteSettings.tsx`, `src/renderer/src/RemoteSettings.test.tsx:25, 31`
- Modify: `src/renderer/src/SettingsDialog.tsx:32-41, 51, 72-75, 514-515`, `src/renderer/src/SettingsDialog.test.tsx:281-287`
- Modify: `src/renderer/src/ProjectSidebar.tsx:70, 274, 1396`, `src/renderer/src/App.tsx:356, 3028, 3576`
- Modify: `src/renderer/src/index.css`
- Modify: `src/renderer/src/mobile/PairScreen.tsx:23`, `src/main/remote/remote-server.ts:123`, `src/main/remote/remote-access.ts:58`

**Interfaces:**
- Consumes: `window.multiCliWork.remoteHosts`(Task 5), `RemoteHostInfo`·`RemoteHostAddInput`(Task 2)
- Produces: `<RemoteHostsSettings />`, `<RemoteHostsSection onOpenSettings={() => void} />`, `SettingsDialog`의 `initialTab?: SettingsTab` prop과 `export type SettingsTab`, `ProjectSidebar`의 `onOpenRemoteSettings(): void` prop

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/src/RemoteHostsSettings.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteHostInfo } from "@shared/remote-types";
import { RemoteHostsSettings } from "./RemoteHostsSettings";

const OFFICE: RemoteHostInfo = { hostId: "h1", name: "회사PC", address: "100.64.0.9:47821", notify: true, paired: true, addedAt: "" };
const HOME: RemoteHostInfo = { hostId: "h2", name: "집PC", address: "100.64.0.7:47821", notify: true, paired: false, addedAt: "" };

let changed: ((hosts: RemoteHostInfo[]) => void) | null = null;
const remoteHosts = {
  list: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  open: vi.fn(),
  onChanged: vi.fn((listener: (hosts: RemoteHostInfo[]) => void) => {
    changed = listener;
    return () => undefined;
  }),
};

afterEach(cleanup);

beforeEach(() => {
  remoteHosts.list.mockResolvedValue([OFFICE, HOME]);
  remoteHosts.add.mockResolvedValue(OFFICE);
  remoteHosts.remove.mockResolvedValue(undefined);
  remoteHosts.open.mockResolvedValue(undefined);
  (window as unknown as { multiCliWork: unknown }).multiCliWork = { remoteHosts };
});

describe("RemoteHostsSettings", () => {
  it("lists hosts and marks the one that needs pairing again", async () => {
    render(<RemoteHostsSettings />);
    expect(await screen.findByText("회사PC")).toBeInTheDocument();
    expect(screen.getByText(/다시 페어링 필요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "집PC 열기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "회사PC 열기" }));
    expect(remoteHosts.open).toHaveBeenCalledWith("h1");
  });

  it("adds a host by address and code", async () => {
    render(<RemoteHostsSettings />);
    const add = screen.getByRole("button", { name: "PC 추가" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("페어링 링크 또는 주소"), { target: { value: "100.64.0.9:47821" } });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("페어링 코드"), { target: { value: "ABCD-EFGH" } });
    fireEvent.click(add);
    await waitFor(() => expect(remoteHosts.add).toHaveBeenCalledWith({ address: "100.64.0.9:47821", code: "ABCD-EFGH" }));
    await waitFor(() => expect(screen.getByLabelText("페어링 링크 또는 주소")).toHaveValue(""));
  });

  it("adds a host by pairing link without a code", async () => {
    render(<RemoteHostsSettings />);
    const link = "mcw://pair?host=100.64.0.9:47821&name=PC&code=ABCDEFGH&fp=h1";
    fireEvent.change(screen.getByLabelText("페어링 링크 또는 주소"), { target: { value: link } });
    expect(screen.getByLabelText("페어링 코드")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "PC 추가" }));
    await waitFor(() => expect(remoteHosts.add).toHaveBeenCalledWith({ uri: link }));
  });

  it("shows why adding failed and keeps what was typed", async () => {
    remoteHosts.add.mockRejectedValue(new Error("Error invoking remote method 'remote-hosts:add': Error: 코드가 맞지 않거나 만료되었습니다"));
    render(<RemoteHostsSettings />);
    fireEvent.change(screen.getByLabelText("페어링 링크 또는 주소"), { target: { value: "100.64.0.9:47821" } });
    fireEvent.change(screen.getByLabelText("페어링 코드"), { target: { value: "WRONG" } });
    fireEvent.click(screen.getByRole("button", { name: "PC 추가" }));
    expect(await screen.findByText(/코드가 맞지 않거나 만료되었습니다/)).toBeInTheDocument();
    expect(screen.getByLabelText("페어링 코드")).toHaveValue("WRONG");
  });

  it("removes a host and follows changes from main", async () => {
    render(<RemoteHostsSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "회사PC 삭제" }));
    expect(remoteHosts.remove).toHaveBeenCalledWith("h1");
    changed!([HOME]);
    await waitFor(() => expect(screen.queryByText("회사PC")).not.toBeInTheDocument());
  });
});
```

`src/renderer/src/RemoteHostsSection.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteHostInfo } from "@shared/remote-types";
import { RemoteHostsSection } from "./RemoteHostsSection";

const OFFICE: RemoteHostInfo = { hostId: "h1", name: "회사PC", address: "100.64.0.9:47821", notify: true, paired: true, addedAt: "" };
const HOME: RemoteHostInfo = { hostId: "h2", name: "집PC", address: "100.64.0.7:47821", notify: true, paired: false, addedAt: "" };

const remoteHosts = {
  list: vi.fn(),
  open: vi.fn(),
  onChanged: vi.fn(() => () => undefined),
};

afterEach(cleanup);

beforeEach(() => {
  remoteHosts.list.mockResolvedValue([OFFICE, HOME]);
  remoteHosts.open.mockResolvedValue(undefined);
  (window as unknown as { multiCliWork: unknown }).multiCliWork = { remoteHosts };
});

describe("RemoteHostsSection", () => {
  it("draws nothing when no host is registered", async () => {
    remoteHosts.list.mockResolvedValue([]);
    const { container } = render(<RemoteHostsSection onOpenSettings={vi.fn()} />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a paired host's window", async () => {
    render(<RemoteHostsSection onOpenSettings={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /회사PC/ }));
    expect(remoteHosts.open).toHaveBeenCalledWith("h1");
  });

  it("sends a host that needs pairing again to the settings", async () => {
    const onOpenSettings = vi.fn();
    render(<RemoteHostsSection onOpenSettings={onOpenSettings} />);
    fireEvent.click(await screen.findByRole("button", { name: /집PC/ }));
    expect(screen.getByText("다시 페어링 필요")).toBeInTheDocument();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(remoteHosts.open).not.toHaveBeenCalled();
  });

  it("says why a host could not be opened", async () => {
    remoteHosts.open.mockRejectedValue(new Error("Error invoking remote method 'remote-hosts:open': Error: 호스트에 연결하지 못했습니다"));
    render(<RemoteHostsSection onOpenSettings={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /회사PC/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("호스트에 연결하지 못했습니다");
  });
});
```

`src/renderer/src/RemoteSettings.test.tsx` — 25행의 mock에 `remoteHosts`를 더하고 31행의 문구를 바꾼다:

```tsx
  (window as unknown as { multiCliWork: unknown }).multiCliWork = {
    remote,
    settings: { update },
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    remoteHosts: { list: vi.fn().mockResolvedValue([]), onChanged: vi.fn(() => () => undefined) },
  };
```

```tsx
    fireEvent.click(screen.getByRole("checkbox", { name: "원격 접속 허용" }));
```

같은 파일에 테스트 추가:

```tsx
  it("copies the pairing link for another PC", async () => {
    render(<RemoteSettings settings={{ ...DEFAULT_SETTINGS, remote: { enabled: true, port: 47821 } }} />);
    fireEvent.click(await screen.findByRole("button", { name: "기기 추가" }));
    fireEvent.click(await screen.findByRole("button", { name: "페어링 링크 복사" }));
    const api = (window as unknown as { multiCliWork: { clipboard: { writeText: ReturnType<typeof vi.fn> } } }).multiCliWork;
    expect(api.clipboard.writeText).toHaveBeenCalledWith("mcw://pair?host=100.64.0.9:47821&name=PC&code=ABCDEFGH&fp=h");
  });
```

`src/renderer/src/SettingsDialog.test.tsx:281-287`을 바꾼다(이 파일이 `window.multiCliWork`를 만드는 곳에 `remoteHosts: { list: vi.fn().mockResolvedValue([]), onChanged: vi.fn(() => () => undefined) }`도 더한다):

```tsx
describe("원격 탭", () => {
  it("원격 접속 설정을 보여 준다", async () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "원격" }));
    expect(screen.getByLabelText("원격 접속 허용")).not.toBeChecked();
    expect(await screen.findByText("꺼짐")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "다른 PC에 접속" })).toBeInTheDocument();
  });

  it("처음부터 원격 탭으로 열 수 있다", () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} initialTab="mobile" onClose={() => undefined} />);
    expect(screen.getByLabelText("원격 접속 허용")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/renderer/src/RemoteHostsSettings.test.tsx src/renderer/src/RemoteHostsSection.test.tsx src/renderer/src/RemoteSettings.test.tsx src/renderer/src/SettingsDialog.test.tsx`
Expected: FAIL — 새 컴포넌트가 없고, 문구와 `initialTab`이 아직 없다.

- [ ] **Step 3: 구현** — `src/renderer/src/RemoteHostsSettings.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { RemoteHostAddInput, RemoteHostInfo } from "@shared/remote-types";
import { errorMessage } from "./ipc-error";

const isPairingLink = (value: string) => value.trim().toLowerCase().startsWith("mcw://");

function toAddInput(target: string, code: string): RemoteHostAddInput {
  const trimmed = target.trim();
  return isPairingLink(trimmed) ? { uri: trimmed } : { address: trimmed, code: code.trim() };
}

/**
 * 설정 ▸ 원격의 "다른 PC에 접속". 이 PC가 클라이언트로서 등록해 둔 호스트 목록이다. 토큰은 main에만
 * 있고 여기로는 오지 않는다 — 화면은 "페어링됨/다시 필요"만 안다.
 */
export function RemoteHostsSettings() {
  const [hosts, setHosts] = useState<RemoteHostInfo[]>([]);
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.multiCliWork.remoteHosts
      .list()
      .then(setHosts)
      .catch((cause: unknown) => setError(errorMessage(cause)));
    return window.multiCliWork.remoteHosts.onChanged(setHosts);
  }, []);

  const link = isPairingLink(target);
  const canAdd = !busy && target.trim().length > 0 && (link || code.trim().length > 0);

  const run = (action: Promise<unknown>) => {
    setError(null);
    action.catch((cause: unknown) => setError(errorMessage(cause)));
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    window.multiCliWork.remoteHosts
      .add(toAddInput(target, code))
      .then(() => {
        setTarget("");
        setCode("");
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <h3>다른 PC에 접속</h3>
      <p className="settings-hint">
        그 PC의 설정 ▸ 원격 ▸ 기기 추가에서 복사한 페어링 링크를 붙여 넣거나, 그 PC의 접속 주소와 코드를 입력합니다.
      </p>
      <form className="settings-remote-host-form" onSubmit={add}>
        <input
          type="text"
          aria-label="페어링 링크 또는 주소"
          placeholder="mcw://pair?… 또는 100.x.y.z:47821"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
        <input
          type="text"
          aria-label="페어링 코드"
          placeholder="코드"
          value={link ? "" : code}
          disabled={link}
          onChange={(event) => setCode(event.target.value)}
        />
        <button type="submit" disabled={!canAdd}>
          PC 추가
        </button>
      </form>
      {hosts.length === 0 ? <p className="settings-hint">등록된 PC가 없습니다.</p> : null}
      {hosts.map((host) => (
        <div className="settings-row" key={host.hostId}>
          <span>
            {host.name}
            <small className="settings-hint">
              {" "}
              · {host.address}
              {host.paired ? "" : " · 다시 페어링 필요"}
            </small>
          </span>
          <span className="settings-remote-host-actions">
            <button
              type="button"
              aria-label={`${host.name} 열기`}
              disabled={!host.paired}
              onClick={() => run(window.multiCliWork.remoteHosts.open(host.hostId))}
            >
              열기
            </button>
            <button
              type="button"
              aria-label={`${host.name} 삭제`}
              onClick={() => run(window.multiCliWork.remoteHosts.remove(host.hostId))}
            >
              삭제
            </button>
          </span>
        </div>
      ))}
      {error ? <p className="settings-error">{error}</p> : null}
    </>
  );
}
```

`src/renderer/src/RemoteHostsSection.tsx`:

```tsx
import type { RemoteHostInfo } from "@shared/remote-types";
import { Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage } from "./ipc-error";

/**
 * 사이드바의 "원격 PC". 등록해 둔 다른 PC를 누르면 그 PC의 세션 화면이 별도 창으로 열린다. 등록은
 * 설정 ▸ 원격에서 한다 — 하나도 없으면 이 섹션은 그려지지 않는다.
 */
export function RemoteHostsSection({ onOpenSettings }: { onOpenSettings(): void }) {
  const [hosts, setHosts] = useState<RemoteHostInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.multiCliWork.remoteHosts.list().then(setHosts).catch(() => undefined);
    return window.multiCliWork.remoteHosts.onChanged(setHosts);
  }, []);

  if (hosts.length === 0) return null;

  const open = (host: RemoteHostInfo) => {
    if (!host.paired) {
      onOpenSettings();
      return;
    }
    setError(null);
    window.multiCliWork.remoteHosts.open(host.hostId).catch((cause: unknown) => setError(errorMessage(cause)));
  };

  return (
    <section className="remote-hosts" aria-label="원격 PC">
      <h2>원격 PC</h2>
      {hosts.map((host) => (
        <button type="button" className="remote-host" key={host.hostId} title={host.address} onClick={() => open(host)}>
          <Monitor size={13} aria-hidden="true" />
          <span className="remote-host-name">{host.name}</span>
          {host.paired ? null : <span className="remote-host-note">다시 페어링 필요</span>}
        </button>
      ))}
      {error ? (
        <p className="remote-host-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
```

`src/renderer/src/RemoteSettings.tsx` — import에 `import { RemoteHostsSettings } from "./RemoteHostsSettings";`를 더하고, 파일 머리 주석의 "모바일 연결 탭"을 "원격 탭"으로 바꾼 뒤, `return` 안의 해당 부분을 아래처럼 바꾼다.

제목·안내·켜기 줄(85-97행):

```tsx
      <h2>원격</h2>
      <p className="settings-hint">
        Tailscale로 묶인 휴대폰이나 다른 PC에서 이 PC의 세션을 보고 입력합니다. 서버는 Tailscale 주소(100.x)에서만 열립니다.
      </p>
      <h3>이 PC에 접속 허용</h3>
      <div className="settings-row">
        <label htmlFor="settings-remote-enabled">원격 접속 허용</label>
        <input
          id="settings-remote-enabled"
          type="checkbox"
          checked={settings.remote.enabled}
          onChange={(event) => save({ enabled: event.target.checked })}
        />
      </div>
```

주소 줄의 라벨(114행) `폰에서 열 주소` → `접속 주소`.

페어링 안내 문단(137-140행)을 바꾸고 복사 버튼을 더한다:

```tsx
          <p className="settings-hint">
            브라우저로 쓸 때는 <code>{pairing.url}</code>에서 코드 <strong>{pairing.code}</strong>를 입력합니다.{" "}
            {new Date(pairing.expiresAt).toLocaleTimeString("ko-KR")}까지 한 번만 쓸 수 있습니다.
          </p>
          <p className="settings-hint">
            다른 PC에서는 설정 ▸ 원격 ▸ PC 추가에 아래 링크를 붙여 넣거나, 위 주소와 코드를 입력합니다.{" "}
            <button
              type="button"
              onClick={() => {
                window.multiCliWork.clipboard
                  .writeText(pairing.pairUri)
                  .catch((cause: unknown) => setError(errorMessage(cause)));
              }}
            >
              페어링 링크 복사
            </button>
          </p>
```

마지막 `{error ? … : null}` 줄 아래, 닫는 `</>` 위에:

```tsx
      <RemoteHostsSettings />
```

`src/renderer/src/SettingsDialog.tsx`:

```tsx
// 32행: 다른 파일이 탭을 지정해 열 수 있게 내보낸다.
export type SettingsTab =
```

```tsx
// 51행
  { id: "mobile", label: "원격" },
```

```tsx
// 72-75행
interface SettingsDialogProps {
  settings: AppSettings;
  onClose(): void;
  /** 사이드바의 "다시 페어링 필요"처럼 특정 탭으로 바로 열 때. */
  initialTab?: SettingsTab;
}
```

```tsx
// 514-515행
export function SettingsDialog({ settings, onClose, initialTab }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? "general");
```

`src/renderer/src/ProjectSidebar.tsx` — import에 `import { RemoteHostsSection } from "./RemoteHostsSection";`, `ProjectSidebarProps`에 아래 필드를 더하고 구조 분해 인자에도 `onOpenRemoteSettings`를 넣는다:

```tsx
  /** 원격 PC를 다시 페어링해야 할 때 설정의 "원격" 탭을 연다. */
  onOpenRemoteSettings(): void;
```

1396행 `<UpdateBadge />` 바로 위에:

```tsx
      <RemoteHostsSection onOpenSettings={onOpenRemoteSettings} />
```

`src/renderer/src/App.tsx` — import에 `type SettingsTab`을 더한다(`import { SettingsDialog, type SettingsTab } from "./SettingsDialog";`). 356행 아래에:

```tsx
  /** 설정을 특정 탭으로 열 때만 값이 있다. */
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
```

`<ProjectSidebar` 호출(3028행)에 prop 추가:

```tsx
        onOpenRemoteSettings={() => {
          setSettingsTab("mobile");
          setSettingsOpen(true);
        }}
```

3576행:

```tsx
      {settingsOpen ? (
        <SettingsDialog
          settings={appSettings}
          initialTab={settingsTab}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsTab(undefined);
          }}
        />
      ) : null}
```

`src/renderer/src/index.css` — `.settings-remote-pairing figcaption` 줄 아래에:

```css
.settings-remote-host-form { display: flex; gap: 8px; align-items: center; margin: 4px 0 10px; }
.settings-remote-host-form input { flex: 1 1 auto; min-width: 0; padding: 5px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface-raised); color: var(--text); font: var(--type-secondary); }
.settings-remote-host-form input[aria-label="페어링 코드"] { flex: 0 0 120px; }
.settings-remote-host-form input:disabled { opacity: 0.5; }
.settings-remote-host-form button { flex: 0 0 auto; white-space: nowrap; }
.settings-remote-host-actions { display: flex; flex: 0 0 auto; gap: 6px; }
```

`.update-badge {` 규칙 위에:

```css
.remote-hosts {
  display: grid;
  gap: 2px;
  padding: 7px 8px;
  border-top: 1px solid var(--line);
}

.remote-hosts h2 {
  margin: 0 4px 2px;
  color: var(--quiet);
  font-size: var(--type-caption-size);
  font-weight: 600;
}

.remote-host {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding: 4px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  font-size: var(--type-secondary-size);
  text-align: left;
  cursor: pointer;
}

.remote-host:hover {
  background: var(--surface-raised);
}

.remote-host svg {
  flex: 0 0 auto;
}

.remote-host-name {
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remote-host-note,
.remote-host-error {
  margin: 0;
  color: var(--quiet);
  font-size: var(--type-caption-size);
  white-space: nowrap;
}

.remote-host-note {
  margin-left: auto;
}

.project-sidebar.collapsed .remote-hosts {
  display: none;
}
```

문구 세 곳:

- `src/renderer/src/mobile/PairScreen.tsx:23` → `<p>PC의 설정 ▸ 원격 ▸ 기기 추가에 나온 코드를 입력하세요.</p>`
- `src/main/remote/remote-server.ts:123` → `PC의 설정 ▸ 원격 ▸ 기기 추가 QR을 찍습니다.`
- `src/main/remote/remote-access.ts:58` → `throw new Error("원격 접속이 켜져 있지 않습니다");`

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/renderer/src/RemoteHostsSettings.test.tsx src/renderer/src/RemoteHostsSection.test.tsx src/renderer/src/RemoteSettings.test.tsx src/renderer/src/SettingsDialog.test.tsx src/renderer/src/App.test.tsx src/main/remote`
Expected: PASS

Run: `npm run typecheck`
Expected: 오류 없음.

- [ ] **Step 5: 커밋**

```powershell
git add src/renderer/src/RemoteHostsSettings.tsx src/renderer/src/RemoteHostsSettings.test.tsx src/renderer/src/RemoteHostsSection.tsx src/renderer/src/RemoteHostsSection.test.tsx src/renderer/src/RemoteSettings.tsx src/renderer/src/RemoteSettings.test.tsx src/renderer/src/SettingsDialog.tsx src/renderer/src/SettingsDialog.test.tsx src/renderer/src/ProjectSidebar.tsx src/renderer/src/App.tsx src/renderer/src/index.css src/renderer/src/mobile/PairScreen.tsx src/main/remote/remote-server.ts src/main/remote/remote-access.ts
git commit -m @'
feat: register remote PCs in settings and open them from the sidebar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
'@
```

---

### Task 7: 웹 UI 넓은 화면 2단과 해시 딥링크

**Files:**
- Create: `src/renderer/src/mobile/wide-layout.ts`, `src/renderer/src/mobile/wide-layout.test.ts`
- Create: `src/renderer/src/mobile/MobileApp.test.tsx`
- Modify: `src/renderer/src/mobile/MobileApp.tsx:26-104`, `src/renderer/src/mobile/SessionList.tsx:23-57`, `src/renderer/src/mobile/SessionScreen.tsx:11-16`, `src/renderer/src/mobile/mobile.css`

**Interfaces:**
- Produces: `WIDE_LAYOUT_QUERY = "(min-width: 900px) and (pointer: fine)"`, `useWideLayout(): boolean`, `sessionIdFromHash(hash: string): string | null`
- Produces: `SessionList`의 `activeSessionId?: string | null` prop, `SessionScreen`의 `wide?: boolean` prop(이 태스크에서는 받기만 한다 — 동작은 Task 8)

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/src/mobile/wide-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sessionIdFromHash, WIDE_LAYOUT_QUERY } from "./wide-layout";

describe("wide layout", () => {
  it("is for a wide screen with a mouse", () => {
    expect(WIDE_LAYOUT_QUERY).toBe("(min-width: 900px) and (pointer: fine)");
  });

  it("reads the session a link points at", () => {
    expect(sessionIdFromHash("#session=abc-123")).toBe("abc-123");
    expect(sessionIdFromHash("#session=a%20b")).toBe("a b");
    expect(sessionIdFromHash("#other=1&session=s2")).toBe("s2");
    expect(sessionIdFromHash("")).toBeNull();
    expect(sessionIdFromHash("#session=")).toBeNull();
    expect(sessionIdFromHash("#terminal")).toBeNull();
  });
});
```

`src/renderer/src/mobile/MobileApp.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { MobileApp } from "./MobileApp";

// 터미널(xterm)은 jsdom에서 그려지지 않는다 — 어떤 세션이 어떤 모드로 열렸는지만 본다.
vi.mock("./SessionScreen", () => ({
  SessionScreen: ({ session, wide }: { session: RemoteSessionSummary; wide?: boolean }) => (
    <div data-testid="screen" data-wide={String(Boolean(wide))}>
      {session.label}
    </div>
  ),
}));

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(): void {}
  close(): void {}
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const SESSIONS: RemoteSessionSummary[] = [
  { id: "s1", projectId: "p", projectName: "A", kind: "claude", label: "리팩터", status: "working", updatedAt: "2" },
  { id: "s2", projectId: "p", projectName: "A", kind: "codex", label: "테스트", status: "idle", updatedAt: "1" },
];

function useScreen(wide: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function connect() {
  act(() => {
    FakeSocket.last!.onopen?.();
    FakeSocket.last!.receive({ type: "welcome", hostId: "h", hostName: "회사PC", deviceId: "d", protocolVersion: 1, shellLatest: null });
    FakeSocket.last!.receive({ type: "sessions", sessions: SESSIONS });
  });
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  (window as unknown as { McwShell: unknown }).McwShell = {
    bridgeVersion: () => 1,
    pairingJson: () => JSON.stringify({ token: "t", deviceId: "d", hostName: "회사PC" }),
    unpaired: vi.fn(),
    backToHosts: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { McwShell?: unknown }).McwShell;
  window.location.hash = "";
});

describe("MobileApp", () => {
  it("keeps the list beside the open session on a wide screen", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    expect(screen.getByText("왼쪽에서 세션을 고르세요")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
    expect(screen.getByTestId("screen")).toHaveTextContent("리팩터");
    expect(screen.getByTestId("screen")).toHaveAttribute("data-wide", "true");
    expect(screen.getByRole("button", { name: /테스트/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /리팩터/ })).toHaveAttribute("aria-current", "true");
  });

  it("replaces the list with the session on a narrow screen", () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
    expect(screen.getByTestId("screen")).toHaveAttribute("data-wide", "false");
    expect(screen.queryByRole("button", { name: /테스트/ })).not.toBeInTheDocument();
  });

  it("opens the session a link points at, and follows a new link", () => {
    useScreen(true);
    window.location.hash = "#session=s2";
    render(<MobileApp />);
    connect();
    expect(screen.getByTestId("screen")).toHaveTextContent("테스트");
    act(() => {
      window.location.hash = "#session=s1";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByTestId("screen")).toHaveTextContent("리팩터");
  });

  it("shows the list when the linked session does not exist", () => {
    useScreen(false);
    window.location.hash = "#session=gone";
    render(<MobileApp />);
    connect();
    expect(screen.queryByTestId("screen")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /리팩터/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/renderer/src/mobile/wide-layout.test.ts src/renderer/src/mobile/MobileApp.test.tsx`
Expected: FAIL — `./wide-layout`이 없고, 넓은 화면에서 목록이 사라진다.

- [ ] **Step 3: 구현** — `src/renderer/src/mobile/wide-layout.ts`:

```ts
import { useEffect, useState } from "react";

/** 키보드와 마우스가 있는 큰 화면. 셸 여부와 무관해서 PC 브라우저도 같은 화면을 얻는다. */
export const WIDE_LAYOUT_QUERY = "(min-width: 900px) and (pointer: fine)";

export function useWideLayout(): boolean {
  const [wide, setWide] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(WIDE_LAYOUT_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE_LAYOUT_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

/** `#session=<id>` — 셸이 알림 등에서 특정 세션을 바로 열 때 쓴다. */
export function sessionIdFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("session");
  return value && value.length > 0 ? value : null;
}
```

`src/renderer/src/mobile/SessionList.tsx` — props와 세션 버튼:

```tsx
interface SessionListProps {
  hostName: string;
  connection: RemoteClientState;
  sessions: RemoteSessionSummary[];
  onOpen(sessionId: string): void;
  onUnpair(): void;
  leaveLabel?: string;
  /** 넓은 화면에서 옆에 열려 있는 세션. */
  activeSessionId?: string | null;
}

export function SessionList({ hostName, connection, sessions, onOpen, onUnpair, leaveLabel, activeSessionId }: SessionListProps) {
```

```tsx
            <button
              type="button"
              className="m-session"
              key={session.id}
              aria-current={session.id === activeSessionId ? "true" : undefined}
              onClick={() => onOpen(session.id)}
            >
```

`src/renderer/src/mobile/SessionScreen.tsx` — props에 필드만 더한다(구조 분해는 Task 8에서):

```tsx
interface SessionScreenProps {
  client: RemoteClient;
  session: RemoteSessionSummary;
  deviceId: string;
  onBack(): void;
  /** 넓은 화면(PC): 목록이 옆에 있고, 터미널을 이 창 크기에 맞추며, 키보드로 바로 입력한다. */
  wide?: boolean;
}
```

`src/renderer/src/mobile/MobileApp.tsx` — import 추가:

```tsx
import { sessionIdFromHash, useWideLayout } from "./wide-layout";
```

`openSessionId` state를 바꾸고 그 아래에 훅을 더한다:

```tsx
  const [openSessionId, setOpenSessionId] = useState<string | null>(() => sessionIdFromHash(window.location.hash));
  const wide = useWideLayout();

  // 셸이 열려 있는 창에 다른 세션을 가리키는 링크를 다시 로드하면 해시만 바뀐다.
  useEffect(() => {
    const onHashChange = () => {
      const sessionId = sessionIdFromHash(window.location.hash);
      if (sessionId) setOpenSessionId(sessionId);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
```

`const openSession = …`부터 함수 끝까지를 바꾼다:

```tsx
  const openSession = sessions.find((session) => session.id === openSessionId) ?? null;
  const list = (
    <SessionList
      hostName={pairing.hostName}
      connection={connection}
      sessions={sessions}
      onOpen={setOpenSessionId}
      activeSessionId={wide ? (openSession?.id ?? null) : null}
      leaveLabel={bridge ? "호스트 목록" : "연결 해제"}
      onUnpair={() => {
        if (bridge) {
          bridge.backToHosts();
          return;
        }
        clearPairing(storage());
        setPairing(null);
      }}
    />
  );
  const screen = openSession ? (
    <SessionScreen
      key={openSession.id}
      client={client}
      session={openSession}
      deviceId={pairing.deviceId}
      wide={wide}
      onBack={() => setOpenSessionId(null)}
    />
  ) : null;

  if (wide) {
    return (
      <div className="m-wide">
        {list}
        {screen ?? <p className="m-empty m-wide-placeholder">왼쪽에서 세션을 고르세요</p>}
      </div>
    );
  }
  return screen ?? list;
}
```

`src/renderer/src/mobile/mobile.css` 끝에 추가:

```css
.m-session[aria-current="true"] { border-color: var(--m-accent); }
.m-wide { display: grid; grid-template-columns: 280px minmax(0, 1fr); height: 100%; }
.m-wide .m-list { overflow-y: auto; border-right: 1px solid #2a2f36; }
.m-wide .m-session-screen { min-width: 0; }
.m-wide-placeholder { align-self: center; justify-self: center; }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/renderer/src/mobile`
Expected: PASS (기존 `SessionList.test.tsx` 포함)

- [ ] **Step 5: 커밋**

```powershell
git add src/renderer/src/mobile/wide-layout.ts src/renderer/src/mobile/wide-layout.test.ts src/renderer/src/mobile/MobileApp.tsx src/renderer/src/mobile/MobileApp.test.tsx src/renderer/src/mobile/SessionList.tsx src/renderer/src/mobile/SessionScreen.tsx src/renderer/src/mobile/mobile.css
git commit -m @'
feat: show the session list beside the terminal on wide screens

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
'@
```

---

### Task 8: 세션 화면 — 자동 맞춤, 클립보드 키, 입력 도구 접기

**Files:**
- Create: `src/renderer/src/mobile/auto-fit.ts`, `src/renderer/src/mobile/auto-fit.test.ts`
- Modify: `src/renderer/src/mobile/terminal-input.ts` (끝에 추가), `src/renderer/src/mobile/terminal-input.test.ts`
- Modify: `src/renderer/src/mobile/SessionScreen.tsx`, `src/renderer/src/mobile/mobile.css`

**Interfaces:**
- Consumes: `SessionScreen`의 `wide` prop(Task 7), 기존 와이어 메시지 `resize`·`releaseSize`·`attached`·`size`
- Produces: `AutoFitState = "fitting" | "paused" | "host"`, `createAutoFit(options): { state(): AutoFitState; attached(): void; owner(owner: string): void; viewportChanged(): void; refit(): void; keepHost(on: boolean): void }`
- Produces: `clipboardKeyAction(event, hasSelection): "copy" | "paste" | "swallow" | null`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/src/mobile/auto-fit.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createAutoFit, type AutoFitState } from "./auto-fit";

function setup() {
  let size: { cols: number; rows: number } | null = { cols: 120, rows: 40 };
  const resize = vi.fn();
  const release = vi.fn();
  const states: AutoFitState[] = [];
  const fit = createAutoFit({
    deviceId: "me",
    measure: () => size,
    resize,
    release,
    onChange: (state) => states.push(state),
  });
  return { fit, resize, release, states, setSize: (next: { cols: number; rows: number } | null) => (size = next) };
}

describe("createAutoFit", () => {
  it("fits the terminal to this window once attached", () => {
    const { fit, resize } = setup();
    fit.viewportChanged();
    expect(resize).not.toHaveBeenCalled();
    fit.attached();
    expect(resize).toHaveBeenCalledWith(120, 40);
  });

  it("follows the window but does not repeat the same size", () => {
    const { fit, resize, setSize } = setup();
    fit.attached();
    fit.viewportChanged();
    expect(resize).toHaveBeenCalledTimes(1);
    setSize({ cols: 100, rows: 30 });
    fit.viewportChanged();
    expect(resize).toHaveBeenLastCalledWith(100, 30);
    fit.owner("me");
    expect(fit.state()).toBe("fitting");
  });

  it("pauses when the host takes the size back", () => {
    const { fit, resize, states } = setup();
    fit.attached();
    fit.owner("desktop");
    expect(fit.state()).toBe("paused");
    expect(states).toEqual(["paused"]);
    // 호스트가 알려 온 크기를 다시 받아도, 멈춘 동안에는 아무것도 보내지 않는다.
    fit.owner("desktop");
    expect(resize).toHaveBeenCalledTimes(1);
  });

  it("fits again when the user resizes the window or asks", () => {
    const { fit, resize } = setup();
    fit.attached();
    fit.owner("desktop");
    fit.viewportChanged();
    expect(fit.state()).toBe("fitting");
    expect(resize).toHaveBeenCalledTimes(2);
    fit.owner("desktop");
    fit.refit();
    expect(fit.state()).toBe("fitting");
    expect(resize).toHaveBeenCalledTimes(3);
  });

  it("fits again after a reconnect", () => {
    const { fit, resize } = setup();
    fit.attached();
    fit.owner("desktop");
    fit.attached();
    expect(fit.state()).toBe("fitting");
    expect(resize).toHaveBeenCalledTimes(2);
  });

  it("leaves the size to the host while asked to", () => {
    const { fit, resize, release, setSize } = setup();
    fit.attached();
    fit.keepHost(true);
    expect(release).toHaveBeenCalledOnce();
    expect(fit.state()).toBe("host");
    setSize({ cols: 90, rows: 20 });
    fit.viewportChanged();
    fit.attached();
    fit.owner("desktop");
    expect(resize).toHaveBeenCalledTimes(1);
    expect(fit.state()).toBe("host");
    fit.keepHost(false);
    expect(resize).toHaveBeenLastCalledWith(90, 20);
    expect(fit.state()).toBe("fitting");
  });

  it("waits until the terminal can be measured", () => {
    const { fit, resize, setSize } = setup();
    setSize(null);
    fit.attached();
    setSize({ cols: 1, rows: 0 });
    fit.viewportChanged();
    expect(resize).not.toHaveBeenCalled();
  });
});
```

`src/renderer/src/mobile/terminal-input.test.ts` — import에 `clipboardKeyAction`을 더하고 추가:

```ts
describe("clipboardKeyAction", () => {
  const key = (code: string, modifiers: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
    code,
    key: code,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers,
  });

  it("copies with Ctrl+C only when something is selected", () => {
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true }), true)).toBe("copy");
    // 선택이 없으면 Ctrl+C는 인터럽트로 PTY에 간다.
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true }), false)).toBeNull();
  });

  it("always takes Ctrl+Shift+C as the copy key", () => {
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true, shiftKey: true }), true)).toBe("copy");
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true, shiftKey: true }), false)).toBe("swallow");
  });

  it("pastes with Ctrl+V and Ctrl+Shift+V", () => {
    expect(clipboardKeyAction(key("KeyV", { ctrlKey: true }), false)).toBe("paste");
    expect(clipboardKeyAction(key("KeyV", { ctrlKey: true, shiftKey: true }), true)).toBe("paste");
  });

  it("leaves every other key to the terminal", () => {
    expect(clipboardKeyAction(key("KeyC"), true)).toBeNull();
    expect(clipboardKeyAction(key("KeyV", { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true, metaKey: true }), true)).toBeNull();
    expect(clipboardKeyAction(key("KeyX", { ctrlKey: true }), true)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/renderer/src/mobile/auto-fit.test.ts src/renderer/src/mobile/terminal-input.test.ts`
Expected: FAIL — `./auto-fit`이 없고 `clipboardKeyAction`이 export되지 않았다.

- [ ] **Step 3: 구현** — `src/renderer/src/mobile/auto-fit.ts`:

```ts
/** fitting: 이 창 크기로 맞추는 중 · paused: 호스트가 크기를 되찾아 멈춤 · host: 호스트 크기 유지를 골랐다. */
export type AutoFitState = "fitting" | "paused" | "host";

export interface AutoFitOptions {
  deviceId: string;
  /** 지금 터미널 영역에 들어가는 크기. 아직 잴 수 없으면 null. */
  measure(): { cols: number; rows: number } | null;
  resize(cols: number, rows: number): void;
  release(): void;
  onChange(state: AutoFitState): void;
}

/**
 * 넓은 화면에서 PTY 크기를 이 창에 맞추는 규칙. PTY 크기는 하나뿐이고 호스트 데스크톱이 입력하거나
 * 패인 크기를 바꾸면 되찾아 간다. 그때 곧바로 다시 resize를 보내면 호스트와 번갈아 크기를 바꾸게
 * 되므로, 되찾기를 보면 멈추고 사용자가 창 크기를 바꾸거나 "다시 맞추기"를 누를 때만 다시 맞춘다.
 */
export function createAutoFit(options: AutoFitOptions) {
  let state: AutoFitState = "fitting";
  let attachedOnce = false;
  let sent: { cols: number; rows: number } | null = null;

  const set = (next: AutoFitState) => {
    if (state === next) return;
    state = next;
    options.onChange(next);
  };

  const fit = (force: boolean) => {
    const size = options.measure();
    if (!size || size.cols < 2 || size.rows < 1) return;
    if (!force && sent && sent.cols === size.cols && sent.rows === size.rows) return;
    sent = size;
    options.resize(size.cols, size.rows);
  };

  return {
    state: () => state,

    /** attach 응답을 받았다(재연결 포함). resize는 붙은 세션에만 통한다. */
    attached() {
      attachedOnce = true;
      if (state === "host") return;
      set("fitting");
      fit(true);
    },

    /** 호스트가 알려 온 크기 소유자. 맞추는 중인데 내가 아니면 호스트가 되찾은 것이다. */
    owner(owner: string) {
      if (state !== "fitting" || owner === options.deviceId) return;
      sent = null;
      set("paused");
    },

    /** 터미널 영역의 크기가 바뀌었다 — 창 크기 변경. 멈춰 있었다면 다시 맞춘다. */
    viewportChanged() {
      if (!attachedOnce || state === "host") return;
      const resumed = state === "paused";
      set("fitting");
      fit(resumed);
    },

    refit() {
      if (!attachedOnce) return;
      set("fitting");
      fit(true);
    },

    keepHost(on: boolean) {
      if (on) {
        sent = null;
        set("host");
        options.release();
        return;
      }
      set("fitting");
      if (attachedOnce) fit(true);
    },
  };
}

export type AutoFit = ReturnType<typeof createAutoFit>;
```

`src/renderer/src/mobile/terminal-input.ts` 끝에 추가:

```ts
export type ClipboardKeyAction = "copy" | "paste" | "swallow" | null;

/**
 * 데스크톱 TerminalPane과 같은 키 규칙. Ctrl+C는 선택이 있을 때만 복사이고(없으면 인터럽트로 PTY에
 * 간다), Ctrl+Shift+C는 복사할 것이 없어도 복사 키로 먹는다. Ctrl+V·Ctrl+Shift+V는 붙여넣기다.
 */
export function clipboardKeyAction(
  event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "code" | "key">,
  hasSelection: boolean,
): ClipboardKeyAction {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null;
  const key = event.code || event.key;
  if (key === "KeyV") return "paste";
  if (key !== "KeyC") return null;
  if (hasSelection) return "copy";
  return event.shiftKey ? "swallow" : null;
}
```

`src/renderer/src/mobile/SessionScreen.tsx` — import와 상수:

```tsx
import { createAutoFit, type AutoFit, type AutoFitState } from "./auto-fit";
```

```tsx
import { clipboardKeyAction, createReplayGate, encodeComposerInput, QUICK_KEYS } from "./terminal-input";
```

```tsx
const FONT_SIZES = [9, 10, 11, 12, 13, 14, 16] as const;
const AUTO_FIT_DEBOUNCE_MS = 150;
```

파일 머리 주석과 함수 머리, state를 바꾼다:

```tsx
/**
 * 세션 화면. 폰(좁은 화면)의 기본은 PC의 열 수를 그대로 그리고 가로로 스크롤하는 것이고, "폰 크기로"를
 * 켜면 이 화면 폭으로 PTY를 줄인다. 넓은 화면(PC)은 반대로 이 창 크기에 맞추는 것이 기본이다. 어느
 * 쪽이든 호스트가 크기를 되찾으면(입력·패인 크기 변경) 맞춤이 꺼지거나 멈춘다.
 */
export function SessionScreen({ client, session, deviceId, onBack, wide = false }: SessionScreenProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const autoFitRef = useRef<AutoFit | null>(null);
  const phoneSizeRef = useRef(false);
  const [phoneSize, setPhoneSize] = useState(false);
  const [fitState, setFitState] = useState<AutoFitState>("fitting");
  // 넓은 화면은 키보드가 있다 — 빠른 키 바와 입력창은 접어 둔다.
  const [toolsOpen, setToolsOpen] = useState(!wide);
  const [fontIndex, setFontIndex] = useState(3);
  const [draft, setDraft] = useState("");
```

effect 안, `fitRef.current = fit;` 바로 아래에:

```tsx
    terminal.attachCustomKeyEventHandler((event) => {
      const action = clipboardKeyAction(event, terminal.hasSelection());
      if (action === null) return true;
      // 붙여넣기는 xterm이 키를 먹지 않게만 한다 — 브라우저의 paste 이벤트가 xterm에 닿아 처리된다.
      if (action === "paste") return false;
      event.preventDefault();
      // copy 이벤트는 xterm이 받아 선택 영역을 클립보드에 넣는다. http 출처라 navigator.clipboard는 없다.
      if (action === "copy" && event.type === "keydown") document.execCommand("copy");
      return false;
    });

    const autoFit = wide
      ? createAutoFit({
          deviceId,
          measure: () => {
            const dims = fit.proposeDimensions();
            return dims ? { cols: dims.cols, rows: dims.rows } : null;
          },
          resize: (cols, rows) => {
            client.send({ type: "resize", sessionId: session.id, cols, rows });
          },
          release: () => {
            client.send({ type: "releaseSize", sessionId: session.id });
          },
          onChange: setFitState,
        })
      : null;
    autoFitRef.current = autoFit;
    setFitState("fitting");
    if (wide) terminal.focus();
```

`offMessage`의 `attached`·`size` 분기를 바꾼다:

```tsx
      if (message.type === "attached") {
        terminal.reset();
        applySize(message.cols, message.rows);
        if (autoFit) autoFit.attached();
        else giveBackToggle(message.sizeOwner);
        gate.attached(message.replay, message.sequence);
      } else if (message.type === "data") {
        gate.data(message.data, message.sequence);
      } else if (message.type === "size") {
        applySize(message.cols, message.rows);
        if (autoFit) autoFit.owner(message.sizeOwner);
        else giveBackToggle(message.sizeOwner);
      }
```

`const input = terminal.onData(...)` 아래에:

```tsx
    // 창 크기가 바뀌면 다시 맞춘다. 끄는 동안 연달아 오는 콜백은 마지막 것만 쓴다.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer =
      autoFit && typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => autoFit.viewportChanged(), AUTO_FIT_DEBOUNCE_MS);
          })
        : null;
    observer?.observe(host);
```

cleanup의 `input.dispose();` 아래에:

```tsx
      observer?.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      autoFitRef.current = null;
```

effect 의존성 배열: `[client, session.id, deviceId, wide]`.

글자 크기 effect:

```tsx
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.fontSize = FONT_SIZES[fontIndex];
    // 글자 크기가 바뀌면 같은 창에 들어가는 열·행 수가 달라진다.
    autoFitRef.current?.viewportChanged();
  }, [fontIndex]);
```

`return` 안의 헤더·도구 줄·키 바·입력창을 바꾼다:

```tsx
    <main className="m-session-screen">
      <header className="m-bar">
        {wide ? null : (
          <button type="button" onClick={onBack} aria-label="세션 목록으로">
            ←
          </button>
        )}
        <h1>{session.label}</h1>
        <span className={`m-status m-status-${session.status}`}>{STATUS_LABEL[session.status]}</span>
      </header>
      <div className="m-tools">
        {wide ? (
          <>
            <button
              type="button"
              aria-pressed={fitState === "host"}
              onClick={() => autoFitRef.current?.keepHost(fitState !== "host")}
            >
              호스트 크기 유지
            </button>
            <button type="button" aria-pressed={toolsOpen} onClick={() => setToolsOpen((open) => !open)}>
              입력 도구
            </button>
          </>
        ) : (
          <button type="button" aria-pressed={phoneSize} onClick={togglePhoneSize}>
            📱 폰 크기로
          </button>
        )}
        <button type="button" aria-label="글자 작게" onClick={() => setFontIndex((index) => Math.max(0, index - 1))}>
          A−
        </button>
        <button
          type="button"
          aria-label="글자 크게"
          onClick={() => setFontIndex((index) => Math.min(FONT_SIZES.length - 1, index + 1))}
        >
          A+
        </button>
        {wide && fitState === "paused" ? (
          <span className="m-fit-notice" role="status">
            호스트가 크기를 가져갔습니다
            <button type="button" onClick={() => autoFitRef.current?.refit()}>
              다시 맞추기
            </button>
          </span>
        ) : null}
      </div>
      <div className="m-terminal" ref={hostRef} role="region" aria-label={`${session.label} 터미널`} />
      {toolsOpen ? (
        <>
          <div className="m-keys">
            {QUICK_KEYS.map((key) => (
              <button type="button" key={key.label} aria-label={key.ariaLabel} onClick={() => sendKeys(key.data)}>
                {key.label}
              </button>
            ))}
          </div>
          <form
            className="m-composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendKeys(encodeComposerInput(draft));
              setDraft("");
            }}
          >
            <textarea aria-label="입력" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} />
            <button type="submit">전송</button>
          </form>
        </>
      ) : null}
    </main>
```

`src/renderer/src/mobile/mobile.css` 끝에 추가:

```css
.m-tools { align-items: center; flex-wrap: wrap; }
.m-fit-notice { display: inline-flex; align-items: center; gap: 6px; color: var(--m-warn); font-size: 13px; }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/renderer/src/mobile`
Expected: PASS

Run: `npm run typecheck`
Expected: 오류 없음.

- [ ] **Step 5: 커밋**

```powershell
git add src/renderer/src/mobile/auto-fit.ts src/renderer/src/mobile/auto-fit.test.ts src/renderer/src/mobile/terminal-input.ts src/renderer/src/mobile/terminal-input.test.ts src/renderer/src/mobile/SessionScreen.tsx src/renderer/src/mobile/mobile.css
git commit -m @'
feat: fit the remote terminal to the window and handle copy and paste keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
'@
```

---

### Task 9: e2e, 문서, 전체 검증

**Files:**
- Create: `e2e/remote-window.spec.ts`
- Modify: `README.md:111`, `docs/installation.md` (모바일 컴패니언 절 아래), `docs/superpowers/specs/2026-10-03-remote-pc-window-design.md` (§3.3, §3.4)

**Interfaces:**
- Consumes: Task 1–8 전부. `window.multiCliWork.remoteHosts.add`, 사이드바 `aria-label="원격 PC"` 섹션, 원격 창의 `.m-wide`·`.m-session`·`.m-terminal`, 버튼 "호스트 크기 유지"·"다시 맞추기".

- [ ] **Step 1: e2e 작성** — `e2e/remote-window.spec.ts`:

```ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-11T12:00:00.000Z";
const WINDOWS = process.platform === "win32";
const SHELL_ID = WINDOWS ? "powershell" : "bash";
const SHELL_LABEL = WINDOWS ? "PowerShell" : "Bash";
const echo = (text: string) => (WINDOWS ? `Write-Output ${text}` : `echo ${text}`);

let tempRoot: string;
let app: ElectronApplication;
let page: Page;
let port: number;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const found = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(found));
    });
  });
}

/**
 * 앱 하나가 호스트이자 클라이언트다: 원격 서버를 loopback에 띄우고(MULTI_CLI_WORK_REMOTE_BIND),
 * 자기 자신을 원격 PC로 등록해 원격 창을 연다. 메인 창이 "호스트 PC의 화면" 역할도 한다.
 */
test.describe.serial("Remote PC window", () => {
  test.beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-cli-work-remote-e2e-"));
    port = await freePort();
    const projectRoot = path.join(tempRoot, "sample-project");
    await Promise.all([
      fs.mkdir(projectRoot, { recursive: true }),
      fs.mkdir(path.join(tempRoot, "registry"), { recursive: true }),
      fs.mkdir(path.join(tempRoot, "codex-sessions"), { recursive: true }),
      fs.mkdir(path.join(tempRoot, "user-data"), { recursive: true }),
    ]);
    await fs.writeFile(
      path.join(tempRoot, "registry", "projects.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: NOW,
          projects: {
            [PROJECT_ID]: {
              id: PROJECT_ID,
              rootPath: projectRoot,
              displayName: "Sample Project",
              sources: ["manual"],
              providerRefs: { claude: [], codex: [] },
              status: "진행중",
              memo: "",
              tracks: [],
              hidden: false,
              order: 0,
              createdAt: NOW,
              updatedAt: NOW,
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, "user-data", "settings.json"),
      `${JSON.stringify({ remote: { enabled: true, port } })}\n`,
      "utf8",
    );
    app = await electron.launch({
      args: [path.resolve("out/main/index.js")],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        MULTI_CLI_WORK_USER_DATA: path.join(tempRoot, "user-data"),
        MULTI_CLI_WORK_REGISTRY_PATH: path.join(tempRoot, "registry", "projects.json"),
        MULTI_CLI_WORK_CODEX_SESSIONS_DIR: path.join(tempRoot, "codex-sessions"),
        MULTI_CLI_WORK_AGENTS_PATH: path.join(tempRoot, "registry", "agents.json"),
        MULTI_CLI_WORK_WORK_PROJECTS_PATH: path.join(tempRoot, "registry", "work-projects.json"),
        MULTI_CLI_WORK_WORKTREES_PATH: path.join(tempRoot, "registry", "worktrees.json"),
        MULTI_CLI_WORK_PR_REVIEWS_PATH: path.join(tempRoot, "registry", "pr-reviews.json"),
        MULTI_CLI_WORK_WORKSPACE_PATH: path.join(tempRoot, "registry", "workspace.json"),
        MULTI_CLI_WORK_PROJECT_TAGS_PATH: path.join(tempRoot, "registry", "project-tags.json"),
        MULTI_CLI_WORK_REMOTE_BIND: "127.0.0.1",
      },
    });
    page = await app.firstWindow();
  });

  test.afterAll(async () => {
    await app?.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }).catch(() => undefined);
    await app?.close().catch(() => undefined);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test("registers a host, works in its session from a remote window, and loses it on revoke", async () => {
    await expect(page.getByRole("heading", { name: "멀티 터미널 작업기" })).toBeVisible();
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click();
    await page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).click();
    const hostTerminal = page.getByRole("region", { name: `${SHELL_ID} 터미널` });
    await expect(hostTerminal).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => window.multiCliWork.remote.status().then((status) => status.state)))
      .toBe("listening");

    // 등록 전에는 사이드바에 원격 PC 섹션이 없다.
    const hostsSection = page.getByRole("region", { name: "원격 PC" });
    await expect(hostsSection).toHaveCount(0);

    // Tailscale 밖 주소는 loopback 실행이라도 받지 않는다.
    const pairing = await page.evaluate(() => window.multiCliWork.remote.issuePairingCode());
    const refused = await page.evaluate(
      (code) => window.multiCliWork.remoteHosts.add({ address: "192.168.0.5:47821", code }).then(() => "ok", (error: Error) => error.message),
      pairing.code,
    );
    expect(refused).toContain("Tailscale 주소");

    const added = await page.evaluate(
      (input) => window.multiCliWork.remoteHosts.add(input),
      { address: `127.0.0.1:${port}`, code: pairing.code },
    );
    expect(added.paired).toBe(true);
    const hostButton = hostsSection.getByRole("button", { name: added.name });
    await expect(hostButton).toBeVisible();
    // 토큰은 암호문으로만 저장된다(이 PC가 호스트이기도 해서 기기 목록에 자기 이름이 보인다).
    const devices = await page.evaluate(() => window.multiCliWork.remote.listDevices());
    expect(devices).toHaveLength(1);
    const stored = await fs.readFile(path.join(tempRoot, "user-data", "remote-hosts.json"), "utf8");
    expect(JSON.parse(stored).hosts[0].token).toEqual(expect.any(String));

    // 원격 창: 넓은 화면 2단, 셸 브리지로 페어링 화면 없이 바로 목록.
    const remotePromise = app.waitForEvent("window");
    await hostButton.click();
    const remote = await remotePromise;
    await expect(remote.locator(".m-wide")).toBeVisible();
    await expect(remote.getByLabel("페어링 코드")).toHaveCount(0);
    expect(await remote.evaluate(() => typeof (window as unknown as { multiCliWork?: unknown }).multiCliWork)).toBe("undefined");

    const sessionButton = remote.locator(".m-session").first();
    await sessionButton.click();
    await expect(sessionButton).toHaveAttribute("aria-current", "true");
    const remoteRows = remote.locator(".m-terminal .xterm-rows");
    await expect(remoteRows).toBeVisible();
    // 넓은 화면에서는 입력창이 접혀 있고 키보드가 터미널로 바로 간다.
    await expect(remote.getByLabel("입력")).toHaveCount(0);
    await remote.keyboard.type(echo("MCW_FROM_PC"));
    await remote.keyboard.press("Enter");
    await expect(remoteRows).toContainText("MCW_FROM_PC");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_FROM_PC");

    // 자동 맞춤: 원격 창이 크기를 가져갔다가, 호스트에서 입력하면 내주고 멈춘다.
    const keepHost = remote.getByRole("button", { name: "호스트 크기 유지" });
    await expect(keepHost).toHaveAttribute("aria-pressed", "false");
    await expect(remote.getByText("호스트가 크기를 가져갔습니다")).toHaveCount(0);
    await hostTerminal.click();
    await page.keyboard.type(echo("MCW_FROM_HOST"));
    await page.keyboard.press("Enter");
    await expect(remote.getByText("호스트가 크기를 가져갔습니다")).toBeVisible();
    await expect(remoteRows).toContainText("MCW_FROM_HOST");
    await remote.getByRole("button", { name: "다시 맞추기" }).click();
    await expect(remote.getByText("호스트가 크기를 가져갔습니다")).toHaveCount(0);

    // 붙여넣기: 이 PC의 클립보드가 브라우저 paste 이벤트로 xterm에 들어간다.
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), echo("MCW_PASTED"));
    await remote.locator(".m-terminal").click();
    await remote.keyboard.press("Control+V");
    await remote.keyboard.press("Enter");
    await expect(remoteRows).toContainText("MCW_PASTED");

    // 복사: 출력 줄의 낱말을 두 번 눌러 고르고 Ctrl+Shift+C. 줄 한가운데는 빈칸이라 글자가 있는 왼쪽을 누른다.
    await app.evaluate(({ clipboard }) => clipboard.writeText(""));
    const pastedRow = remoteRows.locator("> div").filter({ hasText: /^MCW_PASTED$/ }).last();
    await pastedRow.dblclick({ position: { x: 20, y: 6 } });
    await remote.keyboard.press("Control+Shift+C");
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain("MCW_PASTED");

    // 호스트가 이 기기를 철회하면 원격 창이 닫히고 다시 페어링해야 한다.
    const closed = remote.waitForEvent("close");
    await page.evaluate((deviceId) => window.multiCliWork.remote.revokeDevice(deviceId), devices[0]!.deviceId);
    await closed;
    await expect(hostsSection.getByText("다시 페어링 필요")).toBeVisible();
    const reopen = await page.evaluate(
      (hostId) => window.multiCliWork.remoteHosts.open(hostId).then(() => "ok", (error: Error) => error.message),
      added.hostId,
    );
    expect(reopen).toContain("다시 페어링");
  });
});
```

- [ ] **Step 2: e2e 실행**

Run: `npm run build; if ($?) { npx playwright test e2e/remote-window.spec.ts }`
Expected: PASS (1 test).

복사 단계(`Control+Shift+C` 뒤 클립보드 확인)만 실패하면 — `document.execCommand("copy")`가 이 출처에서 막힌 것이다 — spec §3.3의 대비책대로 쓰기 전용 브리지를 더한 뒤 다시 돌린다:

`src/preload/remote-shell.ts`의 `bridgeVersion`을 `2`로 올리고 메서드를 더한다.

```ts
  bridgeVersion: () => 2,
```

```ts
  // 쓰기 전용: 이 PC의 클립보드를 읽는 길은 만들지 않는다.
  copyText: (text: unknown) => {
    if (typeof text === "string") ipcRenderer.send("remote-shell:copy", text);
  },
```

`src/main/remote-client/remote-windows.ts` — `REMOTE_SHELL_CHANNELS`에 `copy: "remote-shell:copy"`, `RemoteWindowsOptions`에 `writeClipboard(text: string): void`, `ipc.on`의 listener 타입을 `(event: RemoteShellEvent, ...args: unknown[]) => void`로 넓히고 생성자에:

```ts
    options.ipc.on(REMOTE_SHELL_CHANNELS.copy, (event, text) => {
      if (this.trusted(event) && typeof text === "string") this.options.writeClipboard(text);
    });
```

`src/main/runtime.ts`의 `new RemoteWindows({ … })`에 `writeClipboard: (text) => clipboard.writeText(text),`를 더하고 `ipc`를 `{ on: (channel, listener) => ipcMain.on(channel, (event, ...args) => listener(event, ...args)) }`로 바꾼다.

`remote-windows.test.ts` — `setup()`의 `channels` 타입을 `Map<string, (event: RemoteShellEvent, ...args: unknown[]) => void>`로 넓히고, `new RemoteWindows({ … })`에 `writeClipboard`를 넘기고, 반환 객체에 `writeClipboard`와 `channels`를 더한다(`const writeClipboard = vi.fn();`). 테스트 추가:

```ts
  it("copies text only for the host's own frame", async () => {
    const { windows, channels, writeClipboard } = setup();
    await windows.open("host-1");
    const copy = channels.get(REMOTE_SHELL_CHANNELS.copy)!;
    copy({ sender: { id: 100 }, senderFrame: { url: "http://evil.example/", parent: null } }, "stolen");
    copy({ sender: { id: 100 }, senderFrame: HOST_FRAME }, 42);
    expect(writeClipboard).not.toHaveBeenCalled();
    copy({ sender: { id: 100 }, senderFrame: HOST_FRAME }, "MCW_PASTED");
    expect(writeClipboard).toHaveBeenCalledWith("MCW_PASTED");
  });
```

`src/renderer/src/mobile/SessionScreen.tsx`의 복사 줄:

```tsx
      if (action === "copy" && event.type === "keydown") {
        const shell = (window as unknown as { McwShell?: { copyText?: (text: string) => void } }).McwShell;
        if (shell?.copyText) shell.copyText(terminal.getSelection());
        else document.execCommand("copy");
      }
```

- [ ] **Step 3: 문서**

`README.md:111`의 설정 표 행:

```md
| 원격 | Tailscale로 묶인 폰·다른 PC에서 이 PC의 세션을 보는 [원격 접속](docs/installation.md#모바일android-컴패니언) 허용·포트, 기기 추가(페어링·앱 설치 QR, 페어링 링크 복사), 페어링된 기기 목록과 연결 해제. 다른 PC에 접속하기 위한 PC 추가·삭제 |
```

`docs/installation.md` — 52행의 `설정 ▸ 모바일을 켜고`를 `설정 ▸ 원격에서 **원격 접속 허용**을 켜고`로 바꾸고, "모바일(Android) 컴패니언" 절이 끝나는 곳에 절을 더한다:

```md
## 다른 PC에서 이어받기

한 PC에서 돌려 둔 세션을 다른 PC의 앱에서 열어 이어서 작업할 수 있다. 두 PC가 같은 Tailscale tailnet에
있어야 하고, 세션이 도는 PC(호스트)의 앱이 켜져 있어야 한다.

1. 호스트 PC: 설정 ▸ 원격에서 **원격 접속 허용**을 켜고 **기기 추가**를 누른다. **페어링 링크 복사**로
   링크를 복사하거나, 화면의 접속 주소와 코드를 적어 둔다. 코드는 5분 동안 한 번만 쓸 수 있다.
2. 이 PC: 설정 ▸ 원격 ▸ **다른 PC에 접속**에 링크를 붙여 넣거나 주소와 코드를 입력하고 **PC 추가**를 누른다.
3. 사이드바 아래 **원격 PC**에서 그 PC를 누르면 세션 화면이 별도 창으로 열린다.

원격 창의 터미널은 창 크기에 맞춰진다. 호스트 PC에서 그 세션에 입력하거나 패인 크기를 바꾸면 호스트가
크기를 되찾고, 원격 창에서 **다시 맞추기**를 누르거나 창 크기를 바꾸면 다시 맞춘다. 호스트 크기 그대로
보려면 **호스트 크기 유지**를 켠다. 복사는 Ctrl+Shift+C(선택 영역이 있으면 Ctrl+C도), 붙여넣기는 Ctrl+V다.

호스트 PC에서 이 PC의 연결을 해제하면 원격 창이 닫히고 목록에 "다시 페어링 필요"로 남는다. 2번을 다시
하면 풀린다.
```

`docs/superpowers/specs/2026-10-03-remote-pc-window-design.md` — 머리의 상태 줄을 `> 상태: R1 구현됨 (2026-10-03) · R2·R3 구현 전`으로 바꾸고, 이 계획의 "Spec 대비 R1 결정" 네 항목을 반영한다:

- §3.3의 복사 문장 → `복사: 선택 영역이 있을 때 Ctrl+C 또는 Ctrl+Shift+C → document.execCommand("copy") (데스크톱 TerminalPane과 같은 키 규칙. 선택이 없으면 Ctrl+C는 인터럽트로 PTY에 간다).` Step 2에서 대비책을 썼다면 그 사실(`bridgeVersion` 2, `copyText`)도 §3.2 표에 적는다.
- §3.1의 주소 설명에 `호스트 설정이 보여 주는 http://…/mobile/ 주소를 그대로 붙여 넣어도 받는다.` 추가.
- §3.4의 "이 PC에 접속 허용" 항목에 `체크박스 문구는 "원격 접속 허용". Android 셸의 안내 문구는 다음 셸 릴리스에서 고친다.` 추가, IPC 줄에서 `set-notify`를 `(R3)`으로 표시하고 호스트 목록의 "알림 토글"에도 `(R3)`을 붙인다.

- [ ] **Step 4: 전체 검증**

Run: `npm run typecheck`
Expected: 오류 없음.

Run: `npx vitest run --pool=threads --maxWorkers=2`
Expected: 전체 PASS.

Run: `npm run build; if ($?) { npx playwright test e2e/remote-window.spec.ts e2e/mobile.spec.ts }`
Expected: 둘 다 PASS. `e2e/mobile.spec.ts`는 수정하지 않았다(`git diff --stat e2e/mobile.spec.ts`가 비어 있다).

Run: `npx playwright test e2e/desktop.spec.ts`
Expected: PASS — 메인 창 격리(Task 1)가 기존 데스크톱 흐름을 깨지 않았다.

- [ ] **Step 5: 커밋**

```powershell
git add e2e/remote-window.spec.ts README.md docs/installation.md docs/superpowers/specs/2026-10-03-remote-pc-window-design.md
git commit -m @'
test: cover the remote PC window end to end; document it and sync the spec

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
'@
```

Step 2에서 대비책(`copyText`)을 넣었다면 그 파일들(`src/preload/remote-shell.ts`, `src/main/remote-client/remote-windows.ts`, `remote-windows.test.ts`, `src/main/runtime.ts`, `src/renderer/src/mobile/SessionScreen.tsx`)을 먼저 `fix: copy from the remote window through a write-only bridge`로 따로 커밋한다.

수동 확인(두 PC가 있을 때, 릴리스 전): Tailscale로 묶인 두 PC에서 이어받기, 호스트에서 타이핑할 때 크기 회수, v1.35.4 호스트에 붙었을 때 폰 레이아웃으로라도 동작하는지, 원격 창에 포커스를 둔 채 로컬 세션의 입력 대기 알림이 뜨는지.
