import type { CreateTerminalInput, TerminalSessionView } from "../../shared/api-types";
import { promptAsTerminalInput } from "../../shared/fan-out";
import type {
  SessionIndicators,
  SessionProgress,
  StatusChip,
  StatusChipColor,
  TerminalEvent,
  TerminalStatus,
} from "../../shared/terminal-types";

/**
 * The five jk-coding-cli commands, expressed against a narrow gateway so they can be tested without
 * a coordinator. Token verification lives in the pipe server; everything here assumes the caller
 * already proved it runs inside an app-spawned session.
 */

const TERMINAL_STATUSES: readonly TerminalStatus[] = [
  "starting",
  "working",
  "awaiting-input",
  "awaiting-approval",
  "idle",
  "exited",
  "error",
];

const DEFAULT_WAIT_SECONDS = 120;
const MAX_WAIT_SECONDS = 1800;
const DEFAULT_READ_LINES = 100;
const MAX_READ_LINES = 2000;
/** Same default the renderer starts sessions at; the pane resizes it on first view. */
const SPAWN_COLS = 80;
const SPAWN_ROWS = 24;

export interface ControlRequest {
  token?: unknown;
  callerSessionId?: unknown;
  command?: unknown;
  args?: unknown;
}

export type ControlResponse = { ok: true; result: unknown } | { ok: false; error: string };

export interface ControlCommandContext {
  sessions(): TerminalSessionView[];
  write(sessionId: string, data: string): Promise<void>;
  /** The session's current scrollback — the coordinator's side-effect-free attach replay. */
  readReplay(sessionId: string): Promise<string>;
  /** Must not steal the user's selection: the runtime passes updateSelection false through. */
  create(input: CreateTerminalInput): Promise<TerminalSessionView>;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
  projectName(projectId: string): Promise<string | null>;
  /** The pane header's progress and chips — what `status` and `progress` change. */
  indicators(sessionId: string): SessionIndicators;
  setChip(sessionId: string, chip: StatusChip): void;
  clearChips(sessionId: string, key?: string): void;
  setProgress(sessionId: string, progress: SessionProgress | null): void;
}

class ControlCommandError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new ControlCommandError(`${label}이(가) 필요합니다.`);
  return value;
}

function canReadInput(session: TerminalSessionView): boolean {
  return session.pid !== null && session.status !== "exited" && session.status !== "error";
}

function requireSession(context: ControlCommandContext, sessionId: string): TerminalSessionView {
  const session = context.sessions().find((candidate) => candidate.id === sessionId);
  if (!session) throw new ControlCommandError(`알 수 없는 세션: ${sessionId} (jk-coding-cli list로 확인하세요)`);
  return session;
}

async function list(args: Record<string, unknown>, context: ControlCommandContext) {
  const projectFilter = args.projectId === undefined ? null : requireString(args.projectId, "projectId");
  const sessions = context
    .sessions()
    .filter((session) => projectFilter === null || session.projectId === projectFilter);
  const names = new Map<string, string | null>();
  for (const session of sessions) {
    if (session.projectId !== null && !names.has(session.projectId)) {
      names.set(session.projectId, await context.projectName(session.projectId));
    }
  }
  return {
    sessions: sessions.map((session) => ({
      id: session.id,
      kind: session.kind,
      status: session.status,
      projectId: session.projectId,
      projectName: session.projectId === null ? null : names.get(session.projectId) ?? null,
      ...(session.worktreeId !== undefined ? { worktreeId: session.worktreeId } : {}),
      name: session.name,
      title: session.title,
      cwd: session.cwd,
    })),
  };
}

async function send(args: Record<string, unknown>, callerSessionId: string | null, context: ControlCommandContext) {
  const sessionId = requireString(args.sessionId, "sessionId");
  const text = requireString(args.text, "text");
  if (callerSessionId !== null && callerSessionId === sessionId) {
    throw new ControlCommandError("자기 자신에게는 보낼 수 없습니다.");
  }
  const session = requireSession(context, sessionId);
  if (!canReadInput(session)) {
    throw new ControlCommandError(`세션이 입력을 받을 수 없습니다 (status: ${session.status}).`);
  }
  await context.write(sessionId, promptAsTerminalInput(text));
  return { sessionId };
}

async function read(args: Record<string, unknown>, context: ControlCommandContext) {
  const sessionId = requireString(args.sessionId, "sessionId");
  requireSession(context, sessionId);
  let lines = DEFAULT_READ_LINES;
  if (args.lines !== undefined) {
    if (typeof args.lines !== "number" || !Number.isInteger(args.lines) || args.lines < 1) {
      throw new ControlCommandError("lines는 1 이상의 정수여야 합니다.");
    }
    lines = Math.min(args.lines, MAX_READ_LINES);
  }
  const replay = await context.readReplay(sessionId);
  const text = replay.split(/\r?\n/).slice(-lines).join("\n");
  return { sessionId, text };
}

async function wait(args: Record<string, unknown>, context: ControlCommandContext) {
  const sessionId = requireString(args.sessionId, "sessionId");
  let target: TerminalStatus = "awaiting-input";
  if (args.status !== undefined) {
    const requested = requireString(args.status, "status");
    if (!TERMINAL_STATUSES.includes(requested as TerminalStatus)) {
      throw new ControlCommandError(`알 수 없는 상태: ${requested} (가능: ${TERMINAL_STATUSES.join(", ")})`);
    }
    target = requested as TerminalStatus;
  }
  let timeoutSeconds = DEFAULT_WAIT_SECONDS;
  if (args.timeoutSeconds !== undefined) {
    if (typeof args.timeoutSeconds !== "number" || !Number.isFinite(args.timeoutSeconds) || args.timeoutSeconds <= 0) {
      throw new ControlCommandError("timeout은 양수(초)여야 합니다.");
    }
    timeoutSeconds = Math.min(args.timeoutSeconds, MAX_WAIT_SECONDS);
  }
  // A session that terminates ends the wait too — the caller reads the status it actually reached
  // instead of hanging on a state that can no longer happen.
  const settles = (status: TerminalStatus): boolean =>
    status === target || status === "exited" || status === "error";
  const current = requireSession(context, sessionId);
  if (settles(current.status)) return { sessionId, status: current.status };
  const status = await new Promise<TerminalStatus>((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new ControlCommandError(`시간 초과(${timeoutSeconds}초): 세션이 ${target} 상태가 되지 않았습니다.`));
    }, timeoutSeconds * 1000);
    timer.unref?.();
    unsubscribe = context.onEvent((event) => {
      if (!("sessionId" in event) || event.sessionId !== sessionId) return;
      const reached = event.type === "exit" ? "exited" : event.type === "status" ? event.status : null;
      if (reached === null || !settles(reached)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(reached);
    });
  });
  return { sessionId, status };
}

async function spawn(args: Record<string, unknown>, context: ControlCommandContext) {
  const input: CreateTerminalInput = {
    projectId: requireString(args.projectId, "projectId"),
    kind: requireString(args.kind, "agent"),
    ...(args.worktreeId !== undefined ? { worktreeId: requireString(args.worktreeId, "worktreeId") } : {}),
    cols: SPAWN_COLS,
    rows: SPAWN_ROWS,
  };
  const session = await context.create(input);
  return { sessionId: session.id, projectId: session.projectId, kind: session.kind };
}

const MAX_CHIPS = 8;
const MAX_CHIP_TEXT = 40;
const CHIP_KEY = /^[A-Za-z0-9._-]{1,24}$/;
const CHIP_COLORS: readonly StatusChipColor[] = ["green", "amber", "red", "blue", "gray"];
const PROGRESS_STATES: readonly SessionProgress["state"][] = ["normal", "indeterminate", "error", "warning"];

/** `--session`, or the session the command runs in; it must still be running. */
function indicatorTarget(args: Record<string, unknown>, caller: string | null, context: ControlCommandContext): string {
  const sessionId = args.sessionId === undefined ? caller : requireString(args.sessionId, "sessionId");
  if (!sessionId) throw new ControlCommandError("앱 세션 밖에서는 --session <id>로 대상을 지정하세요.");
  const session = requireSession(context, sessionId);
  if (!canReadInput(session)) throw new ControlCommandError(`세션이 실행 중이 아닙니다: ${session.id} (${session.status})`);
  return session.id;
}

function status(args: Record<string, unknown>, caller: string | null, context: ControlCommandContext) {
  const sessionId = indicatorTarget(args, caller, context);
  if (args.action === "clear") {
    const key = args.key === undefined ? undefined : requireString(args.key, "key");
    context.clearChips(sessionId, key);
    return { sessionId };
  }
  if (args.action !== "set") throw new ControlCommandError("status: set 또는 clear를 지정하세요.");
  const key = requireString(args.key, "key");
  if (!CHIP_KEY.test(key)) throw new ControlCommandError("key는 영문·숫자·._- 로 24자까지입니다.");
  // Control characters would let a chip smuggle escape sequences into the header's text.
  const clean = requireString(args.text, "텍스트").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!clean) throw new ControlCommandError("텍스트가 비어 있습니다.");
  const text = clean.length > MAX_CHIP_TEXT ? `${clean.slice(0, MAX_CHIP_TEXT - 1)}…` : clean;
  const color = args.color === undefined ? "blue" : args.color;
  if (!CHIP_COLORS.includes(color as StatusChipColor)) {
    throw new ControlCommandError(`색은 ${CHIP_COLORS.join(", ")} 중 하나입니다.`);
  }
  const chips = context.indicators(sessionId).chips;
  if (chips.length >= MAX_CHIPS && !chips.some((chip) => chip.key === key)) {
    throw new ControlCommandError(`칩은 세션마다 ${MAX_CHIPS}개까지입니다. jk status clear로 정리하세요.`);
  }
  context.setChip(sessionId, { key, text, color: color as StatusChipColor });
  return { sessionId };
}

function progress(args: Record<string, unknown>, caller: string | null, context: ControlCommandContext) {
  const sessionId = indicatorTarget(args, caller, context);
  if (args.clear === true) {
    context.setProgress(sessionId, null);
    return { sessionId };
  }
  const state = args.state === undefined ? "normal" : args.state;
  if (!PROGRESS_STATES.includes(state as SessionProgress["state"])) {
    throw new ControlCommandError(`상태는 ${PROGRESS_STATES.join(", ")} 중 하나입니다.`);
  }
  let value: number | null = null;
  if (args.value !== undefined && args.value !== null) {
    if (typeof args.value !== "number" || !Number.isInteger(args.value) || args.value < 0 || args.value > 100) {
      throw new ControlCommandError("진행률은 0~100 사이의 정수입니다.");
    }
    value = args.value;
  }
  if (state === "normal" && value === null) throw new ControlCommandError("진행률 값(0~100)이 필요합니다.");
  context.setProgress(sessionId, {
    state: state as SessionProgress["state"],
    value: state === "indeterminate" ? null : value,
  });
  return { sessionId };
}

export async function handleControlCommand(
  request: ControlRequest,
  context: ControlCommandContext,
): Promise<ControlResponse> {
  try {
    const command = typeof request.command === "string" ? request.command : "";
    const args = isRecord(request.args) ? request.args : {};
    const caller = typeof request.callerSessionId === "string" ? request.callerSessionId : null;
    switch (command) {
      case "list":
        return { ok: true, result: await list(args, context) };
      case "send":
        return { ok: true, result: await send(args, caller, context) };
      case "read":
        return { ok: true, result: await read(args, context) };
      case "wait":
        return { ok: true, result: await wait(args, context) };
      case "spawn":
        return { ok: true, result: await spawn(args, context) };
      case "status":
        return { ok: true, result: status(args, caller, context) };
      case "progress":
        return { ok: true, result: progress(args, caller, context) };
      default:
        throw new ControlCommandError(`알 수 없는 명령: ${command || "(비어 있음)"}`);
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
