import fs from "node:fs";
import path from "node:path";
import { updateAppState } from "./app-state";

interface RecoveryMarkerV1 {
  schemaVersion: 1;
  writtenAt: string;
  sessionIds: string[];
}

function parseMarker(value: unknown): RecoveryMarkerV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid recovery marker");
  const marker = value as Record<string, unknown>;
  if (marker.schemaVersion !== 1 || typeof marker.writtenAt !== "string" || !Array.isArray(marker.sessionIds)) {
    throw new Error("Invalid recovery marker");
  }
  const sessionIds = marker.sessionIds.filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9-]+$/.test(id));
  return { schemaVersion: 1, writtenAt: marker.writtenAt, sessionIds: [...new Set(sessionIds)] };
}

/** Windows session-end cannot await promises, so keep this deliberately small and synchronous. */
export function writeRecoveryMarkerSync(markerPath: string, sessionIds: string[], now = new Date().toISOString()): void {
  const marker: RecoveryMarkerV1 = {
    schemaVersion: 1,
    writtenAt: now,
    sessionIds: [...new Set(sessionIds.filter((id) => /^[a-zA-Z0-9-]+$/.test(id)))],
  };
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, "utf8");
}

export async function consumeRecoveryMarker(markerPath: string, statePath: string): Promise<void> {
  let marker: RecoveryMarkerV1;
  try {
    marker = parseMarker(JSON.parse(await fs.promises.readFile(markerPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    await fs.promises.rm(markerPath, { force: true });
    return;
  }
  const ids = new Set(marker.sessionIds);
  await updateAppState((state) => ({
    ...state,
    sessions: Object.fromEntries(Object.entries(state.sessions).map(([id, session]) => [
      id,
      ids.has(id) ? { ...session, interruptedByShutdown: true } : session,
    ])),
  }), { statePath });
  await fs.promises.rm(markerPath, { force: true });
}
