# MCW Herdr protocol bridge

This small Rust process adapts JSONL on stdin/stdout to Herdr's local binary
client endpoint. It targets **Herdr 0.9.5**, official revision
`2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`, stable endpoint generation 1.
Selected Apache-2.0 wire declarations and their attribution are included.
The bridge does not launch, discover, stop, or recover Herdr servers.

Build and verify from the repository root:

```text
cargo test --locked --manifest-path native/herdr-bridge/Cargo.toml
npx vitest run scripts/build-herdr-bridge.test.mjs
node scripts/build-herdr-bridge.mjs
node native/herdr-bridge/tests/live-herdr.mjs
```

The last command is an explicit live integration test. It starts and gracefully
stops its own `mcw-v2` session in fresh temporary `XDG_CONFIG_HOME` and
`XDG_STATE_HOME` directories. It never attaches to an existing user server.
Set `MCW_TEST_HERDR` and/or `MCW_TEST_BRIDGE` to select executables. The test
leaves its isolated directory and `.cache/herdr-bridge-e2e` fixtures for review.
Windows named-pipe operation has been verified against installed 0.9.5.
Linux runtime validation remains a separate gate.

Build artifacts land in `build/herdr-bridge/<platform>-<arch>/` with the binary,
a SHA-256 manifest, `NOTICE`, and `LICENSE-HERDR`. The build uses `Cargo.lock`
and accepts `--target <Rust target>` and `--debug`. Supported target families
are Windows MSVC and Linux GNU/musl for x64/arm64; cross compiler/toolchain
availability is the caller's responsibility.

## Process and messages

Run `mcw-herdr-bridge --socket <absolute herdr-client.sock path>`. Windows uses
the exact same `interprocess::GenericNamespaced` conversion as Herdr's IPC
implementation; Unix uses its filesystem socket name. The process waits for
an explicit first `hello` JSONL command before connecting.
The welcome has a ten-second wall-clock deadline, including on Windows pipes
whose native receive-timeout API is unavailable.

Commands:

```json
{"type":"hello","cols":120,"rows":40,"cellWidthPx":8,"cellHeightPx":16,"surfaceActive":true,"sizeOwner":true}
{"type":"request","bootId":"server-boot-id","request":{"id":"focus-1","method":"tab.focus","params":{"tab_id":"w1:t1"}}}
{"type":"input","paneId":"w1:p1","events":[{"TextCommit":"text"}]}
{"type":"input","paneId":"w1:p1","events":[{"Key":{"code":"Enter","modifiers":0,"kind":"Press","repeat_count":1,"shifted_codepoint":null,"generated_text":null,"tracks_release":false,"physical_key_id":null,"windows_record":null}}]}
{"type":"resize","cols":120,"rows":40,"cellWidthPx":8,"cellHeightPx":16}
{"type":"surfaceInterest","active":false}
{"type":"detach"}
```

`request` also accepts an already serialized JSON object as its string value.
Semantic events follow Herdr's externally tagged enums and snake_case fields
in `src/wire.rs`. `Paste`, `Key`, `TextCommit`, and semantic `Mouse` preserve
the target pane's application keyboard/mouse protocol. Resize requires the
first hello's `sizeOwner:true`; the host must authorize browser actions.
`surfaceInterest` needs a received snapshot's boot ID. Stale request boot IDs
are rejected after the bridge has learned the current boot ID.

Stdout events:

- `{"type":"control","kind":"endpoint.welcome.v1","data":{...}}`:
  negotiated welcome, shell snapshots (`shell.snapshot.v1`), or optional named
  controls. Unknown named controls are data only and may be ignored.
- `{"type":"surface","surface":{...}}`: complete `PaneSurfaceFrame`.
- `{"type":"patch","patch":{...}}`: `PaneSurfacePatch` against a named
  `base_surface_revision`. The host/renderer must reject a missing baseline.
- `{"type":"response","bootId":"...","requestId":"...","finalChunk":true,"dataBytes":[...],"data":"..."}`:
  concatenate `dataBytes` before UTF-8/JSON decoding. Herdr chunks at arbitrary
  byte offsets. `data` is null if the individual chunk splits a UTF-8 sequence.
- `{"type":"ignored","tag":10}`: unrelated optional binary traffic.
- `{"type":"error","message":"...","fatal":true}`: `fatal` is set for
  a terminal protocol/connection/input framing error; command validation errors
  keep the connection open.
- `{"type":"disconnected","reason":"..."}`: terminal disconnect. Stdin EOF
  and `detach` send the endpoint's graceful detach and exit. Neither stops
  Herdr or its shell/agent processes.

Surface fields keep upstream snake_case names and PascalCase enum variants.
Graphics assets are inline byte arrays. `data_fingerprint` is a decimal JSON
string to preserve the full u64 in JavaScript. No image file path is opened;
direct filesystem graphics are explicitly disabled in hello. Optional surface
reuse/delta/scroll codecs are disabled; regular full frames and binary row
patches remain enabled and are decoded.

## Bounds and ownership

Frames have a four-byte little-endian length prefix followed by bincode 2's
standard variable integer encoding. Incoming payloads are capped at 2 MiB,
or 32 MiB only for complete surfaces with inline images. Native bincode
decoding applies a 32 MiB allocation/read budget and rejects trailing bytes,
forged container lengths, truncation, invalid geometry and cell counts.
JSONL commands and outgoing frames are capped at 2 MiB. Dimensions are bounded
to 4096 per axis and one million cells. Producers use a bounded queue for
backpressure. Byte-array JSON can expand a 32 MiB image frame to roughly
128 MiB of stdout; the host must use a bounded streaming JSONL reader with an
appropriate limit. The bridge does not execute terminal graphics, clipboard
controls, hyperlinks or optional named controls.

**Herdr 0.9.5 has no active client-shell observer that guarantees no PTY resize.**
Source evidence: `server/headless/client_views.rs` claims unowned geometry for
an active shell and reassigns a missing controller to an active viewer.
`surface_active:false` avoids geometry ownership but receives only metadata,
and `headless/endpoint_requests.rs` rejects its tab focus and pane actions.
Therefore MCW must multiplex a single host-owned bridge for each session/tab;
observer browsers share its frames and never open another active shell or send
resize. The gateway's explicit size/input owner is the authorization boundary.
Independent tab selection does work across client connections, but does not
turn those connections into read-only observers. Both behaviors were verified
against the pinned implementation; the live test checks independent selection.

The host owns the bridge lifetime. Closing a GUI/browser should unsubscribe
that viewer while keeping the host's endpoint if work or another viewer needs
it. Disconnect or rendered idle state is not evidence of task completion.
