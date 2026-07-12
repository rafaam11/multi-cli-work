// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildEditorSpawn,
  buildProviderLaunch,
  buildToolLaunch,
  pickWindowsExecutable,
  vsCodeExecutableCandidate,
} from "./provider-launch";

const base = {
  cwd: "C:\\Work Space\\Example",
  appSessionId: "11111111-1111-4111-8111-111111111111",
  claudeSettingsPath: "C:\\Users\\me\\AppData\\Roaming\\Multi CLI Work\\claude-settings.json",
  executables: {
    powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    claude: "C:\\Users\\me\\.local\\bin\\claude.exe",
    codex: "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd",
    vscode: "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd",
  },
};

describe("provider launch commands", () => {
  it("starts and resumes Claude with app-owned settings, a stable conversation id, and permissions skipped", () => {
    expect(buildProviderLaunch("claude", base)).toEqual({
      executable: base.executables.claude,
      args: [
        "--session-id",
        base.appSessionId,
        "--settings",
        base.claudeSettingsPath,
        "--dangerously-skip-permissions",
      ],
      providerConversationId: base.appSessionId,
    });
    expect(buildProviderLaunch("claude", { ...base, resumeConversationId: "claude-existing" })).toEqual({
      executable: base.executables.claude,
      args: [
        "--resume",
        "claude-existing",
        "--settings",
        base.claudeSettingsPath,
        "--dangerously-skip-permissions",
      ],
      providerConversationId: "claude-existing",
    });
  });

  it("enables Codex TUI notifications and bypasses approvals without shell quoting", () => {
    const launch = buildProviderLaunch("codex", base);

    expect(launch.executable).toBe(base.executables.codex);
    expect(launch.providerConversationId).toBeNull();
    expect(launch.args).toEqual([
      "-C",
      base.cwd,
      "--dangerously-bypass-approvals-and-sandbox",
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

describe("tool launch commands", () => {
  it("runs each CLI update inside a PowerShell session that stays open", () => {
    expect(buildToolLaunch("claude-update", base.executables)).toEqual({
      executable: base.executables.powershell,
      args: ["-NoLogo", "-NoExit", "-Command", "claude update"],
      providerConversationId: null,
    });
    expect(buildToolLaunch("codex-update", base.executables).args).toEqual([
      "-NoLogo",
      "-NoExit",
      "-Command",
      "codex update",
    ]);
  });

  it("fails when PowerShell is unavailable", () => {
    expect(() => buildToolLaunch("claude-update", { ...base.executables, powershell: null })).toThrow(
      /PowerShell executable is not available/,
    );
  });
});

describe("VS Code launch", () => {
  it("resolves the sibling Code.exe for the bin/code.cmd shim", () => {
    expect(vsCodeExecutableCandidate(base.executables.vscode)).toBe(
      "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
    );
    expect(vsCodeExecutableCandidate("/usr/local/bin/code")).toBeNull();
  });

  it("spawns the resolved executable directly so no shell quoting is needed", () => {
    expect(
      buildEditorSpawn(base.executables.vscode, base.cwd, "C:\\Programs\\VS Code\\Code.exe"),
    ).toEqual({
      command: "C:\\Programs\\VS Code\\Code.exe",
      args: [base.cwd],
      shell: false,
    });
  });

  it("falls back to a quoted shell invocation when only a cmd shim exists", () => {
    expect(buildEditorSpawn(base.executables.vscode, base.cwd, null)).toEqual({
      command: `"${base.executables.vscode}"`,
      args: [`"${base.cwd}"`],
      shell: true,
    });
  });

  it("spawns a POSIX code script without a shell", () => {
    expect(buildEditorSpawn("/usr/local/bin/code", "/home/me/project", null)).toEqual({
      command: "/usr/local/bin/code",
      args: ["/home/me/project"],
      shell: false,
    });
  });
});
