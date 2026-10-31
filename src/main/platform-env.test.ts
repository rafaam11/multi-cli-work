// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { discoverSessionEnvironment, prependPath } from "./platform-env";

describe("platform environment", () => {
  it("uses the native PATH delimiter", () => {
    expect(prependPath({ PATH: "/usr/bin" }, "/app/bin", "linux").PATH).toBe("/app/bin:/usr/bin");
    expect(prependPath({ Path: "C:\\Windows" }, "C:\\app\\bin", "win32").Path).toBe(
      "C:\\app\\bin;C:\\Windows",
    );
  });

  it("reads PATH from a login Bash and falls back to standard GUI paths", async () => {
    const exec = vi.fn(async () => ({ stdout: "/home/me/bin:/usr/bin\n" }));
    await expect(discoverSessionEnvironment({ PATH: "/inherited" }, "linux", exec)).resolves.toMatchObject({
      PATH: "/home/me/bin:/usr/bin",
    });
    expect(exec).toHaveBeenCalledWith("/bin/bash", ["--login", "-c", "printf '%s' \"$PATH\""], expect.any(Object));

    const fallback = await discoverSessionEnvironment({ PATH: "/inherited" }, "linux", async () => {
      throw new Error("timeout");
    });
    expect(fallback.PATH?.split(":" )).toEqual(
      expect.arrayContaining(["/inherited", "/usr/local/bin", "/usr/bin", "/bin"]),
    );
  });

  it("strips stray quotes from a Windows PATH so cmd.exe and Rust still search every entry", async () => {
    // A lone `"` (e.g. `C:\Program Files\WSL"`) makes cmd.exe and Rust's split_paths treat the rest
    // of PATH as one quoted entry: codex then cannot find `npm`, and its cmd shim cannot find `node`.
    const env = await discoverSessionEnvironment(
      { Path: String.raw`C:\Windows;C:\Program Files\WSL";C:\Program Files\nodejs\;;"C:\Quoted Dir"` },
      "win32",
    );
    expect(env.Path).toBe(String.raw`C:\Windows;C:\Program Files\WSL;C:\Program Files\nodejs\;C:\Quoted Dir`);
    expect(env.PATH).toBeUndefined();
  });

  // The app inherits whatever launched it. Started from an agent's tool shell (an agent running
  // `Start-Process` on it), every terminal would carry that agent's session: Claude then believes
  // it is a nested child, stops saving transcripts and, with the shell's NO_COLOR, renders in grey.
  const agentToolShell = {
    CLAUDECODE: "1",
    CLAUDE_CODE_CHILD_SESSION: "1",
    CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_SESSION_ID: "e1fdbd97-13f1-4695-b1b4-9836cae4c89e",
    CLAUDE_CODE_SESSION_ATTENDED: "1",
    CLAUDE_CODE_MESSAGING_SOCKET: String.raw`\\.\pipe\LOCAL\cc-msg-c72696b2`,
    CLAUDE_CODE_MESSAGING_TOKEN: "secret",
    CLAUDE_PID: "51464",
    AI_AGENT: "claude-code_2-1-316_agent",
    CODEX_COMPANION_SESSION_ID: "e1fdbd97-13f1-4695-b1b4-9836cae4c89e",
    NO_COLOR: "1",
    GIT_EDITOR: "true",
    GIT_ASKPASS: "",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    PSExecutionPolicyPreference: "Bypass",
    NoDefaultCurrentDirectoryInExePath: "1",
    COREPACK_ENABLE_AUTO_PIN: "0",
    PYTHONIOENCODING: "utf-8:surrogateescape",
  };
  const userConfiguration = {
    CLAUDE_CODE_SUBAGENT_MODEL: "sonnet",
    CLAUDE_CONFIG_DIR: String.raw`C:\Users\me\.claude`,
    CODEX_HOME: String.raw`C:\Users\me\.codex`,
    USERPROFILE: String.raw`C:\Users\me`,
  };

  it("starts sessions as top-level sessions when the app was launched from an agent's tool shell", async () => {
    const env = await discoverSessionEnvironment(
      { Path: String.raw`C:\Windows`, ...userConfiguration, ...agentToolShell },
      "win32",
    );
    expect(env).toEqual({ Path: String.raw`C:\Windows`, ...userConfiguration });
  });

  it("keeps a user's own NO_COLOR and git settings when no agent session launched the app", async () => {
    const own = { Path: String.raw`C:\Windows`, NO_COLOR: "1", GIT_EDITOR: "code --wait", GIT_TERMINAL_PROMPT: "0" };
    await expect(discoverSessionEnvironment(own, "win32")).resolves.toEqual(own);
  });

  it("matches agent variables case-insensitively only on Windows, where names are case-insensitive", async () => {
    const mixedCase = { Path: String.raw`C:\Windows`, ClaudeCode: "1", No_Color: "1" };
    await expect(discoverSessionEnvironment(mixedCase, "win32")).resolves.toEqual({ Path: String.raw`C:\Windows` });
    const exec = async () => ({ stdout: "/usr/bin" });
    await expect(discoverSessionEnvironment({ PATH: "/usr/bin", ClaudeCode: "1", No_Color: "1" }, "linux", exec)).resolves.toEqual({
      PATH: "/usr/bin",
      ClaudeCode: "1",
      No_Color: "1",
    });
  });

  it("does not hand an agent's session to the login shell that discovers the Linux PATH", async () => {
    const exec = vi.fn(async () => ({ stdout: "/usr/bin" }));
    const env = await discoverSessionEnvironment({ PATH: "/inherited", HOME: "/home/me", ...agentToolShell }, "linux", exec);
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/me" });
    expect(exec).toHaveBeenCalledWith(
      "/bin/bash",
      expect.any(Array),
      expect.objectContaining({ env: { PATH: "/inherited", HOME: "/home/me" } }),
    );
  });
});
