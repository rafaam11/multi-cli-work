import { expect, it } from "vitest";
import { codexIndicatorUpdate } from "./codex-indicators";

it("shows only observed metadata and clears the tool chip when a turn ends", () => {
  const event = { sessionId: "s", status: "working" as const, event: "PreToolUse", at: "2026-01-01T00:00:00Z", model: "codex-test", permissionMode: "bypassPermissions", toolName: "Bash" };
  expect(codexIndicatorUpdate(event)).toEqual({ chips: [
    { key: "codex-model", text: "codex-test", color: "blue" },
    { key: "codex-permission", text: "제한 해제", color: "amber" },
    { key: "codex-tool", text: "Bash", color: "blue" },
  ], clearTool: false });
  expect(codexIndicatorUpdate({ sessionId: "s", status: "awaiting-input", event: "Stop", at: event.at })).toEqual({ chips: [], clearTool: true });
});
