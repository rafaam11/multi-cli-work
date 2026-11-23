// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildClaudeSettings,
  CLAUDE_STATUS_HOOK,
  CLAUDE_STATUS_HOOK_PYTHON,
  ensureClaudeIntegration,
  LINEAR_RECORD_REMINDER,
  writeClaudeSettings,
} from "./claude-integration";
import { LINEAR_RECORD_MARKER } from "../linear/linear-brief";

const execFileAsync = promisify(execFile);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Claude app-owned integration", () => {
  it("records child activity without changing its parent's status", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-claude-activity-")); roots.push(root);
    const integration = await ensureClaudeIntegration(root, process.platform);
    const activityDir = path.join(root, "events");
    const child = execFileAsync(process.platform === "win32" ? "powershell.exe" : "python3",
      process.platform === "win32" ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", integration.hookPath] : [integration.hookPath],
      { env: { ...process.env, MULTI_CLI_WORK_SESSION_ID: "parent", MULTI_CLI_WORK_STATUS_DIR: integration.statusDir, MULTI_CLI_WORK_ACTIVITY_DIR: activityDir, MULTI_CLI_WORK_GENERATION: "generation" } });
    child.child.stdin?.end(JSON.stringify({ hook_event_name: "SubagentStop", agent_id: "child", agent_type: "Explore", session_id: "parent-conversation", tool_input: { secret: "never store" } }));
    await child;
    const files = await fs.readdir(activityDir); expect(files).toHaveLength(1);
    const activity = await fs.readFile(path.join(activityDir, files[0]), "utf8");
    expect(JSON.parse(activity)).toMatchObject({ sessionId: "parent", agentId: "child", agentType: "Explore", event: "SubagentStop" });
    expect(activity).not.toContain("never store");
    await expect(fs.stat(path.join(integration.statusDir, "parent.json"))).rejects.toThrow();
  });
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
      "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "PostModelSwitch", "TaskCreated", "TaskCompleted",
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

  it("carries Claude Code's theme only when the app follows its own theme", async () => {
    expect(buildClaudeSettings("/tmp/claude-status.py", "linux")).not.toHaveProperty("theme");
    expect(buildClaudeSettings("/tmp/claude-status.py", "linux", "light-daltonized")).toMatchObject({ theme: "light-daltonized" });

    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-claude-theme-"));
    roots.push(root);
    const integration = await ensureClaudeIntegration(root, "win32");
    await writeClaudeSettings(integration, "win32", "light");
    expect(JSON.parse(await fs.readFile(integration.settingsPath, "utf8"))).toEqual(
      buildClaudeSettings(integration.hookPath, "win32", "light"),
    );
    await writeClaudeSettings(integration, "win32", null);
    expect(JSON.parse(await fs.readFile(integration.settingsPath, "utf8"))).not.toHaveProperty("theme");
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
        MULTI_CLI_WORK_GENERATION: "generation-1",
      },
    });
    child.child.stdin?.end(JSON.stringify({ hook_event_name: "SessionStart", session_id: "claude-1", cwd: root, transcript_path: path.join(root, "claude.jsonl") }));
    const { stdout } = await child;

    const output = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(output.hookSpecificOutput.additionalContext).toContain("업무 프로젝트: 테스트");
    // The status file write must keep working alongside the context output.
    const status = JSON.parse(await fs.readFile(path.join(statusDir, "session-brief-test.json"), "utf8"));
    expect(status).toMatchObject({ sessionId: "session-brief-test", status: "idle", event: "SessionStart" });
    expect(status).toMatchObject({ provider: "claude", generation: "generation-1", cwd: root, providerConversationId: "claude-1", transcriptPath: path.join(root, "claude.jsonl") });
  }, 20_000);

  it("leaves no temp file behind when many hooks race for the same status file", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-claude-race-"));
    roots.push(root);
    const integration = await ensureClaudeIntegration(root, process.platform);
    const statusDir = path.join(root, "status");
    const command = process.platform === "win32" ? "powershell.exe" : "python3";
    const args =
      process.platform === "win32"
        ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", integration.hookPath]
        : [integration.hookPath];
    const runHook = () => {
      const child = execFileAsync(command, args, {
        env: { ...process.env, MULTI_CLI_WORK_SESSION_ID: "session-race", MULTI_CLI_WORK_STATUS_DIR: statusDir },
      });
      child.child.stdin?.end(JSON.stringify({ hook_event_name: "PreToolUse", session_id: "claude-race", cwd: root }));
      return child;
    };
    // Claude fires PreToolUse/PostToolUse for parallel tool calls at once — the same target, raced.
    for (let round = 0; round < 3; round += 1) await Promise.all(Array.from({ length: 8 }, runHook));

    const entries = await fs.readdir(statusDir);
    expect(entries.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(entries).toContain("session-race.json");
  }, 120_000);

  it("writes an executable Python hook on Linux", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-claude-linux-"));
    roots.push(root);
    const integration = await ensureClaudeIntegration(root, "linux");
    expect(integration.hookPath).toMatch(/claude-status\.py$/);
    if (process.platform !== "win32") expect((await fs.stat(integration.hookPath)).mode & 0o111).not.toBe(0);
  });

  describe("Linear record reminder at Stop", () => {
    const hookCommand = () => (process.platform === "win32" ? "powershell.exe" : "python3");
    const hookArgs = (hookPath: string) =>
      process.platform === "win32" ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", hookPath] : [hookPath];
    const git = (cwd: string, ...args: string[]) =>
      execFileAsync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", ...args], { cwd });

    async function fixture(options: { marker?: boolean; gitRepo?: boolean } = {}) {
      // os.tmpdir(), not $TEMP: Linux runners leave TEMP unset, which would put the fixture inside the checkout.
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-claude-linear-"));
      roots.push(root);
      const integration = await ensureClaudeIntegration(root, process.platform);
      const repo = path.join(root, "repo");
      await fs.mkdir(repo);
      if (options.gitRepo !== false) {
        await git(repo, "init", "-q");
        await git(repo, "commit", "--allow-empty", "-q", "-m", "one");
      }
      const briefPath = path.join(root, "brief.md");
      await fs.writeFile(briefPath, `## Linear 맥락 (PRJ-0017 x)
${options.marker === false ? "" : LINEAR_RECORD_MARKER}
`, "utf8");
      const stateDir = path.join(root, "session-linear");
      const run = async (input: Record<string, unknown>) => {
        const child = execFileAsync(hookCommand(), hookArgs(integration.hookPath), {
          env: {
            ...process.env,
            MULTI_CLI_WORK_SESSION_ID: "session-linear",
            MULTI_CLI_WORK_STATUS_DIR: path.join(root, "status"),
            MULTI_CLI_WORK_PROJECT_BRIEF: briefPath,
            MULTI_CLI_WORK_LINEAR_STATE_DIR: stateDir,
            // Never let git climb out of the fixture into whatever repository holds the temp folder.
            GIT_CEILING_DIRECTORIES: root,
          },
        });
        child.child.stdin?.end(JSON.stringify({ session_id: "claude-1", cwd: repo, ...input }));
        return (await child).stdout;
      };
      return { repo, stateDir, run };
    }

    /** One shell tool call as Claude reports it: PreToolUse, the command itself, PostToolUse. */
    async function shellTool(
      run: (input: Record<string, unknown>) => Promise<string>,
      options: { tool?: string; command?: string; between?: () => Promise<unknown> } = {},
    ) {
      const call = { tool_name: options.tool ?? "Bash", tool_input: { command: options.command ?? "git add -A && git commit -m two" } };
      await run({ hook_event_name: "PreToolUse", ...call });
      await options.between?.();
      await run({ hook_event_name: "PostToolUse", ...call });
    }

    it("stays silent at Stop when this session committed nothing", async () => {
      const { run } = await fixture();
      await run({ hook_event_name: "SessionStart" });
      await expect(run({ hook_event_name: "Stop" })).resolves.toBe("");
    }, 30_000);

    it("reminds once after this session commits through a shell tool", async () => {
      const { repo, run } = await fixture();
      await run({ hook_event_name: "SessionStart" });
      await shellTool(run, { between: () => git(repo, "commit", "--allow-empty", "-q", "-m", "two") });
      expect(JSON.parse(await run({ hook_event_name: "Stop" }))).toEqual({ decision: "block", reason: LINEAR_RECORD_REMINDER });
      await expect(run({ hook_event_name: "Stop" })).resolves.toBe("");
      // The PowerShell tool counts the same as Bash.
      await shellTool(run, { tool: "PowerShell", command: "git commit -q -m three", between: () => git(repo, "commit", "--allow-empty", "-q", "-m", "three") });
      expect(JSON.parse(await run({ hook_event_name: "Stop" }))).toMatchObject({ decision: "block" });
    }, 40_000);

    it("does not remind when HEAD moved without this session committing", async () => {
      // Another session sharing the working tree, a pull or a checkout moves HEAD too.
      const { repo, run } = await fixture();
      await run({ hook_event_name: "SessionStart" });
      await git(repo, "commit", "--allow-empty", "-q", "-m", "someone else");
      await shellTool(run, { command: "git status" });
      await expect(run({ hook_event_name: "Stop" })).resolves.toBe("");
    }, 30_000);

    it("ignores a commit command that did not move HEAD, even after someone else committed", async () => {
      const { repo, run } = await fixture();
      await run({ hook_event_name: "SessionStart" });
      await git(repo, "commit", "--allow-empty", "-q", "-m", "someone else");
      await shellTool(run, { command: "git commit -m nothing-staged" });
      await expect(run({ hook_event_name: "Stop" })).resolves.toBe("");
    }, 30_000);

    it("respects stop_hook_active and keeps the reminder for the next Stop", async () => {
      const { repo, run } = await fixture();
      await run({ hook_event_name: "SessionStart" });
      await shellTool(run, { between: () => git(repo, "commit", "--allow-empty", "-q", "-m", "two") });
      await expect(run({ hook_event_name: "Stop", stop_hook_active: true })).resolves.toBe("");
      expect(JSON.parse(await run({ hook_event_name: "Stop" }))).toMatchObject({ decision: "block" });
    }, 30_000);

    it("ignores sessions whose brief has no marker", async () => {
      const { repo, stateDir, run } = await fixture({ marker: false });
      await run({ hook_event_name: "SessionStart" });
      await shellTool(run, { between: () => git(repo, "commit", "--allow-empty", "-q", "-m", "two") });
      await expect(run({ hook_event_name: "Stop" })).resolves.toBe("");
      await expect(fs.readdir(stateDir)).rejects.toThrow();
    }, 30_000);

    it("stays silent outside a git repository", async () => {
      const { stateDir, run } = await fixture({ gitRepo: false });
      await run({ hook_event_name: "SessionStart" });
      await shellTool(run);
      await expect(run({ hook_event_name: "Stop" })).resolves.toBe("");
      await expect(fs.readdir(stateDir)).rejects.toThrow();
    }, 30_000);

    it("keeps the PowerShell hook pure ASCII", () => {
      expect(CLAUDE_STATUS_HOOK).not.toMatch(/[^\x00-\x7F]/);
    });
  });
});
