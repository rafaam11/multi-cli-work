/**
 * The text offsets that select a 1-based line from a 1-based column to its end — what a terminal
 * link's `file.ts:42:7` asks the viewer to show. A line or column past the end lands on the last one.
 */
export function lineSelection(text: string, line: number, column: number): { start: number; end: number } {
  let start = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf("\n", start);
    if (next === -1) break;
    start = next + 1;
  }
  let end = text.indexOf("\n", start);
  if (end === -1) end = text.length;
  if (end > start && text[end - 1] === "\r") end -= 1;
  return { start: Math.min(start + column - 1, end), end };
}
