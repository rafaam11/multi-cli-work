// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildProviderLaunch, pickWindowsExecutable } from "./provider-launch";

const base = {
  cwd: "C:\\Work Space\\Example",
  appSessionId: "11111111-1111-4111-8111-111111111111",
  claudeSettingsPath: "C:\\Users\\me\\AppData\\Roaming\\Multi CLI Work\\claude-settings.json",
  executables: {
    powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    claude: "C:\\Users\\me\\.local\\bin\\claude.exe",
    codex: "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd",
  },
};

describe("provider launch commands", () => {
  it("starts and resumes Claude with app-owned settings and a stable conversation id", () => {
    expect(buildProviderLaunch("claude", base)).toEqual({
      executable: base.executables.claude,
      args: ["--session-id", base.appSessionId, "--settings", base.claudeSettingsPath],
      providerConversationId: base.appSessionId,
    });
    expect(buildProviderLaunch("claude", { ...base, resumeConversationId: "claude-existing" })).toEqual({
      executable: base.executables.claude,
      args: ["--resume", "claude-existing", "--settings", base.claudeSettingsPath],
      providerConversationId: "claude-existing",
    });
  });

  it("enables Codex TUI notifications without shell quoting", () => {
    const launch = buildProviderLaunch("codex", base);

    expect(launch.executable).toBe(base.executables.codex);
    expect(launch.providerConversationId).toBeNull();
    expect(launch.args).toEqual([
      "-C",
      base.cwd,
      "-c",
      'tui.notifications=["agent-turn-complete","approval-requested"]',
      "-c",
      'tui.notification_method="osc9"',
      "-c",
      'tui.notification_condition="always"',
    ]);
  });

  it("places the Codex resume id before the shared run options", () => {
    const launch = buildProviderLaunch("codex", { ...base, resumeConversationId: "codex-existing" });

    expect(launch.args.slice(0, 4)).toEqual(["resume", "codex-existing", "-C", base.cwd]);
    expect(launch.providerConversationId).toBe("codex-existing");
  });

  it("uses the detected PowerShell fallback and no provider conversation id", () => {
    expect(buildProviderLaunch("powershell", base)).toEqual({
      executable: base.executables.powershell,
      args: ["-NoLogo"],
      providerConversationId: null,
    });
  });

  it("prefers executable and cmd shims over extensionless or PowerShell shims", () => {
    expect(
      pickWindowsExecutable([
        "C:\\Users\\me\\AppData\\Roaming\\npm\\codex",
        "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.ps1",
        "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd",
      ]),
    ).toBe("C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd");
  });
});

