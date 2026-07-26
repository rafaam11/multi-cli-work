import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitHubRemote } from "../../shared/github-types";

const execFileAsync = promisify(execFile);
const HOST = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
const SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubRemoteUrl(name: string, remoteUrl: string): GitHubRemote {
  let host: string;
  let pathname: string;
  const scp = /^git@([^:/]+):(.+)$/.exec(remoteUrl);
  if (scp) {
    host = scp[1];
    pathname = scp[2];
  } else {
    let parsed: URL;
    try { parsed = new URL(remoteUrl); } catch { throw new Error(`지원하지 않는 Git 원격 주소입니다: ${remoteUrl}`); }
    if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") {
      throw new Error(`지원하지 않는 Git 원격 프로토콜입니다: ${parsed.protocol}`);
    }
    if (parsed.username && !(parsed.protocol === "ssh:" && parsed.username === "git")) {
      throw new Error("Git 원격 주소에 사용자 정보가 포함되어 있습니다.");
    }
    if (parsed.password || parsed.search || parsed.hash || parsed.port) throw new Error("안전하지 않은 Git 원격 주소입니다.");
    host = parsed.hostname;
    pathname = parsed.pathname.replace(/^\//, "");
  }
  const parts = pathname.replace(/\.git$/i, "").split("/");
  if (!HOST.test(host) || parts.length !== 2 || parts.some((part) => !SEGMENT.test(part) || part === "." || part === "..")) {
    throw new Error(`GitHub 저장소 주소 형식이 아닙니다: ${remoteUrl}`);
  }
  return { name, url: remoteUrl, host: host.toLowerCase(), owner: parts[0], repository: parts[1] };
}

export async function listGitHubRemotes(rootPath: string): Promise<GitHubRemote[]> {
  const result = await execFileAsync("git", ["-C", rootPath, "remote", "-v"], {
    windowsHide: true, timeout: 5_000, maxBuffer: 1024 * 1024,
  });
  const remotes = new Map<string, GitHubRemote>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line);
    if (!match || remotes.has(match[1])) continue;
    try { remotes.set(match[1], parseGitHubRemoteUrl(match[1], match[2])); } catch { /* non-GitHub remote */ }
  }
  return [...remotes.values()];
}
