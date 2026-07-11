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
import { readAppState } from "../state/app-state";
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

  onEvent(listener: (event: TerminalWorkerEvent) => void): () => void {
    this.listener = listener;
    return () => undefined;
  }

  emit(event: TerminalWorkerEvent): void {
    this.listener(event);
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

async function coordinator(root: string, worker = new FakeWorker()) {
  const instance = new TerminalCoordinator({
    worker,
    statePath: path.join(root, "state.json"),
    logDir: path.join(root, "logs"),
    claudeSettingsPath: path.join(root, "claude-settings.json"),
    getProject: async (id) => (id === project.id ? project : null),
    getExecutables: async () => ({ powershell: "powershell.exe", claude: "claude.exe", codex: "codex.cmd" }),
    env: { SYSTEMROOT: "C:\\Windows" },
    idFactory: () => "session-1",
    now: () => "2026-07-11T01:00:00.000Z",
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
        args: ["--session-id", "session-1", "--settings", path.join(root, "claude-settings.json")],
        env: expect.objectContaining({ MULTI_CLI_WORK_SESSION_ID: "session-1" }),
      }),
    );
    expect(session).toMatchObject({ id: "session-1", providerConversationId: "session-1" });
    const stored = await readAppState({ statePath: path.join(root, "state.json") });
    expect(stored.state.sessions["session-1"].providerConversationId).toBe("session-1");
  });

  it("persists worker output and unified status for renderer refresh", async () => {
    const root = await tempRoot();
    const { instance, worker } = await coordinator(root);
    await instance.create({ projectId: "project-1", kind: "codex", cols: 80, rows: 24 });

    worker.emit({ type: "data", sessionId: "session-1", data: "hello\r\n" });
    worker.emit({ type: "status", sessionId: "session-1", status: "awaiting-input" });
    await instance.flush();

    expect(instance.list()).toEqual([
      expect.objectContaining({ id: "session-1", status: "awaiting-input", pid: 123 }),
    ]);
    const attachment = await instance.attach("session-1");
    expect(attachment.replay).toContain("hello");
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
        args: ["--resume", "session-1", "--settings", path.join(root, "claude-settings.json")],
      }),
    );
  });
});

