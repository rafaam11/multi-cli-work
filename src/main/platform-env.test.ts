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
});
