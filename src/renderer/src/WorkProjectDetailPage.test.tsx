import type { MultiCliWorkApi } from "@shared/api-types";
import type { WorkProject, WorkProjectRegistryV1 } from "@shared/work-project-types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkProjectDetailPage } from "./WorkProjectDetailPage";

afterEach(cleanup);

const WORK_PROJECT: WorkProject = {
  id: "wp-1",
  name: "스마트팩토리 과제",
  category: "정부지원과제",
  status: "진행중",
  memo: "",
  notionLinks: [],
  localFolders: [],
  members: [],
  order: 0,
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
};

function installApi(picked: string | null = null) {
  const registry: WorkProjectRegistryV1 = {
    schemaVersion: 1,
    updatedAt: WORK_PROJECT.updatedAt,
    teamsSyncRoot: null,
    workProjects: { [WORK_PROJECT.id]: WORK_PROJECT },
  };
  const update = vi.fn().mockResolvedValue(registry);
  const chooseLocalFolder = vi.fn().mockResolvedValue(picked);
  window.multiCliWork = { workProjects: { update, chooseLocalFolder } } as unknown as MultiCliWorkApi;
  return { update, chooseLocalFolder };
}

function renderPage(workProject: WorkProject = WORK_PROJECT) {
  const onRevealLocalFolder = vi.fn();
  render(
    <WorkProjectDetailPage
      workProject={workProject}
      members={[]}
      teamsSyncRoot={null}
      sessions={[]}
      agents={[]}
      onSelectSession={vi.fn()}
      onSelectProject={vi.fn()}
      onRegistryChanged={vi.fn()}
      onMemberFolderAdded={vi.fn()}
      onRemoveWorkProject={vi.fn()}
      onOpenNotion={vi.fn()}
      onRevealProject={vi.fn()}
      onRevealLocalFolder={onRevealLocalFolder}
    />,
  );
  return { onRevealLocalFolder };
}

describe("WorkProjectDetailPage 참고 로컬 폴더", () => {
  it("saves a hand-typed path when the row loses focus", async () => {
    const { update } = installApi();
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "폴더 추가" }));
    const pathInput = screen.getByRole("textbox", { name: "참고 폴더 1 경로" });
    fireEvent.change(pathInput, { target: { value: "D:\\Work\\참고자료" } });
    fireEvent.blur(pathInput);

    // The label is left to the service, which falls back to the folder's own name.
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("wp-1", { localFolders: [{ label: "", path: "D:\\Work\\참고자료" }] }),
    );
  });

  it("saves the dialog's path immediately, since the dialog steals the row's focus", async () => {
    const { update, chooseLocalFolder } = installApi("D:\\Work\\도면");
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "폴더 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "참고 폴더 1 선택" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("wp-1", { localFolders: [{ label: "", path: "D:\\Work\\도면" }] }),
    );
    expect(chooseLocalFolder).toHaveBeenCalledOnce();
  });

  it("reveals a stored folder and leaves the button dead until a path exists", async () => {
    installApi();
    const { onRevealLocalFolder } = renderPage({
      ...WORK_PROJECT,
      localFolders: [{ label: "설계도면", path: "D:\\Work\\도면" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "참고 폴더 1 열기" }));
    expect(onRevealLocalFolder).toHaveBeenCalledWith("D:\\Work\\도면");

    fireEvent.click(screen.getByRole("button", { name: "폴더 추가" }));
    expect(screen.getByRole("button", { name: "참고 폴더 2 열기" })).toBeDisabled();
  });

  it("drops a row and stores the shortened list", async () => {
    const { update } = installApi();
    renderPage({
      ...WORK_PROJECT,
      localFolders: [
        { label: "설계도면", path: "D:\\Work\\도면" },
        { label: "산출물", path: "D:\\Work\\산출물" },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "참고 폴더 1 삭제" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("wp-1", { localFolders: [{ label: "산출물", path: "D:\\Work\\산출물" }] }),
    );
  });
});
