import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SCP_LIKE = /^(?:[^@/]+@)?([^:/]+):(.+)$/;

function githubPath(owner: string, repository: string): string | null {
  if (!owner || !repository) return null;
  return `https://github.com/${owner}/${repository}`;
}

function splitRepositoryPath(pathname: string): { owner: string; repository: string } | null {
  const segments = pathname
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  if (segments.length !== 2) return null;
  return { owner: segments[0], repository: segments[1] };
}

/**
 * Normalizes any of git's GitHub remote spellings to a browsable https URL.
 * Returns null for remotes that do not point at github.com, so callers never
 * hand an arbitrary scheme to shell.openExternal.
 */
export function toGitHubHttpsUrl(remote: string): string | null {
  const trimmed = remote.trim();
  if (!trimmed) return null;

  const scp = SCP_LIKE.exec(trimmed);
  if (scp && !trimmed.includes("://")) {
    const [, host, repositoryPath] = scp;
    if (host.toLocaleLowerCase("en-US") !== "github.com") return null;
    const parts = splitRepositoryPath(repositoryPath);
    return parts ? githubPath(parts.owner, parts.repository) : null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.hostname.toLocaleLowerCase("en-US") !== "github.com") return null;
  const parts = splitRepositoryPath(url.pathname);
  return parts ? githubPath(parts.owner, parts.repository) : null;
}

export async function readGitHubUrl(rootPath: string): Promise<string> {
  let remote: string;
  try {
    const { stdout } = await execFileAsync("git", ["-C", rootPath, "remote", "get-url", "origin"], {
      windowsHide: true,
      timeout: 5_000,
    });
    remote = stdout;
  } catch (error) {
    throw new Error("This folder has no git remote named origin", { cause: error });
  }
  const url = toGitHubHttpsUrl(remote);
  if (!url) throw new Error(`The origin remote is not a GitHub repository: ${remote.trim()}`);
  return url;
}
