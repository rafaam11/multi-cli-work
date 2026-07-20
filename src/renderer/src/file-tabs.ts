import { EXECUTABLE_EXTENSIONS, HTML_EXTENSIONS, IMAGE_EXTENSIONS, MARKDOWN_EXTENSIONS, type FileExplorerTarget } from "@shared/file-explorer-types";

export type FileTabCategory = "markdown" | "html" | "text" | "image" | "unsupported";

/**
 * A file the user opened from the right-hand explorer. Deliberately not a TerminalSessionView —
 * that type is bound to a live PTY (pid, provider conversation id, a status a StatusAdapter
 * fills in), none of which a file has. This is tracked entirely separately and never touches the
 * terminals IPC surface.
 */
export interface OpenFileTab {
  id: string;
  target: FileExplorerTarget;
  targetLabel: string;
  relativePath: string;
  name: string;
  extension: string | null;
  category: FileTabCategory;
  encoding: "utf8" | "base64";
  content: string | null;
  originalContent: string | null;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  loadError: string | null;
  saveError: string | null;
  truncated: boolean;
}

/**
 * Extensions read as plain readable text. Deliberately not exhaustive — an extension-less file
 * (Dockerfile, LICENSE, a dotfile) falls back to "unsupported" rather than guessing whether it is
 * text or binary from content alone.
 */
const TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc", "css", "scss", "less",
  "xml", "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "txt", "log", "csv", "tsv", "sql",
  "sh", "bash", "zsh", "ps1", "bat", "cmd", "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "h", "cpp", "cc", "hpp", "cs", "php", "vue", "svelte", "astro", "graphql", "gql", "proto",
  "dockerfile", "makefile", "lock", "properties", "gradle", "r", "lua", "dart", "scala", "pl", "ex", "exs",
  "clj", "hs", "fs", "fsx", "vb", "tex", "rst", "adoc", "diff", "patch", "gitignore", "gitattributes", "editorconfig",
]);

const TEXT_FILENAMES = new Set([
  ".env", ".gitignore", ".gitattributes", ".editorconfig", ".npmrc", ".nvmrc", ".prettierrc", ".eslintrc",
  "dockerfile", "makefile", "license", "copying", "readme", "procfile",
]);

export function categorizeFile(name: string, extension: string | null): FileTabCategory {
  if (extension && MARKDOWN_EXTENSIONS.includes(extension)) return "markdown";
  if (extension && HTML_EXTENSIONS.includes(extension)) return "html";
  if (extension && IMAGE_EXTENSIONS.includes(extension)) return "image";
  if (extension && EXECUTABLE_EXTENSIONS.includes(extension)) return "unsupported";
  const lowerName = name.toLocaleLowerCase("en-US");
  if (TEXT_FILENAMES.has(lowerName) || lowerName.startsWith(".env.") || (extension && TEXT_EXTENSIONS.has(extension))) return "text";
  return "unsupported";
}

export function fileTabId(target: FileExplorerTarget, relativePath: string): string {
  return `${target.kind}:${target.id}:${relativePath}`;
}
