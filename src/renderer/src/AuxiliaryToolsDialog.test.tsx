import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MultiCliWorkApi } from "@shared/api-types";
import { AuxiliaryToolsDialog } from "./AuxiliaryToolsDialog";

afterEach(cleanup);
it("keeps unsaved prompt text across close/reopen and returns focus on Escape", async () => {
  window.multiCliWork = { workbench: { state: async () => ({ writable: true, state: { schemaVersion: 1, prompts: [], drafts: {} } }) } } as unknown as MultiCliWorkApi;
  const onClose = vi.fn(); const props = { sessions: [], onClose, onFocusSession: vi.fn() };
  const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
  const view = render(<AuxiliaryToolsDialog {...props} tool="prompts" />);
  fireEvent.change(screen.getByLabelText("프롬프트"), { target: { value: "unsaved request" } });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
  view.rerender(<AuxiliaryToolsDialog {...props} tool={null} />);
  expect(trigger).toHaveFocus();
  view.rerender(<AuxiliaryToolsDialog {...props} tool="prompts" />);
  await waitFor(() => expect(screen.getByLabelText("프롬프트")).toHaveValue("unsaved request"));
  trigger.remove();
});
