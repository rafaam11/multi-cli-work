import type { AgentView } from "@shared/agent-types";
import type { GitStatusResult, MultiCliWorkApi } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree } from "@shared/worktree-types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderStartPage } from "./FolderStartPage";

afterEach(cleanup);

function agentFixture(id: string, label: string, available: boolean): AgentView {
  return {
    id,
    label,
    commands: [id],
    args: [],
    newSessionArgs: [],
    resumeArgs: [],
    conversationId: "none",
    statusAdapter: "signals",
    titleSource: "none",
    shiftEnter: "enter",
    icon: id,
    accentColor: null,
    builtin: true,
    available,
  };
}

const agents: AgentView[] = [
  agentFixture("claude", "Claude Code", true),
  agentFixture("codex", "Codex", false),
];

const atlas: SharedProject = {
  id: "project-atlas",
  rootPath: "C:\\work\\atlas",
  displayName: "Atlas",
  sources: ["manual"],
  providerRefs: { claude: [], codex: [] },
  status: null,
  memo: "",
  tracks: [],
  hidden: false,
  order: 0,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

const featureWorktree: SharedWorktree = {
  id: "worktree-feature",
  projectId: atlas.id,
  path: "C:\\work\\atlas-wt\\feature",
  branch: "feature/login",
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
};

function installApi(options?: { project?: GitStatusResult | Error; worktree?: GitStatusResult }) {
  const projectGitStatus = vi.fn().mockImplementation(() => {
    const result = options?.project ?? { isRepo: true, branch: "main", changedFileCount: 3 };
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  const worktreeGitStatus = vi
    .fn()
    .mockResolvedValue(options?.worktree ?? { isRepo: true, branch: "feature/login", changedFileCount: 0 });
  window.multiCliWork = {
    projects: { gitStatus: projectGitStatus },
    worktrees: { gitStatus: worktreeGitStatus },
  } as unknown as MultiCliWorkApi;
  return { projectGitStatus, worktreeGitStatus };
}

function baseProps() {
  return {
    project: atlas,
    worktree: null as SharedWorktree | null,
    worktrees: [] as SharedWorktree[],
    agents,
    vscodeAvailable: true,
    pendingAction: false,
    projectMissing: false,
    layoutLabel: "전체",
    onStartSession: vi.fn(),
    onSelectWorktree: vi.fn(),
    onCreateWorktree: vi.fn(),
    onOpenDetail: vi.fn(),
    onReveal: vi.fn(),
    onOpenInEditor: vi.fn(),
    onOpenOnGitHub: vi.fn(),
  };
}

function renderPage(overrides: Partial<ReturnType<typeof baseProps>> = {}) {
  const props = { ...baseProps(), ...overrides };
  return { ...render(<FolderStartPage {...props} />), props };
}

describe("FolderStartPage", () => {
  it("launches the agent whose card was pressed, and refuses the ones not on PATH", async () => {
    installApi();
    const { props } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Claude Code 세션 시작" }));
    expect(props.onStartSession).toHaveBeenCalledWith("claude");

    const codex = screen.getByRole("button", { name: "Codex 세션 시작" });
    expect(codex).toBeDisabled();
    expect(codex.getAttribute("title")).toBe("Codex 미설치");
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());
  });

  /** A missing root cannot host a session, so the page says why rather than failing on the click. */
  it("blocks every launcher while the folder's root is missing", async () => {
    installApi();
    renderPage({ projectMissing: true });

    expect(screen.getByRole("button", { name: "Claude Code 세션 시작" })).toBeDisabled();
    expect(screen.getByText(/폴더를 찾을 수 없습니다/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());
  });

  /** Choosing a layout with no grid on screen has no visible effect — the caption is the effect. */
  it("says which arrangement the first session will open into", async () => {
    installApi();
    renderPage({ layoutLabel: "2×2" });
    expect(screen.getByText("첫 세션은 2×2 배치로 열립니다")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());
  });

  it("reads the project's git state, branch and change count both", async () => {
    const { projectGitStatus, worktreeGitStatus } = installApi();
    renderPage();

    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());
    expect(screen.getByText("변경 3개")).toBeTruthy();
    expect(projectGitStatus).toHaveBeenCalledWith(atlas.id);
    expect(worktreeGitStatus).not.toHaveBeenCalled();
  });

  /** A worktree has its own HEAD; reading the project's would name the wrong branch. */
  it("reads the worktree's git state when the surface is a worktree", async () => {
    const { projectGitStatus, worktreeGitStatus } = installApi();
    renderPage({ worktree: featureWorktree, worktrees: [featureWorktree] });

    await waitFor(() => expect(screen.getByText("feature/login")).toBeTruthy());
    expect(worktreeGitStatus).toHaveBeenCalledWith(featureWorktree.id);
    expect(projectGitStatus).not.toHaveBeenCalled();
    expect(screen.getByText("Atlas · feature/login에서 시작")).toBeTruthy();
  });

  it("says so when the folder is not a repository", async () => {
    installApi({ project: { isRepo: false, branch: null, changedFileCount: 0 } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Git 저장소가 아닙니다")).toBeTruthy());
  });

  it("survives a git read that fails", async () => {
    installApi({ project: new Error("git missing") });
    renderPage();
    await waitFor(() => expect(screen.getByText("Git 상태를 읽을 수 없습니다")).toBeTruthy());
  });

  it("moves to a sibling worktree, and marks the one already on screen", async () => {
    installApi();
    const other: SharedWorktree = { ...featureWorktree, id: "worktree-spike", branch: "spike/cache" };
    const { props } = renderPage({ worktree: featureWorktree, worktrees: [featureWorktree, other] });

    expect(screen.getByRole("button", { name: "feature/login (보는 중)" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "spike/cache 워크트리 열기" }));
    expect(props.onSelectWorktree).toHaveBeenCalledWith(other);
    await waitFor(() => expect(screen.getByText("변경 없음")).toBeTruthy());
  });

  it("offers to create the first worktree when there are none", async () => {
    installApi();
    const { props } = renderPage();

    expect(screen.getByText("아직 워크트리가 없습니다")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "워크트리 만들기" }));
    expect(props.onCreateWorktree).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());
  });

  it("wires every shortcut, and greys out VS Code when it is not on PATH", async () => {
    installApi();
    const { props } = renderPage({ vscodeAvailable: false });

    fireEvent.click(screen.getByRole("button", { name: "폴더 상세" }));
    fireEvent.click(screen.getByRole("button", { name: "파일 탐색기에서 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "GitHub에서 열기" }));
    expect(props.onOpenDetail).toHaveBeenCalled();
    expect(props.onReveal).toHaveBeenCalled();
    expect(props.onOpenOnGitHub).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "VS Code에서 열기" })).toBeDisabled();
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());
  });
});
