# Host runtime independent of the installation

The daemon, provider MCP, managed Herdr and native bridge now run from a verified,
immutable revision beneath the recovery directory. This keeps their executable
files available when an AppImage mount disappears or an installation is replaced.
Existing revisions remain in place; changed files fail verification instead of
being overwritten. Recovery launchers are preserved before this staging step.

Local Windows verification: seven focused tests, complete build/typecheck, source
GUI survival/reconnect (26.0 seconds), candidate packaged GUI survival/reconnect
(23.5 seconds), six packaged main modules, and strict recovery E2E typecheck passed.
No installer was executed on the development PC.

The preceding candidate b21fbecdd42e36c2c1380620ed728c2a072fa06b passed the real
original Windows offline installer roundtrip in GitHub run 40997124066. That run
failed when starting the installed Linux deb candidate daemon; the daemon cause
was unavailable because startup stderr was discarded. Private startup logging
and failure-artifact collection are added here for diagnosis. This change does
not declare the Linux failure fixed or record any stable release gate as passed.

Actual AppImage lifecycle and installer roundtrip verification remain pending.
