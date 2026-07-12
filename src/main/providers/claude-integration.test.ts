// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildClaudeSettings, CLAUDE_STATUS_HOOK, ensureClaudeIntegration } from "./claude-integration";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Claude app-owned integration", () => {
  it("registers state hooks without changing user settings", () => {
    const settings = buildClaudeSettings("C:\\App Data\\hooks\\claude-status.ps1");

    expect(Object.keys(settings.hooks)).toEqual([
      "SessionStart",
      "SessionEnd",
      "UserPromptSubmit",
      "PreToolUse",
      "PermissionRequest",
      "PostToolUse",
      "PostToolUseFailure",
      "Notification",
      "Stop",
      "StopFailure",
    ]);
    expect(settings.hooks.PermissionRequest[0].hooks[0]).toEqual({
      type: "command",
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "C:\\App Data\\hooks\\claude-status.ps1",
      ],
      timeout: 10,
    });
  });

  it("maps elicitation dialogs to awaiting-input", () => {
    expect(CLAUDE_STATUS_HOOK).toContain("elicitation_dialog");
  });

  it("writes the settings overlay and hook script beneath app userData", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-claude-"));
    roots.push(root);

    const integration = await ensureClaudeIntegration(root);

    expect(integration.settingsPath).toBe(path.join(root, "claude-settings.json"));
    expect(JSON.parse(await fs.readFile(integration.settingsPath, "utf8"))).toEqual(
      buildClaudeSettings(integration.hookPath),
    );
    expect(await fs.readFile(integration.hookPath, "utf8")).toContain("MULTI_CLI_WORK_SESSION_ID");
  });

  it("treats a failed turn as waiting for input instead of a terminal process error", () => {
    expect(CLAUDE_STATUS_HOOK).toContain('"StopFailure" { "awaiting-input"; break }');
    expect(CLAUDE_STATUS_HOOK).not.toContain('"StopFailure" { "error"; break }');
  });
});
