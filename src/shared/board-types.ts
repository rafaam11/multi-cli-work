/**
 * The team board: one feed per folder where its sessions and the user talk in the open. Every
 * session-to-session `jk send` shows up here too, so the traffic between agents is never hidden in
 * their scrollback.
 */

export type BoardAuthor =
  | { kind: "session"; sessionId: string; name: string; agent: string }
  | { kind: "user" }
  | { kind: "system" };

/** `post` is said to the board; `direct` was typed into one session; `event` is the app's own line. */
export type BoardMessageKind = "post" | "direct" | "event";

export type BoardDeliveryState = "held" | "delivered" | "failed" | "dropped";

export interface BoardRecipient {
  sessionId: string;
  name: string;
  agent: string;
  /** Absent for a recipient that was only named, never typed to. */
  delivery?: BoardDeliveryState;
  /** Why it is held, or why it failed. */
  reason?: string | null;
  deliveryId?: string;
  /** Last observed message body for this recipient; absent on legacy records. */
  deliveryText?: string;
}

export interface BoardMessage {
  id: string;
  projectId: string;
  author: BoardAuthor;
  kind: BoardMessageKind;
  text: string;
  to: BoardRecipient[];
  createdAt: string;
}

export interface BoardPostInput {
  projectId: string;
  text: string;
  /** Sessions to type the post into as well. */
  mentions: string[];
}

export const BOARD_MESSAGE_MAX = 8000;
