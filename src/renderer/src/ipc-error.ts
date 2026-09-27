/**
 * The one way the renderer turns a failure into banner text. Electron wraps every rejected invoke as
 * "Error invoking remote method 'channel': Error: <reason>" — the channel name means nothing to the
 * user, so only the reason main gave is shown.
 */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const match = /Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?([\s\S]*)$/.exec(raw);
  return match ? match[1] : raw;
}
