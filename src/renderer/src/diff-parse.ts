export interface DiffLine {
  kind: "add" | "del" | "hunk" | "meta" | "context";
  text: string;
  oldLine: number | null;
  newLine: number | null;
  id: string;
}

export interface DiffFileView {
  path: string;
  lines: DiffLine[];
  binary: boolean;
  truncated: boolean;
  noNewline: boolean;
  changeType: "added" | "deleted" | "renamed" | "modified";
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
  return diff.split(/(?=^diff --git )/m).filter((chunk) => chunk.startsWith("diff --git ")).map((chunk) => {
    const firstLineEnd = chunk.indexOf("\n");
    const header = firstLineEnd < 0 ? chunk : chunk.slice(0, firstLineEnd);
    return parseDiffFile(headerPath(header), firstLineEnd < 0 ? "" : chunk.slice(firstLineEnd + 1));
  });
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiffFile(path: string, patch: string, truncated = false): DiffFileView {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let sequence = 0;
  const push = (kind: DiffLine["kind"], text: string, oldValue: number | null, newValue: number | null) => {
    lines.push({ kind, text, oldLine: oldValue, newLine: newValue, id: `${path}:${oldValue ?? "-"}:${newValue ?? "-"}:${sequence++}` });
  };
  const patchLines = patch ? patch.split("\n") : [];
  if (patchLines.at(-1) === "") patchLines.pop();
  for (const line of patchLines) {
    if (line.startsWith("diff --git ")) continue;
    const hunk = HUNK.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      push("hunk", line, null, null);
    } else if (META_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      push("meta", line, null, null);
    } else if (line.startsWith("+")) {
      push("add", line, null, newLine++);
    } else if (line.startsWith("-")) {
      push("del", line, oldLine++, null);
    } else {
      push("context", line, oldLine++, newLine++);
    }
  }
  return {
    path,
    lines,
    binary: /^(Binary files|GIT binary patch)/m.test(patch),
    truncated,
    noNewline: /\\ No newline at end of file/.test(patch),
    changeType: /^new file/m.test(patch) ? "added" : /^deleted file/m.test(patch) ? "deleted" : /^rename (from|to)/m.test(patch) ? "renamed" : "modified",
  };
}
