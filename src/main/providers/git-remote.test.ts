// @vitest-environment node

import { describe, expect, it } from "vitest";
import { toGitHubHttpsUrl } from "./git-remote";

describe("GitHub remote normalization", () => {
  it("converts the scp-like SSH form", () => {
    expect(toGitHubHttpsUrl("git@github.com:rafaam11/multi-cli-work.git")).toBe(
      "https://github.com/rafaam11/multi-cli-work",
    );
  });

  it("converts the ssh:// form", () => {
    expect(toGitHubHttpsUrl("ssh://git@github.com/rafaam11/multi-cli-work.git")).toBe(
      "https://github.com/rafaam11/multi-cli-work",
    );
  });

  it("strips the .git suffix and credentials from the https form", () => {
    expect(toGitHubHttpsUrl("https://github.com/rafaam11/multi-cli-work.git")).toBe(
      "https://github.com/rafaam11/multi-cli-work",
    );
    expect(toGitHubHttpsUrl("https://token@github.com/rafaam11/multi-cli-work")).toBe(
      "https://github.com/rafaam11/multi-cli-work",
    );
  });

  it("tolerates surrounding whitespace from git output", () => {
    expect(toGitHubHttpsUrl("  git@github.com:rafaam11/multi-cli-work.git\n")).toBe(
      "https://github.com/rafaam11/multi-cli-work",
    );
  });

  it("rejects non-GitHub hosts", () => {
    expect(toGitHubHttpsUrl("git@gitlab.com:owner/repo.git")).toBeNull();
    expect(toGitHubHttpsUrl("https://bitbucket.org/owner/repo.git")).toBeNull();
    expect(toGitHubHttpsUrl("https://github.com.evil.test/owner/repo")).toBeNull();
  });

  it("rejects remotes without an owner and repository", () => {
    expect(toGitHubHttpsUrl("git@github.com:owner.git")).toBeNull();
    expect(toGitHubHttpsUrl("https://github.com/owner")).toBeNull();
    expect(toGitHubHttpsUrl("")).toBeNull();
    expect(toGitHubHttpsUrl("not a url")).toBeNull();
  });
});
