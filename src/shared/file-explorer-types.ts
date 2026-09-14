/** Same target shape App.tsx already uses to pick between a project's root and a worktree's. */
export type FileExplorerTarget = { kind: "project"; id: string } | { kind: "worktree"; id: string };

export interface FileTreeEntry {
  name: string;
  /** POSIX-slashed, relative to the target's root — never an absolute filesystem path. */
  relativePath: string;
  kind: "file" | "directory";
  /** Lowercase, no leading dot. null for directories and extension-less files. */
  extension: string | null;
  /** Computed by the main process using the native platform's executable rules. */
  executable: boolean;
  /** From `fs.stat`, already fetched to list the row — 0 for directories. */
  mtimeMs: number;
}

export interface WorkspaceChangedPath {
  /** POSIX-slashed, relative to the target's root — same convention as FileTreeEntry. */
  relativePath: string;
  kind: "file";
  /** ms since epoch, from Date.now() when the edit was collected. */
  at: number;
}

/**
 * What the tree highlighting needs: files an agent edited this run, plus the cutoff the renderer
 * uses to tell "changed since the app started (or since 지우기)" apart from older, untouched files.
 */
export interface WorkspaceChangedPaths {
  agentPaths: WorkspaceChangedPath[];
  baselineMs: number;
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

/**
 * Opened as a browser-rendered preview (relative CSS/JS/images load like a real page) rather than
 * plain text; the same file stays editable through the preview's "소스" toggle.
 */
export const HTML_EXTENSIONS: readonly string[] = ["html", "htm"];

/** Executables are deliberately kept separate from editable text formats. */
export const EXECUTABLE_EXTENSIONS: readonly string[] = ["exe"];

/**
 * Extensions the OS would run rather than merely open — Windows executes these on double-click the
 * same way it runs a `.exe`. "연결 프로그램으로 열기" gates every one of them behind a confirmation
 * modal so cloning a repository and opening `build.bat` cannot execute it by accident.
 */
export const RUN_CONFIRM_EXTENSIONS: readonly string[] = [
  "exe",
  "bat",
  "cmd",
  "com",
  "scr",
  "msi",
  "msp",
  "ps1",
  "psm1",
  "vbs",
  "vbe",
  "js",
  "jse",
  "wsf",
  "wsh",
  "lnk",
  "reg",
  "hta",
  "cpl",
  "jar",
];

/**
 * True when opening this entry with the OS's associated program would run code rather than display
 * it. On win32 this is the fixed extension list above (matches how Explorer treats these files); on
 * other platforms it falls back to the file's own executable bit, which the caller must supply since
 * this function never touches the filesystem.
 */
export function needsRunConfirmation(fileName: string, platform: NodeJS.Platform, executable: boolean): boolean {
  if (platform === "win32") {
    const dot = fileName.lastIndexOf(".");
    const extension = dot > 0 ? fileName.slice(dot + 1).toLocaleLowerCase("en-US") : "";
    return RUN_CONFIRM_EXTENSIONS.includes(extension);
  }
  return executable;
}
