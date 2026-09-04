import { MAX_TAG_LENGTH } from "@shared/project-tags-types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagEditor } from "./TagEditor";
import { tagAccentClass } from "./tag-color";

afterEach(cleanup);

function renderEditor(tags: string[] = [], suggestions: string[] = []) {
  const onChange = vi.fn();
  render(<TagEditor tags={tags} suggestions={suggestions} onChange={onChange} />);
  return { onChange, input: screen.getByLabelText("태그 추가") as HTMLInputElement };
}

describe("TagEditor", () => {
  it("Enter를 누르면 다듬은 값이 태그로 올라간다", () => {
    const { onChange, input } = renderEditor(["연구"]);

    fireEvent.change(input, { target: { value: "  개인  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(["연구", "개인"]);
    expect(input).toHaveValue("");
  });

  it("쉼표로도 커밋한다", () => {
    const { onChange, input } = renderEditor();

    fireEvent.change(input, { target: { value: "개인" } });
    fireEvent.keyDown(input, { key: "," });

    expect(onChange).toHaveBeenCalledWith(["개인"]);
    expect(input).toHaveValue("");
  });

  it("이미 붙은 태그를 다시 넣으면 아무 일도 일어나지 않는다", () => {
    const { onChange, input } = renderEditor(["개인"]);

    fireEvent.change(input, { target: { value: "개인" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
    // 이미 있는 태그이므로 입력칸을 붙잡아 둘 이유도 없다.
    expect(input).toHaveValue("");
  });

  // 한글 조합을 확정하는 Enter가 그대로 커밋으로 새면, 첫 글자만 담긴 태그가 만들어진다.
  it("조합 중인 Enter는 커밋하지 않는다", () => {
    const { onChange, input } = renderEditor();

    fireEvent.change(input, { target: { value: "개" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("개");
  });

  it("빈 입력에서 Backspace를 누르면 마지막 칩이 빠진다", () => {
    const { onChange, input } = renderEditor(["연구", "개인"]);

    fireEvent.keyDown(input, { key: "Backspace" });

    expect(onChange).toHaveBeenCalledWith(["연구"]);
  });

  it("칩은 태그 색을 달고, 제거 버튼은 그 태그만 뺀다", () => {
    const { onChange } = renderEditor(["연구", "개인"]);

    const chips = document.querySelectorAll(".tag-editor-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0].classList).toContain(tagAccentClass("연구"));
    expect(chips[1].classList).toContain(tagAccentClass("개인"));

    fireEvent.click(screen.getByRole("button", { name: "연구 태그 제거" }));
    expect(onChange).toHaveBeenCalledWith(["개인"]);
  });

  it("입력은 태그 길이 상한을 넘겨 받지 않는다", () => {
    const { input } = renderEditor();

    expect(input).toHaveAttribute("maxlength", String(MAX_TAG_LENGTH));
    expect(MAX_TAG_LENGTH).toBe(32);
  });

  it("자동완성 목록에서 이미 붙은 태그는 빠진다", () => {
    const { input } = renderEditor(["개인"], ["개인", "연구"]);

    const listId = input.getAttribute("list");
    expect(listId).toBeTruthy();
    const datalist = document.getElementById(listId as string);
    expect(datalist?.tagName).toBe("DATALIST");
    expect([...(datalist?.querySelectorAll("option") ?? [])].map((option) => option.value)).toEqual(["연구"]);
  });
});
