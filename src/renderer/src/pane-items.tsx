import type { AgentId } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { TerminalStatus } from "@shared/terminal-types";
import { FileText, GitCompare, GitPullRequest, Network } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A pane is a terminal or a document, and the grid does not care which. Anything opened from the
 * right-hand sidebar — a file, a diff, the commit graph, a pull request — takes a slot exactly like
 * a session does, so a folder's work and the file it is about can sit side by side instead of one
 * replacing the other.
 *
 * Documents live only as long as the app runs. Their ids carry a kind prefix so a slot id says what
 * it refers to without a lookup, and so main's session bookkeeping leaves them alone.
 */
export type DocumentKind = "file" | "diff" | "graph" | "pull-request";

/**
 * The tree node a document hangs under. Every document knows the folder or worktree it was opened
 * from — that is what lets the sidebar list it beside the sessions of the same place instead of
 * pooling every open file in one bucket.
 */
export interface PaneOwner {
  kind: "project" | "worktree";
  id: string;
}

export interface DocumentPane {
  /** `${kind}:${...}` — unique across everything a slot can hold. */
  id: string;
  kind: DocumentKind;
  label: string;
  /** The folder it came from, shown where panes from several folders meet. */
  detail: string | null;
  /** Unsaved edits, marked on the row the way an editor marks a tab. */
  dirty: boolean;
  owner: PaneOwner | null;
}

/**
 * One line in a pane list. The sidebar's 작업공간 rows draw these directly, because a workspace
 * gathers panes from several folders and only App can say what each id refers to.
 */
interface PaneRowBase {
  /** The pane id: a session id, or a document id. */
  id: string;
  label: string;
  /** The folder a pane belongs to, shown where a list mixes several. */
  detail: string | null;
  /** False while the pane sits on another page; the row dims to say so. */
  onScreen: boolean;
}

export type PaneRow =
  | (PaneRowBase & { kind: "session"; status: TerminalStatus; agent: AgentId })
  | (PaneRowBase & { kind: "document"; document: DocumentKind; dirty: boolean });

/**
 * The classes on a pane's row, wherever it is drawn — the shelf lists in the sidebar and the
 * session panel below them. `current` is the focused pane and `on-screen` marks the ones the grid
 * is drawing right now; the rest read as dim. Tests pin this trio, so one function owns it rather
 * than each surface spelling it out and drifting.
 */
export function paneRowClass(
  paneId: string,
  focusedPaneId: string | null,
  onScreenPaneIds: ReadonlySet<string>,
  ...extra: string[]
): string {
  return [
    "session-row",
    ...extra,
    focusedPaneId === paneId ? "current" : "",
    onScreenPaneIds.has(paneId) ? "on-screen" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** What a slot draws. `content` is built by App: the grid stays ignorant of viewers. */
export type PaneContent =
  | { kind: "session"; session: TerminalSessionView }
  | { kind: "document"; document: DocumentPane; content: ReactNode };

export function paneContentId(item: PaneContent): string {
  return item.kind === "session" ? item.session.id : item.document.id;
}

/** Slot ids are session ids and document ids in one array; the prefix tells them apart. */
export function isDocumentPaneId(id: string): boolean {
  return /^(file|diff|graph|pull-request):/.test(id);
}

export function documentPaneId(kind: DocumentKind, key: string): string {
  return `${kind}:${key}`;
}

const DOCUMENT_ICONS = { file: FileText, diff: GitCompare, graph: Network, "pull-request": GitPullRequest };

export function DocumentPaneIcon({ kind, size = 13 }: { kind: DocumentKind; size?: number }): ReactNode {
  const Icon = DOCUMENT_ICONS[kind];
  return <Icon size={size} />;
}
