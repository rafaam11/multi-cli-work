import { describe, expect, it } from "vitest";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { applySessionMessage, groupSessions } from "./session-list-model";

const s = (id: string, overrides: Partial<RemoteSessionSummary> = {}): RemoteSessionSummary => ({
  id,
  projectId: "p",
  projectName: "A",
  kind: "claude",
  label: id,
  status: "working",
  updatedAt: "2026-09-30T00:00:00.000Z",
  ...overrides,
});

describe("applySessionMessage", () => {
  it("replaces, adds, and updates sessions", () => {
    let list = applySessionMessage([], { type: "sessions", sessions: [s("1")] });
    list = applySessionMessage(list, { type: "created", session: s("2") });
    list = applySessionMessage(list, { type: "created", session: s("2", { label: "again" }) });
    list = applySessionMessage(list, { type: "status", sessionId: "1", status: "awaiting-input" });
    list = applySessionMessage(list, { type: "title", sessionId: "2", title: "새 제목" });
    list = applySessionMessage(list, { type: "exit", sessionId: "1", exitCode: 0 });
    expect(list.map((entry) => [entry.id, entry.status, entry.label])).toEqual([
      ["1", "exited", "1"],
      ["2", "working", "새 제목"],
    ]);
  });

  it("ignores unrelated messages and returns the same array", () => {
    const list = [s("1")];
    expect(applySessionMessage(list, { type: "data", sessionId: "1", data: "x", sequence: 1 })).toBe(list);
  });
});

describe("groupSessions", () => {
  it("groups by project, newest first, with folderless sessions last", () => {
    const groups = groupSessions([
      s("old", { projectName: "B", updatedAt: "2026-09-29T00:00:00.000Z" }),
      s("tool", { projectId: null, projectName: null }),
      s("new", { projectName: "B", updatedAt: "2026-09-30T01:00:00.000Z" }),
      s("a", { projectName: "A" }),
    ]);
    expect(groups.map((group) => [group.projectName, group.sessions.map((entry) => entry.id)])).toEqual([
      ["A", ["a"]],
      ["B", ["new", "old"]],
      ["폴더 없음", ["tool"]],
    ]);
  });
});
