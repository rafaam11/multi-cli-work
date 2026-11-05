/**
 * Finding file paths in terminal output, for Ctrl+click links. This half is pure: it reads text and
 * maps text offsets back to buffer cells. Whether a candidate is a real file under the session's own
 * root is main's call (`workspace-files:resolve-terminal-path`); most candidates are not, and that is
 * fine — they simply never become links.
 */

export interface PathCandidate {
  /** The path as printed, without any `:line:col` suffix. */
  path: string;
  line: number | null;
  column: number | null;
  /** Offsets into the text, suffix included; `end` is exclusive. */
  start: number;
  end: number;
}

const SEGMENT = "[\\p{L}\\p{N}_.@+-]";
// Not preceded by anything that would make this the tail of a longer token — a word, another path,
// or the `://` of a URL — then an optional root (`C:\`, `/`, `./`, `../`), folders, and a file name
// with an extension that starts with a letter, so `v1.2.3` and `10.5` stay plain text. The suffix is
// `:line[:col]` (most tools) or `(line,col)` (tsc, MSBuild).
const PATH_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}_./\\\\:-])` +
    `((?:[A-Za-z]:[\\\\/]|[\\\\/]|\\.{1,2}[\\\\/])?(?:${SEGMENT}+[\\\\/])*${SEGMENT}*\\.[A-Za-z][A-Za-z0-9]{0,9})` +
    `(?::(\\d+)(?::(\\d+))?|\\((\\d+)(?:,\\s?(\\d+))?\\))?`,
  "gu",
);

export function findPathCandidates(text: string): PathCandidate[] {
  const candidates: PathCandidate[] = [];
  for (const match of text.matchAll(PATH_PATTERN)) {
    const [whole, path, colonLine, colonColumn, parenLine, parenColumn] = match;
    const line = colonLine ?? parenLine;
    const column = colonColumn ?? parenColumn;
    candidates.push({
      path,
      line: line ? Number(line) : null,
      column: column ? Number(column) : null,
      start: match.index,
      end: match.index + whole.length,
    });
  }
  // Quoted paths and Markdown destinations have explicit boundaries, so spaces and extensionless
  // names can be kept without guessing where a surrounding sentence ends.
  const delimited = /[`"'\[]([^`"'\]\r\n]+)[`"'\]]|\]\(([^)\r\n]+)\)/gu;
  for (const match of text.matchAll(delimited)) {
    const value = match[1] ?? match[2];
    if (!value || !/[\\/.]/.test(value)) continue;
    const start = match.index + match[0].indexOf(value);
    candidates.push({ path: value, line: null, column: null, start, end: start + value.length });
  }
  // A rooted path can contain spaces. Try each word boundary from longest to shortest; main
  // confirms existence, and the provider keeps only the longest successful overlapping link.
  const rooted = /(?<![\p{L}\p{N}_/\\:])(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])(?![\\/])[^\r\n`"'<>|?*]+/gu;
  for (const match of text.matchAll(rooted)) {
    const start = match.index;
    const words = [...match[0].matchAll(/\s+/g)].map((space) => space.index);
    for (const endAt of [...words, match[0].length].slice(0, 12)) {
      const value = match[0].slice(0, endAt).replace(/[.,;:!\])}]+$/u, "");
      if (value) candidates.push({ path: value, line: null, column: null, start, end: start + value.length });
    }
  }
  for (const match of text.matchAll(/(?<![\p{L}\p{N}_./\\:-])(?:[\p{L}\p{N}_.@+-]+[\\/])+[^\r\n`"'<>|?*]+/gu)) {
    const start = match.index;
    if (candidates.some((candidate) => candidate.start === start && candidate.path === match[0])) continue;
    for (const boundary of [...match[0].matchAll(/\s+/g)].map((space) => space.index).concat(match[0].length).slice(0, 12)) {
      const value = match[0].slice(0, boundary).replace(/[.,;:!\])}]+$/u, "");
      if (value.includes(" ")) candidates.push({ path: value, line: null, column: null, start, end: start + value.length });
    }
  }
  return candidates.filter((item, index) => candidates.findIndex((other) => other.start === item.start && other.end === item.end) === index);
}

/** One buffer cell as xterm reports it: a wide character's second cell has width 0 and no chars. */
export interface BufferCell {
  chars: string;
  width: number;
}

export interface LogicalLine {
  text: string;
  /** For each UTF-16 unit of `text`, the cell it was drawn in (0-based buffer coordinates). */
  cells: Array<{ x: number; y: number; width: number }>;
}

/**
 * The text of one logical line — a buffer row plus the rows it wrapped onto — with a map back to
 * cells. A wide character counts as two cells but one character of text, so string offsets cannot
 * be used as columns directly.
 */
export function logicalLineText(rows: readonly (readonly BufferCell[])[], firstRow: number): LogicalLine {
  let text = "";
  const cells: LogicalLine["cells"] = [];
  rows.forEach((row, rowOffset) => {
    row.forEach((cell, x) => {
      if (cell.width === 0) return;
      const chars = cell.chars === "" ? " " : cell.chars;
      for (let unit = 0; unit < chars.length; unit += 1) cells.push({ x, y: firstRow + rowOffset, width: cell.width });
      text += chars;
    });
  });
  const trimmed = text.trimEnd();
  return { text: trimmed, cells: cells.slice(0, trimmed.length) };
}

/** An xterm link range (1-based, inclusive) for text offsets `start`..`end` (exclusive). */
export function cellRange(line: LogicalLine, start: number, end: number) {
  const first = line.cells[start];
  const last = line.cells[end - 1];
  return {
    start: { x: first.x + 1, y: first.y + 1 },
    end: { x: last.x + last.width, y: last.y + 1 },
  };
}
