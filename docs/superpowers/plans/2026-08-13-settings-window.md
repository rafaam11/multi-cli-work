# 설정 창과 리매핑 가능한 단축키 — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 타이틀바 "설정" 진입점과 인앱 모달 설정 창(일반·터미널·알림·단축키)을 만들고, 하드코딩된 선호값 4곳(터미널 옵션·알림·트레이/업데이트/자동 재개·단축키)을 userData/settings.json 기반 설정으로 옮긴다. 단축키는 표시가 아니라 리매핑까지 지원한다.

**Architecture:** shared에 `AppSettings` 타입과 관용적 파서를 두고, main은 기존 `json-store.ts` 프로토콜로 저장·IPC(`settings:get`/`settings:update`/`settings:changed` 브로드캐스트)를 제공하며 소비처 게이트 4곳(창 닫기·업데이트 자동 확인·데스크톱 알림·세션 자동 재개)에서 동기 캐시 `current()`를 읽는다. renderer는 `SettingsDialog`가 즉시 적용 폼을, `keymap.ts`가 액션 카탈로그·이벤트 정규화·오버라이드 해석을 맡고, App.tsx의 capture keydown 3곳을 키맵 조회 디스패처 하나로 통합한다.

**Tech Stack:** Electron + electron-vite, React 18 + TypeScript, @xterm/xterm 6(런타임 `terminal.options.*` 변경), proper-lockfile 기반 json-store, vitest(콜로케이션) + Playwright.

**Spec:** `docs/superpowers/specs/2026-08-13-settings-window-design.md`

## Global Constraints

- **기본값 전체가 현행 하드코딩 동작과 동일하다.** settings.json이 없는 기동은 오늘의 앱과 구별할 수 없어야 한다. 기본값: 터미널 `'"Cascadia Code", "Cascadia Mono", Consolas, monospace'` / 13 / 1.25 / 10,000줄 / bar / 깜빡임 끔, 알림 마스터 켬 + 입력·승인 대기 켬 + 종료·오류 끔, closeToTray·autoResumeSessions·autoCheckUpdates 전부 켬, 언어 ko, keybindings `{}`.
- 사용자에게 보이는 문자열은 전부 한국어다. i18n은 도입하지 않는다 — 언어 설정은 저장만 한다.
- `TerminalPane.tsx`의 `attachCustomKeyEventHandler`(Shift+Enter 바이트, Ctrl+C 인터럽트/복사, Ctrl+V 붙여넣기)와 `edit.*` 액션의 동작은 불변이다. `edit.*`는 단축키 목록에 **고정으로 표시만** 한다.
- 배지·트레이·창 attention은 알림 설정과 무관하게 현행대로 동작한다. 설정이 다스리는 것은 데스크톱 알림뿐이다.
- Electron 네이티브 메뉴는 계속 없다(`Menu.setApplicationMenu(null)`). 라이트 테마 없음.
- 범위 검증: fontSize 8~32, lineHeight 1~2, scrollback 1,000~100,000. main IPC에서 거부한다.
- 커밋 스텝은 **사용자가 커밋을 지시한 경우에만** 수행한다(전역 Git 규칙). 지시가 없으면 커밋 스텝을 건너뛰고 미커밋 상태를 보고에 남긴다. `--amend` 금지, `git add`는 명시된 파일만.
- shared 코드는 main(tsconfig.node)과 renderer(tsconfig.web) 양쪽에서 컴파일된다. `src/shared/`에는 Electron·DOM 의존을 두지 않는다. renderer에서 shared는 `@shared/...`, main에서는 상대경로(`../shared/...`)로 import한다(기존 관례).
- 테스트는 소스 옆 콜로케이션이다. 전체 실행은 `npm test`, 단일 파일은 `npx vitest run <경로>`.

---

### Task 1: 공유 설정 타입과 관용적 파서

**Files:**
- Create: `src/shared/settings-types.ts`
- Test: `src/shared/settings-types.test.ts`

**Interfaces:**
- Consumes: 없음 (의존성 0 — shared 규칙에 따라 Electron/DOM import 금지)
- Produces: `AppSettings`, `GeneralSettings`, `TerminalSettings`, `NotificationSettings`, `NotifiableStatus`, `AppSettingsPatch`, `DEFAULT_SETTINGS`, `parseSettings(value: unknown): AppSettings`, `mergeSettingsPatch(current: AppSettings, patch: AppSettingsPatch): AppSettings`, `TERMINAL_FONT_SIZE_RANGE`/`TERMINAL_LINE_HEIGHT_RANGE`/`TERMINAL_SCROLLBACK_RANGE` (`{ min, max }`). 이후 모든 태스크가 이 이름들을 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/shared/settings-types.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettingsPatch, parseSettings } from "./settings-types";

describe("parseSettings", () => {
  it("빈 입력을 기본값으로 채운다 — settings.json 없는 기동은 오늘의 앱과 같다", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not an object")).toEqual(DEFAULT_SETTINGS);
  });

  it("현행 하드코딩 값이 그대로 기본값이다", () => {
    // TerminalPane.tsx 생성자·notification 정책·index.ts 트레이 동작의 현행 리터럴.
    // renderer-typography.test.ts가 CONTENT_TYPOGRAPHY(13/1.25)를 같은 값으로 고정하고 있다.
    expect(DEFAULT_SETTINGS.terminal).toEqual({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 10_000,
      cursorStyle: "bar",
      cursorBlink: false,
    });
    expect(DEFAULT_SETTINGS.general).toEqual({
      closeToTray: true,
      autoResumeSessions: true,
      autoCheckUpdates: true,
    });
    expect(DEFAULT_SETTINGS.notifications).toEqual({
      desktop: true,
      statuses: { "awaiting-input": true, "awaiting-approval": true, exited: false, error: false },
    });
    expect(DEFAULT_SETTINGS.language).toBe("ko");
    expect(DEFAULT_SETTINGS.keybindings).toEqual({});
  });

  it("모르는 필드는 버리고, 범위 밖·타입 불일치 값은 필드 단위로 기본값에 되돌린다", () => {
    const parsed = parseSettings({
      language: "fr",
      unknownField: true,
      terminal: { fontSize: 200, scrollback: "많이", cursorStyle: "beam", fontFamily: "D2Coding" },
      notifications: { desktop: "yes", statuses: { exited: true } },
    });
    expect(parsed.language).toBe("ko");
    expect(parsed.terminal.fontSize).toBe(13);
    expect(parsed.terminal.scrollback).toBe(10_000);
    expect(parsed.terminal.cursorStyle).toBe("bar");
    expect(parsed.terminal.fontFamily).toBe("D2Coding");
    expect(parsed.notifications.desktop).toBe(true);
    expect(parsed.notifications.statuses.exited).toBe(true);
    expect("unknownField" in parsed).toBe(false);
  });

  it("keybindings는 짧은 문자열과 null만 남긴다", () => {
    const parsed = parseSettings({
      keybindings: { "view.quick-open": "Ctrl+K", "session.refresh": null, "view.zoom-in": 3 },
    });
    expect(parsed.keybindings).toEqual({ "view.quick-open": "Ctrl+K", "session.refresh": null });
  });
});

describe("mergeSettingsPatch", () => {
  it("부분 패치는 깊이 병합하고 keybindings는 통째로 교체한다", () => {
    const base = parseSettings({ keybindings: { "view.quick-open": "Ctrl+K" } });
    const merged = mergeSettingsPatch(base, {
      terminal: { fontSize: 16 },
      keybindings: { "session.refresh": null },
    });
    expect(merged.terminal.fontSize).toBe(16);
    expect(merged.terminal.lineHeight).toBe(1.25);
    expect(merged.keybindings).toEqual({ "session.refresh": null });
    expect(merged.general).toEqual(DEFAULT_SETTINGS.general);
  });

  it("keybindings가 빠진 패치는 기존 오버라이드를 유지한다", () => {
    const base = parseSettings({ keybindings: { "view.quick-open": "Ctrl+K" } });
    const merged = mergeSettingsPatch(base, { language: "en" });
    expect(merged.keybindings).toEqual({ "view.quick-open": "Ctrl+K" });
    expect(merged.language).toBe("en");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/shared/settings-types.test.ts`
Expected: FAIL — `Cannot find module './settings-types'`

- [ ] **Step 3: 구현** — `src/shared/settings-types.ts`

```ts
/**
 * User preferences persisted to userData/settings.json. Every default mirrors a literal that used
 * to be hardcoded, so a boot without the file is indistinguishable from the app before settings
 * existed. The parser is lenient by design: unknown fields are dropped and out-of-range or
 * mistyped values fall back per field, which makes adding and removing fields safe without a
 * version number or migration code.
 */

/** TerminalStatus values a desktop notification can be raised for. */
export type NotifiableStatus = "awaiting-input" | "awaiting-approval" | "exited" | "error";

export interface GeneralSettings {
  /** ✕가 앱을 종료하는 대신 트레이에 남긴다. */
  closeToTray: boolean;
  /** 시작 후 첫 attach가 interrupted 세션을 자동 재개한다. */
  autoResumeSessions: boolean;
  /** 시작 시 업데이트 자동 확인. 꺼도 도움말 > 업데이트 확인은 동작한다. */
  autoCheckUpdates: boolean;
}

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  scrollback: number;
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
}

export interface NotificationSettings {
  /** 마스터 토글 — 꺼지면 상태별 토글과 무관하게 데스크톱 알림이 나가지 않는다. */
  desktop: boolean;
  statuses: Record<NotifiableStatus, boolean>;
}

export interface AppSettings {
  /** 지금은 선택 저장만 한다 — i18n 도입은 별도 작업. */
  language: "ko" | "en";
  general: GeneralSettings;
  terminal: TerminalSettings;
  notifications: NotificationSettings;
  /** 액션 id → 기본값과 다른 키(해제는 null). 기본 키맵이 바뀌면 안 건드린 액션은 새 기본값을 따른다. */
  keybindings: Record<string, string | null>;
}

export interface AppSettingsPatch {
  language?: AppSettings["language"];
  general?: Partial<GeneralSettings>;
  terminal?: Partial<TerminalSettings>;
  notifications?: { desktop?: boolean; statuses?: Partial<Record<NotifiableStatus, boolean>> };
  /** 전체 교체 — 리매핑 UI는 항상 완전한 오버라이드 맵을 보낸다. 부분 병합이면 해제가 불가능하다. */
  keybindings?: Record<string, string | null>;
}

export const TERMINAL_FONT_SIZE_RANGE = { min: 8, max: 32 } as const;
export const TERMINAL_LINE_HEIGHT_RANGE = { min: 1, max: 2 } as const;
export const TERMINAL_SCROLLBACK_RANGE = { min: 1_000, max: 100_000 } as const;

const MAX_ACCELERATOR_LENGTH = 64;

export const DEFAULT_SETTINGS: AppSettings = {
  language: "ko",
  general: { closeToTray: true, autoResumeSessions: true, autoCheckUpdates: true },
  terminal: {
    fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    scrollback: 10_000,
    cursorStyle: "bar",
    cursorBlink: false,
  },
  notifications: {
    desktop: true,
    statuses: { "awaiting-input": true, "awaiting-approval": true, exited: false, error: false },
  },
  keybindings: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

export function parseSettings(value: unknown): AppSettings {
  const raw = isRecord(value) ? value : {};
  const general = isRecord(raw.general) ? raw.general : {};
  const terminal = isRecord(raw.terminal) ? raw.terminal : {};
  const notifications = isRecord(raw.notifications) ? raw.notifications : {};
  const statuses = isRecord(notifications.statuses) ? notifications.statuses : {};

  const keybindings: Record<string, string | null> = {};
  if (isRecord(raw.keybindings)) {
    for (const [actionId, accelerator] of Object.entries(raw.keybindings)) {
      const valid =
        accelerator === null ||
        (typeof accelerator === "string" && accelerator.length > 0 && accelerator.length <= MAX_ACCELERATOR_LENGTH);
      if (valid) keybindings[actionId] = accelerator as string | null;
    }
  }

  const defaults = DEFAULT_SETTINGS;
  return {
    language: raw.language === "en" ? "en" : "ko",
    general: {
      closeToTray: readBoolean(general.closeToTray, defaults.general.closeToTray),
      autoResumeSessions: readBoolean(general.autoResumeSessions, defaults.general.autoResumeSessions),
      autoCheckUpdates: readBoolean(general.autoCheckUpdates, defaults.general.autoCheckUpdates),
    },
    terminal: {
      fontFamily: readText(terminal.fontFamily, defaults.terminal.fontFamily),
      fontSize: readNumber(
        terminal.fontSize,
        TERMINAL_FONT_SIZE_RANGE.min,
        TERMINAL_FONT_SIZE_RANGE.max,
        defaults.terminal.fontSize,
      ),
      lineHeight: readNumber(
        terminal.lineHeight,
        TERMINAL_LINE_HEIGHT_RANGE.min,
        TERMINAL_LINE_HEIGHT_RANGE.max,
        defaults.terminal.lineHeight,
      ),
      scrollback: Math.floor(
        readNumber(
          terminal.scrollback,
          TERMINAL_SCROLLBACK_RANGE.min,
          TERMINAL_SCROLLBACK_RANGE.max,
          defaults.terminal.scrollback,
        ),
      ),
      cursorStyle:
        terminal.cursorStyle === "block" || terminal.cursorStyle === "underline" || terminal.cursorStyle === "bar"
          ? terminal.cursorStyle
          : defaults.terminal.cursorStyle,
      cursorBlink: readBoolean(terminal.cursorBlink, defaults.terminal.cursorBlink),
    },
    notifications: {
      desktop: readBoolean(notifications.desktop, defaults.notifications.desktop),
      statuses: {
        "awaiting-input": readBoolean(statuses["awaiting-input"], defaults.notifications.statuses["awaiting-input"]),
        "awaiting-approval": readBoolean(
          statuses["awaiting-approval"],
          defaults.notifications.statuses["awaiting-approval"],
        ),
        exited: readBoolean(statuses.exited, defaults.notifications.statuses.exited),
        error: readBoolean(statuses.error, defaults.notifications.statuses.error),
      },
    },
    keybindings,
  };
}

export function mergeSettingsPatch(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  return {
    language: patch.language ?? current.language,
    general: { ...current.general, ...patch.general },
    terminal: { ...current.terminal, ...patch.terminal },
    notifications: {
      desktop: patch.notifications?.desktop ?? current.notifications.desktop,
      statuses: { ...current.notifications.statuses, ...patch.notifications?.statuses },
    },
    keybindings: patch.keybindings ?? current.keybindings,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/shared/settings-types.test.ts`
Expected: PASS (테스트 6개)

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- src/shared/settings-types.ts src/shared/settings-types.test.ts
git commit -m "feat: add shared settings types with a lenient parser"
```

---

### Task 2: 메인 설정 스토어

**Files:**
- Create: `src/main/settings/settings-store.ts`
- Test: `src/main/settings/settings-store.test.ts`

**Interfaces:**
- Consumes: `readJsonStore(spec, filePath)` / `updateJsonStore(spec, filePath, update)` / `JsonStoreSpec<T>` (`src/main/storage/json-store.ts` — `JsonStoreSpec`은 `{ label, parse(value: unknown): T, empty(): T, error(message, options?): Error, isContentError(error): boolean }`), Task 1의 `parseSettings`/`mergeSettingsPatch`
- Produces: `SettingsService { current(): AppSettings; update(patch: AppSettingsPatch): Promise<AppSettings> }`, `createSettingsService(settingsPath: string): Promise<SettingsService>`. `current()`는 **동기**다 — 창 close 핸들러·알림 경로처럼 await할 수 없는 게이트가 읽는다.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/settings/settings-store.test.ts`

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/settings-types";
import { createSettingsService } from "./settings-store";

async function tempSettingsPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "settings-store-"));
  return path.join(dir, "settings.json");
}

describe("settings store", () => {
  it("파일이 없으면 기본값으로 시작한다", async () => {
    const service = await createSettingsService(await tempSettingsPath());
    expect(service.current()).toEqual(DEFAULT_SETTINGS);
  });

  it("부분 파일을 기본값 위에 관용적으로 얹는다", async () => {
    const settingsPath = await tempSettingsPath();
    await writeFile(settingsPath, JSON.stringify({ terminal: { fontSize: 20 }, legacyField: 1 }), "utf8");
    const service = await createSettingsService(settingsPath);
    expect(service.current().terminal.fontSize).toBe(20);
    expect(service.current().terminal.scrollback).toBe(10_000);
  });

  it("패치를 병합해 디스크에 쓰고 current()를 갱신한다", async () => {
    const settingsPath = await tempSettingsPath();
    const service = await createSettingsService(settingsPath);
    const next = await service.update({
      general: { closeToTray: false },
      keybindings: { "view.quick-open": "Ctrl+K" },
    });
    expect(next.general.closeToTray).toBe(false);
    expect(service.current()).toEqual(next);
    const written = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(written).toMatchObject({
      general: { closeToTray: false },
      keybindings: { "view.quick-open": "Ctrl+K" },
    });
  });

  it("본문이 깨진 파일은 .bak으로 폴백한다", async () => {
    const settingsPath = await tempSettingsPath();
    const service = await createSettingsService(settingsPath);
    await service.update({ terminal: { fontSize: 18 } });
    await service.update({ terminal: { fontSize: 19 } }); // 두 번 써서 .bak이 확실히 존재하게 한다
    await writeFile(settingsPath, "{ corrupted", "utf8");
    const reopened = await createSettingsService(settingsPath);
    // .bak이 직전 상태(18)인지 최신 상태(19)인지는 json-store의 갱신 시점 규약을 따른다 —
    // 어느 쪽이든 기본값(13)으로 떨어지지 않았다는 것이 폴백의 증명이다.
    expect([18, 19]).toContain(reopened.current().terminal.fontSize);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/main/settings/settings-store.test.ts`
Expected: FAIL — `Cannot find module './settings-store'`

- [ ] **Step 3: 구현** — `src/main/settings/settings-store.ts`

```ts
import type { AppSettings, AppSettingsPatch } from "../../shared/settings-types";
import { mergeSettingsPatch, parseSettings } from "../../shared/settings-types";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";

class SettingsStoreError extends Error {}

/**
 * parseSettings never throws, so the only content error the backup path ever sees is broken JSON
 * syntax in the primary file — exactly the failure the .bak exists for.
 */
const spec: JsonStoreSpec<AppSettings> = {
  label: "settings store",
  parse: parseSettings,
  empty: () => parseSettings(undefined),
  error: (message, options) => new SettingsStoreError(message, options),
  isContentError: (error) => error instanceof SettingsStoreError,
};

export interface SettingsService {
  /** 동기 캐시 — close 핸들러·알림 경로처럼 await할 수 없는 게이트가 읽는다. */
  current(): AppSettings;
  update(patch: AppSettingsPatch): Promise<AppSettings>;
}

export async function createSettingsService(settingsPath: string): Promise<SettingsService> {
  let current = (await readJsonStore(spec, settingsPath)).value;
  return {
    current: () => current,
    async update(patch) {
      current = await updateJsonStore(spec, settingsPath, (value) => mergeSettingsPatch(value, patch));
      return current;
    },
  };
}
```

주의: `JsonStoreSpec.error`의 두 번째 인자 시그니처가 위와 다르면(`options` 없음 등) `src/main/storage/json-store.ts`의 실제 시그니처를 따른다. `updateJsonStore`의 반환이 `JsonStoreSnapshot`이라면 `.value`를 취한다 — 다른 스토어(예: `src/main/app-state.ts`)의 사용부를 그대로 따라 한다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/main/settings/settings-store.test.ts`
Expected: PASS (테스트 4개)

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- src/main/settings/settings-store.ts src/main/settings/settings-store.test.ts
git commit -m "feat: add the main-process settings store"
```

---

### Task 3: IPC·preload·runtime 배선과 변경 브로드캐스트

**Files:**
- Modify: `src/main/ipc.ts` (`MainIpcDependencies`에 settings 게이트웨이, `settings:get`/`settings:update` 핸들러, `validateSettingsPatch`)
- Modify: `src/main/ipc.test.ts` (setup에 settings 스텁 + 검증 테스트)
- Modify: `src/main/runtime.ts` (settingsService 생성, `DesktopRuntime.settings` 노출, registerMainIpc 의존성 + `settings:changed` 브로드캐스트)
- Modify: `src/shared/api-types.ts` (`MultiCliWorkApi.settings`)
- Modify: `src/preload/index.ts` (settings 그룹)
- Modify: `src/renderer/src/App.test.tsx` (`createApi`에 settings 목 + `emitSettings` 헬퍼 — 타입 필수 그룹이므로 이 태스크에서 함께)

**Interfaces:**
- Consumes: Task 2 `createSettingsService`/`SettingsService`, ipc.ts의 기존 `exactObject(value, allowed, label)`/`nonEmptyString(value, label)`/`integer(value, label)` 검증 헬퍼, Task 1의 범위 상수
- Produces: IPC 채널 `settings:get`(→ `AppSettings`), `settings:update`(patch → `AppSettings`), 브로드캐스트 `settings:changed`(payload `AppSettings`); `window.multiCliWork.settings = { get(): Promise<AppSettings>; update(patch: AppSettingsPatch): Promise<AppSettings>; onChange(listener: (settings: AppSettings) => void): () => void }`; `DesktopRuntime.settings: SettingsService`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/ipc.test.ts`

setup 함수(약 :203의 `registerMainIpc(ipc, {...})` 호출부) 근처에 게이트웨이 스텁을 추가하고 반환 객체에도 노출한다:

```ts
import { DEFAULT_SETTINGS } from "../shared/settings-types"; // 파일 상단 import에 추가

// setup() 안, 다른 게이트웨이 스텁들 옆:
const settingsGateway = {
  get: vi.fn(() => DEFAULT_SETTINGS),
  update: vi.fn(async (patch: unknown) => ({ ...DEFAULT_SETTINGS, patched: patch })),
};
// registerMainIpc(ipc, { ... }) 인자에 추가:
//   settings: settingsGateway,
// return { ... }에 추가:
//   settingsGateway,
```

describe 블록에 테스트 추가 (기존 `window:zoom` 테스트의 동기 throw 패턴을 따른다):

```ts
it("설정을 읽고, 패치를 검증해 위임한다", async () => {
  const { handlers, settingsGateway } = setup();

  expect(handlers.get("settings:get")!({})).toEqual(DEFAULT_SETTINGS);

  await handlers.get("settings:update")!({}, {
    terminal: { fontSize: 16 },
    keybindings: { "view.quick-open": null },
  });
  expect(settingsGateway.update).toHaveBeenCalledWith({
    terminal: { fontSize: 16 },
    keybindings: { "view.quick-open": null },
  });
});

it("모르는 필드·범위 밖 값·잘못된 타입의 설정 패치를 거부한다", () => {
  const { handlers, settingsGateway } = setup();

  expect(() => handlers.get("settings:update")!({}, { theme: "dark" })).toThrow(/Settings patch/);
  expect(() => handlers.get("settings:update")!({}, { terminal: { fontSize: 4 } })).toThrow(/fontSize/);
  expect(() => handlers.get("settings:update")!({}, { terminal: { fontSize: 40 } })).toThrow(/fontSize/);
  expect(() => handlers.get("settings:update")!({}, { terminal: { scrollback: 100 } })).toThrow(/scrollback/);
  expect(() => handlers.get("settings:update")!({}, { language: "jp" })).toThrow(/language/);
  expect(() => handlers.get("settings:update")!({}, { keybindings: { "view.quick-open": 5 } })).toThrow(/keybinding/i);
  expect(() => handlers.get("settings:update")!({}, { notifications: { statuses: { finished: true } } })).toThrow(
    /notification statuses/i,
  );
  expect(settingsGateway.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/main/ipc.test.ts`
Expected: FAIL — 타입 오류(`settings`가 `MainIpcDependencies`에 없음) 또는 `handlers.get("settings:get")` undefined

- [ ] **Step 3: 구현**

**(a) `src/main/ipc.ts`** — import 추가:

```ts
import {
  TERMINAL_FONT_SIZE_RANGE,
  TERMINAL_LINE_HEIGHT_RANGE,
  TERMINAL_SCROLLBACK_RANGE,
  type AppSettings,
  type AppSettingsPatch,
  type NotifiableStatus,
} from "../shared/settings-types";
```

`MainIpcDependencies`(약 :205)에 멤버 추가:

```ts
settings: {
  get(): AppSettings;
  update(patch: AppSettingsPatch): Promise<AppSettings>;
};
```

검증 헬퍼들(약 :240) 옆에 추가:

```ts
const NOTIFIABLE_STATUSES: readonly NotifiableStatus[] = ["awaiting-input", "awaiting-approval", "exited", "error"];

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function numberInRange(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
  if (value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return value;
}

function validateSettingsPatch(value: unknown): AppSettingsPatch {
  const raw = exactObject(value, ["language", "general", "terminal", "notifications", "keybindings"], "Settings patch");
  const patch: AppSettingsPatch = {};
  if (raw.language !== undefined) {
    if (raw.language !== "ko" && raw.language !== "en") throw new Error('Settings language must be "ko" or "en"');
    patch.language = raw.language;
  }
  if (raw.general !== undefined) {
    const general = exactObject(raw.general, ["closeToTray", "autoResumeSessions", "autoCheckUpdates"], "Settings general");
    patch.general = {};
    if (general.closeToTray !== undefined) patch.general.closeToTray = booleanValue(general.closeToTray, "Settings closeToTray");
    if (general.autoResumeSessions !== undefined) {
      patch.general.autoResumeSessions = booleanValue(general.autoResumeSessions, "Settings autoResumeSessions");
    }
    if (general.autoCheckUpdates !== undefined) {
      patch.general.autoCheckUpdates = booleanValue(general.autoCheckUpdates, "Settings autoCheckUpdates");
    }
  }
  if (raw.terminal !== undefined) {
    const terminal = exactObject(
      raw.terminal,
      ["fontFamily", "fontSize", "lineHeight", "scrollback", "cursorStyle", "cursorBlink"],
      "Settings terminal",
    );
    patch.terminal = {};
    if (terminal.fontFamily !== undefined) patch.terminal.fontFamily = nonEmptyString(terminal.fontFamily, "Settings fontFamily");
    if (terminal.fontSize !== undefined) {
      patch.terminal.fontSize = numberInRange(
        integer(terminal.fontSize, "Settings fontSize"),
        TERMINAL_FONT_SIZE_RANGE.min,
        TERMINAL_FONT_SIZE_RANGE.max,
        "Settings fontSize",
      );
    }
    if (terminal.lineHeight !== undefined) {
      patch.terminal.lineHeight = numberInRange(
        terminal.lineHeight,
        TERMINAL_LINE_HEIGHT_RANGE.min,
        TERMINAL_LINE_HEIGHT_RANGE.max,
        "Settings lineHeight",
      );
    }
    if (terminal.scrollback !== undefined) {
      patch.terminal.scrollback = numberInRange(
        integer(terminal.scrollback, "Settings scrollback"),
        TERMINAL_SCROLLBACK_RANGE.min,
        TERMINAL_SCROLLBACK_RANGE.max,
        "Settings scrollback",
      );
    }
    if (terminal.cursorStyle !== undefined) {
      if (terminal.cursorStyle !== "bar" && terminal.cursorStyle !== "block" && terminal.cursorStyle !== "underline") {
        throw new Error("Settings cursorStyle must be bar, block, or underline");
      }
      patch.terminal.cursorStyle = terminal.cursorStyle;
    }
    if (terminal.cursorBlink !== undefined) patch.terminal.cursorBlink = booleanValue(terminal.cursorBlink, "Settings cursorBlink");
  }
  if (raw.notifications !== undefined) {
    const notifications = exactObject(raw.notifications, ["desktop", "statuses"], "Settings notifications");
    patch.notifications = {};
    if (notifications.desktop !== undefined) {
      patch.notifications.desktop = booleanValue(notifications.desktop, "Settings notifications.desktop");
    }
    if (notifications.statuses !== undefined) {
      const statuses = exactObject(notifications.statuses, NOTIFIABLE_STATUSES, "Settings notification statuses");
      patch.notifications.statuses = {};
      for (const status of NOTIFIABLE_STATUSES) {
        if (statuses[status] !== undefined) {
          patch.notifications.statuses[status] = booleanValue(statuses[status], `Settings notifications.${status}`);
        }
      }
    }
  }
  if (raw.keybindings !== undefined) {
    if (typeof raw.keybindings !== "object" || raw.keybindings === null || Array.isArray(raw.keybindings)) {
      throw new Error("Settings keybindings must be an object");
    }
    const keybindings: Record<string, string | null> = {};
    for (const [actionId, accelerator] of Object.entries(raw.keybindings)) {
      if (accelerator !== null && (typeof accelerator !== "string" || accelerator.length === 0 || accelerator.length > 64)) {
        throw new Error(`Settings keybinding for ${actionId} must be a short string or null`);
      }
      keybindings[actionId] = accelerator as string | null;
    }
    patch.keybindings = keybindings;
  }
  return patch;
}
```

`registerMainIpc` 본문(:510 이후, 기존 핸들러들 옆)에 추가:

```ts
ipc.handle("settings:get", () => dependencies.settings.get());
ipc.handle("settings:update", (_event, patch: unknown) => dependencies.settings.update(validateSettingsPatch(patch)));
```

**(b) `src/main/runtime.ts`** — `createDesktopRuntime` 초입, `statePath` 선언(:113-114) 근처:

```ts
import { createSettingsService } from "./settings/settings-store"; // 파일 상단

const settingsService = await createSettingsService(path.join(userData, "settings.json"));
```

`registerMainIpc(ipcMain, {...})`(:340) 인자에 추가 — 브로드캐스트는 updater publish(:14-17)와 같은 모양:

```ts
settings: {
  get: () => settingsService.current(),
  update: async (patch) => {
    const next = await settingsService.update(patch);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("settings:changed", next);
    }
    return next;
  },
},
```

`DesktopRuntime` 인터페이스(:88)에 `settings: SettingsService;` 추가(타입 import 포함), 반환 객체에 `settings: settingsService` 추가. (Task 4·5의 게이트가 이걸 읽는다.)

**(c) `src/shared/api-types.ts`** — 상단에 `import type { AppSettings, AppSettingsPatch } from "./settings-types";`, `MultiCliWorkApi`(:265)에 그룹 추가:

```ts
settings: {
  get(): Promise<AppSettings>;
  update(patch: AppSettingsPatch): Promise<AppSettings>;
  /** 모든 저장이 모든 창으로 온다 — 다이얼로그와 앱 셸이 이 이벤트로 동기화된다. */
  onChange(listener: (settings: AppSettings) => void): () => void;
};
```

**(d) `src/preload/index.ts`** — `updates` 그룹(:188-200)과 같은 모양으로 추가:

```ts
settings: {
  get: () => ipcRenderer.invoke("settings:get"),
  update: (patch) => ipcRenderer.invoke("settings:update", patch),
  onChange(listener) {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings) => listener(settings);
    ipcRenderer.on("settings:changed", handler);
    return () => {
      ipcRenderer.removeListener("settings:changed", handler);
    };
  },
},
```

(`AppSettings` 타입 import는 파일이 이미 shared 타입을 가져오는 방식과 동일하게 추가한다. `src/preload/index.d.ts`는 `MultiCliWorkApi`를 그대로 쓰므로 수정 불요.)

**(e) `src/renderer/src/App.test.tsx`** — `createApi` 안(`updates` 그룹 옆)에 목 추가, 파일 상단 import에 `DEFAULT_SETTINGS`/`mergeSettingsPatch`/`AppSettings`/`AppSettingsPatch` 추가:

```ts
const settingsListeners = new Set<(settings: AppSettings) => void>(); // listeners 선언부 옆

// api 객체에:
settings: {
  get: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
  update: vi.fn().mockImplementation(async (patch: AppSettingsPatch) => mergeSettingsPatch(DEFAULT_SETTINGS, patch)),
  onChange: vi.fn((listener: (settings: AppSettings) => void) => {
    settingsListeners.add(listener);
    return () => settingsListeners.delete(listener);
  }),
},

// createApi의 return에 헬퍼 추가:
emitSettings(settings: AppSettings) {
  for (const listener of settingsListeners) listener(settings);
},
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/main/ipc.test.ts && npm run typecheck`
Expected: PASS — ipc 테스트 전부(기존 포함), 타입 오류 0

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- src/main/ipc.ts src/main/ipc.test.ts src/main/runtime.ts src/shared/api-types.ts src/preload/index.ts src/renderer/src/App.test.tsx
git commit -m "feat: wire settings over IPC with change broadcast"
```

---

### Task 4: 알림 게이트 — 마스터·상태별 토글, exited/error 확장

**Files:**
- Modify: `src/main/session-attention-controller.ts`
- Modify: `src/main/runtime.ts` (notify 구현의 본문 문구 + `notificationSettings` 옵션)
- Test: `src/main/session-attention-controller.test.ts` (테스트 추가 — 기존 테스트는 무수정)

**Interfaces:**
- Consumes: Task 1 `DEFAULT_SETTINGS`/`NotificationSettings`/`NotifiableStatus`, Task 3의 `settingsService`
- Produces: `SessionAttentionControllerOptions`에 `notificationSettings?(): NotificationSettings` (없으면 기본값 = 오늘의 동작 → 기존 테스트·호출부 무변경), `notify(sessionId, status: NotifiableStatus, onClick)` (상태 타입 확장)
- 불변식: `publish(tracker.applyStatus(...))` 호출 패턴은 그대로 — 배지·트레이·attention은 설정과 무관.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/session-attention-controller.test.ts`에 describe 추가 (자급자족 빌더 — 기존 헬퍼에 의존하지 않는다):

```ts
import { DEFAULT_SETTINGS } from "../shared/settings-types"; // 파일 상단 import에 추가

describe("notification settings gate", () => {
  function buildController(overrides: Partial<Parameters<typeof createSessionAttentionController>[0]> = {}) {
    const notify = vi.fn();
    const publish = vi.fn();
    const controller = createSessionAttentionController({
      readSelection: async () => ({ selectedSessionId: null, visibleSessionIds: [] }),
      windowState: () => ({ visible: false, focused: false }),
      publish,
      notify,
      navigate: vi.fn(),
      ...overrides,
    });
    return { controller, notify, publish };
  }

  const allOn = {
    desktop: true,
    statuses: { "awaiting-input": true, "awaiting-approval": true, exited: true, error: true },
  } as const;

  it("마스터 토글이 꺼지면 알림은 없지만 배지 상태는 그대로 발행된다", async () => {
    const { controller, notify, publish } = buildController({
      notificationSettings: () => ({ ...DEFAULT_SETTINGS.notifications, desktop: false }),
    });
    await controller.handleStatus("session-1", "awaiting-input");
    expect(notify).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalled();
  });

  it("상태별 토글이 꺼진 상태만 조용하다", async () => {
    const { controller, notify } = buildController({
      notificationSettings: () => ({
        desktop: true,
        statuses: { "awaiting-input": false, "awaiting-approval": true, exited: false, error: false },
      }),
    });
    await controller.handleStatus("session-1", "awaiting-input");
    expect(notify).not.toHaveBeenCalled();
    await controller.handleStatus("session-1", "awaiting-approval");
    expect(notify).toHaveBeenCalledWith("session-1", "awaiting-approval", expect.any(Function));
  });

  it("exited·error는 기본값에서 알리지 않는다 — 옵션이 없어도 같다", async () => {
    const explicit = buildController({ notificationSettings: () => DEFAULT_SETTINGS.notifications });
    await explicit.controller.handleStatus("session-1", "exited");
    await explicit.controller.handleStatus("session-1", "error");
    expect(explicit.notify).not.toHaveBeenCalled();

    const legacy = buildController(); // notificationSettings 미지정 = 오늘의 앱
    await legacy.controller.handleStatus("session-1", "exited");
    expect(legacy.notify).not.toHaveBeenCalled();
  });

  it("켜면 exited·error도 알리되, 창이 보이며 포커스를 쥔 동안은 알리지 않는다", async () => {
    const hidden = buildController({ notificationSettings: () => allOn });
    await hidden.controller.handleStatus("session-1", "exited");
    expect(hidden.notify).toHaveBeenCalledWith("session-1", "exited", expect.any(Function));

    const focused = buildController({
      notificationSettings: () => allOn,
      windowState: () => ({ visible: true, focused: true }),
      readSelection: async () => ({ selectedSessionId: "session-1", visibleSessionIds: ["session-1"] }),
    });
    await focused.controller.handleStatus("session-1", "error");
    expect(focused.notify).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/main/session-attention-controller.test.ts`
Expected: FAIL — `notificationSettings`가 옵션 타입에 없음(TS) / exited가 notify로 이어지지 않음

- [ ] **Step 3: 구현**

**(a) `src/main/session-attention-controller.ts`** — import와 옵션:

```ts
import { DEFAULT_SETTINGS, type NotifiableStatus, type NotificationSettings } from "../shared/settings-types";
```

`SessionAttentionControllerOptions`에서:

```ts
notify(sessionId: string, status: NotifiableStatus, onClick: () => void): void;
/** 없으면 기본값 — 설정 도입 전과 동일하게 동작한다(기존 테스트·호출부 보호). */
notificationSettings?(): NotificationSettings;
```

`handleStatus` 전체를 아래로 교체한다. 대기 상태의 tracker/deduper/markSeen 흐름은 오늘과 동일하고, 달라지는 것은 (1) 마지막 `options.notify` 진입이 설정으로 잘리는 것, (2) exited/error가 켜져 있으면 같은 가시성 검사를 거쳐 notify까지 가는 것뿐이다:

```ts
async handleStatus(sessionId, status) {
  const revision = bump(sessionId);
  const notifications = options.notificationSettings?.() ?? DEFAULT_SETTINGS.notifications;
  const awaiting = status === "awaiting-input" || status === "awaiting-approval";
  const notifiable = awaiting || status === "exited" || status === "error";
  const wantsNotification =
    notifiable && notifications.desktop && notifications.statuses[status as NotifiableStatus];

  if (!awaiting) {
    // 배지·트레이는 알림 설정과 무관: 대기 상태만 attention을 세우고 나머지는 오늘처럼 지운다.
    deduper.reset(sessionId);
    publish(tracker.applyStatus(sessionId, status));
    if (!wantsNotification) return;
  }

  let selection: SessionSelection;
  try {
    selection = await options.readSelection();
  } catch (error) {
    options.logError?.("Failed to read the selected terminal session", error);
    selection = { selectedSessionId: null, visibleSessionIds: [] };
  }
  if (revisions.get(sessionId) !== revision) return;

  const window = options.windowState();
  const shouldNotify = shouldShowTerminalStatusNotification({
    eventSessionId: sessionId,
    selectedSessionId: selection.selectedSessionId,
    visibleSessionIds: selection.visibleSessionIds,
    windowVisible: window.visible,
    windowFocused: window.focused,
  });
  if (!shouldNotify) {
    deduper.reset(sessionId);
    if (awaiting) publish(tracker.markSeen(sessionId));
    return;
  }

  if (awaiting) publish(tracker.applyStatus(sessionId, status));
  if (!wantsNotification) return;
  if (!deduper.shouldNotify(sessionId, status)) return;
  options.notify(sessionId, status as NotifiableStatus, () => {
    options.navigate(sessionId);
    markSeen(sessionId);
  });
},
```

`notification-policy.ts`는 건드리지 않는다 — 순수함수 구조 유지(스펙 요구). 게이트 검증은 이 컨트롤러 테스트가 담당한다.

**(b) `src/main/runtime.ts`** — notify 구현(:317-330)의 본문을 상태 맵으로 교체:

```ts
import type { NotifiableStatus } from "../shared/settings-types"; // 파일 상단(타입 import 병합 가능)

const NOTIFICATION_BODY: Record<NotifiableStatus, string> = {
  "awaiting-input": "입력을 기다리는 중입니다",
  "awaiting-approval": "승인이 필요합니다",
  exited: "세션이 종료되었습니다",
  error: "세션이 오류로 중단되었습니다",
};
```

notify 안의 `body: status === "awaiting-approval" ? ... : ...`를 `body: NOTIFICATION_BODY[status],`로 바꾸고, `createSessionAttentionController({...})` 옵션에 추가:

```ts
notificationSettings: () => settingsService.current().notifications,
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/main/session-attention-controller.test.ts src/main/notification-policy.test.ts && npm run typecheck`
Expected: PASS — 신규 4개 + 기존 테스트 전부 무수정 통과

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- src/main/session-attention-controller.ts src/main/session-attention-controller.test.ts src/main/runtime.ts
git commit -m "feat: gate desktop notifications by settings, add exited and error notices"
```

---

### Task 5: 종료·업데이트·자동 재개 게이트

**Files:**
- Modify: `src/main/index.ts` (close 핸들러 :66-74, `initUpdater()` 호출 :244)
- Modify: `src/main/updater.ts` (`initUpdater` 옵션)
- Modify: `src/main/terminal/terminal-coordinator.ts` (`autoResumeEnabled?` 옵션 + `maybeAutoResume` 게이트)
- Modify: `src/main/runtime.ts` (coordinator 옵션에 게이트 연결)
- Test: `src/main/terminal/terminal-coordinator.test.ts` (테스트 1개 추가)

**Interfaces:**
- Consumes: Task 3 `DesktopRuntime.settings`(index.ts의 모듈 변수 `runtime`), `settingsService`(runtime.ts)
- Produces: `initUpdater(options: { autoCheck?: boolean } = {}): void`; `TerminalCoordinatorOptions.autoResumeEnabled?(): boolean` (미지정 = 켬 — 기존 테스트·호출부 무변경)

- [ ] **Step 1: 실패하는 테스트 작성** — `src/main/terminal/terminal-coordinator.test.ts`

파일의 `coordinator(root, worker, ...)` 헬퍼(:98)는 게이트 옵션을 받지 않으므로, 기존 "does not auto-resume sessions that exited on their own"(:848) 옆에 자급자족 테스트를 추가한다. `TerminalCoordinator` 생성 인자는 헬퍼(:108-126)의 옵션 블록을 그대로 복사하고 `autoResumeEnabled`만 더한다:

```ts
it("autoResumeSessions가 꺼지면 interrupted 세션도 재개하지 않고 종료 상태로 attach된다", async () => {
  const root = await tempRoot();
  const first = await coordinator(root);
  await first.instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
  await first.instance.flush();
  await first.instance.shutdown();

  const worker = new FakeWorker();
  const gated = new TerminalCoordinator({
    worker,
    statePath: path.join(root, "state.json"),
    logDir: path.join(root, "logs"),
    claudeSettingsPath: path.join(root, "claude-settings.json"),
    getProject: async (id) => (id === project.id ? project : null),
    getExecutables: async () => ({
      agents: { powershell: "powershell.exe", claude: "claude.exe", codex: "codex.cmd" },
      vscode: "code.cmd",
    }),
    getAgent: (agentId) => BUILTIN_AGENTS[agentId as BuiltinAgentId] ?? null,
    toolSessionCwd: () => "C:\\Users\\me",
    env: { SYSTEMROOT: "C:\\Windows" },
    idFactory: () => "session-1",
    now: () => "2026-07-11T01:00:00.000Z",
    logFlushMs: 60_000,
    autoResumeEnabled: () => false,
  });
  await gated.initialize();

  const result = await gated.attachForRenderer("session-1");

  expect(worker.create).not.toHaveBeenCalled();
  expect(result.session.status).toBe("exited");
  // 수동 재개 경로는 그대로 살아 있다 — 시그니처는 기존 테스트(:487)와 동일.
  await gated.resume({ sessionId: "session-1", cols: 80, rows: 24 });
  expect(worker.create).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/main/terminal/terminal-coordinator.test.ts`
Expected: FAIL — `autoResumeEnabled`가 옵션 타입에 없음(TS)

- [ ] **Step 3: 구현**

**(a) `src/main/terminal/terminal-coordinator.ts`** — `TerminalCoordinatorOptions`(:94-119)에 추가:

```ts
/** 없으면 켬 — 설정 도입 전과 동일. 꺼지면 lazy auto-resume만 죽고 수동 재개는 그대로다. */
autoResumeEnabled?(): boolean;
```

`maybeAutoResume`(:319)의 `if (!view?.interruptedByShutdown) return Promise.resolve(null);`(:321) 바로 다음 줄에:

```ts
if (this.options.autoResumeEnabled?.() === false) return Promise.resolve(null);
```

**(b) `src/main/updater.ts`** — `initUpdater`(:28) 시그니처와 자동 확인(:40)만 변경. 이벤트 배선과 수동 `checkForUpdates()` 경로는 불변:

```ts
export function initUpdater(options: { autoCheck?: boolean } = {}): void {
  if (!app.isPackaged) return;
  // ... 기존 이벤트 배선 그대로 ...
  if (options.autoCheck !== false) void autoUpdater.checkForUpdatesAndNotify();
}
```

단위 테스트는 추가하지 않는다 — `initUpdater`는 `app.isPackaged` 가드 때문에 오늘도 단위 테스트가 없고(updater.test.ts는 `updater-platform`만 검증), Electron 전체를 목킹할 가치가 없다. 검증은 typecheck + Task 13 수동 체크리스트.

**(c) `src/main/runtime.ts`** — `new TerminalCoordinator({ ... })` 옵션 객체에 추가:

```ts
autoResumeEnabled: () => settingsService.current().general.autoResumeSessions,
```

**(d) `src/main/index.ts`** — close 핸들러(:66-74)를 다음으로 교체:

```ts
window.on("close", (event) => {
  if (quitCoordinator.isCommitted()) return;
  event.preventDefault();
  const closeToTray = runtime?.settings.current().general.closeToTray ?? true;
  if (trayUnavailable || !closeToTray) {
    void requestQuit();
    return;
  }
  window.hide();
});
```

`initUpdater()`(:244)를 다음으로 교체:

```ts
initUpdater({ autoCheck: runtime?.settings.current().general.autoCheckUpdates ?? true });
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/main/terminal/terminal-coordinator.test.ts && npm run typecheck`
Expected: PASS — 신규 1개 + 기존 auto-resume 테스트 전부 무수정 통과

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- src/main/index.ts src/main/updater.ts src/main/terminal/terminal-coordinator.ts src/main/terminal/terminal-coordinator.test.ts src/main/runtime.ts
git commit -m "feat: gate close-to-tray, auto-update check, and auto-resume by settings"
```

---

### Task 6: 타이틀바 버튼형 "설정" 진입점

**Files:**
- Modify: `src/renderer/src/title-bar-menu.ts` (`TitleBarMenu.action?`, 설정 항목)
- Modify: `src/renderer/src/TitleBar.tsx` (버튼형 최상위 항목 렌더 + 좌우 화살표 순환에서 제외)
- Test: `src/renderer/src/title-bar-menu.test.ts`

**Interfaces:**
- Consumes: 기존 `TitleBarMenu`/`buildTitleBarMenus`
- Produces: `TitleBarMenu`에 `action?: string` — 있으면 드롭다운 없는 버튼이고 클릭이 `onAction(menu.action)`을 쏜다. 설정 항목은 `{ id: "settings", label: "설정", entries: [], action: "settings.open" }`으로 도움말 다음(마지막)에 선다. `settings.open` 실행은 Task 7의 `handleMenuAction` 케이스가 받는다.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/src/title-bar-menu.test.ts`에 추가 (컨텍스트는 자급자족 리터럴):

```ts
import type { TitleBarMenuContext } from "./title-bar-menu"; // 기존 import에 병합

const settingsButtonContext: TitleBarMenuContext = {
  agents: [],
  appVersion: "1.0.0",
  project: null,
  readOnly: false,
  pendingAction: false,
  session: null,
  terminalFocused: false,
  canSaveFile: false,
  sidebarCollapsed: false,
  rightSidebarCollapsed: false,
};

it("도움말 오른쪽에 드롭다운 없는 설정 버튼이 선다", () => {
  const menus = buildTitleBarMenus(settingsButtonContext);
  const last = menus[menus.length - 1]!;
  expect(last).toMatchObject({ id: "settings", label: "설정", action: "settings.open" });
  expect(last.entries).toEqual([]);
  expect(menus[menus.length - 2]!.id).toBe("help");
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/renderer/src/title-bar-menu.test.ts`
Expected: FAIL — 마지막 메뉴가 `help`

- [ ] **Step 3: 구현**

**(a) `src/renderer/src/title-bar-menu.ts`** — `TitleBarMenu`에:

```ts
export interface TitleBarMenu {
  id: string;
  label: string;
  entries: TitleBarEntry[];
  /** 있으면 드롭다운 대신 버튼이다 — 클릭이 이 액션 id를 바로 쏜다. */
  action?: string;
}
```

`buildTitleBarMenus`의 반환 배열 마지막(도움말 뒤)에:

```ts
// 스펙: "도움말" 오른쪽. 메뉴가 아니라 버튼 — 누르면 설정 창이 바로 열린다.
{ id: "settings", label: "설정", entries: [], action: "settings.open" },
```

**(b) `src/renderer/src/TitleBar.tsx`** — `menus.map`(:173-202)에서 action 메뉴를 분기:

```tsx
{menus.map((menu) =>
  menu.action ? (
    <button
      key={menu.id}
      type="button"
      role="menuitem"
      className="title-bar-menu-button"
      // 열린 메뉴에서 이 버튼으로 hover하면 드롭다운을 접는다 — 버튼엔 펼칠 것이 없다.
      onMouseEnter={() => {
        if (openMenuId) closeMenus();
      }}
      onClick={() => {
        closeMenus();
        onAction(menu.action!);
      }}
    >
      {menu.label}
    </button>
  ) : (
    <div className="title-bar-menu-anchor" key={menu.id}>
      {/* ... 기존 드롭다운 버튼 + 드롭다운 렌더 그대로 ... */}
    </div>
  ),
)}
```

좌우 화살표 순환(:96-102)은 버튼형을 건너뛴다:

```ts
if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
  event.preventDefault();
  const cycle = menus.filter((candidate) => !candidate.action);
  const index = cycle.findIndex((menu) => menu.id === openMenuId);
  const step = event.key === "ArrowRight" ? 1 : -1;
  const next = cycle[(index + step + cycle.length) % cycle.length];
  if (next) openMenu(next.id);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/renderer/src/title-bar-menu.test.ts src/renderer/src/TitleBar.test.tsx`
Expected: PASS — 신규 1개 + 기존 테스트 전부. TitleBar.test.tsx가 메뉴 개수·순회를 단정하고 있어 깨지면, 단정을 설정 버튼 포함으로 갱신한다(동작 변화가 아니라 항목 추가다).

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- src/renderer/src/title-bar-menu.ts src/renderer/src/title-bar-menu.test.ts src/renderer/src/TitleBar.tsx
git commit -m "feat: add the title bar settings button"
```

---

### Task 7: SettingsDialog — 일반·터미널·알림 탭과 App 배선

**Files:**
- Create: `src/renderer/src/SettingsDialog.tsx`
- Test: `src/renderer/src/SettingsDialog.test.tsx`
- Modify: `src/renderer/src/App.tsx` (appSettings 상태·구독, settingsOpen, `handleMenuAction`의 `settings.open` 케이스, Quick Open 명령, 다이얼로그 렌더)
- Modify: `src/renderer/src/App.test.tsx` (진입점 테스트)
- Modify: `src/renderer/src/index.css` (다이얼로그 스타일)

**Interfaces:**
- Consumes: Task 3 `window.multiCliWork.settings`, Task 1 `AppSettings`/`DEFAULT_SETTINGS`/범위 상수, 기존 `.modal-backdrop`/`.confirm-dialog` CSS(index.css:3732), `QuickOpenItem`(kind `"command"`), `handleMenuAction`(App.tsx:2632)
- Produces: `SettingsDialog({ settings, onClose }: { settings: AppSettings; onClose(): void })` — 저장 버튼 없는 즉시 적용 폼. 탭 상태 타입 `"general" | "terminal" | "notifications" | "keybindings"`(단축키 탭 내용은 Task 12가 채운다). App 상태 `appSettings: AppSettings`(초기값 `DEFAULT_SETTINGS` — 기본값=현행이라 로드 전 깜빡임이 무해하다), `settingsOpen: boolean`. Task 8이 `appSettings.terminal`, Task 10·11이 `appSettings.keybindings`를 읽는다.

- [ ] **Step 1: 실패하는 테스트 작성**

**(a) `src/renderer/src/SettingsDialog.test.tsx`** (신규):

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MultiCliWorkApi } from "@shared/api-types";
import { DEFAULT_SETTINGS } from "@shared/settings-types";
import { SettingsDialog } from "./SettingsDialog";

const update = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);

beforeEach(() => {
  update.mockClear();
  window.multiCliWork = {
    settings: { get: vi.fn().mockResolvedValue(DEFAULT_SETTINGS), update, onChange: vi.fn(() => () => undefined) },
  } as unknown as MultiCliWorkApi;
});

afterEach(cleanup);

describe("SettingsDialog", () => {
  it("일반 탭에서 언어·트레이·자동 재개·업데이트 확인이 부분 패치로 저장된다", async () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("언어"), { target: { value: "en" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ language: "en" }));
    fireEvent.click(screen.getByLabelText("창을 닫으면 트레이에 남기기"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ general: { closeToTray: false } }));
  });

  it("터미널 탭의 글꼴 크기 변경이 저장되고, 범위 밖 값은 보내지 않는다", async () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "터미널" }));
    const fontSize = screen.getByLabelText("글꼴 크기");
    fireEvent.change(fontSize, { target: { value: "16" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ terminal: { fontSize: 16 } }));
    update.mockClear();
    fireEvent.change(fontSize, { target: { value: "99" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(update).not.toHaveBeenCalled();
  });

  it("알림 탭에서 마스터·상태별 토글이 저장된다", async () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "알림" }));
    fireEvent.click(screen.getByLabelText("데스크톱 알림"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ notifications: { desktop: false } }));
    fireEvent.click(screen.getByLabelText("종료"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ notifications: { statuses: { exited: true } } }),
    );
  });

  it("ESC와 바깥 클릭이 닫는다", () => {
    const onClose = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

**(b) `src/renderer/src/App.test.tsx`** — 진입점 테스트 추가:

```tsx
describe("settings entry points", () => {
  it("타이틀바 설정 버튼이 설정 다이얼로그를 연다", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    fireEvent.click(await screen.findByRole("menuitem", { name: "설정" }));
    expect(await screen.findByRole("dialog", { name: "설정" })).toBeInTheDocument();
  });

  it("빠른 열기의 설정 열기 명령이 같은 다이얼로그를 연다", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    fireEvent.click(await screen.findByText("설정 열기"));
    expect(await screen.findByRole("dialog", { name: "설정" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/renderer/src/SettingsDialog.test.tsx src/renderer/src/App.test.tsx`
Expected: FAIL — `SettingsDialog` 모듈 없음 / 설정 menuitem 없음(Task 6 후 버튼은 있으나 클릭해도 다이얼로그 없음)

- [ ] **Step 3: 구현**

**(a) `src/renderer/src/SettingsDialog.tsx`** (신규 — 단축키 탭 자리는 이 태스크에서 빈 안내문으로 두고 Task 12가 채운다):

```tsx
import { useEffect, useState } from "react";
import type { AppSettings, AppSettingsPatch, NotifiableStatus } from "@shared/settings-types";
import {
  TERMINAL_FONT_SIZE_RANGE,
  TERMINAL_LINE_HEIGHT_RANGE,
  TERMINAL_SCROLLBACK_RANGE,
} from "@shared/settings-types";

type SettingsTab = "general" | "terminal" | "notifications" | "keybindings";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "일반" },
  { id: "terminal", label: "터미널" },
  { id: "notifications", label: "알림" },
  { id: "keybindings", label: "단축키" },
];

const STATUS_LABELS: Array<{ status: NotifiableStatus; label: string }> = [
  { status: "awaiting-input", label: "입력 대기" },
  { status: "awaiting-approval", label: "승인 대기" },
  { status: "exited", label: "종료" },
  { status: "error", label: "오류" },
];

interface SettingsDialogProps {
  settings: AppSettings;
  onClose(): void;
}

/**
 * 저장 버튼이 없는 즉시 적용 폼. 컨트롤 변경 → settings:update → settings:changed 브로드캐스트로
 * App의 사본이 갱신되어 되돌아온다 — 이 다이얼로그 자신도 그 사본을 props로 받는다.
 */
export function SettingsDialog({ settings, onClose }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const update = (patch: AppSettingsPatch) => {
    setError(null);
    window.multiCliWork.settings.update(patch).catch(() => setError("설정 저장에 실패했습니다"));
  };

  const numberField = (
    label: string,
    id: string,
    value: number,
    range: { min: number; max: number },
    step: number,
    apply: (next: number) => AppSettingsPatch,
  ) => (
    <div className="settings-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={range.min}
        max={range.max}
        step={step}
        defaultValue={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next) && next >= range.min && next <= range.max) update(apply(next));
        }}
      />
    </div>
  );

  const checkboxRow = (label: string, id: string, checked: boolean, apply: (next: boolean) => AppSettingsPatch) => (
    <div className="settings-row">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => update(apply(event.target.checked))} />
    </div>
  );

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="confirm-dialog settings-dialog" role="dialog" aria-modal="true" aria-label="설정">
        <nav className="settings-nav" aria-label="설정 분류">
          {TABS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={tab === candidate.id ? "active" : ""}
              onClick={() => setTab(candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {tab === "general" ? (
            <>
              <h2>일반</h2>
              <div className="settings-row">
                <label htmlFor="settings-language">언어</label>
                <select
                  id="settings-language"
                  value={settings.language}
                  onChange={(event) => update({ language: event.target.value as AppSettings["language"] })}
                >
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                </select>
              </div>
              <p className="settings-hint">언어 선택은 다음 버전에서 적용됩니다.</p>
              {checkboxRow("창을 닫으면 트레이에 남기기", "settings-close-to-tray", settings.general.closeToTray, (next) => ({
                general: { closeToTray: next },
              }))}
              {checkboxRow(
                "시작 시 이전 세션 자동 재개",
                "settings-auto-resume",
                settings.general.autoResumeSessions,
                (next) => ({ general: { autoResumeSessions: next } }),
              )}
              {checkboxRow(
                "시작 시 업데이트 자동 확인",
                "settings-auto-updates",
                settings.general.autoCheckUpdates,
                (next) => ({ general: { autoCheckUpdates: next } }),
              )}
            </>
          ) : null}
          {tab === "terminal" ? (
            <>
              <h2>터미널</h2>
              <p className="settings-hint">살아있는 모든 세션에 즉시 반영됩니다.</p>
              <div className="settings-row">
                <label htmlFor="settings-font-family">글꼴</label>
                <input
                  id="settings-font-family"
                  type="text"
                  defaultValue={settings.terminal.fontFamily}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next.length > 0 && next !== settings.terminal.fontFamily) update({ terminal: { fontFamily: next } });
                  }}
                />
              </div>
              {numberField("글꼴 크기", "settings-font-size", settings.terminal.fontSize, TERMINAL_FONT_SIZE_RANGE, 1, (next) => ({
                terminal: { fontSize: next },
              }))}
              {numberField("행간", "settings-line-height", settings.terminal.lineHeight, TERMINAL_LINE_HEIGHT_RANGE, 0.05, (next) => ({
                terminal: { lineHeight: next },
              }))}
              {numberField(
                "스크롤백(줄)",
                "settings-scrollback",
                settings.terminal.scrollback,
                TERMINAL_SCROLLBACK_RANGE,
                1_000,
                (next) => ({ terminal: { scrollback: Math.floor(next) } }),
              )}
              <div className="settings-row">
                <label htmlFor="settings-cursor-style">커서 스타일</label>
                <select
                  id="settings-cursor-style"
                  value={settings.terminal.cursorStyle}
                  onChange={(event) =>
                    update({ terminal: { cursorStyle: event.target.value as AppSettings["terminal"]["cursorStyle"] } })
                  }
                >
                  <option value="bar">bar</option>
                  <option value="block">block</option>
                  <option value="underline">underline</option>
                </select>
              </div>
              {checkboxRow("커서 깜빡임", "settings-cursor-blink", settings.terminal.cursorBlink, (next) => ({
                terminal: { cursorBlink: next },
              }))}
            </>
          ) : null}
          {tab === "notifications" ? (
            <>
              <h2>알림</h2>
              <p className="settings-hint">배지와 트레이 표시는 이 설정과 무관하게 동작합니다.</p>
              {checkboxRow("데스크톱 알림", "settings-desktop-notifications", settings.notifications.desktop, (next) => ({
                notifications: { desktop: next },
              }))}
              {STATUS_LABELS.map(({ status, label }) =>
                checkboxRow(label, `settings-notify-${status}`, settings.notifications.statuses[status], (next) => ({
                  notifications: { statuses: { [status]: next } },
                })),
              )}
            </>
          ) : null}
          {tab === "keybindings" ? (
            <>
              <h2>단축키</h2>
              <p className="settings-hint">단축키 편집은 곧 제공됩니다.</p>
            </>
          ) : null}
          {error ? <p className="settings-error" role="alert">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
```

(단축키 탭 자리 표시 문구는 Task 12가 실제 편집기로 교체한다 — 이 플랜 안에서 해소되는 임시 상태다.)

**(b) `src/renderer/src/App.tsx`**:

- import: `import { SettingsDialog } from "./SettingsDialog";`, `import { DEFAULT_SETTINGS, type AppSettings } from "@shared/settings-types";`
- 상태(다른 useState 옆):

```ts
const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
const [settingsOpen, setSettingsOpen] = useState(false);
```

- 로드·구독 effect (다른 초기 로드 effect 옆):

```ts
// 기본값 = 현행 동작이므로 로드 전 잠깐 DEFAULT_SETTINGS로 그려도 시각적 차이가 없다.
useEffect(() => {
  let disposed = false;
  void window.multiCliWork.settings
    .get()
    .then((settings) => {
      if (!disposed) setAppSettings(settings);
    })
    .catch(() => undefined);
  const unsubscribe = window.multiCliWork.settings.onChange(setAppSettings);
  return () => {
    disposed = true;
    unsubscribe();
  };
}, []);
```

- `handleMenuAction` 스위치(:2632)에 케이스 추가:

```ts
case "settings.open":
  setSettingsOpen(true);
  break;
```

- Quick Open: `commandItems`(:2218 부근)에 추가:

```ts
{ key: "command:settings", kind: "command", label: "설정 열기", detail: null },
```

`handleQuickOpenSelect`(:2239)의 `command:` 분기에 추가 (기존 `command:edit-agents` 분기와 같은 자리):

```ts
if (item.key === "command:settings") {
  setSettingsOpen(true);
  return;
}
```

- 렌더 (QuickOpenPalette :3189 근처, 다른 모달들 옆):

```tsx
{settingsOpen ? <SettingsDialog settings={appSettings} onClose={() => setSettingsOpen(false)} /> : null}
```

**(c) `src/renderer/src/index.css`** — `.confirm-dialog` 블록(:3732 부근) 뒤에 추가. 색·타이포는 기존 변수만 쓴다(`--line`, `--line-strong`, `--surface-raised`, `--muted`, `--text`, `--type-panel-title`, `--type-secondary`):

```css
.settings-dialog {
  display: flex;
  width: min(720px, calc(100vw - 48px));
  min-height: 420px;
  max-height: calc(100vh - 96px);
  padding: 0;
  overflow: hidden;
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 132px;
  flex-shrink: 0;
  padding: 14px 8px;
  border-right: 1px solid var(--line);
}

.settings-nav button {
  padding: 7px 10px;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--muted);
  font: var(--type-secondary);
  text-align: left;
  cursor: pointer;
}

.settings-nav button:hover {
  color: var(--text);
}

.settings-nav button.active {
  background: rgb(255 255 255 / 8%);
  color: var(--text);
}

.settings-body {
  flex: 1;
  padding: 16px 18px;
  overflow-y: auto;
}

.settings-body h2 {
  margin: 0 0 12px;
  font: var(--type-panel-title);
}

.settings-hint {
  margin: 2px 0 10px;
  color: var(--muted);
  font: var(--type-secondary);
}

.settings-error {
  margin: 10px 0 0;
  color: var(--muted);
  font: var(--type-secondary);
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
}

.settings-row > label {
  color: var(--text);
  font: var(--type-secondary);
}

.settings-row input[type="text"],
.settings-row input[type="number"],
.settings-row select {
  width: 220px;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--surface-raised);
  color: var(--text);
  font: var(--type-secondary);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/renderer/src/SettingsDialog.test.tsx src/renderer/src/App.test.tsx && npm run typecheck`
Expected: PASS — 신규 6개 + 기존 App 테스트 전부

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- src/renderer/src/SettingsDialog.tsx src/renderer/src/SettingsDialog.test.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/index.css
git commit -m "feat: add the settings dialog with general, terminal, and notification tabs"
```

---

### Task 8: 터미널 설정 라이브 반영

**Files:**
- Modify: `src/renderer/src/TerminalPane.tsx` (`settings` prop, 생성자 시드, 라이브 적용 effect)
- Modify: `src/renderer/src/WorkspaceGrid.tsx` (`terminalSettings` prop 관통)
- Modify: `src/renderer/src/App.tsx` (WorkspaceGrid에 전달)
- Test: `src/renderer/src/TerminalPane.test.tsx`
- Modify(필요시): `src/renderer/src/WorkspaceGrid.test.tsx` (신규 필수 prop 추가)

**Interfaces:**
- Consumes: Task 1 `TerminalSettings`/`DEFAULT_SETTINGS`, Task 7 `appSettings`
- Produces: `TerminalPaneProps.settings: TerminalSettings`(필수), `WorkspaceGridProps.terminalSettings: TerminalSettings`(필수). 터미널 인스턴스 재생성 없이 `terminal.options.*` 변경 — 메인 effect deps(`[session.id, refreshRequest]`)는 불변.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/src/TerminalPane.test.tsx`

`renderPane` 헬퍼(:94)의 JSX에 `settings={DEFAULT_SETTINGS.terminal}`를 `{...overrides}` **앞에** 추가하고(오버라이드 가능하게), 상단에 `import { DEFAULT_SETTINGS } from "@shared/settings-types";`를 더한 뒤 테스트 추가:

```tsx
it("설정 변경이 살아있는 터미널에 재생성 없이 반영된다", () => {
  const { rerender } = render(
    <TerminalPane
      session={session}
      settings={DEFAULT_SETTINGS.terminal}
      shiftEnterBytes={null}
      refreshRequest={0}
      onAttached={vi.fn()}
      onRefreshComplete={vi.fn()}
      onError={vi.fn()}
    />,
  );
  const terminal = terminalHarness.instances.at(-1)!;
  expect(terminal.options.fontSize).toBe(13);

  rerender(
    <TerminalPane
      session={session}
      settings={{ ...DEFAULT_SETTINGS.terminal, fontSize: 20, cursorBlink: true, scrollback: 50_000 }}
      shiftEnterBytes={null}
      refreshRequest={0}
      onAttached={vi.fn()}
      onRefreshComplete={vi.fn()}
      onError={vi.fn()}
    />,
  );

  expect(terminal.options.fontSize).toBe(20);
  expect(terminal.options.cursorBlink).toBe(true);
  expect(terminal.options.scrollback).toBe(50_000);
  expect(terminalHarness.instances.length).toBe(1); // 재생성 없음 = 스크롤백·상태 보존
});
```

(이 파일의 `render`가 RTL에서 직접 import되어 있지 않으면 import에 `render`를 추가한다. `TerminalPane`의 다른 필수 prop이 위와 다르면 `renderPane` 헬퍼의 JSX를 기준으로 맞춘다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/renderer/src/TerminalPane.test.tsx`
Expected: FAIL — `settings` prop 타입 없음

- [ ] **Step 3: 구현**

**(a) `src/renderer/src/TerminalPane.tsx`**:

- `TerminalPaneProps`(:21-38)에 `settings: TerminalSettings;` 추가, `import type { TerminalSettings } from "@shared/settings-types";`
- 다른 prop들처럼 ref로 복사(:74-81 패턴):

```ts
const settingsRef = useRef(settings);
settingsRef.current = settings;
const terminalInstanceRef = useRef<Terminal | null>(null);
```

- `new Terminal({...})`(:100-140) 생성자에서 리터럴을 시드로 교체 (`CONTENT_TYPOGRAPHY` import가 이 파일에서 더 이상 안 쓰이면 제거):

```ts
cursorBlink: settingsRef.current.cursorBlink,
cursorStyle: settingsRef.current.cursorStyle,
fontFamily: settingsRef.current.fontFamily,
fontSize: settingsRef.current.fontSize,
lineHeight: settingsRef.current.lineHeight,
scrollback: settingsRef.current.scrollback,
```

- 메인 effect에서 터미널 생성 직후 `terminalInstanceRef.current = terminal;`, cleanup(:315 부근)에서 `terminalInstanceRef.current = null;`
- 메인 effect 안에서 ResizeObserver가 부르는 기존 fit 루틴을 ref로 노출: `const refitRef = useRef<() => void>(() => undefined);`를 컴포넌트에 두고, effect 안에서 `refitRef.current = <기존 fit 함수>;` (함수명은 파일의 실제 이름을 따른다), cleanup에서 `refitRef.current = () => undefined;`
- 라이브 적용 effect 추가 (메인 effect **밖**, deps는 settings뿐 — 재생성 없음):

```ts
// xterm 6은 options를 런타임에 바꿀 수 있다 — 인스턴스를 살려둔 채 반영해야 스크롤백이 산다.
useEffect(() => {
  const terminal = terminalInstanceRef.current;
  if (!terminal) return;
  terminal.options.fontFamily = settings.fontFamily;
  terminal.options.fontSize = settings.fontSize;
  terminal.options.lineHeight = settings.lineHeight;
  terminal.options.scrollback = settings.scrollback;
  terminal.options.cursorStyle = settings.cursorStyle;
  terminal.options.cursorBlink = settings.cursorBlink;
  refitRef.current(); // 폰트 크기가 곧 셀 크기 — 그리드를 다시 맞춘다
}, [settings]);
```

**(b) `src/renderer/src/WorkspaceGrid.tsx`** — `WorkspaceGridProps`에 `terminalSettings: TerminalSettings;` 추가, TerminalPane 렌더(:323-333)에 `settings={terminalSettings}` 전달.

**(c) `src/renderer/src/App.tsx`** — WorkspaceGrid 렌더(:2872-2896)에 `terminalSettings={appSettings.terminal}` 추가. WorkspaceGrid를 렌더하는 다른 위치가 있으면(Grep으로 확인) 동일하게 추가.

**(d) `src/renderer/src/WorkspaceGrid.test.tsx`**(존재 시) — 렌더 호출마다 `terminalSettings={DEFAULT_SETTINGS.terminal}` 추가.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/renderer/src/TerminalPane.test.tsx src/renderer/src/WorkspaceGrid.test.tsx src/renderer/src/App.test.tsx && npm run typecheck`
Expected: PASS 전부

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- src/renderer/src/TerminalPane.tsx src/renderer/src/TerminalPane.test.tsx src/renderer/src/WorkspaceGrid.tsx src/renderer/src/WorkspaceGrid.test.tsx src/renderer/src/App.tsx
git commit -m "feat: apply terminal settings to live xterm sessions"
```

---

### Task 9: 키맵 모듈

**Files:**
- Create: `src/renderer/src/keymap.ts`
- Test: `src/renderer/src/keymap.test.ts`

**Interfaces:**
- Consumes: 없음 (renderer 전용 — DOM 사용 가능)
- Produces:
  - `KeymapAction { id, label, category: "일반"|"보기"|"세션"|"편집", defaultAccelerator: string | null, terminalSafe: boolean, ignoreWhileTyping: boolean, fixed: boolean }`
  - `KEYMAP_ACTIONS: readonly KeymapAction[]`, `KEYMAP_CATEGORY_ORDER`
  - `normalizeKeyEvent(event): string | null` — `"Ctrl+Shift+Tab"` 표기(Ctrl→Alt→Shift 순, meta는 Ctrl로, Shift 글리프 `+`→`=`·`_`→`-`는 Shift 표기 제거, 단독 수식어는 null)
  - `effectiveAccelerator(actionId, overrides): string | null` — fixed는 항상 기본값, 오버라이드 `undefined`=기본값·`null`=해제
  - `resolveKeymap(overrides): Map<string, KeymapAction>` — fixed 제외(디스패처가 잡으면 반쪽 리매핑)
  - `findConflict(accelerator, overrides, excludeActionId): KeymapAction | null`
  - `isBindableAccelerator(accelerator): boolean` — Ctrl/Alt 수식어 또는 F1~F12 단독만 허용(Shift+문자는 타이핑이다)
  - `isTypingTarget(): boolean` — `.modal-backdrop` 존재 또는 input/textarea/select/contentEditable 포커스
  - 액션 id는 `handleMenuAction`(App.tsx) 스위치 케이스와 동일 — 카탈로그는 그 스위치의 색인이다.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/src/keymap.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  KEYMAP_ACTIONS,
  effectiveAccelerator,
  findConflict,
  isBindableAccelerator,
  isTypingTarget,
  normalizeKeyEvent,
  resolveKeymap,
} from "./keymap";

describe("normalizeKeyEvent", () => {
  const event = (key: string, modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  });

  it("수식어를 Ctrl→Alt→Shift 순으로 표기하고 meta는 Ctrl로 접는다", () => {
    expect(normalizeKeyEvent(event("Tab", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Tab");
    expect(normalizeKeyEvent(event("p", { metaKey: true }))).toBe("Ctrl+P");
    expect(normalizeKeyEvent(event("k", { ctrlKey: true, altKey: true, shiftKey: true }))).toBe("Ctrl+Alt+Shift+K");
  });

  it("Shift 글리프(+, _)는 기본 키로 되돌리고 Shift 표기를 없앤다 — 현행 줌 키와 일치", () => {
    expect(normalizeKeyEvent(event("+", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+=");
    expect(normalizeKeyEvent(event("_", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+-");
    expect(normalizeKeyEvent(event("=", { ctrlKey: true }))).toBe("Ctrl+=");
  });

  it("기능키는 단독으로, 수식어 단독은 null", () => {
    expect(normalizeKeyEvent(event("F5"))).toBe("F5");
    expect(normalizeKeyEvent(event("F11"))).toBe("F11");
    expect(normalizeKeyEvent(event("Control", { ctrlKey: true }))).toBeNull();
    expect(normalizeKeyEvent(event("Shift", { shiftKey: true }))).toBeNull();
  });

  it("숫자와 쉼표", () => {
    expect(normalizeKeyEvent(event("1", { ctrlKey: true }))).toBe("Ctrl+1");
    expect(normalizeKeyEvent(event(",", { ctrlKey: true }))).toBe("Ctrl+,");
  });
});

describe("키맵 카탈로그", () => {
  it("기본 키맵에 충돌이 없다", () => {
    const seen = new Map<string, string>();
    for (const action of KEYMAP_ACTIONS) {
      if (!action.defaultAccelerator) continue;
      expect(seen.get(action.defaultAccelerator), `${action.id} vs ${seen.get(action.defaultAccelerator)}`).toBeUndefined();
      seen.set(action.defaultAccelerator, action.id);
    }
  });

  it("스펙의 기본 키맵을 그대로 싣는다", () => {
    const byId = new Map(KEYMAP_ACTIONS.map((action) => [action.id, action]));
    expect(byId.get("view.quick-open")?.defaultAccelerator).toBe("Ctrl+P");
    expect(byId.get("file.save")?.defaultAccelerator).toBe("Ctrl+S");
    expect(byId.get("settings.open")?.defaultAccelerator).toBe("Ctrl+,");
    expect(byId.get("session.refresh")?.defaultAccelerator).toBe("F5");
    expect(byId.get("session.next")?.defaultAccelerator).toBe("Ctrl+Tab");
    expect(byId.get("session.prev")?.defaultAccelerator).toBe("Ctrl+Shift+Tab");
    expect(byId.get("workspace.focus-slot-1")?.defaultAccelerator).toBe("Ctrl+1");
    expect(byId.get("workspace.focus-slot-9")?.defaultAccelerator).toBe("Ctrl+9");
    expect(byId.get("workspace.focus-slot-10")).toBeUndefined(); // Ctrl+0은 줌 리셋 소유
    expect(byId.get("view.reload")?.defaultAccelerator).toBeNull(); // Ctrl+R은 의도적으로 없음
    expect(byId.get("edit.copy")).toMatchObject({ defaultAccelerator: "Ctrl+Shift+C", fixed: true });
    expect(byId.get("edit.paste")).toMatchObject({ defaultAccelerator: "Ctrl+V", fixed: true });
    expect(byId.get("edit.select-all")).toMatchObject({ defaultAccelerator: "Ctrl+A", fixed: true });
  });
});

describe("resolveKeymap / effectiveAccelerator / findConflict", () => {
  it("오버라이드가 기본값을 대체하고 null은 해제한다", () => {
    const keymap = resolveKeymap({ "view.quick-open": "Ctrl+K", "session.refresh": null });
    expect(keymap.get("Ctrl+K")?.id).toBe("view.quick-open");
    expect(keymap.get("Ctrl+P")).toBeUndefined();
    expect(keymap.get("F5")).toBeUndefined();
    expect(keymap.get("Ctrl+1")?.id).toBe("workspace.focus-slot-1");
  });

  it("fixed 액션은 디스패처 키맵에서 빠지고, 유효 키는 항상 기본값이다", () => {
    expect(resolveKeymap({}).get("Ctrl+V")).toBeUndefined();
    expect(effectiveAccelerator("edit.paste", { "edit.paste": "Ctrl+B" })).toBe("Ctrl+V");
  });

  it("충돌을 오버라이드 기준으로 찾는다 — fixed 키와의 충돌도 보고한다", () => {
    expect(findConflict("Ctrl+P", {}, "session.refresh")?.id).toBe("view.quick-open");
    expect(findConflict("Ctrl+P", { "view.quick-open": "Ctrl+K" }, "session.refresh")).toBeNull();
    expect(findConflict("Ctrl+V", {}, "view.quick-open")).toMatchObject({ id: "edit.paste", fixed: true });
  });
});

describe("isBindableAccelerator", () => {
  it("단독 문자·숫자·Shift+문자는 거부, 기능키 단독과 Ctrl/Alt 조합은 허용", () => {
    expect(isBindableAccelerator("A")).toBe(false);
    expect(isBindableAccelerator("1")).toBe(false);
    expect(isBindableAccelerator("Shift+A")).toBe(false);
    expect(isBindableAccelerator("F5")).toBe(true);
    expect(isBindableAccelerator("F12")).toBe(true);
    expect(isBindableAccelerator("Ctrl+K")).toBe(true);
    expect(isBindableAccelerator("Alt+1")).toBe(true);
    expect(isBindableAccelerator("Ctrl+Shift+Tab")).toBe(true);
  });
});

describe("isTypingTarget", () => {
  it("텍스트 입력 포커스와 모달을 감지한다", () => {
    expect(isTypingTarget()).toBe(false);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(isTypingTarget()).toBe(true);
    input.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    document.body.appendChild(backdrop);
    expect(isTypingTarget()).toBe(true);
    backdrop.remove();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/renderer/src/keymap.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `src/renderer/src/keymap.ts`

```ts
/**
 * The single source of truth for keyboard shortcuts. Action ids are the cases of App.tsx's
 * handleMenuAction switch — this catalog is an index over that switch, not a new execution path.
 * The menu bar derives its shortcut labels from here, so a remap changes the label with it.
 */

export type KeymapCategory = "일반" | "보기" | "세션" | "편집";

export const KEYMAP_CATEGORY_ORDER: readonly KeymapCategory[] = ["일반", "보기", "세션", "편집"];

export interface KeymapAction {
  id: string;
  label: string;
  category: KeymapCategory;
  defaultAccelerator: string | null;
  /** 터미널이 키보드를 쥐고 있어도 디스패처가 가로챈다(캡처 단계). */
  terminalSafe: boolean;
  /** 모달·텍스트 입력이 포커스를 쥔 동안은 무시한다 — 슬롯 포커스·세션 순환류. */
  ignoreWhileTyping: boolean;
  /** 리매핑 불가 — 표시만 된다. edit.*는 TerminalPane의 터미널 의미론과 결합되어 있다. */
  fixed: boolean;
}

const action = (
  id: string,
  label: string,
  category: KeymapCategory,
  defaultAccelerator: string | null,
  options?: Partial<Pick<KeymapAction, "terminalSafe" | "ignoreWhileTyping" | "fixed">>,
): KeymapAction => ({
  id,
  label,
  category,
  defaultAccelerator,
  terminalSafe: options?.terminalSafe ?? true,
  ignoreWhileTyping: options?.ignoreWhileTyping ?? false,
  fixed: options?.fixed ?? false,
});

export const KEYMAP_ACTIONS: readonly KeymapAction[] = [
  action("view.quick-open", "빠른 열기", "일반", "Ctrl+P"),
  action("file.save", "파일 저장", "일반", "Ctrl+S"),
  action("settings.open", "설정 열기", "일반", "Ctrl+,"),
  action("view.zoom-in", "확대", "보기", "Ctrl+="),
  action("view.zoom-out", "축소", "보기", "Ctrl+-"),
  action("view.zoom-reset", "원래 크기", "보기", "Ctrl+0"),
  action("view.full-screen", "전체 화면", "보기", "F11"),
  action("view.dev-tools", "개발자 도구", "보기", "F12"),
  // Ctrl+R 기본값은 의도적으로 없다 — 오타 한 번의 리로드가 세션 화면을 날린다.
  action("view.reload", "다시 로드", "보기", null),
  action("session.refresh", "세션 새로고침", "세션", "F5"),
  action("session.next", "다음 세션", "세션", "Ctrl+Tab", { ignoreWhileTyping: true }),
  action("session.prev", "이전 세션", "세션", "Ctrl+Shift+Tab", { ignoreWhileTyping: true }),
  ...Array.from({ length: 9 }, (_, index) =>
    action(`workspace.focus-slot-${index + 1}`, `슬롯 ${index + 1} 포커스`, "세션", `Ctrl+${index + 1}`, {
      ignoreWhileTyping: true,
    }),
  ),
  action("edit.copy", "복사", "편집", "Ctrl+Shift+C", { fixed: true }),
  action("edit.paste", "붙여넣기", "편집", "Ctrl+V", { fixed: true }),
  action("edit.select-all", "모두 선택", "편집", "Ctrl+A", { fixed: true }),
  action("edit.clear", "터미널 지우기", "편집", null, { fixed: true }),
];

/** Shift로 타이핑되는 글리프 — 표기는 기본 키로 하고 Shift는 표기에서 뺀다(현행 줌 키 동작과 일치). */
const SHIFT_GLYPHS: Record<string, string> = { "+": "=", _: "-" };

export function normalizeKeyEvent(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): string | null {
  const key = event.key;
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return null;
  const glyph = SHIFT_GLYPHS[key];
  let normalized = glyph ?? (key === " " ? "Space" : key);
  if (normalized.length === 1) normalized = normalized.toUpperCase();
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey && glyph === undefined) parts.push("Shift");
  parts.push(normalized);
  return parts.join("+");
}

export function effectiveAccelerator(actionId: string, overrides: Record<string, string | null>): string | null {
  const found = KEYMAP_ACTIONS.find((candidate) => candidate.id === actionId);
  if (!found) return null;
  if (found.fixed) return found.defaultAccelerator;
  const override = overrides[actionId];
  return override === undefined ? found.defaultAccelerator : override;
}

export function resolveKeymap(overrides: Record<string, string | null>): Map<string, KeymapAction> {
  const keymap = new Map<string, KeymapAction>();
  for (const candidate of KEYMAP_ACTIONS) {
    if (candidate.fixed) continue; // edit.*는 TerminalPane 소유 — 디스패처가 잡으면 반쪽 리매핑이 된다
    const accelerator = effectiveAccelerator(candidate.id, overrides);
    if (accelerator) keymap.set(accelerator, candidate);
  }
  return keymap;
}

export function findConflict(
  accelerator: string,
  overrides: Record<string, string | null>,
  excludeActionId: string,
): KeymapAction | null {
  for (const candidate of KEYMAP_ACTIONS) {
    if (candidate.id === excludeActionId) continue;
    if (effectiveAccelerator(candidate.id, overrides) === accelerator) return candidate;
  }
  return null;
}

export function isBindableAccelerator(accelerator: string): boolean {
  const parts = accelerator.split("+");
  const key = parts[parts.length - 1] ?? "";
  const modifiers = new Set(parts.slice(0, -1));
  if (/^F([1-9]|1[0-2])$/.test(key)) return true;
  // Shift만으로는 부족하다 — Shift+문자는 곧 대문자 타이핑이다. Ctrl이나 Alt가 있어야 한다.
  return modifiers.has("Ctrl") || modifiers.has("Alt");
}

/** 슬롯 포커스류가 삼켜야 할 상황인지: 모달이 떠 있거나 텍스트 입력이 포커스를 쥐고 있다. */
export function isTypingTarget(): boolean {
  if (document.querySelector(".modal-backdrop")) return true;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active.isContentEditable) return true;
  return active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT";
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/renderer/src/keymap.test.ts`
Expected: PASS (테스트 12개)

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- src/renderer/src/keymap.ts src/renderer/src/keymap.test.ts
git commit -m "feat: add the keymap catalog and event normalization"
```

---

### Task 10: 키 디스패처 통합과 신규 액션

**Files:**
- Modify: `src/renderer/src/App.tsx` (capture keydown 3곳 → 디스패처 1곳, `focusVisibleSlot`/`cycleVisibleSession`, 스위치 케이스)
- Modify: `src/renderer/src/TerminalPane.tsx` (`TerminalCommands.focus`)
- Test: `src/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 9 전부, Task 7 `appSettings.keybindings`, 기존 `terminalCommands`(App.tsx:357)/`registerTerminalCommands`(:1658)/`focusPane`(:1150)/`gridSlots`(:2561)/`showsGrid`(:2569)/`handleMenuAction`(:2632)
- Produces: `TerminalCommands`에 `focus(): void`; `handleMenuAction`이 `session.next`/`session.prev`/`workspace.focus-slot-N`을 처리. 기존 단축키 동작(Ctrl+P·줌·F11·F12·Ctrl+S)은 키맵 기본값으로 완전 동일하게 재현된다.
- 불변식: `attachCustomKeyEventHandler`(TerminalPane.tsx:177-208) 무수정.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/src/App.test.tsx`에 describe 추가:

```tsx
describe("keymap dispatcher", () => {
  it("F5가 선택된 세션을 새로고침한다", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await xtermFor(powershellSession.id);
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() => expect(harness.api.terminals.refresh).toHaveBeenCalledWith(powershellSession.id));
  });

  it("Ctrl+1이 (두 번째가 아니라) 첫 번째 슬롯의 세션을 포커스한다", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await xtermFor(powershellSession.id);
    const before = vi.mocked(harness.api.terminals.select).mock.calls.length;
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    await waitFor(() => {
      const calls = vi.mocked(harness.api.terminals.select).mock.calls.slice(before);
      expect(calls).toContainEqual([atlas.id, powershellSession.id]);
    });
  });

  it("텍스트 입력이 포커스를 쥔 동안 Ctrl+1은 무시된다", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await xtermFor(powershellSession.id);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const before = vi.mocked(harness.api.terminals.select).mock.calls.length;
    fireEvent.keyDown(input, { key: "1", ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vi.mocked(harness.api.terminals.select).mock.calls.length).toBe(before);
    input.remove();
  });

  it("Ctrl+,가 설정을 연다", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "설정" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/renderer/src/App.test.tsx`
Expected: FAIL — F5·Ctrl+1·Ctrl+, 가 아무 일도 하지 않음. 기존 Ctrl+P/줌 테스트는 아직 PASS.

- [ ] **Step 3: 구현**

**(a) `src/renderer/src/TerminalPane.tsx`** — `TerminalCommands`(:14-19)에 `focus(): void;` 추가, 등록부(:210-215)에 `focus: () => terminal.focus(),` 추가.

**(b) `src/renderer/src/App.tsx`**:

- import 추가:

```ts
import { isTypingTarget, normalizeKeyEvent, resolveKeymap } from "./keymap";
```

- capture keydown 세 effect(:758-768 Ctrl+P, :773-791 F11/F12/줌, :795-806 Ctrl+S)를 **삭제**하고 그 자리에 디스패처 하나:

```ts
const keymap = useMemo(() => resolveKeymap(appSettings.keybindings), [appSettings.keybindings]);
const keymapRef = useRef(keymap);
keymapRef.current = keymap;
const handleMenuActionRef = useRef<(id: string) => void>(() => undefined);
const keyActionEnabledRef = useRef<(id: string) => boolean>(() => true);

// 캡처 단계여야 한다: 포커스된 xterm이 keydown을 삼키므로, 그보다 먼저 보는 리스너만이
// 앱 전역 단축키가 될 수 있다. (예전의 Ctrl+P·줌·Ctrl+S 리스너 세 개를 키맵 조회 하나로 통합.)
useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (document.querySelector("[data-key-capture]")) return; // 단축키 탭이 키를 녹화하는 중
    const accelerator = normalizeKeyEvent(event);
    if (!accelerator) return;
    const matched = keymapRef.current.get(accelerator);
    if (!matched) return;
    if (matched.ignoreWhileTyping && isTypingTarget()) return;
    if (!matched.terminalSafe && document.activeElement?.closest(".xterm")) return;
    if (!keyActionEnabledRef.current(matched.id)) return; // preventDefault 없이 흘려보낸다 — 현행과 동일
    event.preventDefault();
    event.stopPropagation();
    handleMenuActionRef.current(matched.id);
  };
  window.addEventListener("keydown", handleKeyDown, { capture: true });
  return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
}, []);
```

- `gridSlots`(:2561) 아래에 슬롯 포커스·순환 (둘 다 포커스와 선택을 함께 옮긴다):

```ts
/** Ctrl+N: 현재 페이지의 N번째 슬롯(그리드가 그리는 순서)으로 키보드 포커스를 옮긴다. */
const focusVisibleSlot = (slotNumber: number) => {
  if (!showsGrid) return;
  const content = gridSlots[slotNumber - 1];
  if (!content || content.kind !== "session") return;
  focusPane(content.session.id);
  terminalCommands.current.get(content.session.id)?.focus();
};

const cycleVisibleSession = (step: number) => {
  if (!showsGrid) return;
  const visible = gridSlots.flatMap((slot) => (slot?.kind === "session" ? [slot.session.id] : []));
  if (visible.length === 0) return;
  const index = visible.indexOf(focusedPaneId ?? "");
  const nextIndex = index === -1 ? (step > 0 ? 0 : visible.length - 1) : (index + step + visible.length) % visible.length;
  const next = visible[nextIndex];
  if (next) {
    focusPane(next);
    terminalCommands.current.get(next)?.focus();
  }
};
```

- `handleMenuAction`(:2632) — 스위치 **앞에** 슬롯 prefix 분기, 스위치에 케이스 2개 추가:

```ts
if (id.startsWith("workspace.focus-slot-")) {
  focusVisibleSlot(Number(id.slice("workspace.focus-slot-".length)));
  return;
}
// ... 기존 switch에:
case "session.next":
  cycleVisibleSession(1);
  break;
case "session.prev":
  cycleVisibleSession(-1);
  break;
```

- `handleMenuAction` 정의 직후에 ref 채우기 + 활성 가드(삭제한 Ctrl+S effect의 조건을 **그대로** 옮긴다 — 조건이 아래와 다르면 삭제 전 effect 쪽이 정답이다):

```ts
handleMenuActionRef.current = handleMenuAction;
keyActionEnabledRef.current = (id: string): boolean => {
  switch (id) {
    case "file.save":
      // 예전 Ctrl+S 리스너의 가드: 저장 불가한 탭이면 preventDefault 없이 흘려보냈다.
      return Boolean(
        selectedFileTab &&
          ["markdown", "html", "text"].includes(selectedFileTab.category) &&
          !selectedFileTab.truncated &&
          selectedFileTab.encoding === "utf8",
      );
    default:
      return true;
  }
};
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/renderer/src/App.test.tsx src/renderer/src/TerminalPane.test.tsx && npm run typecheck`
Expected: PASS — 신규 4개 + **기존 Ctrl+P·줌·F11·F12·Ctrl+S 테스트가 무수정으로 통과** (디스패처가 현행 동작을 정확히 재현한다는 증거)

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/TerminalPane.tsx
git commit -m "feat: dispatch keyboard shortcuts through the keymap"
```

---

### Task 11: 메뉴 단축키 표기를 키맵에서 파생

**Files:**
- Modify: `src/renderer/src/title-bar-menu.ts` (하드코딩 shortcut 문자열 제거)
- Modify: `src/renderer/src/App.tsx` (`buildTitleBarMenus` 호출에 keybindings 전달)
- Test: `src/renderer/src/title-bar-menu.test.ts`

**Interfaces:**
- Consumes: Task 9 `effectiveAccelerator`, Task 7 `appSettings.keybindings`
- Produces: `buildTitleBarMenus(context: TitleBarMenuContext, keybindings: Record<string, string | null> = {}): TitleBarMenu[]` — 두 번째 인자가 옵션이라 기존 테스트·호출부는 그대로 컴파일된다. 리매핑하면 메뉴 표기가 따라온다.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/src/title-bar-menu.test.ts` (Task 6의 `settingsButtonContext` 재사용):

```ts
function findItem(menus: ReturnType<typeof buildTitleBarMenus>, menuId: string, itemId: string) {
  const menu = menus.find((candidate) => candidate.id === menuId)!;
  const entry = menu.entries.find((candidate) => candidate.kind === "item" && candidate.id === itemId);
  return entry && entry.kind === "item" ? entry : undefined;
}

it("단축키 표기가 키맵 기본값에서 나온다 — 세션 새로고침은 F5를 얻는다", () => {
  const menus = buildTitleBarMenus({ ...settingsButtonContext, session: { status: "working", tool: false, refreshing: false } });
  expect(findItem(menus, "view", "view.quick-open")?.shortcut).toBe("Ctrl+P");
  expect(findItem(menus, "file", "file.save")?.shortcut).toBe("Ctrl+S");
  expect(findItem(menus, "view", "view.zoom-in")?.shortcut).toBe("Ctrl+=");
  expect(findItem(menus, "session", "session.refresh")?.shortcut).toBe("F5");
  expect(findItem(menus, "view", "view.reload")?.shortcut).toBeUndefined();
  expect(findItem(menus, "edit", "edit.paste")?.shortcut).toBe("Ctrl+V");
});

it("리매핑과 해제가 메뉴 표기에 반영된다", () => {
  const menus = buildTitleBarMenus(
    { ...settingsButtonContext, session: { status: "working", tool: false, refreshing: false } },
    { "view.quick-open": "Ctrl+K", "session.refresh": null },
  );
  expect(findItem(menus, "view", "view.quick-open")?.shortcut).toBe("Ctrl+K");
  expect(findItem(menus, "session", "session.refresh")?.shortcut).toBeUndefined();
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/renderer/src/title-bar-menu.test.ts`
Expected: FAIL — `session.refresh`에 shortcut 없음 / 두 번째 인자 미지원

- [ ] **Step 3: 구현**

**(a) `src/renderer/src/title-bar-menu.ts`**:

```ts
import { effectiveAccelerator } from "./keymap"; // 상단

export function buildTitleBarMenus(
  context: TitleBarMenuContext,
  keybindings: Record<string, string | null> = {},
): TitleBarMenu[] {
  const shortcutFor = (actionId: string): string | undefined =>
    effectiveAccelerator(actionId, keybindings) ?? undefined;
  // ...
}
```

본문의 하드코딩 표기를 전부 교체한다:
- `file.save`: `{ shortcut: shortcutFor("file.save"), disabled: !context.canSaveFile }`
- `edit.copy`/`edit.paste`/`edit.select-all`: `shortcut: shortcutFor("edit.copy")` 등 (fixed라 값은 오늘과 동일)
- `view.quick-open`, `view.zoom-in`, `view.zoom-out`, `view.zoom-reset`, `view.full-screen`, `view.dev-tools`: 각각 `shortcutFor(해당 id)`
- `session.refresh`: `{ shortcut: shortcutFor("session.refresh"), disabled: !session || session.refreshing }` — F5가 새로 표기된다
- `view.reload`: `{ shortcut: shortcutFor("view.reload") }` — 기본 null이라 표기 없음, 사용자가 키를 주면 나타난다

`item()` 헬퍼(:51)는 `shortcut`이 undefined면 생략하므로 그대로 동작한다.

**(b) `src/renderer/src/App.tsx`** — `buildTitleBarMenus(` 호출부를 찾아 두 번째 인자로 `appSettings.keybindings`를 전달한다. useMemo로 감싸져 있으면 deps에 `appSettings.keybindings`를 추가한다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/renderer/src/title-bar-menu.test.ts src/renderer/src/App.test.tsx`
Expected: PASS — 신규 2개 + 기존 전부 (기존 테스트가 하드코딩 표기를 단정하고 있어도 값이 동일해 깨지지 않는다)

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- src/renderer/src/title-bar-menu.ts src/renderer/src/title-bar-menu.test.ts src/renderer/src/App.tsx
git commit -m "feat: derive menu shortcut labels from the keymap"
```

---

### Task 12: 단축키 탭 — 리매핑 편집 UI

**Files:**
- Modify: `src/renderer/src/SettingsDialog.tsx` (단축키 탭 본문)
- Modify: `src/renderer/src/index.css` (키 캡처 스타일)
- Test: `src/renderer/src/SettingsDialog.test.tsx`

**Interfaces:**
- Consumes: Task 9 `KEYMAP_ACTIONS`/`KEYMAP_CATEGORY_ORDER`/`normalizeKeyEvent`/`effectiveAccelerator`/`findConflict`/`isBindableAccelerator`, Task 3 `settings.update`(keybindings는 **전체 교체** 패치)
- Produces: 캡처 중 `data-key-capture` 속성을 단 요소 — Task 10 디스패처의 전역 억제 신호. 오버라이드 저장 규칙: 기본값과 같으면 키 삭제, 다르면 `액션id → 키`, 해제는 `null`.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/src/SettingsDialog.test.tsx`에 추가:

```tsx
describe("단축키 탭", () => {
  function openKeybindings(settings = DEFAULT_SETTINGS) {
    render(<SettingsDialog settings={settings} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "단축키" }));
  }

  it("카테고리별 목록과 현재 키를 보여주고, 고정 액션에는 변경 버튼이 없다", () => {
    openKeybindings();
    expect(screen.getByText("빠른 열기")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+P")).toBeInTheDocument();
    expect(screen.getByText("슬롯 1 포커스")).toBeInTheDocument();
    const pasteRow = screen.getByText("붙여넣기").closest(".settings-key-row")!;
    expect(within(pasteRow).getByText("고정")).toBeInTheDocument();
    expect(within(pasteRow).queryByRole("button", { name: "키 변경" })).toBeNull();
  });

  it("키 캡처가 다음 입력을 오버라이드로 저장하고, 기본값 선택은 오버라이드를 지운다", async () => {
    openKeybindings();
    const row = screen.getByText("빠른 열기").closest(".settings-key-row")!;
    fireEvent.click(within(row).getByRole("button", { name: "키 변경" }));
    expect(document.querySelector("[data-key-capture]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ keybindings: { "view.quick-open": "Ctrl+K" } }));
  });

  it("수식어 없는 단독 문자는 거부하고 캡처를 유지한다", async () => {
    openKeybindings();
    const row = screen.getByText("빠른 열기").closest(".settings-key-row")!;
    fireEvent.click(within(row).getByRole("button", { name: "키 변경" }));
    fireEvent.keyDown(window, { key: "a" });
    expect(update).not.toHaveBeenCalled();
    expect(document.querySelector("[data-key-capture]")).not.toBeNull(); // 계속 캡처 중
  });

  it("충돌 시 기존 바인딩 해제를 물어보고, 확인하면 둘 다 반영한다", async () => {
    openKeybindings();
    const row = screen.getByText("세션 새로고침").closest(".settings-key-row")!;
    fireEvent.click(within(row).getByRole("button", { name: "키 변경" }));
    fireEvent.keyDown(window, { key: "p", ctrlKey: true }); // 빠른 열기의 Ctrl+P와 충돌
    expect(await screen.findByText(/빠른 열기/)).toBeInTheDocument(); // 충돌 안내
    fireEvent.click(screen.getByRole("button", { name: "기존 바인딩 해제" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        keybindings: { "session.refresh": "Ctrl+P", "view.quick-open": null },
      }),
    );
  });

  it("고정 키(Ctrl+V 등)와의 충돌은 거부한다", async () => {
    openKeybindings();
    const row = screen.getByText("세션 새로고침").closest(".settings-key-row")!;
    fireEvent.click(within(row).getByRole("button", { name: "키 변경" }));
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    expect(await screen.findByText(/고정 키/)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("모두 초기화는 빈 오버라이드 맵을 저장한다", async () => {
    openKeybindings({ ...DEFAULT_SETTINGS, keybindings: { "view.quick-open": "Ctrl+K" } });
    fireEvent.click(screen.getByRole("button", { name: "모두 초기화" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ keybindings: {} }));
  });
});
```

(`within`을 `@testing-library/react` import에 추가.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/renderer/src/SettingsDialog.test.tsx`
Expected: FAIL — 단축키 탭이 자리 표시 문구뿐

- [ ] **Step 3: 구현**

**(a) `src/renderer/src/SettingsDialog.tsx`** — import 추가:

```ts
import {
  KEYMAP_ACTIONS,
  KEYMAP_CATEGORY_ORDER,
  effectiveAccelerator,
  findConflict,
  isBindableAccelerator,
  normalizeKeyEvent,
  type KeymapAction,
} from "./keymap";
```

상태 추가:

```ts
const [capturingActionId, setCapturingActionId] = useState<string | null>(null);
const [captureNotice, setCaptureNotice] = useState<string | null>(null);
const [conflict, setConflict] = useState<{ actionId: string; accelerator: string; existing: KeymapAction } | null>(null);
```

오버라이드 저장 헬퍼 (컴포넌트 안):

```ts
/** 기본값과 같은 값은 오버라이드가 아니다 — 지워서 미래의 기본 키맵 변경을 따라가게 한다. */
const withBinding = (
  overrides: Record<string, string | null>,
  actionId: string,
  accelerator: string | null,
): Record<string, string | null> => {
  const catalog = KEYMAP_ACTIONS.find((candidate) => candidate.id === actionId);
  const next = { ...overrides };
  if (!catalog || accelerator === catalog.defaultAccelerator) delete next[actionId];
  else next[actionId] = accelerator;
  return next;
};

const applyBinding = (actionId: string, accelerator: string | null) => {
  update({ keybindings: withBinding(settings.keybindings, actionId, accelerator) });
};
```

캡처 effect (캡처 중에만 등록 — Task 10 디스패처는 `[data-key-capture]`를 보고 물러난다):

```ts
useEffect(() => {
  if (!capturingActionId) return;
  const handleKeyDown = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setCapturingActionId(null);
      setCaptureNotice(null);
      return;
    }
    const accelerator = normalizeKeyEvent(event);
    if (!accelerator) return; // 수식어 단독 — 계속 기다린다
    if (!isBindableAccelerator(accelerator)) {
      setCaptureNotice("수식어 없는 단독 키는 터미널 입력과 충돌합니다 (F1~F12 제외)");
      return; // 계속 캡처
    }
    const existing = findConflict(accelerator, settings.keybindings, capturingActionId);
    if (existing?.fixed) {
      setCaptureNotice(`${accelerator}는 ${existing.label}의 고정 키입니다`);
      return;
    }
    setCapturingActionId(null);
    setCaptureNotice(null);
    if (existing) {
      setConflict({ actionId: capturingActionId, accelerator, existing });
      return;
    }
    applyBinding(capturingActionId, accelerator);
  };
  window.addEventListener("keydown", handleKeyDown, { capture: true });
  return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
}, [capturingActionId, settings.keybindings]);
```

단축키 탭 본문 (자리 표시 문구 교체):

```tsx
{tab === "keybindings" ? (
  <>
    <h2>단축키</h2>
    <p className="settings-hint">키를 클릭해 새 조합을 누르세요. 수식어 없는 단독 키는 쓸 수 없습니다.</p>
    {KEYMAP_CATEGORY_ORDER.map((category) => (
      <section key={category}>
        <h3 className="settings-key-category">{category}</h3>
        {KEYMAP_ACTIONS.filter((candidate) => candidate.category === category).map((candidate) => {
          const accelerator = effectiveAccelerator(candidate.id, settings.keybindings);
          const capturing = capturingActionId === candidate.id;
          return (
            <div className="settings-row settings-key-row" key={candidate.id}>
              <span className="settings-key-label">{candidate.label}</span>
              <span className="settings-key-controls">
                <span
                  className={`settings-key ${capturing ? "capturing" : ""}`}
                  {...(capturing ? { "data-key-capture": "true" } : {})}
                >
                  {capturing ? "키를 누르세요…" : accelerator ?? "없음"}
                </span>
                {candidate.fixed ? (
                  <span className="settings-key-fixed">고정</span>
                ) : (
                  <>
                    <button type="button" onClick={() => { setCapturingActionId(candidate.id); setCaptureNotice(null); }}>
                      키 변경
                    </button>
                    <button
                      type="button"
                      disabled={settings.keybindings[candidate.id] === undefined}
                      onClick={() => applyBinding(candidate.id, candidate.defaultAccelerator)}
                    >
                      기본값으로
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </section>
    ))}
    {captureNotice ? <p className="settings-error" role="alert">{captureNotice}</p> : null}
    {conflict ? (
      <div className="settings-conflict" role="alertdialog" aria-label="단축키 충돌">
        <p>
          {conflict.accelerator}는 이미 &quot;{conflict.existing.label}&quot;이 사용합니다. 기존 바인딩을 해제할까요?
        </p>
        <div className="confirm-dialog-actions">
          <button type="button" onClick={() => setConflict(null)}>취소</button>
          <button
            type="button"
            onClick={() => {
              const cleared = withBinding(settings.keybindings, conflict.existing.id, null);
              update({ keybindings: withBinding(cleared, conflict.actionId, conflict.accelerator) });
              setConflict(null);
            }}
          >
            기존 바인딩 해제
          </button>
        </div>
      </div>
    ) : null}
    <div className="settings-row">
      <span />
      <button type="button" onClick={() => update({ keybindings: {} })}>모두 초기화</button>
    </div>
  </>
) : null}
```

주의(테스트와의 일치): "기존 바인딩 해제" 확인 시 결과 맵은 `{ "session.refresh": "Ctrl+P", "view.quick-open": null }`이다 — `withBinding(cleared, ...)`이 기본값 비교로 키를 지우지 않는지 확인한다. `view.quick-open`의 기본값은 `"Ctrl+P"`이고 새 값은 `null`이므로 남고, `session.refresh`의 기본값은 `"F5"`이고 새 값은 `"Ctrl+P"`이므로 남는다 — 일치.

**(b) `src/renderer/src/index.css`** — Task 7 블록 뒤에:

```css
.settings-key-category {
  margin: 14px 0 4px;
  color: var(--muted);
  font: var(--type-secondary);
}

.settings-key-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-key {
  min-width: 96px;
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--text);
  font-family: Consolas, monospace;
  font-size: 12px;
  text-align: center;
}

.settings-key.capturing {
  border-style: dashed;
  color: var(--muted);
}

.settings-key-fixed {
  color: var(--muted);
  font: var(--type-secondary);
}

.settings-key-controls button {
  padding: 3px 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: none;
  color: var(--text);
  font: var(--type-secondary);
  cursor: pointer;
}

.settings-key-controls button:disabled {
  color: var(--muted);
  cursor: default;
}

.settings-conflict {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface-raised);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/renderer/src/SettingsDialog.test.tsx && npm run typecheck`
Expected: PASS — 단축키 탭 6개 + 기존 4개

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- src/renderer/src/SettingsDialog.tsx src/renderer/src/SettingsDialog.test.tsx src/renderer/src/index.css
git commit -m "feat: add shortcut remapping to the settings dialog"
```

---

### Task 13: e2e와 최종 검증

**Files:**
- Modify: `e2e/desktop.spec.ts` (스모크 시나리오 1개 추가)

**Interfaces:**
- Consumes: Tasks 6~8 (설정 버튼 → 다이얼로그 → 폰트 크기 → 라이브 반영), e2e 파일의 기존 `openFolder()`/`launchApp()` 헬퍼와 단일 창 규약

- [ ] **Step 1: e2e 시나리오 작성** — `e2e/desktop.spec.ts` 끝의 테스트들 옆에 추가 (파일의 테스트 순서 규약에 따라, 창 상태를 바꾸는 테스트보다 뒤·종료 정리보다 앞에 둔다):

```ts
test("설정에서 바꾼 터미널 글꼴 크기가 살아있는 세션에 즉시 반영된다 @smoke", async () => {
  await openFolder();
  await expect(page.locator(".xterm")).toBeVisible();

  await page.getByRole("menuitem", { name: "설정" }).click();
  await expect(page.getByRole("dialog", { name: "설정" })).toBeVisible();
  await page.getByRole("button", { name: "터미널" }).click();
  await page.getByLabel("글꼴 크기").fill("20");

  // xterm(DOM 렌더러)은 폰트 크기를 .xterm-rows에 얹는다 — 재생성 없이 20px이 되어야 한다.
  await expect.poll(() => computedFontSize(".xterm-rows")).toBe("20px");

  // 되돌리고 닫는다 — 같은 창을 쓰는 뒤 테스트가 13px 전제를 잃지 않게.
  await page.getByLabel("글꼴 크기").fill("13");
  await expect.poll(() => computedFontSize(".xterm-rows")).toBe("13px");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "설정" })).toBeHidden();
});
```

(`.xterm-rows`가 폰트 크기를 들고 있지 않은 렌더러 구성이면 `.xterm` 하위에서 `font-size`가 걸리는 요소를 스크린샷·`page.evaluate`로 확인해 셀렉터만 바꾼다 — 단정 값 20px/13px은 유지.)

- [ ] **Step 2: 전체 단위·타입 검증**

Run: `npm test && npm run typecheck`
Expected: PASS — 전체 테스트(기존 91파일 + 신규 5파일) 무결

- [ ] **Step 3: e2e 스모크**

Run: `npm run test:e2e:smoke`
Expected: PASS — 기존 스모크 + 신규 1개

- [ ] **Step 4: 수동 확인 체크리스트** (개발 실행 `npm run dev`, 결과를 사용자에게 보고)

1. settings.json 없는 기동 → 모든 동작이 기존과 동일(터미널 폰트 13px, ✕ 트레이 상주, 알림 동작).
2. 설정 > 일반 > "창을 닫으면 트레이에 남기기" 끔 → ✕ 클릭 시 실제 종료.
3. 설정 > 알림 > 마스터 끔 → 다른 세션이 입력 대기가 되어도 데스크톱 알림 없음(사이드바 배지는 그대로).
4. Ctrl+1~9로 보이는 슬롯 포커스 이동, Ctrl+Tab 순환, F5 새로고침, Ctrl+,로 설정 열기.
5. 단축키 탭에서 빠른 열기를 Ctrl+K로 리매핑 → 보기 메뉴 표기가 Ctrl+K로 갱신, Ctrl+P는 무반응, Ctrl+K 동작.
6. userData/settings.json을 손으로 깨뜨린 뒤 재시작 → 기본값 기동(앱이 뜨는 데 지장 없음).
7. (패키징 빌드에서만 확인 가능) 업데이트 자동 확인 끔 → 시작 시 확인 생략, 도움말 > 업데이트 확인은 동작.

- [ ] **Step 5: 커밋** (사용자 지시가 있을 때만)

```bash
git add -- e2e/desktop.spec.ts
git commit -m "test: cover the settings font size change end to end"
```

---

## Self-Review 결과

**Spec coverage** — 스펙 각 절 ↔ 태스크 대응:
- 진입 3곳(타이틀바 버튼·Ctrl+,·Quick Open): Task 6 / Task 9~10 / Task 7 ✓
- 설정 창 4탭·즉시 적용·ESC/바깥 클릭: Task 7 + Task 12 ✓
- 일반(언어 저장만·트레이·자동 재개·업데이트 확인): Task 7 UI + Task 5 게이트 ✓
- 터미널 즉시 반영(폰트·크기·행간·스크롤백·커서): Task 7 UI + Task 8 ✓
- 알림(마스터·상태별, exited/error 신설·기본 꺼짐, 배지 불변): Task 4 + Task 7 ✓
- 기본 키맵 표(Ctrl+1~9, Ctrl+Tab/Shift+Tab, F5, Ctrl+,, 기존 키 전부): Task 9 카탈로그 테스트가 표 전체를 단정 ✓
- 저장(userData/settings.json, json-store 프로토콜, 관용 파서, 오버라이드만 저장): Tasks 1~2 ✓
- 게이트 4곳: Task 4(알림) + Task 5(닫기·업데이트·자동 재개) ✓
- 메뉴 표기 파생: Task 11 ✓ / 리매핑 UI(캡처·충돌·초기화·단독키 거부·fixed 표시): Task 12 ✓
- 검증 8항목: 1→Task 1·2, 2→Task 9, 3→Task 11, 4→Task 4(notification-policy는 무수정 유지가 스펙 요구라 컨트롤러 테스트로 대체), 5→Task 10, 6→Task 13, 7→Task 13, 8→Task 13 수동 ✓

**Placeholder scan** — Task 7의 단축키 탭 자리 표시 문구는 Task 12가 이 플랜 안에서 교체하므로 잔존 TBD가 아니다. 실제 파일의 지역 함수명(예: TerminalPane의 fit 함수, json-store 스펙 시그니처)에 대한 "실제 이름을 따른다" 주석 3곳은 코드 전체가 제시된 상태의 이름 맞춤 지시로, 내용 공백이 아니다.

**Type consistency** — `SettingsService.current()/update()`, `AppSettingsPatch`(keybindings 전체 교체), `NotifiableStatus`, `TerminalCommands.focus`, `TitleBarMenu.action`, `buildTitleBarMenus(context, keybindings?)`, `normalizeKeyEvent`/`effectiveAccelerator`/`resolveKeymap`/`findConflict`/`isBindableAccelerator`/`isTypingTarget` — 정의 태스크(1·2·6·9)와 사용 태스크(3·4·5·7·8·10·11·12)에서 동일 표기 확인 ✓. Task 12 충돌 해소 결과 맵이 Task 12 테스트 기대값과 일치함을 본문에서 교차 확인 ✓.
