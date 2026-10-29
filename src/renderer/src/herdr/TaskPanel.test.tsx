import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskCreateInput } from "@shared/host-types";
import type { McwV2Api } from "@shared/v2-api";
import { TaskPanel } from "./TaskPanel";

const task = (): Task => ({ id: "task", ownerHostId: "host", title: "Existing task", brief: "brief", projectId: "project", workerPool: [], createdAt: 1000,
  participants: [{ id: "lead", role: "lead", provider: "codex", profileId: "codex-default", hostId: "host", previousAttempts: [], attempt: { id: "attempt", generation: 1, execution: "idle", delivery: "delivered", commandId: "cmd", submittedResultId: null, observedAt: 1000 } }],
  events: [], questions: [{ id: "q", participantId: "lead", kind: "approval", text: "Review changes?", acknowledged: false, answer: null }], attention: { status: "waiting", eventId: "q", kind: "approval", acknowledged: false }, results: [], review: "none", cancellation: "none" });
function api() {
  return { version: 2, enabled: vi.fn(async () => true), configuration: vi.fn(async () => ({ hostId: "host", launchProfiles: [{ id: "codex-default", name: "Codex 기본", agentId: "codex", model: null, effort: null }, { id: "claude-default", name: "Claude 기본", agentId: "claude", model: null, effort: null }], defaultLaunchProfiles: { codex: "codex-default", claude: "claude-default" } })),
    listTasks: vi.fn(async () => [task()]), inspectTask: vi.fn(async () => task()), createTask: vi.fn(async (input: TaskCreateInput) => ({ ...task(), ...input, id: "new" })), startTask: vi.fn(async () => ({ sessionId: "session" })), repositoryHead: vi.fn(async () => "a".repeat(40)),
    listTerminals: vi.fn(async () => []), createTerminal: vi.fn(), subscribeTerminal: vi.fn(), terminalCommand: vi.fn(), recoveryStatus: vi.fn() } as unknown as McwV2Api;
}
afterEach(cleanup);
describe("v2 task dashboard", () => {
  it("shows stale observations on disconnect and retains drafts without sending commands", async () => {
    const host = api(); host.taskAction = vi.fn();
    let changed!: Parameters<NonNullable<McwV2Api["onState"]>>[0]; host.onState = listener => { changed = listener; return () => {}; };
    render(<TaskPanel api={host} projectId="project" />);
    await screen.findByText("Existing task"); fireEvent.click(screen.getByRole("button", {name: /Existing task/}));
    fireEvent.change(screen.getByLabelText("팀 메시지"), {target: {value: "보존할 초안"}});
    act(() => changed({tasks: [task()], terminals: [], observedAt: 1000, connected: false}));
    expect(screen.getByText(/호스트 연결 끊김/)).toHaveTextContent(/마지막 수신/);
    expect(screen.getByRole("button", {name: "메시지 보내기"})).toBeDisabled();
    expect(screen.getByRole("button", {name: "요청 확인"})).toBeDisabled();
    act(() => changed({tasks: [task()], terminals: [], observedAt: 2000, connected: true}));
    expect(screen.getByLabelText("팀 메시지")).toHaveValue("보존할 초안");
    expect(screen.getByRole("button", {name: "메시지 보내기"})).toBeEnabled();
    expect(host.taskAction).not.toHaveBeenCalled(); expect(host.startTask).not.toHaveBeenCalled();
  });
  it("acknowledges and answers only the exact request explicitly acted on by the user",async()=>{
    const host=api();host.taskAction=vi.fn(async()=>{});
    render(<TaskPanel api={host} projectId="project"/>);
    await screen.findByText("Existing task");fireEvent.click(screen.getByRole("button",{name:/Existing task/}));
    expect(host.taskAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"요청 확인"}));
    await waitFor(()=>expect(host.taskAction).toHaveBeenCalledWith("task","acknowledge",{eventId:"q"}));
    await waitFor(()=>expect(screen.getByLabelText("답변: Review changes?")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("답변: Review changes?"),{target:{value:"통합하지 말고 결과를 보존하세요"}});
    fireEvent.click(screen.getByRole("button",{name:"답변 보내기"}));
    await waitFor(()=>expect(host.taskAction).toHaveBeenCalledWith("task","answer",{eventId:"q",text:"통합하지 말고 결과를 보존하세요"}));
    expect(host.startTask).not.toHaveBeenCalled();
  });
  it("reads tasks without acknowledging waiting events or mistaking idle for completion", async () => {
    const host = api();
    render(<TaskPanel api={host} projectId="project" />);
    await screen.findByText("Existing task");
    fireEvent.click(screen.getByRole("button", { name: /Existing task/ }));
    expect(screen.getByText("Review changes?")).toBeInTheDocument();
    expect(screen.getAllByText(/입력 대기/).length).toBeGreaterThan(0);
    expect(host.createTask).not.toHaveBeenCalled();
    expect(host.startTask).not.toHaveBeenCalled();
  });
  it("creates a new lead with explicit profiles and at most three selected workers without starting it", async () => {
    const host = api();
    render(<TaskPanel api={host} projectId="project" />);
    await screen.findByText("Existing task");
    fireEvent.change(screen.getByLabelText("작업 제목"), { target: { value: "New feature" } });
    fireEvent.change(screen.getByLabelText("작업 지시"), { target: { value: "Build the feature" } });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "작업자 추가" }));
    expect(screen.getByRole("button", { name: "작업자 추가" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("작업자 1 도구"), { target: { value: "claude" } });
    fireEvent.click(screen.getByRole("button", { name: "작업 만들기" }));
    await waitFor(() => expect(host.createTask).toHaveBeenCalledOnce());
    expect(host.createTask).toHaveBeenCalledWith({ title: "New feature", brief: "Build the feature", projectId: "project", lead: { provider: "codex", profileId: "codex-default", hostId: "host" }, workers: [{ provider: "claude", profileId: "claude-default" }, { provider: "codex", profileId: "codex-default" }, { provider: "codex", profileId: "codex-default" }] });
    expect(host.startTask).not.toHaveBeenCalled();
  });
  it("requires a checked base commit before explicit start and clears it when the path changes", async () => {
    const host = api(), draft = task(); draft.participants[0].attempt = { ...draft.participants[0].attempt, execution: "not_started", delivery: "none" };
    vi.mocked(host.listTasks).mockResolvedValue([draft]);
    const open = vi.fn();
    render(<TaskPanel api={host} defaultCwd="C:/repo" onOpenTerminal={open} />);
    await screen.findByText("Existing task");
    fireEvent.click(screen.getByRole("button", { name: /Existing task/ }));
    expect(screen.getByRole("button", { name: "작업 시작" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "기준 커밋 확인" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "작업 시작" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("저장소 경로"), { target: { value: "C:/other" } });
    expect(screen.getByRole("button", { name: "작업 시작" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "기준 커밋 확인" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "작업 시작" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "작업 시작" }));
    await waitFor(() => expect(host.startTask).toHaveBeenCalledWith("task", { repositoryPath: "C:/other", expectedHead: "a".repeat(40) }));
    expect(open).toHaveBeenCalledWith("session");
  });
});
