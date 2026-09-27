import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FanOutDialog } from "./FanOutDialog";

afterEach(cleanup);

const targets = [
  { sessionId: "s1", label: "Claude Code", detail: "main" },
  { sessionId: "s2", label: "Codex", detail: "feature" },
];

function renderDialog(overrides: Partial<Parameters<typeof FanOutDialog>[0]> = {}) {
  const props = {
    projectName: "atlas",
    targets,
    templates: [{ name: "테스트", text: "npm test를 돌리고 실패를 고쳐" }],
    onSaveTemplates: vi.fn(),
    onSend: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<FanOutDialog {...props} />);
  return props;
}

describe("FanOutDialog templates", () => {
  it("fills the prompt from a saved template", () => {
    renderDialog();
    fireEvent.change(screen.getByRole("combobox", { name: "템플릿" }), { target: { value: "테스트" } });
    expect(screen.getByRole("textbox", { name: "팬아웃 프롬프트" })).toHaveValue("npm test를 돌리고 실패를 고쳐");
  });

  it("saves the current prompt under a name, replacing a template of the same name", () => {
    const props = renderDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "팬아웃 프롬프트" }), { target: { value: "변경을 리뷰해" } });
    fireEvent.click(screen.getByRole("button", { name: "템플릿으로 저장" }));
    fireEvent.change(screen.getByRole("textbox", { name: "템플릿 이름" }), { target: { value: "리뷰" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(props.onSaveTemplates).toHaveBeenLastCalledWith([
      { name: "테스트", text: "npm test를 돌리고 실패를 고쳐" },
      { name: "리뷰", text: "변경을 리뷰해" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "템플릿으로 저장" }));
    fireEvent.change(screen.getByRole("textbox", { name: "템플릿 이름" }), { target: { value: "테스트" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(props.onSaveTemplates).toHaveBeenLastCalledWith([{ name: "테스트", text: "변경을 리뷰해" }]);
  });

  it("deletes the chosen template", () => {
    const props = renderDialog();
    fireEvent.change(screen.getByRole("combobox", { name: "템플릿" }), { target: { value: "테스트" } });
    fireEvent.click(screen.getByRole("button", { name: "템플릿 삭제" }));
    expect(props.onSaveTemplates).toHaveBeenLastCalledWith([]);
  });

  it("offers no save while the prompt is empty", () => {
    renderDialog({ templates: [] });
    expect(screen.getByRole("button", { name: "템플릿으로 저장" })).toBeDisabled();
    expect(screen.queryByRole("combobox", { name: "템플릿" })).not.toBeInTheDocument();
  });
});
