// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { PcRootsSettings } from "../../shared/settings-types";
import { PcRootsProvider, detectPcRoots, resolvePcRoots } from "./pc-roots";

const none: PcRootsSettings = { dev: null, data: null, work: null, drive: null };

describe("detectPcRoots", () => {
  it("Windows는 C·D 순으로 dev·data·work를, 드라이브 문자에서 내 드라이브를 찾는다", () => {
    const existing = new Set(["D:\\dev", "C:\\data", "D:\\data", "H:\\My Drive"]);
    const roots = detectPcRoots({ platform: "win32", home: "C:\\Users\\u", isDirectory: (p) => existing.has(p) });
    expect(roots).toEqual({ dev: "D:\\dev", data: "C:\\data", work: null, drive: "H:\\My Drive" });
  });

  it("G:의 한글 이름을 먼저 보고, 없으면 미러 모드의 홈 아래 폴더를 본다", () => {
    expect(
      detectPcRoots({ platform: "win32", home: "C:\\Users\\u", isDirectory: (p) => p === "G:\\내 드라이브" || p === "G:\\My Drive" }).drive,
    ).toBe("G:\\내 드라이브");
    expect(
      detectPcRoots({ platform: "win32", home: "C:\\Users\\u", isDirectory: (p) => p === "C:\\Users\\u\\My Drive" }).drive,
    ).toBe("C:\\Users\\u\\My Drive");
  });

  it("POSIX는 홈 아래 관례 폴더를 본다", () => {
    const roots = detectPcRoots({ platform: "linux", home: "/home/u", isDirectory: (p) => p === "/home/u/dev" });
    expect(roots).toEqual({ dev: "/home/u/dev", data: null, work: null, drive: null });
  });
});

describe("resolvePcRoots", () => {
  it("지정값이 탐지값을 이기고, 지정이 없으면 탐지값을 쓴다", () => {
    const info = resolvePcRoots({ ...none, dev: "E:\\code" }, { ...none, dev: "C:\\dev", drive: "G:\\내 드라이브" }, "C:\\Users\\u");
    expect(info.effective).toEqual({ dev: "E:\\code", data: null, work: null, drive: "G:\\내 드라이브" });
  });

  it("문서 루트 종류는 지정값이 이기고, 없으면 실제 루트 경로로 짐작한다", () => {
    const detected = { ...none, drive: "G:\\내 드라이브" };
    expect(resolvePcRoots(none, detected, "C:\\Users\\u").driveKind).toEqual({ configured: null, effective: "gdrive" });
    expect(resolvePcRoots({ ...none, drive: "\\\\nas\\docs" }, detected, "C:\\Users\\u").driveKind.effective).toBe("nas");
    expect(resolvePcRoots(none, detected, "C:\\Users\\u", "local").driveKind).toEqual({ configured: "local", effective: "local" });
  });
});

describe("PcRootsProvider", () => {
  it("탐지는 한 번만 하고 다시 찾기에서 새로 한다", () => {
    let calls = 0;
    let configured = { ...none };
    const provider = new PcRootsProvider(() => configured, {
      platform: "win32",
      home: "C:\\Users\\u",
      isDirectory: (p) => {
        calls += 1;
        return p === "C:\\dev";
      },
    });
    expect(provider.info().effective.dev).toBe("C:\\dev");
    const afterFirst = calls;
    configured = { ...none, dev: "D:\\dev" };
    expect(provider.info().effective.dev).toBe("D:\\dev");
    expect(calls).toBe(afterFirst);
    provider.redetect();
    expect(calls).toBeGreaterThan(afterFirst);
    expect(provider.logicalRoots().home).toBe("C:\\Users\\u");
  });
});
