# Codex Resume Correlation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a Codex conversation ID when its transcript is created after the existing ten-second correlation window.

**Architecture:** The session tracker continues polling the existing Codex transcript directory but uses a two-minute default correlation window. The coordinator and resume command remain unchanged because they already persist and pass a correlated ID to `codex resume`.

**Tech Stack:** TypeScript, Node filesystem APIs, Vitest.

## Global Constraints

- Preserve the existing 400 ms poll cadence and abort behavior.
- Stop as soon as a matching transcript is discovered.
- Do not change the Codex CLI resume arguments.

---

### Task 1: Extend the default transcript correlation window

**Files:**
- Modify: `src/main/providers/codex-session-tracker.test.ts`
- Modify: `src/main/providers/codex-session-tracker.ts`

**Interfaces:**
- Consumes: `new CodexSessionTracker({ pollIntervalMs, maxAttempts })`
- Produces: the default tracker continues for 300 attempts, while an explicit `maxAttempts` remains authoritative.

- [ ] **Step 1: Write the failing test**

```ts
it("keeps waiting long enough for a delayed transcript by default", async () => {
  const tracker = new CodexSessionTracker({ sessionsDirectory, pollIntervalMs: 1 });
  expect(tracker).toHaveProperty("maxAttempts", 300);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/main/providers/codex-session-tracker.test.ts`
Expected: FAIL because the current default is 25 attempts.

- [ ] **Step 3: Write minimal implementation**

```ts
const DEFAULT_MAX_ATTEMPTS = 300;
this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/main/providers/codex-session-tracker.test.ts src/main/terminal/terminal-coordinator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/providers/codex-session-tracker.ts src/main/providers/codex-session-tracker.test.ts docs/superpowers
git commit -m "fix: keep waiting for Codex session transcripts"
```
