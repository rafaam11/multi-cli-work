import { describe, expect, it } from "vitest";
import type { TerminalSessionView } from "./api-types";
import { fanOutTargets, noteTargets, promptAsTerminalInput } from "./fan-out";

function session(id: string, status: TerminalSessionView["status"], projectId = "project-1"): TerminalSessionView {
  return {
    id,
    projectId,
    tool: null,
    title: null,
    name: null,
    kind: "powershell",
    cwd: "C:\\work",
    providerConversationId: null,
    interruptedByShutdown: false,
    status,
    pid: status === "exited" || status === "error" ? null : 100,
    exitCode: null,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

describe("fanOutTargets", () => {
  it("keeps only the project's sessions that can still read input", () => {
    const sessions = [
      session("alive", "idle"),
      session("busy", "working"),
      session("dead", "exited"),
      session("broken", "error"),
      session("other", "idle", "project-2"),
    ];

    expect(fanOutTargets(sessions, "project-1").map((target) => target.id)).toEqual(["alive", "busy"]);
  });
});

describe("promptAsTerminalInput", () => {
  it("sends a single line as plain text plus Enter", () => {
    expect(promptAsTerminalInput("fix the tests")).toBe("fix the tests\r");
  });

  const ESC = String.fromCharCode(27);

  it("wraps a multiline prompt in bracketed paste so newlines cannot fire early", () => {
    expect(promptAsTerminalInput("line one\nline two")).toBe(`${ESC}[200~line one\nline two${ESC}[201~\r`);
  });

  it("normalises Windows line endings before wrapping", () => {
    expect(promptAsTerminalInput("a\r\nb")).toBe(`${ESC}[200~a\nb${ESC}[201~\r`);
  });
});

describe("noteTargets", () => {
  const root = session("root", "idle");
  const rootDead = session("root-dead", "exited");
  const inWorktree = { ...session("wt", "working"), worktreeId: "w1" };
  const otherWorktree = { ...session("wt2", "idle"), worktreeId: "w2" };
  const all = [root, rootDead, inWorktree, otherWorktree];

  it("offers the live sessions of the folder itself, not of its worktrees", () => {
    expect(noteTargets(all, { kind: "project", id: "project-1" }).map((s) => s.id)).toEqual(["root"]);
  });

  it("offers the live sessions of exactly that worktree", () => {
    expect(noteTargets(all, { kind: "worktree", id: "w1" }).map((s) => s.id)).toEqual(["wt"]);
  });
});
