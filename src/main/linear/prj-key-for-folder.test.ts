import { describe, expect, it } from "vitest";
import { workspacePathKey } from "../../shared/workspace-path";
import type { WorkspaceShellInfo, WorkspaceSnapshot } from "../../shared/workspace-types";
import { prjKeyForFolder } from "./prj-key-for-folder";

function shell(key: string, archived = false): WorkspaceShellInfo {
  const channel = archived ? "projects/_archive" : "projects";
  return {
    root: "C:\\work",
    ref: `${channel}/${key}`,
    channel,
    shell: key,
    groupLabel: "",
    topics: [],
    title: key,
    status: null,
    mode: null,
    archived,
    path: `C:\\work\\${channel.replace("/", "\\")}\\${key}`,
    repos: [],
    externalPaths: [],
    data: [],
    drivePath: null,
    wikiPath: null,
  };
}

function snapshot(owners: Record<string, string>, shells: WorkspaceShellInfo[]): WorkspaceSnapshot {
  return {
    registry: {
      schemaVersion: 1,
      updatedAt: "",
      roots: [{ label: "work", work: "C:\\work", dev: "C:\\dev", data: "C:\\data" }],
      shellLinks: [],
    },
    shells,
    repoOwners: Object.fromEntries(Object.entries(owners).map(([repoPath, ref]) => [workspacePathKey(repoPath, "win32"), ref])),
    warnings: [],
  };
}

const live = snapshot(
  {
    "C:\\dev\\multi-cli-work": "projects/PRJ-0017-secondbrain",
    "C:\\dev\\old-tool": "projects/_archive/PRJ-0003-old",
  },
  [shell("PRJ-0017-secondbrain"), shell("PRJ-0003-old", true)],
);

describe("prjKeyForFolder", () => {
  it("maps a repo path to its PRJ key", () => {
    expect(prjKeyForFolder("C:\\dev\\multi-cli-work", live, "win32")).toBe("PRJ-0017");
  });

  it("maps a nested path through its ancestor repo", () => {
    expect(prjKeyForFolder("C:\\dev\\multi-cli-work\\src\\main", live, "win32")).toBe("PRJ-0017");
  });

  it("returns null for archived projects and unmapped folders", () => {
    expect(prjKeyForFolder("C:\\dev\\old-tool", live, "win32")).toBeNull();
    expect(prjKeyForFolder("C:\\dev\\somewhere-else", live, "win32")).toBeNull();
  });

  it("uses win32 path keys case-insensitively", () => {
    expect(prjKeyForFolder("c:\\DEV\\Multi-CLI-Work", live, "win32")).toBe("PRJ-0017");
  });
});
