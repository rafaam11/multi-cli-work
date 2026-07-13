import fs from "node:fs/promises";
import path from "node:path";
import { shell } from "electron";
import { AGENT_REGISTRY_PATH } from "./agent-registry";

/**
 * A worked example rather than an empty skeleton: the fastest way to add an agent is to copy the one
 * that is already there. JSON has no comments, so the guidance rides in `$comment`, which the parser
 * ignores.
 */
function exampleRegistry(now: string): string {
  return `${JSON.stringify(
    {
      $comment:
        "Agents you add here appear in the launcher next to PowerShell, Claude Code and Codex. " +
        "Placeholders: {cwd}, {sessionId}, {conversationId} (resumeArgs only). " +
        "statusAdapter: 'signals' (process only — cannot tell working from waiting) or 'osc9' " +
        "(your CLI emits OSC 9 notifications, like Codex does). " +
        "conversationId: 'none' (relaunch to resume) or 'app-generated' (we mint the id and pass it in).",
      schemaVersion: 1,
      updatedAt: now,
      agents: {
        gemini: {
          $comment: "Delete this example or edit it. `commands` are tried in order against PATH.",
          id: "gemini",
          label: "Gemini CLI",
          commands: ["gemini"],
          args: [],
          newSessionArgs: [],
          resumeArgs: [],
          conversationId: "none",
          statusAdapter: "signals",
          accentColor: "#4285f4",
        },
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * `shell.openPath` resolves an error string instead of rejecting, so its result has to be checked.
 */
export async function openAgentRegistryForEditing(registryPath?: string): Promise<void> {
  const target = registryPath ?? AGENT_REGISTRY_PATH;
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, exampleRegistry(new Date().toISOString()), { encoding: "utf8", flag: "wx" }).catch(
      (error: NodeJS.ErrnoException) => {
        // Another window may have written it first; that is the outcome we wanted anyway.
        if (error.code !== "EEXIST") throw error;
      },
    );
  }
  const failure = await shell.openPath(target);
  if (failure) throw new Error(`Could not open ${target}: ${failure}`);
}
