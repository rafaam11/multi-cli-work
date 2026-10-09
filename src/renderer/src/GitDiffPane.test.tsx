import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalDiffNote } from "./app/diff-notes";
import { GitDiffPane, type GitDiffFile, type GitDiffNotesProps } from "./GitDiffPane";

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
      setTheme: vi.fn(),
    },
  },
  monacoThemeName: (theme: "dark" | "light") => (theme === "light" ? "mcw-light" : "mcw-dark"),
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

const gutterHarness = vi.hoisted(() => ({
  pick: null as null | ((side: "LEFT" | "RIGHT", line: number, lineText: string) => void),
  marked: [] as Array<Array<{ side: string; line: number }>>,
}));

vi.mock("./diff-note-gutter", () => ({
  attachDiffNoteGutter: (_editor: unknown, onPick: typeof gutterHarness.pick) => {
    gutterHarness.pick = onPick;
    return {
      setNotes: (notes: Array<{ side: string; line: number }>) => gutterHarness.marked.push(notes),
      dispose: vi.fn(),
    };
  },
}));

describe("GitDiffPane line notes", () => {
  const draft = (overrides: Partial<LocalDiffNote> = {}): LocalDiffNote => ({
    id: "n1",
    targetKey: "project:project-atlas",
    path: "src/app.ts",
    side: "RIGHT",
    line: 1,
    lineText: "export const value = 1;",
    body: "rename it",
    status: "draft",
    createdAt: 1,
    sentAt: null,
    ...overrides,
  });

  function notesProps(overrides: Partial<GitDiffNotesProps> = {}): GitDiffNotesProps {
    return {
      notes: [],
      onAdd: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      targets: [
        { id: "s-shell", label: "PowerShell" },
        { id: "s-claude", label: "Claude Code" },
      ],
      defaultTarget: "s-claude",
      onSend: vi.fn(),
      ...overrides,
    };
  }

  beforeEach(() => {
    gutterHarness.pick = null;
    gutterHarness.marked.length = 0;
  });

  it("opens a note on the picked line and hands it up with its place and code", async () => {
    const notes = notesProps();
    render(<GitDiffPane file={file} onClose={vi.fn()} notes={notes} />);
    await waitFor(() => expect(gutterHarness.pick).not.toBeNull());

    act(() => gutterHarness.pick!("RIGHT", 1, "export const value = 1;"));
    const editor = screen.getByRole("group", { name: "줄 메모 편집" });
    expect(editor).toHaveTextContent("작업 트리 1줄");
    fireEvent.change(within(editor).getByRole("textbox", { name: "줄 메모" }), { target: { value: " rename it " } });
    fireEvent.click(within(editor).getByRole("button", { name: "메모 남기기" }));

    expect(notes.onAdd).toHaveBeenCalledWith({
      path: "src/app.ts",
      side: "RIGHT",
      line: 1,
      lineText: "export const value = 1;",
      body: "rename it",
    });
    expect(screen.queryByRole("group", { name: "줄 메모 편집" })).toBeNull();
  });

  it("marks noted lines, edits an existing note from its line, and sends every draft to the chosen session", async () => {
    const other = draft({ id: "n2", path: "src/other.ts", line: 4, body: "check this" });
    const sent = draft({ id: "n3", status: "sent", sentAt: 2 });
    const notes = notesProps({ notes: [draft(), other, sent] });
    render(<GitDiffPane file={file} onClose={vi.fn()} notes={notes} />);
    await waitFor(() => expect(gutterHarness.marked.at(-1)).toEqual([expect.objectContaining({ id: "n1" })]));

    act(() => gutterHarness.pick!("RIGHT", 1, "export const value = 1;"));
    const box = within(screen.getByRole("group", { name: "줄 메모 편집" })).getByRole("textbox", { name: "줄 메모" });
    expect((box as HTMLTextAreaElement).value).toBe("rename it");
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "고치기" }));
    expect(notes.onDelete).toHaveBeenCalledWith("n1");

    const list = screen.getByRole("region", { name: "줄 메모 목록" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect((within(list).getByRole("combobox", { name: "보낼 세션" }) as HTMLSelectElement).value).toBe("s-claude");
    fireEvent.click(within(list).getByRole("button", { name: /메모 2개 보내기/ }));
    expect(notes.onSend).toHaveBeenCalledWith("s-claude", [draft(), other]);
  });

  it("says so when no session of the checkout can take the notes", async () => {
    render(<GitDiffPane file={file} onClose={vi.fn()} notes={notesProps({ notes: [draft()], targets: [], defaultTarget: null })} />);
    const list = await screen.findByRole("region", { name: "줄 메모 목록" });
    expect(list).toHaveTextContent("실행 중인 세션이 없습니다");
    expect(within(list).getByRole("button", { name: /보내기/ })).toBeDisabled();
  });
});
