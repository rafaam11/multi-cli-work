// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { CODEX_APP_PROFILE, ensureCodexIntegration } from "./codex-integration";

const roots: string[] = [];

describe("ensureCodexIntegration", () => {
  afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

  it("reports the owning terminal generation and Codex working directory from a real hook invocation", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-codex-hook-"));
    roots.push(root);
    const result = await ensureCodexIntegration({ userData: root, codexHome: path.join(root, "codex") });
    const child = promisify(execFile)(process.execPath, [result.hookScriptPath], { env: {
      ...process.env, MULTI_CLI_WORK_SESSION_ID: "shell-1", MULTI_CLI_WORK_STATUS_DIR: root, MULTI_CLI_WORK_GENERATION: "generation-1",
    } });
    child.child.stdin?.end(JSON.stringify({ hook_event_name: "SessionStart", session_id: "codex-1", cwd: root, transcript_path: path.join(root, "rollout.jsonl") }));
    await child;
    expect(JSON.parse(await fs.readFile(path.join(root, "shell-1.json"), "utf8"))).toMatchObject({
      provider: "codex", generation: "generation-1", cwd: root, providerConversationId: "codex-1",
    });
  });

  it("reports prompt and stop events without re-emitting the project brief", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-codex-hook-"));
    roots.push(root);
    const result = await ensureCodexIntegration({ userData: root, codexHome: path.join(root, "codex") });
    const profile = await fs.readFile(result.profilePath, "utf8");
    expect(profile).toContain("[[hooks.UserPromptSubmit]]");
    expect(profile).toContain("[[hooks.PreToolUse]]");
    expect(profile).toContain("[[hooks.PostToolUse]]");
    expect(profile).toContain("[[hooks.Stop]]");
    for (const [event, status] of [["UserPromptSubmit", "working"], ["Stop", "awaiting-input"]] as const) {
      const child = promisify(execFile)(process.execPath, [result.hookScriptPath], { env: {
        ...process.env, MULTI_CLI_WORK_SESSION_ID: "shell-1", MULTI_CLI_WORK_STATUS_DIR: root, MULTI_CLI_WORK_GENERATION: "generation-1",
      } });
      child.child.stdin?.end(JSON.stringify({ hook_event_name: event, session_id: "codex-1", cwd: root }));
      expect((await child).stdout).toBe(event === "Stop" ? "{}" : "");
      expect(JSON.parse(await fs.readFile(path.join(root, "shell-1.json"), "utf8"))).toMatchObject({ event, status, providerConversationId: "codex-1", generation: "generation-1" });
    }
  });

  it("hands Codex the work-project brief as SessionStart context, ASCII-escaped, and still reports status", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-codex-hook-"));
    roots.push(root);
    const result = await ensureCodexIntegration({ userData: root, codexHome: path.join(root, "codex") });
    const briefPath = path.join(root, "brief.md");
    await fs.writeFile(briefPath, "# 업무 프로젝트: 테스트\n\n## 레포 최신화 (세션 시작 시점)\n\n레포 1개 중 1개 최신화 🚀\n", "utf8");
    const run = async (env: Record<string, string>) => {
      // The test runner may itself live in an mcw session that carries a brief of its own.
      const child = promisify(execFile)(process.execPath, [result.hookScriptPath], {
        env: { ...process.env, MULTI_CLI_WORK_PROJECT_BRIEF: "", ...env },
      });
      child.child.stdin?.end(JSON.stringify({ hook_event_name: "SessionStart", session_id: "codex-1", cwd: root }));
      return (await child).stdout;
    };

    const stdout = await run({ MULTI_CLI_WORK_SESSION_ID: "shell-1", MULTI_CLI_WORK_STATUS_DIR: root, MULTI_CLI_WORK_PROJECT_BRIEF: briefPath });
    expect(stdout).toMatch(/^[\x20-\x7e]*$/);
    const output = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(output.hookSpecificOutput.additionalContext).toBe(await fs.readFile(briefPath, "utf8"));
    expect(JSON.parse(await fs.readFile(path.join(root, "shell-1.json"), "utf8"))).toMatchObject({ provider: "codex" });

    // A folder outside any work project gets no brief, and the hook then prints nothing at all.
    expect(await run({ MULTI_CLI_WORK_SESSION_ID: "shell-2", MULTI_CLI_WORK_STATUS_DIR: root })).toBe("");
    await fs.writeFile(briefPath, "  \n", "utf8");
    expect(await run({ MULTI_CLI_WORK_PROJECT_BRIEF: briefPath })).toBe("");
  });

  it("writes an app-owned SessionStart profile without bypassing hook trust", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-codex-hook-"));
    roots.push(root);
    const result = await ensureCodexIntegration({
      userData: path.join(root, "user data"),
      codexHome: path.join(root, ".codex"),
      executablePath: "C:\\Program Files\\Multi CLI Work\\Multi CLI Work.exe",
    });

    expect(result.profileName).toBe(CODEX_APP_PROFILE);
    const profile = await fs.readFile(result.profilePath, "utf8");
    expect(profile).toContain("[[hooks.SessionStart]]");
    expect(profile).toContain('matcher = "^(startup|resume)$"');
    expect(profile).toContain("command_windows");
    expect(profile).toContain("cmd.exe /d /s /c");
    expect(profile).not.toContain("bypass-hook-trust");
    const script = await fs.readFile(result.hookScriptPath, "utf8");
    expect(script).toContain("providerConversationId");
    expect(script).toContain("transcriptPath");

    const windowsRunnerPath = path.join(root, "user data", "provider-hooks", "codex-session-start.cmd");
    const windowsRunner = await fs.readFile(windowsRunnerPath, "utf8");
    expect(windowsRunner).toContain("@echo off");
    expect(windowsRunner).toContain('set "ELECTRON_RUN_AS_NODE=1"');
    expect(windowsRunner).toContain('"C:\\Program Files\\Multi CLI Work\\Multi CLI Work.exe"');
    expect(windowsRunner).toContain(`"${result.hookScriptPath}"`);
  });

  it("preserves Codex hook trust when refreshing an unchanged profile", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-codex-hook-"));
    roots.push(root);
    const options = {
      userData: path.join(root, "user data"),
      codexHome: path.join(root, ".codex"),
      executablePath: "C:\\Program Files\\Multi CLI Work\\Multi CLI Work.exe",
    };
    const result = await ensureCodexIntegration(options);
    const trustState =
      '\n[hooks.state]\n\n[hooks.state.\'C:\\Users\\PC\\.codex\\multi-cli-work.config.toml:session_start:0:0\']\n' +
      'trusted_hash = "sha256:test"\n';
    await fs.appendFile(result.profilePath, trustState, "utf8");

    await ensureCodexIntegration(options);

    expect(await fs.readFile(result.profilePath, "utf8")).toContain(trustState);
  });
});
