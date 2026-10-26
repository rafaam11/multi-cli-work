import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSessionViewing } from "./use-session-viewing";
import type { RemoteClient } from "./remote-client";
import type { ShellBridge } from "./shell-bridge";
import type { RemoteSessionSummary } from "@shared/remote-types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("acknowledges the exact displayed generation only after attach and in native foreground with no overlay", () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const send = vi.fn(() => true);
  const viewingSession = vi.fn();
  let foreground = false;
  const bridge = { viewingSession, isForeground: () => foreground } as unknown as ShellBridge;
  const session = { id: "s1", attention: { generation: 2, seenThrough: 0 } } as RemoteSessionSummary;
  const { rerender } = renderHook(({ ready, covered, generation, capable }) => useSessionViewing({ send } as unknown as RemoteClient,
    bridge, { ...session, attention: { generation, seenThrough: 0 } }, ready, covered, capable),
    { initialProps: { ready: false, covered: false, generation: 2, capable: true } });
  rerender({ ready: true, covered: false, generation: 2, capable: true });
  expect(send).not.toHaveBeenCalled();
  foreground = true;
  act(() => window.dispatchEvent(new Event("mcw-foreground")));
  expect(send).toHaveBeenLastCalledWith({ type: "seen", sessionId: "s1", generation: 2 });
  send.mockClear();
  rerender({ ready: true, covered: true, generation: 3, capable: true });
  expect(viewingSession).toHaveBeenLastCalledWith("", -1);
  expect(send).not.toHaveBeenCalled();
  rerender({ ready: true, covered: false, generation: 3, capable: true });
  expect(send).toHaveBeenLastCalledWith({ type: "seen", sessionId: "s1", generation: 3 });
  send.mockClear();
  rerender({ ready: true, covered: false, generation: 4, capable: false });
  expect(send).not.toHaveBeenCalled();
});
