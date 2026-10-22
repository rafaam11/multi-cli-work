import type { MultiCliWorkApi } from "@shared/api-types";
import type { DriveOverview } from "@shared/drive-types";
import { DEFAULT_FOLDER_TEMPLATES } from "@shared/folder-template";
import type { WorkProjectRegistryV1 } from "@shared/work-project-types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkProjectCreateDialog } from "./WorkProjectCreateDialog";

afterEach(cleanup);

const CATEGORIES = [
  { name: "정부과제", color: 1, code: "G", templateId: "project" },
  { name: "연구개발", color: 3, code: "R", templateId: "minimal" },
  { name: "개인", color: 4, code: "S" },
  { name: "기타", color: 6, code: "Z" },
];

function registry(ids: string[]): WorkProjectRegistryV1 {
  return {
    schemaVersion: 1,
    updatedAt: "2026-10-15T00:00:00.000Z",
    teamsSyncRoot: null,
    workProjects: Object.fromEntries(ids.map((id) => [id, { id } as never])),
  };
}

function setup(overview: DriveOverview) {
  const before = registry(["old"]);
  const after = registry(["old", "new"]);
  const api = {
    workProjects: { list: vi.fn().mockResolvedValue(before), create: vi.fn().mockResolvedValue(after) },
    drive: {
      overview: vi.fn().mockResolvedValue(overview),
      createFolder: vi.fn().mockResolvedValue({ project: { id: "p" }, workProjects: after }),
      importFolders: vi.fn().mockResolvedValue(after),
    },
  };
  window.multiCliWork = api as unknown as MultiCliWorkApi;
  const onDone = vi.fn();
  render(
    <WorkProjectCreateDialog
      categories={CATEGORIES}
      defaultCategory="기타"
      folderTemplates={DEFAULT_FOLDER_TEMPLATES}
      onDone={onDone}
      onClose={vi.fn()}
    />,
  );
  return { api, onDone, after };
}

const DRIVE: DriveOverview = {
  root: "G:\\내 드라이브",
  available: true,
  folders: [
    { name: "R_DOTORI", code: "R", category: "연구개발", workProjectId: "wp-dotori" },
    { name: "G_전략연구과제", code: "G", category: "정부과제", workProjectId: null },
    { name: "S_커리어", code: "S", category: "개인", workProjectId: null },
  ],
};

describe("WorkProjectCreateDialog", () => {
  it("구분 코드를 접두어로 붙여 만들고 드라이브 폴더도 템플릿으로 만든다", async () => {
    const { api, onDone, after } = setup(DRIVE);
    fireEvent.change(screen.getByLabelText("구분"), { target: { value: "연구개발" } });
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "바이브코딩" } });
    expect(screen.getByText("프로젝트 이름: R_바이브코딩")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Google Drive에 폴더 만들기/ })).toBeEnabled());
    // 구분의 기본 템플릿에서 시작한다.
    expect(screen.getByLabelText("폴더 템플릿")).toHaveValue("minimal");
    expect(screen.getByText("01_문서 · 02_미디어 · 03_데이터 · tmp · CLAUDE.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(after, "new"));
    expect(api.workProjects.create).toHaveBeenCalledWith({ name: "R_바이브코딩", category: "연구개발" });
    expect(api.drive.createFolder).toHaveBeenCalledWith("new", { templateId: "minimal" });
  });

  it("구분을 바꾸면 템플릿도 그 구분의 기본값으로 바뀌고, 직접 고를 수도 있다", async () => {
    const { api, onDone } = setup(DRIVE);
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "G_새과제" } });
    expect(await screen.findByLabelText("폴더 템플릿")).toHaveValue("project");
    fireEvent.change(screen.getByLabelText("구분"), { target: { value: "개인" } });
    expect(screen.getByLabelText("폴더 템플릿")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("폴더 템플릿"), { target: { value: "minimal" } });

    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.drive.createFolder).toHaveBeenCalledWith("new", { templateId: "minimal" });
  });

  it("접두어까지 쳐 넣으면 그 코드의 구분으로 맞춘다", () => {
    setup(DRIVE);
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "G_새과제" } });
    expect(screen.getByLabelText("구분")).toHaveValue("정부과제");
    expect(screen.getByText("프로젝트 이름: G_새과제")).toBeInTheDocument();
  });

  it("드라이브가 없으면 폴더 없이 만든다", async () => {
    const { api, onDone } = setup({ root: null, available: false, folders: [] });
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "메모" } });
    expect(await screen.findByText(/드라이브 폴더를 찾지 못함/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.workProjects.create).toHaveBeenCalledWith({ name: "Z_메모", category: "기타" });
    expect(api.drive.createFolder).not.toHaveBeenCalled();
  });

  it("업무 프로젝트가 없는 드라이브 폴더만 골라 가져온다", async () => {
    const { api, onDone, after } = setup(DRIVE);
    fireEvent.click(await screen.findByRole("tab", { name: "드라이브에서 가져오기 (2)" }));
    expect(screen.queryByText("R_DOTORI")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /S_커리어/ }));
    fireEvent.click(screen.getByRole("button", { name: "1개 가져오기" }));
    await waitFor(() => expect(api.drive.importFolders).toHaveBeenCalledWith(["G_전략연구과제"]));
    expect(onDone).toHaveBeenCalledWith(after, null);
  });
});
