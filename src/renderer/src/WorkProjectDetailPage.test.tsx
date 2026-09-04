import type { MultiCliWorkApi } from "@shared/api-types";
import { notionLinkCheck, type NotionLinkCheck } from "@shared/notion-types";
import type { ProjectTagsV1 } from "@shared/project-tags-types";
import { DEFAULT_PROJECT_CATEGORIES, type ProjectCategorySetting } from "@shared/settings-types";
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

const NOTION_PROJECT: WorkProject = {
  ...WORK_PROJECT,
  notionLinks: [{ label: "노션", url: "https://notion.so/a" }],
};

function installApi(
  picked: string | null = null,
  notionOptions: { configured?: boolean; check?: NotionLinkCheck } = {},
) {
  const registry: WorkProjectRegistryV1 = {
    schemaVersion: 1,
    updatedAt: WORK_PROJECT.updatedAt,
    teamsSyncRoot: null,
    workProjects: { [WORK_PROJECT.id]: WORK_PROJECT },
  };
  const update = vi.fn().mockResolvedValue(registry);
  const chooseLocalFolder = vi.fn().mockResolvedValue(picked);
  const status = vi
    .fn()
    .mockResolvedValue({ configured: notionOptions.configured ?? false, encryptionAvailable: true });
  const inspectLink = vi.fn().mockResolvedValue(notionOptions.check ?? notionLinkCheck("ok", "삼성서울병원 채널"));
  const tagRegistry: ProjectTagsV1 = {
    schemaVersion: 1,
    updatedAt: WORK_PROJECT.updatedAt,
    tags: { [WORK_PROJECT.id]: ["개인"] },
  };
  const setTags = vi.fn().mockResolvedValue(tagRegistry);
  window.multiCliWork = {
    workProjects: { update, chooseLocalFolder },
    notion: { status, setToken: vi.fn(), clearToken: vi.fn(), inspectLink },
    projectTags: { list: vi.fn().mockResolvedValue(tagRegistry), set: setTags },
  } as unknown as MultiCliWorkApi;
  return { update, chooseLocalFolder, status, inspectLink, setTags, tagRegistry };
}

function renderPage(
  workProject: WorkProject = WORK_PROJECT,
  tagProps: { tags?: string[]; tagSuggestions?: string[]; categories?: ProjectCategorySetting[] } = {},
) {
  const onRevealLocalFolder = vi.fn();
  const onTagsChanged = vi.fn();
  render(
    <WorkProjectDetailPage
      workProject={workProject}
      members={[]}
      teamsSyncRoot={null}
      sessions={[]}
      agents={[]}
      tags={tagProps.tags ?? []}
      tagSuggestions={tagProps.tagSuggestions ?? []}
      categories={tagProps.categories ?? DEFAULT_PROJECT_CATEGORIES}
      onSelectSession={vi.fn()}
      onSelectProject={vi.fn()}
      onRegistryChanged={vi.fn()}
      onMemberFolderAdded={vi.fn()}
      onRemoveWorkProject={vi.fn()}
      onOpenNotion={vi.fn()}
      onRevealProject={vi.fn()}
      onRevealLocalFolder={onRevealLocalFolder}
      onTagsChanged={onTagsChanged}
    />,
  );
  return { onRevealLocalFolder, onTagsChanged };
}

describe("WorkProjectDetailPage 구분", () => {
  it("keeps a 구분 the settings list no longer has as the current value, in grey", () => {
    installApi();
    renderPage();
    const select = screen.getByLabelText("구분") as HTMLSelectElement;
    expect(select.value).toBe("정부지원과제");
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "정부지원과제",
      "업무",
      "개인",
      "연구",
      "기타",
    ]);
    expect(screen.getByRole("region", { name: "업무 프로젝트 상세" })).toHaveClass("category-etc");
  });

  it("takes the colour off the list the moment a listed 구분 is picked", () => {
    installApi();
    renderPage();
    fireEvent.change(screen.getByLabelText("구분"), { target: { value: "연구" } });
    expect(screen.getByRole("region", { name: "업무 프로젝트 상세" })).toHaveClass("accent-3");
  });
});

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

  it("saves a renamed folder label the IME commits after the row lost focus", async () => {
    const { update } = installApi();
    renderPage({ ...WORK_PROJECT, localFolders: [{ label: "도면", path: "D:\\Work\\도면" }] });

    const labelInput = screen.getByRole("textbox", { name: "참고 폴더 1 라벨" });
    fireEvent.compositionStart(labelInput);
    fireEvent.blur(labelInput);
    fireEvent.change(labelInput, { target: { value: "설계도면" } });
    fireEvent.compositionEnd(labelInput, { data: "설계도면" });

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("wp-1", { localFolders: [{ label: "설계도면", path: "D:\\Work\\도면" }] }),
    );
  });
});

describe("WorkProjectDetailPage 노션 링크", () => {
  const renamed = [{ label: "삼성서울병원_채널", url: "https://notion.so/a" }];

  it("saves a renamed label when the row loses focus", async () => {
    const { update } = installApi();
    renderPage(NOTION_PROJECT);

    const labelInput = screen.getByRole("textbox", { name: "노션 링크 1 라벨" });
    fireEvent.change(labelInput, { target: { value: "삼성서울병원_채널" } });
    fireEvent.blur(labelInput);

    await waitFor(() => expect(update).toHaveBeenCalledWith("wp-1", { notionLinks: renamed }));
  });

  // 한글 IME는 조합 중 포커스가 빠지면 확정 입력을 blur 뒤에 흘려보낸다. blur 시점의 값으로
  // 변경 여부를 판단하면 마지막 입력이 통째로 사라진다 — 라벨이 "노션"으로 되돌아가던 버그.
  it("saves a label the IME commits after the row already lost focus", async () => {
    const { update } = installApi();
    renderPage(NOTION_PROJECT);

    const labelInput = screen.getByRole("textbox", { name: "노션 링크 1 라벨" });
    fireEvent.compositionStart(labelInput);
    fireEvent.blur(labelInput);
    fireEvent.change(labelInput, { target: { value: "삼성서울병원_채널" } });
    fireEvent.compositionEnd(labelInput, { data: "삼성서울병원_채널" });

    await waitFor(() => expect(update).toHaveBeenCalledWith("wp-1", { notionLinks: renamed }));
  });

  // 사이드바에서 다른 항목을 누르면 이 페이지는 blur 없이 통째로 교체될 수 있다.
  it("saves a pending label edit when the page is replaced without a blur", async () => {
    const { update } = installApi();
    renderPage(NOTION_PROJECT);

    fireEvent.change(screen.getByRole("textbox", { name: "노션 링크 1 라벨" }), {
      target: { value: "smc-channel" },
    });
    cleanup();

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("wp-1", {
        notionLinks: [{ label: "smc-channel", url: "https://notion.so/a" }],
      }),
    );
  });

  it("leaves a draft row without a URL unsaved", async () => {
    const { update } = installApi();
    renderPage(NOTION_PROJECT);

    fireEvent.click(screen.getByRole("button", { name: "링크 추가" }));
    const labelInput = screen.getByRole("textbox", { name: "노션 링크 2 라벨" });
    fireEvent.change(labelInput, { target: { value: "2차년도" } });
    fireEvent.blur(labelInput);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(update).not.toHaveBeenCalled();
  });

  it("drops a row and stores the shortened list", async () => {
    const { update } = installApi();
    renderPage({
      ...WORK_PROJECT,
      notionLinks: [
        { label: "채널", url: "https://notion.so/a" },
        { label: "프로젝트", url: "https://notion.so/b" },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "노션 링크 1 삭제" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("wp-1", { notionLinks: [{ label: "프로젝트", url: "https://notion.so/b" }] }),
    );
  });
});

// 조회 결과는 모듈 스코프 캐시에 남으므로 테스트마다 URL을 달리 쓴다.
describe("WorkProjectDetailPage 노션 링크 검증", () => {
  it("진입하면 통합이 읽을 수 있는 링크에 체크 표시가 붙는다", async () => {
    const { inspectLink } = installApi(null, { configured: true });
    renderPage({ ...WORK_PROJECT, notionLinks: [{ label: "채널", url: "https://notion.so/check-ok" }] });

    expect(await screen.findByLabelText("노션 링크 1 접근 가능", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(inspectLink).toHaveBeenCalledWith("https://notion.so/check-ok");
  });

  it("기본 라벨은 조회한 제목으로 채우고 그대로 저장한다", async () => {
    const { update } = installApi(null, { configured: true });
    renderPage({ ...WORK_PROJECT, notionLinks: [{ label: "노션", url: "https://notion.so/check-fill" }] });

    await waitFor(
      () =>
        expect(update).toHaveBeenCalledWith("wp-1", {
          notionLinks: [{ label: "삼성서울병원 채널", url: "https://notion.so/check-fill" }],
        }),
      { timeout: 3000 },
    );
  });

  it("사람이 지은 라벨은 자동 조회가 건드리지 않는다", async () => {
    const { update, inspectLink } = installApi(null, { configured: true });
    renderPage({ ...WORK_PROJECT, notionLinks: [{ label: "채널", url: "https://notion.so/check-keep" }] });

    await waitFor(() => expect(inspectLink).toHaveBeenCalled(), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "노션 링크 1 라벨" })).toHaveValue("채널");
  });

  it("조회 버튼은 사람이 지은 라벨도 덮어쓴다", async () => {
    const { update } = installApi(null, { configured: true });
    renderPage({ ...WORK_PROJECT, notionLinks: [{ label: "채널", url: "https://notion.so/check-force" }] });

    const button = screen.getByRole("button", { name: "노션 링크 1 제목 조회" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("wp-1", {
        notionLinks: [{ label: "삼성서울병원 채널", url: "https://notion.so/check-force" }],
      }),
    );
  });

  it("통합에 연결되지 않은 링크는 경고와 사유를 보여주고 라벨은 그대로 둔다", async () => {
    installApi(null, { configured: true, check: notionLinkCheck("not-shared") });
    renderPage({ ...WORK_PROJECT, notionLinks: [{ label: "노션", url: "https://notion.so/check-closed" }] });

    expect(await screen.findByLabelText(/접근 불가/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("통합에 연결되어 있지 않습니다");
    expect(screen.getByRole("textbox", { name: "노션 링크 1 라벨" })).toHaveValue("노션");
  });

  it("토큰이 없으면 조회 버튼이 죽어 있고 자동 조회도 하지 않는다", async () => {
    const { inspectLink, status } = installApi(null, { configured: false });
    renderPage({ ...WORK_PROJECT, notionLinks: [{ label: "노션", url: "https://notion.so/check-no-token" }] });

    await waitFor(() => expect(status).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(inspectLink).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "노션 링크 1 제목 조회" })).toBeDisabled();
  });
});

describe("WorkProjectDetailPage 태그", () => {
  it("칩을 추가하면 곧바로 저장하고 새 레지스트리를 올려보낸다", async () => {
    const { setTags, tagRegistry } = installApi();
    const { onTagsChanged } = renderPage();

    const input = screen.getByLabelText("태그 추가");
    fireEvent.change(input, { target: { value: "개인" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(setTags).toHaveBeenCalledWith("wp-1", ["개인"]));
    await waitFor(() => expect(onTagsChanged).toHaveBeenCalledWith(tagRegistry));
  });
});
