import { describe, expect, it } from "vitest";
import { parseGitHubRemoteUrl } from "./github-remote";

describe("parseGitHubRemoteUrl", () => {
  it.each([
    ["https://github.com/openai/codex.git", "github.com", "openai", "codex"],
    ["git@github.com:openai/codex.git", "github.com", "openai", "codex"],
    ["ssh://git@git.example.test/team/repo.git", "git.example.test", "team", "repo"],
    ["https://git.example.test/team/repo", "git.example.test", "team", "repo"],
  ])("parses %s", (url, host, owner, repository) => {
    expect(parseGitHubRemoteUrl("origin", url)).toMatchObject({ name: "origin", host, owner, repository });
  });

  it.each([
    "https://evil.test/a/b/../../x",
    "file:///tmp/repo",
    "https://user:token@github.com/a/b",
    "git@github.com:a",
    "https://github.com/a/b?token=x",
  ])("rejects unsafe or unsupported URL %s", (url) => {
    expect(() => parseGitHubRemoteUrl("origin", url)).toThrow();
  });
});
