/**
 * The system-wide key that brings the window back while the app lives in the tray. Only one is ever
 * registered; changing it swaps the old one out, and a key another program already holds is refused
 * rather than silently doing nothing.
 */
export interface GlobalShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface SummonShortcut {
  /** Registers `accelerator` (null clears it). False when the OS refused the key; the old one stays. */
  apply(accelerator: string | null): boolean;
  current(): string | null;
}

export function createSummonShortcut(api: GlobalShortcutApi, summon: () => void): SummonShortcut {
  let registered: string | null = null;
  return {
    apply(accelerator) {
      if (accelerator === registered) return true;
      if (accelerator === null) {
        if (registered) api.unregister(registered);
        registered = null;
        return true;
      }
      let ok = false;
      try {
        ok = api.register(accelerator, summon);
      } catch {
        // Electron throws on a malformed accelerator; to the user that is the same as "taken".
        ok = false;
      }
      if (!ok) return false;
      if (registered) api.unregister(registered);
      registered = accelerator;
      return true;
    },
    current: () => registered,
  };
}
