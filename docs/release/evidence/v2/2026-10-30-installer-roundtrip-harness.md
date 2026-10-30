# Original-installer roundtrip harness, 2026-10-30

The real installer scenario is newly added to hosted CI. **No original-installer roundtrip result is claimed by this document.**

The candidate uses the original application ID and product name, the preview version, a separate output folder, and `publish: null`. The harness refuses developer and self-hosted environments before creating a fixture or invoking an installer. Windows limits outbound network access for the disposable recovery runtime, original installer, installed application and candidate installer. Linux executes the full scenario as the runner user inside a separate network namespace with only loopback. A real network probe must fail. Only the pinned original dpkg command receives temporary scoped polkit authorization.

The scenario installs and opens original v1.55.1, records favorites and diff notes in its actual Electron Local Storage, upgrades to the candidate, writes v2 state, closes the app and host, runs the preserved independent recovery controller, verifies restored settings and original v1 UI, changes v1 data, and reupgrades to the retained v2 state. It checks immutable backup hashes, suppressed automatic updates/resume/repository synchronization, no duplicate sessions, unmerged v1 differences, and unchanged external Git/worktree output. Screenshots and a source-commit-bound JSON receipt are produced only after the scenario succeeds.

The production launcher now preserves the original provider data locations, removes v2 control/AppImage mount environment, and records a native process birth identity after observing the launched v1 process. This is startup evidence, not a claim that a user saw the window. The CI fixture uses that identity to stop only its own no-session instance before reopening it through Playwright for UI/data inspection.

Local checks completed:

- 66 recovery/guard tests passed, including the new launch environment, early exit/PID reuse, and disposable-runner guard cases.
- Main/renderer typecheck, targeted strict TypeScript checking of the new E2E files, and complete v2 build passed.
- Local invocation with installer testing disabled skipped the scenario. Explicitly enabling it on the developer PC was rejected before fixture creation. No original installer was executed locally.
- The Windows candidate package built successfully; actual ASAR dependencies passed (6 modules). The candidate GUI survival/reconnect/recovery-hold scenario passed in 20.9 seconds. The candidate installer itself was not run on this PC.
- Previous offline-host checkpoint `0188b5f97091ab8f5111a754bf43568ba729cab9` passed both Windows and Linux jobs in CI run 40993905829.

The new original installer workflow, failure injection matrix, installer-time rescue staging and the full feature/release gates remain pending. Android device validation remains deferred. Stable/latest is unchanged.
