// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseVersionProperties, shellManifest } from "./prepare-mobile-shell.mjs";

describe("prepare-mobile-shell", () => {
  it("reads the shell version", () => {
    expect(parseVersionProperties("# c\nshellVersionCode=3\nshellVersionName=0.3.0\n")).toEqual({ versionCode: 3, versionName: "0.3.0" });
    expect(() => parseVersionProperties("shellVersionName=0.3.0")).toThrow(/shellVersionCode/);
  });

  it("describes the APK the desktop will serve", () => {
    const apk = Buffer.from("APK");
    expect(shellManifest({ versionCode: 3, versionName: "0.3.0" }, apk)).toEqual({
      versionCode: 3,
      versionName: "0.3.0",
      sha256: createHash("sha256").update(apk).digest("hex"),
    });
  });
});
