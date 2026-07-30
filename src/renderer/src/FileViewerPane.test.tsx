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
