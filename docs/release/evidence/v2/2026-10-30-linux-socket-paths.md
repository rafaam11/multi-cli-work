# Long Linux data paths

The disposable installer fixture produces a 121-byte Herdr client socket path,
exceeding Linux's 107-byte pathname capacity. A regression test failed with that
exact length. Socket paths now use a deterministic private `/tmp/mcw-herdr-UID/`
subdirectory when necessary; config/session/state stay in their original data
root. Ownership, permissions, runtime binding and endpoint types are checked.
No existing socket or directory is removed by MCW.

Pinned Herdr source 2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01 supports
`HERDR_SOCKET_PATH` for both API and derived client endpoints. Explicit
`--session` overrides that variable, so the short-path launch uses
`HERDR_SESSION=mcw-v2` with the socket override instead. The upstream session and
server/socket_paths modules were inspected for this behavior.

Local Windows: 28 actual Herdr/broker tests passed, one Linux permissions test
skipped; complete build/typecheck passed. CI adds actual long-path Linux server
creation, API/event access and reattachment. Those Linux checks have not yet run
for this change. The preceding CI stopped on an unrelated repository sync test
before reaching the installed Linux candidate, so its startup log is still absent.

That sync failure was separately reproduced with a fixed millisecond clock.
Existing results no longer count as work completed while waiting for the lock;
all 26 repository sync engine tests passed after the fix.
