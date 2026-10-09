/** Which rate-limit window a usage figure belongs to. */
export type UsageWindowKind = "5h" | "weekly" | "other";

export interface UsageWindow {
  kind: UsageWindowKind;
  /** 0–100. */
  usedPercent: number;
  /** ISO time the window resets, when the provider said. */
  resetsAt: string | null;
}

export interface ProviderUsage {
  windows: UsageWindow[];
  /** "max", "pro", "prolite"… as the provider names the plan; null when it did not say. */
  plan: string | null;
  /** ISO time these figures were read. */
  updatedAt: string;
}

/** The last known usage of each subscription. Null for a provider never read on this machine. */
export interface UsageSnapshot {
  claude: ProviderUsage | null;
  codex: ProviderUsage | null;
}
