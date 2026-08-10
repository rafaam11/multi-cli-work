import type { TerminalStatus } from "@shared/terminal-types";
import { describe, expect, it } from "vitest";
import { folderActivityClass, isFolderActive } from "./folder-status";

const ALL_STATUSES: TerminalStatus[] = [
  "starting",
  "working",
  "awaiting-input",
  "awaiting-approval",
  "idle",
  "exited",
  "error",
];

function sessions(...statuses: TerminalStatus[]) {
  return statuses.map((status) => ({ status }));
}

describe("isFolderActive", () => {
  it("counts a folder active while an agent is running or waiting on the user", () => {
    expect(isFolderActive(sessions("starting"))).toBe(true);
    expect(isFolderActive(sessions("working"))).toBe(true);
    expect(isFolderActive(sessions("awaiting-input"))).toBe(true);
    expect(isFolderActive(sessions("awaiting-approval"))).toBe(true);
  });

  it("leaves a folder quiet when nothing is running", () => {
    expect(isFolderActive(sessions("idle", "exited", "error"))).toBe(false);
  });

  it("reads an empty folder as quiet rather than unknown", () => {
    expect(isFolderActive([])).toBe(false);
  });

  it("takes one busy session as enough, whatever the others are doing", () => {
    expect(isFolderActive(sessions("idle", "exited", "working"))).toBe(true);
  });
});

describe("folderActivityClass", () => {
  it("names the two colours the sidebar can paint", () => {
    expect(folderActivityClass(sessions("working"))).toBe("folder-active");
    expect(folderActivityClass(sessions("idle"))).toBe("folder-idle");
    expect(folderActivityClass([])).toBe("folder-idle");
  });

  it("never invents a third class, whatever a session reports", () => {
    expect(new Set(ALL_STATUSES.map((status) => folderActivityClass(sessions(status))))).toEqual(
      new Set(["folder-active", "folder-idle"]),
    );
  });
});
