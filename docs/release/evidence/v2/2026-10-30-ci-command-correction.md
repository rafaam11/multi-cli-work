# Windows CI test command correction

Detailed log inspection of candidate run 41016762487 found that Windows PowerShell's `npm test -- --maxWorkers=2 --exclude ...` invocation forwarded only the excluded test filename. The supposed full-suite step consequently ran `vitest run src/main/providers/claude-integration.test.ts` (10 tests) instead of the complete suite. Earlier statements describing that Windows CI step as a full-suite pass were incorrect. Linux forwarded the arguments correctly.

The independent local full-suite checkpoint (2,733 tests) was run directly through Vitest and remains valid. After the startup hydration repairs, the corrected exact command was run locally:

```sh
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --exclude src/main/providers/claude-integration.test.ts
```

Result on Windows, 2026-10-30: **314 files / 2,741 tests passed; 3 files / 6 tests skipped**, 287.85 seconds. Provider hooks remain a separate dedicated-worker step. Both preview and stable workflows and the active README now use the direct Node invocation so npm cannot consume the Vitest options. Workflow YAML parsing and diff checks passed.

The updated workflow candidate requires its own successful hosted Windows/Linux run before publication. No prior narrow Windows CI result is being relabeled as a full-suite pass.

While that workflow correction was being verified, run 41020339660 completed all Linux checks, including both original deb/AppImage offline roundtrips and first-Electron-failure independent rescue. Windows passed its original-installer offline roundtrip; the first-start rescue reached completion but its test cleanup encountered an Electron utility child whose native creation identity was unavailable in that snapshot. The disposable fixture now retries read-only process observation before any signal, retaining the original root-identity assertion and per-PID identity recheck. Persistent uncertainty still fails without termination. The redundant in-flight run 41022126423 was cancelled so the next candidate also includes this bounded fixture correction; strict E2E TypeScript passed.
