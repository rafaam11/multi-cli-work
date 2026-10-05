import { stripTerminalControls } from "../../shared/terminal-text";

/** Codex's final exit footer belongs to this PTY; directory/mtime guesses do not. */
export function parseCodexExitConversationId(output: string): string | null {
  const text = stripTerminalControls(output);
  const footer = /(?:^|\n)(?:Session ID:|To continue this session, run codex resume)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/i;
  return footer.exec(text)?.[1] ?? null;
}
