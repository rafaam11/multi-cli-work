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
    expect(profile).not.toContain("bypass-hook-trust");
    const script = await fs.readFile(result.hookScriptPath, "utf8");
    expect(script).toContain("providerConversationId");
    expect(script).toContain("transcriptPath");
  });
});
