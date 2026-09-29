import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionList } from "./SessionList";

afterEach(cleanup);

describe("SessionList", () => {
  it("shows status badges and opens a session", () => {
    const onOpen = vi.fn();
    render(
      <SessionList
        hostName="PC"
        connection="open"
        sessions={[
          { id: "1", projectId: "p", projectName: "A", kind: "claude", label: "리팩터", status: "awaiting-input", updatedAt: "" },
        ]}
        onOpen={onOpen}
        onUnpair={vi.fn()}
        leaveLabel="호스트 목록"
      />,
    );
    expect(screen.getByRole("button", { name: "호스트 목록" })).toBeInTheDocument();
    expect(screen.getByText("입력 대기")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
    expect(onOpen).toHaveBeenCalledWith("1");
  });

  it("says when there is nothing to show and when the link is down", () => {
    render(<SessionList hostName="PC" connection="reconnecting" sessions={[]} onOpen={vi.fn()} onUnpair={vi.fn()} />);
    expect(screen.getByText("열린 세션이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("다시 연결하는 중…")).toBeInTheDocument();
  });
});
