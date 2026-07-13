export interface DiffLine {
  kind: "add" | "del" | "hunk" | "meta" | "context";
  text: string;
}

export interface DiffFileView {
  path: string;
  lines: DiffLine[];
}

const META_PREFIXES = [
  "+++",
  "---",
  "index ",
  "new file",
  "deleted file",
  "similarity",
  "dissimilarity",
  "rename",
  "copy",
  "old mode",
  "new mode",
  "Binary files",
  "\\ No newline",
];

/** `diff --git a/<p> b/<p>` — the b-side is the file's current name; git quotes paths with spaces. */
function headerPath(header: string): string {
  const quoted = header.lastIndexOf(' "b/');
  if (quoted !== -1) return header.slice(quoted + 4).replace(/"$/, "");
  const plain = header.lastIndexOf(" b/");
  if (plain !== -1) return header.slice(plain + 3);
  return header.slice("diff --git ".length);
}

/**
 * Splits one `git diff` output into per-file line lists the view can colour. This is a renderer of
 * git's own output, not a validator: an unrecognised line simply renders as context.
 */
export function parseUnifiedDiff(diff: string): DiffFileView[] {
  const files: DiffFileView[] = [];
  let current: DiffFileView | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = { path: headerPath(line), lines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("@@")) current.lines.push({ kind: "hunk", text: line });
    else if (META_PREFIXES.some((prefix) => line.startsWith(prefix))) current.lines.push({ kind: "meta", text: line });
    else if (line.startsWith("+")) current.lines.push({ kind: "add", text: line });
    else if (line.startsWith("-")) current.lines.push({ kind: "del", text: line });
    else current.lines.push({ kind: "context", text: line });
  }
  return files;
}
