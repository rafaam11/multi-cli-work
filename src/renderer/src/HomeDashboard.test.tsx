import type { AgentView } from "@shared/agent-types";
import type { MultiCliWorkApi, TerminalSessionView, UpdaterStatus } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeDashboard, type ActivityEntry } from "./HomeDashboard";

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
  memo: "",
  tracks: [],
  hidden: false,
  order: 0,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

const dashboard: SharedProject = {
  ...atlas,
  id: "project-dashboard",
  rootPath: "C:\\work\\dashboard",
  displayName: "Dashboard",
  order: 1,
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
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

function installUpdatesApi(initial: UpdaterStatus = { state: "idle" }) {
  const listeners = new Set<(status: UpdaterStatus) => void>();
  const updates: MultiCliWorkApi["updates"] = {
    appVersion: vi.fn().mockResolvedValue("1.0.1"),
    status: vi.fn().mockResolvedValue(initial),
    check: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    openReleases: vi.fn().mockResolvedValue(undefined),
    openRepository: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn((listener: (status: UpdaterStatus) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  window.multiCliWork = { updates } as unknown as MultiCliWorkApi;
  return {
    updates,
    emit(status: UpdaterStatus) {
      act(() => {
        for (const listener of listeners) listener(status);
      });
    },
  };
}

function baseProps() {
  return {
    projects: [atlas, dashboard],
    sessions: [] as TerminalSessionView[],
    agents,
    activityLog: [] as ActivityEntry[],
    pendingAction: false,
    onSelectSession: vi.fn(),
    onStartSession: vi.fn(),
    onStartTool: vi.fn(),
  };
}

describe("HomeDashboard", () => {
  it("orders the session monitor by how urgently each status needs attention", () => {
    installUpdatesApi();
    const idle = makeSession({ id: "s-idle", status: "idle", name: "Idle one" });
    const approval = makeSession({ id: "s-approval", status: "awaiting-approval", name: "Needs approval" });
    const working = makeSession({ id: "s-working", status: "working", name: "Working one" });
    render(<HomeDashboard {...baseProps()} sessions={[idle, working, approval]} />);

    const rows = screen.getAllByRole("button", { name: /.* 세션으로 이동/ });
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Needs approval"),
      expect.stringContaining("Working one"),
      expect.stringContaining("Idle one"),
    ]);
  });

  it("selects the session behind a clicked monitor row", () => {
    installUpdatesApi();
    const session = makeSession({ id: "s-1", name: "My session" });
    const onSelectSession = vi.fn();
    render(<HomeDashboard {...baseProps()} sessions={[session]} onSelectSession={onSelectSession} />);

    fireEvent.click(screen.getByRole("button", { name: "My session 세션으로 이동" }));
    expect(onSelectSession).toHaveBeenCalledWith(session);
  });

  it("shows the most recently active projects first in quick launch, capped at five", () => {
    installUpdatesApi();
    const projects = Array.from({ length: 6 }, (_, index) => ({
      ...atlas,
      id: `project-${index}`,
      displayName: `Project ${index}`,
      createdAt: `2026-07-0${index + 1}T00:00:00.000Z`,
      updatedAt: `2026-07-0${index + 1}T00:00:00.000Z`,
    }));
    render(<HomeDashboard {...baseProps()} projects={projects} sessions={[]} />);

    const list = screen.getByRole("region", { name: "빠른 실행" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent("Project 5");
  });

  it("starts a session in the right project from quick launch", () => {
    installUpdatesApi();
    const onStartSession = vi.fn();
    render(<HomeDashboard {...baseProps()} sessions={[]} onStartSession={onStartSession} />);

    fireEvent.click(screen.getByRole("button", { name: "Dashboard에서 PowerShell 시작" }));
    expect(onStartSession).toHaveBeenCalledWith(dashboard, "powershell");
  });

  it("disables CLI update buttons for a provider that is not installed", () => {
    installUpdatesApi();
    render(<HomeDashboard {...baseProps()} />);
    expect(screen.getByRole("button", { name: "Codex 업데이트" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Claude Code 업데이트" })).toBeEnabled();
  });

  it("jumps to the session behind an activity feed entry", () => {
    installUpdatesApi();
    const session = makeSession({ id: "s-1" });
    const onSelectSession = vi.fn();
    const activityLog: ActivityEntry[] = [
      {
        id: "entry-1",
        timestamp: "2026-07-11T00:00:00.000Z",
        projectId: atlas.id,
        sessionId: "s-1",
        sessionLabel: "PowerShell",
        fromStatus: "working",
        toStatus: "awaiting-input",
      },
    ];
    render(<HomeDashboard {...baseProps()} sessions={[session]} activityLog={activityLog} onSelectSession={onSelectSession} />);

    const feed = screen.getByRole("region", { name: "최근 활동" });
    fireEvent.click(within(feed).getByText("PowerShell"));
    expect(onSelectSession).toHaveBeenCalledWith(session);
  });

  it("uses a provider title that arrived after the activity entry was recorded", () => {
    installUpdatesApi();
    const session = makeSession({ id: "codex-1", kind: "codex", title: "알림 정책 구현" });
    const activityLog: ActivityEntry[] = [
      {
        id: "entry-1",
        timestamp: "2026-07-11T00:00:00.000Z",
        projectId: atlas.id,
        sessionId: session.id,
        sessionLabel: "Codex",
        fromStatus: "working",
        toStatus: "awaiting-input",
      },
    ];

    render(<HomeDashboard {...baseProps()} sessions={[session]} activityLog={activityLog} />);

    expect(within(screen.getByRole("region", { name: "최근 활동" })).getByText("알림 정책 구현")).toBeInTheDocument();
  });

  it("shows empty states when there is nothing to display yet", () => {
    installUpdatesApi();
    render(<HomeDashboard {...baseProps()} projects={[]} sessions={[]} />);
    expect(screen.getByText("아직 세션이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("폴더를 열면 여기에 표시됩니다")).toBeInTheDocument();
    expect(screen.getByText("아직 이 세션에 활동이 없습니다")).toBeInTheDocument();
  });

  it("offers a restart action once the app update has finished downloading", async () => {
    const { updates } = installUpdatesApi({ state: "downloaded", version: "1.1.0" });
    render(<HomeDashboard {...baseProps()} />);

    fireEvent.click(await screen.findByRole("button", { name: "재시작" }));
    expect(updates.install).toHaveBeenCalledOnce();
  });

  it("checks for updates and reflects a status event", async () => {
    const { updates, emit } = installUpdatesApi();
    render(<HomeDashboard {...baseProps()} />);

    fireEvent.click(await screen.findByRole("button", { name: "확인" }));
    expect(updates.check).toHaveBeenCalledOnce();

    emit({ state: "available", version: "1.1.0" });
    expect(await screen.findByText("1.1.0 업데이트 가능")).toBeInTheDocument();
  });
});
