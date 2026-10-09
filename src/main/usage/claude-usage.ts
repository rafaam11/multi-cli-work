import fs from "node:fs/promises";
import path from "node:path";
import type { ProviderUsage, UsageWindow } from "../../shared/usage-types";

/**
 * Claude subscription usage, from the same endpoint Claude Code's own `/usage` and the claude-hud
 * statusline read. It is not a documented API: anything unexpected makes the parser answer null
 * and the gauge simply hides. The OAuth token is read fresh for each request and goes nowhere but
 * that request's Authorization header — never stored, logged or put in an error message.
 */
export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export interface ClaudeCredentials {
  accessToken: string;
  /** Epoch milliseconds; null when the file does not say. */
  expiresAt: number | null;
  subscriptionType: string | null;
}

type ReadFile = (file: string, encoding: "utf8") => Promise<string>;

export async function readClaudeCredentials(
  env: NodeJS.ProcessEnv,
  home: string,
  readFile: ReadFile = (file, encoding) => fs.readFile(file, encoding),
): Promise<ClaudeCredentials | null> {
  const dir = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  try {
    const parsed = JSON.parse(await readFile(path.join(dir, ".credentials.json"), "utf8")) as {
      claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown; subscriptionType?: unknown };
    };
    const oauth = parsed.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== "string" || oauth.accessToken.length === 0) return null;
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : null,
      subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : null,
    };
  } catch {
    return null;
  }
}

/** A gateway in ANTHROPIC_BASE_URL means the subscription endpoint is not the one being used. */
export function claudeUsageAllowed(env: NodeJS.ProcessEnv): boolean {
  const base = env.ANTHROPIC_BASE_URL;
  if (!base) return true;
  try {
    return new URL(base).hostname.endsWith("anthropic.com");
  } catch {
    return false;
  }
}

function parseWindow(raw: unknown, kind: UsageWindow["kind"]): UsageWindow | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") return null;
  const { utilization, resets_at: resetsAt } = raw as { utilization?: unknown; resets_at?: unknown };
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) return null;
  const reset = typeof resetsAt === "string" && Number.isFinite(Date.parse(resetsAt)) ? new Date(resetsAt).toISOString() : null;
  return { kind, usedPercent: Math.min(100, Math.max(0, utilization)), resetsAt: reset };
}

export function parseClaudeUsage(json: unknown, plan: string | null, now: Date): ProviderUsage | null {
  if (!json || typeof json !== "object") return null;
  const body = json as { five_hour?: unknown; seven_day?: unknown };
  const fiveHour = parseWindow(body.five_hour, "5h");
  const weekly = parseWindow(body.seven_day, "weekly");
  if (fiveHour === null || weekly === null) return null;
  const windows = [fiveHour, weekly].filter((window): window is UsageWindow => window !== undefined);
  if (windows.length === 0) return null;
  return { windows, plan, updatedAt: now.toISOString() };
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchClaudeUsage(
  fetchFn: FetchFn,
  accessToken: string,
): Promise<{ status: number; retryAfterSec: number | null; json: unknown }> {
  const response = await fetchFn(CLAUDE_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json",
    },
  });
  const retryAfter = Number(response.headers.get("Retry-After"));
  const retryAfterSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
  if (!response.ok) return { status: response.status, retryAfterSec, json: null };
  return { status: response.status, retryAfterSec, json: await response.json().catch(() => null) };
}
