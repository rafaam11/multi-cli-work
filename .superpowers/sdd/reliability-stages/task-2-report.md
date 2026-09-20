# Task 2 report

## Scope

- HTML previews now carry a stable panel-specific `viewId` through renderer, preload, IPC, runtime, controller, and native views. Pending target/path resolution is invalidated by close, superseding open, or runtime disposal; pending resize bounds are retained; each closed native view is detached and its WebContents is closed.
- Worktree sync updates an existing registry entry's branch after an external checkout while preserving its id/path/schema. Create refreshes the checked-out branch metadata first so a freed old branch is not rejected from stale registry data.
- Checkout/create branch validation delegates to `git check-ref-format --branch`, with explicit rejection for option-like and special checkout forms. Korean branch names work against a real repository.
- Quit disposal releases rejected attempts. Runtime disposal records successful teardown stages, retries from the failed stage, and shares concurrent attempts.

## RED evidence

Command:

`npx vitest run src/main/providers/html-preview-controller.test.ts src/main/ipc.test.ts src/main/projects/git-commands.test.ts src/main/projects/worktree-service.test.ts src/main/quit-coordinator.test.ts src/main/runtime-disposal.test.ts --maxWorkers=2`

Result before production fixes: 6 test files failed; 10 tests failed and 86 passed, with 2 expected unhandled rejections from the old IPC signature. The feature failures demonstrated Korean branch rejection, stale worktree branch metadata, non-retryable rejected quit disposal, missing staged runtime disposer, missing view ids, and pre-controller IPC race handling.

## GREEN evidence

Focused command:

`npx vitest run src/main/providers/html-preview-controller.test.ts src/main/providers/html-preview-view.test.ts src/main/ipc.test.ts src/main/projects/git-commands.test.ts src/main/projects/worktree-service.test.ts src/main/quit-coordinator.test.ts src/main/runtime-disposal.test.ts --maxWorkers=2`

Result after review corrections: 7 test files passed; 105 tests passed; exit 0.

The review found a second asynchronous failure boundary: a controller `open()` rejection could leave the IPC request active. Its regression test failed 1 of 51 IPC tests before the correction, then passed along with a stale-rejection/newer-request preservation case in the focused run above.

Typecheck command:

`npm run typecheck`

Result: both node and web TypeScript projects passed; exit 0.

## Final evidence

Full command:

`npm test -- --maxWorkers=2`

Result: 119 test files passed; 1,370 tests passed; exit 0. npm emitted its existing warning that it interpreted `--maxWorkers` as an npm CLI config, while Vitest completed the entire suite successfully.

Build command:

`npm run build`

Result: node/web typecheck and all main, preload, and renderer production bundles passed; exit 0.

Root-owned serial Electron E2E is recorded separately by the root task.

## Concerns

- `e2e/desktop.spec.ts` is concurrently owned by the root task and is intentionally excluded from this task's commit.
- The full suite and build were each run once after targeted review corrections.
