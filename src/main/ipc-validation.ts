import path from "node:path";
import type {
  CreateTerminalInput,
  CreateToolTerminalInput,
  GitCommitRequest,
  HtmlPreviewBounds,
  ProjectMetadataPatch,
  ResumeTerminalInput,
  SlotViewsInput,
  WindowZoomAction,
} from "../shared/api-types";
import {
  MAX_FAN_OUT_TEMPLATES,
  MAX_FAN_OUT_TEMPLATE_NAME_LENGTH,
  MAX_FAN_OUT_TEMPLATE_TEXT_LENGTH,
  REMOTE_PORT_RANGE,
  TERMINAL_FONT_SIZE_RANGE,
  TERMINAL_LINE_HEIGHT_RANGE,
  TERMINAL_SCROLLBACK_RANGE,
  type AppSettingsPatch,
  type FileOpenTarget,
  type NotifiableStatus,
  type ProjectCategorySetting,
} from "../shared/settings-types";
import { ACCENT_COLOR_COUNT } from "../shared/accent-palette";
import type { FileExplorerTarget } from "../shared/file-explorer-types";
import type {
  PullRequestListQuery,
  PullRequestReviewAnnotationInput,
  PullRequestReviewFinishRequest,
} from "../shared/github-types";
import type { RemoteHostAddInput } from "../shared/remote-types";
import type { ProjectRegistryV1, SharedProject } from "../shared/project-types";
import type { WorkProjectRole } from "../shared/work-project-types";
import type { WorktreeCreateRequest } from "../shared/worktree-types";
import type { ToolCommand } from "../shared/terminal-types";
import { AGENT_ID_PATTERN } from "../shared/agent-types";
import type { WorkProjectMetadataUpdate } from "./projects/work-project-service";

/**
 * 렌더러가 보낸 IPC 인자를 검사해 main이 믿고 쓸 수 있는 값으로 바꾼다. 모양이 틀리면 던진다 —
 * 렌더러가 무엇을 보내든 서비스까지 날것으로 가지 않는다.
 */

const TOOL_COMMANDS: readonly ToolCommand[] = ["claude-update", "codex-update"];
export const WINDOW_ZOOM_ACTIONS: readonly WindowZoomAction[] = ["in", "out", "reset"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function exactObject(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.join(", ")}`);
  return value;
}

export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

export function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  return value as number;
}

/**
 * The saved grids as they cross the bridge. Shape only — whether a slot's session still exists is
 * the coordinator's business, and the layout id belongs to a catalog only the renderer has.
 */
export function slotViewsInput(value: unknown, label = "Slot views"): SlotViewsInput {
  if (typeof value !== "object" || value === null) throw new Error(`${label} must be an object`);
  const { folderViews, workspace, hiddenPanes } = value as Record<string, unknown>;
  if (typeof folderViews !== "object" || folderViews === null || Array.isArray(folderViews)) {
    throw new Error(`${label} folderViews must be an object`);
  }
  const view = (candidate: unknown, viewLabel: string) => {
    if (typeof candidate !== "object" || candidate === null) throw new Error(`${viewLabel} must be an object`);
    const { layoutId, slots } = candidate as Record<string, unknown>;
    if (!Array.isArray(slots)) throw new Error(`${viewLabel} slots must be an array`);
    return {
      layoutId: nonEmptyString(layoutId, `${viewLabel} layoutId`),
      slots: slots.map((slot, index) =>
        slot === null ? null : nonEmptyString(slot, `${viewLabel} slots[${index}]`),
      ),
    };
  };
  return {
    folderViews: Object.fromEntries(
      Object.entries(folderViews).map(([projectId, entry]) => [
        nonEmptyString(projectId, `${label} folderViews key`),
        view(entry, `${label} folderViews.${projectId}`),
      ]),
    ),
    workspace: view(workspace, `${label} workspace`),
    hiddenPanes: view(hiddenPanes, `${label} hiddenPanes`),
  };
}

/**
 * The renderer names an agent; it never spells out an executable. Only the shape of the id is
 * checked here — whether an agent by that name exists is the registry's answer to give, and it comes
 * back as "Unknown agent" from the coordinator.
 */
export function validateCreateInput(value: unknown): CreateTerminalInput {
  const input = exactObject(
    value,
    ["projectId", "kind", "worktreeId", "cols", "rows", "background"],
    "Terminal create input",
  );
  if (typeof input.kind !== "string" || !AGENT_ID_PATTERN.test(input.kind)) {
    throw new Error("Terminal kind is invalid");
  }
  if (input.worktreeId !== undefined && (typeof input.worktreeId !== "string" || input.worktreeId.length === 0)) {
    throw new Error("Worktree id is invalid");
  }
  if (input.background !== undefined && typeof input.background !== "boolean") {
    throw new Error("Terminal background flag must be a boolean");
  }
  return {
    projectId: nonEmptyString(input.projectId, "Project id"),
    kind: input.kind,
    ...(input.worktreeId !== undefined ? { worktreeId: input.worktreeId } : {}),
    cols: integer(input.cols, "Terminal columns"),
    rows: integer(input.rows, "Terminal rows"),
    ...(input.background !== undefined ? { background: input.background } : {}),
  };
}

/**
 * Maintenance sessions run a command the renderer never spells out: it may only name one of the
 * commands below, and the main process maps the name to the actual shell command.
 */
export function validateCreateToolInput(value: unknown): CreateToolTerminalInput {
  const input = exactObject(value, ["tool", "cols", "rows"], "Tool session input");
  if (!TOOL_COMMANDS.includes(input.tool as ToolCommand)) throw new Error("Tool command is invalid");
  return {
    tool: input.tool as ToolCommand,
    cols: integer(input.cols, "Terminal columns"),
    rows: integer(input.rows, "Terminal rows"),
  };
}

export function validateResumeInput(value: unknown): ResumeTerminalInput {
  const input = exactObject(value, ["sessionId", "cols", "rows"], "Terminal resume input");
  return {
    sessionId: nonEmptyString(input.sessionId, "Session id"),
    cols: integer(input.cols, "Terminal columns"),
    rows: integer(input.rows, "Terminal rows"),
  };
}

export function validateProjectPatch(value: unknown): ProjectMetadataPatch {
  const patch = exactObject(
    value,
    ["displayName", "status", "memo", "tracks", "hidden", "order"],
    "Project metadata patch",
  );
  return patch as ProjectMetadataPatch;
}

export function validateWorkProjectPatch(value: unknown): WorkProjectMetadataUpdate {
  const patch = exactObject(
    value,
    ["name", "category", "status", "memo", "notionLinks", "localFolders", "order"],
    "Work project patch",
  );
  return patch as WorkProjectMetadataUpdate;
}

export function memberRole(value: unknown): WorkProjectRole {
  if (value !== "repo" && value !== "docs") throw new Error("Member role must be 'repo' or 'docs'");
  return value;
}

export function validateFileExplorerTarget(value: unknown): FileExplorerTarget {
  const target = exactObject(value, ["kind", "id"], "File explorer target");
  if (target.kind !== "project" && target.kind !== "worktree") {
    throw new Error("File explorer target kind must be 'project' or 'worktree'");
  }
  return { kind: target.kind, id: nonEmptyString(target.id, "File explorer target id") };
}

export function validateWorktreeCreateRequest(value: unknown): WorktreeCreateRequest {
  if (!isRecord(value)) throw new Error("Worktree create request must be an object");
  if (value.kind === "new") {
    const input = exactObject(value, ["kind", "branch", "startPoint"], "New worktree request");
    return {
      kind: "new",
      branch: nonEmptyString(input.branch, "Branch name"),
      startPoint: nonEmptyString(input.startPoint, "Start point"),
    };
  }
  if (value.kind === "local") {
    const input = exactObject(value, ["kind", "branch"], "Local worktree request");
    return { kind: "local", branch: nonEmptyString(input.branch, "Branch name") };
  }
  if (value.kind === "remote") {
    const input = exactObject(value, ["kind", "remoteRef", "localBranch"], "Remote worktree request");
    return {
      kind: "remote",
      remoteRef: nonEmptyString(input.remoteRef, "Remote ref"),
      localBranch: nonEmptyString(input.localBranch, "Local branch"),
    };
  }
  throw new Error("Worktree create request kind is invalid");
}

/** relativePath may legitimately be "" (the target's root), unlike every other string field here. */
export function relativePathString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Relative path must be a string");
  return value;
}

/** A path as a session printed it — never trusted, only resolved under the session's own root. */
export function terminalPathString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024 || value.includes("\0")) {
    throw new Error("Terminal path must be a non-empty string of at most 1024 characters");
  }
  return value;
}

/** Where VS Code should put the cursor; absent opens the file at the top. */
export function validateEditorPosition(value: unknown): { line: number; column: number } | undefined {
  if (value === undefined || value === null) return undefined;
  const input = exactObject(value, ["line", "column"], "Editor position");
  const valid = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 10_000_000;
  if (!valid(input.line) || !valid(input.column)) throw new Error("Editor position must be 1-based integers");
  return { line: input.line as number, column: input.column as number };
}

/** The renderer only ever raises this flag after its own confirmation modal was accepted. */
export function validateOpenEntryOptions(value: unknown): { confirmedRun: boolean } {
  const input = exactObject(value, ["confirmedRun"], "Open entry options");
  if (input.confirmedRun !== undefined && typeof input.confirmedRun !== "boolean") {
    throw new Error("confirmedRun must be a boolean");
  }
  return { confirmedRun: input.confirmedRun === true };
}

export function validateViewBounds(value: unknown): HtmlPreviewBounds {
  const bounds = exactObject(value, ["x", "y", "width", "height"], "View bounds");
  const numeric = (input: unknown, label: string): number => {
    if (typeof input !== "number" || !Number.isFinite(input)) throw new Error(`${label} must be a finite number`);
    return input;
  };
  return {
    x: numeric(bounds.x, "x"),
    y: numeric(bounds.y, "y"),
    width: numeric(bounds.width, "width"),
    height: numeric(bounds.height, "height"),
  };
}

export function validateGitGraphPageOptions(value: unknown): { offset: number; limit: number } {
  const options = exactObject(value, ["offset", "limit"], "Git Graph page options");
  const offset = integer(options.offset, "Git Graph offset");
  const limit = integer(options.limit, "Git Graph limit");
  if (offset < 0) throw new Error("Git Graph offset must be non-negative");
  if (limit < 1 || limit > 500) throw new Error("Git Graph limit must be between 1 and 500");
  return { offset, limit };
}

export function validateGitCommitRequest(value: unknown): GitCommitRequest {
  const input = exactObject(value, ["summary", "description", "paths"], "Git commit input");
  if (typeof input.description !== "string") throw new Error("Commit description must be a string");
  if (!Array.isArray(input.paths) || input.paths.some((path) => typeof path !== "string" || path.length === 0)) {
    throw new Error("Commit paths must be non-empty strings");
  }
  return {
    summary: nonEmptyString(input.summary, "Commit summary"),
    description: input.description,
    paths: input.paths as string[],
  };
}

export function positiveInteger(value: unknown, label: string): number {
  const result = integer(value, label);
  if (result < 1) throw new Error(`${label} must be positive`);
  return result;
}

const NOTIFIABLE_STATUSES: readonly NotifiableStatus[] = ["awaiting-input", "awaiting-approval", "exited", "error"];

export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function numberInRange(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
  if (value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return value;
}

/** A session label as a file name: characters Windows forbids become "-", and it stays short. */
export function exportFileStem(label: string): string {
  const stem = label.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
  return stem.replace(/^[.\s-]+|[.\s-]+$/g, "") || "session";
}

export function exportTimestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function validateRemoteHostAdd(value: unknown): RemoteHostAddInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Remote host request must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.uri !== undefined) return { uri: nonEmptyString(raw.uri, "Pairing link") };
  return { address: nonEmptyString(raw.address, "Host address"), code: nonEmptyString(raw.code, "Pairing code") };
}

export function validateSettingsPatch(value: unknown): AppSettingsPatch {
  const raw = exactObject(
    value,
    ["language", "general", "terminal", "notifications", "keybindings", "projects", "files", "fanOut", "appearance", "remote"],
    "Settings patch",
  );
  const patch: AppSettingsPatch = {};
  if (raw.language !== undefined) {
    if (raw.language !== "ko" && raw.language !== "en") throw new Error('Settings language must be "ko" or "en"');
    patch.language = raw.language;
  }
  if (raw.general !== undefined) {
    const general = exactObject(
      raw.general,
      ["closeToTray", "autoResumeSessions", "autoCheckUpdates", "summonShortcut"],
      "Settings general",
    );
    patch.general = {};
    if (general.closeToTray !== undefined) patch.general.closeToTray = booleanValue(general.closeToTray, "Settings closeToTray");
    if (general.autoResumeSessions !== undefined) {
      patch.general.autoResumeSessions = booleanValue(general.autoResumeSessions, "Settings autoResumeSessions");
    }
    if (general.autoCheckUpdates !== undefined) {
      patch.general.autoCheckUpdates = booleanValue(general.autoCheckUpdates, "Settings autoCheckUpdates");
    }
    if (general.summonShortcut !== undefined) {
      const shortcut = general.summonShortcut;
      // A global key with no modifier would swallow that key in every other program.
      if (shortcut !== null && (typeof shortcut !== "string" || shortcut.length > 64 || !/^(?:(?:Ctrl|Alt|Shift|Super)\+)+[^+]+$/.test(shortcut) || !/(?:Ctrl|Alt|Super)\+/.test(shortcut))) {
        throw new Error("Settings summonShortcut must be a key with Ctrl, Alt or Super, or null");
      }
      patch.general.summonShortcut = shortcut;
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
    const notifications = exactObject(
      raw.notifications,
      ["desktop", "statuses", "quietHours", "snoozedUntil"],
      "Settings notifications",
    );
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
    if (notifications.quietHours !== undefined) {
      const quietHours = exactObject(notifications.quietHours, ["enabled", "start", "end"], "Settings quietHours");
      const clock = (value: unknown, label: string) => {
        if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
          throw new Error(`Settings quietHours.${label} must be HH:MM`);
        }
        return value;
      };
      patch.notifications.quietHours = {
        ...(quietHours.enabled !== undefined
          ? { enabled: booleanValue(quietHours.enabled, "Settings quietHours.enabled") }
          : {}),
        ...(quietHours.start !== undefined ? { start: clock(quietHours.start, "start") } : {}),
        ...(quietHours.end !== undefined ? { end: clock(quietHours.end, "end") } : {}),
      };
    }
    if (notifications.snoozedUntil !== undefined) {
      const until = notifications.snoozedUntil;
      if (until !== null && (typeof until !== "string" || !Number.isFinite(Date.parse(until)))) {
        throw new Error("Settings snoozedUntil must be an ISO timestamp or null");
      }
      patch.notifications.snoozedUntil = until;
    }
  }
  if (raw.files !== undefined) {
    const files = exactObject(raw.files, ["openWith", "unsupportedOpensWithOs"], "Settings files");
    patch.files = {};
    if (files.openWith !== undefined) {
      if (typeof files.openWith !== "object" || files.openWith === null || Array.isArray(files.openWith)) {
        throw new Error("Settings files.openWith must be an object");
      }
      const openWith: Record<string, FileOpenTarget> = {};
      for (const [extension, target] of Object.entries(files.openWith)) {
        if (!/^[a-z0-9]{1,16}$/.test(extension) || (target !== "in-app" && target !== "os" && target !== "vscode")) {
          throw new Error(`Settings files.openWith entry ${extension} is invalid`);
        }
        openWith[extension] = target;
      }
      patch.files.openWith = openWith;
    }
    if (files.unsupportedOpensWithOs !== undefined) {
      patch.files.unsupportedOpensWithOs = booleanValue(files.unsupportedOpensWithOs, "Settings files.unsupportedOpensWithOs");
    }
  }
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
  if (raw.appearance !== undefined) {
    const appearance = exactObject(raw.appearance, ["theme"], "Settings appearance");
    if (appearance.theme !== undefined) {
      if (appearance.theme !== "dark" && appearance.theme !== "light" && appearance.theme !== "system") {
        throw new Error("Settings appearance.theme must be dark, light, or system");
      }
      patch.appearance = { theme: appearance.theme };
    }
  }
  if (raw.fanOut !== undefined) {
    const fanOut = exactObject(raw.fanOut, ["templates"], "Settings fanOut");
    if (fanOut.templates !== undefined) {
      if (!Array.isArray(fanOut.templates) || fanOut.templates.length > MAX_FAN_OUT_TEMPLATES) {
        throw new Error(`Settings fanOut.templates must be an array of at most ${MAX_FAN_OUT_TEMPLATES}`);
      }
      patch.fanOut = {
        templates: fanOut.templates.map((item, index) => {
          const template = exactObject(item, ["name", "text"], `Settings fanOut.templates[${index}]`);
          const name = nonEmptyString(template.name, `Settings fanOut.templates[${index}].name`).trim();
          const text = nonEmptyString(template.text, `Settings fanOut.templates[${index}].text`);
          if (name.length > MAX_FAN_OUT_TEMPLATE_NAME_LENGTH || text.length > MAX_FAN_OUT_TEMPLATE_TEXT_LENGTH) {
            throw new Error(`Settings fanOut.templates[${index}] is too long`);
          }
          return { name, text };
        }),
      };
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
  if (raw.projects !== undefined) {
    // IPC는 엄격하다(exactObject·nonEmptyString) — 파서가 고쳐 주는 것(공백 정리, 잘못된 색
    // 순환 기본값)과 게이트웨이가 애초에 받아 주는 것은 다른 문제라, 여기서는 모양이 어긋나면
    // 바로 던지고 정규화는 하지 않는다.
    const projects = exactObject(raw.projects, ["categories", "defaultCategory"], "Settings projects");
    patch.projects = {};
    if (projects.categories !== undefined) {
      if (!Array.isArray(projects.categories)) throw new Error("Settings projects.categories must be an array");
      patch.projects.categories = projects.categories.map((item, index): ProjectCategorySetting => {
        const category = exactObject(item, ["name", "color"], `Settings projects.categories[${index}]`);
        const color = integer(category.color, `Settings projects.categories[${index}].color`);
        if (color < 1 || color > ACCENT_COLOR_COUNT) {
          throw new Error(`Settings projects.categories[${index}].color must be between 1 and ${ACCENT_COLOR_COUNT}`);
        }
        return { name: nonEmptyString(category.name, `Settings projects.categories[${index}].name`), color };
      });
    }
    if (projects.defaultCategory !== undefined) {
      patch.projects.defaultCategory = nonEmptyString(projects.defaultCategory, "Settings projects.defaultCategory");
    }
  }
  return patch;
}

export function validatePullRequestQuery(value: unknown): PullRequestListQuery {
  const query = exactObject(value, ["state", "reviewRequested", "search", "cursor", "refresh"], "Pull request query");
  if (!["open", "merged", "closed", "all"].includes(String(query.state))) throw new Error("Pull request state is invalid");
  if (typeof query.reviewRequested !== "boolean" || typeof query.search !== "string") throw new Error("Pull request filters are invalid");
  if (query.cursor !== undefined && (!Number.isInteger(query.cursor) || (query.cursor as number) < 0)) throw new Error("Pull request cursor is invalid");
  if (query.refresh !== undefined && typeof query.refresh !== "boolean") throw new Error("Pull request refresh is invalid");
  return {
    state: query.state as PullRequestListQuery["state"], reviewRequested: query.reviewRequested, search: query.search,
    ...(query.cursor !== undefined ? { cursor: query.cursor as number } : {}),
    ...(query.refresh !== undefined ? { refresh: query.refresh } : {}),
  };
}

export function validateReviewFinishRequest(value: unknown): PullRequestReviewFinishRequest {
  const request = exactObject(value, ["allowUnverifiedReview", "discardChanges"], "Review finish request");
  if (typeof request.allowUnverifiedReview !== "boolean" || typeof request.discardChanges !== "boolean") {
    throw new Error("Review finish flags must be boolean");
  }
  return { allowUnverifiedReview: request.allowUnverifiedReview, discardChanges: request.discardChanges };
}

export function validateReviewAnnotationInput(value: unknown): PullRequestReviewAnnotationInput {
  const input = exactObject(value, ["id", "headSha", "path", "side", "line", "lineText", "body"], "Review annotation");
  if (input.id !== undefined) nonEmptyString(input.id, "Annotation id");
  if (input.side !== "LEFT" && input.side !== "RIGHT") throw new Error("Annotation side is invalid");
  if (typeof input.lineText !== "string" || typeof input.body !== "string") throw new Error("Annotation text must be strings");
  return {
    ...(input.id !== undefined ? { id: input.id as string } : {}),
    headSha: nonEmptyString(input.headSha, "Annotation head SHA"),
    path: nonEmptyString(input.path, "Annotation path"),
    side: input.side,
    line: positiveInteger(input.line, "Annotation line"),
    lineText: input.lineText,
    body: input.body,
  };
}

export function externalUrl(value: unknown): string {
  const raw = nonEmptyString(value, "URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs may be opened");
  return url.toString();
}

export function selectedProject(registry: ProjectRegistryV1, projectId: string): SharedProject {
  const project = registry.projects[projectId];
  if (!project) throw new Error(`Project not found after update: ${projectId}`);
  return project;
}

export function projectForPath(registry: ProjectRegistryV1, rootPath: string): SharedProject {
  const project = Object.values(registry.projects).find(
    (candidate) => path.resolve(candidate.rootPath).toLocaleLowerCase("en-US") === path.resolve(rootPath).toLocaleLowerCase("en-US"),
  );
  if (!project) throw new Error(`Project not found after folder registration: ${rootPath}`);
  return project;
}
