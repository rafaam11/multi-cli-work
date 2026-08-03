// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildClaudeSettings,
  CLAUDE_STATUS_HOOK,
  CLAUDE_STATUS_HOOK_PYTHON,
  ensureClaudeIntegration,
} from "./claude-integration";

const execFileAsync = promisify(execFile);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Claude app-owned integration", () => {
  it("registers state hooks without changing user settings", () => {
    const settings = buildClaudeSettings("C:\\App Data\\hooks\\claude-status.ps1", "win32");

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

  it("uses the Python 3 hook on Linux", () => {
    const settings = buildClaudeSettings("/tmp/claude-status.py", "linux");
    expect(settings.hooks.Stop[0].hooks[0]).toEqual({
      type: "command",
      command: "python3",
      args: ["/tmp/claude-status.py"],
      timeout: 10,
    });
    expect(CLAUDE_STATUS_HOOK_PYTHON).toContain("os.replace(temporary, target)");
  });

  it("writes the settings overlay and hook script beneath app userData", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-claude-"));
    roots.push(root);

    const integration = await ensureClaudeIntegration(root, "win32");

    expect(integration.settingsPath).toBe(path.join(root, "claude-settings.json"));
    expect(JSON.parse(await fs.readFile(integration.settingsPath, "utf8"))).toEqual(
      buildClaudeSettings(integration.hookPath, "win32"),
    );
    expect(await fs.readFile(integration.hookPath, "utf8")).toContain("MULTI_CLI_WORK_SESSION_ID");
  });

  it("treats a failed turn as waiting for input instead of a terminal process error", () => {
    expect(CLAUDE_STATUS_HOOK).toContain('"StopFailure" { "awaiting-input"; break }');
    expect(CLAUDE_STATUS_HOOK).not.toContain('"StopFailure" { "error"; break }');
  });

  it("hands the work-project brief to Claude on SessionStart in both hook scripts", () => {
    for (const script of [CLAUDE_STATUS_HOOK, CLAUDE_STATUS_HOOK_PYTHON]) {
      expect(script).toContain("MULTI_CLI_WORK_PROJECT_BRIEF");
      expect(script).toContain("additionalContext");
      expect(script).toContain("SessionStart");
    }
  });

  it("emits additionalContext JSON on stdout when the hook runs a SessionStart with a brief", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-claude-hook-"));
    roots.push(root);
    const integration = await ensureClaudeIntegration(root, process.platform);
    const briefPath = path.join(root, "brief.md");
    await fs.writeFile(briefPath, "# 업무 프로젝트: 테스트\n- 노션: https://notion.so/x\n", "utf8");
    const statusDir = path.join(root, "status");

    const command = process.platform === "win32" ? "powershell.exe" : "python3";
    const args =
      process.platform === "win32"
        ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", integration.hookPath]
        : [integration.hookPath];
    const child = execFileAsync(command, args, {
      env: {
        ...process.env,
        MULTI_CLI_WORK_SESSION_ID: "session-brief-test",
        MULTI_CLI_WORK_STATUS_DIR: statusDir,
        MULTI_CLI_WORK_PROJECT_BRIEF: briefPath,
      },
    });
    child.child.stdin?.end(JSON.stringify({ hook_event_name: "SessionStart" }));
    const { stdout } = await child;

    const output = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(output.hookSpecificOutput.additionalContext).toContain("업무 프로젝트: 테스트");
    // The status file write must keep working alongside the context output.
    const status = JSON.parse(await fs.readFile(path.join(statusDir, "session-brief-test.json"), "utf8"));
    expect(status).toMatchObject({ sessionId: "session-brief-test", status: "idle", event: "SessionStart" });
  }, 20_000);

  it("writes an executable Python hook on Linux", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-claude-linux-"));
    roots.push(root);
    const integration = await ensureClaudeIntegration(root, "linux");
    expect(integration.hookPath).toMatch(/claude-status\.py$/);
    if (process.platform !== "win32") expect((await fs.stat(integration.hookPath)).mode & 0o111).not.toBe(0);
  });
});
