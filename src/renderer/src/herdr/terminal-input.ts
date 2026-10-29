import type { ClientKeyCode, ClientPaneInputEvent } from "@shared/herdr-surface-types";

export interface KeyLike { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; repeat?: boolean; isComposing?: boolean; keyCode?: number }
export const modifiers = (event: Pick<KeyLike, "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): number => (event.shiftKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.altKey ? 4 : 0) | (event.metaKey ? 8 : 0);
const named: Record<string, ClientKeyCode> = { Backspace: "Backspace", Enter: "Enter", ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Tab: "Tab", Delete: "Delete", Insert: "Insert", Escape: "Esc" };
export function keyInput(event: KeyLike): ClientPaneInputEvent | null {
  if (event.isComposing || event.keyCode === 229) return null;
  let code = named[event.key];
  if (event.key === "Tab" && event.shiftKey) code = "BackTab";
  const f = /^F([1-9]|1\d|2[0-4])$/.exec(event.key);
  if (f) code = { F: Number(f[1]) };
  if (!code && (event.ctrlKey || event.altKey || event.metaKey) && [...event.key].length === 1) code = { Char: event.key };
  if (!code) return null;
  return { Key: { code, modifiers: modifiers(event), kind: event.repeat ? "Repeat" : "Press", repeat_count: 1,
    shifted_codepoint: null, generated_text: null, tracks_release: false, physical_key_id: null, windows_record: null } };
}
/** Browser IMEs may emit a final input before or after compositionend. */
export class CompositionInput {
  private composing = false;
  private committed: { text: string; at: number } | null = null;
  start(): void { this.composing = true; this.committed = null; }
  end(text: string, now = Date.now()): ClientPaneInputEvent | null {
    this.composing = false;
    this.committed = { text, at: now };
    return text ? { TextCommit: text } : null;
  }
  input(text: string, isComposing = false, now = Date.now()): ClientPaneInputEvent | null {
    if (this.composing || isComposing || !text) return null;
    const previous = this.committed;
    this.committed = null;
    if (previous && previous.text === text && now - previous.at < 150) return null;
    return { TextCommit: text };
  }
}
