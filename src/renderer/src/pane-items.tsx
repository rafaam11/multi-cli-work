import type { TerminalSessionView } from "@shared/api-types";
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

export interface DocumentPane {
  /** `${kind}:${...}` — unique across everything a slot can hold. */
  id: string;
  kind: DocumentKind;
  label: string;
  /** The folder it came from, shown where panes from several folders meet. */
  detail: string | null;
  /** Unsaved edits, marked on the tab the way an editor marks one. */
  dirty: boolean;
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
