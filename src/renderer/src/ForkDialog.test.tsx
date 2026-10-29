import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MultiCliWorkApi, TerminalSessionView } from "@shared/api-types";
import { ForkDialog } from "./ForkDialog";
afterEach(cleanup);
it("launches a fork only after confirmation and keeps launch failures reviewable", async () => {
  const fork = vi.fn().mockRejectedValueOnce(new Error("No saved conversation"));
  window.multiCliWork = { terminals: { fork } } as unknown as MultiCliWorkApi;
  render(<ForkDialog source={{ id: "parent", name: "Parent", kind: "claude", cwd: "D:/repo" } as TerminalSessionView} onClose={vi.fn()} onCreated={vi.fn()} />);
  expect(fork).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "새 대화로 분기" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No saved conversation"));
  expect(fork).toHaveBeenCalledWith(expect.objectContaining({ sourceSessionId: "parent" }));
  expect(screen.getByRole("dialog", { name: "대화 분기" })).toBeInTheDocument();
});
