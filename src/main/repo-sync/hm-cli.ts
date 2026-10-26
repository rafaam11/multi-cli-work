import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { RepoSyncReport } from "../../shared/repo-sync-types";
import { parseRepoResult } from "./engine/state";

/**
 * 설치된 harness-manager가 기동할 때마다 `~/.harness-manager/bin/hm-cli.json`에 적어 두는 실행 방법
 * (HM docs/contracts/repo-sync.md §1-1). `hm.cmd`는 쓰지 않는다 — `.cmd`는 셸 없이 spawn할 수 없고
 * (Node의 CVE-2024-27980 대응), 셸을 거치면 한글·공백 경로 인용이 깨진다.
 */
export interface HmCli {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface HmRepoSyncInput {
  paths: string[];
  label?: string;
  force?: boolean;
  waitMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 파일이 없거나, 깨졌거나, 실행 파일이 사라졌으면 HM이 없는 PC로 본다. 모르는 키는 무시한다. */
export async function findHmCli(stateRoot: string): Promise<HmCli | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(path.join(stateRoot, "bin", "hm-cli.json"), "utf8"));
    if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.command !== "string" || !value.command) return null;
    const args = Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string") ? value.args : [];
    const env = isRecord(value.env)
      ? Object.fromEntries(Object.entries(value.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {};
    await fs.access(value.command);
    return { command: value.command, args, env };
  } catch {
    return null;
  }
}

export function parseRepoSyncReport(value: unknown): RepoSyncReport {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (!Array.isArray(value.results) || !Array.isArray(value.pending)) throw new Error("results/pending must be arrays");
  return {
    schemaVersion: 1,
    ...(typeof value.label === "string" ? { label: value.label } : {}),
    startedAt: String(value.startedAt ?? ""),
    finishedAt: String(value.finishedAt ?? ""),
    results: value.results.map(parseRepoResult),
    pending: value.pending.filter((entry): entry is string => typeof entry === "string"),
    summary: typeof value.summary === "string" ? value.summary : "",
  };
}

/**
 * `repos sync --stdin --json`을 detached로 띄우고 stdout 첫 줄 하나만 받는다. `waitMs`를 주면 HM이 그
 * 시간에 중간 보고서를 쓰고 남은 레포는 혼자 끝까지 처리한다 — 그래서 첫 줄을 받으면 바로 놓아 준다.
 * 어떤 실패도 throw하지 않고 null이다. 세션 시작을 막으면 안 된다.
 */
export function runHmRepoSync(cli: HmCli, input: HmRepoSyncInput, timeoutMs: number): Promise<RepoSyncReport | null> {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    const child = (() => {
      try {
        return spawn(cli.command, [...cli.args, "repos", "sync", "--stdin", "--json"], {
          shell: false,
          detached: true,
          windowsHide: true,
          stdio: ["pipe", "pipe", "ignore"],
          env: { ...process.env, ...cli.env },
        });
      } catch {
        return null;
      }
    })();
    if (!child) {
      resolve(null);
      return;
    }

    const finish = (report: RepoSyncReport | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.removeAllListeners("data");
      child.stdout?.destroy();
      child.unref();
      resolve(report);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    child.on("error", () => finish(null));
    child.on("exit", (code) => {
      // 첫 줄을 다 쓰고 끝나면 data가 exit보다 먼저 온다. 남은 버퍼에 개행 없는 한 줄이 있을 수도 있다.
      if (code === 0 && buffer.trim()) {
        tryParse(buffer);
        return;
      }
      finish(null);
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline >= 0) tryParse(buffer.slice(0, newline));
    });

    function tryParse(line: string) {
      try {
        finish(parseRepoSyncReport(JSON.parse(line)));
      } catch {
        finish(null);
      }
    }

    child.stdin?.on("error", () => undefined);
    child.stdin?.end(JSON.stringify(input));
  });
}
