import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useConfirmDialog, type ConfirmRequest } from "./confirm-dialog";

let ask: ((request: ConfirmRequest) => Promise<boolean>) | null = null;

function Host() {
  const { confirm, dialog } = useConfirmDialog();
  ask = confirm;
  return <>{dialog}</>;
}

afterEach(() => {
  cleanup();
  ask = null;
});

const request: ConfirmRequest = { title: "정리할까요?", message: "리뷰가 확인되지 않았습니다", confirmLabel: "정리", danger: true };

describe("useConfirmDialog", () => {
  it("resolves true when the user confirms, and closes", async () => {
    render(<Host />);
    let answer: Promise<boolean>;
    act(() => {
      answer = ask!(request);
    });

    const dialog = screen.getByRole("dialog", { name: "정리할까요?" });
    expect(dialog).toHaveTextContent("리뷰가 확인되지 않았습니다");
    expect(screen.getByRole("button", { name: "정리" })).toHaveClass("danger-button");
    fireEvent.click(screen.getByRole("button", { name: "정리" }));

    await expect(answer!).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("treats 취소 and Escape as no", async () => {
    render(<Host />);
    let first: Promise<boolean>;
    act(() => {
      first = ask!(request);
    });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await expect(first!).resolves.toBe(false);

    let second: Promise<boolean>;
    act(() => {
      second = ask!(request);
    });
    fireEvent.keyDown(window, { key: "Escape" });
    await expect(second!).resolves.toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("answers an earlier request with no when a new one replaces it", async () => {
    render(<Host />);
    let first: Promise<boolean>;
    act(() => {
      first = ask!(request);
    });
    act(() => {
      void ask!({ ...request, title: "두 번째" });
    });
    await expect(first!).resolves.toBe(false);
    expect(screen.getByRole("dialog", { name: "두 번째" })).toBeInTheDocument();
  });
});
