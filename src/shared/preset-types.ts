/**
 * A session preset: a small team started in one go — say a Claude builder and a Codex reviewer —
 * each member with its pane name and, optionally, the first prompt that tells it its role.
 */

export interface SessionPresetMember {
  agentId: string;
  name: string;
  /** Omitted uses the app default; null uses the CLI's own configuration. */
  launchProfileId?: string | null;
  /** Typed in once the CLI is ready. */
  prompt?: string;
}

export interface SessionPreset {
  id: string;
  name: string;
  description?: string;
  members: SessionPresetMember[];
}

export interface SessionPresetsV1 {
  schemaVersion: 1;
  updatedAt: string;
  presets: SessionPreset[];
}

/** Where to start a preset: a folder, or one of its worktrees. */
export interface PresetLaunchInput {
  presetId: string;
  projectId: string;
  worktreeId?: string | null;
}

export const PRESET_NAME_MAX = 40;
export const PRESET_MEMBER_NAME_MAX = 60;
export const PRESET_PROMPT_MAX = 8000;
export const PRESET_MEMBERS_MAX = 8;
