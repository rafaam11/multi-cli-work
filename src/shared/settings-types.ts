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
