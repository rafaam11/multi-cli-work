import type { AgentView } from "@shared/agent-types";
import type { GitStatusResult, MultiCliWorkApi, TerminalSessionView } from "@shared/api-types";
import type { ActivePullRequestReview } from "@shared/github-types";
import type { SharedProject } from "@shared/project-types";
import type { GitWorkspaceView, SharedWorktree } from "@shared/worktree-types";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectDetailPage } from "./ProjectDetailPage";

afterEach(cleanup);

/** The three built-ins, with Codex missing from PATH — the same shape the old availability map had. */
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
  agentFixture("powershell", "PowerShell", true),
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
  memo: "existing notes",
  tracks: [{ id: "track-1", title: "Launch", items: [{ id: "item-1", text: "Write tests", done: false }] }],
  hidden: false,
  order: 0,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

function makeSession(overrides: Partial<TerminalSessionView>): TerminalSessionView {
  return {
    id: "session",
    projectId: atlas.id,
    tool: null,
    title: null,
    name: null,
    kind: "powershell",
    cwd: atlas.rootPath,
    providerConversationId: null,
    interruptedByShutdown: false,
    status: "idle",
    pid: 100,
    exitCode: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function installApi(options?: { gitStatus?: GitStatusResult; update?: ReturnType<typeof vi.fn> }) {
  const gitStatus = vi.fn().mockResolvedValue(options?.gitStatus ?? { isRepo: true, branch: "main", changedFileCount: 0 });
  const update = options?.update ?? vi.fn().mockImplementation(async (id: string, patch) => ({ ...atlas, ...patch }));
  const api = {
    projects: { gitStatus, update },
    // Worktree-scoped renders read git state through the worktree channel instead.
    worktrees: { gitStatus },
  } as unknown as MultiCliWorkApi;
  window.multiCliWork = api;
  return { gitStatus, update };
}

function baseProps() {
  return {
    project: atlas,
    worktree: null,
    sessions: [] as TerminalSessionView[],
    agents,
    vscodeAvailable: true,
    pendingAction: false,
    onSelectSession: vi.fn(),
    onStartSession: vi.fn(),
    onReveal: vi.fn(),
    onOpenInEditor: vi.fn(),
    onOpenOnGitHub: vi.fn(),
    onFanOut: vi.fn(),
    onShowDiff: vi.fn(),
    onProjectSaved: vi.fn(),
    worktrees: [] as SharedWorktree[],
    workspaceViews: [] as GitWorkspaceView[],
    activeReviews: [] as ActivePullRequestReview[],
    worktreeSessionCounts: {} as Record<string, number>,
    worktreeWarning: null as string | null,
    projectMissing: false,
    onSelectWorktree: vi.fn(),
    onCreateWorktree: vi.fn(),
    onWorktreeContextMenu: vi.fn(),
  };
}

describe("ProjectDetailPage", () => {
  it("shows a start-session prompt with the launcher buttons when there are no sessions", () => {
    installApi();
    const onStartSession = vi.fn();
    render(<ProjectDetailPage {...baseProps()} onStartSession={onStartSession} />);

    expect(screen.getByText("Atlas에서 세션 시작")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PowerShell 세션 시작" }));
    expect(onStartSession).toHaveBeenCalledWith("powershell");
  });

  it("lists existing sessions as cards and opens the clicked one", () => {
    installApi();
    const session = makeSession({ id: "s-1", name: "My session" });
    const onSelectSession = vi.fn();
    render(<ProjectDetailPage {...baseProps()} sessions={[session]} onSelectSession={onSelectSession} />);

    fireEvent.click(screen.getByRole("button", { name: "My session 세션 보기" }));
    expect(onSelectSession).toHaveBeenCalledWith(session);
  });

  it("routes quick actions to the provided handlers", () => {
    installApi();
    const onReveal = vi.fn();
    const onOpenInEditor = vi.fn();
    const onOpenOnGitHub = vi.fn();
    render(<ProjectDetailPage {...baseProps()} onReveal={onReveal} onOpenInEditor={onOpenInEditor} onOpenOnGitHub={onOpenOnGitHub} />);

    fireEvent.click(screen.getByRole("button", { name: "파일 탐색기에서 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "VS Code에서 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "GitHub에서 열기" }));

    expect(onReveal).toHaveBeenCalledOnce();
    expect(onOpenInEditor).toHaveBeenCalledOnce();
    expect(onOpenOnGitHub).toHaveBeenCalledOnce();
  });

  it("loads git status on mount and reflects a clean repository", async () => {
    const { gitStatus } = installApi({ gitStatus: { isRepo: true, branch: "main", changedFileCount: 0 } });
    render(<ProjectDetailPage {...baseProps()} />);

    await waitFor(() => expect(gitStatus).toHaveBeenCalledWith(atlas.id));
    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(screen.getByText("변경 없음")).toBeInTheDocument();
  });

  it("shows a quiet message for a folder that is not a git repository", async () => {
    installApi({ gitStatus: { isRepo: false, branch: null, changedFileCount: 0 } });
    render(<ProjectDetailPage {...baseProps()} />);

    expect(await screen.findByText("Git 저장소가 아닙니다")).toBeInTheDocument();
  });

  it("re-fetches git status when Refresh is clicked", async () => {
    const { gitStatus } = installApi();
    render(<ProjectDetailPage {...baseProps()} />);
    await waitFor(() => expect(gitStatus).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Git 상태 새로고침" }));
    await waitFor(() => expect(gitStatus).toHaveBeenCalledTimes(2));
  });

  it("saves the memo when the field loses focus after a change", async () => {
    const update = vi.fn().mockResolvedValue({ ...atlas, memo: "updated notes" });
    const { update: updateSpy } = installApi({ update });
    const onProjectSaved = vi.fn();
    render(<ProjectDetailPage {...baseProps()} onProjectSaved={onProjectSaved} />);

    const memoField = screen.getByLabelText("메모 내용");
    fireEvent.change(memoField, { target: { value: "updated notes" } });
    fireEvent.blur(memoField);

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(atlas.id, { memo: "updated notes" }));
    expect(onProjectSaved).toHaveBeenCalledWith({ ...atlas, memo: "updated notes" });
  });

  it("does not save the memo on blur when it has not changed", () => {
    const { update } = installApi();
    render(<ProjectDetailPage {...baseProps()} />);

    const memoField = screen.getByLabelText("메모 내용");
    fireEvent.blur(memoField);
    expect(update).not.toHaveBeenCalled();
  });

  it("toggles a checklist item and persists the whole tracks array", async () => {
    const { update } = installApi();
    render(<ProjectDetailPage {...baseProps()} />);

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(atlas.id, {
        tracks: [{ id: "track-1", title: "Launch", items: [{ id: "item-1", text: "Write tests", done: true }] }],
      }),
    );
  });

  it("adds a new checklist via the inline form", async () => {
    const { update } = installApi();
    render(<ProjectDetailPage {...baseProps()} />);

    fireEvent.change(screen.getByLabelText("새 체크리스트 제목"), { target: { value: "Release" } });
    fireEvent.click(screen.getByRole("button", { name: "체크리스트 추가" }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const [, patch] = update.mock.calls[0] as [string, { tracks: Array<{ title: string }> }];
    expect(patch.tracks.map((track) => track.title)).toEqual(["Launch", "Release"]);
  });

  it("surfaces a save error without losing the in-progress edit", async () => {
    const update = vi.fn().mockRejectedValue(new Error("registry is read-only"));
    installApi({ update });
    render(<ProjectDetailPage {...baseProps()} />);

    const memoField = screen.getByLabelText("메모 내용");
    fireEvent.change(memoField, { target: { value: "will fail" } });
    fireEvent.blur(memoField);

    expect(await screen.findByRole("alert")).toHaveTextContent("registry is read-only");
    expect(memoField).toHaveValue("will fail");
  });
});

const featureWorktree: SharedWorktree = {
  id: "worktree-1",
  projectId: atlas.id,
  path: "C:\\work\\atlas-wt\\feature-x",
  branch: "feature-x",
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
};

const featureView: GitWorkspaceView = {
  workspaceKey: "worktree:worktree-1",
  kind: "worktree",
  projectId: atlas.id,
  worktreeId: featureWorktree.id,
  path: featureWorktree.path,
  branch: "feature-x",
  head: "abc1234",
  changedFileCount: 2,
  availability: "available",
  lockedReason: null,
  prunableReason: null,
};

function makeReview(overrides: Partial<ActivePullRequestReview>): ActivePullRequestReview {
  return {
    id: "review-1",
    projectId: atlas.id,
    remoteName: "origin",
    pullRequestNumber: 42,
    headSha: "abc1234",
    worktreeId: featureWorktree.id,
    sessionId: "session-review",
    agent: "claude",
    promptDelivered: true,
    startedAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("워크트리 카드", () => {
  it("워크트리를 브랜치·변경 수·세션 수와 함께 세우고, 열기가 onSelectWorktree를 부른다", () => {
    installApi();
    const onSelectWorktree = vi.fn();
    render(
      <ProjectDetailPage
        {...baseProps()}
        worktrees={[featureWorktree]}
        workspaceViews={[featureView]}
        worktreeSessionCounts={{ [featureWorktree.id]: 1 }}
        onSelectWorktree={onSelectWorktree}
      />,
    );

    const card = screen.getByRole("region", { name: "워크트리" });
    const row = within(card).getByRole("button", { name: "feature-x 워크트리 열기" });
    expect(row).toHaveTextContent("변경 2 · 세션 1");
    fireEvent.click(row);
    expect(onSelectWorktree).toHaveBeenCalledWith(featureWorktree);
  });

  it("보고 있는 워크트리는 '보는 중'이고 열기가 비활성이지만, 우클릭 메뉴는 열린다", () => {
    installApi();
    const onWorktreeContextMenu = vi.fn();
    render(
      <ProjectDetailPage
        {...baseProps()}
        worktree={featureWorktree}
        worktrees={[featureWorktree]}
        workspaceViews={[featureView]}
        onWorktreeContextMenu={onWorktreeContextMenu}
      />,
    );

    const card = screen.getByRole("region", { name: "워크트리" });
    const button = within(card).getByRole("button", { name: "feature-x (보는 중)" });
    expect(button).toBeDisabled();
    fireEvent.contextMenu(button);
    expect(onWorktreeContextMenu).toHaveBeenCalledWith(featureWorktree, expect.anything());
  });

  it("locked·missing·PR 리뷰 표시를 달고, PR 리뷰 worktree는 뒤로 간다", () => {
    installApi();
    const review: SharedWorktree = { ...featureWorktree, id: "worktree-pr", branch: "pr-42", path: "C:\\work\\atlas-wt\\pr-42" };
    render(
      <ProjectDetailPage
        {...baseProps()}
        worktrees={[review, featureWorktree]}
        workspaceViews={[
          featureView,
          {
            ...featureView,
            workspaceKey: "worktree:worktree-pr",
            worktreeId: review.id,
            branch: "pr-42",
            lockedReason: "review",
            availability: "missing",
          },
        ]}
        activeReviews={[makeReview({ worktreeId: review.id, pullRequestNumber: 42 })]}
      />,
    );

    const card = screen.getByRole("region", { name: "워크트리" });
    const names = within(card)
      .getAllByRole("button", { name: /워크트리 열기/ })
      .map((button) => button.textContent);
    expect(names[0]).toContain("feature-x");
    expect(names[1]).toContain("PR #42 · 임시");
    expect(names[1]).toContain("locked");
    expect(names[1]).toContain("missing");
  });

  it("워크트리가 없으면 안내와 만들기 버튼만 있고, 경고가 있으면 카드에 뜬다", () => {
    installApi();
    const onCreateWorktree = vi.fn();
    render(<ProjectDetailPage {...baseProps()} onCreateWorktree={onCreateWorktree} worktreeWarning="stale worktree 2개" />);

    const card = screen.getByRole("region", { name: "워크트리" });
    expect(within(card).getByText("아직 워크트리가 없습니다")).toBeInTheDocument();
    expect(within(card).getByRole("status")).toHaveTextContent("stale worktree 2개");
    fireEvent.click(within(card).getByRole("button", { name: "워크트리 만들기" }));
    expect(onCreateWorktree).toHaveBeenCalledOnce();
  });

  it("폴더 루트를 찾을 수 없으면 워크트리 만들기를 비활성화한다", () => {
    installApi();
    render(<ProjectDetailPage {...baseProps()} projectMissing />);

    const card = screen.getByRole("region", { name: "워크트리" });
    expect(within(card).getByRole("button", { name: "워크트리 만들기" })).toBeDisabled();
  });
});
