import path from "node:path";
import { defaultTranscriptIo, readTranscriptTail, type TranscriptTailState } from "./transcript-tail";

const absolute = (value: unknown): value is string => typeof value === "string" &&
  !value.includes("\0") && (path.isAbsolute(value) || path.win32.isAbsolute(value));

/** Only structured execution metadata counts. Never search prose, command strings or tool output. */
export function parseCodexWorkspace(chunk: string, previousContext: string | null, since?: string): { contextCwd: string | null; cwd: string | null } {
  let contextCwd = previousContext;
  let cwd: string | null = null;
  for (const line of chunk.split(/\r?\n/)) {
    try {
      const entry = JSON.parse(line);
      if (since && !(Date.parse(entry?.timestamp) >= Date.parse(since))) continue;
      const payload = entry?.payload;
      if (!payload) continue;
      if (entry.type === "turn_context" && absolute(payload.cwd)) {
        if (payload.cwd !== contextCwd) cwd = payload.cwd;
        contextCwd = payload.cwd;
      } else if (entry.type === "event_msg" && payload.type === "exec_command_begin" && absolute(payload.cwd)) {
        cwd = payload.cwd;
      } else if (entry.type === "response_item" && payload.type === "function_call" &&
        ["exec_command", "shell_command", "shell"].includes(payload.name)) {
        const args = JSON.parse(payload.arguments);
        if (absolute(args.workdir)) cwd = args.workdir;
        else if (args.workdir === undefined && contextCwd) cwd = contextCwd;
      }
    } catch { /* A truncated or unknown record supplies no location evidence. */ }
  }
  return { contextCwd, cwd };
}

/** Paths come only from a hook owned by this terminal, never from a filename/time heuristic. */
export class SessionWorkspaceReader {
  private readonly states = new Map<string, { tail: TranscriptTailState; contextCwd: string | null }>();

  async read(transcriptPath: string, since?: string): Promise<string | null> {
    if (!path.isAbsolute(transcriptPath)) return null;
    const key = JSON.stringify([transcriptPath, since]);
    const previous = this.states.get(key);
    const tail = await readTranscriptTail(defaultTranscriptIo, transcriptPath, previous?.tail);
    if (!tail || !tail.changed) return null;
    const result = parseCodexWorkspace(tail.complete, tail.appendOnly ? previous?.contextCwd ?? null : null, since);
    this.states.set(key, { tail: tail.state, contextCwd: result.contextCwd });
    return result.cwd;
  }
}
