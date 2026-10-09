import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreeScriptsCard } from "./WorktreeScriptsCard";

const api = {
  get: vi.fn(),
  set: vi.fn(),
};

beforeEach(() => {
  api.get.mockReset();
  api.set.mockReset().mockResolvedValue(undefined);
  window.multiCliWork = { platform: "win32", worktreeScripts: api } as unknown as typeof window.multiCliWork;
});

afterEach(cleanup);

describe("WorktreeScriptsCard", () => {
  it("shows the folder's saved scripts and saves an edit", async () => {
    api.get.mockResolvedValue({ setup: "npm ci", teardown: "", teardownTimeoutSec: 120 });
    render(<WorktreeScriptsCard projectId="p1" />);

    const setup = (await screen.findByRole("textbox", { name: "준비 스크립트" })) as HTMLTextAreaElement;
    await waitFor(() => expect(setup.value).toBe("npm ci"));
    const save = screen.getByRole("button", { name: "스크립트 저장" });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "정리 스크립트" }), { target: { value: "Remove-Item .cache" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "정리 제한 시간(초)" }), { target: { value: "30" } });
    fireEvent.click(save);

    await waitFor(() =>
      expect(api.set).toHaveBeenCalledWith("p1", { setup: "npm ci", teardown: "Remove-Item .cache", teardownTimeoutSec: 30 }),
    );
    expect(await screen.findByText("저장했습니다")).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it("starts empty for a folder without scripts and reports a failed save", async () => {
    api.get.mockResolvedValue(null);
    api.set.mockRejectedValue(new Error("Setup script must be at most 16384 characters"));
    render(<WorktreeScriptsCard projectId="p1" />);

    const setup = (await screen.findByRole("textbox", { name: "준비 스크립트" })) as HTMLTextAreaElement;
    expect(setup.value).toBe("");
    fireEvent.change(setup, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "스크립트 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("16384");
  });
});
