import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagGroupingPicker } from "./TagGroupingPicker";

afterEach(cleanup);

function renderPicker(selected: string[] = [], options?: { available?: string[]; isDefault?: boolean }) {
  const onChange = vi.fn();
  const picker = (tags: readonly string[]) => (
    <TagGroupingPicker
      available={options?.available ?? ["용역", "개인", "연구"]}
      selected={tags}
      isDefault={options?.isDefault ?? false}
      onChange={onChange}
    />
  );
  const view = render(picker(selected));
  return {
    onChange,
    button: screen.getByRole("button", { name: "묶기 설정" }),
    /** 부모가 선택을 돌려준 뒤 다시 그리는 것 — 열려 있던 메뉴는 그대로 열려 있다. */
    rerender: (tags: readonly string[]) => view.rerender(picker(tags)),
  };
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

  /**
   * 고른 것을 앞으로 끌어내면 방금 누른 줄이 발밑에서 자리를 옮긴다. 연달아 둘을 고르는 메뉴라
   * 그것은 조준을 다시 하게 만든다 — 고른 순서는 버튼 텍스트가 따로 말한다.
   */
  it("줄 순서는 후보 순서로 고정이고, 사라진 태그만 맨 뒤에 붙는다", () => {
    const { button } = renderPicker(["연구", "사라진태그"]);
    fireEvent.click(button);

    expect(screen.getAllByRole("menuitemcheckbox").map((item) => item.textContent)).toEqual([
      "용역",
      "개인",
      "연구",
      "사라진태그",
    ]);
  });

  it("고르거나 해제해도 줄이 자리를 옮기지 않는다", () => {
    const order = () => screen.getAllByRole("menuitemcheckbox").map((item) => item.textContent);
    const { rerender, button } = renderPicker([]);
    fireEvent.click(button);
    expect(order()).toEqual(["용역", "개인", "연구"]);

    // 부모가 선택을 돌려주며 다시 그려도 목록은 그대로다.
    rerender(["연구"]);
    expect(order()).toEqual(["용역", "개인", "연구"]);
    rerender(["연구", "용역"]);
    expect(order()).toEqual(["용역", "개인", "연구"]);
  });

  /**
   * 마지막 업무 프로젝트에서 태그가 떨어지면 후보 목록에서는 사라지지만 묶기에는 남아 있다.
   * 그때도 항목이 서 있어야 해제할 수 있다 — 아니면 버튼에는 보이는데 뺄 길이 없는 묶기가 된다.
   */
  it("이제 아무 데도 안 붙은 태그라도 묶기에 남아 있으면 해제할 수 있다", () => {
    const { onChange, button } = renderPicker(["사라진태그", "용역"], { available: ["용역", "개인"] });
    fireEvent.click(button);

    const orphan = screen.getByRole("menuitemcheckbox", { name: "사라진태그" });
    expect(orphan).toHaveAttribute("aria-checked", "true");

    fireEvent.click(orphan);
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
