import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MultiCliWorkApi } from "@shared/api-types";
import type { SavedViewPreset } from "@shared/workbench-types";
import { SavedViewPicker } from "./SavedViewPicker";

afterEach(cleanup);
const current = { layoutId: "cols:1-2", sidebarCollapsed: true, rightSidebarCollapsed: false, rightSidebarTab: "activity" as const };
it("saves panel and split settings, then applies the named layout without launching a terminal", async () => {
  const state = { schemaVersion: 1 as const, prompts: [], drafts: {}, savedViews: [] as SavedViewPreset[] };
  const saveView = vi.fn(async (view: SavedViewPreset) => ({ ...state, savedViews: [view] }));
  const create = vi.fn(); const onApply = vi.fn();
  window.multiCliWork = { workbench: { state: async () => ({ state, writable: true }), saveView }, terminals: { create } } as unknown as MultiCliWorkApi;
  render(<SavedViewPicker current={current} onApply={onApply} />);
  fireEvent.click(screen.getByRole("button", { name: "저장 배치" }));
  fireEvent.change(screen.getByLabelText("배치 이름"), { target: { value: "Review" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "현재 배치 저장" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "현재 배치 저장" }));
  await waitFor(() => expect(saveView).toHaveBeenCalledWith(expect.objectContaining({ ...current, name: "Review" })));
  fireEvent.click(await screen.findByRole("button", { name: /Review.*패널 상태 복원/ }));
  expect(onApply).toHaveBeenCalledWith(saveView.mock.calls[0][0]);
  expect(create).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("lets a backup layout be applied while disabling writes", async () => {
  const view = { ...current, id: "v", name: "Read only" };
  window.multiCliWork = { workbench: { state: async () => ({ writable: false, warning: "복구 필요", state: { schemaVersion: 1, prompts: [], drafts: {}, savedViews: [view] } }) } } as unknown as MultiCliWorkApi;
  const onApply = vi.fn(); render(<SavedViewPicker current={current} onApply={onApply} />);
  fireEvent.click(screen.getByRole("button", { name: "저장 배치" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("복구 필요");
  expect(screen.getByRole("button", { name: "Read only 배치 삭제" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Read only.*패널 상태 복원/ }));
  expect(onApply).toHaveBeenCalledWith(view);
});
it("keeps Escape working when removing a focused row leaves focus outside the dialog", async () => {
  const state = { schemaVersion: 1 as const, prompts: [], drafts: {}, savedViews: [{ ...current, id: "v", name: "Review" }] };
  window.multiCliWork = { workbench: { state: async () => ({ state, writable: true }), removeView: async () => ({ ...state, savedViews: [] }) } } as unknown as MultiCliWorkApi;
  render(<SavedViewPicker current={current} onApply={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "저장 배치" }));
  const remove = await screen.findByRole("button", { name: "Review 배치 삭제" });
  remove.focus(); fireEvent.click(remove);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Review 배치 삭제" })).not.toBeInTheDocument());
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "저장 배치" })).toHaveFocus();
});
