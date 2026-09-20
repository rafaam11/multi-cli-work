import type { FileTreeEntry } from "@shared/file-explorer-types";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileExplorer } from "./FileExplorer";

const target = { kind: "project", id: "p1" } as const;

const folder: FileTreeEntry = { name: "src", relativePath: "src", kind: "directory", extension: null, executable: false, mtimeMs: 0 };
const file: FileTreeEntry = { name: "readme.md", relativePath: "readme.md", kind: "file", extension: "md", executable: false, mtimeMs: 0 };
const nested: FileTreeEntry = { name: "main.ts", relativePath: "src/main.ts", kind: "file", extension: "ts", executable: false, mtimeMs: 0 };

const listDirectory = vi.fn();
const absolutePath = vi.fn();
const reveal = vi.fn();
const openInEditor = vi.fn();
const create = vi.fn();
const rename = vi.fn();
const duplicate = vi.fn();
const trash = vi.fn();
const panelData = vi.fn();
const writeText = vi.fn();
const changedPaths = vi.fn();
const clearChanges = vi.fn();

const onOpenFile = vi.fn();
const onOpenFileExternal = vi.fn();
const onEntryDeleted = vi.fn();
const onEntryRenamed = vi.fn();

function renderExplorer(activeTarget = target) {
  return render(
    <FileExplorer
      hidden={false}
      target={activeTarget}
      targetLabel="Repo"
      selectedRelativePath={null}
      vscodeAvailable
      onOpenFile={onOpenFile}
      onOpenFileExternal={onOpenFileExternal}
      onEntryDeleted={onEntryDeleted}
      onEntryRenamed={onEntryRenamed}
    />,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const row = (name: string) => screen.findByRole("button", { name: new RegExp(name) });
const openMenu = async (name: string) => {
  fireEvent.contextMenu(await row(name), { clientX: 12, clientY: 20 });
  return screen.findByRole("menu");
};

afterEach(cleanup);

describe("FileExplorer context menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDirectory.mockImplementation(async (_target, relativePath: string) =>
      relativePath === "" ? [folder, file] : [nested],
    );
    absolutePath.mockResolvedValue("D:\\repo\\readme.md");
    reveal.mockResolvedValue(undefined);
    openInEditor.mockResolvedValue(undefined);
    create.mockResolvedValue("src/new.ts");
    rename.mockResolvedValue("guide.md");
    duplicate.mockResolvedValue("readme copy.md");
    trash.mockResolvedValue(undefined);
    panelData.mockResolvedValue({
      isRepo: true, currentBranch: "main", upstream: null, ahead: null, behind: null,
      branches: ["main"], changes: [], ignored: [],
    });
    writeText.mockResolvedValue(undefined);
    changedPaths.mockResolvedValue({ agentPaths: [], baselineMs: 0 });
    clearChanges.mockResolvedValue(undefined);
    Object.assign(window, {
      multiCliWork: {
        workspaceFiles: {
          listDirectory, absolutePath, reveal, openInEditor, create, rename, duplicate, trash,
          changedPaths, clearChanges,
        },
        git: { panelData },
        clipboard: { writeText },
      },
    });
  });

  it("copies the absolute path, the relative path and the name", async () => {
    renderExplorer();
    await openMenu("readme.md");

    fireEvent.click(screen.getByRole("menuitem", { name: "경로 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("D:\\repo\\readme.md"));
    expect(absolutePath).toHaveBeenCalledWith(target, "readme.md");

    await openMenu("readme.md");
    fireEvent.click(screen.getByRole("menuitem", { name: "상대 경로 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("readme.md"));

    await openMenu("readme.md");
    fireEvent.click(screen.getByRole("menuitem", { name: "파일 이름 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("readme.md"));
  });

  it("targets the root folder when the click lands on empty space", async () => {
    renderExplorer();
    await screen.findByText("readme.md");

    fireEvent.contextMenu(screen.getByRole("tree"), { clientX: 5, clientY: 5 });
    const menu = await screen.findByRole("menu", { name: "루트 폴더 작업" });
    expect(within(menu).getByRole("menuitem", { name: "새 파일" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "이름 변경" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "삭제" })).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "경로 복사" }));
    await waitFor(() => expect(absolutePath).toHaveBeenCalledWith(target, ""));
  });

  it("opens a folder before showing the new-file field and creates the entry", async () => {
    renderExplorer();
    await openMenu("src");
    fireEvent.click(screen.getByRole("menuitem", { name: "새 파일" }));

    // The folder was collapsed: the field only exists once its listing is on screen.
    await screen.findByText("main.ts");
    const field = screen.getByLabelText("파일 이름");
    fireEvent.change(field, { target: { value: "helper.ts" } });
    fireEvent.submit(field);

    await waitFor(() => expect(create).toHaveBeenCalledWith(target, "src", "helper.ts", "file"));
    // The parent listing is re-read so the new file appears without a full refresh.
    await waitFor(() => expect(listDirectory).toHaveBeenCalledWith(target, "src"));
  });

  it("abandons the inline field on Escape", async () => {
    renderExplorer();
    await openMenu("readme.md");
    fireEvent.click(screen.getByRole("menuitem", { name: "이름 변경" }));

    const field = await screen.findByLabelText("파일 이름");
    fireEvent.keyDown(field, { key: "Escape" });

    await waitFor(() => expect(screen.queryByLabelText("파일 이름")).not.toBeInTheDocument());
    expect(rename).not.toHaveBeenCalled();
  });

  it("renames a file and reports the new path so its tab can follow", async () => {
    renderExplorer();
    await openMenu("readme.md");
    fireEvent.click(screen.getByRole("menuitem", { name: "이름 변경" }));

    const field = await screen.findByLabelText("파일 이름");
    fireEvent.change(field, { target: { value: "guide.md" } });
    fireEvent.submit(field);

    await waitFor(() => expect(rename).toHaveBeenCalledWith(target, "readme.md", "guide.md"));
    await waitFor(() => expect(onEntryRenamed).toHaveBeenCalledWith("readme.md", "guide.md", "file"));
  });

  it("asks before trashing and reports the deletion", async () => {
    renderExplorer();
    await openMenu("readme.md");
    fireEvent.click(screen.getByRole("menuitem", { name: "삭제" }));

    const dialog = await screen.findByRole("dialog", { name: "휴지통으로 이동" });
    expect(trash).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "휴지통으로 이동" }));

    await waitFor(() => expect(trash).toHaveBeenCalledWith(target, "readme.md"));
    await waitFor(() => expect(onEntryDeleted).toHaveBeenCalledWith("readme.md", "file"));
  });

  it("counts what a folder holds and leaves it alone when the dialog is cancelled", async () => {
    renderExplorer();
    await openMenu("src");
    fireEvent.click(screen.getByRole("menuitem", { name: "삭제" }));

    const dialog = await screen.findByRole("dialog", { name: "휴지통으로 이동" });
    await waitFor(() => expect(within(dialog).getByText(/항목 1개/)).toBeInTheDocument());

    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trash).not.toHaveBeenCalled();
    expect(onEntryDeleted).not.toHaveBeenCalled();
  });

  it("shows what the main process refused", async () => {
    create.mockRejectedValue(new Error('"aux" is a name Windows reserves'));
    renderExplorer();
    await screen.findByText("readme.md");

    fireEvent.contextMenu(screen.getByRole("tree"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("menuitem", { name: "새 폴더" }));
    const field = await screen.findByLabelText("폴더 이름");
    fireEvent.change(field, { target: { value: "aux" } });
    fireEvent.submit(field);

    expect(await screen.findByRole("alert")).toHaveTextContent("Windows reserves");
  });

  it("reveals and opens the entry through the shell", async () => {
    renderExplorer();
    await openMenu("readme.md");
    fireEvent.click(screen.getByRole("menuitem", { name: "탐색기에서 표시" }));
    await waitFor(() => expect(reveal).toHaveBeenCalledWith(target, "readme.md"));

    await openMenu("readme.md");
    fireEvent.click(screen.getByRole("menuitem", { name: "VS Code로 열기" }));
    await waitFor(() => expect(openInEditor).toHaveBeenCalledWith(target, "readme.md"));

    await openMenu("readme.md");
    fireEvent.click(screen.getByRole("menuitem", { name: "복제" }));
    await waitFor(() => expect(duplicate).toHaveBeenCalledWith(target, "readme.md"));
  });

  it("opens a file with its OS-associated program from the context menu", async () => {
    renderExplorer();
    await openMenu("readme.md");
    fireEvent.click(screen.getByRole("menuitem", { name: "연결 프로그램으로 열기" }));
    expect(onOpenFileExternal).toHaveBeenCalledWith(file);

    // Folders don't offer this item — the shell-open path only ever targets a single file.
    await openMenu("src");
    expect(screen.queryByRole("menuitem", { name: "연결 프로그램으로 열기" })).not.toBeInTheDocument();
  });
});

describe("FileExplorer change highlighting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDirectory.mockImplementation(async (_target, relativePath: string) =>
      relativePath === "" ? [folder, file] : [nested],
    );
    panelData.mockResolvedValue({
      isRepo: true, currentBranch: "main", upstream: null, ahead: null, behind: null,
      branches: ["main"], changes: [], ignored: [],
    });
    clearChanges.mockResolvedValue(undefined);
    Object.assign(window, {
      multiCliWork: {
        workspaceFiles: {
          listDirectory, absolutePath, reveal, openInEditor, create, rename, duplicate, trash,
          changedPaths, clearChanges,
        },
        git: { panelData },
        clipboard: { writeText },
      },
    });
  });

  it("colors an agent-edited file and rolls the mark up to its folder, leaving other rows alone", async () => {
    changedPaths.mockResolvedValue({ agentPaths: [{ relativePath: "src/main.ts", kind: "file", at: 1 }], baselineMs: 0 });
    renderExplorer();

    fireEvent.click(await row("src"));
    const mainRow = await row("main.ts");
    await waitFor(() => expect(mainRow.className).toContain("change-agent"));
    expect((await row("src")).className).toContain("change-below-agent");
    expect((await row("readme.md")).className).not.toMatch(/change-/);
  });

  it("clears the highlight through the '변경 표시 지우기' button", async () => {
    changedPaths.mockResolvedValue({ agentPaths: [{ relativePath: "readme.md", kind: "file", at: 1 }], baselineMs: 0 });
    renderExplorer();

    const readmeRow = await row("readme.md");
    await waitFor(() => expect(readmeRow.className).toContain("change-agent"));

    changedPaths.mockResolvedValue({ agentPaths: [], baselineMs: Date.now() });
    fireEvent.click(screen.getByRole("button", { name: "변경 표시 지우기" }));

    await waitFor(() => expect(clearChanges).toHaveBeenCalledWith(target));
    await waitFor(() => expect(readmeRow.className).not.toMatch(/change-/));
  });

  it("re-pulls only changedPaths, never the directory listing, on an mcw:agent-edits notification", async () => {
    changedPaths.mockResolvedValue({ agentPaths: [], baselineMs: 0 });
    renderExplorer();
    await row("readme.md");
    listDirectory.mockClear();
    changedPaths.mockClear();

    changedPaths.mockResolvedValue({ agentPaths: [{ relativePath: "readme.md", kind: "file", at: 2 }], baselineMs: 0 });
    fireEvent(window, new Event("mcw:agent-edits"));

    await waitFor(() => expect(changedPaths).toHaveBeenCalledWith(target));
    expect(listDirectory).not.toHaveBeenCalled();
  });
});

describe("FileExplorer directory request ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDirectory.mockReset();
    panelData.mockResolvedValue({ isRepo: true, currentBranch: "main", upstream: null, ahead: null, behind: null, branches: ["main"], changes: [], ignored: [] });
    changedPaths.mockResolvedValue({ agentPaths: [], baselineMs: 0 });
    Object.assign(window, {
      multiCliWork: {
        workspaceFiles: { listDirectory, absolutePath, reveal, openInEditor, create, rename, duplicate, trash, changedPaths, clearChanges },
        git: { panelData }, clipboard: { writeText },
      },
    });
  });

  it("ignores a directory success from the previously selected target", async () => {
    const oldRead = deferred<FileTreeEntry[]>();
    const nextTarget = { kind: "project", id: "p2" } as const;
    listDirectory.mockImplementation((readTarget) => readTarget.id === target.id ? oldRead.promise : Promise.resolve([{ ...file, name: "new.md", relativePath: "new.md" }]));
    const view = renderExplorer();

    view.rerender(<FileExplorer hidden={false} target={nextTarget} targetLabel="Next" selectedRelativePath={null} vscodeAvailable onOpenFile={onOpenFile} onOpenFileExternal={onOpenFileExternal} onEntryDeleted={onEntryDeleted} onEntryRenamed={onEntryRenamed} />);
    await screen.findByText("new.md");
    await act(async () => oldRead.resolve([file]));

    expect(screen.queryByText("readme.md")).not.toBeInTheDocument();
  });

  it("does not revive an old target request after switching A to B and back to A", async () => {
    const oldA = deferred<FileTreeEntry[]>();
    const newA = deferred<FileTreeEntry[]>();
    const targetB = { kind: "project", id: "p2" } as const;
    let aReads = 0;
    listDirectory.mockImplementation((readTarget) => {
      if (readTarget.id === targetB.id) return Promise.resolve([{ ...file, name: "b.md", relativePath: "b.md" }]);
      aReads += 1;
      return aReads === 1 ? oldA.promise : newA.promise;
    });
    const props = { hidden: false, targetLabel: "Repo", selectedRelativePath: null, vscodeAvailable: true, onOpenFile, onOpenFileExternal, onEntryDeleted, onEntryRenamed };
    const view = render(<FileExplorer {...props} target={target} />);
    view.rerender(<FileExplorer {...props} target={targetB} />);
    await screen.findByText("b.md");
    view.rerender(<FileExplorer {...props} target={target} />);
    await act(async () => newA.resolve([{ ...file, name: "current.md", relativePath: "current.md" }]));
    await screen.findByText("current.md");

    await act(async () => oldA.resolve([file]));

    expect(screen.getByText("current.md")).toBeInTheDocument();
    expect(screen.queryByText("readme.md")).not.toBeInTheDocument();
  });

  it("ignores an older failure after a newer refresh succeeds for the same directory", async () => {
    const oldRead = deferred<FileTreeEntry[]>();
    listDirectory.mockReturnValueOnce(oldRead.promise).mockResolvedValue([file]);
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "파일 목록 새로고침" }));
    await screen.findByText("readme.md");

    await act(async () => oldRead.reject(new Error("stale failure")));

    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.queryByText("불러오지 못했습니다")).not.toBeInTheDocument();
  });
});
