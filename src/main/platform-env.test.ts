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
});
