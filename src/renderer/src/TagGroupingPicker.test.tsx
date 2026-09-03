import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagGroupingPicker } from "./TagGroupingPicker";

afterEach(cleanup);

function renderPicker(selected: string[] = [], options?: { available?: string[]; isDefault?: boolean }) {
  const onChange = vi.fn();
  render(
    <TagGroupingPicker
      available={options?.available ?? ["용역", "개인", "연구"]}
      selected={selected}
      isDefault={options?.isDefault ?? false}
      onChange={onChange}
    />,
  );
  return { onChange, button: screen.getByRole("button", { name: "묶기 설정" }) };
}

describe("TagGroupingPicker", () => {
  it("고른 태그를 고른 순서대로 버튼에 적고, 없으면 없음이라고 적는다", () => {
    const { button } = renderPicker(["개인", "용역"]);
    expect(button).toHaveTextContent("묶기: 개인 › 용역");

    cleanup();
    expect(renderPicker([]).button).toHaveTextContent("묶기: 없음");
  });

  it("저장된 선호 없이 도는 기본값은 (자동)이라고 밝힌다", () => {
    const { button } = renderPicker(["용역"], { isDefault: true });
    expect(button).toHaveTextContent("묶기: 용역 (자동)");
  });

  it("닫혀 있다가 눌러야 열린다", () => {
    const { button } = renderPicker();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitemcheckbox").map((item) => item.textContent)).toEqual([
      "용역",
      "개인",
      "연구",
    ]);
  });

  it("고르면 끝에 붙는다 — 순서는 고른 순서다", () => {
    const { onChange, button } = renderPicker(["개인"]);
    fireEvent.click(button);

    expect(screen.getByRole("menuitemcheckbox", { name: "개인" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: "용역" })).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "용역" }));
    expect(onChange).toHaveBeenCalledWith(["개인", "용역"]);
  });

  it("이미 고른 것을 다시 누르면 빠진다", () => {
    const { onChange, button } = renderPicker(["개인", "용역"]);
    fireEvent.click(button);

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "개인" }));
    expect(onChange).toHaveBeenCalledWith(["용역"]);
  });

  it("묶기 해제는 전부 비우고 메뉴를 닫는다", () => {
    const { onChange, button } = renderPicker(["개인", "용역"]);
    fireEvent.click(button);

    fireEvent.click(screen.getByRole("menuitem", { name: "묶기 해제" }));
    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Escape로도, 바깥을 눌러도 닫힌다", () => {
    const { button } = renderPicker();

    fireEvent.click(button);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("붙어 있는 태그가 없으면 고를 것이 없다고 말한다", () => {
    const { button } = renderPicker([], { available: [] });
    fireEvent.click(button);

    expect(screen.queryAllByRole("menuitemcheckbox")).toHaveLength(0);
    expect(screen.getByRole("menu")).toHaveTextContent("태그 없음");
  });
});
