import type { FileExplorerTarget } from "@shared/file-explorer-types";
import type { IBufferCell, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { cellRange, findPathCandidates, logicalLineText, type BufferCell } from "./terminal-file-links";

export interface ResolvedFileLink {
  target: FileExplorerTarget;
  relativePath: string;
}

export interface FileLinkPosition {
  line: number;
  column: number;
}

interface FileLinkProviderOptions {
  /** Main's answer for a printed path: a file under the session's root, or null. */
  resolve(raw: string): Promise<ResolvedFileLink | null>;
  open(link: ResolvedFileLink, position: FileLinkPosition | null): void;
  /** Lets tests run without real time. */
  now?: () => number;
}

const CACHE_LIMIT = 500;
const CACHE_TTL_MS = 30_000;
/** A logical line longer than this many rows is a wall of output, not something to scan. */
const MAX_WRAPPED_ROWS = 8;
const MAX_CANDIDATES_PER_LINE = 20;
const HOVER_TITLE = "Ctrl+클릭으로 열기";

/**
 * Turns file paths a session prints into Ctrl+click links. Hovering asks main whether a candidate is
 * a real file under the session's own folder or worktree (cached, since the pointer passes over the
 * same lines again and again), and only those become links. A plain click still selects text.
 */
export function createFileLinkProvider(terminal: Terminal, options: FileLinkProviderOptions): ILinkProvider {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; value: Promise<ResolvedFileLink | null> }>();
  const resolveCached = (raw: string) => {
    const hit = cache.get(raw);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = options.resolve(raw).catch(() => null);
    cache.delete(raw);
    cache.set(raw, { at: now(), value });
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    return value;
  };

  return {
    provideLinks(y, callback) {
      const buffer = terminal.buffer.active;
      let first = y - 1;
      while (first > 0 && buffer.getLine(first)?.isWrapped && y - 1 - first < MAX_WRAPPED_ROWS) first -= 1;
      const rows: BufferCell[][] = [];
      let reusable: IBufferCell | undefined;
      for (let row = first; rows.length < MAX_WRAPPED_ROWS; row += 1) {
        const line = buffer.getLine(row);
        if (!line || (row > first && !line.isWrapped)) break;
        const cells: BufferCell[] = [];
        for (let x = 0; x < line.length; x += 1) {
          const cell = line.getCell(x, reusable);
          if (!cell) break;
          reusable = cell;
          cells.push({ chars: cell.getChars(), width: cell.getWidth() });
        }
        rows.push(cells);
      }
      const logical = logicalLineText(rows, first);
      const candidates = findPathCandidates(logical.text)
        .map((candidate) => ({ candidate, range: cellRange(logical, candidate.start, candidate.end) }))
        .filter(({ range }) => range.start.y <= y && range.end.y >= y)
        .slice(0, MAX_CANDIDATES_PER_LINE);
      if (candidates.length === 0) {
        callback(undefined);
        return;
      }
      void Promise.all(
        candidates.map(async ({ candidate, range }): Promise<ILink | null> => {
          const resolved = await resolveCached(candidate.path);
          if (!resolved) return null;
          const position = candidate.line ? { line: candidate.line, column: candidate.column ?? 1 } : null;
          return {
            range,
            text: logical.text.slice(candidate.start, candidate.end),
            decorations: { underline: true, pointerCursor: true },
            activate(event) {
              if (!event.ctrlKey && !event.metaKey) return;
              options.open(resolved, position);
            },
            hover() {
              if (terminal.element) terminal.element.title = HOVER_TITLE;
            },
            leave() {
              if (terminal.element?.title === HOVER_TITLE) terminal.element.title = "";
            },
          };
        }),
      ).then((links) => {
        const found = links.filter((link): link is ILink => link !== null);
        callback(found.length > 0 ? found : undefined);
      });
    },
  };
}
