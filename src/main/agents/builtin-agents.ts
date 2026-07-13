import type { AgentDefinition, BuiltinAgentId } from "../../shared/agent-types";

/**
 * Codex only emits the notifications the `osc9` status adapter reads if it is told to, so the flags
 * that turn them on travel with the definition rather than with the adapter.
 */
const CODEX_NOTIFICATION_ARGS = [
  "-c",
  'tui.notifications=["agent-turn-complete","approval-requested"]',
  "-c",
  'tui.notification_method="osc9"',
  "-c",
  'tui.notification_condition="always"',
];

/**
 * The agents the app ships with, described by the same schema a user's `agents.json` uses. Changing
 * an argument here changes what gets spawned — `agent-launch.test.ts` pins the exact command lines.
 */
export const BUILTIN_AGENTS: Record<BuiltinAgentId, AgentDefinition> = {
  powershell: {
    id: "powershell",
    label: "PowerShell",
    commands: ["pwsh", "powershell"],
    args: ["-NoLogo"],
    newSessionArgs: [],
    resumeArgs: [],
    conversationId: "none",
    statusAdapter: "signals",
    titleSource: "none",
    icon: "powershell",
    accentColor: null,
    builtin: true,
  },
  claude: {
    id: "claude",
    label: "Claude Code",
    commands: ["claude"],
    // The overlay carries the app's status hook; the permission flag is what keeps a session from
    // parking on an approval prompt the user cannot see.
    args: ["--settings", "{claudeSettings}", "--dangerously-skip-permissions"],
    newSessionArgs: ["--session-id", "{sessionId}"],
    resumeArgs: ["--resume", "{conversationId}"],
    conversationId: "app-generated",
    statusAdapter: "claude-hook",
    titleSource: "claude-transcript",
    icon: "claude",
    accentColor: null,
    builtin: true,
  },
  codex: {
    id: "codex",
    label: "Codex",
    commands: ["codex"],
    args: ["-C", "{cwd}", "--dangerously-bypass-approvals-and-sandbox", ...CODEX_NOTIFICATION_ARGS],
    newSessionArgs: [],
    resumeArgs: ["resume", "{conversationId}"],
    conversationId: "provider-assigned",
    statusAdapter: "osc9",
    titleSource: "codex-transcript",
    icon: "codex",
    accentColor: null,
    builtin: true,
  },
};

export function builtinAgents(): AgentDefinition[] {
  return Object.values(BUILTIN_AGENTS);
}
