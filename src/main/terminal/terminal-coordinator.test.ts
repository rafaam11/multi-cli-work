// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SharedProject } from "../../shared/project-types";
import type {
  TerminalAttachment,
  TerminalLaunchSpec,
  TerminalSession,
  TerminalWorkerEvent,
} from "../../shared/terminal-types";
import { readAppState, readSessionLog } from "../state/app-state";
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
      powershell: "powershell.exe",
      claude: "claude.exe",
      codex: "codex.cmd",
      vscode: "code.cmd",
    }),
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
        powershell: "powershell.exe",
        claude: "claude.exe",
        codex: "codex.cmd",
        vscode: null,
      }),
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
        powershell: "powershell.exe",
        claude: "claude.exe",
        codex: "codex.cmd",
        vscode: null,
      }),
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

    expect(received).toHaveBeenNthCalledWith(1, {
      type: "data",
      sessionId: "session-1",
      data: "first",
      sequence: 1,
    });
    expect(received).toHaveBeenNthCalledWith(2, {
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
