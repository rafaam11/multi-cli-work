import type { MultiCliWorkApi, UpdaterStatus } from "@shared/api-types";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateBadge } from "./UpdateBadge";

function createUpdatesApi(initial: UpdaterStatus = { state: "idle" }) {
  const listeners = new Set<(status: UpdaterStatus) => void>();
  const updates: MultiCliWorkApi["updates"] = {
    appVersion: vi.fn().mockResolvedValue("1.0.0"),
    status: vi.fn().mockResolvedValue(initial),
    check: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    openReleases: vi.fn().mockResolvedValue(undefined),
    openRepository: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn((listener: (status: UpdaterStatus) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  window.multiCliWork = { updates } as unknown as MultiCliWorkApi;
  return {
    updates,
    emit(status: UpdaterStatus) {
      act(() => {
        for (const listener of listeners) listener(status);
      });
    },
  };
}

afterEach(cleanup);

describe("update badge", () => {
  it("takes no sidebar room while up to date, and speaks up once an update is on its way", async () => {
    const harness = createUpdatesApi();

    const { container } = render(<UpdateBadge />);

    await waitFor(() => expect(harness.updates.status).toHaveBeenCalledOnce());
    // The 도움말 menu already names the running version; "최신 버전" is the usual case and says nothing.
    expect(screen.queryByText("최신 버전")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();

    harness.emit({ state: "downloading", percent: 40 });
    expect(screen.getByText("다운로드 중 40%")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
  });

  it("adopts an update that finished downloading before the renderer mounted", async () => {
    createUpdatesApi({ state: "downloaded", version: "1.1.0" });

    render(<UpdateBadge />);

    expect(await screen.findByText("1.1.0 업데이트 설치 준비 완료")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "재시작" })).toBeInTheDocument();
  });

  it("points to a manual install when the last restart left the old version running", async () => {
    const harness = createUpdatesApi({ state: "installFailed", version: "1.1.0" });

    render(<UpdateBadge />);

    expect(await screen.findByText("1.1.0 설치 실패")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "재시작" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "수동 설치" }));
    expect(harness.updates.openReleases).toHaveBeenCalledOnce();
  });

  it("checks again on demand and follows the download through to the restart prompt", async () => {
    // Up to date, the badge is not there to press — 도움말 › 업데이트 확인 is. Once it shows, it can re-check.
    const harness = createUpdatesApi({ state: "available", version: "1.1.0" });

    render(<UpdateBadge />);
    fireEvent.click(await screen.findByRole("button", { name: "확인" }));
    expect(harness.updates.check).toHaveBeenCalledOnce();

    harness.emit({ state: "downloading", percent: 42 });
    expect(screen.getByText("다운로드 중 42%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "확인" })).toBeDisabled();

    harness.emit({ state: "downloaded", version: "1.1.0" });
    fireEvent.click(screen.getByRole("button", { name: "재시작" }));
    expect(harness.updates.install).toHaveBeenCalledOnce();
  });

  it("offers the releases page when the update check fails", async () => {
    const harness = createUpdatesApi();

    render(<UpdateBadge />);
    await waitFor(() => expect(harness.updates.onEvent).toHaveBeenCalled());
    harness.emit({ state: "error", message: "net::ERR_INTERNET_DISCONNECTED" });

    expect(screen.getByText("업데이트 확인 실패")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "릴리스" }));
    expect(harness.updates.openReleases).toHaveBeenCalledOnce();
    expect(harness.updates.check).not.toHaveBeenCalled();
  });
});
