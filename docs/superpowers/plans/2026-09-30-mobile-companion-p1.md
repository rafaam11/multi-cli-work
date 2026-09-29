# 모바일 컴패니언 P1 (호스트 서버 + 모바일 웹 UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데스크톱 multi-cli-work 안에 Tailscale 전용 원격 서버를 넣고, 폰 브라우저에서 페어링 코드로 접속해 세션 목록·상태를 보고 세션 터미널을 보며 입력할 수 있게 한다.

**Architecture:** main 프로세스에 `src/main/remote/`(HTTP + `ws` WebSocket)를 추가한다. 서버는 기존 `TerminalCoordinator`를 두 번째 클라이언트로 쓰고, PTY 크기는 새 `TerminalSizeArbiter`가 데스크톱·폰 사이에서 중재한다. 모바일 UI는 렌더러 Vite 빌드의 두 번째 페이지(`mobile.html`)로 번들되어 같은 서버가 `/mobile/`로 서빙한다.

**Tech Stack:** Electron 43 · TypeScript 5.7 · React 18 · xterm.js 6 · `ws` 8.21.0 · vitest 3 · Playwright 1.61

**Spec:** `docs/superpowers/specs/2026-09-30-mobile-companion-design.md` (이 계획은 §3.1·§3.2·§4·§5·§6의 P1 범위를 구현한다)

## Global Constraints

- 원격 서버는 설정 `remote.enabled`가 true일 때만 listen한다. 기본값은 `false`, 기본 포트는 `47821`, 포트 범위는 1024–65535다.
- bind 주소는 `100.64.0.0/10` IPv4만 허용한다(`0.0.0.0` 금지). 예외는 테스트·개발용 env `MULTI_CLI_WORK_REMOTE_BIND`뿐이다.
- 기기 토큰은 256bit(`randomBytes(32)`, base64url)다. 호스트는 sha256 해시만 저장한다. 토큰은 WS `hello` 메시지로만 보내고 URL에 넣지 않는다.
- 페어링 코드는 5분 유효하고 한 번만 쓸 수 있다. IP당 1분에 실패 5회를 넘으면 429를 준다.
- WS 핸드셰이크에 `Origin`이 있으면 `http://<Host 헤더>`와 같아야 한다.
- 프로토콜 버전은 `REMOTE_PROTOCOL_VERSION = 1`이다.
- 기존 코드 관례를 따른다: main 테스트 첫 줄은 `// @vitest-environment node`, 사용자 문구는 한국어, 저장 파일은 `src/main/storage/json-store.ts`의 `readJsonStore`/`updateJsonStore`를 쓴다.
- vitest는 `npx vitest run --pool=threads <파일>`로 돌린다. 전체 스위트는 `npx vitest run --pool=threads --maxWorkers=2`로 돌린다.
- git·npm 명령은 PowerShell로 실행한다. 브랜치는 main 단일이고 워크트리는 만들지 않는다.
- 모든 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.

## Spec 대비 P1 결정 (Task 13에서 spec에 반영)

- 기기 파일은 `~/.multi-cli-work/`가 아니라 **`userData/remote-devices.json`**에 둔다. 시크릿 계열(`notion-credentials.json`)과 같은 자리다.
- 재연결 시 **항상 전체 replay**로 다시 붙는다. 워커 링 버퍼에 "sequence 이후만" 주는 API가 없어서, `lastSequence` 이어받기는 하지 않는다.
- `hello.mode`는 P1에서 `"ui"`만 받는다(`"status"`는 P3). `welcome.shellLatest`는 P2에 넣는다.
- 데스크톱 패인의 "폰에서 크기 사용 중" 표시는 P4로 미룬다. P1에서 데스크톱이 크기를 되찾는 계기는 **그 세션에 대한 데스크톱 입력 또는 데스크톱 resize**다.
- P1의 페어링은 데스크톱 설정 "모바일" 탭이 **코드와 URL을 텍스트로** 보여주고, 폰 브라우저가 `/mobile/`에서 코드를 입력하는 방식이다(QR은 P2).

## Review Focus

1. **데스크톱에서 열어 둔 세션을 폰이 붙었다 떼는 경우** — 폰이 붙기만 하고 "폰 크기로"를 켜지 않았다면 데스크톱 레이아웃은 절대 바뀌지 않아야 한다. → Task 6·7 테스트 "attach alone never resizes"
2. **attach 응답 전에 도착한 출력** — replay와 이어지는 출력이 빠지거나 두 번 찍히면 안 된다(sequence 이하 버림). → Task 7 "forwards data that arrives while attach is in flight", Task 12 `createReplayGate` 테스트
3. **철회된 기기의 열린 연결** — 철회 즉시 끊기고, 재연결을 계속 시도하지 않아야 한다(4403 → unauthorized). → Task 7 "disconnectDevice", Task 11 "stops reconnecting on 4403"
4. **Tailscale이 앱보다 늦게 켜지는 부팅 순서** — 사용자가 토글을 다시 누르지 않아도 30초 안에 listen해야 한다. → Task 9 "retries when Tailscale appears later"
5. **모바일 번들이 없는 dev 실행** — 서버가 죽지 않고 안내 문구와 함께 503을 줘야 한다. → Task 8 "503 when the mobile bundle is missing"

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/shared/settings-types.ts` (수정) | `remote: { enabled, port }` 설정 섹션 |
| `src/shared/remote-types.ts` (신규) | WS 와이어 타입·파서·close 코드 + 데스크톱 API 타입 |
| `src/main/remote/tailscale-address.ts` (신규) | 네트워크 인터페이스에서 100.64/10 주소 고르기 |
| `src/main/remote/device-store.ts` (신규) | hostId·기기 목록·토큰 발급/검증/철회 (json-store) |
| `src/main/remote/pairing-codes.ts` (신규) | 일회용 페어링 코드·만료·rate limit |
| `src/main/remote/size-arbiter.ts` (신규) | 세션별 PTY 크기 소유자 중재 |
| `src/main/remote/remote-session-hub.ts` (신규) | 소켓과 무관한 연결별 프로토콜 처리 |
| `src/main/remote/remote-server.ts` (신규) | http 서버: 정적 서빙·`/pair`·`/ws` 업그레이드·ping |
| `src/main/remote/remote-access.ts` (신규) | 설정→서버 기동/정지·상태·페어링·기기 관리 |
| `src/main/ipc.ts` · `src/preload/index.ts` · `src/shared/api-types.ts` · `src/main/runtime.ts` (수정) | 배선 |
| `src/renderer/src/RemoteSettings.tsx` · `SettingsDialog.tsx` (신규/수정) | 설정 "모바일" 탭 |
| `src/renderer/mobile.html` · `electron.vite.config.ts` (신규/수정) | 모바일 페이지 빌드 엔트리 |
| `src/renderer/src/mobile/*` (신규) | 모바일 앱: 클라이언트·페어링·목록·세션 화면 |
| `e2e/mobile.spec.ts` (신규) | 페어링→목록→입력 e2e |

---

### Task 1: `remote` 설정 섹션

**Files:**
- Modify: `src/shared/settings-types.ts`
- Modify: `src/main/ipc.ts` (`validateSettingsPatch`, 541행 부근)
- Test: `src/shared/settings-types.test.ts`, `src/main/ipc.test.ts`

**Interfaces:**
- Produces: `RemoteSettings { enabled: boolean; port: number }`, `AppSettings.remote`, `AppSettingsPatch.remote?: Partial<RemoteSettings>`, `REMOTE_PORT_RANGE`, `DEFAULT_REMOTE_PORT = 47821`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/shared/settings-types.test.ts`에 추가:

```ts
describe("remote settings", () => {
  it("defaults to off on port 47821", () => {
    expect(parseSettings(undefined).remote).toEqual({ enabled: false, port: 47821 });
  });

  it("keeps a valid saved value and drops out-of-range ports", () => {
    expect(parseSettings({ remote: { enabled: true, port: 50000 } }).remote).toEqual({ enabled: true, port: 50000 });
    expect(parseSettings({ remote: { enabled: true, port: 80 } }).remote.port).toBe(47821);
    expect(parseSettings({ remote: { enabled: "yes", port: 50000.5 } }).remote).toEqual({ enabled: false, port: 47821 });
  });

  it("merges a partial patch", () => {
    const next = mergeSettingsPatch(DEFAULT_SETTINGS, { remote: { enabled: true } });
    expect(next.remote).toEqual({ enabled: true, port: 47821 });
  });
});
```

`src/main/ipc.test.ts`에서 기존 `settings:update` 테스트 옆에 추가한다. 핸들러 맵 이름은 파일의 기존 테스트가 쓰는 `handlers`를 따른다:

```ts
it("validates the remote settings patch", async () => {
  await handlers.get("settings:update")!({}, { remote: { enabled: true, port: 50000 } });
  expect(settingsGateway.update).toHaveBeenLastCalledWith({ remote: { enabled: true, port: 50000 } });
  await expect(handlers.get("settings:update")!({}, { remote: { port: 80 } })).rejects.toThrow(/port/);
  await expect(handlers.get("settings:update")!({}, { remote: { host: "0.0.0.0" } })).rejects.toThrow();
});
```

(`settingsGateway`는 ipc.test.ts가 settings 의존성으로 넘기는 mock 이름에 맞춘다. 이름이 다르면 그 이름을 쓴다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/shared/settings-types.test.ts src/main/ipc.test.ts`
Expected: FAIL (`remote` undefined / `Settings patch` unknown key)

- [ ] **Step 3: 구현** — `settings-types.ts`:

```ts
export interface RemoteSettings {
  /** 모바일 연결 서버를 켠다. 켜도 Tailscale 주소가 없으면 listen하지 않는다. */
  enabled: boolean;
  port: number;
}

export const DEFAULT_REMOTE_PORT = 47821;
export const REMOTE_PORT_RANGE = { min: 1024, max: 65535 } as const;
```

- `AppSettings`에 `remote: RemoteSettings;`
- `AppSettingsPatch`에 `remote?: Partial<RemoteSettings>;`
- `DEFAULT_SETTINGS`에 `remote: { enabled: false, port: DEFAULT_REMOTE_PORT },`
- `parseSettings` 안:

```ts
  const remote = isRecord(raw.remote) ? raw.remote : {};
  // ...return 객체에:
    remote: {
      enabled: readBoolean(remote.enabled, defaults.remote.enabled),
      port:
        typeof remote.port === "number" &&
        Number.isInteger(remote.port) &&
        remote.port >= REMOTE_PORT_RANGE.min &&
        remote.port <= REMOTE_PORT_RANGE.max
          ? remote.port
          : defaults.remote.port,
    },
```

- `mergeSettingsPatch` 반환에 `remote: { ...current.remote, ...patch.remote },`

`ipc.ts`의 `validateSettingsPatch`에서 허용 키 배열 끝에 `"remote"`를 넣고, 다음을 추가한다:

```ts
  if (raw.remote !== undefined) {
    const remote = exactObject(raw.remote, ["enabled", "port"], "Settings remote");
    patch.remote = {};
    if (remote.enabled !== undefined) patch.remote.enabled = booleanValue(remote.enabled, "Settings remote enabled");
    if (remote.port !== undefined) {
      const port = integer(remote.port, "Settings remote port");
      if (port < REMOTE_PORT_RANGE.min || port > REMOTE_PORT_RANGE.max) {
        throw new Error(`Settings remote port must be ${REMOTE_PORT_RANGE.min}–${REMOTE_PORT_RANGE.max}`);
      }
      patch.remote.port = port;
    }
  }
```

(`REMOTE_PORT_RANGE`는 `../shared/settings-types`에서 import한다.)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/shared/settings-types.test.ts src/main/ipc.test.ts src/main/settings/settings-store.test.ts`
Expected: PASS. `DEFAULT_SETTINGS`를 통째로 비교하는 기존 기대값이 깨지면 그 기대값에 `remote`를 추가한다.

- [ ] **Step 5: 커밋**

```powershell
git add src/shared/settings-types.ts src/shared/settings-types.test.ts src/main/ipc.ts src/main/ipc.test.ts
git commit -m @'
feat: add the remote (mobile) settings section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 2: 원격 프로토콜 타입과 파서

**Files:**
- Create: `src/shared/remote-types.ts`
- Test: `src/shared/remote-types.test.ts`

**Interfaces:**
- Produces (이후 모든 태스크가 씀):
  - `REMOTE_PROTOCOL_VERSION = 1`
  - `REMOTE_CLOSE = { protocol: 4400, unauthorized: 4401, revoked: 4403 } as const`
  - `RemoteClientMessage`, `RemoteServerMessage`, `RemoteSessionSummary`, `SizeOwner`
  - `parseRemoteClientMessage(raw: string): RemoteClientMessage | null`
  - `RemoteAccessStatus`, `RemotePairingCode`, `RemoteDeviceInfo`, `RemotePairResponse`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/shared/remote-types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseRemoteClientMessage, REMOTE_PROTOCOL_VERSION } from "./remote-types";

describe("parseRemoteClientMessage", () => {
  it("accepts every well-formed client message", () => {
    const hello = { type: "hello", token: "t", protocolVersion: REMOTE_PROTOCOL_VERSION, mode: "ui" };
    expect(parseRemoteClientMessage(JSON.stringify(hello))).toEqual(hello);
    expect(parseRemoteClientMessage('{"type":"list"}')).toEqual({ type: "list" });
    expect(parseRemoteClientMessage('{"type":"attach","sessionId":"s"}')).toEqual({ type: "attach", sessionId: "s" });
    expect(parseRemoteClientMessage('{"type":"detach","sessionId":"s"}')).toEqual({ type: "detach", sessionId: "s" });
    expect(parseRemoteClientMessage('{"type":"write","sessionId":"s","data":"x"}')).toEqual({
      type: "write",
      sessionId: "s",
      data: "x",
    });
    expect(parseRemoteClientMessage('{"type":"resize","sessionId":"s","cols":40,"rows":20}')).toEqual({
      type: "resize",
      sessionId: "s",
      cols: 40,
      rows: 20,
    });
    expect(parseRemoteClientMessage('{"type":"releaseSize","sessionId":"s"}')).toEqual({
      type: "releaseSize",
      sessionId: "s",
    });
  });

  it("rejects malformed input instead of throwing", () => {
    for (const raw of [
      "not json",
      "null",
      "[]",
      '{"type":"nope"}',
      '{"type":"attach"}',
      '{"type":"attach","sessionId":""}',
      '{"type":"write","sessionId":"s","data":5}',
      '{"type":"resize","sessionId":"s","cols":1.5,"rows":20}',
      '{"type":"hello","token":"t","protocolVersion":1,"mode":"status"}',
      '{"type":"hello","token":"","protocolVersion":1,"mode":"ui"}',
    ]) {
      expect(parseRemoteClientMessage(raw), raw).toBeNull();
    }
  });

  it("drops unknown extra fields", () => {
    expect(parseRemoteClientMessage('{"type":"list","extra":1}')).toEqual({ type: "list" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/shared/remote-types.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: 구현** — `src/shared/remote-types.ts`:

```ts
/**
 * 모바일 컴패니언과 데스크톱 호스트가 주고받는 것. 와이어 메시지(WS)와, 설정 탭이 쓰는 데스크톱
 * API 타입을 한곳에 둔다. 설계: docs/superpowers/specs/2026-09-30-mobile-companion-design.md §5.
 */
import type { TerminalKind, TerminalStatus } from "./terminal-types";

export const REMOTE_PROTOCOL_VERSION = 1;

/** WS close 코드. 4401·4403이면 클라이언트는 재연결하지 않고 다시 페어링하게 한다. */
export const REMOTE_CLOSE = { protocol: 4400, unauthorized: 4401, revoked: 4403 } as const;

/** 크기를 가진 쪽: 데스크톱이거나, 크기를 가져간 기기의 deviceId. */
export type SizeOwner = string;
export const DESKTOP_SIZE_OWNER = "desktop";

export interface RemoteSessionSummary {
  id: string;
  projectId: string | null;
  projectName: string | null;
  kind: TerminalKind;
  label: string;
  status: TerminalStatus;
  updatedAt: string;
}

export type RemoteClientMessage =
  | { type: "hello"; token: string; protocolVersion: number; mode: "ui" }
  | { type: "list" }
  | { type: "attach"; sessionId: string }
  | { type: "detach"; sessionId: string }
  | { type: "write"; sessionId: string; data: string }
  | { type: "resize"; sessionId: string; cols: number; rows: number }
  | { type: "releaseSize"; sessionId: string };

export type RemoteErrorCode = "bad-message" | "protocol" | "unauthorized" | "not-attached" | "failed";

export type RemoteServerMessage =
  | { type: "welcome"; hostId: string; hostName: string; deviceId: string; protocolVersion: number }
  | { type: "sessions"; sessions: RemoteSessionSummary[] }
  | {
      type: "attached";
      sessionId: string;
      replay: string;
      sequence: number;
      cols: number | null;
      rows: number | null;
      sizeOwner: SizeOwner;
    }
  | { type: "data"; sessionId: string; data: string; sequence: number }
  | { type: "status"; sessionId: string; status: TerminalStatus }
  | { type: "title"; sessionId: string; title: string }
  | { type: "exit"; sessionId: string; exitCode: number }
  | { type: "created"; session: RemoteSessionSummary }
  | { type: "size"; sessionId: string; cols: number; rows: number; sizeOwner: SizeOwner }
  | { type: "error"; code: RemoteErrorCode; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function dimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** 잘못된 입력은 null — 연결 하나의 나쁜 메시지가 서버를 던지게 두지 않는다. */
export function parseRemoteClientMessage(raw: string): RemoteClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "hello":
      return text(value.token) && typeof value.protocolVersion === "number" && value.mode === "ui"
        ? { type: "hello", token: value.token, protocolVersion: value.protocolVersion, mode: "ui" }
        : null;
    case "list":
      return { type: "list" };
    case "attach":
      return text(value.sessionId) ? { type: "attach", sessionId: value.sessionId } : null;
    case "detach":
      return text(value.sessionId) ? { type: "detach", sessionId: value.sessionId } : null;
    case "releaseSize":
      return text(value.sessionId) ? { type: "releaseSize", sessionId: value.sessionId } : null;
    case "write":
      return text(value.sessionId) && typeof value.data === "string"
        ? { type: "write", sessionId: value.sessionId, data: value.data }
        : null;
    case "resize":
      return text(value.sessionId) && dimension(value.cols) && dimension(value.rows)
        ? { type: "resize", sessionId: value.sessionId, cols: value.cols, rows: value.rows }
        : null;
    default:
      return null;
  }
}

/** 설정 탭이 보는 서버 상태. */
export interface RemoteAccessStatus {
  state: "off" | "listening" | "no-tailscale" | "error";
  /** listening일 때 폰에서 열 주소, 예: http://100.101.102.103:47821/mobile/ */
  url: string | null;
  port: number;
  message: string | null;
}

export interface RemotePairingCode {
  /** 표시용 "ABCD-EFGH". 입력할 때 하이픈과 대소문자는 무시한다. */
  code: string;
  expiresAt: string;
  url: string;
}

export interface RemoteDeviceInfo {
  deviceId: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
}

/** POST /pair 성공 응답. */
export interface RemotePairResponse {
  token: string;
  deviceId: string;
  hostId: string;
  hostName: string;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/shared/remote-types.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```powershell
git add src/shared/remote-types.ts src/shared/remote-types.test.ts
git commit -m @'
feat: define the mobile remote protocol

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 3: Tailscale 주소 고르기

**Files:**
- Create: `src/main/remote/tailscale-address.ts`
- Test: `src/main/remote/tailscale-address.test.ts`

**Interfaces:**
- Produces: `tailscaleAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string[]`, `isTailscaleAddress(address: string): boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// @vitest-environment node

import type os from "node:os";
import { describe, expect, it } from "vitest";
import { isTailscaleAddress, tailscaleAddresses } from "./tailscale-address";

const entry = (address: string, family: "IPv4" | "IPv6" = "IPv4", internal = false): os.NetworkInterfaceInfo =>
  ({ address, family, internal, netmask: "", mac: "", cidr: null }) as os.NetworkInterfaceInfo;

describe("isTailscaleAddress", () => {
  it("accepts only 100.64.0.0/10", () => {
    expect(isTailscaleAddress("100.64.0.1")).toBe(true);
    expect(isTailscaleAddress("100.127.255.254")).toBe(true);
    expect(isTailscaleAddress("100.63.255.255")).toBe(false);
    expect(isTailscaleAddress("100.128.0.1")).toBe(false);
    expect(isTailscaleAddress("192.168.0.10")).toBe(false);
    expect(isTailscaleAddress("not-an-ip")).toBe(false);
  });
});

describe("tailscaleAddresses", () => {
  it("returns non-internal IPv4 tailnet addresses from any interface", () => {
    expect(
      tailscaleAddresses({
        Ethernet: [entry("192.168.0.10"), entry("fe80::1", "IPv6")],
        Tailscale: [entry("100.101.102.103"), entry("fd7a:115c:a1e0::1", "IPv6")],
        lo: [entry("127.0.0.1", "IPv4", true)],
      }),
    ).toEqual(["100.101.102.103"]);
  });

  it("returns an empty list when Tailscale is down", () => {
    expect(tailscaleAddresses({ Ethernet: [entry("10.0.0.2")] })).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote/tailscale-address.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: 구현**

```ts
import type os from "node:os";

/** Tailscale이 기기에 나눠 주는 CGNAT 대역 100.64.0.0/10. */
export function isTailscaleAddress(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [first, second] = parts.map(Number);
  return first === 100 && second >= 64 && second <= 127;
}

/** 원격 서버가 bind해도 되는 주소들. 다른 LAN·공인 주소는 절대 고르지 않는다. */
export function tailscaleAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string[] {
  const found: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4") continue;
      if (isTailscaleAddress(entry.address)) found.push(entry.address);
    }
  }
  return found;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/main/remote/tailscale-address.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```powershell
git add src/main/remote/tailscale-address.ts src/main/remote/tailscale-address.test.ts
git commit -m @'
feat: pick the Tailscale address the remote server may bind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 4: 기기 저장소

**Files:**
- Create: `src/main/remote/device-store.ts`
- Test: `src/main/remote/device-store.test.ts`

**Interfaces:**
- Consumes: `readJsonStore`, `updateJsonStore`, `JsonStoreSpec` (`src/main/storage/json-store.ts`)
- Produces:
  - `interface RemoteDevice { deviceId: string; name: string; tokenHash: string; createdAt: string; lastSeenAt: string | null }`
  - `class RemoteDeviceStore` — `constructor(filePath: string, deps?: Partial<DeviceStoreDeps>)`, `hostId(): Promise<string>`, `list(): Promise<RemoteDevice[]>`, `register(name: string): Promise<{ device: RemoteDevice; token: string }>`, `verify(token: string): Promise<RemoteDevice | null>`, `touch(deviceId: string): Promise<void>`, `revoke(deviceId: string): Promise<boolean>`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// @vitest-environment node

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RemoteDeviceStore } from "./device-store";

async function store() {
  const dir = await mkdtemp(path.join(tmpdir(), "mcw-devices-"));
  const filePath = path.join(dir, "remote-devices.json");
  let id = 0;
  return {
    filePath,
    store: new RemoteDeviceStore(filePath, {
      now: () => "2026-09-30T00:00:00.000Z",
      randomId: () => `id-${++id}`,
    }),
  };
}

describe("RemoteDeviceStore", () => {
  it("creates a stable host id once", async () => {
    const { store: devices } = await store();
    const first = await devices.hostId();
    expect(first).toBe("id-1");
    expect(await devices.hostId()).toBe(first);
  });

  it("registers a device, stores only the token hash, and verifies the token", async () => {
    const { store: devices, filePath } = await store();
    const { device, token } = await devices.register("  내 폰  ");
    expect(device.name).toBe("내 폰");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const saved = await readFile(filePath, "utf8");
    expect(saved).not.toContain(token);
    expect((await devices.verify(token))?.deviceId).toBe(device.deviceId);
    expect(await devices.verify(`${token}x`)).toBeNull();
    expect(await devices.verify("")).toBeNull();
  });

  it("revokes a device so its token stops working", async () => {
    const { store: devices } = await store();
    const { device, token } = await devices.register("폰");
    expect(await devices.revoke(device.deviceId)).toBe(true);
    expect(await devices.verify(token)).toBeNull();
    expect(await devices.revoke(device.deviceId)).toBe(false);
    expect(await devices.list()).toEqual([]);
  });

  it("records the last time a device connected", async () => {
    const { store: devices } = await store();
    const { device } = await devices.register("폰");
    await devices.touch(device.deviceId);
    expect((await devices.list())[0]!.lastSeenAt).toBe("2026-09-30T00:00:00.000Z");
  });

  it("falls back to a default name and caps long names", async () => {
    const { store: devices } = await store();
    expect((await devices.register("   ")).device.name).toBe("이름 없는 기기");
    expect((await devices.register("가".repeat(100))).device.name).toHaveLength(40);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote/device-store.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: 구현**

```ts
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";

export interface RemoteDevice {
  deviceId: string;
  name: string;
  /** sha256(token) hex. 토큰 원문은 어디에도 저장하지 않는다. */
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string | null;
}

interface RemoteDevicesFileV1 {
  version: 1;
  /** 이 호스트의 영구 ID. 폰이 여러 PC를 구분하는 열쇠다. 비어 있으면 아직 만들지 않았다. */
  hostId: string;
  devices: RemoteDevice[];
}

export interface DeviceStoreDeps {
  now(): string;
  randomId(): string;
  randomToken(): string;
}

const MAX_DEVICE_NAME_LENGTH = 40;
const DEFAULT_DEVICE_NAME = "이름 없는 기기";

class RemoteDeviceStoreError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDevice(value: unknown): value is RemoteDevice {
  return (
    isRecord(value) &&
    typeof value.deviceId === "string" &&
    typeof value.name === "string" &&
    typeof value.tokenHash === "string" &&
    /^[0-9a-f]{64}$/.test(value.tokenHash) &&
    typeof value.createdAt === "string" &&
    (value.lastSeenAt === null || typeof value.lastSeenAt === "string")
  );
}

function parseDevicesFile(value: unknown): RemoteDevicesFileV1 {
  const raw = isRecord(value) ? value : {};
  return {
    version: 1,
    hostId: typeof raw.hostId === "string" ? raw.hostId : "",
    devices: Array.isArray(raw.devices) ? raw.devices.filter(isDevice) : [],
  };
}

const spec: JsonStoreSpec<RemoteDevicesFileV1> = {
  label: "remote device store",
  displayName: "모바일 기기(remote-devices.json)",
  parse: parseDevicesFile,
  empty: () => parseDevicesFile(undefined),
  error: (message, options) => new RemoteDeviceStoreError(message, options),
  isContentError: (error) => error instanceof RemoteDeviceStoreError,
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_DEVICE_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : DEFAULT_DEVICE_NAME;
}

export class RemoteDeviceStore {
  private readonly deps: DeviceStoreDeps;

  constructor(
    private readonly filePath: string,
    deps: Partial<DeviceStoreDeps> = {},
  ) {
    this.deps = {
      now: deps.now ?? (() => new Date().toISOString()),
      randomId: deps.randomId ?? (() => randomUUID()),
      randomToken: deps.randomToken ?? (() => randomBytes(32).toString("base64url")),
    };
  }

  async hostId(): Promise<string> {
    const current = (await readJsonStore(spec, this.filePath)).value.hostId;
    if (current) return current;
    const next = await updateJsonStore(spec, this.filePath, (file) =>
      file.hostId ? file : { ...file, hostId: this.deps.randomId() },
    );
    return next.hostId;
  }

  async list(): Promise<RemoteDevice[]> {
    return (await readJsonStore(spec, this.filePath)).value.devices;
  }

  async register(name: string): Promise<{ device: RemoteDevice; token: string }> {
    const token = this.deps.randomToken();
    const device: RemoteDevice = {
      deviceId: this.deps.randomId(),
      name: cleanName(name),
      tokenHash: hashToken(token),
      createdAt: this.deps.now(),
      lastSeenAt: null,
    };
    await updateJsonStore(spec, this.filePath, (file) => ({ ...file, devices: [...file.devices, device] }));
    return { device, token };
  }

  async verify(token: string): Promise<RemoteDevice | null> {
    if (token.length === 0) return null;
    const wanted = Buffer.from(hashToken(token), "hex");
    for (const device of await this.list()) {
      if (timingSafeEqual(wanted, Buffer.from(device.tokenHash, "hex"))) return device;
    }
    return null;
  }

  async touch(deviceId: string): Promise<void> {
    const now = this.deps.now();
    await updateJsonStore(spec, this.filePath, (file) => ({
      ...file,
      devices: file.devices.map((device) => (device.deviceId === deviceId ? { ...device, lastSeenAt: now } : device)),
    }));
  }

  async revoke(deviceId: string): Promise<boolean> {
    let removed = false;
    await updateJsonStore(spec, this.filePath, (file) => {
      const devices = file.devices.filter((device) => device.deviceId !== deviceId);
      removed = devices.length !== file.devices.length;
      return { ...file, devices };
    });
    return removed;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/main/remote/device-store.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```powershell
git add src/main/remote/device-store.ts src/main/remote/device-store.test.ts
git commit -m @'
feat: store paired mobile devices by token hash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 5: 일회용 페어링 코드

**Files:**
- Create: `src/main/remote/pairing-codes.ts`
- Test: `src/main/remote/pairing-codes.test.ts`

**Interfaces:**
- Produces: `class PairingCodes` — `constructor(deps?: Partial<PairingDeps>)`, `issue(): { code: string; expiresAt: number }`, `consume(input: string, clientIp: string): "ok" | "invalid" | "rate-limited"`, `formatPairingCode(raw: string): string`
- `PairingDeps { now(): number; randomCode(): string; ttlMs: number; maxFailuresPerMinute: number; maxFailuresPerCode: number }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// @vitest-environment node

import { describe, expect, it } from "vitest";
import { formatPairingCode, PairingCodes } from "./pairing-codes";

function codes(start = 0) {
  let now = start;
  const pairing = new PairingCodes({ now: () => now, randomCode: () => "ABCDEFGH" });
  return { pairing, advance: (ms: number) => (now += ms) };
}

describe("PairingCodes", () => {
  it("accepts the code once, ignoring case and the hyphen", () => {
    const { pairing } = codes();
    expect(pairing.issue().code).toBe("ABCD-EFGH");
    expect(pairing.consume("abcd-efgh", "100.1.1.1")).toBe("ok");
    expect(pairing.consume("ABCDEFGH", "100.1.1.1")).toBe("invalid");
  });

  it("expires after five minutes", () => {
    const { pairing, advance } = codes();
    pairing.issue();
    advance(5 * 60_000 + 1);
    expect(pairing.consume("ABCDEFGH", "100.1.1.1")).toBe("invalid");
  });

  it("a new code replaces the previous one", () => {
    let next = "AAAAAAAA";
    const pairing = new PairingCodes({ now: () => 0, randomCode: () => next });
    pairing.issue();
    next = "BBBBBBBB";
    pairing.issue();
    expect(pairing.consume("AAAAAAAA", "ip")).toBe("invalid");
    expect(pairing.consume("BBBBBBBB", "ip")).toBe("ok");
  });

  it("rate-limits an address after five failures in a minute, then forgives it", () => {
    const { pairing, advance } = codes();
    pairing.issue();
    for (let i = 0; i < 5; i += 1) expect(pairing.consume("WRONG", "100.1.1.1")).toBe("invalid");
    expect(pairing.consume("ABCDEFGH", "100.1.1.1")).toBe("rate-limited");
    expect(pairing.consume("ABCDEFGH", "100.2.2.2")).toBe("ok");
    pairing.issue();
    advance(60_001);
    expect(pairing.consume("ABCDEFGH", "100.1.1.1")).toBe("ok");
  });

  it("burns the code after ten failures from anywhere", () => {
    const { pairing } = codes();
    pairing.issue();
    for (let i = 0; i < 10; i += 1) pairing.consume("WRONG", `100.0.0.${i}`);
    expect(pairing.consume("ABCDEFGH", "100.9.9.9")).toBe("invalid");
  });

  it("formats a raw code for display", () => {
    expect(formatPairingCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote/pairing-codes.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
import { randomInt } from "node:crypto";

/** 헷갈리는 0/O·1/I를 뺀 32자. 8자리면 40bit — 5분·시도 제한 안에서는 충분하다. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const FAILURE_WINDOW_MS = 60_000;

export interface PairingDeps {
  now(): number;
  randomCode(): string;
  ttlMs: number;
  maxFailuresPerMinute: number;
  maxFailuresPerCode: number;
}

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

function normalize(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

export function formatPairingCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export class PairingCodes {
  private readonly deps: PairingDeps;
  private active: { code: string; expiresAt: number; failures: number } | null = null;
  private readonly failuresByIp = new Map<string, number[]>();

  constructor(deps: Partial<PairingDeps> = {}) {
    this.deps = {
      now: deps.now ?? Date.now,
      randomCode: deps.randomCode ?? randomCode,
      ttlMs: deps.ttlMs ?? 5 * 60_000,
      maxFailuresPerMinute: deps.maxFailuresPerMinute ?? 5,
      maxFailuresPerCode: deps.maxFailuresPerCode ?? 10,
    };
  }

  issue(): { code: string; expiresAt: number } {
    const code = this.deps.randomCode();
    const expiresAt = this.deps.now() + this.deps.ttlMs;
    this.active = { code, expiresAt, failures: 0 };
    return { code: formatPairingCode(code), expiresAt };
  }

  consume(input: string, clientIp: string): "ok" | "invalid" | "rate-limited" {
    const now = this.deps.now();
    const recent = (this.failuresByIp.get(clientIp) ?? []).filter((at) => now - at < FAILURE_WINDOW_MS);
    this.failuresByIp.set(clientIp, recent);
    if (recent.length >= this.deps.maxFailuresPerMinute) return "rate-limited";

    const active = this.active;
    if (active && active.expiresAt >= now && normalize(input) === active.code) {
      this.active = null;
      return "ok";
    }
    recent.push(now);
    if (active) {
      active.failures += 1;
      if (active.failures >= this.deps.maxFailuresPerCode) this.active = null;
    }
    return "invalid";
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/main/remote/pairing-codes.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```powershell
git add src/main/remote/pairing-codes.ts src/main/remote/pairing-codes.test.ts
git commit -m @'
feat: add one-shot, rate-limited mobile pairing codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 6: PTY 크기 중재자

**Files:**
- Create: `src/main/remote/size-arbiter.ts`
- Test: `src/main/remote/size-arbiter.test.ts`

**Interfaces:**
- Consumes: `DESKTOP_SIZE_OWNER`, `SizeOwner` (Task 2)
- Produces: `class TerminalSizeArbiter` — `constructor(apply: (sessionId: string, cols: number, rows: number) => Promise<void>)`, `desktopResize(sessionId, cols, rows): Promise<void>`, `desktopInput(sessionId): Promise<void>`, `deviceResize(deviceId, sessionId, cols, rows): Promise<void>`, `deviceRelease(deviceId, sessionId): Promise<void>`, `current(sessionId): SizeState`, `onChange(listener: (sessionId: string, state: SizeState) => void): () => void`
- `interface SizeState { cols: number | null; rows: number | null; owner: SizeOwner }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { TerminalSizeArbiter } from "./size-arbiter";

function arbiter() {
  const apply = vi.fn(async (_id: string, _cols: number, _rows: number) => undefined);
  const sizes = new TerminalSizeArbiter(apply);
  const changes: Array<[string, unknown]> = [];
  sizes.onChange((id, state) => changes.push([id, state]));
  return { apply, sizes, changes };
}

describe("TerminalSizeArbiter", () => {
  it("passes desktop resizes straight through while the desktop owns the size", async () => {
    const { apply, sizes } = arbiter();
    await sizes.desktopResize("s", 120, 40);
    expect(apply).toHaveBeenCalledWith("s", 120, 40);
    expect(sizes.current("s")).toEqual({ cols: 120, rows: 40, owner: "desktop" });
  });

  it("attach alone never resizes: an unknown session reports no size", () => {
    const { apply, sizes } = arbiter();
    expect(sizes.current("s")).toEqual({ cols: null, rows: null, owner: "desktop" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("a device takes the size, and desktop input takes it back at the desktop's last size", async () => {
    const { apply, sizes, changes } = arbiter();
    await sizes.desktopResize("s", 120, 40);
    await sizes.deviceResize("phone", "s", 45, 30);
    expect(sizes.current("s")).toEqual({ cols: 45, rows: 30, owner: "phone" });
    await sizes.desktopInput("s");
    expect(apply).toHaveBeenLastCalledWith("s", 120, 40);
    expect(sizes.current("s").owner).toBe("desktop");
    expect(changes.at(-1)).toEqual(["s", { cols: 120, rows: 40, owner: "desktop" }]);
  });

  it("desktop input is free when the desktop already owns the size", async () => {
    const { apply, sizes } = arbiter();
    await sizes.desktopResize("s", 120, 40);
    apply.mockClear();
    await sizes.desktopInput("s");
    expect(apply).not.toHaveBeenCalled();
  });

  it("a desktop resize reclaims the size from a device", async () => {
    const { sizes } = arbiter();
    await sizes.deviceResize("phone", "s", 45, 30);
    await sizes.desktopResize("s", 100, 30);
    expect(sizes.current("s")).toEqual({ cols: 100, rows: 30, owner: "desktop" });
  });

  it("only the owning device can release, and release restores the desktop size", async () => {
    const { apply, sizes } = arbiter();
    await sizes.desktopResize("s", 120, 40);
    await sizes.deviceResize("phone", "s", 45, 30);
    await sizes.deviceRelease("tablet", "s");
    expect(sizes.current("s").owner).toBe("phone");
    await sizes.deviceRelease("phone", "s");
    expect(apply).toHaveBeenLastCalledWith("s", 120, 40);
    expect(sizes.current("s").owner).toBe("desktop");
  });

  it("release without a known desktop size just hands ownership back", async () => {
    const { apply, sizes } = arbiter();
    await sizes.deviceResize("phone", "s", 45, 30);
    apply.mockClear();
    await sizes.deviceRelease("phone", "s");
    expect(apply).not.toHaveBeenCalled();
    expect(sizes.current("s")).toEqual({ cols: 45, rows: 30, owner: "desktop" });
  });

  it("a failed resize changes nothing", async () => {
    const apply = vi.fn(async () => {
      throw new Error("Terminal dimensions are invalid");
    });
    const sizes = new TerminalSizeArbiter(apply);
    await expect(sizes.deviceResize("phone", "s", 1, 1)).rejects.toThrow();
    expect(sizes.current("s")).toEqual({ cols: null, rows: null, owner: "desktop" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote/size-arbiter.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
import { DESKTOP_SIZE_OWNER, type SizeOwner } from "../../shared/remote-types";

export interface SizeState {
  cols: number | null;
  rows: number | null;
  owner: SizeOwner;
}

interface Size {
  cols: number;
  rows: number;
}

/**
 * PTY는 크기가 하나뿐이라, 데스크톱 패인과 폰이 같은 세션을 볼 때 누가 크기를 정할지 여기서만
 * 정한다. 기본은 데스크톱이다. 폰은 "폰 크기로"를 켤 때만 가져가고, 데스크톱이 그 세션에 입력하거나
 * 패인 크기를 바꾸면 곧바로 데스크톱의 마지막 크기로 되돌아온다.
 */
export class TerminalSizeArbiter {
  private readonly desktop = new Map<string, Size>();
  private readonly applied = new Map<string, Size>();
  /** 세션 → 크기를 가진 deviceId. 없으면 데스크톱이다. */
  private readonly owners = new Map<string, string>();
  private readonly listeners = new Set<(sessionId: string, state: SizeState) => void>();

  constructor(private readonly apply: (sessionId: string, cols: number, rows: number) => Promise<void>) {}

  current(sessionId: string): SizeState {
    const size = this.applied.get(sessionId);
    return { cols: size?.cols ?? null, rows: size?.rows ?? null, owner: this.owners.get(sessionId) ?? DESKTOP_SIZE_OWNER };
  }

  onChange(listener: (sessionId: string, state: SizeState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async desktopResize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.resize(sessionId, cols, rows);
    this.desktop.set(sessionId, { cols, rows });
    this.owners.delete(sessionId);
    this.emit(sessionId);
  }

  async desktopInput(sessionId: string): Promise<void> {
    if (!this.owners.has(sessionId)) return;
    await this.reclaim(sessionId);
  }

  async deviceResize(deviceId: string, sessionId: string, cols: number, rows: number): Promise<void> {
    await this.resize(sessionId, cols, rows);
    this.owners.set(sessionId, deviceId);
    this.emit(sessionId);
  }

  async deviceRelease(deviceId: string, sessionId: string): Promise<void> {
    if (this.owners.get(sessionId) !== deviceId) return;
    await this.reclaim(sessionId);
  }

  private async reclaim(sessionId: string): Promise<void> {
    const size = this.desktop.get(sessionId);
    if (size) await this.resize(sessionId, size.cols, size.rows);
    this.owners.delete(sessionId);
    this.emit(sessionId);
  }

  private async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.apply(sessionId, cols, rows);
    this.applied.set(sessionId, { cols, rows });
  }

  private emit(sessionId: string): void {
    const state = this.current(sessionId);
    for (const listener of this.listeners) listener(sessionId, state);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/main/remote/size-arbiter.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```powershell
git add src/main/remote/size-arbiter.ts src/main/remote/size-arbiter.test.ts
git commit -m @'
feat: arbitrate PTY size between the desktop and a phone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 7: 세션 허브 (연결별 프로토콜 처리)

**Files:**
- Create: `src/main/remote/remote-session-hub.ts`
- Test: `src/main/remote/remote-session-hub.test.ts`

**Interfaces:**
- Consumes: Task 2 타입·`parseRemoteClientMessage`·`REMOTE_CLOSE`, Task 4 `RemoteDevice`, Task 6 `TerminalSizeArbiter`/`SizeState`, `TerminalSessionView`·`TerminalAttachResult` (`src/shared/api-types.ts`), `TerminalEvent` (`src/shared/terminal-types.ts`)
- Produces:
  - `interface RemoteHubGateway { list(): TerminalSessionView[]; attach(sessionId: string): Promise<TerminalAttachResult>; write(sessionId: string, data: string): Promise<void>; onEvent(listener: (event: TerminalEvent) => void): () => void; projectName(projectId: string): Promise<string | null> }`
  - `interface RemoteHubDevices { verify(token: string): Promise<RemoteDevice | null>; touch(deviceId: string): Promise<void> }`
  - `interface RemoteConnection { send(message: RemoteServerMessage): void; close(code: number, reason: string): void }`
  - `interface RemoteClientHandle { receive(raw: string): void; closed(): void }`
  - `class RemoteSessionHub` — `constructor(options: RemoteHubOptions)`, `open(connection): RemoteClientHandle`, `disconnectDevice(deviceId: string): void`, `dispose(): void`
  - `RemoteHubOptions { gateway; devices; sizes: TerminalSizeArbiter; hostId(): Promise<string>; hostName: string; helloTimeoutMs?: number }`
  - `toSessionSummary(view: TerminalSessionView, projectName: string | null): RemoteSessionSummary`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalSessionView } from "../../shared/api-types";
import type { TerminalEvent } from "../../shared/terminal-types";
import { REMOTE_CLOSE, REMOTE_PROTOCOL_VERSION, type RemoteServerMessage } from "../../shared/remote-types";
import { RemoteSessionHub } from "./remote-session-hub";
import { TerminalSizeArbiter } from "./size-arbiter";

const view = (id: string, overrides: Partial<TerminalSessionView> = {}): TerminalSessionView => ({
  id,
  projectId: "p1",
  tool: null,
  title: "제목",
  name: null,
  kind: "claude",
  cwd: "C:/work",
  providerConversationId: null,
  interruptedByShutdown: false,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
  status: "working",
  pid: 1,
  exitCode: null,
  ...overrides,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const listeners = new Set<(event: TerminalEvent) => void>();
  let resolveAttach: ((value: { session: TerminalSessionView; replay: string; sequence: number }) => void) | null = null;
  const gateway = {
    list: vi.fn(() => [view("s1")]),
    attach: vi.fn(
      () =>
        new Promise<{ session: TerminalSessionView; replay: string; sequence: number }>((resolve) => {
          resolveAttach = resolve;
        }),
    ),
    write: vi.fn(async () => undefined),
    onEvent: (listener: (event: TerminalEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    projectName: vi.fn(async () => "Sample Project"),
  };
  const devices = {
    verify: vi.fn(async (token: string) =>
      token === "good" ? { deviceId: "phone", name: "폰", tokenHash: "", createdAt: "", lastSeenAt: null } : null,
    ),
    touch: vi.fn(async () => undefined),
  };
  const resize = vi.fn(async () => undefined);
  const sizes = new TerminalSizeArbiter(resize);
  const hub = new RemoteSessionHub({ gateway, devices, sizes, hostId: async () => "host-1", hostName: "PC", helloTimeoutMs: 50 });
  const sent: RemoteServerMessage[] = [];
  const close = vi.fn();
  const handle = hub.open({ send: (message) => sent.push(message), close });
  const emit = (event: TerminalEvent) => listeners.forEach((listener) => listener(event));
  const attachWith = (replay: string, sequence: number) => resolveAttach!({ session: view("s1"), replay, sequence });
  const hello = async (token = "good") => {
    handle.receive(JSON.stringify({ type: "hello", token, protocolVersion: REMOTE_PROTOCOL_VERSION, mode: "ui" }));
    await flush();
    await flush();
  };
  return { hub, handle, sent, close, emit, gateway, devices, sizes, resize, hello, attachWith };
}

afterEach(() => vi.useRealTimers());

describe("RemoteSessionHub", () => {
  it("welcomes a valid token and sends the session list", async () => {
    const { sent, hello, devices } = setup();
    await hello();
    expect(sent[0]).toEqual({ type: "welcome", hostId: "host-1", hostName: "PC", deviceId: "phone", protocolVersion: 1 });
    expect(sent[1]).toEqual({
      type: "sessions",
      sessions: [
        {
          id: "s1",
          projectId: "p1",
          projectName: "Sample Project",
          kind: "claude",
          label: "제목",
          status: "working",
          updatedAt: "2026-09-30T00:00:00.000Z",
        },
      ],
    });
    expect(devices.touch).toHaveBeenCalledWith("phone");
  });

  it("closes with 4401 on a bad token or when the first message is not hello", async () => {
    const bad = setup();
    await bad.hello("bad");
    expect(bad.close).toHaveBeenCalledWith(REMOTE_CLOSE.unauthorized, expect.any(String));

    const early = setup();
    early.handle.receive('{"type":"list"}');
    await flush();
    expect(early.close).toHaveBeenCalledWith(REMOTE_CLOSE.unauthorized, expect.any(String));
  });

  it("closes with 4400 on a protocol version mismatch", async () => {
    const { handle, close } = setup();
    handle.receive(JSON.stringify({ type: "hello", token: "good", protocolVersion: 99, mode: "ui" }));
    await flush();
    expect(close).toHaveBeenCalledWith(REMOTE_CLOSE.protocol, expect.any(String));
  });

  it("closes a connection that never says hello", async () => {
    const { close } = setup();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(close).toHaveBeenCalledWith(REMOTE_CLOSE.unauthorized, "hello timeout");
  });

  it("forwards data that arrives while attach is in flight, and only for attached sessions", async () => {
    const { handle, sent, emit, hello, attachWith } = setup();
    await hello();
    handle.receive('{"type":"attach","sessionId":"s1"}');
    await flush();
    emit({ type: "data", sessionId: "s1", data: "early", sequence: 6 });
    emit({ type: "data", sessionId: "other", data: "nope", sequence: 1 });
    attachWith("replay", 5);
    await flush();
    const types = sent.slice(2).map((message) => message.type);
    expect(types).toEqual(["data", "attached"]);
    expect(sent.at(-1)).toEqual({
      type: "attached",
      sessionId: "s1",
      replay: "replay",
      sequence: 5,
      cols: null,
      rows: null,
      sizeOwner: "desktop",
    });
  });

  it("attach alone never resizes the PTY", async () => {
    const { handle, hello, attachWith, resize } = setup();
    await hello();
    handle.receive('{"type":"attach","sessionId":"s1"}');
    await flush();
    attachWith("", 0);
    await flush();
    expect(resize).not.toHaveBeenCalled();
  });

  it("writes only to attached sessions", async () => {
    const { handle, sent, hello, attachWith, gateway } = setup();
    await hello();
    handle.receive('{"type":"write","sessionId":"s1","data":"x"}');
    await flush();
    expect(sent.at(-1)).toMatchObject({ type: "error", code: "not-attached" });
    handle.receive('{"type":"attach","sessionId":"s1"}');
    await flush();
    attachWith("", 0);
    await flush();
    handle.receive('{"type":"write","sessionId":"s1","data":"x"}');
    await flush();
    expect(gateway.write).toHaveBeenCalledWith("s1", "x");
  });

  it("broadcasts size changes to attached clients and releases the size on close", async () => {
    const { handle, sent, hello, attachWith, sizes } = setup();
    await hello();
    handle.receive('{"type":"attach","sessionId":"s1"}');
    await flush();
    attachWith("", 0);
    await flush();
    await sizes.desktopResize("s1", 120, 40);
    handle.receive('{"type":"resize","sessionId":"s1","cols":45,"rows":30}');
    await flush();
    expect(sent.at(-1)).toEqual({ type: "size", sessionId: "s1", cols: 45, rows: 30, sizeOwner: "phone" });
    handle.closed();
    await flush();
    expect(sizes.current("s1")).toEqual({ cols: 120, rows: 40, owner: "desktop" });
  });

  it("relays status, title, and exit to every authenticated client", async () => {
    const { sent, emit, hello } = setup();
    await hello();
    emit({ type: "status", sessionId: "s9", status: "awaiting-input" });
    emit({ type: "title", sessionId: "s9", title: "새 제목" });
    emit({ type: "exit", sessionId: "s9", exitCode: 0 });
    expect(sent.slice(-3)).toEqual([
      { type: "status", sessionId: "s9", status: "awaiting-input" },
      { type: "title", sessionId: "s9", title: "새 제목" },
      { type: "exit", sessionId: "s9", exitCode: 0 },
    ]);
  });

  it("disconnectDevice closes that device's connections with 4403", async () => {
    const { hub, close, hello } = setup();
    await hello();
    hub.disconnectDevice("phone");
    expect(close).toHaveBeenCalledWith(REMOTE_CLOSE.revoked, "revoked");
  });

  it("answers garbage with an error instead of throwing", async () => {
    const { handle, sent, hello } = setup();
    await hello();
    handle.receive("{{{");
    await flush();
    expect(sent.at(-1)).toMatchObject({ type: "error", code: "bad-message" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote/remote-session-hub.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
import type { TerminalAttachResult, TerminalSessionView } from "../../shared/api-types";
import type { TerminalEvent } from "../../shared/terminal-types";
import {
  parseRemoteClientMessage,
  REMOTE_CLOSE,
  REMOTE_PROTOCOL_VERSION,
  type RemoteClientMessage,
  type RemoteServerMessage,
  type RemoteSessionSummary,
} from "../../shared/remote-types";
import type { RemoteDevice } from "./device-store";
import type { SizeState, TerminalSizeArbiter } from "./size-arbiter";

export interface RemoteHubGateway {
  list(): TerminalSessionView[];
  /** 데스크톱의 attachForRenderer와 같되 크기를 넘기지 않는다 — 폰이 붙는다고 PTY 크기가 바뀌면 안 된다. */
  attach(sessionId: string): Promise<TerminalAttachResult>;
  write(sessionId: string, data: string): Promise<void>;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
  projectName(projectId: string): Promise<string | null>;
}

export interface RemoteHubDevices {
  verify(token: string): Promise<RemoteDevice | null>;
  touch(deviceId: string): Promise<void>;
}

export interface RemoteConnection {
  send(message: RemoteServerMessage): void;
  close(code: number, reason: string): void;
}

export interface RemoteClientHandle {
  receive(raw: string): void;
  closed(): void;
}

export interface RemoteHubOptions {
  gateway: RemoteHubGateway;
  devices: RemoteHubDevices;
  sizes: TerminalSizeArbiter;
  hostId(): Promise<string>;
  hostName: string;
  helloTimeoutMs?: number;
}

interface Client {
  connection: RemoteConnection;
  device: RemoteDevice | null;
  attached: Set<string>;
  helloTimer: ReturnType<typeof setTimeout>;
}

export function toSessionSummary(view: TerminalSessionView, projectName: string | null): RemoteSessionSummary {
  return {
    id: view.id,
    projectId: view.projectId,
    projectName,
    kind: view.kind,
    label: view.name ?? view.title ?? view.kind,
    status: view.status,
    updatedAt: view.updatedAt,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 모바일 연결 하나하나의 프로토콜을 소켓과 떼어 둔 곳. 서버(remote-server.ts)는 바이트를 옮기고,
 * 여기는 인증·세션 붙기·입력·크기만 다룬다. 한 연결의 메시지는 도착 순서대로 하나씩 처리한다.
 */
export class RemoteSessionHub {
  private readonly clients = new Set<Client>();
  private readonly unsubscribes: Array<() => void>;

  constructor(private readonly options: RemoteHubOptions) {
    this.unsubscribes = [
      options.gateway.onEvent((event) => this.forward(event)),
      options.sizes.onChange((sessionId, state) => this.broadcastSize(sessionId, state)),
    ];
  }

  open(connection: RemoteConnection): RemoteClientHandle {
    const client: Client = {
      connection,
      device: null,
      attached: new Set(),
      helloTimer: setTimeout(
        () => connection.close(REMOTE_CLOSE.unauthorized, "hello timeout"),
        this.options.helloTimeoutMs ?? 10_000,
      ),
    };
    this.clients.add(client);
    let queue = Promise.resolve();
    return {
      receive: (raw) => {
        queue = queue
          .then(() => this.handle(client, raw))
          .catch((error) => connection.send({ type: "error", code: "failed", message: errorText(error) }));
      },
      closed: () => {
        queue = queue.then(() => this.drop(client));
      },
    };
  }

  disconnectDevice(deviceId: string): void {
    for (const client of this.clients) {
      if (client.device?.deviceId === deviceId) client.connection.close(REMOTE_CLOSE.revoked, "revoked");
    }
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    for (const client of this.clients) {
      clearTimeout(client.helloTimer);
      client.connection.close(1001, "host shutting down");
    }
    this.clients.clear();
  }

  private async handle(client: Client, raw: string): Promise<void> {
    const message = parseRemoteClientMessage(raw);
    if (!message) {
      client.connection.send({ type: "error", code: "bad-message", message: "알 수 없는 메시지입니다" });
      return;
    }
    if (client.device === null) {
      await this.authenticate(client, message);
      return;
    }
    const deviceId = client.device.deviceId;
    switch (message.type) {
      case "hello":
        return;
      case "list":
        client.connection.send({ type: "sessions", sessions: await this.summaries() });
        return;
      case "attach": {
        // 먼저 붙여 두어야 attach가 도는 동안 나온 출력도 전달된다. 클라이언트가 sequence로 중복을 버린다.
        client.attached.add(message.sessionId);
        const result = await this.options.gateway.attach(message.sessionId);
        const size = this.options.sizes.current(message.sessionId);
        client.connection.send({
          type: "attached",
          sessionId: message.sessionId,
          replay: result.replay,
          sequence: result.sequence,
          cols: size.cols,
          rows: size.rows,
          sizeOwner: size.owner,
        });
        return;
      }
      case "detach":
        client.attached.delete(message.sessionId);
        await this.options.sizes.deviceRelease(deviceId, message.sessionId);
        return;
      case "write":
        if (!this.requireAttached(client, message.sessionId)) return;
        await this.options.gateway.write(message.sessionId, message.data);
        return;
      case "resize":
        if (!this.requireAttached(client, message.sessionId)) return;
        await this.options.sizes.deviceResize(deviceId, message.sessionId, message.cols, message.rows);
        return;
      case "releaseSize":
        await this.options.sizes.deviceRelease(deviceId, message.sessionId);
        return;
    }
  }

  private async authenticate(client: Client, message: RemoteClientMessage): Promise<void> {
    if (message.type !== "hello") {
      client.connection.close(REMOTE_CLOSE.unauthorized, "hello required");
      return;
    }
    if (message.protocolVersion !== REMOTE_PROTOCOL_VERSION) {
      client.connection.send({ type: "error", code: "protocol", message: "앱 버전이 호스트와 맞지 않습니다" });
      client.connection.close(REMOTE_CLOSE.protocol, "protocol mismatch");
      return;
    }
    const device = await this.options.devices.verify(message.token);
    if (!device) {
      client.connection.send({ type: "error", code: "unauthorized", message: "등록되지 않은 기기입니다" });
      client.connection.close(REMOTE_CLOSE.unauthorized, "unauthorized");
      return;
    }
    clearTimeout(client.helloTimer);
    client.device = device;
    void this.options.devices.touch(device.deviceId).catch(() => undefined);
    client.connection.send({
      type: "welcome",
      hostId: await this.options.hostId(),
      hostName: this.options.hostName,
      deviceId: device.deviceId,
      protocolVersion: REMOTE_PROTOCOL_VERSION,
    });
    client.connection.send({ type: "sessions", sessions: await this.summaries() });
  }

  private requireAttached(client: Client, sessionId: string): boolean {
    if (client.attached.has(sessionId)) return true;
    client.connection.send({ type: "error", code: "not-attached", message: "세션에 먼저 연결하세요" });
    return false;
  }

  private async drop(client: Client): Promise<void> {
    clearTimeout(client.helloTimer);
    this.clients.delete(client);
    if (!client.device) return;
    for (const sessionId of client.attached) {
      await this.options.sizes.deviceRelease(client.device.deviceId, sessionId).catch(() => undefined);
    }
  }

  private async summaries(): Promise<RemoteSessionSummary[]> {
    const views = this.options.gateway.list();
    const names = new Map<string, string | null>();
    for (const projectId of new Set(views.map((view) => view.projectId))) {
      if (projectId !== null) names.set(projectId, await this.options.gateway.projectName(projectId));
    }
    return views.map((view) => toSessionSummary(view, view.projectId === null ? null : names.get(view.projectId) ?? null));
  }

  private authenticated(): Client[] {
    return [...this.clients].filter((client) => client.device !== null);
  }

  private forward(event: TerminalEvent): void {
    switch (event.type) {
      case "data":
        for (const client of this.authenticated()) {
          if (client.attached.has(event.sessionId)) {
            client.connection.send({ type: "data", sessionId: event.sessionId, data: event.data, sequence: event.sequence });
          }
        }
        return;
      case "status":
        this.broadcast({ type: "status", sessionId: event.sessionId, status: event.status });
        return;
      case "title":
        this.broadcast({ type: "title", sessionId: event.sessionId, title: event.title });
        return;
      case "exit":
        this.broadcast({ type: "exit", sessionId: event.sessionId, exitCode: event.exitCode });
        return;
      case "created": {
        const projectId = event.session.projectId;
        void (projectId === null ? Promise.resolve(null) : this.options.gateway.projectName(projectId))
          .then((name) => this.broadcast({ type: "created", session: toSessionSummary(event.session, name) }))
          .catch(() => undefined);
        return;
      }
      default:
        return;
    }
  }

  private broadcast(message: RemoteServerMessage): void {
    for (const client of this.authenticated()) client.connection.send(message);
  }

  private broadcastSize(sessionId: string, state: SizeState): void {
    if (state.cols === null || state.rows === null) return;
    for (const client of this.authenticated()) {
      if (client.attached.has(sessionId)) {
        client.connection.send({ type: "size", sessionId, cols: state.cols, rows: state.rows, sizeOwner: state.owner });
      }
    }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/main/remote/remote-session-hub.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```powershell
git add src/main/remote/remote-session-hub.ts src/main/remote/remote-session-hub.test.ts
git commit -m @'
feat: handle the mobile session protocol independent of sockets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 8: HTTP·WS 서버

**Files:**
- Modify: `package.json` (`dependencies`에 `"ws": "8.21.0"`, `devDependencies`에 `"@types/ws"`)
- Create: `src/main/remote/remote-server.ts`
- Test: `src/main/remote/remote-server.test.ts`

**Interfaces:**
- Consumes: Task 7 `RemoteSessionHub`(의 `open`), Task 2 `RemotePairResponse`
- Produces:
  - `type PairOutcome = { ok: true; response: RemotePairResponse } | { ok: false; reason: "invalid" | "rate-limited" }`
  - `interface RemoteServerOptions { host: string; port: number; rendererDir: string; hub: Pick<RemoteSessionHub, "open">; pair(code: string, deviceName: string, clientIp: string): Promise<PairOutcome>; pingIntervalMs?: number }`
  - `interface RunningRemoteServer { host: string; port: number; close(): Promise<void> }`
  - `startRemoteServer(options: RemoteServerOptions): Promise<RunningRemoteServer>` (port 0이면 임의 포트, 실제 포트를 돌려준다)

- [ ] **Step 1: 의존성 추가**

```powershell
npm install ws@8.21.0 --save-exact
npm install @types/ws --save-dev --save-exact
```

`package.json`에 두 줄이 생겼는지 확인한다. `ws`는 순수 JS라 electron-rebuild가 필요 없다.

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// @vitest-environment node

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { RemoteConnection } from "./remote-session-hub";
import { startRemoteServer, type RunningRemoteServer } from "./remote-server";

const servers: RunningRemoteServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function rendererDir(withBundle = true) {
  const dir = await mkdtemp(path.join(tmpdir(), "mcw-renderer-"));
  if (withBundle) {
    await mkdir(path.join(dir, "assets"));
    await writeFile(path.join(dir, "mobile.html"), "<!doctype html><title>mobile</title>");
    await writeFile(path.join(dir, "assets", "mobile-abc.js"), "console.log(1)");
  }
  return dir;
}

async function start(options: { withBundle?: boolean; pair?: () => Promise<never> } = {}) {
  const connections: RemoteConnection[] = [];
  const received: string[] = [];
  const hub = {
    open: vi.fn((connection: RemoteConnection) => {
      connections.push(connection);
      return { receive: (raw: string) => received.push(raw), closed: vi.fn() };
    }),
  };
  const pair = vi.fn(
    options.pair ??
      (async (code: string) =>
        code === "GOOD"
          ? { ok: true as const, response: { token: "t", deviceId: "d", hostId: "h", hostName: "PC" } }
          : { ok: false as const, reason: "invalid" as const }),
  );
  const server = await startRemoteServer({ host: "127.0.0.1", port: 0, rendererDir: await rendererDir(options.withBundle), hub, pair });
  servers.push(server);
  return { server, base: `http://127.0.0.1:${server.port}`, hub, pair, connections, received };
}

describe("startRemoteServer", () => {
  it("serves the mobile page and hashed assets", async () => {
    const { base } = await start();
    const page = await fetch(`${base}/mobile/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("cache-control")).toBe("no-cache");
    const asset = await fetch(`${base}/mobile/assets/mobile-abc.js`);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    const root = await fetch(`${base}/`, { redirect: "manual" });
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/mobile/");
  });

  it("refuses path traversal and unknown paths", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/mobile/assets/..%2Fmobile.html`)).status).toBe(404);
    expect((await fetch(`${base}/mobile/assets/../../etc/passwd`)).status).toBe(404);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("503 when the mobile bundle is missing", async () => {
    const { base } = await start({ withBundle: false });
    const response = await fetch(`${base}/mobile/`);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("npm run build");
  });

  it("pairs through POST /pair", async () => {
    const { base, pair } = await start();
    const ok = await fetch(`${base}/pair`, { method: "POST", body: JSON.stringify({ code: "GOOD", deviceName: "폰" }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ token: "t", deviceId: "d", hostId: "h", hostName: "PC" });
    expect(pair).toHaveBeenCalledWith("GOOD", "폰", "127.0.0.1");
    expect((await fetch(`${base}/pair`, { method: "POST", body: '{"code":"BAD","deviceName":"x"}' })).status).toBe(401);
    expect((await fetch(`${base}/pair`, { method: "POST", body: "nope" })).status).toBe(400);
  });

  it("maps a rate-limited pairing to 429", async () => {
    const { base } = await start({ pair: async () => ({ ok: false, reason: "rate-limited" }) as never });
    expect((await fetch(`${base}/pair`, { method: "POST", body: '{"code":"X","deviceName":"x"}' })).status).toBe(429);
  });

  it("hands WS text frames to the hub and sends hub messages back", async () => {
    const { server, connections, received } = await start();
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    await new Promise((resolve) => socket.once("open", resolve));
    socket.send('{"type":"list"}');
    await vi.waitFor(() => expect(received).toEqual(['{"type":"list"}']));
    const message = new Promise<string>((resolve) => socket.once("message", (data) => resolve(String(data))));
    connections[0]!.send({ type: "sessions", sessions: [] });
    expect(JSON.parse(await message)).toEqual({ type: "sessions", sessions: [] });
    socket.close();
  });

  it("rejects a WS upgrade from a foreign origin or on another path", async () => {
    const { server } = await start();
    const foreign = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers: { Origin: "http://evil.example" } });
    await expect(new Promise((_, reject) => foreign.once("error", reject))).rejects.toThrow(/403/);
    const wrongPath = new WebSocket(`ws://127.0.0.1:${server.port}/other`);
    await expect(new Promise((_, reject) => wrongPath.once("error", reject))).rejects.toThrow(/404/);
  });

  it("accepts a same-origin WS upgrade", async () => {
    const { server } = await start();
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
      headers: { Origin: `http://127.0.0.1:${server.port}` },
    });
    await new Promise((resolve) => socket.once("open", resolve));
    socket.close();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote/remote-server.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 4: 구현**

```ts
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import type { RemotePairResponse } from "../../shared/remote-types";
import type { RemoteSessionHub } from "./remote-session-hub";

export type PairOutcome = { ok: true; response: RemotePairResponse } | { ok: false; reason: "invalid" | "rate-limited" };

export interface RemoteServerOptions {
  host: string;
  port: number;
  /** out/renderer — mobile.html과 assets/가 있는 곳. */
  rendererDir: string;
  hub: Pick<RemoteSessionHub, "open">;
  pair(code: string, deviceName: string, clientIp: string): Promise<PairOutcome>;
  pingIntervalMs?: number;
}

export interface RunningRemoteServer {
  host: string;
  port: number;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const ASSET_NAME = /^[\w.-]+$/;
const MAX_PAIR_BODY_BYTES = 4_096;
const MAX_WS_PAYLOAD_BYTES = 1024 * 1024;

function send(response: http.ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
}

async function serveFile(response: http.ServerResponse, filePath: string, cacheControl: string): Promise<boolean> {
  let body: Buffer;
  try {
    body = await fs.readFile(filePath);
  } catch {
    return false;
  }
  response.writeHead(200, {
    "content-type": CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream",
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
  return true;
}

function readBody(request: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAIR_BODY_BYTES) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(null));
  });
}

function clientIp(request: http.IncomingMessage): string {
  return (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

async function handlePair(options: RemoteServerOptions, request: http.IncomingMessage, response: http.ServerResponse) {
  const body = await readBody(request);
  let parsed: unknown;
  try {
    parsed = body === null ? null : JSON.parse(body);
  } catch {
    parsed = null;
  }
  const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  if (!record || typeof record.code !== "string" || typeof record.deviceName !== "string") {
    send(response, 400, "잘못된 요청입니다");
    return;
  }
  const outcome = await options.pair(record.code, record.deviceName, clientIp(request));
  if (outcome.ok) send(response, 200, JSON.stringify(outcome.response), CONTENT_TYPES[".json"]);
  else if (outcome.reason === "rate-limited") send(response, 429, "시도가 너무 많습니다");
  else send(response, 401, "코드가 맞지 않거나 만료되었습니다");
}

async function handleRequest(options: RemoteServerOptions, request: http.IncomingMessage, response: http.ServerResponse) {
  const url = new URL(request.url ?? "/", "http://host");
  const pathname = url.pathname;
  if (request.method === "POST" && pathname === "/pair") return handlePair(options, request, response);
  if (request.method !== "GET") return send(response, 405, "허용되지 않는 요청입니다");
  if (pathname === "/") {
    response.writeHead(302, { location: "/mobile/" });
    response.end();
    return;
  }
  if (pathname === "/mobile" || pathname === "/mobile/") {
    const served = await serveFile(response, path.join(options.rendererDir, "mobile.html"), "no-cache");
    if (!served) send(response, 503, "모바일 화면 번들이 없습니다. 호스트에서 npm run build를 먼저 실행하세요.");
    return;
  }
  const assetPrefix = "/mobile/assets/";
  if (pathname.startsWith(assetPrefix)) {
    const name = decodeURIComponent(pathname.slice(assetPrefix.length));
    if (ASSET_NAME.test(name) && !name.startsWith(".")) {
      const served = await serveFile(response, path.join(options.rendererDir, "assets", name), "public, max-age=31536000, immutable");
      if (served) return;
    }
  }
  send(response, 404, "없는 경로입니다");
}

function rejectUpgrade(socket: import("node:stream").Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * 모바일 컴패니언용 HTTP + WS 서버. 무엇에 bind할지(Tailscale 주소)는 remote-access.ts가 정하고,
 * 이 파일은 받은 주소에만 listen한다.
 */
export async function startRemoteServer(options: RemoteServerOptions): Promise<RunningRemoteServer> {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  const server = http.createServer((request, response) => {
    handleRequest(options, request, response).catch(() => {
      if (!response.headersSent) send(response, 500, "서버 오류");
      else response.end();
    });
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://host").pathname;
    if (pathname !== "/ws") return rejectUpgrade(socket, 404, "Not Found");
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== `http://${request.headers.host}`) {
      return rejectUpgrade(socket, 403, "Forbidden");
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      alive.set(ws, true);
      ws.on("pong", () => alive.set(ws, true));
      const handle = options.hub.open({
        send: (message) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
        },
        close: (code, reason) => ws.close(code, reason),
      });
      ws.on("message", (data, isBinary) => {
        if (isBinary) ws.close(1003, "text only");
        else handle.receive(data.toString());
      });
      ws.on("close", () => handle.closed());
    });
  });

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, options.pingIntervalMs ?? 30_000);
  ping.unref();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;

  return {
    host: options.host,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(ping);
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run --pool=threads src/main/remote/remote-server.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```powershell
git add package.json package-lock.json src/main/remote/remote-server.ts src/main/remote/remote-server.test.ts
git commit -m @'
feat: serve the mobile page, pairing, and the session socket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 9: 원격 접속 컨트롤러 + main 배선

**Files:**
- Create: `src/main/remote/remote-access.ts`
- Test: `src/main/remote/remote-access.test.ts`
- Modify: `src/main/ipc.ts` (의존성 `remote`·`sizes`, 채널 4개, `terminals:write`/`terminals:resize` 경유 변경)
- Modify: `src/main/ipc.test.ts` (의존성 fixture에 `remote`·`sizes` mock 추가 + 테스트)
- Modify: `src/preload/index.ts`, `src/shared/api-types.ts` (`remote` API)
- Modify: `src/main/runtime.ts`

**Interfaces:**
- Consumes: Task 1 `RemoteSettings`, Task 3 `tailscaleAddresses`, Task 4 `RemoteDeviceStore`, Task 5 `PairingCodes`, Task 7 `RemoteSessionHub`, Task 8 `startRemoteServer`/`PairOutcome`
- Produces:
  - `class RemoteAccess` — `apply(settings: RemoteSettings): Promise<RemoteAccessStatus>`, `status(): RemoteAccessStatus`, `issuePairingCode(): RemotePairingCode`, `pair(code, deviceName, clientIp): Promise<PairOutcome>`, `listDevices(): Promise<RemoteDeviceInfo[]>`, `revokeDevice(deviceId: string): Promise<void>`, `dispose(): Promise<void>`
  - IPC 채널: `remote:status`, `remote:issue-pairing-code`, `remote:list-devices`, `remote:revoke-device`
  - `window.multiCliWork.remote: { status(): Promise<RemoteAccessStatus>; issuePairingCode(): Promise<RemotePairingCode>; listDevices(): Promise<RemoteDeviceInfo[]>; revokeDevice(deviceId: string): Promise<void> }`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/remote/remote-access.test.ts`:

```ts
// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteAccess, type RemoteAccessOptions } from "./remote-access";

function setup(overrides: Partial<RemoteAccessOptions> = {}) {
  let addresses = ["100.101.102.103"];
  const close = vi.fn(async () => undefined);
  const start = vi.fn(async (options: { host: string; port: number }) => ({ host: options.host, port: options.port, close }));
  const devices = {
    hostId: vi.fn(async () => "host-1"),
    list: vi.fn(async () => [{ deviceId: "d1", name: "폰", tokenHash: "x".repeat(64), createdAt: "c", lastSeenAt: null }]),
    register: vi.fn(async () => ({
      device: { deviceId: "d2", name: "폰", tokenHash: "", createdAt: "", lastSeenAt: null },
      token: "tok",
    })),
    revoke: vi.fn(async () => true),
  };
  const pairing = { issue: vi.fn(() => ({ code: "ABCD-EFGH", expiresAt: 1_000 })), consume: vi.fn(() => "ok" as const) };
  const hub = { open: vi.fn(), disconnectDevice: vi.fn(), dispose: vi.fn() };
  const access = new RemoteAccess({
    hub,
    devices,
    pairing,
    rendererDir: "out/renderer",
    hostName: "PC",
    bindOverride: null,
    addresses: () => addresses,
    start: start as never,
    retryMs: 20,
    ...overrides,
  });
  return { access, start, close, devices, pairing, hub, setAddresses: (next: string[]) => (addresses = next) };
}

afterEach(() => vi.useRealTimers());

describe("RemoteAccess", () => {
  it("stays off by default and listens on the Tailscale address when enabled", async () => {
    const { access, start } = setup();
    expect((await access.apply({ enabled: false, port: 47821 })).state).toBe("off");
    expect(start).not.toHaveBeenCalled();
    const status = await access.apply({ enabled: true, port: 47821 });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ host: "100.101.102.103", port: 47821 }));
    expect(status).toEqual({ state: "listening", url: "http://100.101.102.103:47821/mobile/", port: 47821, message: null });
  });

  it("does not restart for an unchanged setting, restarts on a port change, and stops when disabled", async () => {
    const { access, start, close } = setup();
    await access.apply({ enabled: true, port: 47821 });
    await access.apply({ enabled: true, port: 47821 });
    expect(start).toHaveBeenCalledTimes(1);
    await access.apply({ enabled: true, port: 50000 });
    expect(close).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
    await access.apply({ enabled: false, port: 50000 });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("reports no-tailscale and never binds anything else", async () => {
    const { access, start, setAddresses } = setup();
    setAddresses([]);
    const status = await access.apply({ enabled: true, port: 47821 });
    expect(status.state).toBe("no-tailscale");
    expect(status.message).toContain("Tailscale");
    expect(start).not.toHaveBeenCalled();
    await access.dispose(); // 재시도 타이머를 멈춘다
  });

  it("retries when Tailscale appears later", async () => {
    const { access, start, setAddresses } = setup();
    setAddresses([]);
    await access.apply({ enabled: true, port: 47821 });
    setAddresses(["100.64.0.9"]);
    await vi.waitFor(() => expect(access.status().state).toBe("listening"), { timeout: 500 });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ host: "100.64.0.9" }));
    await access.dispose();
  });

  it("uses the env bind override instead of Tailscale", async () => {
    const { access, start } = setup({ bindOverride: "127.0.0.1", addresses: () => [] });
    await access.apply({ enabled: true, port: 47821 });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ host: "127.0.0.1" }));
  });

  it("reports a listen failure as an error state", async () => {
    const { access } = setup({ start: (async () => { throw new Error("listen EADDRINUSE"); }) as never });
    const status = await access.apply({ enabled: true, port: 47821 });
    expect(status).toMatchObject({ state: "error", message: expect.stringContaining("EADDRINUSE") });
  });

  it("issues a pairing code only while listening", async () => {
    const { access } = setup();
    expect(() => access.issuePairingCode()).toThrow(/켜져/);
    await access.apply({ enabled: true, port: 47821 });
    expect(access.issuePairingCode()).toEqual({
      code: "ABCD-EFGH",
      expiresAt: new Date(1_000).toISOString(),
      url: "http://100.101.102.103:47821/mobile/",
    });
  });

  it("pairs a device through the one-shot code", async () => {
    const { access, devices } = setup();
    await expect(access.pair("ABCD-EFGH", "폰", "100.1.1.1")).resolves.toEqual({
      ok: true,
      response: { token: "tok", deviceId: "d2", hostId: "host-1", hostName: "PC" },
    });
    expect(devices.register).toHaveBeenCalledWith("폰");
  });

  it("lists devices without hashes and disconnects a revoked one", async () => {
    const { access, hub } = setup();
    expect(await access.listDevices()).toEqual([{ deviceId: "d1", name: "폰", createdAt: "c", lastSeenAt: null }]);
    await access.revokeDevice("d1");
    expect(hub.disconnectDevice).toHaveBeenCalledWith("d1");
  });
});
```

`src/main/ipc.test.ts` — 의존성 fixture에 다음 mock을 추가하고(fixture를 만드는 곳에 맞춰 넣는다), 테스트를 추가한다:

```ts
const remoteGateway = {
  status: vi.fn(() => ({ state: "off" as const, url: null, port: 47821, message: null })),
  issuePairingCode: vi.fn(() => ({ code: "ABCD-EFGH", expiresAt: "x", url: "u" })),
  listDevices: vi.fn(async () => []),
  revokeDevice: vi.fn(async (_deviceId: string) => undefined),
};
const sizesGateway = {
  desktopResize: vi.fn(async (_id: string, _cols: number, _rows: number) => undefined),
  desktopInput: vi.fn(async (_id: string) => undefined),
};
// dependencies 객체에: remote: remoteGateway, sizes: sizesGateway,

it("routes desktop resize and input through the size arbiter", async () => {
  await handlers.get("terminals:resize")!({}, "s1", 120, 40);
  expect(sizesGateway.desktopResize).toHaveBeenCalledWith("s1", 120, 40);
  await handlers.get("terminals:write")!({}, "s1", "x");
  expect(sizesGateway.desktopInput).toHaveBeenCalledWith("s1");
});

it("exposes remote access status, pairing, and device revocation", async () => {
  await expect(handlers.get("remote:status")!({})).resolves.toMatchObject({ state: "off" });
  await expect(handlers.get("remote:issue-pairing-code")!({})).resolves.toMatchObject({ code: "ABCD-EFGH" });
  await handlers.get("remote:revoke-device")!({}, "d1");
  expect(remoteGateway.revokeDevice).toHaveBeenCalledWith("d1");
  await expect(handlers.get("remote:revoke-device")!({}, "")).rejects.toThrow();
});
```

`terminals:resize` 핸들러를 `coordinator.resize`로 확인하던 기존 테스트가 있으면 `sizesGateway.desktopResize` 기대로 바꾼다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote/remote-access.test.ts src/main/ipc.test.ts`
Expected: FAIL

- [ ] **Step 3: `remote-access.ts` 구현**

```ts
import type { RemoteSettings } from "../../shared/settings-types";
import type { RemoteAccessStatus, RemoteDeviceInfo, RemotePairingCode } from "../../shared/remote-types";
import type { RemoteDevice, RemoteDeviceStore } from "./device-store";
import type { PairingCodes } from "./pairing-codes";
import type { RemoteSessionHub } from "./remote-session-hub";
import { startRemoteServer, type PairOutcome, type RunningRemoteServer } from "./remote-server";

export interface RemoteAccessOptions {
  hub: Pick<RemoteSessionHub, "open" | "disconnectDevice" | "dispose">;
  devices: Pick<RemoteDeviceStore, "hostId" | "list" | "register" | "revoke">;
  pairing: Pick<PairingCodes, "issue" | "consume">;
  rendererDir: string;
  hostName: string;
  /** MULTI_CLI_WORK_REMOTE_BIND — e2e·개발용. 설정 화면에서는 바꿀 수 없다. */
  bindOverride: string | null;
  addresses(): string[];
  start?: typeof startRemoteServer;
  retryMs?: number;
}

const NO_TAILSCALE_MESSAGE =
  "Tailscale 주소(100.64.0.0/10)를 찾지 못했습니다. Tailscale이 켜지면 자동으로 다시 시도합니다.";

/**
 * 설정(remote.enabled·port)을 실제 서버 상태로 맞추는 곳. 적용은 한 번에 하나씩 순서대로 하고,
 * Tailscale이 아직 없으면 retryMs마다 다시 본다 — 부팅 때 Tailscale이 앱보다 늦게 뜨는 경우.
 */
export class RemoteAccess {
  private running: RunningRemoteServer | null = null;
  private current: RemoteAccessStatus = { state: "off", url: null, port: 0, message: null };
  private chain: Promise<RemoteAccessStatus> = Promise.resolve(this.current);
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSettings: RemoteSettings | null = null;

  constructor(private readonly options: RemoteAccessOptions) {}

  status(): RemoteAccessStatus {
    return this.current;
  }

  apply(settings: RemoteSettings): Promise<RemoteAccessStatus> {
    this.lastSettings = settings;
    this.chain = this.chain.catch(() => this.current).then(() => this.reconcile(settings));
    return this.chain;
  }

  issuePairingCode(): RemotePairingCode {
    if (this.current.state !== "listening" || this.current.url === null) {
      throw new Error("모바일 연결이 켜져 있지 않습니다");
    }
    const { code, expiresAt } = this.options.pairing.issue();
    return { code, expiresAt: new Date(expiresAt).toISOString(), url: this.current.url };
  }

  async pair(code: string, deviceName: string, clientIp: string): Promise<PairOutcome> {
    const result = this.options.pairing.consume(code, clientIp);
    if (result !== "ok") return { ok: false, reason: result };
    const { device, token } = await this.options.devices.register(deviceName);
    return {
      ok: true,
      response: { token, deviceId: device.deviceId, hostId: await this.options.devices.hostId(), hostName: this.options.hostName },
    };
  }

  async listDevices(): Promise<RemoteDeviceInfo[]> {
    return (await this.options.devices.list()).map(({ deviceId, name, createdAt, lastSeenAt }: RemoteDevice) => ({
      deviceId,
      name,
      createdAt,
      lastSeenAt,
    }));
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.options.devices.revoke(deviceId);
    this.options.hub.disconnectDevice(deviceId);
  }

  async dispose(): Promise<void> {
    this.clearRetry();
    this.lastSettings = null;
    await this.chain.catch(() => undefined);
    this.options.hub.dispose();
    await this.running?.close();
    this.running = null;
  }

  private async reconcile(settings: RemoteSettings): Promise<RemoteAccessStatus> {
    this.clearRetry();
    const host = settings.enabled ? (this.options.bindOverride ?? this.options.addresses()[0] ?? null) : null;
    if (this.running && host === this.running.host && settings.port === this.running.port) return this.current;
    await this.running?.close();
    this.running = null;
    if (!settings.enabled) return this.set({ state: "off", url: null, port: settings.port, message: null });
    if (host === null) {
      this.scheduleRetry();
      return this.set({ state: "no-tailscale", url: null, port: settings.port, message: NO_TAILSCALE_MESSAGE });
    }
    try {
      this.running = await (this.options.start ?? startRemoteServer)({
        host,
        port: settings.port,
        rendererDir: this.options.rendererDir,
        hub: this.options.hub,
        pair: (code, deviceName, clientIp) => this.pair(code, deviceName, clientIp),
      });
      return this.set({ state: "listening", url: `http://${host}:${this.running.port}/mobile/`, port: settings.port, message: null });
    } catch (error) {
      return this.set({
        state: "error",
        url: null,
        port: settings.port,
        message: `서버를 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private set(status: RemoteAccessStatus): RemoteAccessStatus {
    this.current = status;
    return status;
  }

  private scheduleRetry(): void {
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.lastSettings?.enabled) void this.apply(this.lastSettings);
    }, this.options.retryMs ?? 30_000);
    this.retryTimer.unref?.();
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
```

- [ ] **Step 4: `ipc.ts` 배선**

게이트웨이 인터페이스를 추가한다(다른 `*Gateway` 옆):

```ts
interface RemoteGateway {
  status(): RemoteAccessStatus;
  issuePairingCode(): RemotePairingCode;
  listDevices(): Promise<RemoteDeviceInfo[]>;
  revokeDevice(deviceId: string): Promise<void>;
}

/** 데스크톱 패인의 resize·입력은 크기 중재자를 거친다 — 폰이 크기를 가져간 세션을 되찾는 계기. */
interface TerminalSizeGateway {
  desktopResize(sessionId: string, cols: number, rows: number): Promise<void>;
  desktopInput(sessionId: string): Promise<void>;
}
```

`MainIpcDependencies`에 `remote: RemoteGateway;`와 `sizes: TerminalSizeGateway;`를 추가하고, `RemoteAccessStatus`·`RemotePairingCode`·`RemoteDeviceInfo`는 `../shared/remote-types`에서 import한다.

`terminals:write`·`terminals:resize` 핸들러를 바꾼다:

```ts
  ipc.handle("terminals:write", async (_event, sessionId: unknown, data: unknown) => {
    if (typeof data !== "string") throw new Error("Terminal input must be a string");
    const id = nonEmptyString(sessionId, "Session id");
    // 폰이 이 세션의 크기를 가져갔다면 데스크톱이 입력하는 순간 되찾는다. 되찾기가 실패해도 입력은 보낸다.
    await dependencies.sizes.desktopInput(id).catch((error) => console.error("Failed to reclaim terminal size", error));
    return dependencies.coordinator.write(id, data);
  });
  ipc.handle("terminals:resize", (_event, sessionId: unknown, cols: unknown, rows: unknown) =>
    dependencies.sizes.desktopResize(
      nonEmptyString(sessionId, "Session id"),
      integer(cols, "Terminal columns"),
      integer(rows, "Terminal rows"),
    ),
  );
```

notion 핸들러 옆에 추가한다:

```ts
  ipc.handle("remote:status", () => dependencies.remote.status());
  ipc.handle("remote:issue-pairing-code", () => dependencies.remote.issuePairingCode());
  ipc.handle("remote:list-devices", () => dependencies.remote.listDevices());
  ipc.handle("remote:revoke-device", (_event, deviceId: unknown) =>
    dependencies.remote.revokeDevice(nonEmptyString(deviceId, "Device id")),
  );
```

- [ ] **Step 5: preload·API 타입**

`src/shared/api-types.ts`의 API 인터페이스(`notion: {` 블록 옆, 524행 부근)에 추가한다:

```ts
  remote: {
    status(): Promise<RemoteAccessStatus>;
    issuePairingCode(): Promise<RemotePairingCode>;
    listDevices(): Promise<RemoteDeviceInfo[]>;
    revokeDevice(deviceId: string): Promise<void>;
  };
```

(`./remote-types`에서 타입을 import한다.)

`src/preload/index.ts`의 `notion:` 블록 옆:

```ts
  remote: {
    status: () => ipcRenderer.invoke("remote:status"),
    issuePairingCode: () => ipcRenderer.invoke("remote:issue-pairing-code"),
    listDevices: () => ipcRenderer.invoke("remote:list-devices"),
    revokeDevice: (deviceId) => ipcRenderer.invoke("remote:revoke-device", deviceId),
  },
```

- [ ] **Step 6: `runtime.ts` 배선**

import를 추가한다:

```ts
import { RemoteAccess } from "./remote/remote-access";
import { RemoteDeviceStore } from "./remote/device-store";
import { PairingCodes } from "./remote/pairing-codes";
import { RemoteSessionHub } from "./remote/remote-session-hub";
import { TerminalSizeArbiter } from "./remote/size-arbiter";
import { tailscaleAddresses } from "./remote/tailscale-address";
```

`const attention = createSessionAttentionController({...});` 바로 다음(`updateSettings` 정의보다 앞)에 넣는다:

```ts
  // 모바일 컴패니언: 폰은 데스크톱 렌더러와 같은 코디네이터를 쓰는 두 번째 클라이언트다.
  const sizes = new TerminalSizeArbiter((sessionId, cols, rows) => coordinator.resize(sessionId, cols, rows));
  const remoteDevices = new RemoteDeviceStore(path.join(userData, "remote-devices.json"));
  const remoteHub = new RemoteSessionHub({
    gateway: {
      list: () => coordinator.list(),
      attach: (sessionId) => coordinator.attachForRenderer(sessionId),
      write: (sessionId, data) => coordinator.write(sessionId, data),
      onEvent: (listener) => coordinator.onEvent(listener),
      projectName: async (projectId) => (await getProject(projectId))?.displayName ?? null,
    },
    devices: remoteDevices,
    sizes,
    hostId: () => remoteDevices.hostId(),
    hostName: os.hostname(),
  });
  const remoteAccess = new RemoteAccess({
    hub: remoteHub,
    devices: remoteDevices,
    pairing: new PairingCodes(),
    rendererDir: path.join(__dirname, "../renderer"),
    hostName: os.hostname(),
    bindOverride: process.env.MULTI_CLI_WORK_REMOTE_BIND ?? null,
    addresses: () => tailscaleAddresses(os.networkInterfaces()),
  });
  void remoteAccess.apply(settingsService.current().remote);
```

`updateSettings` 안에서 `next = await settingsService.update(patch);`가 성공한 뒤(브로드캐스트 전)에 넣는다:

```ts
    if (patch.remote) await remoteAccess.apply(next.remote);
```

`registerMainIpc(ipcMain, { ... })` 객체에 추가한다:

```ts
    remote: {
      status: () => remoteAccess.status(),
      issuePairingCode: () => remoteAccess.issuePairingCode(),
      listDevices: () => remoteAccess.listDevices(),
      revokeDevice: (deviceId) => remoteAccess.revokeDevice(deviceId),
    },
    sizes,
```

`createRetryableDisposer([...])`에서 `() => controlServer?.close(),` 다음 줄에 `() => remoteAccess.dispose(),`를 넣는다.

- [ ] **Step 7: 통과·타입 확인**

Run: `npx vitest run --pool=threads src/main/remote src/main/ipc.test.ts` 그리고 `npm run typecheck`
Expected: PASS, 타입 오류 0

- [ ] **Step 8: 커밋**

```powershell
git add src/main/remote/remote-access.ts src/main/remote/remote-access.test.ts src/main/ipc.ts src/main/ipc.test.ts src/preload/index.ts src/shared/api-types.ts src/main/runtime.ts
git commit -m @'
feat: start the mobile remote server from settings and wire it into main

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 10: 설정 "모바일" 탭

**Files:**
- Create: `src/renderer/src/RemoteSettings.tsx`
- Test: `src/renderer/src/RemoteSettings.test.tsx`
- Modify: `src/renderer/src/SettingsDialog.tsx` (`SettingsTab`에 `"mobile"`, `TABS`에 `{ id: "mobile", label: "모바일" }`, 렌더에 `{tab === "mobile" ? <RemoteSettings settings={settings} /> : null}`)

**Interfaces:**
- Consumes: `window.multiCliWork.remote.*` (Task 9), `window.multiCliWork.settings.update` (기존), `errorMessage` (`./ipc-error`)
- Produces: `RemoteSettings({ settings }: { settings: AppSettings })`

- [ ] **Step 1: 실패하는 테스트 작성** — 기존 `SettingsDialog.test.tsx`가 `window.multiCliWork`를 mock하는 방식을 따른다:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/settings-types";
import { RemoteSettings } from "./RemoteSettings";

const remote = {
  status: vi.fn(),
  issuePairingCode: vi.fn(),
  listDevices: vi.fn(),
  revokeDevice: vi.fn(),
};
const update = vi.fn();

beforeEach(() => {
  remote.status.mockResolvedValue({ state: "listening", url: "http://100.64.0.9:47821/mobile/", port: 47821, message: null });
  remote.listDevices.mockResolvedValue([{ deviceId: "d1", name: "내 폰", createdAt: "2026-09-30T00:00:00.000Z", lastSeenAt: null }]);
  remote.issuePairingCode.mockResolvedValue({ code: "ABCD-EFGH", expiresAt: "2026-09-30T00:05:00.000Z", url: "http://100.64.0.9:47821/mobile/" });
  remote.revokeDevice.mockResolvedValue(undefined);
  update.mockResolvedValue(DEFAULT_SETTINGS);
  (window as unknown as { multiCliWork: unknown }).multiCliWork = { remote, settings: { update } };
});

describe("RemoteSettings", () => {
  it("toggles the server through settings", async () => {
    render(<RemoteSettings settings={DEFAULT_SETTINGS} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "모바일 연결 켜기" }));
    expect(update).toHaveBeenCalledWith({ remote: { enabled: true } });
  });

  it("shows the address, issues a pairing code, and lists devices", async () => {
    render(<RemoteSettings settings={{ ...DEFAULT_SETTINGS, remote: { enabled: true, port: 47821 } }} />);
    expect(await screen.findByText("http://100.64.0.9:47821/mobile/")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "기기 추가" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(screen.getByText("내 폰")).toBeInTheDocument();
  });

  it("revokes a device and refreshes the list", async () => {
    render(<RemoteSettings settings={{ ...DEFAULT_SETTINGS, remote: { enabled: true, port: 47821 } }} />);
    fireEvent.click(await screen.findByRole("button", { name: "내 폰 연결 해제" }));
    await waitFor(() => expect(remote.revokeDevice).toHaveBeenCalledWith("d1"));
    expect(remote.listDevices).toHaveBeenCalledTimes(2);
  });

  it("rejects an out-of-range port without saving", async () => {
    render(<RemoteSettings settings={DEFAULT_SETTINGS} />);
    const port = screen.getByLabelText("포트");
    fireEvent.change(port, { target: { value: "80" } });
    fireEvent.blur(port);
    expect(update).not.toHaveBeenCalled();
    expect(await screen.findByText(/1024–65535/)).toBeInTheDocument();
  });

  it("explains a missing Tailscale address", async () => {
    remote.status.mockResolvedValue({ state: "no-tailscale", url: null, port: 47821, message: "Tailscale 주소(100.64.0.0/10)를 찾지 못했습니다." });
    render(<RemoteSettings settings={{ ...DEFAULT_SETTINGS, remote: { enabled: true, port: 47821 } }} />);
    expect(await screen.findByText(/Tailscale 주소/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "기기 추가" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/renderer/src/RemoteSettings.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현**

```tsx
import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "@shared/settings-types";
import { REMOTE_PORT_RANGE } from "@shared/settings-types";
import type { RemoteAccessStatus, RemoteDeviceInfo, RemotePairingCode } from "@shared/remote-types";
import { errorMessage } from "./ipc-error";

const STATE_LABEL: Record<RemoteAccessStatus["state"], string> = {
  off: "꺼짐",
  listening: "연결 대기 중",
  "no-tailscale": "Tailscale 미감지",
  error: "오류",
};

function formatTime(iso: string | null): string {
  return iso === null ? "접속 기록 없음" : new Date(iso).toLocaleString("ko-KR");
}

/**
 * 모바일 연결 탭. 켜기·포트는 AppSettings(remote)로 저장하고, 서버 상태·페어링 코드·기기 목록은
 * main의 RemoteAccess에 직접 묻는다 — 토큰 해시 같은 건 렌더러로 오지 않는다.
 */
export function RemoteSettings({ settings }: { settings: AppSettings }) {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [devices, setDevices] = useState<RemoteDeviceInfo[]>([]);
  const [pairing, setPairing] = useState<RemotePairingCode | null>(null);
  const [portDraft, setPortDraft] = useState(String(settings.remote.port));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([window.multiCliWork.remote.status(), window.multiCliWork.remote.listDevices()])
      .then(([nextStatus, nextDevices]) => {
        setStatus(nextStatus);
        setDevices(nextDevices);
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
  }, []);

  useEffect(refresh, [refresh, settings.remote.enabled, settings.remote.port]);
  useEffect(() => setPortDraft(String(settings.remote.port)), [settings.remote.port]);

  const save = (patch: { enabled?: boolean; port?: number }) => {
    setError(null);
    window.multiCliWork.settings.update({ remote: patch }).catch((cause: unknown) => setError(errorMessage(cause)));
  };

  const commitPort = () => {
    const port = Number(portDraft);
    if (!Number.isInteger(port) || port < REMOTE_PORT_RANGE.min || port > REMOTE_PORT_RANGE.max) {
      setError(`포트는 ${REMOTE_PORT_RANGE.min}–${REMOTE_PORT_RANGE.max} 사이의 정수여야 합니다`);
      return;
    }
    if (port !== settings.remote.port) save({ port });
  };

  const issueCode = () => {
    setError(null);
    window.multiCliWork.remote
      .issuePairingCode()
      .then(setPairing)
      .catch((cause: unknown) => setError(errorMessage(cause)));
  };

  const revoke = (deviceId: string) => {
    window.multiCliWork.remote
      .revokeDevice(deviceId)
      .then(refresh)
      .catch((cause: unknown) => setError(errorMessage(cause)));
  };

  const listening = status?.state === "listening";

  return (
    <>
      <h2>모바일</h2>
      <p className="settings-hint">
        Tailscale로 묶인 휴대폰에서 이 PC의 세션을 보고 입력합니다. 서버는 Tailscale 주소(100.x)에서만 열립니다.
      </p>
      <div className="settings-row">
        <label htmlFor="settings-remote-enabled">모바일 연결 켜기</label>
        <input
          id="settings-remote-enabled"
          type="checkbox"
          checked={settings.remote.enabled}
          onChange={(event) => save({ enabled: event.target.checked })}
        />
      </div>
      <div className="settings-row">
        <label htmlFor="settings-remote-port">포트</label>
        <input
          id="settings-remote-port"
          inputMode="numeric"
          value={portDraft}
          onChange={(event) => setPortDraft(event.target.value)}
          onBlur={commitPort}
        />
      </div>
      <div className="settings-row">
        <span>상태</span>
        <span>{status === null ? "확인 중…" : STATE_LABEL[status.state]}</span>
      </div>
      {status?.url ? (
        <div className="settings-row">
          <span>폰에서 열 주소</span>
          <code>{status.url}</code>
        </div>
      ) : null}
      {status?.message ? <p className="settings-hint">{status.message}</p> : null}

      <h3>기기</h3>
      <div className="settings-row">
        <span>새 기기 페어링</span>
        <button type="button" disabled={!listening} onClick={issueCode}>
          기기 추가
        </button>
      </div>
      {pairing ? (
        <p className="settings-hint">
          폰 브라우저에서 <code>{pairing.url}</code>을 열고 코드 <strong>{pairing.code}</strong>를 입력하세요.
          {" "}{new Date(pairing.expiresAt).toLocaleTimeString("ko-KR")}까지 한 번만 쓸 수 있습니다.
        </p>
      ) : null}
      {devices.length === 0 ? <p className="settings-hint">페어링된 기기가 없습니다.</p> : null}
      {devices.map((device) => (
        <div className="settings-row" key={device.deviceId}>
          <span>
            {device.name}
            <small className="settings-hint"> · {formatTime(device.lastSeenAt)}</small>
          </span>
          <button type="button" aria-label={`${device.name} 연결 해제`} onClick={() => revoke(device.deviceId)}>
            연결 해제
          </button>
        </div>
      ))}
      {error ? <p className="settings-error">{error}</p> : null}
    </>
  );
}
```

(`settings-error` 클래스가 SettingsDialog에 없으면 NotionSettings가 오류를 그릴 때 쓰는 클래스를 그대로 쓴다.)

그다음 `SettingsDialog.tsx`에 탭 id·라벨·렌더 한 줄을 추가한다(파일 헤더의 Files 항목 참고).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/renderer/src/RemoteSettings.test.tsx src/renderer/src/SettingsDialog.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```powershell
git add src/renderer/src/RemoteSettings.tsx src/renderer/src/RemoteSettings.test.tsx src/renderer/src/SettingsDialog.tsx
git commit -m @'
feat: add the mobile settings tab with pairing and device list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 11: 모바일 페이지 빌드 엔트리 + 원격 클라이언트

**Files:**
- Create: `src/renderer/mobile.html`
- Modify: `electron.vite.config.ts`
- Create: `src/renderer/src/mobile/remote-client.ts`
- Test: `src/renderer/src/mobile/remote-client.test.ts`

**Interfaces:**
- Consumes: Task 2 `RemoteClientMessage`, `RemoteServerMessage`, `REMOTE_CLOSE`, `REMOTE_PROTOCOL_VERSION`, `RemotePairResponse`
- Produces:
  - `type RemoteClientState = "connecting" | "open" | "reconnecting" | "unauthorized"`
  - `class RemoteClient` — `constructor(options: { url: string; token: string; createSocket?: (url: string) => WebSocket; delaysMs?: readonly number[] })`, `connect(): void`, `close(): void`, `send(message: RemoteClientMessage): boolean`, `state(): RemoteClientState`, `onMessage(listener): () => void`, `onState(listener): () => void`
  - `remoteSocketUrl(location: Pick<Location, "protocol" | "host">): string`
  - `interface StoredPairing { token: string; deviceId: string; hostName: string }`
  - `loadPairing(storage: Storage | null): StoredPairing | null`, `savePairing(storage, pairing)`, `clearPairing(storage)`
  - `requestPairing(code: string, deviceName: string, fetchImpl?: typeof fetch): Promise<StoredPairing>`

- [ ] **Step 1: 빌드 엔트리**

`src/renderer/mobile.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'" />
    <meta name="theme-color" content="#101214" />
    <title>멀티 터미널 작업기</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/mobile/main.tsx"></script>
  </body>
</html>
```

`electron.vite.config.ts`의 `renderer` 블록에 `build`를 추가한다:

```ts
  renderer: {
    resolve: { /* 그대로 */ },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          // 모바일 컴패니언 화면. 데스크톱 설치본에 같이 들어가고 원격 서버가 /mobile/로 서빙한다.
          mobile: resolve("src/renderer/mobile.html"),
        },
      },
    },
  },
```

- [ ] **Step 2: 실패하는 테스트 작성** — `src/renderer/src/mobile/remote-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { REMOTE_CLOSE } from "@shared/remote-types";
import { clearPairing, loadPairing, RemoteClient, remoteSocketUrl, requestPairing, savePairing } from "./remote-client";

class FakeSocket {
  static instances: FakeSocket[] = [];
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.({ code: 1000 });
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function client() {
  FakeSocket.instances = [];
  const remote = new RemoteClient({
    url: "ws://h/ws",
    token: "tok",
    createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
    delaysMs: [10],
  });
  const states: string[] = [];
  remote.onState((state) => states.push(state));
  return { remote, states };
}

const welcome = { type: "welcome", hostId: "h", hostName: "PC", deviceId: "d", protocolVersion: 1 };

afterEach(() => vi.useRealTimers());

describe("RemoteClient", () => {
  it("says hello on open and becomes open on welcome", () => {
    const { remote, states } = client();
    remote.connect();
    const socket = FakeSocket.instances[0]!;
    socket.onopen?.();
    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: "hello", token: "tok", protocolVersion: 1, mode: "ui" });
    expect(remote.send({ type: "list" })).toBe(false);
    socket.receive(welcome);
    expect(states).toEqual(["open"]);
    expect(remote.send({ type: "list" })).toBe(true);
  });

  it("reconnects after an unexpected close", async () => {
    vi.useFakeTimers();
    const { remote, states } = client();
    remote.connect();
    FakeSocket.instances[0]!.onclose?.({ code: 1006 });
    expect(states).toEqual(["reconnecting"]);
    await vi.advanceTimersByTimeAsync(10);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("stops reconnecting on 4401 and 4403", async () => {
    vi.useFakeTimers();
    for (const code of [REMOTE_CLOSE.unauthorized, REMOTE_CLOSE.revoked]) {
      const { remote, states } = client();
      remote.connect();
      FakeSocket.instances[0]!.onclose?.({ code });
      await vi.advanceTimersByTimeAsync(50);
      expect(states).toEqual(["unauthorized"]);
      expect(FakeSocket.instances).toHaveLength(1);
    }
  });

  it("does not reconnect after close()", async () => {
    vi.useFakeTimers();
    const { remote } = client();
    remote.connect();
    remote.close();
    await vi.advanceTimersByTimeAsync(50);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("delivers server messages to listeners", () => {
    const { remote } = client();
    const received: unknown[] = [];
    remote.onMessage((message) => received.push(message));
    remote.connect();
    FakeSocket.instances[0]!.receive({ type: "sessions", sessions: [] });
    expect(received).toEqual([{ type: "sessions", sessions: [] }]);
  });
});

describe("remoteSocketUrl", () => {
  it("follows the page's host and scheme", () => {
    expect(remoteSocketUrl({ protocol: "http:", host: "100.64.0.9:47821" })).toBe("ws://100.64.0.9:47821/ws");
    expect(remoteSocketUrl({ protocol: "https:", host: "pc.ts.net" })).toBe("wss://pc.ts.net/ws");
  });
});

describe("pairing storage", () => {
  it("round-trips and tolerates garbage or a missing storage", () => {
    const pairing = { token: "t", deviceId: "d", hostName: "PC" };
    savePairing(window.localStorage, pairing);
    expect(loadPairing(window.localStorage)).toEqual(pairing);
    window.localStorage.setItem("mcw.remote.pairing", "{bad");
    expect(loadPairing(window.localStorage)).toBeNull();
    clearPairing(window.localStorage);
    expect(loadPairing(null)).toBeNull();
  });
});

describe("requestPairing", () => {
  it("maps HTTP errors to Korean messages", async () => {
    const respond = (status: number, body: unknown = {}) =>
      vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    await expect(requestPairing("x", "폰", respond(401))).rejects.toThrow("코드가 맞지 않거나 만료되었습니다");
    await expect(requestPairing("x", "폰", respond(429))).rejects.toThrow("시도가 너무 많습니다");
    await expect(
      requestPairing("x", "폰", respond(200, { token: "t", deviceId: "d", hostId: "h", hostName: "PC" })),
    ).resolves.toEqual({ token: "t", deviceId: "d", hostName: "PC" });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run --pool=threads src/renderer/src/mobile/remote-client.test.ts`
Expected: FAIL

- [ ] **Step 4: 구현** — `src/renderer/src/mobile/remote-client.ts`:

```ts
import {
  REMOTE_CLOSE,
  REMOTE_PROTOCOL_VERSION,
  type RemoteClientMessage,
  type RemotePairResponse,
  type RemoteServerMessage,
} from "@shared/remote-types";

export type RemoteClientState = "connecting" | "open" | "reconnecting" | "unauthorized";

export interface RemoteClientOptions {
  url: string;
  token: string;
  createSocket?: (url: string) => WebSocket;
  delaysMs?: readonly number[];
}

const DEFAULT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

/**
 * 호스트 하나와의 WS 연결. 끊기면 백오프로 다시 붙고, 4401·4403(등록 안 됨·철회)이면 멈춰서
 * 다시 페어링하게 한다. 재연결 뒤의 attach는 각 화면이 onState("open")를 보고 다시 보낸다.
 */
export class RemoteClient {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: RemoteClientState = "connecting";
  private readonly messageListeners = new Set<(message: RemoteServerMessage) => void>();
  private readonly stateListeners = new Set<(state: RemoteClientState) => void>();

  constructor(private readonly options: RemoteClientOptions) {}

  state(): RemoteClientState {
    return this.current;
  }

  onMessage(listener: (message: RemoteServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onState(listener: (state: RemoteClientState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  connect(): void {
    if (this.stopped) return;
    const socket = (this.options.createSocket ?? ((url) => new WebSocket(url)))(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(
        JSON.stringify({ type: "hello", token: this.options.token, protocolVersion: REMOTE_PROTOCOL_VERSION, mode: "ui" }),
      );
    };
    socket.onmessage = (event: MessageEvent) => {
      let message: RemoteServerMessage;
      try {
        message = JSON.parse(String(event.data)) as RemoteServerMessage;
      } catch {
        return;
      }
      if (message.type === "welcome") {
        this.attempt = 0;
        this.setState("open");
      }
      for (const listener of this.messageListeners) listener(message);
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      if (event.code === REMOTE_CLOSE.unauthorized || event.code === REMOTE_CLOSE.revoked) {
        this.stopped = true;
        this.setState("unauthorized");
        return;
      }
      this.setState("reconnecting");
      const delays = this.options.delaysMs ?? DEFAULT_DELAYS_MS;
      const delay = delays[Math.min(this.attempt, delays.length - 1)]!;
      this.attempt += 1;
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  send(message: RemoteClientMessage): boolean {
    if (this.current !== "open" || this.socket === null) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close(1000);
    this.socket = null;
  }

  private setState(state: RemoteClientState): void {
    if (this.current === state) return;
    this.current = state;
    for (const listener of this.stateListeners) listener(state);
  }
}

export function remoteSocketUrl(location: Pick<Location, "protocol" | "host">): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

export interface StoredPairing {
  token: string;
  deviceId: string;
  hostName: string;
}

const PAIRING_KEY = "mcw.remote.pairing";

export function loadPairing(storage: Storage | null): StoredPairing | null {
  try {
    const raw = storage?.getItem(PAIRING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredPairing>;
    return typeof value.token === "string" && typeof value.deviceId === "string" && typeof value.hostName === "string"
      ? { token: value.token, deviceId: value.deviceId, hostName: value.hostName }
      : null;
  } catch {
    return null;
  }
}

export function savePairing(storage: Storage | null, pairing: StoredPairing): void {
  try {
    storage?.setItem(PAIRING_KEY, JSON.stringify(pairing));
  } catch {
    // 저장이 막힌 브라우저에서는 이번 방문 동안만 쓴다.
  }
}

export function clearPairing(storage: Storage | null): void {
  try {
    storage?.removeItem(PAIRING_KEY);
  } catch {
    // 위와 같다.
  }
}

export async function requestPairing(code: string, deviceName: string, fetchImpl: typeof fetch = fetch): Promise<StoredPairing> {
  const response = await fetchImpl("/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName }),
  });
  if (response.status === 401) throw new Error("코드가 맞지 않거나 만료되었습니다");
  if (response.status === 429) throw new Error("시도가 너무 많습니다. 잠시 후 다시 시도하세요");
  if (!response.ok) throw new Error(`페어링에 실패했습니다 (${response.status})`);
  const body = (await response.json()) as RemotePairResponse;
  return { token: body.token, deviceId: body.deviceId, hostName: body.hostName };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run --pool=threads src/renderer/src/mobile/remote-client.test.ts`
Expected: PASS. (`main.tsx`가 아직 없어 `electron-vite build`는 Task 12 뒤에 확인한다.)

- [ ] **Step 6: 커밋**

```powershell
git add src/renderer/mobile.html electron.vite.config.ts src/renderer/src/mobile/remote-client.ts src/renderer/src/mobile/remote-client.test.ts
git commit -m @'
feat: add the mobile page entry and its reconnecting remote client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 12: 모바일 화면 (페어링·세션 목록·세션 화면)

**Files:**
- Create: `src/renderer/src/mobile/terminal-input.ts` (+ `terminal-input.test.ts`)
- Create: `src/renderer/src/mobile/session-list-model.ts` (+ `session-list-model.test.ts`)
- Create: `src/renderer/src/mobile/PairScreen.tsx`, `SessionList.tsx`, `SessionScreen.tsx`, `MobileApp.tsx`, `main.tsx`, `mobile.css`
- Test: `src/renderer/src/mobile/SessionList.test.tsx`

**Interfaces:**
- Consumes: Task 11 `RemoteClient`·`StoredPairing`·`requestPairing`·`loadPairing`·`savePairing`·`clearPairing`·`remoteSocketUrl`, Task 2 타입
- Produces:
  - `QUICK_KEYS: ReadonlyArray<{ label: string; ariaLabel: string; data: string }>`
  - `encodeComposerInput(text: string): string`
  - `createReplayGate(write: (data: string) => void): { reset(): void; attached(replay: string, sequence: number): void; data(data: string, sequence: number): void }`
  - `applySessionMessage(sessions: RemoteSessionSummary[], message: RemoteServerMessage): RemoteSessionSummary[]`
  - `groupSessions(sessions): Array<{ projectName: string; sessions: RemoteSessionSummary[] }>`

- [ ] **Step 1: 실패하는 테스트 작성**

`terminal-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createReplayGate, encodeComposerInput, QUICK_KEYS } from "./terminal-input";

describe("encodeComposerInput", () => {
  it("sends a single line followed by Enter", () => {
    expect(encodeComposerInput("hello")).toBe("hello\r");
  });
  it("wraps multi-line text in bracketed paste, then presses Enter", () => {
    expect(encodeComposerInput("a\r\nb\nc")).toBe("\x1b[200~a\rb\rc\x1b[201~\r");
  });
  it("an empty composer is just Enter", () => {
    expect(encodeComposerInput("")).toBe("\r");
  });
});

describe("QUICK_KEYS", () => {
  it("covers the approval keys", () => {
    expect(QUICK_KEYS.map((key) => key.label)).toEqual(["Esc", "Tab", "↑", "↓", "Enter", "^C", "1", "2", "3", "/"]);
    expect(QUICK_KEYS.find((key) => key.label === "^C")!.data).toBe("\x03");
  });
});

describe("createReplayGate", () => {
  it("buffers output until the replay lands and drops what the replay already holds", () => {
    const written: string[] = [];
    const gate = createReplayGate((data) => written.push(data));
    gate.data("old", 4);
    gate.data("new", 6);
    gate.attached("REPLAY", 5);
    gate.data("next", 7);
    gate.data("dup", 7);
    expect(written).toEqual(["REPLAY", "new", "next"]);
  });

  it("starts over after reset (reconnect)", () => {
    const written: string[] = [];
    const gate = createReplayGate((data) => written.push(data));
    gate.attached("A", 1);
    gate.reset();
    gate.data("while-away", 9);
    gate.attached("B", 8);
    expect(written).toEqual(["A", "B", "while-away"]);
  });
});
```

`session-list-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { applySessionMessage, groupSessions } from "./session-list-model";

const s = (id: string, overrides: Partial<RemoteSessionSummary> = {}): RemoteSessionSummary => ({
  id,
  projectId: "p",
  projectName: "A",
  kind: "claude",
  label: id,
  status: "working",
  updatedAt: "2026-09-30T00:00:00.000Z",
  ...overrides,
});

describe("applySessionMessage", () => {
  it("replaces, adds, and updates sessions", () => {
    let list = applySessionMessage([], { type: "sessions", sessions: [s("1")] });
    list = applySessionMessage(list, { type: "created", session: s("2") });
    list = applySessionMessage(list, { type: "created", session: s("2", { label: "again" }) });
    list = applySessionMessage(list, { type: "status", sessionId: "1", status: "awaiting-input" });
    list = applySessionMessage(list, { type: "title", sessionId: "2", title: "새 제목" });
    list = applySessionMessage(list, { type: "exit", sessionId: "1", exitCode: 0 });
    expect(list.map((entry) => [entry.id, entry.status, entry.label])).toEqual([
      ["1", "exited", "1"],
      ["2", "working", "새 제목"],
    ]);
  });

  it("ignores unrelated messages and returns the same array", () => {
    const list = [s("1")];
    expect(applySessionMessage(list, { type: "data", sessionId: "1", data: "x", sequence: 1 })).toBe(list);
  });
});

describe("groupSessions", () => {
  it("groups by project, newest first, with folderless sessions last", () => {
    const groups = groupSessions([
      s("old", { projectName: "B", updatedAt: "2026-09-29T00:00:00.000Z" }),
      s("tool", { projectId: null, projectName: null }),
      s("new", { projectName: "B", updatedAt: "2026-09-30T01:00:00.000Z" }),
      s("a", { projectName: "A" }),
    ]);
    expect(groups.map((group) => [group.projectName, group.sessions.map((entry) => entry.id)])).toEqual([
      ["A", ["a"]],
      ["B", ["new", "old"]],
      ["폴더 없음", ["tool"]],
    ]);
  });
});
```

`SessionList.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionList } from "./SessionList";

describe("SessionList", () => {
  it("shows status badges and opens a session", () => {
    const onOpen = vi.fn();
    render(
      <SessionList
        hostName="PC"
        connection="open"
        sessions={[
          { id: "1", projectId: "p", projectName: "A", kind: "claude", label: "리팩터", status: "awaiting-input", updatedAt: "" },
        ]}
        onOpen={onOpen}
        onUnpair={vi.fn()}
      />,
    );
    expect(screen.getByText("입력 대기")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
    expect(onOpen).toHaveBeenCalledWith("1");
  });

  it("says when there is nothing to show and when the link is down", () => {
    render(<SessionList hostName="PC" connection="reconnecting" sessions={[]} onOpen={vi.fn()} onUnpair={vi.fn()} />);
    expect(screen.getByText("열린 세션이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("다시 연결하는 중…")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/renderer/src/mobile`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 순수 모듈 구현**

`terminal-input.ts`:

```ts
/** 폰 키보드에 없는 키. 1·2·3은 CLI의 승인 선택지, /는 슬래시 명령이다. */
export const QUICK_KEYS: ReadonlyArray<{ label: string; ariaLabel: string; data: string }> = [
  { label: "Esc", ariaLabel: "Esc", data: "\x1b" },
  { label: "Tab", ariaLabel: "Tab", data: "\t" },
  { label: "↑", ariaLabel: "위 화살표", data: "\x1b[A" },
  { label: "↓", ariaLabel: "아래 화살표", data: "\x1b[B" },
  { label: "Enter", ariaLabel: "Enter", data: "\r" },
  { label: "^C", ariaLabel: "Ctrl+C", data: "\x03" },
  { label: "1", ariaLabel: "1", data: "1" },
  { label: "2", ariaLabel: "2", data: "2" },
  { label: "3", ariaLabel: "3", data: "3" },
  { label: "/", ariaLabel: "슬래시", data: "/" },
];

/**
 * 입력창 내용을 PTY로 보낼 바이트로. 여러 줄은 bracketed paste로 감싸 CLI가 줄바꿈마다 제출하지
 * 않게 하고, 마지막에 Enter를 한 번 누른다.
 */
export function encodeComposerInput(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.includes("\n")) return `${normalized}\r`;
  return `\x1b[200~${normalized.replace(/\n/g, "\r")}\x1b[201~\r`;
}

/**
 * replay와 실시간 출력을 이어 붙이는 문. attached 전의 출력은 모아 두었다가 replay 뒤에
 * sequence가 더 큰 것만 쓴다 — 데스크톱 TerminalPane과 같은 규칙.
 */
export function createReplayGate(write: (data: string) => void) {
  let lastSequence: number | null = null;
  const pending: Array<{ data: string; sequence: number }> = [];
  return {
    reset() {
      lastSequence = null;
      pending.length = 0;
    },
    attached(replay: string, sequence: number) {
      write(replay);
      lastSequence = sequence;
      for (const output of pending) {
        if (output.sequence > lastSequence) {
          write(output.data);
          lastSequence = output.sequence;
        }
      }
      pending.length = 0;
    },
    data(data: string, sequence: number) {
      if (lastSequence === null) {
        pending.push({ data, sequence });
        return;
      }
      if (sequence <= lastSequence) return;
      write(data);
      lastSequence = sequence;
    },
  };
}
```

`session-list-model.ts`:

```ts
import type { RemoteServerMessage, RemoteSessionSummary } from "@shared/remote-types";

const NO_FOLDER = "폴더 없음";

export function applySessionMessage(
  sessions: RemoteSessionSummary[],
  message: RemoteServerMessage,
): RemoteSessionSummary[] {
  switch (message.type) {
    case "sessions":
      return message.sessions;
    case "created":
      return sessions.some((session) => session.id === message.session.id) ? sessions : [...sessions, message.session];
    case "status":
      return sessions.map((session) => (session.id === message.sessionId ? { ...session, status: message.status } : session));
    case "title":
      return sessions.map((session) => (session.id === message.sessionId ? { ...session, label: message.title } : session));
    case "exit":
      return sessions.map((session) => (session.id === message.sessionId ? { ...session, status: "exited" } : session));
    default:
      return sessions;
  }
}

export function groupSessions(sessions: RemoteSessionSummary[]) {
  const groups = new Map<string, RemoteSessionSummary[]>();
  for (const session of sessions) {
    const key = session.projectName ?? NO_FOLDER;
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === NO_FOLDER ? 1 : b === NO_FOLDER ? -1 : a.localeCompare(b, "ko")))
    .map(([projectName, entries]) => ({
      projectName,
      sessions: [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    }));
}
```

(`title` 메시지는 제목만 바꾼다. 사용자가 붙인 이름(name)이 있는 세션도 폰에서는 새 제목이 보인다 — P1에서는 허용하고, 필요하면 P4에서 `name` 우선 규칙을 서버 요약에 반영한다.)

- [ ] **Step 4: 화면 구현**

`PairScreen.tsx`:

```tsx
import { useState } from "react";
import { requestPairing, type StoredPairing } from "./remote-client";

export function PairScreen({ notice, onPaired }: { notice: string | null; onPaired(pairing: StoredPairing): void }) {
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("내 폰");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    requestPairing(code, deviceName)
      .then(onPaired)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <form className="m-pair" onSubmit={submit}>
      <h1>PC와 연결</h1>
      <p>PC의 설정 ▸ 모바일 ▸ 기기 추가에 나온 코드를 입력하세요.</p>
      {notice ? <p className="m-notice">{notice}</p> : null}
      <label>
        페어링 코드
        <input value={code} autoCapitalize="characters" autoComplete="one-time-code" onChange={(event) => setCode(event.target.value)} />
      </label>
      <label>
        이 기기 이름
        <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
      </label>
      <button type="submit" disabled={busy || code.trim().length === 0}>
        연결
      </button>
      {error ? <p className="m-error">{error}</p> : null}
    </form>
  );
}
```

`SessionList.tsx`:

```tsx
import type { TerminalStatus } from "@shared/terminal-types";
import type { RemoteSessionSummary } from "@shared/remote-types";
import type { RemoteClientState } from "./remote-client";
import { groupSessions } from "./session-list-model";

export const STATUS_LABEL: Record<TerminalStatus, string> = {
  starting: "시작 중",
  working: "작업 중",
  "awaiting-input": "입력 대기",
  "awaiting-approval": "승인 대기",
  idle: "대기",
  exited: "종료됨",
  error: "오류",
};

const CONNECTION_LABEL: Record<RemoteClientState, string | null> = {
  connecting: "연결 중…",
  open: null,
  reconnecting: "다시 연결하는 중…",
  unauthorized: "연결이 해제되었습니다",
};

interface SessionListProps {
  hostName: string;
  connection: RemoteClientState;
  sessions: RemoteSessionSummary[];
  onOpen(sessionId: string): void;
  onUnpair(): void;
}

export function SessionList({ hostName, connection, sessions, onOpen, onUnpair }: SessionListProps) {
  const banner = CONNECTION_LABEL[connection];
  return (
    <main className="m-list">
      <header className="m-bar">
        <h1>{hostName}</h1>
        <button type="button" onClick={onUnpair}>
          연결 해제
        </button>
      </header>
      {banner ? <p className="m-banner">{banner}</p> : null}
      {sessions.length === 0 ? <p className="m-empty">열린 세션이 없습니다</p> : null}
      {groupSessions(sessions).map((group) => (
        <section key={group.projectName}>
          <h2>{group.projectName}</h2>
          {group.sessions.map((session) => (
            <button type="button" className="m-session" key={session.id} onClick={() => onOpen(session.id)}>
              <span className="m-session-label">{session.label}</span>
              <span className={`m-status m-status-${session.status}`}>{STATUS_LABEL[session.status]}</span>
            </button>
          ))}
        </section>
      ))}
    </main>
  );
}
```

`SessionScreen.tsx`:

```tsx
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import type { RemoteSessionSummary } from "@shared/remote-types";
import type { RemoteClient } from "./remote-client";
import { STATUS_LABEL } from "./SessionList";
import { createReplayGate, encodeComposerInput, QUICK_KEYS } from "./terminal-input";

interface SessionScreenProps {
  client: RemoteClient;
  session: RemoteSessionSummary;
  deviceId: string;
  onBack(): void;
}

const FONT_SIZES = [9, 10, 11, 12, 13, 14, 16] as const;

/**
 * 폰의 세션 화면. 기본은 PC의 열 수를 그대로 그리고 가로로 스크롤한다. "폰 크기로"를 켜면 이 화면
 * 폭으로 PTY를 줄이고, PC가 크기를 되찾으면(입력·패인 크기 변경) 저절로 꺼진다.
 */
export function SessionScreen({ client, session, deviceId, onBack }: SessionScreenProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const phoneSizeRef = useRef(false);
  const [phoneSize, setPhoneSize] = useState(false);
  const [fontIndex, setFontIndex] = useState(3);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      fontSize: FONT_SIZES[3],
      fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, "DejaVu Sans Mono", monospace',
      scrollback: 5_000,
      cursorBlink: false,
      theme: { background: "#101214" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;
    const gate = createReplayGate((data) => terminal.write(data));
    const applySize = (cols: number | null, rows: number | null) => {
      if (cols !== null && rows !== null && (terminal.cols !== cols || terminal.rows !== rows)) terminal.resize(cols, rows);
    };
    const giveBackToggle = (owner: string) => {
      if (owner !== deviceId && phoneSizeRef.current) {
        phoneSizeRef.current = false;
        setPhoneSize(false);
      }
    };

    const offMessage = client.onMessage((message) => {
      if (!("sessionId" in message) || message.sessionId !== session.id) return;
      if (message.type === "attached") {
        terminal.reset();
        applySize(message.cols, message.rows);
        giveBackToggle(message.sizeOwner);
        gate.attached(message.replay, message.sequence);
      } else if (message.type === "data") {
        gate.data(message.data, message.sequence);
      } else if (message.type === "size") {
        applySize(message.cols, message.rows);
        giveBackToggle(message.sizeOwner);
      }
    });
    const offState = client.onState((state) => {
      if (state !== "open") return;
      gate.reset();
      phoneSizeRef.current = false;
      setPhoneSize(false);
      client.send({ type: "attach", sessionId: session.id });
    });
    client.send({ type: "attach", sessionId: session.id });
    const input = terminal.onData((data) => client.send({ type: "write", sessionId: session.id, data }));

    return () => {
      offMessage();
      offState();
      input.dispose();
      if (phoneSizeRef.current) client.send({ type: "releaseSize", sessionId: session.id });
      client.send({ type: "detach", sessionId: session.id });
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [client, session.id, deviceId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.fontSize = FONT_SIZES[fontIndex];
  }, [fontIndex]);

  const togglePhoneSize = () => {
    const next = !phoneSizeRef.current;
    phoneSizeRef.current = next;
    setPhoneSize(next);
    if (!next) {
      client.send({ type: "releaseSize", sessionId: session.id });
      return;
    }
    const dims = fitRef.current?.proposeDimensions();
    if (dims && dims.cols >= 2 && dims.rows >= 1) {
      client.send({ type: "resize", sessionId: session.id, cols: dims.cols, rows: dims.rows });
    }
  };

  const sendKeys = (data: string) => client.send({ type: "write", sessionId: session.id, data });

  return (
    <main className="m-session-screen">
      <header className="m-bar">
        <button type="button" onClick={onBack} aria-label="세션 목록으로">
          ←
        </button>
        <h1>{session.label}</h1>
        <span className={`m-status m-status-${session.status}`}>{STATUS_LABEL[session.status]}</span>
      </header>
      <div className="m-tools">
        <button type="button" aria-pressed={phoneSize} onClick={togglePhoneSize}>
          📱 폰 크기로
        </button>
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
      </div>
      <div className="m-terminal" ref={hostRef} role="region" aria-label={`${session.label} 터미널`} />
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
    </main>
  );
}
```

`MobileApp.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { PairScreen } from "./PairScreen";
import {
  clearPairing,
  loadPairing,
  RemoteClient,
  remoteSocketUrl,
  savePairing,
  type RemoteClientState,
  type StoredPairing,
} from "./remote-client";
import { SessionList } from "./SessionList";
import { SessionScreen } from "./SessionScreen";
import { applySessionMessage } from "./session-list-model";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function MobileApp() {
  const [pairing, setPairing] = useState<StoredPairing | null>(() => loadPairing(storage()));
  const [notice, setNotice] = useState<string | null>(null);
  const [connection, setConnection] = useState<RemoteClientState>("connecting");
  const [sessions, setSessions] = useState<RemoteSessionSummary[]>([]);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  const [client, setClient] = useState<RemoteClient | null>(null);

  // 클라이언트는 effect 안에서 만들고 cleanup에서 닫는다 — 닫힌 RemoteClient는 다시 connect하지
  // 않으므로, StrictMode의 이중 실행에서도 매번 새 인스턴스여야 한다.
  useEffect(() => {
    if (!pairing) return;
    const next = new RemoteClient({ url: remoteSocketUrl(window.location), token: pairing.token });
    const offMessage = next.onMessage((message) => setSessions((current) => applySessionMessage(current, message)));
    const offState = next.onState((state) => {
      setConnection(state);
      if (state === "unauthorized") {
        clearPairing(storage());
        setNotice("이 기기의 연결이 해제되었습니다. 다시 페어링하세요.");
        setPairing(null);
      }
    });
    next.connect();
    setClient(next);
    return () => {
      offMessage();
      offState();
      next.close();
      setClient(null);
    };
  }, [pairing]);

  if (pairing && !client) return <p className="m-banner">연결 중…</p>;
  if (!pairing || !client) {
    return (
      <PairScreen
        notice={notice}
        onPaired={(next) => {
          savePairing(storage(), next);
          setNotice(null);
          setPairing(next);
        }}
      />
    );
  }

  const openSession = sessions.find((session) => session.id === openSessionId) ?? null;
  if (openSession) {
    return (
      <SessionScreen client={client} session={openSession} deviceId={pairing.deviceId} onBack={() => setOpenSessionId(null)} />
    );
  }
  return (
    <SessionList
      hostName={pairing.hostName}
      connection={connection}
      sessions={sessions}
      onOpen={setOpenSessionId}
      onUnpair={() => {
        clearPairing(storage());
        setPairing(null);
      }}
    />
  );
}
```

`main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MobileApp } from "./MobileApp";
import "./mobile.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
```

`mobile.css`:

```css
:root {
  color-scheme: dark;
  --m-bg: #101214;
  --m-surface: #1a1d21;
  --m-text: #e6e6e6;
  --m-muted: #8b9098;
  --m-accent: #4c8dff;
  --m-warn: #e0a526;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--m-bg); color: var(--m-text); font: 15px/1.4 system-ui, sans-serif; }
button { font: inherit; color: inherit; background: var(--m-surface); border: 1px solid #2a2f36; border-radius: 8px; padding: 8px 12px; min-height: 40px; }
input, textarea { font: inherit; color: inherit; background: var(--m-surface); border: 1px solid #2a2f36; border-radius: 8px; padding: 8px; width: 100%; }
.m-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; padding-top: max(8px, env(safe-area-inset-top)); }
.m-bar h1 { flex: 1; font-size: 16px; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-pair { display: grid; gap: 12px; padding: 24px 16px; max-width: 420px; margin: 0 auto; }
.m-pair label { display: grid; gap: 4px; color: var(--m-muted); }
.m-error { color: #ff6b6b; }
.m-notice, .m-banner { color: var(--m-warn); padding: 0 12px; }
.m-list section { padding: 0 12px 12px; }
.m-list h2 { font-size: 13px; color: var(--m-muted); margin: 12px 0 6px; }
.m-session { display: flex; width: 100%; justify-content: space-between; align-items: center; margin-bottom: 6px; text-align: left; }
.m-session-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-empty { color: var(--m-muted); padding: 24px 12px; }
.m-status { font-size: 12px; color: var(--m-muted); white-space: nowrap; }
.m-status-awaiting-input, .m-status-awaiting-approval { color: var(--m-warn); }
.m-status-working { color: var(--m-accent); }
.m-session-screen { display: grid; grid-template-rows: auto auto 1fr auto auto; height: 100%; }
.m-tools { display: flex; gap: 6px; padding: 0 12px 6px; }
.m-tools [aria-pressed="true"] { border-color: var(--m-accent); color: var(--m-accent); }
.m-terminal { min-height: 0; overflow: auto; padding: 0 4px; }
.m-keys { display: flex; gap: 4px; overflow-x: auto; padding: 6px 8px; }
.m-keys button { flex: 0 0 auto; min-width: 44px; }
.m-composer { display: flex; gap: 6px; padding: 6px 8px; padding-bottom: max(6px, env(safe-area-inset-bottom)); }
.m-composer button { flex: 0 0 auto; }
```

- [ ] **Step 5: 통과·빌드 확인**

Run: `npx vitest run --pool=threads src/renderer/src/mobile` → PASS
Run: `npm run build` → 성공, `out/renderer/mobile.html`과 `out/renderer/assets/mobile-*.js`가 생긴다.
Run: `npm run typecheck` → 0 오류

- [ ] **Step 6: 커밋**

```powershell
git add src/renderer/src/mobile
git commit -m @'
feat: add the mobile pairing, session list, and terminal screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 13: e2e + 문서 동기화

**Files:**
- Create: `e2e/mobile.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-30-mobile-companion-design.md` (위 "Spec 대비 P1 결정" 5개를 해당 절에 반영)

**Interfaces:**
- Consumes: 전체. env `MULTI_CLI_WORK_REMOTE_BIND=127.0.0.1`, `window.multiCliWork.remote.issuePairingCode()`

- [ ] **Step 1: e2e 작성** — `e2e/mobile.spec.ts`. 앱 실행 env와 폴더 seed는 `e2e/desktop.spec.ts`의 `launchApp`·`beforeAll`에서 필요한 부분(`MULTI_CLI_WORK_USER_DATA`, `MULTI_CLI_WORK_REGISTRY_PATH`, `MULTI_CLI_WORK_AGENTS_PATH`… 전부, 그리고 projects.json seed)을 이 파일로 복사한다. fake gh·git repo는 필요 없다. 추가하는 부분:

```ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const WINDOWS = process.platform === "win32";
const SHELL_LABEL = WINDOWS ? "PowerShell" : "Bash";
const SHELL_ID = WINDOWS ? "powershell" : "bash";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

let tempRoot: string;
let app: ElectronApplication;
let page: Page;
let port: number;

test.describe.serial("Mobile companion", () => {
  test.beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-cli-work-mobile-e2e-"));
    port = await freePort();
    // (desktop.spec.ts에서 복사: sample-project 폴더, registry/projects.json seed — PROJECT_ID·"Sample Project")
    await fs.mkdir(path.join(tempRoot, "user-data"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "user-data", "settings.json"),
      JSON.stringify({ remote: { enabled: true, port } }),
      "utf8",
    );
    app = await electron.launch({
      args: [path.resolve("out/main/index.js")],
      env: {
        // (desktop.spec.ts launchApp의 env 전부 복사)
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

  test("pairs a phone, lists the session, and types into it", async () => {
    await expect(page.getByRole("heading", { name: "멀티 터미널 작업기" })).toBeVisible();
    await page.getByRole("button", { name: "Sample Project 폴더 선택" }).click();
    await page.getByRole("button", { name: `새 ${SHELL_LABEL} 세션` }).click();
    const desktopTerminal = page.getByRole("region", { name: `${SHELL_ID} 터미널` });
    await expect(desktopTerminal).toBeVisible();

    await expect.poll(() => page.evaluate(() => window.multiCliWork.remote.status().then((s) => s.state))).toBe("listening");
    const pairing = await page.evaluate(() => window.multiCliWork.remote.issuePairingCode());
    expect(pairing.url).toBe(`http://127.0.0.1:${port}/mobile/`);

    // 폰 역할: 같은 Electron 안의 새 창으로 모바일 페이지를 연다(별도 브라우저 설치가 필요 없다).
    const phonePromise = app.waitForEvent("window");
    await app.evaluate(({ BrowserWindow }, url) => {
      const phoneWindow = new BrowserWindow({ width: 390, height: 844, show: true });
      void phoneWindow.loadURL(url);
    }, pairing.url);
    const phone = await phonePromise;
    await phone.setViewportSize({ width: 390, height: 844 });

    await phone.getByLabel("페어링 코드").fill(pairing.code.toLowerCase());
    await phone.getByRole("button", { name: "연결" }).click();
    const sessionButton = phone.getByRole("button", { name: new RegExp(SHELL_ID, "i") });
    await expect(sessionButton).toBeVisible();

    // 같은 코드는 두 번 못 쓴다.
    const reuse = await phone.evaluate(
      async (code) => (await fetch("/pair", { method: "POST", body: JSON.stringify({ code, deviceName: "x" }) })).status,
      pairing.code,
    );
    expect(reuse).toBe(401);

    await sessionButton.click();
    await expect(phone.locator(".m-terminal .xterm-rows")).toBeVisible();
    await phone.getByLabel("입력").fill(WINDOWS ? "Write-Output MCW_FROM_PHONE" : "echo MCW_FROM_PHONE");
    await phone.getByRole("button", { name: "전송" }).click();
    await expect(phone.locator(".m-terminal .xterm-rows")).toContainText("MCW_FROM_PHONE");
    await expect(page.locator(".xterm-rows")).toContainText("MCW_FROM_PHONE");

    // 철회하면 폰은 페어링 화면으로 돌아간다.
    const devices = await page.evaluate(() => window.multiCliWork.remote.listDevices());
    await page.evaluate((deviceId) => window.multiCliWork.remote.revokeDevice(deviceId), devices[0]!.deviceId);
    await expect(phone.getByText("이 기기의 연결이 해제되었습니다. 다시 페어링하세요.")).toBeVisible();
  });
});
```

("붙기만 해서는 데스크톱 크기가 안 바뀐다"는 Task 6·7 단위 테스트가 지킨다.)

- [ ] **Step 2: e2e 실행**

Run: `npm run test:e2e -- e2e/mobile.spec.ts`
Expected: PASS. CSP `connect-src 'self'`가 WS를 막으면(콘솔 "Refused to connect") `mobile.html`의 `connect-src`를 `'self' ws: wss:`로 넓히고 다시 돌린다.

- [ ] **Step 3: spec 동기화** — `2026-09-30-mobile-companion-design.md`를 고친다:
  - §4-4: 파일 위치를 `userData/remote-devices.json`으로(시크릿 계열과 같은 자리라는 이유 한 줄)
  - §5: `attach{lastSequence}` 줄을 "재연결 시 `attach`로 전체 replay를 다시 받는다(워커에 부분 재생 API가 없다)"로. `hello.mode: "status"`는 P3, `welcome.shellLatest`는 P2라고 표기
  - §6: 데스크톱 회수 계기를 "그 세션에 대한 데스크톱 입력 또는 데스크톱 패인 resize"로. "폰에서 크기 사용 중" 표시는 P4
  - §9 P1 행: "페어링 코드는 텍스트로 표시, 폰 브라우저가 `/mobile/`에서 입력"

- [ ] **Step 4: 전체 검증**

Run: `npx vitest run --pool=threads --maxWorkers=2` → 전체 PASS
Run: `npm run typecheck` → 0 오류
Run: `npm run test:e2e` → 기존 desktop.spec 포함 PASS

- [ ] **Step 5: 커밋**

```powershell
git add e2e/mobile.spec.ts docs/superpowers/specs/2026-09-30-mobile-companion-design.md
git commit -m @'
test: cover phone pairing and input end to end; sync the spec with P1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

- [ ] **Step 6: 실기기 수동 확인 (사용자와 함께, 릴리즈 전)**
  1. PC·폰 모두 Tailscale 켜기 → 설정 ▸ 모바일 ▸ 켜기 → 상태가 "연결 대기 중"이고 주소가 `100.x`
  2. Windows 방화벽 허용 프롬프트가 뜨면 "개인 네트워크" 허용
  3. 폰 Chrome으로 주소 열기 → 코드 입력 → 목록 → claude 세션 열기 → `1`/`Esc`/입력창 전송
  4. "📱 폰 크기로" 켜기 → 폰에서 줄바꿈 확인 → PC 패인에 타이핑 → 폰 토글이 꺼지고 PC 레이아웃 복귀
  5. 폰 Wi-Fi↔LTE 전환 → "다시 연결하는 중…" 뒤 화면 복구
  6. PC에서 기기 연결 해제 → 폰이 페어링 화면으로
