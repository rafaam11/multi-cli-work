import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitDiffPane, type GitDiffFile } from "./GitDiffPane";

const monacoHarness = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
}));

vi.mock("./monaco-setup", () => ({
  monaco: {
    Uri: { parse: vi.fn((value: string) => value) },
    editor: {
      getModel: vi.fn(() => null),
      createModel: vi.fn(() => ({ dispose: vi.fn() })),
      createDiffEditor: vi.fn((_element: HTMLElement, options: Record<string, unknown>) => {
        monacoHarness.options.push(options);
        return { setModel: vi.fn(), dispose: vi.fn() };
      }),
    },
  },
}));

const file: GitDiffFile = {
  target: { kind: "project", id: "project-atlas" },
  path: "src/app.ts",
  status: "?",
  targetLabel: "Atlas",
};

beforeEach(() => {
  monacoHarness.options.length = 0;
  Object.assign(window, {
    multiCliWork: {
      git: { fileOriginal: vi.fn() },
      workspaceFiles: {
        readFile: vi.fn().mockResolvedValue({
          relativePath: file.path,
          encoding: "utf8",
          content: "export const value = 1;\n",
          truncated: false,
          sizeBytes: 24,
        }),
      },
    },
  });
});

afterEach(cleanup);

describe("GitDiffPane typography", () => {
  it("creates Monaco diffs with the shared 13px content size", async () => {
    render(<GitDiffPane file={file} onClose={vi.fn()} />);

    await waitFor(() => expect(monacoHarness.options).toHaveLength(1));
    expect(monacoHarness.options[0]).toMatchObject({ fontSize: 13 });
  });
});
