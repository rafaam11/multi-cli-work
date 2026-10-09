import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenFileTab } from "./file-tabs";
import { FileViewerPane } from "./FileViewerPane";

function tab(overrides: Partial<OpenFileTab> = {}): OpenFileTab {
  return {
    id: "project:project-1:docs/readme.md",
    target: { kind: "project", id: "project-1" },
    targetLabel: "Project",
    relativePath: "docs/readme.md",
    name: "readme.md",
    extension: "md",
    category: "markdown",
    encoding: "utf8",
    content: "# 한글 제목\n# 한글 제목\n\n1. [ ] first\n   - [X] nested\n\n[API](../api.md) [외부](https://example.com) [차단](javascript:alert(1))\n\n<button>raw</button>\n",
    originalContent: "",
    dirty: true,
    loading: false,
    saving: false,
    loadError: null,
    saveError: null,
    truncated: false,
    ...overrides,
  };
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    tab: tab(),
    onChangeContent: vi.fn(),
    onAutoSaveContent: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
    onForceOpen: vi.fn(),
    onOpenRelativePath: vi.fn(),
    ...overrides,
  };
}

describe("FileViewerPane Markdown preview", () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.multiCliWork = {
      shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
    } as unknown as typeof window.multiCliWork;
  });

  it("renders GitHub-compatible heading ids, interactive GFM tasks, and no raw HTML", () => {
    const onAutoSaveContent = vi.fn();
    const view = render(<FileViewerPane {...props({ onAutoSaveContent })} />);

    expect(screen.getAllByRole("heading").map((heading) => heading.id)).toEqual(["한글-제목", "한글-제목-1"]);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).not.toBeDisabled();
    expect(boxes[1]).toBeChecked();
    expect(screen.queryByRole("button", { name: "raw" })).not.toBeInTheDocument();

    fireEvent.click(boxes[0]);
    expect(onAutoSaveContent).toHaveBeenLastCalledWith(expect.stringContaining("1. [x] first"));

    const next = onAutoSaveContent.mock.calls.at(-1)?.[0] as string;
    view.rerender(<FileViewerPane {...props({ tab: tab({ content: next }), onAutoSaveContent })} />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(onAutoSaveContent).toHaveBeenLastCalledWith(expect.stringContaining("   - [ ] nested"));
  });

  it("routes same-document, relative, and external links while rejecting unknown schemes", async () => {
    const onOpenRelativePath = vi.fn();
    const scrollIntoView = vi.fn();
    const view = render(
      <FileViewerPane
        {...props({
          tab: tab({
            content: "# Target\n\n[anchor](#target) [API](../api.md#usage) [web](https://example.com/x) [bad](mailto:a@example.com)",
          }),
          onOpenRelativePath,
        })}
      />,
    );
    Object.defineProperty(view.container.querySelector("#target"), "scrollIntoView", { value: scrollIntoView });

    fireEvent.click(screen.getByRole("link", { name: "anchor" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });

    fireEvent.click(screen.getByRole("link", { name: "API" }));
    expect(onOpenRelativePath).toHaveBeenCalledWith("api.md", "usage");

    fireEvent.click(screen.getByRole("link", { name: "web" }));
    expect(window.multiCliWork.shell.openExternal).toHaveBeenCalledWith("https://example.com/x");

    fireEvent.click(screen.getByRole("link", { name: "bad" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("http/https 외의 링크 형식");
    expect(window.multiCliWork.shell.openExternal).toHaveBeenCalledTimes(1);
  });

  it("offers the same save action for ordinary UTF-8 text", () => {
    const onSave = vi.fn();
    render(
      <FileViewerPane
        {...props({
          tab: tab({ category: "text", extension: "txt", name: "notes.txt", content: "changed" }),
          onSave,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "편집" })).not.toBeInTheDocument();
  });
});

describe("FileViewerPane line reveal", () => {
  afterEach(cleanup);

  it("selects the revealed line in a text file and says it is done", () => {
    const onRevealed = vi.fn();
    render(
      <FileViewerPane
        {...props({
          tab: tab({ category: "text", name: "a.ts", extension: "ts", content: "one\ntwo words\nthree" }),
          reveal: { line: 2, column: 5, nonce: 1 },
          onRevealed,
        })}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "a.ts 편집" }) as HTMLTextAreaElement;
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([8, 13]);
    expect(document.activeElement).toBe(editor);
    expect(onRevealed).toHaveBeenCalledOnce();
  });

  it("switches a Markdown file to its editor to show the line", () => {
    render(<FileViewerPane {...props({ reveal: { line: 4, column: 1, nonce: 1 }, onRevealed: vi.fn() })} />);
    const editor = screen.getByRole("textbox", { name: "readme.md 편집" }) as HTMLTextAreaElement;
    expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("1. [ ] first");
  });

  it("waits for the file to load before revealing", () => {
    const onRevealed = vi.fn();
    const loading = tab({ category: "text", name: "a.ts", content: null, loading: true });
    const view = render(<FileViewerPane {...props({ tab: loading, reveal: { line: 1, column: 1, nonce: 1 }, onRevealed })} />);
    expect(onRevealed).not.toHaveBeenCalled();
    view.rerender(
      <FileViewerPane
        {...props({ tab: { ...loading, content: "x", loading: false }, reveal: { line: 1, column: 1, nonce: 1 }, onRevealed })}
      />,
    );
    expect(onRevealed).toHaveBeenCalledOnce();
  });
});
