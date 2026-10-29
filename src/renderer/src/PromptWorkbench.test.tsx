import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MultiCliWorkApi, TerminalSessionView } from "@shared/api-types";
import { PromptWorkbench } from "./PromptWorkbench";

afterEach(cleanup);
it("restores a target draft and sends through the delivery queue", async () => {
  const send = vi.fn(async () => ({}));
  window.multiCliWork = {
    workbench: { state: vi.fn(async () => ({ writable: true, state: { schemaVersion: 1, prompts: [], drafts: { s: "saved draft" } } })) },
    deliveries: { send },
  } as unknown as MultiCliWorkApi;
  const sessions = [{ id: "s", pid: 1, status: "working", kind: "codex", name: "Builder" }] as TerminalSessionView[];
  render(<PromptWorkbench hidden={false} sessions={sessions} onFocusSession={vi.fn()} />);
  await waitFor(() => expect(window.multiCliWork.workbench.state).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("대상 세션"), { target: { value: "s" } });
  expect(screen.getByLabelText("프롬프트")).toHaveValue("saved draft");
  fireEvent.click(screen.getByRole("button", { name: "보류 큐로 전송" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith("s", "saved draft"));
});
it("does not read the store while its tab is hidden", () => {
  const state = vi.fn();
  window.multiCliWork = { workbench: { state } } as unknown as MultiCliWorkApi;
  render(<PromptWorkbench hidden sessions={[]} onFocusSession={vi.fn()} />);
  expect(state).not.toHaveBeenCalled();
});
