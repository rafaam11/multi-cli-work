/**
 * User preferences persisted to userData/settings.json. Every default mirrors a literal that used
 * to be hardcoded, so a boot without the file is indistinguishable from the app before settings
 * existed. The parser is lenient by design: unknown fields are dropped and out-of-range or
 * mistyped values fall back per field, which makes adding and removing fields safe without a
 * version number or migration code.
 */
import { ACCENT_COLOR_COUNT } from "./accent-palette";
import { isDriveKind, type DriveKind } from "./drive-kind";
import {
  DEFAULT_FOLDER_TEMPLATES,
  FOLDER_TEMPLATE_ID_PATTERN,
  MAX_FOLDER_TEMPLATE_ENTRIES,
  MAX_FOLDER_TEMPLATE_NAME_LENGTH,
  MAX_FOLDER_TEMPLATES,
  folderTemplatePathError,
  legacyTemplateIdForCode,
  normalizeFolderTemplatePath,
  type ProjectFolderTemplate,
} from "./folder-template";

/** TerminalStatus values a desktop notification can be raised for. */
export type NotifiableStatus = "awaiting-input" | "awaiting-approval" | "exited" | "error";

export interface GeneralSettings {
  /** ✕가 앱을 종료하는 대신 트레이에 남긴다. */
  closeToTray: boolean;
  /** 시작 후 첫 attach가 interrupted 세션을 자동 재개한다. */
  autoResumeSessions: boolean;
  /** 시작 시 업데이트 자동 확인. 꺼도 도움말 > 업데이트 확인은 동작한다. */
  autoCheckUpdates: boolean;
  /** 트레이에 있을 때도 창을 불러오는 시스템 전역 단축키(예: "Ctrl+Alt+M"). null이면 없다. */
  summonShortcut: string | null;
  /** 세션이 보고하는 진행률(OSC 9;4, jk progress)을 작업표시줄 아이콘에도 띄운다. */
  taskbarProgress: boolean;
  /** OS 설정과 별개로 앱 애니메이션을 줄인다. OS가 줄이라고 하면 이 값과 무관하게 줄인다. */
  reduceMotion: boolean;
  /** Claude·Codex 세션에 jk(세션 제어·팀 보드)를 MCP 도구로 붙인다. 새로 시작하는 세션부터 적용된다. */
  jkMcp: boolean;
  /**
   * 업무 프로젝트의 Claude·Codex 세션을 띄울 때 그 프로젝트 레포를 fast-forward로 최신화하고 요약을 브리프에
   * 싣는다(최대 3초 대기). 꺼도 업무 프로젝트 화면의 "모든 레포 최신화" 버튼은 동작한다.
   */
  repoSyncOnSessionStart: boolean;
}

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  scrollback: number;
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
}

/** 매일 반복되는 방해 금지 시간대. 시각은 로컬 "HH:MM"이고, start > end면 자정을 넘는다. */
export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
}

export interface NotificationSettings {
  /** 마스터 토글 — 꺼지면 상태별 토글과 무관하게 데스크톱 알림이 나가지 않는다. */
  desktop: boolean;
  statuses: Record<NotifiableStatus, boolean>;
  quietHours: QuietHours;
  /** 트레이·설정의 "1시간 끄기"가 정한 해제 시각(ISO). 지나면 저절로 풀린다. */
  snoozedUntil: string | null;
}

export interface ProjectCategorySetting {
  name: string;
  /** 팔레트 인덱스 1..ACCENT_COLOR_COUNT — 색이 아니라 인덱스인 것은 테마가 색을 정하기 때문. */
  color: number;
  /**
   * 구분 코드 — 대문자 한 글자(A–Z). 업무 프로젝트·드라이브 최상위 폴더 이름의 접두어
   * (`R_DOTORI`)로 쓰여, 알파벳순 정렬이 곧 구분 순서가 되게 한다. 없으면 접두어 규칙을 쓰지 않는다.
   */
  code?: string;
  /** 드라이브 폴더를 만들 때 기본으로 고를 폴더 템플릿 id. 없으면 템플릿 없이 만든다. */
  templateId?: string;
}

export interface ProjectSettings {
  categories: ProjectCategorySetting[];
  /** 항상 categories 안의 이름이다(파서가 보장). */
  defaultCategory: string;
  folderTemplates: ProjectFolderTemplate[];
}

/**
 * 이 PC의 루트 폴더 지정값. null이면 자동 탐지(`pc-roots-detect.ts`)를 따른다 — 3대 PC가
 * `C:\dev`·`D:\dev`처럼 서로 달라서 프로필로 옮기지 않는 유일한 PC 전용 설정이다.
 */
export interface PcRootsSettings {
  dev: string | null;
  data: string | null;
  work: string | null;
  /** Google Drive "내 드라이브" 폴더(예: `G:\내 드라이브`). */
  drive: string | null;
}

export const PC_ROOT_KEYS = ["dev", "data", "work", "drive"] as const;
export type PcRootKey = (typeof PC_ROOT_KEYS)[number];

/** 확장자별 기본 열기 대상. */
export type FileOpenTarget = "in-app" | "os" | "vscode";

export interface FileSettings {
  /** 확장자별 지정이 없을 때 탐색기·터미널 링크가 파일을 여는 곳. */
  defaultOpenWith: FileOpenTarget;
  /** 확장자(소문자, 점 없음) → 기본 열기 대상. 없으면 `defaultOpenWith`를 따른다. */
  openWith: Record<string, FileOpenTarget>;
  /** 인앱으로 열 때 미리보기가 불가능한 파일을 OS 연결 프로그램으로 넘긴다. */
  unsupportedOpensWithOs: boolean;
}

export function isFileOpenTarget(value: unknown): value is FileOpenTarget {
  return value === "in-app" || value === "os" || value === "vscode";
}

/** 확장자별 지정이 우선하고, 없으면 `fallback`(기본: 설정의 기본 열기 대상)을 쓴다. */
export function resolveFileOpenTarget(
  files: FileSettings,
  extension: string | null | undefined,
  fallback: FileOpenTarget = files.defaultOpenWith,
): FileOpenTarget {
  return files.openWith[extension ?? ""] ?? fallback;
}

/** 팬아웃 대화상자에서 다시 불러 쓰는 프롬프트 한 벌. */
export interface FanOutTemplate {
  name: string;
  text: string;
}

export interface FanOutSettings {
  templates: FanOutTemplate[];
}

export const MAX_FAN_OUT_TEMPLATES = 30;
export const MAX_FAN_OUT_TEMPLATE_NAME_LENGTH = 40;
export const MAX_FAN_OUT_TEMPLATE_TEXT_LENGTH = 8_000;

/** "system" follows the OS light/dark setting and changes with it. */
export type ThemePreference = "dark" | "light" | "system";

export interface AppearanceSettings {
  theme: ThemePreference;
}

export interface RemoteSettings {
  /** 모바일 연결 서버를 켠다. 켜도 Tailscale 주소가 없으면 listen하지 않는다. */
  enabled: boolean;
  port: number;
}

export const DEFAULT_REMOTE_PORT = 47821;
export const REMOTE_PORT_RANGE = { min: 1024, max: 65535 } as const;

/** Claude·Codex 구독 사용량 게이지(타이틀바). */
export interface UsageSettings {
  enabled: boolean;
  /** 5시간·주간 한도가 90%를 넘으면 한 번 알린다. */
  notifyAt90: boolean;
}

export interface AppSettings {
  /** 지금은 선택 저장만 한다 — i18n 도입은 별도 작업. */
  language: "ko" | "en";
  general: GeneralSettings;
  terminal: TerminalSettings;
  notifications: NotificationSettings;
  /** 액션 id → 기본값과 다른 키(해제는 null). 기본 키맵이 바뀌면 안 건드린 액션은 새 기본값을 따른다. */
  keybindings: Record<string, string | null>;
  /** 업무 프로젝트 구분(카테고리) 목록과 기본 구분. */
  projects: ProjectSettings;
  files: FileSettings;
  fanOut: FanOutSettings;
  appearance: AppearanceSettings;
  remote: RemoteSettings;
  usage: UsageSettings;
  pcRoots: PcRootsSettings;
  /** 이 PC 문서 루트의 종류(아이콘·이름). null이면 경로로 짐작한다. pcRoots처럼 PC마다 다르다. */
  driveKind: DriveKind | null;
}

export interface AppSettingsPatch {
  language?: AppSettings["language"];
  general?: Partial<GeneralSettings>;
  terminal?: Partial<TerminalSettings>;
  notifications?: {
    desktop?: boolean;
    statuses?: Partial<Record<NotifiableStatus, boolean>>;
    quietHours?: Partial<QuietHours>;
    snoozedUntil?: string | null;
  };
  /** 전체 교체 — 리매핑 UI는 항상 완전한 오버라이드 맵을 보낸다. 부분 병합이면 해제가 불가능하다. */
  keybindings?: Record<string, string | null>;
  /** categories·folderTemplates는 통째 교체 — 삭제·순서 변경은 부분 병합으로 표현할 수 없다. */
  projects?: { categories?: ProjectCategorySetting[]; defaultCategory?: string; folderTemplates?: ProjectFolderTemplate[] };
  /** `openWith`은 전체 교체 — keybindings와 같은 이유로, 부분 병합이면 항목 삭제가 불가능하다. */
  files?: { defaultOpenWith?: FileOpenTarget; openWith?: Record<string, FileOpenTarget>; unsupportedOpensWithOs?: boolean };
  /** 템플릿 목록은 통째 교체 — 삭제·순서 변경을 부분 병합으로 표현할 수 없다. */
  fanOut?: { templates?: FanOutTemplate[] };
  appearance?: Partial<AppearanceSettings>;
  remote?: Partial<RemoteSettings>;
  usage?: Partial<UsageSettings>;
  pcRoots?: Partial<PcRootsSettings>;
  driveKind?: DriveKind | null;
}

export const TERMINAL_FONT_SIZE_RANGE = { min: 8, max: 32 } as const;
export const TERMINAL_LINE_HEIGHT_RANGE = { min: 1, max: 2 } as const;
export const TERMINAL_SCROLLBACK_RANGE = { min: 1_000, max: 100_000 } as const;
export const MAX_CATEGORY_NAME_LENGTH = 32;
export const CATEGORY_CODE_PATTERN = /^[A-Z]$/;
const MAX_ROOT_PATH_LENGTH = 1024;

/** 범용 4종 — 색은 서로 달라야 목록에서 구분이 되고, "기타"가 기본인 것은 분류를 미룰 탈출구가 있어야 하기 때문. */
export const DEFAULT_PROJECT_CATEGORIES: readonly ProjectCategorySetting[] = [
  { name: "업무", color: 1 },
  { name: "개인", color: 4 },
  { name: "연구", color: 3 },
  { name: "기타", color: 5 },
];

/** 기본 폴더 템플릿의 깊은 사본 — 설정 객체가 상수를 공유하면 한쪽 편집이 상수를 바꾼다. */
export function defaultFolderTemplates(): ProjectFolderTemplate[] {
  return DEFAULT_FOLDER_TEMPLATES.map((template) => ({ ...template, folders: [...template.folders] }));
}

const MAX_ACCELERATOR_LENGTH = 64;
const FILE_OPEN_WITH_EXTENSION_PATTERN = /^[a-z0-9]{1,16}$/;
const MAX_FILE_OPEN_WITH_ENTRIES = 200;

export const DEFAULT_SETTINGS: AppSettings = {
  language: "ko",
  general: { closeToTray: true, autoResumeSessions: true, autoCheckUpdates: true, summonShortcut: null, taskbarProgress: true, reduceMotion: false, jkMcp: true, repoSyncOnSessionStart: true },
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
    quietHours: { enabled: false, start: "22:00", end: "08:00" },
    snoozedUntil: null,
  },
  keybindings: {},
  projects: { categories: [...DEFAULT_PROJECT_CATEGORIES], defaultCategory: "기타", folderTemplates: defaultFolderTemplates() },
  files: { defaultOpenWith: "os", openWith: {}, unsupportedOpensWithOs: true },
  fanOut: { templates: [] },
  appearance: { theme: "dark" },
  remote: { enabled: false, port: DEFAULT_REMOTE_PORT },
  usage: { enabled: true, notifyAt90: true },
  pcRoots: { dev: null, data: null, work: null, drive: null },
  driveKind: null,
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

const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function readClock(value: unknown, fallback: string): string {
  return typeof value === "string" && CLOCK_PATTERN.test(value) ? value : fallback;
}

function minutesOf(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * 데스크톱 알림을 지금 삼킬지. 일시 중지가 남아 있거나 방해 금지 시간대 안이면 true — 배지와
 * 트레이 표시는 이 판정과 무관하게 계속 선다. 시작과 끝이 같은 시간대는 비어 있는 것으로 본다.
 */
export function notificationsMuted(notifications: NotificationSettings, now: Date): boolean {
  if (notifications.snoozedUntil !== null && Date.parse(notifications.snoozedUntil) > now.getTime()) return true;
  const { enabled, start, end } = notifications.quietHours;
  if (!enabled) return false;
  const from = minutesOf(start);
  const to = minutesOf(end);
  if (from === to) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return from < to ? current >= from && current < to : current >= from || current < to;
}

function readNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

/**
 * `projects` 섹션 전체가 없으면(구버전 파일) `defaults`를 그대로 쓴다 — 있으면 필드별로 정리한다.
 * defaultCategory에는 "이 값"이라 부를 고정 기본값이 없다: 구분 목록 자체가 사용자 정의라, 지워진
 * 기본 구분을 대신할 것은 남은 목록의 첫 항목뿐이다(규칙 ⑤). 그래서 categories가 통째로 사라진
 * 경우에만 defaults를 쓰고, 그 외에는 항상 "남은 목록의 첫 항목"으로 떨어진다.
 *
 * folderTemplates 필드가 아예 없으면 템플릿이 생기기 전 파일이다 — 기본 템플릿을 넣고, 구분마다
 * 코드로 기본 템플릿을 정해 준다(`legacyTemplateIdForCode`). 필드가 있으면(빈 배열이라도) 사용자가
 * 고른 값이므로 그대로 두고, 없는 템플릿을 가리키는 templateId만 버린다.
 */
function readProjectSettings(raw: unknown, defaults: ProjectSettings): ProjectSettings {
  if (!isRecord(raw)) return defaults;

  const storedTemplates = readFolderTemplates(raw.folderTemplates);
  const folderTemplates = storedTemplates ?? defaultFolderTemplates();
  const templateIds = new Set(folderTemplates.map((template) => template.id));

  let categories: ProjectCategorySetting[];
  if (Array.isArray(raw.categories)) {
    const seen = new Set<string>();
    const seenCodes = new Set<string>();
    categories = [];
    for (const item of raw.categories) {
      if (!isRecord(item) || typeof item.name !== "string") continue;
      const name = item.name.trim().slice(0, MAX_CATEGORY_NAME_LENGTH);
      if (name.length === 0 || seen.has(name)) continue;
      seen.add(name);
      const rawCode = typeof item.code === "string" ? item.code.trim().toUpperCase() : "";
      const code = CATEGORY_CODE_PATTERN.test(rawCode) && !seenCodes.has(rawCode) ? rawCode : undefined;
      if (code !== undefined) seenCodes.add(code);
      const color =
        typeof item.color === "number" &&
        Number.isInteger(item.color) &&
        item.color >= 1 &&
        item.color <= ACCENT_COLOR_COUNT
          ? item.color
          : (categories.length % ACCENT_COLOR_COUNT) + 1;
      const templateId =
        storedTemplates === null
          ? legacyTemplateIdForCode(code)
          : typeof item.templateId === "string" && templateIds.has(item.templateId)
            ? item.templateId
            : undefined;
      categories.push({
        name,
        color,
        ...(code !== undefined ? { code } : {}),
        ...(templateId !== undefined ? { templateId } : {}),
      });
    }
    if (categories.length === 0) categories = [...DEFAULT_PROJECT_CATEGORIES];
  } else {
    categories = [...DEFAULT_PROJECT_CATEGORIES];
  }

  const rawDefault = typeof raw.defaultCategory === "string" ? raw.defaultCategory.trim() : "";
  const defaultCategory = categories.some((category) => category.name === rawDefault)
    ? rawDefault
    : categories[0]!.name;

  return { categories, defaultCategory, folderTemplates };
}

/**
 * 배열이 아니면 null(필드 없음 — 구버전). id가 잘못됐거나 겹치는 항목, 이름이 빈 항목은 버리고,
 * 경로는 정리한 뒤 쓸 수 없는 것과 중복을 뺀다.
 */
function readFolderTemplates(raw: unknown): ProjectFolderTemplate[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const templates: ProjectFolderTemplate[] = [];
  for (const item of raw) {
    if (templates.length >= MAX_FOLDER_TEMPLATES) break;
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") continue;
    if (!FOLDER_TEMPLATE_ID_PATTERN.test(item.id) || seen.has(item.id)) continue;
    const name = item.name.trim().slice(0, MAX_FOLDER_TEMPLATE_NAME_LENGTH);
    if (name.length === 0) continue;
    const folders: string[] = [];
    for (const entry of Array.isArray(item.folders) ? item.folders : []) {
      if (typeof entry !== "string" || folders.length >= MAX_FOLDER_TEMPLATE_ENTRIES) continue;
      const normalized = normalizeFolderTemplatePath(entry);
      if (folderTemplatePathError(normalized) === null && !folders.includes(normalized)) folders.push(normalized);
    }
    seen.add(item.id);
    templates.push({ id: item.id, name, folders });
  }
  return templates;
}

function readRootPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_ROOT_PATH_LENGTH ? trimmed : null;
}

/** 이름이 비었거나 겹치는 항목, 너무 긴 항목은 버린다 — 파일을 손으로 고쳐도 대화상자가 깨지지 않게. */
function readFanOutTemplates(raw: unknown): FanOutTemplate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const templates: FanOutTemplate[] = [];
  for (const item of raw) {
    if (templates.length >= MAX_FAN_OUT_TEMPLATES) break;
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.text !== "string") continue;
    const name = item.name.trim();
    if (name.length === 0 || name.length > MAX_FAN_OUT_TEMPLATE_NAME_LENGTH || seen.has(name)) continue;
    if (item.text.trim().length === 0 || item.text.length > MAX_FAN_OUT_TEMPLATE_TEXT_LENGTH) continue;
    seen.add(name);
    templates.push({ name, text: item.text });
  }
  return templates;
}

export function parseSettings(value: unknown): AppSettings {
  const raw = isRecord(value) ? value : {};
  const general = isRecord(raw.general) ? raw.general : {};
  const terminal = isRecord(raw.terminal) ? raw.terminal : {};
  const notifications = isRecord(raw.notifications) ? raw.notifications : {};
  const statuses = isRecord(notifications.statuses) ? notifications.statuses : {};
  const quietHours = isRecord(notifications.quietHours) ? notifications.quietHours : {};
  const usage = isRecord(raw.usage) ? raw.usage : {};
  const pcRoots = isRecord(raw.pcRoots) ? raw.pcRoots : {};

  const keybindings: Record<string, string | null> = {};
  if (isRecord(raw.keybindings)) {
    for (const [actionId, accelerator] of Object.entries(raw.keybindings)) {
      const valid =
        accelerator === null ||
        (typeof accelerator === "string" && accelerator.length > 0 && accelerator.length <= MAX_ACCELERATOR_LENGTH);
      if (valid) keybindings[actionId] = accelerator as string | null;
    }
  }

  const files = isRecord(raw.files) ? raw.files : {};
  const fanOut = isRecord(raw.fanOut) ? raw.fanOut : {};
  const appearance = isRecord(raw.appearance) ? raw.appearance : {};
  const remote = isRecord(raw.remote) ? raw.remote : {};
  const openWith: Record<string, FileOpenTarget> = {};
  if (isRecord(files.openWith)) {
    for (const [extension, target] of Object.entries(files.openWith)) {
      if (Object.keys(openWith).length >= MAX_FILE_OPEN_WITH_ENTRIES) break;
      const validKey = FILE_OPEN_WITH_EXTENSION_PATTERN.test(extension);
      if (validKey && isFileOpenTarget(target)) openWith[extension] = target;
    }
  }

  const defaults = DEFAULT_SETTINGS;
  return {
    language: raw.language === "en" ? "en" : "ko",
    general: {
      closeToTray: readBoolean(general.closeToTray, defaults.general.closeToTray),
      autoResumeSessions: readBoolean(general.autoResumeSessions, defaults.general.autoResumeSessions),
      autoCheckUpdates: readBoolean(general.autoCheckUpdates, defaults.general.autoCheckUpdates),
      taskbarProgress: readBoolean(general.taskbarProgress, defaults.general.taskbarProgress),
      jkMcp: readBoolean(general.jkMcp, defaults.general.jkMcp),
      repoSyncOnSessionStart: readBoolean(general.repoSyncOnSessionStart, defaults.general.repoSyncOnSessionStart),
      summonShortcut:
        typeof general.summonShortcut === "string" &&
        general.summonShortcut.length > 0 &&
        general.summonShortcut.length <= MAX_ACCELERATOR_LENGTH
          ? general.summonShortcut
          : null,
      reduceMotion: readBoolean(general.reduceMotion, defaults.general.reduceMotion),
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
      quietHours: {
        enabled: readBoolean(quietHours.enabled, defaults.notifications.quietHours.enabled),
        start: readClock(quietHours.start, defaults.notifications.quietHours.start),
        end: readClock(quietHours.end, defaults.notifications.quietHours.end),
      },
      snoozedUntil:
        typeof notifications.snoozedUntil === "string" && Number.isFinite(Date.parse(notifications.snoozedUntil))
          ? notifications.snoozedUntil
          : null,
    },
    keybindings,
    projects: readProjectSettings(raw.projects, defaults.projects),
    files: {
      defaultOpenWith: isFileOpenTarget(files.defaultOpenWith) ? files.defaultOpenWith : defaults.files.defaultOpenWith,
      openWith,
      unsupportedOpensWithOs: readBoolean(files.unsupportedOpensWithOs, defaults.files.unsupportedOpensWithOs),
    },
    fanOut: { templates: readFanOutTemplates(fanOut.templates) },
    appearance: {
      theme:
        appearance.theme === "light" || appearance.theme === "system" || appearance.theme === "dark"
          ? appearance.theme
          : defaults.appearance.theme,
    },
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
    usage: {
      enabled: readBoolean(usage.enabled, defaults.usage.enabled),
      notifyAt90: readBoolean(usage.notifyAt90, defaults.usage.notifyAt90),
    },
    pcRoots: {
      dev: readRootPath(pcRoots.dev),
      data: readRootPath(pcRoots.data),
      work: readRootPath(pcRoots.work),
      drive: readRootPath(pcRoots.drive),
    },
    driveKind: isDriveKind(raw.driveKind) ? raw.driveKind : null,
  };
}

/**
 * projects도 다른 필드처럼 얕은 병합이다 — categories가 오면 통째로 새 값이 되고, 정규화(빈 목록
 * 되돌리기, 색 범위 밖 값 고치기, 사라진 기본 구분 재계산)는 여기서 하지 않는다. `json-store`의
 * `updateJsonStore`가 이 함수의 결과에도 `parseSettings`를 돌려 쓰기 전에 정규화하므로, 디스크와
 * `current()` 캐시 둘 다 항상 정리된 값을 갖는다(settings-types.test.ts의 "patch로 지워진 기본
 * 구분은 write 경로의 파서가…" 케이스가 이 계약을 고정한다).
 */
export function mergeSettingsPatch(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  return {
    language: patch.language ?? current.language,
    general: { ...current.general, ...patch.general },
    terminal: { ...current.terminal, ...patch.terminal },
    notifications: {
      desktop: patch.notifications?.desktop ?? current.notifications.desktop,
      statuses: { ...current.notifications.statuses, ...patch.notifications?.statuses },
      quietHours: { ...current.notifications.quietHours, ...patch.notifications?.quietHours },
      snoozedUntil:
        patch.notifications?.snoozedUntil !== undefined
          ? patch.notifications.snoozedUntil
          : current.notifications.snoozedUntil,
    },
    keybindings: patch.keybindings ?? current.keybindings,
    projects: { ...current.projects, ...patch.projects },
    files: {
      defaultOpenWith: patch.files?.defaultOpenWith ?? current.files.defaultOpenWith,
      openWith: patch.files?.openWith ?? current.files.openWith,
      unsupportedOpensWithOs: patch.files?.unsupportedOpensWithOs ?? current.files.unsupportedOpensWithOs,
    },
    fanOut: { templates: patch.fanOut?.templates ?? current.fanOut.templates },
    appearance: { ...current.appearance, ...patch.appearance },
    remote: { ...current.remote, ...patch.remote },
    usage: { ...current.usage, ...patch.usage },
    pcRoots: { ...current.pcRoots, ...patch.pcRoots },
    driveKind: patch.driveKind !== undefined ? patch.driveKind : current.driveKind,
  };
}
