import { describe, expect, it, vi } from "vitest";
import type { HerdrTerminalEvent } from "@shared/herdr-surface-types";
import { createHostTransport } from "./host-transport";

describe("host terminal transport adapter", () => {
  it("unwraps gateway snapshots/frames, preserves viewer identity and filters other sessions", () => {
    let listener: (event: unknown) => void = () => {};
    const unsubscribe = vi.fn(), api = { subscribeTerminal: vi.fn((_id: string, callback: (event: unknown) => void) => { listener = callback; return unsubscribe; }), terminalCommand: vi.fn(async () => {}) };
    const identity = vi.fn(), events: HerdrTerminalEvent[] = [];
    const adapter = createHostTransport(api, { onIdentity: identity });
    const stop = adapter.subscribe("s", (event) => events.push(event));
    listener({ type: "authenticated", viewerId: "viewer" });
    listener({ type: "snapshot", sessionId: "other", snapshot: { type: "surface", surface: { boot_id: "foreign" } } });
    listener({ type: "snapshot", sessionId: "s", viewerId: "viewer", ownerId: "desktop", snapshot: { type: "surface", surface: { boot_id: "boot" } } });
    listener({ type: "frame", sessionId: "s", frame: { type: "patch", patch: { boot_id: "boot" } } });
    expect(identity).toHaveBeenCalledWith("viewer");
    expect(events).toEqual([{ type: "ownership", ownerId: "desktop", sizeOwnerId: "desktop" }, { type: "surface", surface: { boot_id: "boot" } }, { type: "patch", patch: { boot_id: "boot" } }]);
    stop(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("maps semantic input, resize, scroll and explicit ownership to host commands", async () => {
    const api = { subscribeTerminal: vi.fn(() => () => {}), terminalCommand: vi.fn(async () => {}) }, adapter = createHostTransport(api);
    await adapter.sendInput("s", { TextCommit: "한" });
    await adapter.resize("s", { cols: 80, rows: 24, cell_width_px: 9, cell_height_px: 20 });
    await adapter.scroll("s", { direction: "Up", lines: 3 });
    await adapter.requestControl("s", "viewer");
    await adapter.releaseControl("s", "viewer");
    await adapter.requestSnapshot("s");
    expect(api.terminalCommand.mock.calls).toEqual([
      ["s", { type: "input", data: { TextCommit: "한" } }],
      ["s", { type: "resize", cols: 80, rows: 24, cellWidthPx: 9, cellHeightPx: 20 }],
      ["s", { type: "scroll", delta: 3 }], ["s", { type: "takeOwnership" }], ["s", { type: "releaseOwnership" }], ["s", { type: "snapshot" }],
    ]);
  });
});
