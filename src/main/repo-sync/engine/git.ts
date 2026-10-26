// 출처: harness-manager src/main/services/repo-sync/git.ts — 계약 harness-manager docs/contracts/repo-sync.md.
// HM이 없는 PC의 대체 구현이다. 판정 순서·잠금·state.json이 HM과 같아야 하므로 HM 쪽이 바뀌면 같이 고친다.
import { execFile } from "node:child_process";
import type { RepoFailKind } from "../../../shared/repo-sync-types";

/** 상태 조회는 디스크만 본다. */
export const QUERY_TIMEOUT_MS = 10_000;
/** fetch는 네트워크를 기다린다. */
export const FETCH_TIMEOUT_MS = 60_000;
/** ff-only 반영은 작업 트리를 쓴다. */
export const MERGE_TIMEOUT_MS = 30_000;
/** execFile 기본 1MiB 버퍼는 큰 status를 git 실패로 오인하게 만든다(multi-cli-work git-commands.ts와 같은 값). */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

export class GitRunError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly timedOut: boolean,
  ) {
    super(message);
    this.name = "GitRunError";
  }
}

/** 테스트가 느린 레포·호출 횟수를 흉내 내도록 주입할 수 있는 실행기. */
export type GitRunner = (cwd: string, args: string[], timeoutMs: number) => Promise<string>;

/**
 * 인증 창이 뜨면 세션 시작 뒤에서 아무도 못 보는 창이 timeout까지 붙잡는다. 그래서 프롬프트를 모두 끄고,
 * 인증이 필요하면 바로 실패하게 한다.
 */
const NON_INTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
};

export const runGit: GitRunner = (cwd, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        env: { ...process.env, ...NON_INTERACTIVE_ENV },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const timedOut = Boolean((error as { killed?: boolean }).killed) && error.signal != null;
        reject(new GitRunError(`git ${args[0]} failed`, String(stderr ?? ""), timedOut));
      },
    );
  });

export function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1) ?? "";
}

/** 인증을 네트워크보다 먼저 본다 — 공개키 거부도 "Could not read from remote repository"를 함께 찍는다. */
export function classifyGitFailure(error: unknown): { failKind: RepoFailKind; error: string } {
  if (!(error instanceof GitRunError)) {
    return { failKind: "git", error: error instanceof Error ? error.message : String(error) };
  }
  const stderr = error.stderr;
  const detail = lastLine(stderr) || error.message;
  if (error.timedOut) return { failKind: "timeout", error: detail };
  if (/untracked working tree files would be overwritten/i.test(stderr)) return { failKind: "overwrite", error: detail };
  if (
    /authentication failed|could not read username|could not read password|permission denied \(publickey|terminal prompts disabled|returned error: 40[13]|invalid credentials/i.test(
      stderr,
    )
  ) {
    return { failKind: "auth", error: detail };
  }
  if (
    /could not resolve host|unable to access|failed to connect|connection (timed out|refused|reset)|could not read from remote repository|does not appear to be a git repository|network is unreachable|unable to connect/i.test(
      stderr,
    )
  ) {
    return { failKind: "network", error: detail };
  }
  return { failKind: "git", error: detail };
}

export interface ParsedBranchStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  /** 추적 중인 파일의 변경·충돌. untracked(`?`)와 ignored(`!`)는 세지 않는다. */
  trackedChanges: number;
}

/**
 * `git status --porcelain=v2 --branch -z` 판독. multi-cli-work `projects/git-commands.ts`의
 * `parseGitStatusV2`에서 옮기면서, 이 기능에 필요한 브랜치 정보와 "추적 파일 변경 수"만 남겼다.
 */
export function parseBranchStatus(output: string): ParsedBranchStatus {
  const records = output.split("\0");
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  let trackedChanges = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("# branch.head ")) {
      const name = record.slice("# branch.head ".length);
      branch = name === "(detached)" ? null : name;
    } else if (record.startsWith("# branch.upstream ")) {
      upstream = record.slice("# branch.upstream ".length);
    } else if (record.startsWith("# branch.ab ")) {
      const match = /^\+(\d+) -(\d+)$/.exec(record.slice("# branch.ab ".length));
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (record.startsWith("1 ") || record.startsWith("u ")) {
      trackedChanges += 1;
    } else if (record.startsWith("2 ")) {
      // rename의 원래 경로는 다음 NUL 레코드로 따로 온다.
      trackedChanges += 1;
      index += 1;
    }
  }
  return { branch, upstream, ahead, behind, trackedChanges };
}
