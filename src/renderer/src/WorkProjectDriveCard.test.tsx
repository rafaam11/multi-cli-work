import type { MultiCliWorkApi } from "@shared/api-types";
import type { DriveProjectStatus } from "@shared/drive-types";
import { DEFAULT_FOLDER_TEMPLATES } from "@shared/folder-template";
import type { WorkProject } from "@shared/work-project-types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveRootContext, type DriveRootInfo } from "./drive-root-context";
import { WorkProjectDriveCard } from "./WorkProjectDriveCard";

afterEach(cleanup);

const WORK_PROJECT: WorkProject = {
  id: "wp-1",
  name: "R_DOTORI",
  category: "연구개발",
  status: null,
  memo: "",
  notionLinks: [],
  localFolders: [],
  members: [],
  order: 0,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};

const DRIVE = "G:\\내 드라이브";
const FOLDER = "G:\\내 드라이브\\R_DOTORI";

function status(patch: Partial<DriveProjectStatus>): DriveProjectStatus {
  return { root: DRIVE, folderPath: FOLDER, exists: true, subfolders: [], linkedProjectId: null, legacyDocs: [], ...patch };
}

function setup(first: DriveProjectStatus, after: DriveProjectStatus = first, drive: DriveRootInfo = { root: DRIVE, kind: "gdrive" }) {
  const memberResult = { project: { id: "p-docs" }, workProjects: {} };
  const relinked = { id: "p-teams", rootPath: FOLDER };
  const api = {
    status: vi.fn().mockResolvedValueOnce(first).mockResolvedValue(after),
    createFolder: vi.fn().mockResolvedValue(memberResult),
    link: vi.fn().mockResolvedValue(memberResult),
    migrateDocs: vi.fn().mockResolvedValue(relinked),
    reveal: vi.fn().mockResolvedValue(undefined),
  };
  window.multiCliWork = { drive: api } as unknown as MultiCliWorkApi;
  const props = {
    onMemberFolderAdded: vi.fn(),
    onProjectRelinked: vi.fn(),
    onOpenPcSettings: vi.fn(),
  };
  render(
    <DriveRootContext.Provider value={drive}>
      <WorkProjectDriveCard
        workProject={WORK_PROJECT}
        categories={[{ name: "연구개발", color: 3, code: "R", templateId: "minimal" }]}
        folderTemplates={DEFAULT_FOLDER_TEMPLATES}
        {...props}
      />
    </DriveRootContext.Provider>,
  );
  return { api, props, memberResult, relinked };
}

describe("WorkProjectDriveCard", () => {
  it("드라이브 루트가 없으면 PC 루트 설정으로 안내한다", async () => {
    const { props } = setup(status({ root: null, folderPath: null, exists: false }));
    fireEvent.click(await screen.findByRole("button", { name: "PC 루트 설정" }));
    expect(props.onOpenPcSettings).toHaveBeenCalledOnce();
  });

  it("제목과 안내는 사용자가 고른 문서 루트 종류의 이름을 쓴다", async () => {
    setup(status({ root: null, folderPath: null, exists: false }), undefined, { root: null, kind: "nas" });
    expect(screen.getByRole("region", { name: "문서 · NAS" })).toBeInTheDocument();
    expect(await screen.findByText(/이 PC의 NAS 폴더를 찾지 못했습니다/)).toBeInTheDocument();
  });

  it("폴더가 없으면 구분의 기본 템플릿에서 골라 만들고 문서 폴더로 등록한다", async () => {
    const { api, props, memberResult } = setup(status({ exists: false }), status({ linkedProjectId: "p-docs" }));
    const picker = await screen.findByLabelText("폴더 템플릿");
    expect(picker).toHaveValue("minimal");
    fireEvent.change(picker, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "드라이브 폴더 만들기" }));
    await waitFor(() => expect(api.createFolder).toHaveBeenCalledWith("wp-1", { templateId: null }));
    expect(props.onMemberFolderAdded).toHaveBeenCalledWith(memberResult);
    expect(await screen.findByText("연결됨")).toBeInTheDocument();
  });

  it("같은 이름 폴더가 있지만 연결 전이면 연결 버튼을 준다", async () => {
    const { api } = setup(status({}));
    expect(await screen.findByText("미연결")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "문서 폴더로 연결" }));
    await waitFor(() => expect(api.link).toHaveBeenCalledWith("wp-1"));
  });

  it("하위 폴더 칩은 그 폴더를 탐색기로 연다", async () => {
    const { api } = setup(
      status({ linkedProjectId: "p-docs", subfolders: [{ name: "2. 발표자료", path: `${FOLDER}\\2. 발표자료` }] }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "2. 발표자료" }));
    await waitFor(() => expect(api.reveal).toHaveBeenCalledWith("wp-1", "2. 발표자료"));
  });

  it("Teams 문서 폴더를 드라이브로 전환하고, 제안이 없으면 버튼 대신 사유를 보인다", async () => {
    const teams = "C:\\Users\\u\\노바테크\\수행프로젝트(기술연구소) - 문서\\R_DOTORI";
    const { api, props, relinked } = setup(
      status({
        legacyDocs: [
          { projectId: "p-teams", rootPath: teams, suggestedPath: FOLDER, exists: true },
          { projectId: "p-gone", rootPath: "C:\\gone", suggestedPath: null, exists: false },
        ],
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: `${teams} 드라이브로 전환` }));
    await waitFor(() => expect(api.migrateDocs).toHaveBeenCalledWith("wp-1", "p-teams"));
    expect(props.onProjectRelinked).toHaveBeenCalledWith(relinked);
    expect(screen.getByText("드라이브에 옮겨 갈 폴더가 없습니다")).toBeInTheDocument();
  });

  it("실패하면 이유를 보여 준다", async () => {
    const { api } = setup(status({ exists: false }));
    api.createFolder.mockRejectedValueOnce(new Error("드라이브 루트를 열 수 없습니다"));
    fireEvent.click(await screen.findByRole("button", { name: "드라이브 폴더 만들기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("드라이브 루트를 열 수 없습니다");
  });
});
