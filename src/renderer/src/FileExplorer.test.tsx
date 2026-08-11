import type { FileTreeEntry } from "@shared/file-explorer-types";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileExplorer } from "./FileExplorer";

const target = { kind: "project", id: "p1" } as const;

const folder: FileTreeEntry = { name: "src", relativePath: "src", kind: "directory", extension: null, executable: false };
const file: FileTreeEntry = { name: "readme.md", relativePath: "readme.md", kind: "file", extension: "md", executable: false };
const nested: FileTreeEntry = { name: "main.ts", relativePath: "src/main.ts", kind: "file", extension: "ts", executable: false };

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

const onOpenFile = vi.fn();
const onEntryDeleted = vi.fn();
const onEntryRenamed = vi.fn();

function renderExplorer() {
  return render(
    <FileExplorer
      hidden={false}
      target={target}
      targetLabel="Repo"
      selectedRelativePath={null}
      vscodeAvailable
      onOpenFile={onOpenFile}
      onEntryDeleted={onEntryDeleted}
      onEntryRenamed={onEntryRenamed}
    />,
  );
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
    Object.assign(window, {
      multiCliWork: {
        workspaceFiles: { listDirectory, absolutePath, reveal, openInEditor, create, rename, duplicate, trash },
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
});
