import { describe, expect, it } from "vitest";
import type { TerminalSessionView } from "@shared/api-types";
import type { BoardMessage } from "@shared/board-types";
import {
  activeMentions,
  boardMembers,
  boardRelativeTime,
  boardTextParts,
  continuesTurn,
  deliveryLabel,
  mentionQueryAt,
  mergeBoardMessage,
} from "./board-model";

function message(id: string, createdAt: string, overrides: Partial<BoardMessage> = {}): BoardMessage {
  return { id, projectId: "p", author: { kind: "user" }, kind: "post", text: id, to: [], createdAt, ...overrides };
}

describe("mergeBoardMessage", () => {
  it("appends, replaces by id, and keeps time order when a message arrives late", () => {
    const a = message("a", "2026-10-18T00:00:01Z");
    const b = message("b", "2026-10-18T00:00:03Z");
    let list = mergeBoardMessage([a], b);
    expect(list.map((entry) => entry.id)).toEqual(["a", "b"]);
    list = mergeBoardMessage(list, { ...a, text: "patched" });
    expect(list[0].text).toBe("patched");
    list = mergeBoardMessage(list, message("late", "2026-10-18T00:00:02Z"));
    expect(list.map((entry) => entry.id)).toEqual(["a", "late", "b"]);
  });
});

describe("boardRelativeTime", () => {
  it("reads minutes, hours, then the date", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    expect(boardRelativeTime("2026-10-18T11:59:30Z", now)).toBe("방금");
    expect(boardRelativeTime("2026-10-18T11:55:00Z", now)).toBe("5분 전");
    expect(boardRelativeTime("2026-10-18T09:00:00Z", now)).toBe("3시간 전");
    expect(boardRelativeTime("2026-10-10T09:00:00Z", now)).toMatch(/10월 10일/);
  });
});

describe("boardMembers", () => {
  it("keeps the folder's running sessions, not tools or finished ones", () => {
    const base = { tool: null, status: "idle", projectId: "p" } as Partial<TerminalSessionView>;
    const sessions = [
      { ...base, id: "1" },
      { ...base, id: "2", projectId: "other" },
      { ...base, id: "3", status: "exited" },
      { ...base, id: "4", tool: "claude-update" },
    ] as TerminalSessionView[];
    expect(boardMembers(sessions, "p").map((session) => session.id)).toEqual(["1"]);
    expect(boardMembers(sessions, null)).toEqual([]);
  });
});

describe("mentions", () => {
  it("finds the @query at the caret and only after whitespace", () => {
    expect(mentionQueryAt("hi @rev", 7)).toEqual({ start: 3, query: "rev" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("mail@host", 9)).toBeNull();
    expect(mentionQueryAt("@rev done", 9)).toBeNull();
  });

  it("drops a mention whose name was deleted from the text", () => {
    const mentions = new Map([["s1", "리뷰어"], ["s2", "빌더"]]);
    expect(activeMentions("@리뷰어 봐줘", mentions)).toEqual(["s1"]);
  });
});

describe("boardTextParts", () => {
  it("splits fenced code and drops the language line", () => {
    expect(boardTextParts("보세요\n```ts\nconst a = 1;\n```\n끝")).toEqual([
      { code: false, text: "보세요\n" },
      { code: true, text: "const a = 1;\n" },
      { code: false, text: "\n끝" },
    ]);
    expect(boardTextParts("inline ```x``` ok")).toEqual([
      { code: false, text: "inline " },
      { code: true, text: "x" },
      { code: false, text: " ok" },
    ]);
  });
});

describe("continuesTurn and deliveryLabel", () => {
  it("joins quick posts by the same author only", () => {
    const first = message("a", "2026-10-18T00:00:00Z");
    expect(continuesTurn(first, message("b", "2026-10-18T00:01:00Z"))).toBe(true);
    expect(continuesTurn(first, message("b", "2026-10-18T00:05:00Z"))).toBe(false);
    expect(continuesTurn(first, message("b", "2026-10-18T00:01:00Z", { author: { kind: "system" } }))).toBe(false);
    expect(continuesTurn(first, message("b", "2026-10-18T00:01:00Z", { kind: "direct" }))).toBe(false);
  });

  it("names each delivery state", () => {
    const recipient = { sessionId: "s", name: "s", agent: "codex" };
    expect(deliveryLabel({ ...recipient, delivery: "held", reason: "working" })).toBe("보류: 작업이 끝나면 전달");
    expect(deliveryLabel({ ...recipient, delivery: "failed", reason: "종료됨" })).toBe("실패: 종료됨");
    expect(deliveryLabel(recipient)).toBe("");
  });
});
