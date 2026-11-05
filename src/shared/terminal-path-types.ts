import type { FileExplorerTarget } from "./file-explorer-types";

/** A terminal path confirmed by main; opening always resolves raw again for that session. */
export interface TerminalPathEntry {
  raw: string;
  kind: "file" | "directory";
  workspace?: { target: FileExplorerTarget; relativePath: string };
}
