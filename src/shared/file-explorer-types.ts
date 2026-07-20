/** Same target shape App.tsx already uses to pick between a project's root and a worktree's. */
export type FileExplorerTarget = { kind: "project"; id: string } | { kind: "worktree"; id: string };

export interface FileTreeEntry {
  name: string;
  /** POSIX-slashed, relative to the target's root — never an absolute filesystem path. */
  relativePath: string;
  kind: "file" | "directory";
  /** Lowercase, no leading dot. null for directories and extension-less files. */
  extension: string | null;
}

export interface WorkspaceFileContent {
  relativePath: string;
  encoding: "utf8" | "base64";
  content: string;
  /** True when the file was larger than the preview cap and `content` was cut short. */
  truncated: boolean;
  sizeBytes: number;
}

/** Extensions read as base64 and rendered with an <img>, in both the main-process reader and the renderer's category picker. */
export const IMAGE_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"];

export const MARKDOWN_EXTENSIONS: readonly string[] = ["md", "markdown"];

/** Executables are deliberately kept separate from editable text formats. */
export const EXECUTABLE_EXTENSIONS: readonly string[] = ["exe"];
