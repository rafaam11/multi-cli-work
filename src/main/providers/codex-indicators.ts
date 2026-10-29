import type { ProviderStatusEvent } from "./provider-status";
import type { StatusChip } from "../../shared/terminal-types";

const PERMISSIONS: Record<string, string> = {
  default: "기본 승인", acceptEdits: "편집 허용", plan: "계획", dontAsk: "승인 안 함", bypassPermissions: "제한 해제",
};

/** Only values the current hook actually observed are shown; no inferred context or cost. */
export function codexIndicatorUpdate(event: ProviderStatusEvent): { chips: StatusChip[]; clearTool: boolean } {
  const chips: StatusChip[] = [];
  if (event.model) chips.push({ key: "codex-model", text: event.model, color: "blue" });
  if (event.permissionMode) chips.push({ key: "codex-permission", text: PERMISSIONS[event.permissionMode] ?? event.permissionMode, color: event.permissionMode === "bypassPermissions" ? "amber" : "gray" });
  if (event.event === "PreToolUse" && event.toolName) chips.push({ key: "codex-tool", text: event.toolName, color: "blue" });
  return { chips, clearTool: ["PostToolUse", "Stop", "Interrupt", "UserPromptSubmit"].includes(event.event) };
}
