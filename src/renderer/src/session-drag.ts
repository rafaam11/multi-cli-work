import type { DragEvent as ReactDragEvent } from "react";

/**
 * How a session id travels in a drag: a tab onto a slot, a tab onto a workspace row, a pane onto
 * another pane. A type of our own is what lets a drop target tell a session apart from the folder
 * rows the sidebar already drags — those carry only `text/plain`.
 */
export const SESSION_DRAG_TYPE = "application/x-multi-cli-session";

/**
 * Both effects have to be allowed, and the two drops really do differ: onto a slot the pane moves,
 * onto a workspace row it is copied — the folder keeps its own tab. A drag that allowed only "move"
 * would have the workspace row's `dropEffect = "copy"` rejected as incompatible, and the browser
 * cancels such a drop outright: the `drop` event never fires and the pane silently never arrives.
 */
export const SESSION_DRAG_EFFECT_ALLOWED = "copyMove";

export function startSessionDrag(event: ReactDragEvent, sessionId: string): void {
  event.dataTransfer.setData(SESSION_DRAG_TYPE, sessionId);
  // Some platforms refuse to start a drag without text/plain, so the id goes in twice.
  event.dataTransfer.setData("text/plain", sessionId);
  event.dataTransfer.effectAllowed = SESSION_DRAG_EFFECT_ALLOWED;
}

/** Whether a drop target's `dropEffect` is one this drag permits — an incompatible pair drops nothing. */
export function allowsDropEffect(dropEffect: string): boolean {
  return dropEffect === "copy" || dropEffect === "move";
}

/**
 * Whether this drag carries a session. `dragover` may not read the payload — only the type list —
 * which is exactly why the id is announced through a type of its own.
 */
export function isSessionDrag(event: ReactDragEvent): boolean {
  return Array.from(event.dataTransfer.types ?? []).includes(SESSION_DRAG_TYPE);
}

export function readSessionDrag(event: ReactDragEvent): string | null {
  const id = event.dataTransfer.getData(SESSION_DRAG_TYPE) || event.dataTransfer.getData("text/plain");
  return id.length > 0 ? id : null;
}
