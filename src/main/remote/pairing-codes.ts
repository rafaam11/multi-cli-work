import { randomInt } from "node:crypto";

/** 헷갈리는 0/O·1/I를 뺀 32자. 8자리면 40bit — 5분·시도 제한 안에서는 충분하다. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const FAILURE_WINDOW_MS = 60_000;

export interface PairingDeps {
  now(): number;
  randomCode(): string;
  ttlMs: number;
  maxFailuresPerMinute: number;
  maxFailuresPerCode: number;
}

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

function normalize(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

export function formatPairingCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export class PairingCodes {
  private readonly deps: PairingDeps;
  private active: { code: string; expiresAt: number; failures: number } | null = null;
  private readonly failuresByIp = new Map<string, number[]>();

  constructor(deps: Partial<PairingDeps> = {}) {
    this.deps = {
      now: deps.now ?? Date.now,
      randomCode: deps.randomCode ?? randomCode,
      ttlMs: deps.ttlMs ?? 5 * 60_000,
      maxFailuresPerMinute: deps.maxFailuresPerMinute ?? 5,
      maxFailuresPerCode: deps.maxFailuresPerCode ?? 10,
    };
  }

  issue(): { code: string; expiresAt: number } {
    const code = this.deps.randomCode();
    const expiresAt = this.deps.now() + this.deps.ttlMs;
    this.active = { code, expiresAt, failures: 0 };
    return { code: formatPairingCode(code), expiresAt };
  }

  consume(input: string, clientIp: string): "ok" | "invalid" | "rate-limited" {
    const now = this.deps.now();
    const recent = (this.failuresByIp.get(clientIp) ?? []).filter((at) => now - at < FAILURE_WINDOW_MS);
    this.failuresByIp.set(clientIp, recent);
    if (recent.length >= this.deps.maxFailuresPerMinute) return "rate-limited";

    const active = this.active;
    if (active && active.expiresAt >= now && normalize(input) === active.code) {
      this.active = null;
      return "ok";
    }
    recent.push(now);
    if (active) {
      active.failures += 1;
      if (active.failures >= this.deps.maxFailuresPerCode) this.active = null;
    }
    return "invalid";
  }
}
