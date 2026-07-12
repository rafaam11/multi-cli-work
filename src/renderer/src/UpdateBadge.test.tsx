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
  it("shows the running version and reports being up to date", async () => {
    const harness = createUpdatesApi();

    render(<UpdateBadge />);

    expect(await screen.findByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("최신 버전")).toBeInTheDocument();
    expect(harness.updates.status).toHaveBeenCalledOnce();
  });

  it("adopts an update that finished downloading before the renderer mounted", async () => {
    createUpdatesApi({ state: "downloaded", version: "1.1.0" });

    render(<UpdateBadge />);

    expect(await screen.findByText("1.1.0 업데이트 설치 준비 완료")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "재시작" })).toBeInTheDocument();
  });

  it("checks on demand and follows the download through to the restart prompt", async () => {
    const harness = createUpdatesApi();

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
