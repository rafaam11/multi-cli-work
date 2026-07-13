// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildEditorSpawn,
  buildToolLaunch,
  pickWindowsExecutable,
  vsCodeExecutableCandidate,
} from "./provider-launch";

const base = {
  cwd: "C:\\Work Space\\Example",
  executables: {
    agents: {
      powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      claude: "C:\\Users\\me\\.local\\bin\\claude.exe",
      codex: "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd",
    },
    vscode: "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd",
  },
};

describe("executable resolution", () => {
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
      executable: base.executables.agents.powershell,
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
    const withoutPowerShell = { ...base.executables, agents: { ...base.executables.agents, powershell: null } };

    expect(() => buildToolLaunch("claude-update", withoutPowerShell)).toThrow(/PowerShell executable is not available/);
  });
});

describe("VS Code launch", () => {
  it("resolves the sibling Code.exe for the bin/code.cmd shim", () => {
    expect(vsCodeExecutableCandidate(base.executables.vscode)).toBe(
      "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
    );
    expect(vsCodeExecutableCandidate("/usr/local/bin/code")).toBeNull();
  });

  it("spawns the resolved executable directly, unhidden, so no shell quoting is needed", () => {
    expect(
      buildEditorSpawn(base.executables.vscode, base.cwd, "C:\\Programs\\VS Code\\Code.exe"),
    ).toEqual({
      command: "C:\\Programs\\VS Code\\Code.exe",
      args: [base.cwd],
      shell: false,
      // windowsHide would put SW_HIDE in STARTUPINFO and VS Code would start with no window.
      windowsHide: false,
    });
  });

  it("falls back to a quoted shell invocation when only a cmd shim exists, hiding only the console", () => {
    expect(buildEditorSpawn(base.executables.vscode, base.cwd, null)).toEqual({
      command: `"${base.executables.vscode}"`,
      args: [`"${base.cwd}"`],
      shell: true,
      windowsHide: true,
    });
  });

  it("spawns a POSIX code script without a shell", () => {
    expect(buildEditorSpawn("/usr/local/bin/code", "/home/me/project", null)).toEqual({
      command: "/usr/local/bin/code",
      args: ["/home/me/project"],
      shell: false,
      windowsHide: false,
    });
  });
});
