/**
 * Files dragged onto a terminal become a chunk of prompt text: each path double-quoted (a Windows
 * file name cannot contain `"`), space-separated, with a trailing space so the user keeps typing.
 * Paths that resolved to "" (a File with no backing file on disk) are dropped; if none remain there
 * is nothing to paste and the drop should fall through untouched.
 */
export function droppedPathsAsPromptText(paths: readonly string[]): string | null {
  const usable = paths.filter((path) => path.length > 0);
  if (usable.length === 0) return null;
  return `${usable.map((path) => `"${path}"`).join(" ")} `;
}
