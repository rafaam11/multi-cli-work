// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AgentDefinition } from "../../shared/agent-types";
import { AgentLaunchError, agentArgTokens, buildAgentLaunch, substituteAgentArg } from "./agent-launch";
import { BUILTIN_AGENTS } from "./builtin-agents";

const CLAUDE_EXE = "C:\\Users\\me\\.local\\bin\\claude.exe";
const CODEX_EXE = "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd";
const POWERSHELL_EXE = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

const context = {
  cwd: "C:\\Work Space\\Example",
  sessionId: "11111111-1111-4111-8111-111111111111",
  claudeSettingsPath: "C:\\Users\\me\\AppData\\Roaming\\Multi CLI Work\\claude-settings.json",
  resumeConversationId: null,
};

/**
 * These are the command lines the app spawned before agents became data. They are spelled out rather
 * than derived so that a change to a built-in definition has to be made here too, deliberately.
 */
describe("built-in agent command lines", () => {
  it("starts and resumes Claude with app-owned settings, a stable conversation id, and permissions skipped", () => {
    expect(buildAgentLaunch(BUILTIN_AGENTS.claude, CLAUDE_EXE, context)).toEqual({
      executable: CLAUDE_EXE,
      args: [
        "--session-id",
        context.sessionId,
        "--settings",
        context.claudeSettingsPath,
        "--dangerously-skip-permissions",
      ],
      providerConversationId: context.sessionId,
    });

    expect(
      buildAgentLaunch(BUILTIN_AGENTS.claude, CLAUDE_EXE, { ...context, resumeConversationId: "claude-existing" }),
    ).toEqual({
      executable: CLAUDE_EXE,
      args: [
        "--resume",
        "claude-existing",
        "--settings",
        context.claudeSettingsPath,
        "--dangerously-skip-permissions",
      ],
      providerConversationId: "claude-existing",
    });
  });

  it("enables Codex TUI notifications and bypasses approvals without shell quoting", () => {
    const launch = buildAgentLaunch(BUILTIN_AGENTS.codex, CODEX_EXE, context);

    expect(launch.executable).toBe(CODEX_EXE);
    expect(launch.providerConversationId).toBeNull();
    expect(launch.args).toEqual([
      "-C",
      context.cwd,
      "--dangerously-bypass-approvals-and-sandbox",
      "-c",
      'tui.notifications=["agent-turn-complete","approval-requested"]',
      "-c",
      'tui.notification_method="osc9"',
      "-c",
      'tui.notification_condition="always"',
    ]);
  });

  it("places the Codex resume id before the shared run options", () => {
    const launch = buildAgentLaunch(BUILTIN_AGENTS.codex, CODEX_EXE, {
      ...context,
      resumeConversationId: "codex-existing",
    });

    expect(launch.args.slice(0, 4)).toEqual(["resume", "codex-existing", "-C", context.cwd]);
    expect(launch.providerConversationId).toBe("codex-existing");
  });

  it("gives PowerShell no conversation id, so resuming it just relaunches", () => {
    expect(buildAgentLaunch(BUILTIN_AGENTS.powershell, POWERSHELL_EXE, context)).toEqual({
      executable: POWERSHELL_EXE,
      args: ["-NoLogo"],
      providerConversationId: null,
    });
  });
});

function userAgent(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: "gemini",
    label: "Gemini CLI",
    commands: ["gemini"],
    args: [],
    newSessionArgs: [],
    resumeArgs: [],
    conversationId: "none",
    statusAdapter: "signals",
    titleSource: "none",
    shiftEnter: "enter",
    icon: null,
    accentColor: null,
    builtin: false,
    ...overrides,
  };
}

describe("argument placeholders", () => {
  it("rejects an unknown placeholder rather than passing it through as text", () => {
    // A typo must not reach the PTY as a literal word on the command line.
    expect(() => substituteAgentArg("{sessionid}", { cwd: "C:\\w", sessionId: "s", conversationId: null, claudeSettings: "c" })).toThrow(
      AgentLaunchError,
    );
  });

  it("rejects a placeholder that has no value for this session", () => {
    expect(() =>
      buildAgentLaunch(userAgent({ args: ["--chat", "{conversationId}"] }), "gemini.exe", context),
    ).toThrow(/has no value/);
  });

  it("passes literal braces through so an argument can still carry JSON", () => {
    const launch = buildAgentLaunch(userAgent({ args: ["-c", '{{"root":"{cwd}"}}'] }), "gemini.exe", context);

    expect(launch.args).toEqual(["-c", `{"root":"${context.cwd}"}`]);
  });

  it("reports every placeholder a definition uses, so it can be checked before it is stored", () => {
    expect(agentArgTokens(BUILTIN_AGENTS.claude).sort()).toEqual(["claudeSettings", "conversationId", "sessionId"]);
    expect(agentArgTokens(BUILTIN_AGENTS.codex)).toEqual(["conversationId", "cwd"]);
    expect(agentArgTokens(BUILTIN_AGENTS.powershell)).toEqual([]);
  });
});
