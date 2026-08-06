import { describe, expect, it } from "vitest";
import type { ProjectStatus } from "@shared/project-types";
import { folderStatusClass, isFolderDone, nextFolderStatus } from "./folder-status";

const ALL_STATUSES: Array<ProjectStatus | null> = [null, "진행중", "보류", "완료", "보관"];

describe("isFolderDone", () => {
  it("treats only 완료 as done", () => {
    expect(isFolderDone("완료")).toBe(true);
    expect(isFolderDone("진행중")).toBe(false);
  });

  it("reads a folder that was never touched as still being worked on", () => {
    expect(isFolderDone(null)).toBe(false);
  });

  it("reads the statuses the sidebar cannot produce as 작업중 rather than a missing state", () => {
    expect(isFolderDone("보류")).toBe(false);
    expect(isFolderDone("보관")).toBe(false);
  });
});

describe("nextFolderStatus", () => {
  it("closes the round trip between the two values the toggle writes", () => {
    expect(nextFolderStatus("진행중")).toBe("완료");
    expect(nextFolderStatus("완료")).toBe("진행중");
  });

  it("sends every other status into 완료 on the first press", () => {
    expect(nextFolderStatus(null)).toBe("완료");
    expect(nextFolderStatus("보류")).toBe("완료");
    expect(nextFolderStatus("보관")).toBe("완료");
  });

  it("never leaves a folder in a status the toggle cannot move again", () => {
    for (const status of ALL_STATUSES) {
      const next = nextFolderStatus(status);
      expect(nextFolderStatus(next)).not.toBe(next);
    }
  });
});

describe("folderStatusClass", () => {
  it("gives each of the two visual states its own class", () => {
    expect(folderStatusClass("완료")).toBe("folder-done");
    expect(folderStatusClass("진행중")).toBe("folder-working");
    expect(folderStatusClass(null)).toBe("folder-working");
  });

  it("lands on exactly two classes across every status the registry accepts", () => {
    expect(new Set(ALL_STATUSES.map(folderStatusClass))).toEqual(
      new Set(["folder-done", "folder-working"]),
    );
  });
});
