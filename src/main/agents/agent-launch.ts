import { AGENT_ARG_TOKENS, type AgentArgToken, type AgentDefinition } from "../../shared/agent-types";

export interface AgentLaunchContext {
  cwd: string;
  /** The id the app minted for this session. Also Claude's conversation id. */
  sessionId: string;
  claudeSettingsPath: string;
  /** Non-null only when an existing conversation is being resumed. */
  resumeConversationId: string | null;
}

export interface AgentLaunchCommand {
  executable: string;
  args: string[];
  providerConversationId: string | null;
}

export class AgentLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentLaunchError";
  }
}

/** `{{` and `}}` stand for literal braces, so an argument may still carry JSON. */
const TOKEN_PATTERN = /\{\{|\}\}|\{([^{}]*)\}/g;

function isKnownToken(name: string): name is AgentArgToken {
  return (AGENT_ARG_TOKENS as readonly string[]).includes(name);
}

/**
 * Substitutes an argument's placeholders. An unknown placeholder is an error rather than literal
 * text: a typo in `agents.json` should surface as a message, not as a stray word on a command line.
 */
export function substituteAgentArg(arg: string, values: Readonly<Record<AgentArgToken, string | null>>): string {
  return arg.replace(TOKEN_PATTERN, (match, name: string | undefined) => {
    if (match === "{{") return "{";
    if (match === "}}") return "}";
    const token = name ?? "";
    if (!isKnownToken(token)) {
      throw new AgentLaunchError(`Unknown argument placeholder {${token}}. Known: ${AGENT_ARG_TOKENS.join(", ")}`);
    }
    const value = values[token];
    if (value === null) throw new AgentLaunchError(`Argument placeholder {${token}} has no value for this session`);
    return value;
  });
}

/** Every placeholder an agent's arguments use, so a definition can be checked before it is stored. */
export function agentArgTokens(definition: AgentDefinition): string[] {
  const found = new Set<string>();
  for (const arg of [...definition.newSessionArgs, ...definition.resumeArgs, ...definition.args]) {
    for (const match of arg.matchAll(TOKEN_PATTERN)) {
      if (match[0] === "{{" || match[0] === "}}") continue;
      found.add(match[1] ?? "");
    }
  }
  return [...found];
}

/**
 * A resumed session takes `resumeArgs`, a fresh one takes `newSessionArgs`, and `args` follows
 * either. Whether the session *may* resume is settled before this is called — an agent that owns no
 * conversation id (PowerShell) simply relaunches.
 */
export function buildAgentLaunch(
  definition: AgentDefinition,
  executable: string,
  context: AgentLaunchContext,
): AgentLaunchCommand {
  const resuming = context.resumeConversationId !== null;
  const values: Record<AgentArgToken, string | null> = {
    cwd: context.cwd,
    sessionId: context.sessionId,
    conversationId: context.resumeConversationId,
    claudeSettings: context.claudeSettingsPath,
  };
  const template = [...(resuming ? definition.resumeArgs : definition.newSessionArgs), ...definition.args];
  return {
    executable,
    args: template.map((arg) => substituteAgentArg(arg, values)),
    providerConversationId: providerConversationId(definition, context),
  };
}

function providerConversationId(definition: AgentDefinition, context: AgentLaunchContext): string | null {
  switch (definition.conversationId) {
    case "none":
      return null;
    // Claude takes the id we hand it, so the session is resumable from the moment it starts.
    case "app-generated":
      return context.resumeConversationId ?? context.sessionId;
    // Codex mints its own, so a fresh session has none until the transcript is correlated.
    case "provider-assigned":
      return context.resumeConversationId ?? null;
  }
}
