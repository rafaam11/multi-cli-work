# Windows CI test command correction

Detailed log inspection of candidate run 41016762487 found that Windows PowerShell's `npm test -- --maxWorkers=2 --exclude ...` invocation forwarded only the excluded test filename. The supposed full-suite step consequently ran `vitest run src/main/providers/claude-integration.test.ts` (10 tests) instead of the complete suite. Earlier statements describing that Windows CI step as a full-suite pass were incorrect. Linux forwarded the arguments correctly.

The independent local full-suite checkpoint (2,733 tests) was run directly through Vitest and remains valid. After the startup hydration repairs, the corrected exact command was run locally:

```sh
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --exclude src/main/providers/claude-integration.test.ts
```

Result on Windows, 2026-10-30: **314 files / 2,741 tests passed; 3 files / 6 tests skipped**, 287.85 seconds. Provider hooks remain a separate dedicated-worker step. Both preview and stable workflows and the active README now use the direct Node invocation so npm cannot consume the Vitest options. Workflow YAML parsing and diff checks passed.

The updated workflow candidate requires its own successful hosted Windows/Linux run before publication. No prior narrow Windows CI result is being relabeled as a full-suite pass.
