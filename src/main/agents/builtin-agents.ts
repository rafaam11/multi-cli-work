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
    shiftEnter: "enter",
    icon: "powershell",
    accentColor: null,
    builtin: true,
  },
  bash: {
    id: "bash",
    label: "Bash",
    commands: ["bash"],
    args: ["--login"],
    newSessionArgs: [],
    resumeArgs: [],
    conversationId: "none",
    statusAdapter: "signals",
    titleSource: "none",
    shiftEnter: "enter",
    icon: null,
    accentColor: "#4eaa25",
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
    // Claude Code has its own documented newline key (backslash then Enter), so Shift+Enter is
    // left alone rather than remapped to a sequence it has no binding for.
    shiftEnter: "enter",
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
    // Codex advertises "Shift+⏎ newline" but can only see it over a keyboard protocol xterm.js
    // does not speak. Alt+Enter is the binding it does recognise from a plain byte stream.
    shiftEnter: "alt-enter",
    icon: "codex",
    accentColor: null,
    builtin: true,
  },
};

export function builtinAgents(platform: NodeJS.Platform = process.platform): AgentDefinition[] {
  const shellId: BuiltinAgentId = platform === "win32" ? "powershell" : "bash";
  return [BUILTIN_AGENTS[shellId], BUILTIN_AGENTS.claude, BUILTIN_AGENTS.codex];
}
