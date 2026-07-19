import type { AgentView } from "@shared/agent-types";
import type { GitStatusResult, MultiCliWorkApi, TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
