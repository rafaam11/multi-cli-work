import os from "node:os";
import path from "node:path";
import {
  AGENT_ARG_TOKENS,
  type AgentDefinition,
  type AgentId,
  type AgentRegistryV1,
  BUILTIN_AGENT_IDS,
  type ConversationIdOwner,
  type StatusAdapter,
  USER_STATUS_ADAPTERS,
} from "../../shared/agent-types";
import { type JsonStoreSnapshot, type JsonStoreSpec, readJsonStore } from "../storage/json-store";
import { agentArgTokens } from "./agent-launch";
import { builtinAgents } from "./builtin-agents";

export const AGENT_REGISTRY_PATH = path.join(os.homedir(), ".multi-cli-work", "agents.json");

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Ignored on read, so the example file the app writes can carry its own instructions. */
const COMMENT_KEY = "$comment";
const AGENT_KEYS = [
  COMMENT_KEY,
  "id",
  "label",
  "commands",
  "args",
  "newSessionArgs",
  "resumeArgs",
  "conversationId",
  "statusAdapter",
  "titleSource",
  "icon",
  "accentColor",
] as const;

/** Conversation ownership a user-defined agent may claim. `provider-assigned` needs a transcript
 * correlator, which only the built-in Codex agent has. */
const USER_CONVERSATION_OWNERS: readonly ConversationIdOwner[] = ["none", "app-generated"];

export class AgentRegistryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentRegistryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new AgentRegistryError(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new AgentRegistryError(`${label} must be an array of strings`);
  }
  return [...(value as string[])];
}

function isoString(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new AgentRegistryError(`${label} must be an ISO timestamp`);
  }
  return new Date(Date.parse(value)).toISOString();
}

/**
 * A user-defined agent is checked for the mistakes that would otherwise only show up as a broken
 * command line: an unknown placeholder, a placeholder used where it can never have a value, a
 * capability that only a built-in can have. It is not a sandbox — the file lives in the user's own
 * home directory and its whole purpose is to run an executable they chose.
 */
function parseUserAgent(value: unknown, key: string): AgentDefinition {
  if (!isRecord(value)) throw new AgentRegistryError(`agent ${key} must be an object`);
  assertExactKeys(value, AGENT_KEYS, `agent ${key}`);

  const id = typeof value.id === "string" ? value.id : key;
  if (id !== key) throw new AgentRegistryError(`agent key ${key} does not match agent id ${id}`);
  if (!ID_PATTERN.test(id)) {
    throw new AgentRegistryError(`agent ${key}.id must be lower-case letters, digits and hyphens (max 32)`);
  }
  if ((BUILTIN_AGENT_IDS as readonly string[]).includes(id)) {
    throw new AgentRegistryError(`agent ${key} uses a built-in id. Pick another id.`);
  }

  const label = typeof value.label === "string" && value.label.trim().length > 0 ? value.label.trim() : id;
  const commands = stringArray(value.commands, `agent ${key}.commands`).filter((command) => command.length > 0);
  if (commands.length === 0) throw new AgentRegistryError(`agent ${key}.commands must name at least one executable`);

  const statusAdapter = (value.statusAdapter ?? "signals") as StatusAdapter;
  if (!(USER_STATUS_ADAPTERS as readonly string[]).includes(statusAdapter)) {
    throw new AgentRegistryError(
      `agent ${key}.statusAdapter must be one of: ${USER_STATUS_ADAPTERS.join(", ")}`,
    );
  }

  const conversationId = (value.conversationId ?? "none") as ConversationIdOwner;
  if (!USER_CONVERSATION_OWNERS.includes(conversationId)) {
    throw new AgentRegistryError(
      `agent ${key}.conversationId must be one of: ${USER_CONVERSATION_OWNERS.join(", ")}`,
    );
  }

  if (value.titleSource !== undefined && value.titleSource !== "none") {
    throw new AgentRegistryError(`agent ${key}.titleSource must be "none": transcript titles are built-in only`);
  }
  if (value.icon !== undefined && value.icon !== null) {
    throw new AgentRegistryError(`agent ${key}.icon must be null: brand icons are built-in only`);
  }
  const accentColor = value.accentColor ?? null;
  if (accentColor !== null && (typeof accentColor !== "string" || !HEX_COLOUR_PATTERN.test(accentColor))) {
    throw new AgentRegistryError(`agent ${key}.accentColor must be null or a #rrggbb colour`);
  }

  const definition: AgentDefinition = {
    id,
    label,
    commands,
    args: stringArray(value.args ?? [], `agent ${key}.args`),
    newSessionArgs: stringArray(value.newSessionArgs ?? [], `agent ${key}.newSessionArgs`),
    resumeArgs: stringArray(value.resumeArgs ?? [], `agent ${key}.resumeArgs`),
    conversationId,
    statusAdapter,
    titleSource: "none",
    icon: null,
    accentColor,
    builtin: false,
  };

  assertUsableTokens(definition, key);
  return definition;
}

function assertUsableTokens(definition: AgentDefinition, key: string): void {
  for (const token of agentArgTokens(definition)) {
    if (!(AGENT_ARG_TOKENS as readonly string[]).includes(token)) {
      throw new AgentRegistryError(
        `agent ${key} uses an unknown placeholder {${token}}. Known: ${AGENT_ARG_TOKENS.join(", ")}`,
      );
    }
    if (token === "claudeSettings") {
      throw new AgentRegistryError(`agent ${key} uses {claudeSettings}, which only the built-in Claude agent has`);
    }
  }
  // `{conversationId}` only has a value on resume, so anywhere else it would fail every launch.
  const outsideResume = [...definition.newSessionArgs, ...definition.args];
  if (outsideResume.some((arg) => arg.includes("{conversationId}"))) {
    throw new AgentRegistryError(`agent ${key} may only use {conversationId} in resumeArgs`);
  }
  if (definition.resumeArgs.length > 0 && definition.conversationId === "none") {
    throw new AgentRegistryError(`agent ${key} has resumeArgs but conversationId "none", so it can never resume`);
  }
}

export function parseAgentRegistry(value: unknown): AgentRegistryV1 {
  if (!isRecord(value)) throw new AgentRegistryError("Agent registry must be an object");
  assertExactKeys(value, [COMMENT_KEY, "schemaVersion", "updatedAt", "agents"], "Agent registry");
  if (value.schemaVersion !== 1) {
    throw new AgentRegistryError(`Unsupported agent registry schema: ${String(value.schemaVersion)}`);
  }
  if (!isRecord(value.agents)) throw new AgentRegistryError("Agent registry agents must be an object");
  return {
    schemaVersion: 1,
    updatedAt: isoString(value.updatedAt, "Agent registry updatedAt"),
    agents: Object.fromEntries(Object.entries(value.agents).map(([key, agent]) => [key, parseUserAgent(agent, key)])),
  };
}

export function emptyAgentRegistry(now = new Date().toISOString()): AgentRegistryV1 {
  return { schemaVersion: 1, updatedAt: now, agents: {} };
}

const STORE: JsonStoreSpec<AgentRegistryV1> = {
  label: "agent registry",
  parse: parseAgentRegistry,
  empty: () => emptyAgentRegistry(),
  error: (message, options) => new AgentRegistryError(message, options),
  isContentError: (error) => error instanceof AgentRegistryError,
};

export interface AgentRegistrySnapshot {
  /** The built-ins, then whatever `agents.json` added. Never empty. */
  agents: AgentDefinition[];
  /** Why `agents.json` was ignored, when it was. */
  warning?: string;
}

export interface AgentRegistryOptions {
  registryPath?: string;
}

/**
 * A broken `agents.json` must not take the app down with it: the built-ins always load, and the
 * reason the user's file was ignored comes back as a warning they can act on.
 */
export async function readAgentRegistry(options: AgentRegistryOptions = {}): Promise<AgentRegistrySnapshot> {
  const registryPath = options.registryPath ?? AGENT_REGISTRY_PATH;
  const builtins = builtinAgents();
  let snapshot: JsonStoreSnapshot<AgentRegistryV1>;
  try {
    snapshot = await readJsonStore(STORE, registryPath);
  } catch (error) {
    return {
      agents: builtins,
      warning: `${(error as Error).message}. Only the built-in agents are available.`,
    };
  }
  return {
    agents: [...builtins, ...Object.values(snapshot.value.agents)],
    ...(snapshot.warning !== undefined ? { warning: snapshot.warning } : {}),
  };
}

export function agentsById(agents: readonly AgentDefinition[]): Map<AgentId, AgentDefinition> {
  return new Map(agents.map((agent) => [agent.id, agent]));
}
