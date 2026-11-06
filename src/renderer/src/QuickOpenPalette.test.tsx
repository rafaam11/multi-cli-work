import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuickOpenPalette } from "./QuickOpenPalette";

afterEach(cleanup);
it("keeps linked worktree sessions in the current repository scope", () => {
  render(<QuickOpenPalette currentProjectId="p" items={[
    { key: "session:main", kind: "session", label: "Main", detail: null, projectId: "p" },
    { key: "session:wt", kind: "session", label: "Worktree", detail: "feature", projectId: "p" },
    { key: "session:other", kind: "session", label: "Other", detail: null, projectId: "other" },
  ]} onSelect={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "현재 저장소" }));
  expect(screen.getByText("Main")).toBeInTheDocument();
  expect(screen.getByText("Worktree")).toBeInTheDocument();
  expect(screen.queryByText("Other")).not.toBeInTheDocument();
});

it("filters navigation without losing keyboard selection", () => {
  const onSelect = vi.fn();
  render(<QuickOpenPalette items={[
    { key: "session:s", kind: "session", label: "Builder", detail: "repo" },
    { key: "command:c", kind: "command", label: "Settings", detail: null },
  ]} onSelect={onSelect} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^명령$/ }));
  expect(screen.queryByText("Builder")).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "command:c" }));
  fireEvent.click(screen.getByRole("button", { name: /^전체$/ }));
  expect(screen.getByText("Builder")).toBeInTheDocument();
});

it("keeps commands out of 전체 — 빠른 열기 is for going places, Ctrl+Shift+P for doing things", () => {
  render(<QuickOpenPalette items={[
    { key: "session:s", kind: "session", label: "Builder", detail: "repo" },
    { key: "command:c", kind: "command", label: "보기: 확대", detail: null, shortcut: "Ctrl+=" },
  ]} onSelect={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "세션·폴더 검색");
  expect(screen.queryByText("보기: 확대")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /^명령$/ }));
  expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "명령 검색");
  expect(screen.getByText("보기: 확대")).toBeInTheDocument();
  expect(screen.getByText("Ctrl+=")).toBeInTheDocument();
});

it("lists every command, not just the first ten", () => {
  const commands = Array.from({ length: 30 }, (_, index) => ({
    key: `command:c${index}`,
    kind: "command" as const,
    label: `명령 ${index}`,
    detail: null,
  }));
  render(<QuickOpenPalette initialKind="command" items={commands} onSelect={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getAllByRole("option")).toHaveLength(30);
});
