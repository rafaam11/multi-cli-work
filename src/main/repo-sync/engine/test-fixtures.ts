// 출처: harness-manager src/main/services/repo-sync/test-fixtures.ts — 계약 harness-manager docs/contracts/repo-sync.md.
// HM이 없는 PC의 대체 구현이다. 판정 순서·잠금·state.json이 HM과 같아야 하므로 HM 쪽이 바뀌면 같이 고친다.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 실제 git으로 "다른 PC에서 push하고 돌아온" 상황을 만든다.
 * `origin.git`(bare) ← `work`(이 PC의 클론), `other`(다른 PC의 클론).
 */
export interface RemoteFixture {
  root: string;
  origin: string;
  work: string;
  other: string;
  git(cwd: string, ...args: string[]): string;
  commit(cwd: string, file: string, content: string, message?: string): void;
  /** other에서 커밋해 push한다. */
  pushFromOther(count: number): void;
  head(cwd: string): string;
  cleanup(): void;
}

const IDENTITY = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", "-c", "core.autocrlf=false"];

export function createRemoteFixture(): RemoteFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hm-repo-sync-"));
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", [...IDENTITY, "-C", cwd, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  const other = path.join(root, "other");
  fs.mkdirSync(origin);
  git(origin, "init", "--bare", "-q");
  git(root, "clone", "-q", origin, work);
  const commit = (cwd: string, file: string, content: string, message = `edit ${file}`): void => {
    fs.writeFileSync(path.join(cwd, file), content);
    git(cwd, "add", file);
    git(cwd, "commit", "-q", "-m", message);
  };
  commit(work, "README.md", "first\n");
  git(work, "push", "-q", "-u", "origin", "main");
  git(root, "clone", "-q", origin, other);
  let counter = 0;
  return {
    root,
    origin,
    work,
    other,
    git,
    commit,
    pushFromOther(count) {
      for (let index = 0; index < count; index += 1) {
        counter += 1;
        commit(other, `other-${counter}.txt`, `${counter}\n`);
      }
      git(other, "push", "-q");
    },
    head: (cwd) => git(cwd, "rev-parse", "HEAD").trim(),
    // mcw: Windows는 git이 막 놓은 파일을 잠깐 잡고 있다(EBUSY) — git-commands.test와 같은 재시도.
    cleanup: () => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}
