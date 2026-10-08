import type { TerminalSessionView } from "@shared/api-types";
import { describe, expect, it } from "vitest";
import { applyEvent, folderViewKeyOf, mergeAttachedSession, replaceSession, restoreShelves } from "./app-model";

function makeSession(id: string, overrides: Partial<TerminalSessionView> = {}): TerminalSessionView {
  return {
    id,
    projectId: "project-atlas",
    tool: null,
    title: null,
    name: id,
    kind: "powershell",
    cwd: "C:\\work\\atlas",
    providerConversationId: null,
    interruptedByShutdown: false,
    status: "idle",
    pid: 4100,
    exitCode: null,
    createdAt: "2026-07-11T01:00:00.000Z",
    updatedAt: "2026-07-11T01:00:00.000Z",
    ...overrides,
  };
}

describe("folderViewKeyOf", () => {
  it("keys a worktree apart from its project and tool sessions apart from both", () => {
    expect(folderViewKeyOf("p1", null)).toBe("p1");
    expect(folderViewKeyOf("p1", "w1")).toBe("@worktree:w1");
    expect(folderViewKeyOf(null, null)).toBe("@tools");
  });
});

describe("replaceSession", () => {
  it("replaces a known session in place and appends a new one", () => {
    const a = makeSession("a");
    const b = makeSession("b");
    expect(replaceSession([a, b], { ...a, name: "renamed" }).map((session) => session.name)).toEqual(["renamed", "b"]);
    expect(replaceSession([a], b).map((session) => session.id)).toEqual(["a", "b"]);
  });
});

describe("mergeAttachedSession", () => {
  it("keeps a finished session finished when a stale attach reports it running", () => {
    const exited = makeSession("a", { status: "exited" });
    expect(mergeAttachedSession([exited], makeSession("a", { status: "working" }))[0]!.status).toBe("exited");
  });

  it("takes the attached state when the session came back after an app shutdown", () => {
    const interrupted = makeSession("a", { status: "exited", interruptedByShutdown: true });
    expect(mergeAttachedSession([interrupted], makeSession("a", { status: "working" }))[0]!.status).toBe("working");
  });
});

describe("applyEvent", () => {
  it("applies status, title, and exit events", () => {
    const session = makeSession("a");
    expect(applyEvent(session, { type: "status", sessionId: "a", status: "working" }).status).toBe("working");
    expect(applyEvent(session, { type: "title", sessionId: "a", title: "t" }).title).toBe("t");
    expect(applyEvent(session, { type: "exit", sessionId: "a", exitCode: 3 })).toMatchObject({ status: "exited", pid: null, exitCode: 3 });
  });
});

describe("restoreShelves", () => {
  it("turns the panes visible before v1.14 into the workspace shelf", () => {
    const shelves = restoreShelves(undefined, undefined, ["a", "b"], ["a", "b"]);
    expect(shelves.active.slots).toEqual(["a", "b"]);
    expect(shelves.hidden.slots).toEqual([]);
  });
});
