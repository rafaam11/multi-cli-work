// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SHIFT_ENTER_BYTES } from "../../shared/agent-types";
import { AGENT_REGISTRY_PATH, AgentRegistryError, parseAgentRegistry, readAgentRegistry } from "./agent-registry";
import { BUILTIN_AGENTS } from "./builtin-agents";

const tempRoots: string[] = [];

async function tempRegistryPath(): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-agents-"));
  tempRoots.push(root);
  return path.join(root, "agents.json");
}

async function writeRegistry(registryPath: string, agents: Record<string, unknown>): Promise<void> {
  await fs.writeFile(
    registryPath,
    JSON.stringify({ schemaVersion: 1, updatedAt: "2026-07-13T00:00:00.000Z", agents }),
    "utf8",
  );
}

const GEMINI = {
  id: "gemini",
  label: "Gemini CLI",
  commands: ["gemini"],
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("agent registry", () => {
  it("lives beside the project registry", () => {
    expect(AGENT_REGISTRY_PATH).toContain(`${path.sep}.multi-cli-work${path.sep}`);
  });

  it("returns the built-ins when the user has no agents.json", async () => {
    const snapshot = await readAgentRegistry({ registryPath: await tempRegistryPath(), platform: "win32" });

    expect(snapshot.agents.map((agent) => agent.id)).toEqual(["powershell", "claude", "codex"]);
    expect(snapshot.warning).toBeUndefined();
  });

  it("selects the native shell without changing shared built-in ids", async () => {
    const registryPath = await tempRegistryPath();
    const linux = await readAgentRegistry({ registryPath, platform: "linux" });
    const windows = await readAgentRegistry({ registryPath, platform: "win32" });

    expect(linux.agents.map((agent) => agent.id)).toEqual(["bash", "claude", "codex"]);
    expect(windows.agents.map((agent) => agent.id)).toEqual(["powershell", "claude", "codex"]);
  });

  it("appends a user agent to the built-ins with signal-based defaults", async () => {
    const registryPath = await tempRegistryPath();
    await writeRegistry(registryPath, { gemini: GEMINI });

    const snapshot = await readAgentRegistry({ registryPath, platform: "win32" });

    expect(snapshot.agents.map((agent) => agent.id)).toEqual(["powershell", "claude", "codex", "gemini"]);
    expect(snapshot.agents.at(-1)).toMatchObject({
      id: "gemini",
      label: "Gemini CLI",
      commands: ["gemini"],
      statusAdapter: "signals",
      conversationId: "none",
      titleSource: "none",
      icon: null,
      builtin: false,
    });
  });

  it("keeps the app usable when agents.json is broken, and says why", async () => {
    const registryPath = await tempRegistryPath();
    await fs.writeFile(registryPath, "{ not json", "utf8");

    const snapshot = await readAgentRegistry({ registryPath, platform: "win32" });

    expect(snapshot.agents.map((agent) => agent.id)).toEqual(["powershell", "claude", "codex"]);
    expect(snapshot.warning).toMatch(/built-in agents are available/i);
  });
});

describe("user agent validation", () => {
  function parseOne(agent: Record<string, unknown>) {
    return () =>
      parseAgentRegistry({
        schemaVersion: 1,
        updatedAt: "2026-07-13T00:00:00.000Z",
        agents: { [agent.id as string]: agent },
      });
  }

  it("refuses to let a user agent shadow a built-in", () => {
    expect(parseOne({ ...GEMINI, id: "claude" })).toThrow(/built-in id/i);
  });

  it("rejects an id that is not a slug", () => {
    expect(parseOne({ ...GEMINI, id: "Gemini CLI" })).toThrow(AgentRegistryError);
  });

  it("rejects an unknown placeholder instead of passing it to the CLI as text", () => {
    expect(parseOne({ ...GEMINI, args: ["--dir", "{workingDirectory}"] })).toThrow(/unknown placeholder/i);
  });

  it("rejects capabilities that only a built-in can have", () => {
    expect(parseOne({ ...GEMINI, statusAdapter: "claude-hook" })).toThrow(/statusAdapter/i);
    expect(parseOne({ ...GEMINI, args: ["--settings", "{claudeSettings}"] })).toThrow(/built-in Claude agent/i);
    expect(parseOne({ ...GEMINI, conversationId: "provider-assigned" })).toThrow(/conversationId/i);
    expect(parseOne({ ...GEMINI, titleSource: "claude-transcript" })).toThrow(/titleSource/i);
    expect(parseOne({ ...GEMINI, icon: "claude" })).toThrow(/icon/i);
  });

  it("rejects a placeholder used where it could never have a value", () => {
    // {conversationId} is only bound on resume, so anywhere else it would fail every launch.
    expect(parseOne({ ...GEMINI, args: ["--chat", "{conversationId}"] })).toThrow(/only use \{conversationId\} in resumeArgs/i);
  });

  it("rejects resume arguments an agent could never satisfy", () => {
    expect(parseOne({ ...GEMINI, resumeArgs: ["--resume", "{conversationId}"], conversationId: "none" })).toThrow(
      /can never resume/i,
    );
  });

  it("rejects unknown fields so a typo does not silently do nothing", () => {
    expect(parseOne({ ...GEMINI, arguments: ["--yolo"] })).toThrow(/unknown fields/i);
  });

  it("defaults shiftEnter to a plain Enter and lets a crossterm CLI opt into Alt+Enter", () => {
    const registry = parseAgentRegistry({
      schemaVersion: 1,
      updatedAt: "2026-07-13T00:00:00.000Z",
      agents: { gemini: GEMINI, opencode: { id: "opencode", commands: ["opencode"], shiftEnter: "alt-enter" } },
    });

    expect(registry.agents.gemini.shiftEnter).toBe("enter");
    expect(registry.agents.opencode.shiftEnter).toBe("alt-enter");
    expect(() =>
      parseAgentRegistry({
        schemaVersion: 1,
        updatedAt: "2026-07-13T00:00:00.000Z",
        agents: { gemini: { ...GEMINI, shiftEnter: "csi-u" } },
      }),
    ).toThrow(AgentRegistryError);
  });

  it("ships Alt+Enter only for Codex, whose composer is the one that needs it", () => {
    expect(BUILTIN_AGENTS.codex.shiftEnter).toBe("alt-enter");
    expect(BUILTIN_AGENTS.claude.shiftEnter).toBe("enter");
    expect(BUILTIN_AGENTS.powershell.shiftEnter).toBe("enter");
    expect(SHIFT_ENTER_BYTES["alt-enter"]).toBe(`${String.fromCharCode(0x1b)}\r`);
    expect(SHIFT_ENTER_BYTES.enter).toBeNull();
  });

  it("accepts a resumable agent that mints its own session id", () => {
    const registry = parseAgentRegistry({
      schemaVersion: 1,
      updatedAt: "2026-07-13T00:00:00.000Z",
      agents: {
        gemini: {
          ...GEMINI,
          $comment: "Fields are documented in the README.",
          conversationId: "app-generated",
          newSessionArgs: ["--session", "{sessionId}"],
          resumeArgs: ["--resume", "{conversationId}"],
          args: ["--cwd", "{cwd}"],
          statusAdapter: "osc9",
          accentColor: "#4285f4",
        },
      },
    });

    expect(registry.agents.gemini).toMatchObject({
      conversationId: "app-generated",
      statusAdapter: "osc9",
      accentColor: "#4285f4",
      builtin: false,
    });
  });
});
