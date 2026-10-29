import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MultiCliWorkApi, TerminalSessionView } from "@shared/api-types";
import { HandoffDialog } from "./HandoffDialog";

afterEach(cleanup);
it("previews selected output and records an explicit handoff in the team board", async () => {
  const post = vi.fn(async () => ({}));
  window.multiCliWork = { board: { post } } as unknown as MultiCliWorkApi;
  const source = { id: "source", projectId: "p", kind: "claude", name: "Builder", cwd: "D:/repo" } as TerminalSessionView;
  const reviewer = { id: "reviewer", projectId: "p", kind: "codex", pid: 2, status: "working" } as TerminalSessionView;
  const onDone = vi.fn();
  render(<HandoffDialog source={source} sessions={[source, reviewer]} selection="selected result" onClose={vi.fn()} onDone={onDone} />);
  expect(post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("대상 세션"), { target: { value: "reviewer" } });
  fireEvent.change(screen.getByLabelText("요청"), { target: { value: "Review this" } });
  fireEvent.click(screen.getByRole("button", { name: "인계 전송" }));
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  expect(post).toHaveBeenCalledWith({ projectId: "p", mentions: ["reviewer"], text: expect.stringContaining("selected result") });
});
