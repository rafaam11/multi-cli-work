// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SharedProject } from "../../shared/project-types";
import type {
  TerminalAttachment,
  TerminalEvent,
  TerminalLaunchSpec,
  TerminalSession,
  TerminalWorkerEvent,
} from "../../shared/terminal-types";
import { readAppState, readSessionLog } from "../state/app-state";
import type { BuiltinAgentId } from "../../shared/agent-types";
import { BUILTIN_AGENTS } from "../agents/builtin-agents";
import { TerminalCoordinator, type TerminalWorkerGateway } from "./terminal-coordinator";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-coordinator-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

class FakeWorker implements TerminalWorkerGateway {
  readonly create = vi.fn(async (spec: TerminalLaunchSpec): Promise<TerminalSession> => ({
    id: spec.sessionId,
    projectId: spec.projectId,
    tool: spec.tool,
    kind: spec.kind,
    // The worker echoes the spec; titles are main's business and are merged in by the coordinator.
    cwd: spec.cwd,
    providerConversationId: spec.providerConversationId ?? null,
    status: "starting",
    pid: 123,
    createdAt: spec.createdAt,
    updatedAt: spec.createdAt,
    exitCode: null,
  }));
  readonly attach = vi.fn(async (sessionId: string): Promise<TerminalAttachment> => {
    throw new Error(`not running: ${sessionId}`);
  });
  readonly write = vi.fn(async () => undefined);
  readonly resize = vi.fn(async () => undefined);
  readonly stop = vi.fn(async () => undefined);
  private listener: (event: TerminalWorkerEvent) => void = () => undefined;
  private exitListener: (code: number) => void = () => undefined;

  onEvent(listener: (event: TerminalWorkerEvent) => void): () => void {
    this.listener = listener;
    return () => undefined;
  }

  onExit(listener: (code: number) => void): () => void {
    this.exitListener = listener;
    return () => undefined;
  }

  emit(event: TerminalWorkerEvent): void {
    this.listener(event);
  }

  emitWorkerExit(code: number): void {
    this.exitListener(code);
  }
}

const project: SharedProject = {
  id: "project-1",
  rootPath: "C:\\Work",
  displayName: "Work",
  sources: ["manual"],
  providerRefs: { claude: [], codex: [] },
  status: null,
  memo: "",
  tracks: [],
  hidden: false,
  order: null,
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
};

async function coordinator(
  root: string,
  worker = new FakeWorker(),
  codexSessions?: {
    snapshot(cwd: string): Promise<ReadonlySet<string>>;
    waitForNew(cwd: string, knownIds: ReadonlySet<string>, signal?: AbortSignal): Promise<string | null>;
  },
  appendLog?: (logDir: string, sessionId: string, data: string, maxBytes: number, trimSlackBytes?: number) => Promise<void>,
  statusDir?: string,
) {
  const instance = new TerminalCoordinator({
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
    codexSessions,
    appendLog,
    logFlushMs: 60_000,
    statusDir,
  });
  await instance.initialize();
  return { instance, worker };
}

describe("TerminalCoordinator", () => {
  it("resolves project and provider data in main before creating a worker session", async () => {
    const root = await tempRoot();
    const { instance, worker } = await coordinator(root);

    const session = await instance.create({ projectId: "project-1", kind: "claude", cols: 90, rows: 30 });

    expect(worker.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        cwd: "C:\\Work",
        executable: "claude.exe",
        args: [
          "--session-id",
          "session-1",
          "--settings",
          path.join(root, "claude-settings.json"),
          "--dangerously-skip-permissions",
        ],
        env: expect.objectContaining({ MULTI_CLI_WORK_SESSION_ID: "session-1" }),
      }),
    );
    expect(session).toMatchObject({ id: "session-1", providerConversationId: "session-1" });
    const stored = await readAppState({ statePath: path.join(root, "state.json") });
    expect(stored.state.sessions["session-1"].providerConversationId).toBe("session-1");
  });

  it("runs a maintenance session in the home directory with no folder attached", async () => {
    const root = await tempRoot();
    const getProject = vi.fn(async () => project);
    const worker = new FakeWorker();
    const instance = new TerminalCoordinator({
      worker,
      statePath: path.join(root, "state.json"),
      logDir: path.join(root, "logs"),
      claudeSettingsPath: path.join(root, "claude-settings.json"),
      getProject,
      getExecutables: async () => ({
        agents: { powershell: "powershell.exe", claude: "claude.exe", codex: "codex.cmd" },
        vscode: null,
      }),
      getAgent: (agentId) => BUILTIN_AGENTS[agentId as BuiltinAgentId] ?? null,
      toolSessionCwd: () => "C:\\Users\\me",
      env: {},
      idFactory: () => "session-tool",
      now: () => "2026-07-11T01:00:00.000Z",
      logFlushMs: 60_000,
    });
    await instance.initialize();

    const session = await instance.createTool({ tool: "claude-update", cols: 80, rows: 24 });

    expect(getProject).not.toHaveBeenCalled();
    expect(worker.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        tool: "claude-update",
        kind: "powershell",
        cwd: "C:\\Users\\me",
        executable: "powershell.exe",
        args: ["-NoLogo", "-NoExit", "-Command", "claude update"],
      }),
    );
    expect(session).toMatchObject({ projectId: null, tool: "claude-update" });

    // Resuming re-runs the update instead of falling back to a bare shell.
    worker.emit({ type: "exit", sessionId: "session-tool", exitCode: 0 });
    await instance.flush();
    await instance.resume({ sessionId: "session-tool", cols: 80, rows: 24 });

    expect(getProject).not.toHaveBeenCalled();
    expect(worker.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: ["-NoLogo", "-NoExit", "-Command", "claude update"], cwd: "C:\\Users\\me" }),
    );
  });

  it("picks up the provider's title, persists it, and tells the renderer", async () => {
    const root = await tempRoot();
    const worker = new FakeWorker();
    let providerTitle: string | null = null;
    const events: TerminalEvent[] = [];
    const instance = new TerminalCoordinator({
      worker,
      statePath: path.join(root, "state.json"),
      logDir: path.join(root, "logs"),
      claudeSettingsPath: path.join(root, "claude-settings.json"),
      getProject: async () => project,
      getExecutables: async () => ({
        agents: { powershell: "powershell.exe", claude: "claude.exe", codex: "codex.cmd" },
        vscode: null,
      }),
      getAgent: (agentId) => BUILTIN_AGENTS[agentId as BuiltinAgentId] ?? null,
      toolSessionCwd: () => "C:\\Users\\me",
      readTitle: async () => providerTitle,
      env: {},
      idFactory: () => "session-1",
      now: () => "2026-07-11T01:00:00.000Z",
      logFlushMs: 60_000,
    });
    await instance.initialize();
    instance.onEvent((event) => events.push(event));
    const created = await instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    expect(created.title).toBeNull();

    // Nothing to report yet: an empty read must not be mistaken for "the title went away".
    await instance.refreshTitles();
    expect(events.filter((event) => event.type === "title")).toHaveLength(0);

    providerTitle = "레지스트리 분리";
    await instance.refreshTitles();
    await instance.refreshTitles();

    expect(events.filter((event) => event.type === "title")).toEqual([
      { type: "title", sessionId: "session-1", title: "레지스트리 분리" },
    ]);
    const stored = await readAppState({ statePath: path.join(root, "state.json") });
    expect(stored.state.sessions["session-1"].title).toBe("레지스트리 분리");
  });

  it("keeps a user-given name across a title refresh and clears it on request", async () => {
    const root = await tempRoot();
    const worker = new FakeWorker();
    const instance = new TerminalCoordinator({
      worker,
      statePath: path.join(root, "state.json"),
      logDir: path.join(root, "logs"),
      claudeSettingsPath: path.join(root, "claude-settings.json"),
      getProject: async () => project,
      getExecutables: async () => ({
        agents: { powershell: "powershell.exe", claude: "claude.exe", codex: "codex.cmd" },
        vscode: null,
      }),
      getAgent: (agentId) => BUILTIN_AGENTS[agentId as BuiltinAgentId] ?? null,
      toolSessionCwd: () => "C:\\Users\\me",
      readTitle: async () => "프로바이더 제목",
      env: {},
      idFactory: () => "session-1",
      now: () => "2026-07-11T01:00:00.000Z",
      logFlushMs: 60_000,
    });
    await instance.initialize();
    await instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });

    const named = await instance.rename("session-1", "  내 이름  ");
    expect(named).toMatchObject({ name: "내 이름", title: null });

    await instance.refreshTitles();
    expect(instance.list()[0]).toMatchObject({ name: "내 이름", title: "프로바이더 제목" });

    const cleared = await instance.rename("session-1", "   ");
    expect(cleared.name).toBeNull();
    const stored = await readAppState({ statePath: path.join(root, "state.json") });
    expect(stored.state.sessions["session-1"]).toMatchObject({ name: null, title: "프로바이더 제목" });
  });

  it("removes every session of a folder so the folder can be unregistered", async () => {
    const root = await tempRoot();
    const worker = new FakeWorker();
    const ids = ["session-1", "session-2", "session-3"];
    const instance = new TerminalCoordinator({
      worker,
      statePath: path.join(root, "state.json"),
      logDir: path.join(root, "logs"),
      claudeSettingsPath: path.join(root, "claude-settings.json"),
      getProject: async (id) => (id === project.id ? project : { ...project, id: "project-2", rootPath: "C:\\Other" }),
      getExecutables: async () => ({
        agents: { powershell: "powershell.exe", claude: "claude.exe", codex: "codex.cmd" },
        vscode: null,
      }),
      getAgent: (agentId) => BUILTIN_AGENTS[agentId as BuiltinAgentId] ?? null,
      toolSessionCwd: () => "C:\\Users\\me",
      env: {},
      idFactory: () => ids.shift() ?? "session-x",
      now: () => "2026-07-11T01:00:00.000Z",
      logFlushMs: 60_000,
    });
    await instance.initialize();
    await instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });
    await instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    await instance.create({ projectId: "project-2", kind: "powershell", cols: 80, rows: 24 });

    await instance.removeProjectSessions("project-1");

    expect(worker.stop).toHaveBeenCalledTimes(2);
    expect(instance.list().map((session) => session.id)).toEqual(["session-3"]);
    const stored = await readAppState({ statePath: path.join(root, "state.json") });
    expect(Object.keys(stored.state.sessions)).toEqual(["session-3"]);
  });

  it("persists worker output and unified status for renderer refresh", async () => {
    const root = await tempRoot();
    const { instance, worker } = await coordinator(root);
    await instance.create({ projectId: "project-1", kind: "codex", cols: 80, rows: 24 });

    worker.emit({ type: "data", sessionId: "session-1", data: "hello\r\n", sequence: 1 });
    worker.emit({ type: "status", sessionId: "session-1", status: "awaiting-input" });
    await instance.flush();

    expect(instance.list()).toEqual([
      expect.objectContaining({ id: "session-1", status: "awaiting-input", pid: 123 }),
    ]);
    const attachment = await instance.attach("session-1");
    expect(attachment.replay).toContain("hello");
  });

  it("publishes output immediately and batches adjacent chunks into one log write", async () => {
    const root = await tempRoot();
    const appendLog = vi.fn(async () => undefined);
    const { instance, worker } = await coordinator(root, new FakeWorker(), undefined, appendLog);
    const received = vi.fn();
    instance.onEvent(received);
    await instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });

    worker.emit({ type: "data", sessionId: "session-1", data: "first", sequence: 1 });
    worker.emit({ type: "data", sessionId: "session-1", data: "second", sequence: 2 });

    // The launch itself announces the session, then output follows in arrival order.
    expect(received).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: "created", sessionId: "session-1" }),
    );
    expect(received).toHaveBeenNthCalledWith(2, {
      type: "data",
      sessionId: "session-1",
      data: "first",
      sequence: 1,
    });
    expect(received).toHaveBeenNthCalledWith(3, {
      type: "data",
      sessionId: "session-1",
      data: "second",
      sequence: 2,
    });
    expect(appendLog).not.toHaveBeenCalled();

    await instance.flush();

    expect(appendLog).toHaveBeenCalledOnce();
    expect(appendLog).toHaveBeenCalledWith(expect.any(String), "session-1", "firstsecond", 5 * 1024 * 1024, 256 * 1024);
  });

  it("continues processing status events after a subscriber throws", async () => {
    const root = await tempRoot();
    const { instance, worker } = await coordinator(root);
    await instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const subscriber = vi.fn(() => {
      if (subscriber.mock.calls.length === 1) throw new Error("renderer gone");
    });
    instance.onEvent(subscriber);

    worker.emit({ type: "status", sessionId: "session-1", status: "working" });
    worker.emit({ type: "status", sessionId: "session-1", status: "awaiting-input" });
    await instance.flush();

    expect(instance.list()[0].status).toBe("awaiting-input");
    expect(subscriber).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith("Terminal event subscriber failed", expect.any(Error));
    consoleError.mockRestore();
  });

  it("correlates a new Codex transcript and persists its resumable conversation id", async () => {
    const root = await tempRoot();
    const codexSessions = {
      snapshot: vi.fn(async () => new Set(["codex-existing"])),
      waitForNew: vi.fn(async () => "codex-created"),
    };
    const { instance } = await coordinator(root, new FakeWorker(), codexSessions);

    await instance.create({ projectId: "project-1", kind: "codex", cols: 80, rows: 24 });
    await instance.flush();

    expect(codexSessions.snapshot).toHaveBeenCalledWith("C:\\Work");
    expect(codexSessions.waitForNew).toHaveBeenCalledWith(
      "C:\\Work",
      new Set(["codex-existing"]),
      expect.any(AbortSignal),
    );
    expect(instance.list()[0].providerConversationId).toBe("codex-created");
    const stored = await readAppState({ statePath: path.join(root, "state.json") });
    expect(stored.state.sessions["session-1"].providerConversationId).toBe("codex-created");
  });

  it("restores saved tabs as exited and resumes the provider conversation explicitly", async () => {
    const root = await tempRoot();
    const first = await coordinator(root);
    await first.instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });

    const secondWorker = new FakeWorker();
    const second = await coordinator(root, secondWorker);
    expect(second.instance.list()[0]).toMatchObject({ status: "exited", pid: null });

    await second.instance.resume({ sessionId: "session-1", cols: 100, rows: 32 });

    expect(secondWorker.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        args: [
          "--resume",
          "session-1",
          "--settings",
          path.join(root, "claude-settings.json"),
          "--dangerously-skip-permissions",
        ],
      }),
    );
  });

  it("resumes a correlated Codex conversation without claiming a new transcript", async () => {
    const root = await tempRoot();
    const initialTracker = {
      snapshot: vi.fn(async () => new Set<string>()),
      waitForNew: vi.fn(async () => "codex-existing"),
    };
    const first = await coordinator(root, new FakeWorker(), initialTracker);
    await first.instance.create({ projectId: "project-1", kind: "codex", cols: 80, rows: 24 });
    await first.instance.flush();

    const resumeTracker = {
      snapshot: vi.fn(async () => new Set<string>()),
      waitForNew: vi.fn(async () => "codex-unexpected"),
    };
    const resumedWorker = new FakeWorker();
    const resumed = await coordinator(root, resumedWorker, resumeTracker);

    await resumed.instance.resume({ sessionId: "session-1", cols: 100, rows: 32 });

    expect(resumedWorker.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        args: expect.arrayContaining(["resume", "codex-existing", "-C", "C:\\Work"]),
        providerConversationId: "codex-existing",
      }),
    );
    expect(resumeTracker.snapshot).not.toHaveBeenCalled();
    expect(resumeTracker.waitForNew).not.toHaveBeenCalled();
  });

  it("resumes an uncorrelated Codex session as a fresh conversation and re-correlates", async () => {
    const root = await tempRoot();
    // The first run never correlates: the transcript poll comes back empty before shutdown.
    const neverCorrelated = {
      snapshot: vi.fn(async () => new Set<string>()),
      waitForNew: vi.fn(async () => null),
    };
    const first = await coordinator(root, new FakeWorker(), neverCorrelated);
    await first.instance.create({ projectId: "project-1", kind: "codex", cols: 80, rows: 24 });
    await first.instance.flush();
    expect(first.instance.list()[0].providerConversationId).toBeNull();

    const lateTracker = {
      snapshot: vi.fn(async () => new Set<string>()),
      waitForNew: vi.fn(async () => "codex-late"),
    };
    const resumedWorker = new FakeWorker();
    const resumed = await coordinator(root, resumedWorker, lateTracker);

    await resumed.instance.resume({ sessionId: "session-1", cols: 80, rows: 24 });
    await resumed.instance.flush();

    // No conversation id to resume, so it relaunches fresh instead of failing…
    expect(resumedWorker.create).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", providerConversationId: null }),
    );
    expect(resumedWorker.create.mock.calls[0][0].args).not.toContain("resume");
    // …and the new transcript is correlated like any fresh Codex session.
    expect(lateTracker.snapshot).toHaveBeenCalledWith("C:\\Work");
    expect(resumed.instance.list()[0].providerConversationId).toBe("codex-late");
  });

  it("exposes the persisted project and session selection after initialization", async () => {
    const root = await tempRoot();
    const first = await coordinator(root);
    await first.instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });

    const second = await coordinator(root);
    const snapshot = await second.instance.state();

    expect(snapshot.state).toMatchObject({
      selectedProjectId: "project-1",
      selectedSessionId: "session-1",
    });
    expect(snapshot.source).toBe("primary");
  });

  it("leaves the persisted selection untouched when a launch opts out of it", async () => {
    const root = await tempRoot();
    const { instance, worker } = await coordinator(root);
    await instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });
    worker.emit({ type: "exit", sessionId: "session-1", exitCode: 0 });
    await instance.flush();
    // The user has since moved their selection elsewhere; a background launch must not steal it.
    await instance.select(null, null);

    await instance.resume({ sessionId: "session-1", cols: 80, rows: 24 }, { updateSelection: false });
    let stored = await readAppState({ statePath: path.join(root, "state.json") });
    expect(stored.state).toMatchObject({ selectedProjectId: null, selectedSessionId: null });

    // The default keeps today's behavior: launching a session selects it.
    worker.emit({ type: "exit", sessionId: "session-1", exitCode: 0 });
    await instance.flush();
    await instance.resume({ sessionId: "session-1", cols: 80, rows: 24 });
    stored = await readAppState({ statePath: path.join(root, "state.json") });
    expect(stored.state).toMatchObject({ selectedProjectId: "project-1", selectedSessionId: "session-1" });
  });

  it("never forwards resize requests for exited or errored sessions", async () => {
    const root = await tempRoot();
    const first = await coordinator(root);
    await first.instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });

    const restoredWorker = new FakeWorker();
    const restored = await coordinator(root, restoredWorker);
    await restored.instance.resize("session-1", 100, 30);
    expect(restoredWorker.resize).not.toHaveBeenCalled();

    const activeWorker = new FakeWorker();
    const active = await coordinator(await tempRoot(), activeWorker);
    await active.instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });
    activeWorker.emit({ type: "status", sessionId: "session-1", status: "error" });
    await active.instance.flush();
    await active.instance.resize("session-1", 100, 30);
    expect(activeWorker.resize).not.toHaveBeenCalled();
  });

  it("accepts structured provider hook status without exposing it to renderer IPC", async () => {
    const root = await tempRoot();
    const { instance } = await coordinator(root);
    await instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });

    instance.applyProviderStatus("session-1", "awaiting-approval");
    await instance.flush();

    expect(instance.list()[0].status).toBe("awaiting-approval");
  });

  it("does not let provider hooks terminalize a live Claude PTY", async () => {
    const root = await tempRoot();
    const { instance, worker } = await coordinator(root);
    await instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });

    instance.applyProviderStatus("session-1", "error");
    await instance.flush();

    expect(instance.list()[0]).toMatchObject({ status: "starting", pid: 123 });
    expect(instance.hasActiveSessions()).toBe(true);

    await instance.shutdown();
    expect(worker.stop).toHaveBeenCalledWith("session-1");
  });

  it("ignores duplicate Claude statuses and provider hooks targeting PowerShell", async () => {
    const root = await tempRoot();
    const first = await coordinator(root);
    await first.instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    const received = vi.fn();
    first.instance.onEvent(received);

    first.instance.applyProviderStatus("session-1", "awaiting-input");
    first.instance.applyProviderStatus("session-1", "awaiting-input");
    await first.instance.flush();

    expect(received).toHaveBeenCalledOnce();

    const otherRoot = await tempRoot();
    const second = await coordinator(otherRoot);
    await second.instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });
    second.instance.applyProviderStatus("session-1", "awaiting-approval");
    await second.instance.flush();
    expect(second.instance.list()[0].status).toBe("starting");
  });

  it("does not recreate a removed session log from delayed worker output", async () => {
    const root = await tempRoot();
    const { instance, worker } = await coordinator(root);
    await instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });
    worker.emit({ type: "data", sessionId: "session-1", data: "before removal", sequence: 1 });

    await instance.remove("session-1");
    worker.emit({ type: "data", sessionId: "session-1", data: "late output", sequence: 2 });
    await instance.flush();

    expect(await readSessionLog(path.join(root, "logs"), "session-1", 1024)).toBe("");
  });

  it("ignores stale provider hook files for restored sessions without a running PTY", async () => {
    const root = await tempRoot();
    const first = await coordinator(root);
    await first.instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    const restored = await coordinator(root);

    restored.instance.applyProviderStatus("session-1", "awaiting-approval");
    await restored.instance.flush();

    expect(restored.instance.list()[0]).toMatchObject({ status: "exited", pid: null });
  });

  it("stops every running PTY during explicit app shutdown", async () => {
    const root = await tempRoot();
    const { instance, worker } = await coordinator(root);
    await instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });

    await instance.shutdown();

    expect(worker.stop).toHaveBeenCalledWith("session-1");
  });

  it("marks only live sessions as interrupted by shutdown, surviving the late exit event", async () => {
    const root = await tempRoot();
    const worker = new FakeWorker();
    const ids = ["session-live", "session-done"];
    const instance = new TerminalCoordinator({
      worker,
      statePath: path.join(root, "state.json"),
      logDir: path.join(root, "logs"),
      claudeSettingsPath: path.join(root, "claude-settings.json"),
      getProject: async () => project,
      getExecutables: async () => ({
        agents: { powershell: "powershell.exe", claude: "claude.exe", codex: "codex.cmd" },
        vscode: null,
      }),
      getAgent: (agentId) => BUILTIN_AGENTS[agentId as BuiltinAgentId] ?? null,
      toolSessionCwd: () => "C:\\Users\\me",
      env: {},
      idFactory: () => ids.shift() ?? "session-x",
      now: () => "2026-07-19T01:00:00.000Z",
      logFlushMs: 60_000,
    });
    await instance.initialize();
    await instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });
    await instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });
    // This one genuinely finished before the app quit — it must not be marked.
    worker.emit({ type: "exit", sessionId: "session-done", exitCode: 0 });
    await instance.flush();

    await instance.shutdown();
    // The PTY's exit event can land after the marking write; the marking must survive it.
    worker.emit({ type: "exit", sessionId: "session-live", exitCode: 0 });
    await instance.flush();

    const stored = await readAppState({ statePath: path.join(root, "state.json") });
    expect(stored.state.sessions["session-live"].interruptedByShutdown).toBe(true);
    expect(stored.state.sessions["session-done"].interruptedByShutdown).toBe(false);
  });

  it("auto-resumes an interrupted session on renderer attach, stitching old scrollback to the new PTY", async () => {
    const root = await tempRoot();
    const first = await coordinator(root);
    await first.instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    first.worker.emit({ type: "data", sessionId: "session-1", data: "old output\r\n", sequence: 1 });
    await first.instance.flush();
    await first.instance.shutdown();

    const secondWorker = new FakeWorker();
    secondWorker.attach.mockImplementation(async (sessionId: string) => ({
      session: {
        id: sessionId,
        projectId: "project-1",
        tool: null,
        kind: "claude",
        cwd: "C:\\Work",
        providerConversationId: "session-1",
        status: "working",
        pid: 321,
        createdAt: "2026-07-11T01:00:00.000Z",
        updatedAt: "2026-07-19T01:00:00.000Z",
        exitCode: null,
      } satisfies TerminalSession,
      replay: "fresh cli\r\n",
      sequence: 7,
    }));
    const second = await coordinator(root, secondWorker);
    // The user is looking at nothing in particular; a lazy resume must not select the session.
    await second.instance.select(null, null);

    const result = await second.instance.attachForRenderer("session-1");

    expect(secondWorker.create).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", args: expect.arrayContaining(["--resume", "session-1"]) }),
    );
    const oldAt = result.replay.indexOf("old output");
    const separatorAt = result.replay.indexOf("세션 재개됨");
    const freshAt = result.replay.indexOf("fresh cli");
    expect(oldAt).toBeGreaterThanOrEqual(0);
    expect(separatorAt).toBeGreaterThan(oldAt);
    expect(freshAt).toBeGreaterThan(separatorAt);
    expect(result).toMatchObject({ sequence: 7, session: { status: "working", pid: 321 } });

    const stored = await readAppState({ statePath: path.join(root, "state.json") });
    expect(stored.state.sessions["session-1"].interruptedByShutdown).toBe(false);
    expect(stored.state).toMatchObject({ selectedProjectId: null, selectedSessionId: null });
  });

  it("does not auto-resume sessions that exited on their own or died without a marking", async () => {
    const root = await tempRoot();
    const first = await coordinator(root);
    await first.instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    first.worker.emit({ type: "exit", sessionId: "session-1", exitCode: 0 });
    await first.instance.flush();
    await first.instance.shutdown();

    // Finished before shutdown: restored as plain exited.
    const second = await coordinator(root);
    await expect(second.instance.attachForRenderer("session-1")).resolves.toMatchObject({
      session: { status: "exited", pid: null },
      sequence: 0,
    });
    expect(second.worker.create).not.toHaveBeenCalled();

    // Crash: the app never got to mark anything, so nothing auto-resumes.
    const crashRoot = await tempRoot();
    const before = await coordinator(crashRoot);
    await before.instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    await before.instance.flush(); // the process dies here without shutdown()

    const after = await coordinator(crashRoot);
    await expect(after.instance.attachForRenderer("session-1")).resolves.toMatchObject({
      session: { status: "exited", pid: null },
    });
    expect(after.worker.create).not.toHaveBeenCalled();
  });

  it("coalesces simultaneous attaches from both panes into a single auto-resume", async () => {
    const root = await tempRoot();
    const first = await coordinator(root);
    await first.instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    await first.instance.shutdown();

    const secondWorker = new FakeWorker();
    secondWorker.attach.mockImplementation(async (sessionId: string) => ({
      session: {
        id: sessionId,
        projectId: "project-1",
        tool: null,
        kind: "claude",
        cwd: "C:\\Work",
        providerConversationId: "session-1",
        status: "working",
        pid: 321,
        createdAt: "2026-07-11T01:00:00.000Z",
        updatedAt: "2026-07-19T01:00:00.000Z",
        exitCode: null,
      } satisfies TerminalSession,
      replay: "",
      sequence: 1,
    }));
    const second = await coordinator(root, secondWorker);

    const [primary, split] = await Promise.all([
      second.instance.attachForRenderer("session-1"),
      second.instance.attachForRenderer("session-1"),
    ]);

    expect(secondWorker.create).toHaveBeenCalledTimes(1);
    expect(primary.session.pid).toBe(321);
    expect(split.session.pid).toBe(321);
  });

  it("falls back to the plain scrollback attach when the auto-resume itself fails", async () => {
    const root = await tempRoot();
    const first = await coordinator(root);
    await first.instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    first.worker.emit({ type: "data", sessionId: "session-1", data: "history\r\n", sequence: 1 });
    await first.instance.flush();
    await first.instance.shutdown();

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const brokenWorker = new FakeWorker();
    brokenWorker.create.mockRejectedValue(new Error("spawn failed"));
    const second = await coordinator(root, brokenWorker);

    const result = await second.instance.attachForRenderer("session-1");

    expect(result.session).toMatchObject({ status: "exited", pid: null });
    expect(result.replay).toContain("history");
    // The marking survives a failed attempt, so the next attach (or the manual button) retries.
    expect(second.instance.list()[0].interruptedByShutdown).toBe(true);
    expect(consoleError).toHaveBeenCalledWith("Lazy auto-resume failed", expect.any(Error));
    consoleError.mockRestore();
  });

  it("clears the shutdown marking once the session is resumed", async () => {
    const root = await tempRoot();
    const first = await coordinator(root);
    await first.instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    await first.instance.shutdown();

    const second = await coordinator(root);
    expect(second.instance.list()[0].interruptedByShutdown).toBe(true);

    await second.instance.resume({ sessionId: "session-1", cols: 80, rows: 24 });

    const stored = await readAppState({ statePath: path.join(root, "state.json") });
    expect(stored.state.sessions["session-1"].interruptedByShutdown).toBe(false);
  });

  it("aborts pending Codex correlation instead of delaying shutdown", async () => {
    const root = await tempRoot();
    let receivedSignal: AbortSignal | undefined;
    const codexSessions = {
      snapshot: vi.fn(async () => new Set<string>()),
      waitForNew: vi.fn(
        async (_cwd: string, _ids: ReadonlySet<string>, signal?: AbortSignal) =>
          new Promise<null>((resolve) => {
            receivedSignal = signal;
            signal?.addEventListener("abort", () => resolve(null), { once: true });
          }),
      ),
    };
    const { instance } = await coordinator(root, new FakeWorker(), codexSessions);
    await instance.create({ projectId: "project-1", kind: "codex", cols: 80, rows: 24 });

    await instance.shutdown();

    expect(receivedSignal?.aborted).toBe(true);
  });

  it("marks and broadcasts active sessions as errors when the utility process exits", async () => {
    const root = await tempRoot();
    const { instance, worker } = await coordinator(root);
    await instance.create({ projectId: "project-1", kind: "powershell", cols: 80, rows: 24 });
    const listener = vi.fn();
    instance.onEvent(listener);

    worker.emitWorkerExit(9);
    await instance.flush();

    expect(instance.list()[0]).toMatchObject({ status: "error", pid: null, exitCode: null });
    expect(listener).toHaveBeenCalledWith({ type: "status", sessionId: "session-1", status: "error" });
  });

  it("deletes the provider status file when a session is removed", async () => {
    const root = await tempRoot();
    const statusDir = await tempRoot();
    const { instance } = await coordinator(root, new FakeWorker(), undefined, undefined, statusDir);
    await instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    const statusFile = path.join(statusDir, "session-1.json");
    await fs.writeFile(statusFile, "{}");

    await instance.remove("session-1");

    await expect(fs.stat(statusFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("sweeps orphaned provider status files at startup but keeps restored sessions", async () => {
    const root = await tempRoot();
    const statusDir = await tempRoot();
    const first = await coordinator(root, new FakeWorker(), undefined, undefined, statusDir);
    await first.instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    const keptFile = path.join(statusDir, "session-1.json");
    const orphanFile = path.join(statusDir, "orphan-session.json");
    await fs.writeFile(keptFile, "{}");
    await fs.writeFile(orphanFile, "{}");

    await coordinator(root, new FakeWorker(), undefined, undefined, statusDir);

    await expect(fs.stat(keptFile)).resolves.toBeTruthy();
    await expect(fs.stat(orphanFile)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

/**
 * `agents.json` is the user's to edit, so an agent can disappear out from under a session that is
 * already on disk. Removing an agent must cost them that agent — not the sessions they ran with it.
 */
describe("an agent that is no longer installed", () => {
  it("refuses to start a session and says how to get the agent back", async () => {
    const root = await tempRoot();
    const { instance, worker } = await coordinator(root);

    await expect(instance.create({ projectId: "project-1", kind: "gemini", cols: 80, rows: 24 })).rejects.toThrow(
      /unknown agent: gemini.*agents\.json/i,
    );
    expect(worker.create).not.toHaveBeenCalled();
  });

  it("keeps its sessions listed and their scrollback readable", async () => {
    const root = await tempRoot();
    const before = await coordinator(root);
    await before.instance.create({ projectId: "project-1", kind: "claude", cols: 80, rows: 24 });
    await before.instance.flush();

    // The user reopens the app after deleting the agent from agents.json.
    const after = new TerminalCoordinator({
      worker: new FakeWorker(),
      statePath: path.join(root, "state.json"),
      logDir: path.join(root, "logs"),
      claudeSettingsPath: path.join(root, "claude-settings.json"),
      getProject: async (id) => (id === project.id ? project : null),
      getExecutables: async () => ({ agents: {}, vscode: null }),
      getAgent: () => null,
      toolSessionCwd: () => "C:\\Users\\me",
      env: {},
      idFactory: () => "session-2",
      now: () => "2026-07-11T02:00:00.000Z",
    });
    await after.initialize();

    expect(after.list().map((session) => session.kind)).toEqual(["claude"]);
    await expect(after.attach("session-1")).resolves.toMatchObject({ session: { id: "session-1" } });
    await expect(after.resume({ sessionId: "session-1", cols: 80, rows: 24 })).rejects.toThrow(/unknown agent/i);
  });
});

describe("worktree sessions", () => {
  const worktree = {
    id: "worktree-1",
    projectId: project.id,
    path: "C:\\Work-wt\\feature",
    branch: "feature",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };

  function worktreeCoordinator(root: string, options: { worktreeGone?: boolean } = {}) {
    let nextId = 0;
    const worker = new FakeWorker();
    const instance = new TerminalCoordinator({
      worker,
      statePath: path.join(root, "state.json"),
      logDir: path.join(root, "logs"),
      claudeSettingsPath: path.join(root, "claude-settings.json"),
      getProject: async (id) => (id === project.id ? project : null),
      getWorktree: async (id) => (!options.worktreeGone && id === worktree.id ? worktree : null),
      getExecutables: async () => ({
        agents: { powershell: "powershell.exe", claude: "claude.exe", codex: "codex.cmd" },
        vscode: null,
      }),
      getAgent: (agentId) => BUILTIN_AGENTS[agentId as BuiltinAgentId] ?? null,
      toolSessionCwd: () => "C:\\Users\\me",
      env: {},
      idFactory: () => `session-${++nextId}`,
      now: () => "2026-07-13T01:00:00.000Z",
    });
    return { instance, worker };
  }

  it("runs the session in the worktree directory and persists the binding", async () => {
    const root = await tempRoot();
    const { instance, worker } = worktreeCoordinator(root);
    await instance.initialize();

    const session = await instance.create({
      projectId: project.id,
      kind: "powershell",
      worktreeId: worktree.id,
      cols: 80,
      rows: 24,
    });

    expect(worker.create).toHaveBeenCalledWith(expect.objectContaining({ cwd: worktree.path }));
    expect(session.worktreeId).toBe(worktree.id);
    const stored = await readAppState({ statePath: path.join(root, "state.json") });
    expect(stored.state.sessions[session.id].worktreeId).toBe(worktree.id);
  });

  it("keeps root sessions' persisted shape unchanged — no worktreeId key at all", async () => {
    const root = await tempRoot();
    const { instance } = worktreeCoordinator(root);
    await instance.initialize();

    await instance.create({ projectId: project.id, kind: "powershell", cols: 80, rows: 24 });

    const raw = JSON.parse(await fs.readFile(path.join(root, "state.json"), "utf8"));
    expect(Object.keys(raw.sessions["session-1"])).not.toContain("worktreeId");
  });

  it("refuses to resume a session whose worktree is gone instead of landing in the wrong tree", async () => {
    const root = await tempRoot();
    const before = worktreeCoordinator(root);
    await before.instance.initialize();
    const session = await before.instance.create({
      projectId: project.id,
      kind: "powershell",
      worktreeId: worktree.id,
      cols: 80,
      rows: 24,
    });
    before.worker.emit({ type: "exit", sessionId: session.id, exitCode: 0 });
    await before.instance.flush();

    const after = worktreeCoordinator(root, { worktreeGone: true });
    await after.instance.initialize();

    await expect(after.instance.resume({ sessionId: session.id, cols: 80, rows: 24 })).rejects.toThrow(
      /unknown worktree/i,
    );
    expect(after.worker.create).not.toHaveBeenCalled();
  });

  it("persists the split pane, refuses unknown sessions, and clears it on removal", async () => {
    const root = await tempRoot();
    const { instance } = worktreeCoordinator(root);
    await instance.initialize();
    const session = await instance.create({ projectId: project.id, kind: "powershell", cols: 80, rows: 24 });

    await instance.split(session.id);
    expect((await readAppState({ statePath: path.join(root, "state.json") })).state.splitSessionId).toBe(session.id);
    await expect(instance.split("missing")).rejects.toThrow(/unknown terminal session/i);

    await instance.remove(session.id);
    const raw = JSON.parse(await fs.readFile(path.join(root, "state.json"), "utf8"));
    expect(Object.keys(raw)).not.toContain("splitSessionId");
  });

  it("removes only the worktree's sessions, leaving root sessions alone", async () => {
    const root = await tempRoot();
    const { instance } = worktreeCoordinator(root);
    await instance.initialize();
    const inWorktree = await instance.create({
      projectId: project.id,
      kind: "powershell",
      worktreeId: worktree.id,
      cols: 80,
      rows: 24,
    });
    const atRoot = await instance.create({ projectId: project.id, kind: "powershell", cols: 80, rows: 24 });

    await instance.removeWorktreeSessions(worktree.id);

    expect(instance.list().map((session) => session.id)).toEqual([atRoot.id]);
    expect(instance.list()[0].id).not.toBe(inWorktree.id);
  });
});
