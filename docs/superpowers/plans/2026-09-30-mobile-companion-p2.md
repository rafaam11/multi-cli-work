# 모바일 컴패니언 P2 (Kotlin 셸 + 자가 업데이트 + APK 동봉) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Android 설치형 셸 앱을 만든다. 폰에서 QR로 여러 PC를 등록하고, 각 PC가 서빙하는 모바일 UI를 WebView로 연다. 셸 자신은 PC에 동봉된 APK로 스스로 업데이트한다. APK는 데스크톱 릴리스 파이프라인에서 서명·빌드되어 설치본에 들어간다.

**Architecture:** `android/`에 Gradle 프로젝트(AGP 9 내장 Kotlin + Compose)를 둔다. 순수 Kotlin 코어(`core/`, `net/`, `data/HostRepository`)는 JVM 단위 테스트로 검증하고, Android 전용 부분(Keystore·PackageInstaller·WebView·스캐너)은 얇게 유지하며 실기기로 확인한다. 데스크톱은 `/install`·`/shell.apk`·`/shell.json`을 서빙하고, 설정 탭에 페어링 QR을 그리며, 모바일 웹 UI는 `window.McwShell` 브리지가 있으면 셸이 넘겨준 페어링을 쓴다.

**Tech Stack:** Kotlin 2.4.10 · AGP 9.3.0 · Gradle 9.5.1 · Compose BOM 2026.06.00 · kotlinx-serialization 1.8.1 · play-services-code-scanner 16.1.0 · JDK 17 · compileSdk/targetSdk 37 · minSdk 31 | 데스크톱: 기존 스택 + `qrcode`

**Spec:** `docs/superpowers/specs/2026-09-30-mobile-companion-design.md` (§3.3, §4 QR, §8, §9 P2 행)

## Global Constraints

- applicationId/namespace: `com.rafaam11.multicliwork.mobile` · minSdk **31** · compile/targetSdk **37** · JDK 17
- 셸 버전은 `android/version.properties`의 `shellVersionCode`/`shellVersionName`만 쓴다. 첫 값은 `1` / `0.1.0`이다.
- **자가 업데이트는 첫 배포 APK에 반드시 들어간다**(스펙 §8.3).
- 셸이 받는 호스트 주소는 `100.64.0.0/10` IPv4 + 포트 1024–65535뿐이다. 페어링 URI는 `mcw://pair?host=<ip>:<port>&name=<PC 이름>&code=<코드>&fp=<hostId>` 형식이다.
- 업데이트 APK는 sha256과 **서명 인증서가 설치본과 같은지** 둘 다 통과해야 설치한다.
- 토큰은 Android Keystore AES-GCM 키로 봉인해서 저장한다. 평문 저장과 로그 출력은 금지다.
- WebView는 등록된 호스트 origin(`http://<address>/`) 밖으로 이동하지 않는다. JS 브리지 이름은 `McwShell`이다.
- 서명 키는 `%USERPROFILE%\.multi-cli-work-signing\`에 둔다(레포 밖). Gradle은 `MCW_ANDROID_KEYSTORE_PROPERTIES` 또는 기본 경로의 `keystore.properties`를 읽는다. CI는 env `MCW_ANDROID_KEYSTORE_PATH`/`_PASSWORD`/`MCW_ANDROID_KEY_ALIAS`/`MCW_ANDROID_KEY_PASSWORD`를 쓴다. GitHub Secrets 이름은 `ANDROID_KEYSTORE_B64`·`ANDROID_KEYSTORE_PASSWORD`·`ANDROID_KEY_ALIAS`·`ANDROID_KEY_PASSWORD`다.
- 비밀번호는 명령 출력이나 로그에 찍지 않는다(생성하고 파일과 `gh secret set`에 곧바로 넣는다).
- P1 관례를 이어 간다: main 테스트 첫 줄 `// @vitest-environment node`, vitest는 `--pool=threads`, git·npm은 PowerShell, 커밋 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Gradle은 `android/`에서 `.\gradlew.bat`(Windows)로 돌린다. CI는 `./gradlew`를 쓴다.

## Review Focus

1. **업데이트 APK가 다른 키로 서명됐거나 sha256이 다른 경우** — 설치하지 않고 이유를 보여줘야 한다. → Task 10 `UpdateCheck`·`ApkVerifier` 경로. sha256 불일치는 단위 테스트로 막는다.
2. **폰 카메라 앱으로 QR을 찍어 딥링크로 들어온 경우**(앱 안 스캐너가 아닌 경우) — 앱이 없던 상태·백그라운드 상태 모두 페어링 확인 화면이 떠야 한다. → Task 8 intent 처리(`onCreate`+`onNewIntent`)와 실기기 체크리스트.
3. **같은 PC를 두 번 페어링한 경우** — 호스트 목록에 중복이 생기지 않고 새 토큰으로 바뀌어야 한다(hostId 기준). → Task 7 "save replaces the same hostId"
4. **Keystore 키가 사라진 경우**(기기 초기화·백업 복원) — 봉인된 토큰을 못 열면 앱이 죽지 않고 그 호스트를 "다시 페어링 필요"로 빼야 한다. → Task 7 "drops hosts whose token cannot be opened"
5. **셸 APK가 동봉되지 않은 데스크톱**(dev 빌드·옛 설치본) — `/install`은 안내 문구, `/shell.json`은 404, welcome의 `shellLatest`는 null이어야 하고 셸 업데이트 확인은 조용히 넘어가야 한다. → Task 1 테스트, Task 6 "shellRelease returns null on 404"

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/shared/remote-types.ts` (수정) | `ShellRelease`, `welcome.shellLatest`, `RemotePairingCode.pairUri/installUrl` |
| `src/main/remote/shell-artifact.ts` (신규) | 동봉 APK 위치·`shell.json` 읽기 |
| `src/main/remote/remote-server.ts` · `remote-session-hub.ts` · `remote-access.ts` (수정) | `/install`·`/shell.*` 라우트, welcome에 shellLatest, 페어링 URI |
| `src/renderer/src/RemoteSettings.tsx` (수정) | 페어링 QR·설치 QR |
| `src/renderer/src/mobile/shell-bridge.ts` (신규) · `MobileApp.tsx` · `SessionList.tsx` (수정) | 셸 브리지 사용 |
| `android/**` (신규) | 셸 앱 전체 |
| `scripts/prepare-mobile-shell.mjs` (신규) | 빌드된 APK → `build/mobile/shell.apk` + `shell.json` |
| `package.json` (`build.extraResources`) · `src/main/runtime.ts` (수정) | 설치본 동봉·경로 |
| `.github/workflows/release.yml` · `ci.yml` (수정) | android 잡 |
| `docs/installation.md`, spec (수정) | 설치·키 백업 안내 |

---

### Task 1: 동봉 셸 APK 서빙 (`/install`·`/shell.apk`·`/shell.json`, welcome.shellLatest)

**Files:**
- Modify: `src/shared/remote-types.ts`
- Create: `src/main/remote/shell-artifact.ts` · Test: `src/main/remote/shell-artifact.test.ts`
- Modify: `src/main/remote/remote-server.ts` (+ test), `src/main/remote/remote-session-hub.ts` (+ test)

**Interfaces:**
- Produces:
  - `interface ShellRelease { versionCode: number; versionName: string; sha256: string }` (remote-types)
  - welcome 메시지에 `shellLatest: ShellRelease | null`
  - `interface ShellArtifact { release: ShellRelease; apkPath: string }`
  - `parseShellRelease(value: unknown): ShellRelease | null`
  - `readShellArtifact(dir: string): Promise<ShellArtifact | null>`
  - `RemoteServerOptions.shell?: ShellArtifact | null`
  - `RemoteHubOptions.shellLatest?: () => ShellRelease | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/main/remote/shell-artifact.test.ts`:

```ts
// @vitest-environment node

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseShellRelease, readShellArtifact } from "./shell-artifact";

const SHA = "a".repeat(64);

describe("parseShellRelease", () => {
  it("accepts a well-formed manifest and rejects anything else", () => {
    expect(parseShellRelease({ versionCode: 2, versionName: "0.2.0", sha256: SHA })).toEqual({
      versionCode: 2,
      versionName: "0.2.0",
      sha256: SHA,
    });
    for (const bad of [null, {}, { versionCode: 0, versionName: "x", sha256: SHA }, { versionCode: 1.5, versionName: "x", sha256: SHA }, { versionCode: 1, versionName: "", sha256: SHA }, { versionCode: 1, versionName: "x", sha256: "nothex" }]) {
      expect(parseShellRelease(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("readShellArtifact", () => {
  it("reads shell.json next to shell.apk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcw-shell-"));
    await writeFile(path.join(dir, "shell.apk"), "apk");
    await writeFile(path.join(dir, "shell.json"), JSON.stringify({ versionCode: 1, versionName: "0.1.0", sha256: SHA }));
    expect(await readShellArtifact(dir)).toEqual({
      release: { versionCode: 1, versionName: "0.1.0", sha256: SHA },
      apkPath: path.join(dir, "shell.apk"),
    });
  });

  it("is null when either file is missing or the manifest is bad", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcw-shell-"));
    expect(await readShellArtifact(dir)).toBeNull();
    await writeFile(path.join(dir, "shell.json"), JSON.stringify({ versionCode: 1, versionName: "0.1.0", sha256: SHA }));
    expect(await readShellArtifact(dir)).toBeNull();
    await writeFile(path.join(dir, "shell.apk"), "apk");
    await writeFile(path.join(dir, "shell.json"), "{bad");
    expect(await readShellArtifact(dir)).toBeNull();
  });
});
```

`remote-server.test.ts`에 추가한다. `start()`에 `shell` 옵션을 받게 고쳐서, 테스트용 artifact 디렉터리를 넘길 수 있게 한다:

```ts
  it("serves the bundled shell APK, its manifest, and an install page", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcw-shell-"));
    await writeFile(path.join(dir, "shell.apk"), "APKBYTES");
    const shell = { release: { versionCode: 3, versionName: "0.3.0", sha256: "b".repeat(64) }, apkPath: path.join(dir, "shell.apk") };
    const { base } = await start({ shell });
    const manifest = await fetch(`${base}/shell.json`);
    expect(await manifest.json()).toEqual(shell.release);
    const apk = await fetch(`${base}/shell.apk`);
    expect(apk.headers.get("content-type")).toBe("application/vnd.android.package-archive");
    expect(apk.headers.get("content-disposition")).toContain("Multi-CLI-Work-Mobile-0.3.0.apk");
    expect(await apk.text()).toBe("APKBYTES");
    const install = await fetch(`${base}/install`);
    expect(install.headers.get("content-type")).toContain("text/html");
    const html = await install.text();
    expect(html).toContain('href="/shell.apk"');
    expect(html).toContain("0.3.0");
  });

  it("explains a missing shell on /install and 404s the rest", async () => {
    const { base } = await start({ shell: null });
    expect((await fetch(`${base}/shell.json`)).status).toBe(404);
    expect((await fetch(`${base}/shell.apk`)).status).toBe(404);
    const install = await fetch(`${base}/install`);
    expect(install.status).toBe(200);
    expect(await install.text()).toContain("모바일 앱이 들어 있지 않습니다");
  });
```

(`start(options)`의 옵션 타입에 `shell?: ShellArtifact | null`을 추가하고, `startRemoteServer({... , shell: options.shell ?? null })`로 넘긴다. import에 `mkdtemp`/`writeFile`/`tmpdir`/`path`는 이미 있다.)

`remote-session-hub.test.ts`: `setup()`의 hub 생성에 `shellLatest: () => ({ versionCode: 2, versionName: "0.2.0", sha256: "c".repeat(64) })`를 넘긴다. 첫 테스트의 welcome 기대값을 아래로 바꾼다:

```ts
    expect(sent[0]).toEqual({
      type: "welcome",
      hostId: "host-1",
      hostName: "PC",
      deviceId: "phone",
      protocolVersion: 1,
      shellLatest: { versionCode: 2, versionName: "0.2.0", sha256: "c".repeat(64) },
    });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote/shell-artifact.test.ts src/main/remote/remote-server.test.ts src/main/remote/remote-session-hub.test.ts`
Expected: FAIL (module 없음 / 라우트 404 / welcome에 shellLatest 없음)

- [ ] **Step 3: 구현**

`remote-types.ts` — `RemoteSessionSummary` 위에 추가한다:

```ts
/** PC 설치본에 동봉된 셸 APK. 폰은 이 값으로 자기 업데이트 여부를 정한다. */
export interface ShellRelease {
  versionCode: number;
  versionName: string;
  sha256: string;
}
```

welcome 메시지 타입을 다음으로 바꾼다:

```ts
  | {
      type: "welcome";
      hostId: string;
      hostName: string;
      deviceId: string;
      protocolVersion: number;
      shellLatest: ShellRelease | null;
    }
```

`src/main/remote/shell-artifact.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { ShellRelease } from "../../shared/remote-types";

export interface ShellArtifact {
  release: ShellRelease;
  apkPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseShellRelease(value: unknown): ShellRelease | null {
  if (!isRecord(value)) return null;
  const { versionCode, versionName, sha256 } = value;
  if (typeof versionCode !== "number" || !Number.isInteger(versionCode) || versionCode < 1) return null;
  if (typeof versionName !== "string" || versionName.length === 0) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  return { versionCode, versionName, sha256 };
}

/**
 * 설치본에 동봉된 셸(`resources/mobile/`, dev에서는 `build/mobile/`). 둘 중 하나라도 없으면 null —
 * 그 PC는 /install에서 안내만 하고, 폰의 업데이트 확인은 이 PC를 건너뛴다.
 */
export async function readShellArtifact(dir: string): Promise<ShellArtifact | null> {
  const apkPath = path.join(dir, "shell.apk");
  try {
    const [manifest] = await Promise.all([fs.readFile(path.join(dir, "shell.json"), "utf8"), fs.access(apkPath)]);
    const release = parseShellRelease(JSON.parse(manifest));
    return release ? { release, apkPath } : null;
  } catch {
    return null;
  }
}
```

`remote-server.ts`:
- `import type { ShellArtifact } from "./shell-artifact";`, `import { createReadStream } from "node:fs";`
- `RemoteServerOptions`에 `shell?: ShellArtifact | null;`
- `handleRequest`의 `/mobile` 처리 **앞**에 넣는다:

```ts
  if (pathname === "/shell.json") {
    if (!options.shell) return send(response, 404, "동봉된 모바일 앱이 없습니다");
    return send(response, 200, JSON.stringify(options.shell.release), CONTENT_TYPES[".json"]);
  }
  if (pathname === "/shell.apk") {
    if (!options.shell) return send(response, 404, "동봉된 모바일 앱이 없습니다");
    const stat = await fs.stat(options.shell.apkPath).catch(() => null);
    if (!stat) return send(response, 404, "동봉된 모바일 앱이 없습니다");
    response.writeHead(200, {
      "content-type": "application/vnd.android.package-archive",
      "content-length": String(stat.size),
      "content-disposition": `attachment; filename="Multi-CLI-Work-Mobile-${options.shell.release.versionName}.apk"`,
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    createReadStream(options.shell.apkPath).pipe(response);
    return;
  }
  if (pathname === "/install") return send(response, 200, installPage(options.shell ?? null), CONTENT_TYPES[".html"]);
```

- 파일 위쪽에 설치 페이지를 둔다(스크립트 없는 정적 HTML):

```ts
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** 폰 브라우저가 처음 한 번 여는 페이지. 스크립트 없이 링크와 안내만 있다. */
function installPage(shell: ShellArtifact | null): string {
  const body = shell
    ? `<p><a class="button" href="/shell.apk">모바일 앱 받기 (v${escapeHtml(shell.release.versionName)})</a></p>
<ol>
<li>받은 파일을 열고, "이 출처의 앱 설치 허용"을 켠 뒤 설치합니다.</li>
<li>앱에서 <b>QR로 PC 추가</b>를 누르고 PC의 설정 ▸ 모바일 ▸ 기기 추가 QR을 찍습니다.</li>
<li>이후 업데이트는 앱이 PC에서 직접 받아 설치합니다.</li>
</ol>`
    : "<p>이 PC 설치본에는 모바일 앱이 들어 있지 않습니다. 릴리스 설치본을 쓰거나 개발 빌드에서 build/mobile을 준비하세요.</p>";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>멀티 터미널 작업기 모바일 설치</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#101214;color:#e6e6e6;margin:0;padding:24px}a.button{display:inline-block;padding:12px 16px;border-radius:8px;background:#4c8dff;color:#fff;text-decoration:none}</style>
</head><body><h1>모바일 앱 설치</h1>${body}</body></html>`;
}
```

`remote-session-hub.ts`:
- `import type { ShellRelease } from "../../shared/remote-types";`(기존 import 줄에 합친다)
- `RemoteHubOptions`에 `shellLatest?: () => ShellRelease | null;`
- welcome 전송에 `shellLatest: this.options.shellLatest?.() ?? null,`를 추가한다

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/main/remote` · `npm run typecheck`
Expected: PASS, 0 오류. `remote-client.test.ts`의 `welcome` 상수는 형식만 쓰므로 `shellLatest: null`을 추가해 타입을 맞춘다(타입 오류가 나면).

- [ ] **Step 5: 커밋** — `feat: serve the bundled mobile shell and announce it in welcome`

---

### Task 2: 페어링 QR (데스크톱 설정 탭)

**Files:**
- Modify: `package.json` (`qrcode` 1.5.4, `@types/qrcode` dev)
- Modify: `src/shared/remote-types.ts` (`RemotePairingCode`에 `pairUri`, `installUrl`)
- Modify: `src/main/remote/remote-access.ts` (+ test) — `issuePairingCode(): Promise<RemotePairingCode>`
- Modify: `src/main/ipc.ts` 게이트웨이 타입(`issuePairingCode(): Promise<RemotePairingCode>`), `src/shared/api-types.ts`는 이미 Promise다
- Modify: `src/renderer/src/RemoteSettings.tsx` (+ test)

**Interfaces:**
- Produces: `RemotePairingCode { code; expiresAt; url; pairUri: string; installUrl: string }`. `pairUri` = `mcw://pair?host=<host>:<port>&name=<encodeURIComponent(hostName)>&code=<code 하이픈 제거>&fp=<hostId>`, `installUrl` = `http://<host>:<port>/install`
- `pairingUri(input: { address: string; hostName: string; code: string; hostId: string }): string` (remote-access.ts에서 export)

- [ ] **Step 1: 실패하는 테스트 작성**

`remote-access.test.ts`에서 기존 "issues a pairing code only while listening"을 아래로 바꾼다:

```ts
  it("issues a pairing code with a QR URI and install URL only while listening", async () => {
    const { access } = setup();
    await expect(access.issuePairingCode()).rejects.toThrow(/켜져/);
    await access.apply({ enabled: true, port: 47821 });
    expect(await access.issuePairingCode()).toEqual({
      code: "ABCD-EFGH",
      expiresAt: new Date(1_000).toISOString(),
      url: "http://100.101.102.103:47821/mobile/",
      pairUri: "mcw://pair?host=100.101.102.103:47821&name=PC&code=ABCDEFGH&fp=host-1",
      installUrl: "http://100.101.102.103:47821/install",
    });
  });

  it("encodes the host name in the pairing URI", () => {
    expect(pairingUri({ address: "100.64.0.1:47821", hostName: "내 PC & 노트북", code: "ABCD-EFGH", hostId: "h" })).toBe(
      "mcw://pair?host=100.64.0.1:47821&name=%EB%82%B4%20PC%20%26%20%EB%85%B8%ED%8A%B8%EB%B6%81&code=ABCDEFGH&fp=h",
    );
  });
```

(`import { pairingUri, RemoteAccess, type RemoteAccessOptions } from "./remote-access";`)

`RemoteSettings.test.tsx` — `issuePairingCode` mock 값에 `pairUri: "mcw://pair?host=100.64.0.9:47821&name=PC&code=ABCDEFGH&fp=h"`, `installUrl: "http://100.64.0.9:47821/install"`를 추가하고, 테스트를 추가한다:

```tsx
  it("draws the pairing and install QR codes", async () => {
    render(<RemoteSettings settings={{ ...DEFAULT_SETTINGS, remote: { enabled: true, port: 47821 } }} />);
    fireEvent.click(await screen.findByRole("button", { name: "기기 추가" }));
    const pairQr = await screen.findByRole("img", { name: "페어링 QR 코드" });
    expect(pairQr.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByRole("img", { name: "앱 설치 QR 코드" })).toBeInTheDocument();
  });
```

(`ipc.test.ts`의 `remoteGateway.issuePairingCode`는 `vi.fn(async () => ...)`로 바꾼다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/main/remote/remote-access.test.ts src/renderer/src/RemoteSettings.test.tsx src/main/ipc.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

```powershell
npm install qrcode@1.5.4 --save-exact
npm install @types/qrcode --save-dev --save-exact
```

`remote-types.ts`의 `RemotePairingCode`:

```ts
export interface RemotePairingCode {
  /** 표시용 "ABCD-EFGH". 입력할 때 하이픈과 대소문자는 무시한다. */
  code: string;
  expiresAt: string;
  url: string;
  /** 셸 앱이 스캔하는 QR 내용. */
  pairUri: string;
  /** 처음 설치할 때 폰 브라우저로 여는 주소. */
  installUrl: string;
}
```

`remote-access.ts`:

```ts
export function pairingUri(input: { address: string; hostName: string; code: string; hostId: string }): string {
  const code = input.code.replace(/-/g, "");
  return `mcw://pair?host=${input.address}&name=${encodeURIComponent(input.hostName)}&code=${code}&fp=${encodeURIComponent(input.hostId)}`;
}
```

`issuePairingCode`를 async로 바꾼다:

```ts
  async issuePairingCode(): Promise<RemotePairingCode> {
    const running = this.running;
    if (this.current.state !== "listening" || this.current.url === null || running === null) {
      throw new Error("모바일 연결이 켜져 있지 않습니다");
    }
    const { code, expiresAt } = this.options.pairing.issue();
    const address = `${running.host}:${running.port}`;
    return {
      code,
      expiresAt: new Date(expiresAt).toISOString(),
      url: this.current.url,
      pairUri: pairingUri({ address, hostName: this.options.hostName, code, hostId: await this.options.devices.hostId() }),
      installUrl: `http://${address}/install`,
    };
  }
```

`ipc.ts`의 `RemoteGateway.issuePairingCode(): Promise<RemotePairingCode>;`

`RemoteSettings.tsx`:
- `import QRCode from "qrcode";`
- 상태 `const [qr, setQr] = useState<{ pair: string; install: string } | null>(null);`
- 헬퍼 `const svgDataUrl = (svg: string) => \`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}\`;`
- `issueCode`를 아래로 바꾼다:

```tsx
  const issueCode = () => {
    setError(null);
    window.multiCliWork.remote
      .issuePairingCode()
      .then(async (next) => {
        const [pair, install] = await Promise.all([
          QRCode.toString(next.pairUri, { type: "svg", margin: 1 }),
          QRCode.toString(next.installUrl, { type: "svg", margin: 1 }),
        ]);
        setPairing(next);
        setQr({ pair: svgDataUrl(pair), install: svgDataUrl(install) });
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
  };
```

- 페어링 안내 문단을 아래로 바꾼다:

```tsx
      {pairing && qr ? (
        <div className="settings-remote-pairing">
          <figure>
            <img src={qr.pair} alt="페어링 QR 코드" width={180} height={180} />
            <figcaption>셸 앱의 "QR로 PC 추가"로 찍으세요</figcaption>
          </figure>
          <figure>
            <img src={qr.install} alt="앱 설치 QR 코드" width={140} height={140} />
            <figcaption>앱이 아직 없다면 폰 카메라로 먼저 이것을 찍어 설치하세요</figcaption>
          </figure>
          <p className="settings-hint">
            브라우저로 쓸 때는 <code>{pairing.url}</code>에서 코드 <strong>{pairing.code}</strong>를 입력합니다.{" "}
            {new Date(pairing.expiresAt).toLocaleTimeString("ko-KR")}까지 한 번만 쓸 수 있습니다.
          </p>
        </div>
      ) : null}
```

- 렌더러 CSS(설정 스타일이 있는 파일 — `SettingsDialog`가 쓰는 css에서 `.settings-hint`를 찾아 같은 파일)에 추가한다:

```css
.settings-remote-pairing { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; margin: 8px 0; }
.settings-remote-pairing figure { margin: 0; display: grid; gap: 4px; justify-items: center; max-width: 200px; }
.settings-remote-pairing img { background: #fff; border-radius: 6px; padding: 6px; }
.settings-remote-pairing figcaption { font-size: 12px; color: var(--text-muted, #8b9098); text-align: center; }
```

(`--text-muted`가 없으면 그 css 파일에서 흐린 글자에 쓰는 변수로 바꾼다.)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/main/remote src/renderer/src/RemoteSettings.test.tsx src/main/ipc.test.ts` · `npm run typecheck`
Expected: PASS

- [ ] **Step 5: 커밋** — `feat: show pairing and install QR codes in the mobile settings tab`

---

### Task 3: 모바일 웹 UI의 셸 브리지

**Files:**
- Create: `src/renderer/src/mobile/shell-bridge.ts` · Test: `shell-bridge.test.ts`
- Modify: `src/renderer/src/mobile/MobileApp.tsx`, `SessionList.tsx` (+ `SessionList.test.tsx`)

**Interfaces:**
- Consumes: `StoredPairing` (Task P1-11)
- Produces:
  - `interface ShellBridge { bridgeVersion: number; pairing: StoredPairing | null; unpaired(): void; backToHosts(): void }`
  - `readShellBridge(target: { McwShell?: unknown }): ShellBridge | null`
  - `SessionList` prop `leaveLabel: string` (기본 "연결 해제")
- Android 쪽 계약(Task 9가 구현): `window.McwShell` = `{ bridgeVersion(): number; pairingJson(): string; unpaired(): void; backToHosts(): void }`

- [ ] **Step 1: 실패하는 테스트 작성** — `shell-bridge.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { readShellBridge } from "./shell-bridge";

function raw(overrides: Record<string, unknown> = {}) {
  return {
    bridgeVersion: () => 1,
    pairingJson: () => JSON.stringify({ token: "t", deviceId: "d", hostName: "PC" }),
    unpaired: vi.fn(),
    backToHosts: vi.fn(),
    ...overrides,
  };
}

describe("readShellBridge", () => {
  it("is null in a plain browser", () => {
    expect(readShellBridge({})).toBeNull();
  });

  it("reads the pairing the shell hands over and forwards the calls", () => {
    const shell = raw();
    const bridge = readShellBridge({ McwShell: shell })!;
    expect(bridge.bridgeVersion).toBe(1);
    expect(bridge.pairing).toEqual({ token: "t", deviceId: "d", hostName: "PC" });
    bridge.unpaired();
    bridge.backToHosts();
    expect(shell.unpaired).toHaveBeenCalled();
    expect(shell.backToHosts).toHaveBeenCalled();
  });

  it("treats a broken pairing payload as no pairing, not a crash", () => {
    expect(readShellBridge({ McwShell: raw({ pairingJson: () => "{bad" }) })!.pairing).toBeNull();
    expect(readShellBridge({ McwShell: raw({ pairingJson: () => '{"token":1}' }) })!.pairing).toBeNull();
  });

  it("ignores an object that is not the shell", () => {
    expect(readShellBridge({ McwShell: { hello: 1 } })).toBeNull();
  });
});
```

`SessionList.test.tsx` 첫 테스트의 props에 `leaveLabel="호스트 목록"`을 넣고, `expect(screen.getByRole("button", { name: "호스트 목록" })).toBeInTheDocument();`를 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --pool=threads src/renderer/src/mobile`
Expected: FAIL

- [ ] **Step 3: 구현** — `shell-bridge.ts`:

```ts
import type { StoredPairing } from "./remote-client";

export interface ShellBridge {
  bridgeVersion: number;
  pairing: StoredPairing | null;
  /** 호스트가 이 기기를 거절했다(철회) — 셸이 호스트를 지우고 목록으로 돌아간다. */
  unpaired(): void;
  backToHosts(): void;
}

interface RawShell {
  bridgeVersion(): number;
  pairingJson(): string;
  unpaired(): void;
  backToHosts(): void;
}

function isRawShell(value: unknown): value is RawShell {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ["bridgeVersion", "pairingJson", "unpaired", "backToHosts"].every((key) => typeof candidate[key] === "function");
}

function parsePairing(json: string): StoredPairing | null {
  try {
    const value = JSON.parse(json) as Partial<StoredPairing>;
    return typeof value.token === "string" && typeof value.deviceId === "string" && typeof value.hostName === "string"
      ? { token: value.token, deviceId: value.deviceId, hostName: value.hostName }
      : null;
  } catch {
    return null;
  }
}

/**
 * Android 셸의 WebView 안이면 셸이 `McwShell`을 심어 둔다. 페어링은 셸이 Keystore에 갖고 있으므로
 * 브라우저 localStorage 대신 그것을 쓴다. 평범한 브라우저에서는 null.
 */
export function readShellBridge(target: { McwShell?: unknown }): ShellBridge | null {
  const shell = target.McwShell;
  if (!isRawShell(shell)) return null;
  return {
    bridgeVersion: shell.bridgeVersion(),
    pairing: parsePairing(shell.pairingJson()),
    unpaired: () => shell.unpaired(),
    backToHosts: () => shell.backToHosts(),
  };
}
```

`SessionList.tsx`: props에 `leaveLabel?: string`을 추가하고, 헤더 버튼을 `{leaveLabel ?? "연결 해제"}`로, `onClick={onUnpair}`는 그대로 둔다.

`MobileApp.tsx`:
- `import { readShellBridge } from "./shell-bridge";`
- 컴포넌트 첫 줄: `const [bridge] = useState(() => readShellBridge(window as unknown as { McwShell?: unknown }));`
- 초기 pairing: `useState<StoredPairing | null>(() => bridge?.pairing ?? loadPairing(storage()))`
- unauthorized 처리:

```tsx
      if (state === "unauthorized") {
        if (bridge) {
          bridge.unpaired();
          return;
        }
        clearPairing(storage());
        setNotice("이 기기의 연결이 해제되었습니다. 다시 페어링하세요.");
        setPairing(null);
      }
```

(effect 의존성 배열을 `[pairing, bridge]`로 바꾼다.)
- `SessionList`에 `leaveLabel={bridge ? "호스트 목록" : "연결 해제"}`, `onUnpair={() => { if (bridge) { bridge.backToHosts(); return; } clearPairing(storage()); setPairing(null); }}`
- 셸 안인데 pairing이 없으면(비정상) PairScreen 대신 안내만 한다: `if (bridge && !pairing) return <p className="m-banner">셸에 이 PC의 페어링 정보가 없습니다. 호스트 목록에서 다시 추가하세요.</p>;` — `if (pairing && !client)` 줄 **앞**에 둔다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --pool=threads src/renderer/src/mobile` · `npm run typecheck`
Expected: PASS

- [ ] **Step 5: 커밋** — `feat: let the mobile page use the Android shell's pairing bridge`

---

### Task 4: Android Gradle 프로젝트 골격

**Files (모두 신규, `android/` 아래):**
- `settings.gradle.kts`, `build.gradle.kts`, `gradle.properties`, `gradle/libs.versions.toml`, `version.properties`, `.gitignore`
- `gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`, `gradle/wrapper/gradle-wrapper.properties` (`C:\dev\srt-reservation`에서 복사 — 같은 Gradle 9.5.1 wrapper)
- `app/build.gradle.kts`, `app/src/main/AndroidManifest.xml`, `app/src/main/res/values/strings.xml`, `app/src/main/res/values/themes.xml`, `app/src/main/res/drawable/ic_launcher_foreground.xml`, `app/src/main/res/mipmap-anydpi/ic_launcher.xml`, `app/src/main/res/xml/network_security_config.xml`
- `app/src/main/kotlin/com/rafaam11/multicliwork/mobile/MainActivity.kt` (임시 화면 — Task 8에서 교체)
- Test: `app/src/test/kotlin/com/rafaam11/multicliwork/mobile/BuildConfigTest.kt`

**Interfaces:**
- Produces: `BuildConfig.VERSION_CODE`(= shellVersionCode), `BuildConfig.VERSION_NAME`. 명령: `.\gradlew.bat testDebugUnitTest assembleDebug`

- [ ] **Step 1: wrapper 복사와 설정 파일**

```powershell
New-Item -ItemType Directory -Force android\gradle\wrapper | Out-Null
Copy-Item C:\dev\srt-reservation\gradlew, C:\dev\srt-reservation\gradlew.bat android\
Copy-Item C:\dev\srt-reservation\gradle\wrapper\gradle-wrapper.jar, C:\dev\srt-reservation\gradle\wrapper\gradle-wrapper.properties android\gradle\wrapper\
```

`android/version.properties`:

```properties
# 셸 앱 버전 — 셸 코드가 바뀐 릴리스에서만 올린다(데스크톱 버전과 독립, 스펙 §8.1).
shellVersionCode=1
shellVersionName=0.1.0
```

`android/.gitignore`:

```
.gradle/
build/
app/build/
local.properties
keystore.properties
*.jks
```

`android/settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "multi-cli-work-mobile"
include(":app")
```

`android/build.gradle.kts`:

```kotlin
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
```

`android/gradle.properties`:

```properties
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
```

`android/gradle/libs.versions.toml`:

```toml
[versions]
agp = "9.3.0"
kotlin = "2.4.10"
composeBom = "2026.06.00"
activityCompose = "1.12.4"
coreKtx = "1.16.0"
lifecycle = "2.11.0"
coroutines = "1.11.0"
serialization = "1.8.1"
codeScanner = "16.1.0"

[libraries]
compose-bom = { module = "androidx.compose:compose-bom", version.ref = "composeBom" }
compose-ui = { module = "androidx.compose.ui:ui" }
compose-material3 = { module = "androidx.compose.material3:material3" }
compose-ui-tooling = { module = "androidx.compose.ui:ui-tooling" }
activity-compose = { module = "androidx.activity:activity-compose", version.ref = "activityCompose" }
core-ktx = { module = "androidx.core:core-ktx", version.ref = "coreKtx" }
lifecycle-runtime-compose = { module = "androidx.lifecycle:lifecycle-runtime-compose", version.ref = "lifecycle" }
coroutines-android = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-android", version.ref = "coroutines" }
serialization-json = { module = "org.jetbrains.kotlinx:kotlinx-serialization-json", version.ref = "serialization" }
code-scanner = { module = "com.google.android.gms:play-services-code-scanner", version.ref = "codeScanner" }
junit = { module = "junit:junit", version = "4.13.2" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
# AGP 9+는 Kotlin 지원이 내장돼 org.jetbrains.kotlin.android를 따로 적용하지 않는다.
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
```

`android/app/build.gradle.kts`:

```kotlin
import java.io.FileInputStream
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

val shellVersion = Properties().apply { rootProject.file("version.properties").inputStream().use(::load) }

// 릴리스 서명: 로컬은 레포 밖 keystore.properties(기본 ~/.multi-cli-work-signing/), CI는 MCW_ANDROID_* env.
// 둘 다 없으면 release 빌드에 서명을 붙이지 않는다(키 없는 환경에서도 assembleRelease는 된다).
val keystoreProperties = Properties().apply {
    val path = System.getenv("MCW_ANDROID_KEYSTORE_PROPERTIES")
        ?: "${System.getProperty("user.home")}/.multi-cli-work-signing/keystore.properties"
    val file = File(path)
    if (file.exists()) FileInputStream(file).use(::load)
}
fun signingValue(key: String, env: String): String? = System.getenv(env) ?: keystoreProperties.getProperty(key)
val releaseStoreFile = signingValue("storeFile", "MCW_ANDROID_KEYSTORE_PATH")

android {
    namespace = "com.rafaam11.multicliwork.mobile"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.rafaam11.multicliwork.mobile"
        minSdk = 31
        targetSdk = 37
        versionCode = shellVersion.getProperty("shellVersionCode").toInt()
        versionName = shellVersion.getProperty("shellVersionName")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    signingConfigs {
        create("release") {
            if (releaseStoreFile != null) {
                storeFile = file(releaseStoreFile)
                storePassword = signingValue("storePassword", "MCW_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "MCW_ANDROID_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "MCW_ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            if (releaseStoreFile != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.core.ktx)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.coroutines.android)
    implementation(libs.serialization.json)
    implementation(libs.code.scanner)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
}
```

`AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />

    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:theme="@style/Theme.Mcw"
        android:allowBackup="false"
        android:networkSecurityConfig="@xml/network_security_config">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

`res/values/strings.xml`: `<resources><string name="app_name">멀티 터미널</string></resources>`

`res/values/themes.xml`:

```xml
<resources>
    <style name="Theme.Mcw" parent="android:Theme.Material.NoActionBar">
        <item name="android:windowBackground">@android:color/black</item>
    </style>
</resources>
```

`res/xml/network_security_config.xml` (호스트는 Tailscale IP의 평문 HTTP — WireGuard가 암호화한다, 스펙 §4):

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
```

`res/drawable/ic_launcher_foreground.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#4C8DFF" android:pathData="M30,34h48v40h-48z" />
    <path android:fillColor="#101214" android:pathData="M36,40h36v28h-36z" />
    <path android:fillColor="#E6E6E6" android:pathData="M40,46l8,6l-8,6v-3l4,-3l-4,-3zM52,56h12v3h-12z" />
</vector>
```

`res/mipmap-anydpi/ic_launcher.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@android:color/black" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
```

`MainActivity.kt` (임시):

```kotlin
package com.rafaam11.multicliwork.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Text

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { Text("멀티 터미널 ${BuildConfig.VERSION_NAME}") }
    }
}
```

- [ ] **Step 2: 실패하는 테스트** — `app/src/test/kotlin/com/rafaam11/multicliwork/mobile/BuildConfigTest.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.util.Properties

class BuildConfigTest {
    @Test
    fun versionComesFromVersionProperties() {
        val props = Properties().apply { File("../version.properties").inputStream().use(::load) }
        assertEquals(props.getProperty("shellVersionCode").toInt(), BuildConfig.VERSION_CODE)
        assertEquals(props.getProperty("shellVersionName"), BuildConfig.VERSION_NAME)
    }
}
```

(단위 테스트의 작업 디렉터리는 `android/app`이다.) 먼저 `app/build.gradle.kts`의 `versionCode = ...` 줄을 잠깐 `versionCode = 999`로 두고 실행해서 실패를 본 뒤, 원래 줄로 되돌린다.

Run (android/에서): `.\gradlew.bat testDebugUnitTest`
Expected: FAIL (999 ≠ 1)

- [ ] **Step 3: 되돌린 뒤 통과·빌드 확인**

Run: `.\gradlew.bat testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, `app/build/outputs/apk/debug/app-debug.apk` 생성

(버전 해석이 실패하면 — 예: `org.jetbrains.kotlin.plugin.serialization` 2.4.10이나 serialization 1.8.1 해석 실패 — 호환되는 최신 패치로 올리고 ledger에 Ruling으로 남긴다.)

- [ ] **Step 4: 커밋** — `gradlew`에 실행 비트를 준다: `git update-index --add --chmod=+x android/gradlew` 후 `git add android` → `feat: scaffold the Android shell project`

---

### Task 5: 순수 Kotlin 코어 (페어링 URI · 셸 릴리스 · sha256)

**Files:**
- Create: `app/src/main/kotlin/com/rafaam11/multicliwork/mobile/core/PairUri.kt`, `core/ShellRelease.kt`, `core/Sha256.kt`
- Test: `app/src/test/kotlin/com/rafaam11/multicliwork/mobile/core/PairUriTest.kt`, `ShellReleaseTest.kt`, `Sha256Test.kt`

**Interfaces:**
- Produces:
  - `data class PairRequest(val address: String, val hostName: String, val code: String, val hostId: String)`
  - `object PairUri { fun parse(raw: String): PairRequest? }`
  - `@Serializable data class ShellRelease(val versionCode: Int, val versionName: String, val sha256: String)`
  - `object ShellReleases { fun newest(releases: List<ShellRelease?>): ShellRelease?; fun updateFor(installedVersionCode: Int, releases: List<ShellRelease?>): ShellRelease? }`
  - `object Sha256 { fun hex(input: java.io.InputStream): String }`

- [ ] **Step 1: 실패하는 테스트**

`PairUriTest.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairUriTest {
    @Test
    fun parsesTheDesktopQr() {
        assertEquals(
            PairRequest(address = "100.101.102.103:47821", hostName = "내 PC & 노트북", code = "ABCDEFGH", hostId = "host-1"),
            PairUri.parse("mcw://pair?host=100.101.102.103:47821&name=%EB%82%B4%20PC%20%26%20%EB%85%B8%ED%8A%B8%EB%B6%81&code=ABCDEFGH&fp=host-1"),
        )
    }

    @Test
    fun defaultsTheNameAndTrimsWhitespace() {
        assertEquals("PC", PairUri.parse("  mcw://pair?host=100.64.0.1:47821&code=ABCDEFGH&fp=h  ")?.hostName)
    }

    @Test
    fun rejectsAnythingThatIsNotATailnetPairingQr() {
        listOf(
            "https://example.com",
            "mcw://other?host=100.64.0.1:47821&code=ABCDEFGH&fp=h",
            "mcw://pair?host=192.168.0.10:47821&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.128.0.1:47821&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.64.0.1:80&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.64.0.1&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.64.0.1:47821&code=&fp=h",
            "mcw://pair?host=100.64.0.1:47821&code=ABCDEFGH",
            "mcw://pair?host=100.64.0.1:47821&code=AB/../CD&fp=h",
            "not a uri at all %%%",
        ).forEach { assertNull(it, PairUri.parse(it)) }
    }
}
```

`ShellReleaseTest.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShellReleaseTest {
    private fun release(code: Int) = ShellRelease(code, "0.$code.0", "a".repeat(64))

    @Test
    fun picksTheNewestAcrossHostsAndIgnoresUnreachableOnes() {
        assertEquals(release(3), ShellReleases.newest(listOf(release(2), null, release(3), release(1))))
        assertNull(ShellReleases.newest(listOf(null, null)))
    }

    @Test
    fun offersAnUpdateOnlyWhenNewerThanInstalled() {
        assertEquals(release(3), ShellReleases.updateFor(2, listOf(release(3))))
        assertNull(ShellReleases.updateFor(3, listOf(release(3))))
        assertNull(ShellReleases.updateFor(4, listOf(release(3))))
    }
}
```

`Sha256Test.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.core

import org.junit.Assert.assertEquals
import org.junit.Test

class Sha256Test {
    @Test
    fun hashesAStream() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            Sha256.hex("abc".byteInputStream()),
        )
    }

    @Test
    fun hashesAcrossBufferBoundaries() {
        val big = ByteArray(200_000) { (it % 251).toByte() }
        val expected = java.security.MessageDigest.getInstance("SHA-256").digest(big).joinToString("") { "%02x".format(it) }
        assertEquals(expected, Sha256.hex(big.inputStream()))
    }
}
```

Run: `.\gradlew.bat testDebugUnitTest` → Expected: FAIL (컴파일 오류: 심볼 없음)

- [ ] **Step 2: 구현**

`PairUri.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.core

import java.net.URI
import java.net.URLDecoder

data class PairRequest(val address: String, val hostName: String, val code: String, val hostId: String)

/**
 * 데스크톱 설정 ▸ 모바일 ▸ 기기 추가의 QR(`mcw://pair?host=&name=&code=&fp=`). 셸이 받는 주소는
 * Tailscale 대역(100.64.0.0/10)뿐이다 — 다른 QR로 엉뚱한 서버에 토큰을 받으러 가지 않게.
 */
object PairUri {
    private val TAILNET_IPV4 = Regex("""^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(\d{1,3})\.(\d{1,3})$""")
    private val CODE = Regex("""^[A-Za-z0-9-]{8,9}$""")

    fun parse(raw: String): PairRequest? {
        val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return null
        if (uri.scheme != "mcw" || uri.host != "pair") return null
        val params = (uri.rawQuery ?: return null).split("&").mapNotNull { part ->
            val index = part.indexOf('=')
            if (index <= 0) null
            else part.substring(0, index) to runCatching { URLDecoder.decode(part.substring(index + 1), "UTF-8") }.getOrNull()
        }.filter { it.second != null }.associate { it.first to it.second!! }

        val address = params["host"] ?: return null
        val parts = address.split(":")
        if (parts.size != 2) return null
        val match = TAILNET_IPV4.matchEntire(parts[0]) ?: return null
        if (match.groupValues.drop(2).any { it.toInt() > 255 }) return null
        val port = parts[1].toIntOrNull() ?: return null
        if (port !in 1024..65535) return null

        val code = params["code"]?.takeIf { CODE.matches(it) } ?: return null
        val hostId = params["fp"]?.takeIf { it.isNotBlank() } ?: return null
        val hostName = params["name"]?.trim()?.takeIf { it.isNotEmpty() } ?: "PC"
        return PairRequest(address = address, hostName = hostName, code = code, hostId = hostId)
    }
}
```

`ShellRelease.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.core

import kotlinx.serialization.Serializable

/** PC가 /shell.json으로 알려주는 동봉 셸 APK. */
@Serializable
data class ShellRelease(val versionCode: Int, val versionName: String, val sha256: String)

object ShellReleases {
    fun newest(releases: List<ShellRelease?>): ShellRelease? = releases.filterNotNull().maxByOrNull { it.versionCode }

    fun updateFor(installedVersionCode: Int, releases: List<ShellRelease?>): ShellRelease? =
        newest(releases)?.takeIf { it.versionCode > installedVersionCode }
}
```

`Sha256.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.core

import java.io.InputStream
import java.security.MessageDigest

object Sha256 {
    fun hex(input: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
```

- [ ] **Step 3: 통과 확인** — `.\gradlew.bat testDebugUnitTest` → PASS
- [ ] **Step 4: 커밋** — `feat: parse pairing QR codes and shell releases in the Android shell`

---

### Task 6: 호스트 HTTP 클라이언트 (`/pair`·`/shell.json`·`/shell.apk`)

**Files:**
- Create: `app/src/main/kotlin/com/rafaam11/multicliwork/mobile/net/HostApi.kt`
- Test: `app/src/test/kotlin/com/rafaam11/multicliwork/mobile/net/HostApiTest.kt`

**Interfaces:**
- Consumes: `ShellRelease` (Task 5)
- Produces:
  - `@Serializable data class PairResponse(val token: String, val deviceId: String, val hostId: String, val hostName: String)`
  - `class PairingException(message: String) : Exception(message)`
  - `class HostApi(timeoutMs: Int = 5_000) { fun pair(address: String, code: String, deviceName: String): PairResponse; fun shellRelease(address: String): ShellRelease?; fun downloadApk(address: String, dest: java.io.File) }`

- [ ] **Step 1: 실패하는 테스트** — JDK 내장 `com.sun.net.httpserver.HttpServer`로 가짜 호스트를 띄운다:

```kotlin
package com.rafaam11.multicliwork.mobile.net

import com.rafaam11.multicliwork.mobile.core.ShellRelease
import com.sun.net.httpserver.HttpServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress

class HostApiTest {
    private lateinit var server: HttpServer
    private lateinit var address: String
    private var lastPairBody = ""

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/pair") { exchange ->
            lastPairBody = exchange.requestBody.bufferedReader().readText()
            val (status, body) = when {
                lastPairBody.contains("\"GOOD\"") -> 200 to """{"token":"t","deviceId":"d","hostId":"h","hostName":"PC","extra":1}"""
                lastPairBody.contains("\"BUSY\"") -> 429 to "busy"
                else -> 401 to "nope"
            }
            val bytes = body.toByteArray()
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.createContext("/shell.json") { exchange ->
            val bytes = """{"versionCode":2,"versionName":"0.2.0","sha256":"${"a".repeat(64)}"}""".toByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.createContext("/shell.apk") { exchange ->
            val bytes = "APK".toByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        address = "127.0.0.1:${server.address.port}"
    }

    @After
    fun stop() = server.stop(0)

    @Test
    fun pairsAndIgnoresUnknownFields() {
        assertEquals(PairResponse("t", "d", "h", "PC"), HostApi().pair(address, "GOOD", "내 폰"))
        assertTrue(lastPairBody.contains("\"deviceName\":\"내 폰\""))
    }

    @Test
    fun explainsPairingFailuresInKorean() {
        assertEquals("코드가 맞지 않거나 만료되었습니다", assertThrows(PairingException::class.java) { HostApi().pair(address, "BAD", "x") }.message)
        assertEquals("시도가 너무 많습니다. 잠시 후 다시 시도하세요", assertThrows(PairingException::class.java) { HostApi().pair(address, "BUSY", "x") }.message)
    }

    @Test
    fun readsTheShellReleaseAndDownloadsTheApk() {
        assertEquals(ShellRelease(2, "0.2.0", "a".repeat(64)), HostApi().shellRelease(address))
        val dest = File.createTempFile("shell", ".apk")
        HostApi().downloadApk(address, dest)
        assertEquals("APK", dest.readText())
    }

    @Test
    fun shellReleaseReturnsNullOn404OrUnreachable() {
        server.removeContext("/shell.json")
        assertNull(HostApi().shellRelease(address))
        assertNull(HostApi(timeoutMs = 500).shellRelease("127.0.0.1:1"))
    }
}
```

Run: `.\gradlew.bat testDebugUnitTest` → FAIL (컴파일 오류)

- [ ] **Step 2: 구현**

```kotlin
package com.rafaam11.multicliwork.mobile.net

import com.rafaam11.multicliwork.mobile.core.ShellRelease
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

@Serializable
data class PairResponse(val token: String, val deviceId: String, val hostId: String, val hostName: String)

class PairingException(message: String) : Exception(message)

/**
 * PC(데스크톱 multi-cli-work)의 인증 없는 HTTP 경로들. 세션 데이터는 WebView 안의 WS로만 흐르고,
 * 여기는 페어링과 셸 업데이트만 다룬다. 모두 블로킹이므로 IO 디스패처에서 부른다.
 */
class HostApi(private val timeoutMs: Int = 5_000) {
    private val json = Json { ignoreUnknownKeys = true }

    fun pair(address: String, code: String, deviceName: String): PairResponse {
        val connection = open("http://$address/pair")
        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("content-type", "application/json")
            val body = buildJsonObject {
                put("code", code)
                put("deviceName", deviceName)
            }.toString()
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            return when (val status = connection.responseCode) {
                200 -> json.decodeFromString<PairResponse>(connection.inputStream.bufferedReader().readText())
                401 -> throw PairingException("코드가 맞지 않거나 만료되었습니다")
                429 -> throw PairingException("시도가 너무 많습니다. 잠시 후 다시 시도하세요")
                else -> throw PairingException("페어링에 실패했습니다 ($status)")
            }
        } finally {
            connection.disconnect()
        }
    }

    /** 동봉된 셸이 없거나 PC에 닿지 않으면 null — 업데이트 확인은 그 PC를 건너뛴다. */
    fun shellRelease(address: String): ShellRelease? = runCatching {
        val connection = open("http://$address/shell.json")
        try {
            if (connection.responseCode != 200) null
            else json.decodeFromString<ShellRelease>(connection.inputStream.bufferedReader().readText())
        } finally {
            connection.disconnect()
        }
    }.getOrNull()

    fun downloadApk(address: String, dest: File) {
        val connection = open("http://$address/shell.apk", readTimeoutMs = 60_000)
        try {
            if (connection.responseCode != 200) throw IOException("셸 APK를 받지 못했습니다 (${connection.responseCode})")
            connection.inputStream.use { input -> dest.outputStream().use { input.copyTo(it) } }
        } finally {
            connection.disconnect()
        }
    }

    private fun open(url: String, readTimeoutMs: Int = timeoutMs): HttpURLConnection =
        (URI(url).toURL().openConnection() as HttpURLConnection).apply {
            connectTimeout = timeoutMs
            readTimeout = readTimeoutMs
        }
}
```

- [ ] **Step 3: 통과 확인** — `.\gradlew.bat testDebugUnitTest` → PASS
- [ ] **Step 4: 커밋** — `feat: talk to the host for pairing and shell updates`

---

### Task 7: 호스트 저장소 (봉인된 토큰)

**Files:**
- Create: `app/src/main/kotlin/com/rafaam11/multicliwork/mobile/data/HostRepository.kt`, `data/KeystoreTokenSealer.kt`, `data/PrefsStore.kt`
- Test: `app/src/test/kotlin/com/rafaam11/multicliwork/mobile/data/HostRepositoryTest.kt`

**Interfaces:**
- Produces:
  - `data class Host(val hostId: String, val name: String, val address: String, val deviceId: String, val token: String)`
  - `interface KeyValueStore { fun get(key: String): String?; fun put(key: String, value: String?) }`
  - `interface TokenSealer { fun seal(plain: String): String; fun open(sealed: String): String }`
  - `class HostRepository(store: KeyValueStore, sealer: TokenSealer) { fun list(): List<Host>; fun get(hostId: String): Host?; fun save(host: Host); fun remove(hostId: String) }`
  - `class KeystoreTokenSealer : TokenSealer` (Android Keystore AES-GCM), `class PrefsStore(context: Context) : KeyValueStore`

- [ ] **Step 1: 실패하는 테스트**

```kotlin
package com.rafaam11.multicliwork.mobile.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class HostRepositoryTest {
    private class MemoryStore : KeyValueStore {
        val values = mutableMapOf<String, String>()
        override fun get(key: String) = values[key]
        override fun put(key: String, value: String?) {
            if (value == null) values.remove(key) else values[key] = value
        }
    }

    private class ReversingSealer : TokenSealer {
        var broken = false
        override fun seal(plain: String) = "sealed:" + plain.reversed()
        override fun open(sealed: String): String {
            check(!broken) { "key is gone" }
            return sealed.removePrefix("sealed:").reversed()
        }
    }

    private fun host(id: String, token: String = "tok-$id") = Host(id, "PC $id", "100.64.0.1:47821", "dev-$id", token)

    @Test
    fun savesListsAndRemovesHosts() {
        val repo = HostRepository(MemoryStore(), ReversingSealer())
        repo.save(host("a"))
        repo.save(host("b"))
        assertEquals(listOf(host("a"), host("b")), repo.list())
        assertEquals(host("b"), repo.get("b"))
        repo.remove("a")
        assertEquals(listOf(host("b")), repo.list())
        assertNull(repo.get("a"))
    }

    @Test
    fun saveReplacesTheSameHostId() {
        val repo = HostRepository(MemoryStore(), ReversingSealer())
        repo.save(host("a", token = "old"))
        repo.save(host("a", token = "new"))
        assertEquals(listOf(host("a", token = "new")), repo.list())
    }

    @Test
    fun neverStoresTheTokenInPlainText() {
        val store = MemoryStore()
        HostRepository(store, ReversingSealer()).save(host("a", token = "supersecret"))
        assertFalse(store.values.values.any { it.contains("supersecret") })
    }

    @Test
    fun dropsHostsWhoseTokenCannotBeOpened() {
        val store = MemoryStore()
        val sealer = ReversingSealer()
        HostRepository(store, sealer).save(host("a"))
        sealer.broken = true
        assertEquals(emptyList<Host>(), HostRepository(store, sealer).list())
    }

    @Test
    fun survivesAGarbledStore() {
        val store = MemoryStore().apply { values["hosts"] = "{not json" }
        assertEquals(emptyList<Host>(), HostRepository(store, ReversingSealer()).list())
    }
}
```

Run: `.\gradlew.bat testDebugUnitTest` → FAIL

- [ ] **Step 2: 구현**

`HostRepository.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

data class Host(val hostId: String, val name: String, val address: String, val deviceId: String, val token: String)

interface KeyValueStore {
    fun get(key: String): String?
    fun put(key: String, value: String?)
}

interface TokenSealer {
    fun seal(plain: String): String
    fun open(sealed: String): String
}

@Serializable
private data class StoredHost(val hostId: String, val name: String, val address: String, val deviceId: String, val sealedToken: String)

/**
 * 페어링한 PC들. 토큰은 봉인해서만 저장한다. 봉인을 못 여는 항목(기기 초기화·백업 복원으로 Keystore
 * 키가 사라진 경우)은 목록에서 빠지고, 사용자는 그 PC를 다시 페어링한다.
 */
class HostRepository(private val store: KeyValueStore, private val sealer: TokenSealer) {
    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = ListSerializer(StoredHost.serializer())

    fun list(): List<Host> = stored().mapNotNull { entry ->
        runCatching { Host(entry.hostId, entry.name, entry.address, entry.deviceId, sealer.open(entry.sealedToken)) }.getOrNull()
    }

    fun get(hostId: String): Host? = list().firstOrNull { it.hostId == hostId }

    fun save(host: Host) {
        val entry = StoredHost(host.hostId, host.name, host.address, host.deviceId, sealer.seal(host.token))
        write(stored().filterNot { it.hostId == host.hostId } + entry)
    }

    fun remove(hostId: String) = write(stored().filterNot { it.hostId == hostId })

    private fun stored(): List<StoredHost> =
        store.get(KEY)?.let { raw -> runCatching { json.decodeFromString(serializer, raw) }.getOrNull() } ?: emptyList()

    private fun write(entries: List<StoredHost>) = store.put(KEY, json.encodeToString(serializer, entries))

    private companion object {
        const val KEY = "hosts"
    }
}
```

`KeystoreTokenSealer.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** 기기 토큰을 Android Keystore의 AES-GCM 키로 봉인한다. 키는 기기 밖으로 나가지 않는다. */
class KeystoreTokenSealer : TokenSealer {
    override fun seal(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(sealed, Base64.NO_WRAP)
    }

    override fun open(sealed: String): String {
        val bytes = Base64.decode(sealed, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV_BYTES))
        }
        return String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val ALIAS = "mcw-host-tokens"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}
```

`PrefsStore.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.data

import android.content.Context

class PrefsStore(context: Context) : KeyValueStore {
    private val prefs = context.applicationContext.getSharedPreferences("mcw-hosts", Context.MODE_PRIVATE)

    override fun get(key: String): String? = prefs.getString(key, null)

    override fun put(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
}
```

- [ ] **Step 3: 통과 확인** — `.\gradlew.bat testDebugUnitTest assembleDebug` → PASS / BUILD SUCCESSFUL
- [ ] **Step 4: 커밋** — `feat: keep paired hosts with Keystore-sealed tokens`

---

### Task 8: 호스트 목록 화면 + 페어링 흐름 (QR 스캐너·딥링크·주소 붙여넣기)

**Files:**
- Modify: `app/src/main/kotlin/com/rafaam11/multicliwork/mobile/MainActivity.kt`
- Create: `app/src/main/kotlin/com/rafaam11/multicliwork/mobile/ui/HostListScreen.kt`, `ui/PairDialog.kt`, `ShellGraph.kt`
- Modify: `AndroidManifest.xml` (딥링크 intent-filter)

**Interfaces:**
- Consumes: `PairUri`, `HostApi`, `HostRepository`, `Host`
- Produces: `object ShellGraph { fun hosts(context: Context): HostRepository; val api: HostApi }`, MainActivity가 `SessionActivity.intent(context, hostId)`로 세션 화면을 연다(Task 9에서 만든다 — 이 태스크에서는 컴파일되도록 Task 9의 `SessionActivity`를 먼저 빈 Activity로 둔다)

이 태스크는 UI라 JVM 단위 테스트 대상이 없다. 페어링 로직(`PairUri`·`HostApi`·`HostRepository`)은 이미 테스트됐다. 검증은 `assembleDebug`와 Task 13 실기기 체크리스트로 한다.

- [ ] **Step 1: 매니페스트에 딥링크 추가** — MainActivity `<activity>` 안에 두 번째 intent-filter를 넣는다:

```xml
            <!-- 폰 카메라 앱으로 데스크톱 QR을 찍어도 바로 이 앱의 페어링 확인으로 온다. -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="mcw" android:host="pair" />
            </intent-filter>
```

그리고 `<application>` 안에 `<activity android:name=".SessionActivity" android:exported="false" android:windowSoftInputMode="adjustResize" android:configChanges="orientation|screenSize|keyboardHidden" />`을 추가한다.

- [ ] **Step 2: 구현**

`ShellGraph.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile

import android.content.Context
import com.rafaam11.multicliwork.mobile.data.HostRepository
import com.rafaam11.multicliwork.mobile.data.KeystoreTokenSealer
import com.rafaam11.multicliwork.mobile.data.PrefsStore
import com.rafaam11.multicliwork.mobile.net.HostApi

/** 앱 전역에서 하나씩만 쓰는 것들. */
object ShellGraph {
    val api = HostApi()
    private val sealer = KeystoreTokenSealer()
    fun hosts(context: Context) = HostRepository(PrefsStore(context), sealer)
}
```

`SessionActivity.kt` (임시 — Task 9에서 채운다):

```kotlin
package com.rafaam11.multicliwork.mobile

import android.content.Context
import android.content.Intent
import androidx.activity.ComponentActivity

class SessionActivity : ComponentActivity() {
    companion object {
        const val EXTRA_HOST_ID = "hostId"
        fun intent(context: Context, hostId: String) = Intent(context, SessionActivity::class.java).putExtra(EXTRA_HOST_ID, hostId)
    }
}
```

`ui/PairDialog.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.rafaam11.multicliwork.mobile.core.PairRequest

@Composable
fun PairDialog(
    request: PairRequest,
    defaultDeviceName: String,
    busy: Boolean,
    error: String?,
    onConfirm: (deviceName: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var deviceName by remember { mutableStateOf(defaultDeviceName) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("${request.hostName}와 연결") },
        text = {
            Column {
                Text("주소 ${request.address}")
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = deviceName, onValueChange = { deviceName = it }, label = { Text("이 기기 이름") }, singleLine = true)
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(error)
                }
            }
        },
        confirmButton = { TextButton(enabled = !busy && deviceName.isNotBlank(), onClick = { onConfirm(deviceName.trim()) }) { Text(if (busy) "연결 중…" else "연결") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("취소") } },
    )
}
```

`ui/HostListScreen.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.rafaam11.multicliwork.mobile.core.ShellRelease
import com.rafaam11.multicliwork.mobile.data.Host

data class UpdateBanner(val release: ShellRelease, val busy: Boolean, val message: String?)

@Composable
fun HostListScreen(
    versionName: String,
    hosts: List<Host>,
    update: UpdateBanner?,
    onOpen: (Host) -> Unit,
    onRemove: (Host) -> Unit,
    onScan: () -> Unit,
    onPaste: (String) -> Unit,
    onUpdate: () -> Unit,
) {
    var pasting by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Host?>(null) }
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("멀티 터미널", style = MaterialTheme.typography.headlineSmall)
        if (update != null) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("새 버전 v${update.release.versionName}이 있습니다 (지금 v$versionName)")
                    if (update.message != null) Text(update.message)
                    Button(enabled = !update.busy, onClick = onUpdate) { Text(if (update.busy) "받는 중…" else "업데이트") }
                }
            }
        }
        if (hosts.isEmpty()) Text("등록된 PC가 없습니다. PC의 설정 ▸ 모바일 ▸ 기기 추가 QR을 찍으세요.")
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(hosts, key = { it.hostId }) { host ->
                Card(Modifier.fillMaxWidth().clickable { onOpen(host) }) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(host.name, style = MaterialTheme.typography.titleMedium)
                            Text(host.address, style = MaterialTheme.typography.bodySmall)
                        }
                        TextButton(onClick = { removing = host }) { Text("삭제") }
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onScan) { Text("QR로 PC 추가") }
            OutlinedButton(onClick = { pasting = true }) { Text("주소 붙여넣기") }
        }
        Text("v$versionName", style = MaterialTheme.typography.bodySmall)
    }
    if (pasting) {
        var text by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { pasting = false },
            title = { Text("페어링 주소") },
            text = { OutlinedTextField(value = text, onValueChange = { text = it }, label = { Text("mcw://pair?…") }) },
            confirmButton = { TextButton(onClick = { pasting = false; onPaste(text) }) { Text("확인") } },
            dismissButton = { TextButton(onClick = { pasting = false }) { Text("취소") } },
        )
    }
    removing?.let { host ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("${host.name} 삭제") },
            text = { Text("이 폰에서만 지웁니다. PC 쪽 기기 목록에서도 연결 해제하세요.") },
            confirmButton = { TextButton(onClick = { removing = null; onRemove(host) }) { Text("삭제") } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("취소") } },
        )
    }
}
```

`MainActivity.kt` (교체). 업데이트 부분은 Task 10에서 `ShellUpdater`를 붙인다. 이 태스크에서는 `update = null`로 둔다:

```kotlin
package com.rafaam11.multicliwork.mobile

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.rafaam11.multicliwork.mobile.core.PairRequest
import com.rafaam11.multicliwork.mobile.core.PairUri
import com.rafaam11.multicliwork.mobile.data.Host
import com.rafaam11.multicliwork.mobile.net.PairingException
import com.rafaam11.multicliwork.mobile.ui.HostListScreen
import com.rafaam11.multicliwork.mobile.ui.PairDialog
import com.rafaam11.multicliwork.mobile.ui.UpdateBanner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private var hosts by mutableStateOf(emptyList<Host>())
    private var pending by mutableStateOf<PairRequest?>(null)
    private var pairBusy by mutableStateOf(false)
    private var pairError by mutableStateOf<String?>(null)
    internal var update by mutableStateOf<UpdateBanner?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handlePairIntent(intent)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                HostListScreen(
                    versionName = BuildConfig.VERSION_NAME,
                    hosts = hosts,
                    update = update,
                    onOpen = { startActivity(SessionActivity.intent(this, it.hostId)) },
                    onRemove = { ShellGraph.hosts(this).remove(it.hostId); reload() },
                    onScan = ::scan,
                    onPaste = ::acceptPairText,
                    onUpdate = { },
                )
                pending?.let { request ->
                    PairDialog(
                        request = request,
                        defaultDeviceName = Build.MODEL ?: "내 폰",
                        busy = pairBusy,
                        error = pairError,
                        onConfirm = { name -> pair(request, name) },
                        onDismiss = { pending = null; pairError = null },
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        reload()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handlePairIntent(intent)
    }

    private fun reload() {
        hosts = ShellGraph.hosts(this).list()
    }

    private fun handlePairIntent(intent: Intent?) {
        val data = intent?.data ?: return
        acceptPairText(data.toString())
    }

    private fun acceptPairText(text: String) {
        val request = PairUri.parse(text)
        if (request == null) {
            Toast.makeText(this, "멀티 터미널 페어링 QR이 아닙니다", Toast.LENGTH_SHORT).show()
            return
        }
        pairError = null
        pending = request
    }

    private fun scan() {
        GmsBarcodeScanning.getClient(this).startScan()
            .addOnSuccessListener { barcode -> barcode.rawValue?.let(::acceptPairText) }
            .addOnFailureListener { Toast.makeText(this, "스캐너를 열지 못했습니다: ${it.message}", Toast.LENGTH_SHORT).show() }
    }

    private fun pair(request: PairRequest, deviceName: String) {
        pairBusy = true
        pairError = null
        lifecycleScope.launch {
            try {
                val response = withContext(Dispatchers.IO) { ShellGraph.api.pair(request.address, request.code, deviceName) }
                ShellGraph.hosts(this@MainActivity).save(
                    Host(response.hostId, response.hostName, request.address, response.deviceId, response.token),
                )
                pending = null
                reload()
                startActivity(SessionActivity.intent(this@MainActivity, response.hostId))
            } catch (error: PairingException) {
                pairError = error.message
            } catch (error: Exception) {
                pairError = "PC에 연결하지 못했습니다. PC와 폰의 Tailscale이 켜져 있는지 확인하세요."
            } finally {
                pairBusy = false
            }
        }
    }
}
```

(스캐너 import 경로는 `com.google.mlkit.vision.codescanner.GmsBarcodeScanning`이다 — play-services-code-scanner의 공개 API. 컴파일 실패 시 라이브러리 문서로 경로를 확인하고 Ruling으로 남긴다.)

- [ ] **Step 3: 빌드 확인** — `.\gradlew.bat testDebugUnitTest assembleDebug` → BUILD SUCCESSFUL
- [ ] **Step 4: 커밋** — `feat: host list, QR pairing, and deep-link pairing in the Android shell`

---

### Task 9: 세션 화면 (WebView + `McwShell` 브리지)

**Files:**
- Modify: `app/src/main/kotlin/com/rafaam11/multicliwork/mobile/SessionActivity.kt`
- Create: `app/src/main/kotlin/com/rafaam11/multicliwork/mobile/web/McwShellBridge.kt`, `web/HostOrigin.kt`
- Test: `app/src/test/kotlin/com/rafaam11/multicliwork/mobile/web/HostOriginTest.kt`

**Interfaces:**
- Consumes: `Host`, `ShellGraph`, Task 3의 JS 계약(`bridgeVersion(): number`, `pairingJson(): string`, `unpaired()`, `backToHosts()`)
- Produces: `object HostOrigin { fun isInside(address: String, url: String): Boolean; fun startUrl(address: String): String }`

- [ ] **Step 1: 실패하는 테스트** — `HostOriginTest.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HostOriginTest {
    @Test
    fun keepsTheWebViewOnTheHost() {
        val address = "100.64.0.1:47821"
        assertEquals("http://100.64.0.1:47821/mobile/", HostOrigin.startUrl(address))
        assertTrue(HostOrigin.isInside(address, "http://100.64.0.1:47821/mobile/"))
        assertTrue(HostOrigin.isInside(address, "http://100.64.0.1:47821/install"))
        assertFalse(HostOrigin.isInside(address, "http://100.64.0.1:47822/mobile/"))
        assertFalse(HostOrigin.isInside(address, "http://100.64.0.1:47821.evil.example/"))
        assertFalse(HostOrigin.isInside(address, "https://github.com/"))
        assertFalse(HostOrigin.isInside(address, "javascript:alert(1)"))
    }
}
```

Run: `.\gradlew.bat testDebugUnitTest` → FAIL

- [ ] **Step 2: 구현**

`web/HostOrigin.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.web

import java.net.URI

object HostOrigin {
    fun startUrl(address: String) = "http://$address/mobile/"

    /** 토큰을 가진 브리지가 붙은 WebView는 그 PC의 origin 밖으로 나가지 않는다. */
    fun isInside(address: String, url: String): Boolean {
        val uri = runCatching { URI(url) }.getOrNull() ?: return false
        if (uri.scheme != "http" || uri.rawAuthority == null) return false
        return uri.rawAuthority == address
    }
}
```

`web/McwShellBridge.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.web

import android.webkit.JavascriptInterface
import com.rafaam11.multicliwork.mobile.data.Host
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** 모바일 웹 UI(src/renderer/src/mobile/shell-bridge.ts)가 `window.McwShell`로 부르는 것. */
class McwShellBridge(
    private val host: Host,
    private val onUnpaired: () -> Unit,
    private val onBack: () -> Unit,
) {
    @JavascriptInterface
    fun bridgeVersion(): Int = BRIDGE_VERSION

    @JavascriptInterface
    fun pairingJson(): String = buildJsonObject {
        put("token", host.token)
        put("deviceId", host.deviceId)
        put("hostName", host.name)
    }.toString()

    @JavascriptInterface
    fun unpaired() = onUnpaired()

    @JavascriptInterface
    fun backToHosts() = onBack()

    companion object {
        const val BRIDGE_VERSION = 1
    }
}
```

`SessionActivity.kt` (교체):

```kotlin
package com.rafaam11.multicliwork.mobile

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.rafaam11.multicliwork.mobile.web.HostOrigin
import com.rafaam11.multicliwork.mobile.web.McwShellBridge

/**
 * 한 PC의 모바일 UI. 화면은 PC가 서빙하므로(데스크톱 버전을 따라간다) 여기는 WebView와 브리지뿐이다.
 */
class SessionActivity : ComponentActivity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val hostId = intent.getStringExtra(EXTRA_HOST_ID)
        val host = hostId?.let { ShellGraph.hosts(this).get(it) }
        if (host == null) {
            Toast.makeText(this, "이 PC를 다시 페어링하세요", Toast.LENGTH_SHORT).show()
            finish()
            return
        }
        enableEdgeToEdge()
        webView = WebView(this)
        // edge-to-edge(targetSdk 35+)에서 상태바·내비게이션바·키보드 아래로 웹 화면이 깔리지 않게 한다.
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.addJavascriptInterface(
            McwShellBridge(
                host = host,
                onUnpaired = {
                    runOnUiThread {
                        ShellGraph.hosts(this).remove(host.hostId)
                        Toast.makeText(this, "${host.name}에서 이 기기를 해제했습니다. 다시 페어링하세요.", Toast.LENGTH_LONG).show()
                        finish()
                    }
                },
                onBack = { runOnUiThread { finish() } },
            ),
            "McwShell",
        )
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !HostOrigin.isInside(host.address, request.url.toString())
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
        setContentView(webView)
        webView.loadUrl(HostOrigin.startUrl(host.address))
    }

    override fun onDestroy() {
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_HOST_ID = "hostId"
        fun intent(context: Context, hostId: String) = Intent(context, SessionActivity::class.java).putExtra(EXTRA_HOST_ID, hostId)
    }
}
```

- [ ] **Step 3: 통과·빌드 확인** — `.\gradlew.bat testDebugUnitTest assembleDebug` → PASS / BUILD SUCCESSFUL
- [ ] **Step 4: 커밋** — `feat: open a host's mobile page in a locked-down WebView with the shell bridge`

---

### Task 10: 셸 자가 업데이트

**Files:**
- Create: `app/src/main/kotlin/com/rafaam11/multicliwork/mobile/update/UpdateCheck.kt`, `update/ApkVerifier.kt`, `update/ApkInstaller.kt`, `update/InstallResultReceiver.kt`
- Test: `app/src/test/kotlin/com/rafaam11/multicliwork/mobile/update/UpdateCheckTest.kt`
- Modify: `MainActivity.kt` (배너·업데이트 실행), `AndroidManifest.xml` (receiver)

**Interfaces:**
- Consumes: `ShellRelease`, `ShellReleases`, `Sha256`, `HostApi`, `Host`
- Produces:
  - `class UpdateCheck(fetch: (address: String) -> ShellRelease?) { fun find(installedVersionCode: Int, hosts: List<Host>): Candidate? }`, `data class Candidate(val host: Host, val release: ShellRelease)`
  - `object ApkVerifier { fun sha256Matches(apk: File, expected: String): Boolean; fun sameSigner(context: Context, apk: File): Boolean }`
  - `object ApkInstaller { fun install(context: Context, apk: File) }`

- [ ] **Step 1: 실패하는 테스트** — `UpdateCheckTest.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.update

import com.rafaam11.multicliwork.mobile.core.ShellRelease
import com.rafaam11.multicliwork.mobile.data.Host
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class UpdateCheckTest {
    private fun host(id: String, address: String) = Host(id, id, address, "d", "t")
    private fun release(code: Int) = ShellRelease(code, "0.$code.0", "a".repeat(64))

    @Test
    fun picksTheHostWithTheNewestShell() {
        val releases = mapOf("100.64.0.1:1" to release(2), "100.64.0.2:1" to release(3), "100.64.0.3:1" to null)
        val check = UpdateCheck { releases[it] }
        val hosts = listOf(host("a", "100.64.0.1:1"), host("b", "100.64.0.2:1"), host("c", "100.64.0.3:1"))
        assertEquals(Candidate(hosts[1], release(3)), check.find(installedVersionCode = 1, hosts = hosts))
    }

    @Test
    fun nothingWhenInstalledIsCurrentOrNoHostHasAShell() {
        val hosts = listOf(host("a", "x"))
        assertNull(UpdateCheck { release(2) }.find(2, hosts))
        assertNull(UpdateCheck { null }.find(1, hosts))
        assertNull(UpdateCheck { release(9) }.find(1, emptyList()))
    }

    @Test
    fun sha256MismatchIsRejected() {
        val apk = File.createTempFile("shell", ".apk").apply { writeText("abc") }
        assertTrue(ApkVerifier.sha256Matches(apk, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"))
        assertFalse(ApkVerifier.sha256Matches(apk, "b".repeat(64)))
    }
}
```

Run: `.\gradlew.bat testDebugUnitTest` → FAIL

- [ ] **Step 2: 구현**

`update/UpdateCheck.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.update

import com.rafaam11.multicliwork.mobile.core.ShellRelease
import com.rafaam11.multicliwork.mobile.data.Host

data class Candidate(val host: Host, val release: ShellRelease)

/** 등록된 PC들이 동봉한 셸 중 가장 새 것을, 설치본보다 새로울 때만 고른다(스펙 §8.3-1). */
class UpdateCheck(private val fetch: (address: String) -> ShellRelease?) {
    fun find(installedVersionCode: Int, hosts: List<Host>): Candidate? =
        hosts.mapNotNull { host -> fetch(host.address)?.let { Candidate(host, it) } }
            .maxByOrNull { it.release.versionCode }
            ?.takeIf { it.release.versionCode > installedVersionCode }
}
```

`update/ApkVerifier.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.update

import android.content.Context
import android.content.pm.PackageManager
import com.rafaam11.multicliwork.mobile.core.Sha256
import java.io.File

object ApkVerifier {
    fun sha256Matches(apk: File, expected: String): Boolean =
        apk.inputStream().use { Sha256.hex(it) }.equals(expected, ignoreCase = true)

    /** 받은 APK가 같은 패키지이고, 지금 설치된 셸과 같은 인증서로 서명됐는지. */
    @Suppress("DEPRECATION")
    fun sameSigner(context: Context, apk: File): Boolean {
        val pm = context.packageManager
        val archive = pm.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: return false
        if (archive.packageName != context.packageName) return false
        val installed = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        val theirs = archive.signingInfo?.apkContentsSigners?.toSet() ?: return false
        val ours = installed.signingInfo?.apkContentsSigners?.toSet() ?: return false
        return theirs.isNotEmpty() && theirs == ours
    }
}
```

`update/ApkInstaller.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import java.io.File

object ApkInstaller {
    const val ACTION_RESULT = "com.rafaam11.multicliwork.mobile.INSTALL_RESULT"

    /**
     * PackageInstaller 세션으로 자기 자신을 업데이트한다. 이 앱이 직전 설치자이면 Android 12+는
     * 확인 없이 설치할 수 있고, 아니면 시스템 확인 화면이 한 번 뜬다(InstallResultReceiver가 띄운다).
     */
    fun install(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite("shell.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val intent = Intent(context, InstallResultReceiver::class.java).setAction(ACTION_RESULT)
            val pending = PendingIntent.getBroadcast(
                context,
                sessionId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(pending.intentSender)
        }
    }
}
```

`update/InstallResultReceiver.kt`:

```kotlin
package com.rafaam11.multicliwork.mobile.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.widget.Toast

class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)?.let(context::startActivity)
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            else -> {
                val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "알 수 없는 오류"
                Toast.makeText(context, "업데이트 설치 실패: $message", Toast.LENGTH_LONG).show()
            }
        }
    }
}
```

매니페스트 `<application>` 안에 추가한다:

```xml
        <receiver android:name=".update.InstallResultReceiver" android:exported="false" />
```

`MainActivity.kt`에 업데이트를 붙인다:
- import: `android.net.Uri`, `android.provider.Settings`, `com.rafaam11.multicliwork.mobile.update.*`, `java.io.File`
- 필드 `private var candidate: Candidate? = null`
- `onResume()`에 `checkForUpdate()`를 추가한다:

```kotlin
    private fun checkForUpdate() {
        val known = ShellGraph.hosts(this).list()
        lifecycleScope.launch {
            val found = withContext(Dispatchers.IO) { UpdateCheck(ShellGraph.api::shellRelease).find(BuildConfig.VERSION_CODE, known) }
            candidate = found
            update = found?.let { UpdateBanner(it.release, busy = false, message = null) }
        }
    }

    private fun runUpdate() {
        val found = candidate ?: return
        if (!packageManager.canRequestPackageInstalls()) {
            update = update?.copy(message = "먼저 '이 출처의 앱 설치 허용'을 켜 주세요")
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            return
        }
        update = update?.copy(busy = true, message = null)
        lifecycleScope.launch {
            val apk = File(cacheDir, "shell-update.apk")
            val problem = withContext(Dispatchers.IO) {
                runCatching { ShellGraph.api.downloadApk(found.host.address, apk) }.exceptionOrNull()?.let { return@withContext "받지 못했습니다: ${it.message}" }
                if (!ApkVerifier.sha256Matches(apk, found.release.sha256)) return@withContext "파일이 손상됐습니다(sha256 불일치)"
                if (!ApkVerifier.sameSigner(this@MainActivity, apk)) return@withContext "서명이 설치본과 달라 설치하지 않습니다"
                null
            }
            if (problem != null) {
                apk.delete()
                update = update?.copy(busy = false, message = problem)
                return@launch
            }
            ApkInstaller.install(this@MainActivity, apk)
            update = update?.copy(busy = false, message = "설치를 시작했습니다")
        }
    }
```

- `HostListScreen`의 `onUpdate = { }`를 `onUpdate = ::runUpdate`로 바꾼다.

- [ ] **Step 3: 통과·빌드 확인** — `.\gradlew.bat testDebugUnitTest assembleDebug` → PASS / BUILD SUCCESSFUL
- [ ] **Step 4: 커밋** — `feat: update the Android shell from the host's bundled APK`

---

### Task 11: 서명 키 생성 + GitHub Secrets 등록 + 로컬 서명 빌드

**Files:** 레포 밖 `%USERPROFILE%\.multi-cli-work-signing\mobile-release.jks`, `keystore.properties`. 레포 변경 없음(비밀은 커밋하지 않는다).

**Interfaces:**
- Produces: GitHub Secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. 로컬 `.\gradlew.bat assembleRelease`가 서명된 APK를 만든다.

- [ ] **Step 1: 이미 키가 있는지 확인** (덮어쓰기 금지)

```powershell
Test-Path "$env:USERPROFILE\.multi-cli-work-signing\mobile-release.jks"
```

Expected: `False`. `True`면 **멈추고 사용자에게 묻는다**(기존 키를 쓸지).

- [ ] **Step 2: 키 생성** — 비밀번호는 출력하지 않는다:

```powershell
$dir = "$env:USERPROFILE\.multi-cli-work-signing"
New-Item -ItemType Directory -Force $dir | Out-Null
$bytes = New-Object byte[] 24; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = [Convert]::ToBase64String($bytes) -replace '[+/=]', 'x'
$jks = Join-Path $dir "mobile-release.jks"
& keytool -genkeypair -v -keystore $jks -storetype PKCS12 -alias mcw-shell -keyalg RSA -keysize 4096 -validity 36500 `
  -storepass $password -keypass $password -dname "CN=Multi CLI Work Mobile, O=rafaam11" 2>&1 | Out-Null
@"
storeFile=$($jks -replace '\\','/')
storePassword=$password
keyAlias=mcw-shell
keyPassword=$password
"@ | Set-Content -Encoding utf8 (Join-Path $dir "keystore.properties")
"created: " + (Test-Path $jks)
```

Expected: `created: True`

- [ ] **Step 3: GitHub Secrets 등록** — 값은 stdin으로만 넘긴다:

```powershell
$dir = "$env:USERPROFILE\.multi-cli-work-signing"
$props = Get-Content (Join-Path $dir "keystore.properties") | ConvertFrom-StringData
[Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $dir "mobile-release.jks"))) | gh secret set ANDROID_KEYSTORE_B64 --repo rafaam11/multi-cli-work
$props.storePassword | gh secret set ANDROID_KEYSTORE_PASSWORD --repo rafaam11/multi-cli-work
"mcw-shell" | gh secret set ANDROID_KEY_ALIAS --repo rafaam11/multi-cli-work
$props.keyPassword | gh secret set ANDROID_KEY_PASSWORD --repo rafaam11/multi-cli-work
gh secret list --repo rafaam11/multi-cli-work
```

Expected: 목록에 네 이름이 보인다(값은 안 보인다).

- [ ] **Step 4: 로컬 서명 빌드 확인** (android/에서)

Run: `.\gradlew.bat assembleRelease` → BUILD SUCCESSFUL
Run: `& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --print-certs app\build\outputs\apk\release\app-release.apk`
Expected: `Signer #1 certificate DN: CN=Multi CLI Work Mobile, O=rafaam11`

- [ ] **Step 5: 백업 안내를 ledger에 적는다** — 커밋은 없다. 최종 보고에 "`%USERPROFILE%\.multi-cli-work-signing\` 폴더를 비밀번호 관리자나 오프라인 저장소에 백업하세요"를 반드시 넣는다(스펙 §8.2 P2 완료 조건).

---

### Task 12: 설치본 동봉 + 릴리스·CI 파이프라인

**Files:**
- Create: `scripts/prepare-mobile-shell.mjs` · Test: `scripts/prepare-mobile-shell.test.mjs`
- Modify: `package.json` (`build.extraResources`, script `mobile:prepare`), `.gitignore` (`/build/mobile/`)
- Modify: `src/main/runtime.ts` (셸 디렉터리 → `readShellArtifact` → hub·server)
- Modify: `src/main/remote/remote-access.ts` (`RemoteAccessOptions.shell` → `startRemoteServer`에 전달)
- Modify: `.github/workflows/release.yml`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1 `readShellArtifact`/`ShellArtifact`, Task 4 `version.properties`
- Produces: `node scripts/prepare-mobile-shell.mjs [--apk <path>]` → `build/mobile/shell.apk`, `build/mobile/shell.json`, `release/Multi-CLI-Work-Mobile-<versionName>.apk`. export `parseVersionProperties(text)`, `shellManifest(version, apkBuffer)`

- [ ] **Step 1: 실패하는 테스트** — `scripts/prepare-mobile-shell.test.mjs`:

```js
// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseVersionProperties, shellManifest } from "./prepare-mobile-shell.mjs";

describe("prepare-mobile-shell", () => {
  it("reads the shell version", () => {
    expect(parseVersionProperties("# c\nshellVersionCode=3\nshellVersionName=0.3.0\n")).toEqual({ versionCode: 3, versionName: "0.3.0" });
    expect(() => parseVersionProperties("shellVersionName=0.3.0")).toThrow(/shellVersionCode/);
  });

  it("describes the APK the desktop will serve", () => {
    const apk = Buffer.from("APK");
    expect(shellManifest({ versionCode: 3, versionName: "0.3.0" }, apk)).toEqual({
      versionCode: 3,
      versionName: "0.3.0",
      sha256: createHash("sha256").update(apk).digest("hex"),
    });
  });
});
```

`runtime`에는 단위 테스트가 없다(기존 관례). `remote-access.test.ts`에 추가한다:

```ts
  it("hands the bundled shell to the server", async () => {
    const shell = { release: { versionCode: 1, versionName: "0.1.0", sha256: "a".repeat(64) }, apkPath: "x" };
    const { access, start } = setup({ shell });
    await access.apply({ enabled: true, port: 47821 });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ shell }));
  });
```

Run: `npx vitest run --pool=threads scripts/prepare-mobile-shell.test.mjs src/main/remote/remote-access.test.ts` → FAIL

- [ ] **Step 2: 구현**

`scripts/prepare-mobile-shell.mjs`:

```js
// 빌드된 셸 APK를 데스크톱 설치본이 동봉할 자리(build/mobile/)에 놓고 shell.json을 쓴다.
// 릴리스 CI와 로컬 dist 모두 이 스크립트를 거친다. 사용: node scripts/prepare-mobile-shell.mjs [--apk <path>]
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parseVersionProperties(text) {
  const values = Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
  );
  const versionCode = Number(values.shellVersionCode);
  if (!Number.isInteger(versionCode) || versionCode < 1) throw new Error("version.properties: shellVersionCode가 없거나 잘못됐습니다");
  if (!values.shellVersionName) throw new Error("version.properties: shellVersionName이 없습니다");
  return { versionCode, versionName: values.shellVersionName };
}

export function shellManifest(version, apk) {
  return { ...version, sha256: createHash("sha256").update(apk).digest("hex") };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const apkFlag = process.argv.indexOf("--apk");
  const apkPath = apkFlag > 0 ? path.resolve(process.argv[apkFlag + 1]) : path.join(root, "android/app/build/outputs/apk/release/app-release.apk");
  const version = parseVersionProperties(await readFile(path.join(root, "android/version.properties"), "utf8"));
  const apk = await readFile(apkPath);
  const outDir = path.join(root, "build/mobile");
  await mkdir(outDir, { recursive: true });
  await copyFile(apkPath, path.join(outDir, "shell.apk"));
  await writeFile(path.join(outDir, "shell.json"), `${JSON.stringify(shellManifest(version, apk), null, 2)}\n`);
  await mkdir(path.join(root, "release"), { recursive: true });
  await copyFile(apkPath, path.join(root, "release", `Multi-CLI-Work-Mobile-${version.versionName}.apk`));
  console.log(`mobile shell ${version.versionName} (${version.versionCode}) → build/mobile`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
```

`package.json`:
- scripts에 `"mobile:prepare": "node scripts/prepare-mobile-shell.mjs"`
- `build`에 추가한다:

```json
    "extraResources": [
      { "from": "build/mobile", "to": "mobile", "filter": ["shell.apk", "shell.json"] }
    ],
```

`.gitignore`에 `/build/mobile/`를 추가한다.

`remote-access.ts`: `RemoteAccessOptions`에 `shell?: ShellArtifact | null;`(import `type ShellArtifact` from `./shell-artifact`), `startRemoteServer` 호출에 `shell: this.options.shell ?? null,`를 추가한다.

`runtime.ts`:
- import `{ readShellArtifact } from "./remote/shell-artifact"`
- remote 블록 맨 앞에 넣는다:

```ts
  // 설치본에 동봉된 셸 APK(resources/mobile). dev에서는 `npm run mobile:prepare`가 채우는 build/mobile.
  const shellDir =
    process.env.MULTI_CLI_WORK_SHELL_DIR ??
    (app.isPackaged ? path.join(process.resourcesPath, "mobile") : path.join(app.getAppPath(), "build", "mobile"));
  const shellArtifact = await readShellArtifact(shellDir);
```

- `new RemoteSessionHub({...})`에 `shellLatest: () => shellArtifact?.release ?? null,`
- `new RemoteAccess({...})`에 `shell: shellArtifact,`

`release.yml` — `verify-version` 다음에 잡을 추가한다:

```yaml
  android:
    needs: verify-version
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"
      - uses: gradle/actions/setup-gradle@v4
      - uses: actions/setup-node@v7
        with:
          node-version: 22.12.0
      - name: Decode the shell signing key
        env:
          ANDROID_KEYSTORE_B64: ${{ secrets.ANDROID_KEYSTORE_B64 }}
        run: echo "$ANDROID_KEYSTORE_B64" | base64 --decode > "$RUNNER_TEMP/mcw-shell.jks"
      - name: Test and build the signed shell
        working-directory: android
        env:
          MCW_ANDROID_KEYSTORE_PATH: ${{ runner.temp }}/mcw-shell.jks
          MCW_ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          MCW_ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          MCW_ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: ./gradlew testDebugUnitTest assembleRelease --stacktrace
      - name: Refuse an unsigned shell
        run: |
          "$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)/apksigner" verify android/app/build/outputs/apk/release/app-release.apk
      - run: node scripts/prepare-mobile-shell.mjs
      - uses: actions/upload-artifact@v7
        with:
          name: mobile-shell
          path: build/mobile/
      - uses: actions/upload-artifact@v7
        with:
          name: release-mobile
          path: release/Multi-CLI-Work-Mobile-*.apk
```

`windows`·`linux` 잡: `needs: verify-version` → `needs: [verify-version, android]`. 각 잡의 `npm ci` 다음(electron-builder 전)에 넣는다:

```yaml
      - uses: actions/download-artifact@v8
        with:
          name: mobile-shell
          path: build/mobile
```

`draft-release`의 `needs`에 `android`를 추가한다(`pattern: release-*`가 `release-mobile`을 모으므로 APK가 Release에 붙는다).

`ci.yml` — 잡을 추가한다(서명 없이 테스트와 debug 빌드만):

```yaml
  android:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"
      - uses: gradle/actions/setup-gradle@v4
      - name: Unit tests and debug build
        working-directory: android
        run: ./gradlew testDebugUnitTest assembleDebug --stacktrace
```

- [ ] **Step 3: 통과·로컬 동봉 확인**

Run: `npx vitest run --pool=threads scripts/prepare-mobile-shell.test.mjs src/main/remote` → PASS
Run: `npm run typecheck` → 0
Run: `npm run mobile:prepare` (Task 11의 서명 APK 사용) → `build/mobile/shell.apk`, `shell.json` 생성
Run: `npx electron-builder --win --dir --publish never` 후 `release/win-unpacked/resources/mobile/shell.json` 존재 확인
Run: `build/mobile`을 잠깐 다른 이름으로 옮겨 두고 `npx electron-builder --win --dir --publish never`가 실패하는지 확인한다. 실패하면 **Ruling**: CI는 늘 채우므로 그대로 두고, 로컬 `dist:*` 스크립트 앞에 `npm run mobile:prepare`가 필요하다고 `docs/installation.md`에 적는다. 실패하지 않으면 동봉 없이도 빌드된다고 기록한다. 확인 뒤 폴더를 되돌린다.

- [ ] **Step 4: 커밋** — `feat: bundle the signed Android shell with desktop releases`

---

### Task 13: 문서 + 실기기 검증 (사용자와 함께)

**Files:**
- Modify: `docs/installation.md` (모바일 절), `docs/superpowers/specs/2026-09-30-mobile-companion-design.md` (P2 반영)

- [ ] **Step 1: 문서** — `docs/installation.md`에 "모바일(Android) 컴패니언" 절을 추가한다:
  - 요구: PC·폰 모두 Tailscale, Android 12+(권장 14+)
  - 처음 설치: 설정 ▸ 모바일 켜기 → 기기 추가 → "앱 설치 QR"을 폰 카메라로 → 다운로드 → 설치 허용 → 설치
  - 페어링: 앱 "QR로 PC 추가" 또는 폰 카메라로 페어링 QR(딥링크)
  - 업데이트: 앱 첫 화면 배너 → 업데이트. 처음 한 번 "이 출처의 앱 설치 허용"
  - 개발 빌드에서 동봉하기: `cd android; .\gradlew.bat assembleRelease; cd ..; npm run mobile:prepare`
  - **서명 키 백업**: `%USERPROFILE%\.multi-cli-work-signing\`을 잃으면 업데이트가 불가능해 앱을 지우고 다시 깔아야 한다

  스펙 동기화: §3.3에 "업데이트 확인은 네이티브가 각 호스트의 `/shell.json`을 직접 조회(P3 상태 연결 전까지)"를 추가하고, §4에 "폰 카메라 딥링크(`mcw://pair`)로도 페어링된다"를 추가한다.

- [ ] **Step 2: 전체 검증**

Run: `npx vitest run --pool=threads --maxWorkers=2` → 전체 PASS
Run: `npm run typecheck` → 0
Run: `npm run test:e2e` → PASS
Run (android/): `.\gradlew.bat testDebugUnitTest assembleRelease` → PASS

- [ ] **Step 3: 커밋** — `docs: install, pair, and update the Android shell`

- [ ] **Step 4: 실기기 체크리스트 (사용자와 함께, push 전)**

준비: `npm run build` → 개발 앱 실행(`npm start`) — dev 앱은 `build/mobile`을 서빙한다
1. 설정 ▸ 모바일 켜기 → 기기 추가 → **앱 설치 QR**을 폰 카메라로 → 다운로드 → 설치
2. 앱 "QR로 PC 추가" → 페어링 QR → 연결 → 세션 목록이 뜬다(WebView)
3. 앱을 닫고 **폰 카메라**로 새 페어링 QR을 찍는다 → 앱이 열리며 확인 창(중복 없이 같은 PC가 갱신)
4. 세션 열기 → 입력·빠른 키·"폰 크기로" → 상태바·키보드에 화면이 가려지지 않는다
5. PC에서 기기 해제 → 앱이 호스트를 지우고 목록으로
6. **업데이트 1사이클**: `android/version.properties`를 `2`/`0.2.0`으로 올리고 `assembleRelease` → `npm run mobile:prepare` → 앱 재시작 → 배너 → 업데이트 → 설치 → 앱 하단 버전이 v0.2.0. 확인 뒤 `version.properties`를 1/0.1.0으로 되돌린다(첫 릴리스는 1로 나간다)
7. 서명 불일치 방어: debug APK(`app-debug.apk`)를 `npm run mobile:prepare -- --apk android/app/build/outputs/apk/debug/app-debug.apk`로 넣고 versionCode를 올린 상태에서 업데이트 → "서명이 설치본과 달라 설치하지 않습니다"
