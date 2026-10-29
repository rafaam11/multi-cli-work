export const CODEX_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultracode"] as const;
export interface LaunchProfile {
  id: string;
  name: string;
  agentId: "codex" | "claude";
  model: string | null;
  effort: string | null;
}
export function parseLaunchProfile(value: unknown): LaunchProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("시작 프로필이 올바르지 않습니다");
  const raw = value as Record<string, unknown>;
  const text = (value: unknown, max: number): string => {
    if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error("프로필 이름 또는 ID가 올바르지 않습니다");
    return value.trim();
  };
  if (raw.agentId !== "codex" && raw.agentId !== "claude") throw new Error("Codex·Claude 전용 프로필입니다");
  const model = raw.model === null ? null : text(raw.model, 200);
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+\[\]-]*$/.test(model)) throw new Error("모델 ID에는 영문·숫자와 . _ : / @ + [ ] - 만 사용할 수 있습니다");
  const efforts: readonly string[] = raw.agentId === "codex" ? CODEX_EFFORTS : CLAUDE_EFFORTS;
  if (raw.effort !== null && (typeof raw.effort !== "string" || !efforts.includes(raw.effort))) throw new Error("이 CLI에서 지원하지 않는 추론 수준입니다");
  return { id: text(raw.id, 120), name: text(raw.name, 40), agentId: raw.agentId, model, effort: raw.effort as string | null };
}
