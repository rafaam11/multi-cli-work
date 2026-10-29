import { randomUUID } from "node:crypto";
import type { PromptEntry, WorkbenchState, SavedViewPreset } from "../../shared/workbench-types";
import { parseLaunchProfile, type LaunchProfile } from "../../shared/launch-profile";
import type { FanOutTemplate } from "../../shared/settings-types";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";

class WorkbenchError extends Error {}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("작업공간 데이터가 올바르지 않습니다");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || value.includes("\0")) throw new WorkbenchError("텍스트 길이나 형식이 올바르지 않습니다");
  return value;
}
export function parsePrompt(value: unknown): PromptEntry {
  const raw = record(value);
  if (!Array.isArray(raw.tags) || raw.tags.length > 10 || typeof raw.favorite !== "boolean") throw new WorkbenchError("프롬프트 정보가 올바르지 않습니다");
  return { id: text(raw.id, 120), name: text(raw.name, 40), text: text(raw.text, 8000),
    tags: [...new Set(raw.tags.map(tag => text(tag, 30)))], favorite: raw.favorite,
    agentId: raw.agentId === null ? null : text(raw.agentId, 32) };
}
export function parseWorkbench(value: unknown): WorkbenchState {
  const raw = record(value);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.prompts) || raw.prompts.length > 100) throw new WorkbenchError("지원하지 않는 작업공간 데이터입니다");
  const prompts = raw.prompts.map(parsePrompt);
  if (new Set(prompts.map(prompt => prompt.id)).size !== prompts.length) throw new WorkbenchError("중복된 프롬프트 ID입니다");
  const entries = Object.entries(record(raw.drafts));
  if (entries.length > 200) throw new WorkbenchError("초안은 최대 200개까지 저장할 수 있습니다");
  const forks = raw.forks === undefined ? undefined : Object.entries(record(raw.forks));
  if (forks && forks.length > 1000) throw new WorkbenchError("분기 관계는 최대 1000개까지 저장할 수 있습니다");
  const pinned = raw.pinnedPaneIds === undefined ? undefined : raw.pinnedPaneIds;
  if (pinned !== undefined && (!Array.isArray(pinned) || pinned.length > 1000)) throw new WorkbenchError("고정 목록이 올바르지 않습니다");
  let launchProfiles: LaunchProfile[] | undefined;
  if (raw.launchProfiles !== undefined) {
    if (!Array.isArray(raw.launchProfiles) || raw.launchProfiles.length > 50) throw new WorkbenchError("시작 프로필은 최대 50개까지입니다");
    try { launchProfiles = raw.launchProfiles.map(parseLaunchProfile); } catch (error) { throw new WorkbenchError(String(error)); }
    if (new Set(launchProfiles.map(profile => profile.id)).size !== launchProfiles.length) throw new WorkbenchError("중복된 시작 프로필 ID입니다");
  }
  const defaults: Partial<Record<"codex" | "claude", string>> = {};
  if (raw.defaultLaunchProfiles !== undefined) {
    const values = record(raw.defaultLaunchProfiles);
    for (const agent of ["claude", "codex"] as const) {
      if (values[agent] === undefined) continue;
      const id = text(values[agent], 120);
      if (!launchProfiles?.some(profile => profile.id === id && profile.agentId === agent)) throw new WorkbenchError("기본 시작 프로필을 찾을 수 없습니다");
      defaults[agent] = id;
    }
  }
  let savedViews: SavedViewPreset[] | undefined;
  if (raw.savedViews !== undefined) {
    if (!Array.isArray(raw.savedViews) || raw.savedViews.length > 30) throw new WorkbenchError("저장 배치는 최대 30개까지입니다");
    savedViews = raw.savedViews.map(parseSavedView);
    if (new Set(savedViews.map(view => view.id)).size !== savedViews.length) throw new WorkbenchError("중복된 저장 배치 ID입니다");
  }
  return { schemaVersion: 1, prompts, drafts: Object.fromEntries(entries.map(([id, draft]) => [text(id, 120), text(draft, 8000, true)])),
    ...(forks ? { forks: Object.fromEntries(forks.map(([child, parent]) => [text(child, 120), text(parent, 120)])) } : {}),
    ...(pinned ? { pinnedPaneIds: [...new Set((pinned as unknown[]).map(id => text(id, 120)))] } : {}),
    ...(launchProfiles ? { launchProfiles } : {}), ...(raw.defaultLaunchProfiles !== undefined ? { defaultLaunchProfiles: defaults } : {}),
    ...(savedViews ? { savedViews } : {}) };
}
export function parseSavedView(value: unknown): SavedViewPreset {
  const raw = record(value);
  if (typeof raw.layoutId !== "string" || !/^(auto|cols:[12](-[12]){0,5})$/.test(raw.layoutId)) throw new WorkbenchError("배치 형태가 올바르지 않습니다");
  if (typeof raw.sidebarCollapsed !== "boolean" || typeof raw.rightSidebarCollapsed !== "boolean" || !["files", "git", "records", "board", "deliveries", "prompts", "activity"].includes(raw.rightSidebarTab as string)) throw new WorkbenchError("배치의 패널 설정이 올바르지 않습니다");
  return { id: text(raw.id, 120), name: text(raw.name, 40), layoutId: raw.layoutId, sidebarCollapsed: raw.sidebarCollapsed,
    rightSidebarCollapsed: raw.rightSidebarCollapsed, rightSidebarTab: raw.rightSidebarTab === "prompts" ? "files" : ["board", "deliveries", "activity"].includes(raw.rightSidebarTab as string) ? "records" : raw.rightSidebarTab as SavedViewPreset["rightSidebarTab"] };
}
const spec: JsonStoreSpec<WorkbenchState> = {
  label: "workbench", displayName: "작업공간(workbench-state.json)", parse: parseWorkbench,
  empty: () => ({ schemaVersion: 1, prompts: [], drafts: {} }),
  error: (message, options) => new WorkbenchError(message, options), isContentError: error => error instanceof WorkbenchError,
};
export async function createWorkbenchStore(file: string, legacy: readonly FanOutTemplate[]) {
  // An optional workbench file must not prevent the terminal workspace from starting.
  try {
    const initial = await readJsonStore(spec, file);
    if (initial.source === "empty" && initial.writable) await updateJsonStore(spec, file, state =>
      state.prompts.length || Object.keys(state.drafts).length ? state : ({
        ...state, prompts: legacy.slice(0, 100).map(prompt => ({ ...prompt, id: randomUUID(), tags: [], favorite: false, agentId: null })),
      }));
  } catch { /* state() surfaces the read-only diagnostic without replacing either file. */ }
  return {
    async saveLaunchProfile(value: unknown) {
      const profile = parseLaunchProfile(value);
      return updateJsonStore(spec, file, state => {
        const defaults = { ...state.defaultLaunchProfiles };
        for (const agent of ["claude", "codex"] as const) if (defaults[agent] === profile.id && agent !== profile.agentId) delete defaults[agent];
        return { ...state, launchProfiles: [...(state.launchProfiles ?? []).filter(item => item.id !== profile.id), profile], defaultLaunchProfiles: defaults };
      });
    },
    async removeLaunchProfile(id: string) {
      return updateJsonStore(spec, file, state => ({ ...state, launchProfiles: (state.launchProfiles ?? []).filter(item => item.id !== id),
        defaultLaunchProfiles: Object.fromEntries(Object.entries(state.defaultLaunchProfiles ?? {}).filter(([, value]) => value !== id)) }));
    },
    async setDefaultLaunchProfile(agent: "claude" | "codex", id: string | null) {
      return updateJsonStore(spec, file, state => {
        const defaults = { ...state.defaultLaunchProfiles };
        if (id === null) delete defaults[agent]; else defaults[agent] = id;
        return { ...state, defaultLaunchProfiles: defaults };
      });
    },
    async resolveLaunchProfile(agent: string, id?: string | null): Promise<LaunchProfile | null> {
      if (id === null) return null;
      const snapshot = await readJsonStore(spec, file);
      const selected = id ?? snapshot.value.defaultLaunchProfiles?.[agent as "claude" | "codex"];
      if (!selected) return null;
      const profile = snapshot.value.launchProfiles?.find(profile => profile.id === selected && profile.agentId === agent);
      if (!profile) throw new WorkbenchError("이 CLI의 시작 프로필을 찾을 수 없습니다. 설정에서 다시 선택해 주세요");
      return { ...profile };
    },
    async saveView(value: unknown) {
      const view = parseSavedView(value);
      return updateJsonStore(spec, file, state => ({ ...state, savedViews: [...(state.savedViews ?? []).filter(item => item.id !== view.id), view] }));
    },
    async removeView(id: string) { return updateJsonStore(spec, file, state => ({ ...state, savedViews: (state.savedViews ?? []).filter(item => item.id !== id) })); },
    async recordFork(child: string, parent: string) {
      text(child, 120); text(parent, 120);
      return updateJsonStore(spec, file, state => ({ ...state, forks: Object.fromEntries([...Object.entries(state.forks ?? {}), [child, parent]]) }));
    },
    async state() {
      try { const snapshot = await readJsonStore(spec, file); return { state: snapshot.value, writable: snapshot.writable, warning: snapshot.warning }; }
      catch (error) { return { state: spec.empty(), writable: false, warning: `작업공간 저장소를 읽을 수 없습니다: ${String(error)}` }; }
    },
    async savePrompt(value: unknown) {
      const prompt = parsePrompt(value);
      return updateJsonStore(spec, file, state => ({ ...state, prompts: [...state.prompts.filter(item => item.id !== prompt.id), prompt] }));
    },
    async importPrompts(json: string) {
      if (json.length > 1_000_000) throw new WorkbenchError("가져올 파일이 너무 큽니다");
      const data = record(JSON.parse(json));
      if (data.format !== "mcw-prompts" || data.version !== 1 || !Array.isArray(data.prompts) || data.prompts.length > 100) throw new WorkbenchError("지원하지 않는 라이브러리 파일입니다");
      const imported = data.prompts.map(parsePrompt);
      return updateJsonStore(spec, file, state => {
        const prompts = [...state.prompts];
        for (const prompt of imported) {
          if (!prompts.some(existing => existing.name === prompt.name && existing.text === prompt.text)) prompts.push({ ...prompt, id: randomUUID() });
        }
        return { ...state, prompts };
      });
    },
    async removePrompt(id: string) { return updateJsonStore(spec, file, state => ({ ...state, prompts: state.prompts.filter(prompt => prompt.id !== id) })); },
    async saveDraft(id: string, draft: string) {
      text(id, 120); text(draft, 8000, true);
      return updateJsonStore(spec, file, state => {
        const drafts = { ...state.drafts };
        if (draft) Object.defineProperty(drafts, id, { value: draft, enumerable: true, configurable: true, writable: true });
        else delete drafts[id];
        return { ...state, drafts };
      });
    },
  };
}
