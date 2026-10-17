import os from "node:os";
import path from "node:path";
import { AGENT_ID_PATTERN } from "../../shared/agent-types";
import {
  PRESET_MEMBER_NAME_MAX,
  PRESET_MEMBERS_MAX,
  PRESET_NAME_MAX,
  PRESET_PROMPT_MAX,
  type SessionPreset,
  type SessionPresetMember,
  type SessionPresetsV1,
} from "../../shared/preset-types";
import { type JsonStoreSpec, readJsonStore, updateJsonStore } from "../storage/json-store";

/**
 * `session-presets.json`: the teams the user can start in one go. Same protocol as the other files
 * under `~/.multi-cli-work/` — lock, atomic write and `.bak` from `json-store`, exact keys here.
 *
 * A missing file reads as the one built-in example, so a first run has something to try; once the
 * file exists, what is in it is the whole list — deleting the example keeps it deleted.
 */
export const SESSION_PRESETS_PATH = path.join(os.homedir(), ".multi-cli-work", "session-presets.json");

export class PresetRegistryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PresetRegistryError";
  }
}

const BUILDER_PROMPT = [
  "너는 이 폴더의 빌더다. 요청받은 변경을 구현하고 테스트까지 통과시킨다.",
  "진행 상황은 `jk post \"…\"`로 팀 보드에 짧게 남겨라.",
  "구현이 끝나면 `jk list`로 리뷰어 세션 id를 찾아 `jk send <id> \"…\"`로 무엇을 바꿨는지와 검토할 파일을 알려라.",
  "리뷰 의견이 오면 반영하고 다시 알려라. 지금은 첫 지시를 기다린다고만 답하라.",
].join("\n");

const REVIEWER_PROMPT = [
  "너는 이 폴더의 리뷰어다. 코드를 직접 고치지 말고 검토만 한다.",
  "빌더가 `[from …]`으로 리뷰를 부탁하면 git diff를 읽고 버그·누락된 테스트·위험한 변경을 찾아라.",
  "의견은 `jk send <빌더 id> \"…\"`로 돌려주고, 결론은 `jk post \"…\"`로 팀 보드에 남겨라.",
  "지금은 리뷰 요청을 기다린다고만 답하라.",
].join("\n");

export const BUILTIN_PRESETS: readonly SessionPreset[] = [
  {
    id: "builder-reviewer",
    name: "빌더 + 리뷰어",
    description: "Claude가 구현하고 Codex가 검토한다",
    members: [
      { agentId: "claude", name: "빌더", prompt: BUILDER_PROMPT },
      { agentId: "codex", name: "리뷰어", prompt: REVIEWER_PROMPT },
    ],
  },
];

const REGISTRY_KEYS = ["schemaVersion", "updatedAt", "presets"] as const;
const PRESET_KEYS = ["id", "name", "description", "members"] as const;
const MEMBER_KEYS = ["agentId", "name", "prompt"] as const;
const PRESET_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new PresetRegistryError(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new PresetRegistryError(`${label} must be a string`);
  const clean = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (!clean) throw new PresetRegistryError(`${label} must not be empty`);
  if (clean.length > max) throw new PresetRegistryError(`${label} is longer than ${max} characters`);
  return clean;
}

function parseMember(value: unknown, label: string): SessionPresetMember {
  if (!isRecord(value)) throw new PresetRegistryError(`${label} must be an object`);
  assertExactKeys(value, MEMBER_KEYS, label);
  if (typeof value.agentId !== "string" || !AGENT_ID_PATTERN.test(value.agentId)) {
    throw new PresetRegistryError(`${label} agentId is invalid`);
  }
  const prompt = value.prompt === undefined || value.prompt === "" ? undefined : text(value.prompt, `${label} prompt`, PRESET_PROMPT_MAX);
  return {
    agentId: value.agentId,
    name: text(value.name, `${label} name`, PRESET_MEMBER_NAME_MAX),
    ...(prompt ? { prompt } : {}),
  };
}

export function parseSessionPreset(value: unknown, label = "Session preset"): SessionPreset {
  if (!isRecord(value)) throw new PresetRegistryError(`${label} must be an object`);
  assertExactKeys(value, PRESET_KEYS, label);
  if (typeof value.id !== "string" || !PRESET_ID.test(value.id)) throw new PresetRegistryError(`${label} id is invalid`);
  if (!Array.isArray(value.members) || value.members.length === 0 || value.members.length > PRESET_MEMBERS_MAX) {
    throw new PresetRegistryError(`${label} needs 1 to ${PRESET_MEMBERS_MAX} members`);
  }
  const description =
    value.description === undefined || value.description === "" ? undefined : text(value.description, `${label} description`, 120);
  return {
    id: value.id,
    name: text(value.name, `${label} name`, PRESET_NAME_MAX),
    ...(description ? { description } : {}),
    members: value.members.map((member, index) => parseMember(member, `${label} member ${index + 1}`)),
  };
}

export function parseSessionPresets(value: unknown): SessionPresetsV1 {
  if (!isRecord(value)) throw new PresetRegistryError("Session presets must be an object");
  assertExactKeys(value, REGISTRY_KEYS, "Session presets");
  if (value.schemaVersion !== 1) throw new PresetRegistryError(`Unsupported session presets schema: ${String(value.schemaVersion)}`);
  if (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new PresetRegistryError("Session presets updatedAt must be an ISO timestamp");
  }
  if (!Array.isArray(value.presets)) throw new PresetRegistryError("Session presets list must be an array");
  const presets = value.presets.map((preset, index) => parseSessionPreset(preset, `Session preset ${index + 1}`));
  if (new Set(presets.map((preset) => preset.id)).size !== presets.length) {
    throw new PresetRegistryError("Session preset ids must be unique");
  }
  return { schemaVersion: 1, updatedAt: new Date(Date.parse(value.updatedAt)).toISOString(), presets };
}

const STORE: JsonStoreSpec<SessionPresetsV1> = {
  label: "session presets",
  displayName: "세션 프리셋(session-presets.json)",
  parse: parseSessionPresets,
  empty: () => ({ schemaVersion: 1, updatedAt: new Date(0).toISOString(), presets: BUILTIN_PRESETS.map((preset) => ({ ...preset })) }),
  error: (message, options) => new PresetRegistryError(message, options),
  isContentError: (error) => error instanceof PresetRegistryError,
};

export interface PresetRegistryOptions {
  registryPath?: string;
  now?: () => string;
}

const pathOf = (options: PresetRegistryOptions) => options.registryPath ?? SESSION_PRESETS_PATH;
const nowOf = (options: PresetRegistryOptions) => (options.now ?? (() => new Date().toISOString()))();

export async function readSessionPresets(options: PresetRegistryOptions = {}): Promise<SessionPreset[]> {
  return (await readJsonStore(STORE, pathOf(options))).value.presets;
}

/** Adds the preset, or replaces the one with its id in place. */
export async function saveSessionPreset(preset: SessionPreset, options: PresetRegistryOptions = {}): Promise<SessionPreset[]> {
  const parsed = parseSessionPreset(preset);
  const now = nowOf(options);
  const next = await updateJsonStore(STORE, pathOf(options), (registry) => {
    const index = registry.presets.findIndex((existing) => existing.id === parsed.id);
    const presets = [...registry.presets];
    if (index >= 0) presets[index] = parsed;
    else presets.push(parsed);
    return { ...registry, updatedAt: now, presets };
  });
  return next.presets;
}

export async function removeSessionPreset(id: string, options: PresetRegistryOptions = {}): Promise<SessionPreset[]> {
  const now = nowOf(options);
  const next = await updateJsonStore(STORE, pathOf(options), (registry) => ({
    ...registry,
    updatedAt: now,
    presets: registry.presets.filter((preset) => preset.id !== id),
  }));
  return next.presets;
}
