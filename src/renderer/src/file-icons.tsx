import { File, FileCode2, FileImage, FileJson, FileText } from "lucide-react";
import { IMAGE_EXTENSIONS, MARKDOWN_EXTENSIONS } from "@shared/file-explorer-types";

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "c", "cpp", "cc", "h", "hpp",
  "css", "scss", "html", "sh", "ps1", "sql", "yml", "yaml", "toml", "ini", "xml",
]);

export interface FileIconProps {
  extension: string | null;
  size?: number;
}

/** Picks a lucide glyph by extension category — no per-extension icon set, just a coarse grouping. */
export function FileIcon({ extension, size = 15 }: FileIconProps) {
  if (extension === "json") return <FileJson size={size} />;
  if (extension && MARKDOWN_EXTENSIONS.includes(extension)) return <FileText size={size} />;
  if (extension && IMAGE_EXTENSIONS.includes(extension)) return <FileImage size={size} />;
  if (extension && CODE_EXTENSIONS.has(extension)) return <FileCode2 size={size} />;
  return <File size={size} />;
}
