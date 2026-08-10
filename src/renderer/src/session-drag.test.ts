import type { DragEvent as ReactDragEvent } from "react";
import { describe, expect, it } from "vitest";
import {
  SESSION_DRAG_TYPE,
  allowsDropEffect,
  isSessionDrag,
  readSessionDrag,
  startSessionDrag,
} from "./session-drag";

/** Enough of a DataTransfer to watch what a drag writes into it. */
function dragEvent(initial: Record<string, string> = {}): ReactDragEvent {
  const store = new Map(Object.entries(initial));
  const dataTransfer = {
    effectAllowed: "uninitialized",
    dropEffect: "none",
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
  };
  return { dataTransfer } as unknown as ReactDragEvent;
}

describe("startSessionDrag", () => {
  it("announces the id under its own type and under text/plain", () => {
    const event = dragEvent();
    startSessionDrag(event, "session-1");
    expect(event.dataTransfer.getData(SESSION_DRAG_TYPE)).toBe("session-1");
    expect(event.dataTransfer.getData("text/plain")).toBe("session-1");
  });

  /**
   * The drag has two kinds of target: a grid slot moves the pane, a workspace row copies a
   * reference to it. A `dropEffect` the drag does not allow is not a cosmetic mismatch — the
   * browser cancels the drop and never fires it, which is exactly how the workspace rows went dead.
   */
  it("allows both the move a slot asks for and the copy a workspace row asks for", () => {
    const event = dragEvent();
    startSessionDrag(event, "session-1");
    expect(event.dataTransfer.effectAllowed).toBe("copyMove");
    expect(allowsDropEffect("move")).toBe(true);
    expect(allowsDropEffect("copy")).toBe(true);
    expect(allowsDropEffect("link")).toBe(false);
  });
});

describe("isSessionDrag", () => {
  it("tells a pane drag from the folder rows the sidebar drags with text/plain alone", () => {
    expect(isSessionDrag(dragEvent({ [SESSION_DRAG_TYPE]: "session-1", "text/plain": "session-1" }))).toBe(true);
    expect(isSessionDrag(dragEvent({ "text/plain": "project-1" }))).toBe(false);
  });
});

describe("readSessionDrag", () => {
  it("falls back on text/plain and reports an empty payload as nothing", () => {
    expect(readSessionDrag(dragEvent({ "text/plain": "session-1" }))).toBe("session-1");
    expect(readSessionDrag(dragEvent())).toBeNull();
  });
});
