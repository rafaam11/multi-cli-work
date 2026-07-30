import { describe, expect, it } from "vitest";
import { analyzeMarkdown, resolveMarkdownLink, toggleMarkdownTask } from "./markdown-document";

describe("Markdown task markers", () => {
  const source = [
    "1. [ ] ordered",
    "   - [X] nested",
    "- [x] lower",
    "",
    "```md",
    "- [ ] code is not a task",
    "```",
    "",
  ].join("\r\n");

  it("tracks nested and ordered task items in AST order without matching code fences", () => {
    expect(analyzeMarkdown(source).tasks.map(({ checked, marker }) => ({ checked, marker }))).toEqual([
      { checked: false, marker: "[ ]" },
      { checked: true, marker: "[X]" },
      { checked: true, marker: "[x]" },
    ]);
  });

  it("changes only the corresponding source marker and preserves CRLF", () => {
    const checked = toggleMarkdownTask(source, 0, true);
    expect(checked).toContain("1. [x] ordered\r\n   - [X] nested");
    expect(checked).toContain("```md\r\n- [ ] code is not a task\r\n```");
    expect(checked.match(/\r\n/g)).toHaveLength(source.match(/\r\n/g)?.length ?? 0);

    expect(toggleMarkdownTask(checked, 1, false)).toContain("   - [ ] nested");
  });
});

describe("Markdown heading anchors", () => {
  it("uses GitHub slugs for duplicate and Korean headings", () => {
    expect(analyzeMarkdown("# 한글 제목\n## 한글 제목\n# Another Heading\n").headings).toEqual([
      expect.objectContaining({ text: "한글 제목", slug: "한글-제목" }),
      expect.objectContaining({ text: "한글 제목", slug: "한글-제목-1" }),
      expect.objectContaining({ text: "Another Heading", slug: "another-heading" }),
    ]);
  });
});

describe("Markdown link routing", () => {
  it("keeps anchors in the document and resolves relative files from the current document", () => {
    expect(resolveMarkdownLink("docs/guide/readme.md", "#한글-제목")).toEqual({
      kind: "anchor",
      anchor: "한글-제목",
    });
    expect(resolveMarkdownLink("docs/guide/readme.md", "../api.md#usage")).toEqual({
      kind: "file",
      relativePath: "docs/api.md",
      anchor: "usage",
    });
  });

  it("allows only http(s) externally and rejects root escapes or unknown schemes", () => {
    expect(resolveMarkdownLink("README.md", "https://example.com/docs")).toEqual({
      kind: "external",
      url: "https://example.com/docs",
    });
    expect(resolveMarkdownLink("docs/readme.md", "../../secret.md")).toMatchObject({ kind: "blocked" });
    expect(resolveMarkdownLink("docs/readme.md", "%2e%2e/%2e%2e/secret.md")).toMatchObject({ kind: "blocked" });
    expect(resolveMarkdownLink("docs/readme.md", "/etc/passwd")).toMatchObject({ kind: "blocked" });
    expect(resolveMarkdownLink("docs/readme.md", "javascript:alert(1)")).toMatchObject({ kind: "blocked" });
    expect(resolveMarkdownLink("docs/readme.md", "mailto:user@example.com")).toMatchObject({ kind: "blocked" });
  });
});
