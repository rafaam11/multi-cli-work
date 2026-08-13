// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODEX_APP_PROFILE, ensureCodexIntegration } from "./codex-integration";

const roots: string[] = [];

describe("ensureCodexIntegration", () => {
  afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

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
