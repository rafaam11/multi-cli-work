import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteCatalog } from "@shared/remote-types";
import { NewSessionForm } from "./NewSessionForm";

const CATALOG: RemoteCatalog = {
  projects: [
    { id: "p1", name: "multi-cli-work", worktrees: [] },
    {
      id: "p2",
      name: "atlas",
      worktrees: [
        { id: "w1", branch: "feat/search" },
        { id: "w2", branch: "fix/login" },
      ],
    },
  ],
  agents: [
    { id: "claude", label: "Claude" },
    { id: "codex", label: "Codex" },
  ],
};

afterEach(cleanup);

describe("NewSessionForm", () => {
  it("starts a session in the chosen folder with the chosen agent", () => {
    const onStart = vi.fn();
    render(<NewSessionForm catalog={CATALOG} onStart={onStart} onCancel={vi.fn()} />);
    // 고르지 않으면 첫 폴더·첫 에이전트다.
    expect(screen.getByLabelText("폴더")).toHaveValue("p1");
    fireEvent.change(screen.getByLabelText("폴더"), { target: { value: "p2" } });
    fireEvent.change(screen.getByLabelText("에이전트"), { target: { value: "codex" } });
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    expect(onStart).toHaveBeenCalledWith("p2", "codex", null);
  });

  it("offers the folder's worktrees and starts in the chosen one", () => {
    const onStart = vi.fn();
    render(<NewSessionForm catalog={CATALOG} onStart={onStart} onCancel={vi.fn()} />);
    // 워크트리가 없는 폴더에서는 고를 것이 없다.
    expect(screen.queryByLabelText("작업 위치")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("폴더"), { target: { value: "p2" } });
    const place = screen.getByLabelText("작업 위치");
    expect(place).toHaveValue("");
    expect([...place.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["루트", "feat/search", "fix/login"]);
    fireEvent.change(place, { target: { value: "w2" } });
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    expect(onStart).toHaveBeenCalledWith("p2", "claude", "w2");
  });

  it("goes back to the folder root when another folder is chosen", () => {
    render(<NewSessionForm catalog={CATALOG} onStart={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("폴더"), { target: { value: "p2" } });
    fireEvent.change(screen.getByLabelText("작업 위치"), { target: { value: "w1" } });
    fireEvent.change(screen.getByLabelText("폴더"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("폴더"), { target: { value: "p2" } });
    expect(screen.getByLabelText("작업 위치")).toHaveValue("");
  });

  it("cannot start without a folder and an agent", () => {
    const onStart = vi.fn();
    const { rerender } = render(
      <NewSessionForm catalog={{ projects: [], agents: CATALOG.agents }} onStart={onStart} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("호스트에 등록된 폴더가 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "시작" })).toBeDisabled();

    rerender(<NewSessionForm catalog={{ projects: CATALOG.projects, agents: [] }} onStart={onStart} onCancel={vi.fn()} />);
    expect(screen.getByText("호스트에서 실행할 수 있는 에이전트가 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "시작" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    expect(onStart).not.toHaveBeenCalled();
  });

  it("waits for the catalog", () => {
    const onCancel = vi.fn();
    render(<NewSessionForm catalog={null} onStart={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "시작" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
