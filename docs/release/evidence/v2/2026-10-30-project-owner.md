# Project-level owner PC selection

Project details now select the lead's PC. The user explicitly associates a registered
remote project with the local project; viewing/selecting metadata does not save or
launch work. Task profiles, repository choices, messages and results use the remote
project identity. The local ID is never sent as a guessed remote project ID.
Removing an association only changes local classification and preserves remote work.

Associations are stored in the separate v2 work-project registry. Each PC has at most
one association per local project, and a remote project cannot ambiguously belong to
two local projects. Old v1 records remain unchanged. Disconnected mapped projects
retain last observed results with actions disabled. Late catalog responses after
an owner switch are discarded.

Windows CI for the earlier mobile checkpoint exposed a separate layout bug: an error
banner widened an implicit grid column, placing the terminal control button beneath
the file explorer. A desktop Chrome reproduction at 900 px showed the workspace grow
from 348 px to 470.95 px and the click fail. An explicitly shrinkable grid column
keeps the workspace at 348 px and the button clickable. The browser regression runs
at 900 and 1280 px without force-clicking.

Verification on 2026-10-30:

- Focused registry/service/task/project tests: 56 passed; IPC suite: 78 passed.
- Full suite: 308 files / 2671 tests passed, 2 files / 5 environment skips, 208.05 s.
- Dedicated real hook subprocess tests: 10 passed.
- Complete build and strict v2/recovery E2E typecheck passed.
- Source GUI/desktop Chrome/layout: 2 passed, 31.5 s.
- Preview package built; actual ASAR dependency check passed (6 modules).
- Packaged GUI/desktop Chrome/layout: 2 passed, 30.7 s.
- Offline project association survived renderer reload, displayed its remote result,
  and left original v1 registry bytes without the v2 field. The resulting screenshot
  was visually inspected.

Previous distribution commit `1de651dca385cfb097316de32eb4acb8b28300f7` passed
[CI 41004566525](https://github.com/rafaam11/multi-cli-work/actions/runs/41004566525),
including signed APK packaging and Windows/deb/AppImage original-installer offline
roundtrips. That does not substitute for CI on this later source change.

Android functional/device verification remains excluded. No stable tag or public
release was created at this checkpoint.
