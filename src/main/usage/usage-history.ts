import type { UsageHistorySnapshot, UsageSample, UsageSnapshot } from "../../shared/usage-types";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";
class UsageHistoryError extends Error {}
const WEEK = 7 * 86400_000;
function parse(value: unknown): UsageSample[] {
  if (!Array.isArray(value) || value.length > 10000) throw new UsageHistoryError("Invalid usage history");
  return value.map(item => {
    if (!item || typeof item !== "object" || !["claude", "codex"].includes(item.provider) || !["5h", "weekly", "other"].includes(item.kind) ||
      typeof item.usedPercent !== "number" || !Number.isFinite(item.usedPercent) || item.usedPercent < 0 || item.usedPercent > 100 ||
      typeof item.observedAt !== "string" || !Number.isFinite(Date.parse(item.observedAt)) ||
      item.resetsAt !== null && (typeof item.resetsAt !== "string" || !Number.isFinite(Date.parse(item.resetsAt)))) throw new UsageHistoryError("Invalid usage sample");
    return { provider: item.provider, kind: item.kind, usedPercent: item.usedPercent, resetsAt: item.resetsAt, observedAt: item.observedAt } as UsageSample;
  });
}
const spec: JsonStoreSpec<UsageSample[]> = {
  label: "usage history", displayName: "사용량 이력", parse, empty: () => [],
  error: (message, options) => new UsageHistoryError(message, options), isContentError: error => error instanceof UsageHistoryError,
};
export class UsageHistoryStore {
  constructor(private readonly file: string, private readonly now = () => Date.now()) {}
  async list(): Promise<UsageHistorySnapshot> {
    try {
      const snapshot = await readJsonStore(spec, this.file);
      return { samples: snapshot.value.filter(sample => Date.parse(sample.observedAt) >= this.now() - WEEK), warning: snapshot.warning };
    } catch (error) { return { samples: [], warning: String(error) }; }
  }
  async record(snapshot: UsageSnapshot) {
    const incoming: UsageSample[] = [];
    for (const provider of ["claude", "codex"] as const) {
      const usage = snapshot[provider];
      if (!usage) continue;
      for (const window of usage.windows) incoming.push({ ...window, provider, observedAt: usage.updatedAt });
    }
    if (!incoming.length) return;
    const clean = parse(incoming);
    await updateJsonStore(spec, this.file, current => {
      const samples = new Map<string, UsageSample>();
      for (const sample of [...current, ...clean]) {
        const time = Date.parse(sample.observedAt);
        if (time < this.now() - WEEK || time > this.now() + 60_000) continue;
        samples.set(`${sample.provider}:${sample.kind}:${sample.observedAt}:${sample.resetsAt}`, sample);
      }
      return [...samples.values()].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)).slice(-10000);
    });
  }
}
