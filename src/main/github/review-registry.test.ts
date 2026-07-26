import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readReviewRegistry, upsertReview } from "./review-registry";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });

describe("review registry", () => {
  it("writes atomically and restores from backup", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pr-review-registry-")); dirs.push(dir);
    const registryPath = path.join(dir, "pr-reviews.json");
    const review = { id: "r1", projectId: "p1", remoteName: "origin", pullRequestNumber: 7,
      headSha: "a".repeat(40), worktreeId: "w1", sessionId: "s1", agent: "codex" as const,
      promptDelivered: true, startedAt: "2026-07-24T00:00:00Z", updatedAt: "2026-07-24T00:00:00Z" };
    await upsertReview(review, { registryPath });
    await upsertReview({ ...review, promptDelivered: false, updatedAt: "2026-07-24T00:01:00Z" }, { registryPath });
    await fs.writeFile(registryPath, "broken");
    const snapshot = await readReviewRegistry({ registryPath });
    expect(snapshot.source).toBe("backup");
    expect(snapshot.registry.reviews.r1.promptDelivered).toBe(true);
  });
});
