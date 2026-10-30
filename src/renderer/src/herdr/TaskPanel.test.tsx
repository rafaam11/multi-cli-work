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
  it('offers only repositories from the explicitly associated remote project',async()=>{
    const host=api();
    host.hostState=vi.fn(async()=>({tasks:[],terminals:[],hosts:[{hostId:'remote',name:'Remote',enabled:true,connected:true,observedAt:1000,error:null,tasks:[],terminals:[]}],connected:true,observedAt:1000}));
    host.executionCatalog=vi.fn(async()=>({version:1,platform:'linux',...(await host.configuration()),hostId:'remote',availableProviders:['codex'],repositories:[
      {id:'selected-repo',name:'Mapped repository',path:'/mapped',projectId:'remote-project',projectName:'Mapped'},
      {id:'other-repo',name:'Unrelated repository',path:'/other',projectId:'other-project',projectName:'Other'},
    ]} as import('@shared/execution-catalog').ExecutionCatalog));
    host.inspectHostRepository=vi.fn();host.startRegisteredTask=vi.fn();
    render(<TaskPanel api={host} hostId="remote" projectId="remote-project"/>);
    await screen.findByRole('option',{name:'Mapped / Mapped repository'});
    expect(screen.queryByRole('option',{name:/Unrelated repository/})).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('작업 저장소'),{target:{value:'selected-repo'}});
    fireEvent.change(screen.getByLabelText('작업 제목'),{target:{value:'Mapped task'}});
    fireEvent.change(screen.getByLabelText('작업 지시'),{target:{value:'Use the remote project brief'}});
    fireEvent.click(screen.getByRole('button',{name:'작업 만들기'}));
    await waitFor(()=>expect(host.createTask).toHaveBeenCalledWith(expect.objectContaining({projectId:'remote-project',lead:expect.objectContaining({hostId:'remote'})}),'remote'));
  });
  it('uses the connected local host catalog when a phone explicitly selects this PC',async()=>{
    const host=api();
    host.hostState=vi.fn(async()=>({tasks:[task()],terminals:[],hosts:[],connected:true,observedAt:1000}));
    host.executionCatalog=vi.fn(async():Promise<import('@shared/execution-catalog').ExecutionCatalog>=>({version:1,platform:'linux',...(await host.configuration()),availableProviders:['codex'],repositories:[]}));
    host.inspectHostRepository=vi.fn();host.startRegisteredTask=vi.fn();
    render(<TaskPanel api={host} hostId="host" hostName="This PC"/>);
    await screen.findByText('Existing task');
    await waitFor(()=>expect(host.executionCatalog).toHaveBeenCalledWith('host'));
    expect(screen.queryByText(/호스트 연결 끊김/)).not.toBeInTheDocument();
  });
  it("uses the selected worker PC's model profiles and requires its checked checkout before team launch",async()=>{
    const host=api(),draft=task();draft.participants[0].attempt={...draft.participants[0].attempt,delivery:"none",execution:"not_started",commandId:null};
    draft.participants.push({...draft.participants[0],id:"remote-worker",role:"worker",hostId:"worker-pc",profileId:"worker-profile",attempt:{...draft.participants[0].attempt,id:"worker-attempt"}});
    const repository={id:"worker-repo",name:"Worker checkout",path:"/worker/repo",projectId:null,projectName:null};
    host.executionHosts=vi.fn(async()=>[{hostId:"worker-pc",name:"Worker PC",connected:true}]);
    host.workerCatalog=vi.fn(async():Promise<import("@shared/execution-catalog").ExecutionCatalog>=>({version:1,hostId:"worker-pc",platform:"linux",launchProfiles:[{id:"worker-profile",name:"Worker chosen model",agentId:"codex",model:"worker-model",effort:null}],defaultLaunchProfiles:{codex:"worker-profile"},availableProviders:["codex"],repositories:[repository]}));
    host.inspectWorkerRepository=vi.fn(async()=>({repository,expectedHead:"b".repeat(40)}));
    vi.mocked(host.listTasks).mockResolvedValue([draft]);
    render(<TaskPanel api={host} defaultCwd="C:/owner/repo"/>);await screen.findByText("Existing task");
    fireEvent.click(screen.getByRole("button",{name:"작업자 추가"}));
    fireEvent.change(await screen.findByLabelText("작업자 1 실행 PC"),{target:{value:"worker-pc"}});
    await screen.findByRole("option",{name:/Worker chosen model/});
    fireEvent.change(screen.getByLabelText("작업 제목"),{target:{value:"New distributed"}});fireEvent.change(screen.getByLabelText("작업 지시"),{target:{value:"Collect only"}});
    fireEvent.click(screen.getByRole("button",{name:"작업 만들기"}));
    await waitFor(()=>expect(host.createTask).toHaveBeenCalledWith(expect.objectContaining({workers:[{hostId:"worker-pc",provider:"codex",profileId:"worker-profile"}]})));
    fireEvent.click(screen.getByRole("button",{name:/Existing task/}));
    fireEvent.click(screen.getByRole("button",{name:"기준 커밋 확인"}));
    await screen.findByText("aaaaaaaaaaaa");expect(screen.getByRole("button",{name:"작업 시작"})).toBeDisabled();
    fireEvent.change(await screen.findByLabelText("원격 작업자 1 저장소"),{target:{value:"worker-repo"}});
    fireEvent.click(screen.getByRole("button",{name:"원격 작업자 1 기준 커밋 확인"}));
    await screen.findByText(/대표 저장소와 기준 커밋이 다릅니다/);expect(screen.getByRole("button",{name:"작업 시작"})).toBeDisabled();
    vi.mocked(host.inspectWorkerRepository).mockResolvedValue({repository,expectedHead:"a".repeat(40)});
    fireEvent.click(screen.getByRole("button",{name:"원격 작업자 1 기준 커밋 확인"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"작업 시작"})).toBeEnabled());
    fireEvent.click(screen.getByRole("button",{name:"작업 시작"}));
    await waitFor(()=>expect(host.startTask).toHaveBeenCalledWith("task",{repositoryPath:"C:/owner/repo",expectedHead:"a".repeat(40),remoteWorkers:[{participantId:"remote-worker",selection:{repositoryId:"worker-repo",expectedPath:"/worker/repo",expectedHead:"a".repeat(40)}}]}));
  });
  it("selects the remote host's profiles and registered checkout, and sends the inspected path and commit back only to that owner",async()=>{
    const host=api(),remote=task();remote.id="new-remote";remote.title="Remote launch";remote.ownerHostId="remote";remote.projectId="remote-project";remote.participants[0].hostId="remote";remote.participants[0].profileId="remote-profile";
    remote.participants[0].attempt={...remote.participants[0].attempt,delivery:"none",execution:"not_started",commandId:null};
    const repository={id:"remote-repo",name:"Lab checkout",path:"/lab/repo",projectId:"remote-project",projectName:"Remote project"};
    host.hostState=vi.fn(async()=>({tasks:[],terminals:[],connected:true,observedAt:2000,hosts:[{hostId:"remote",name:"Lab",enabled:true,connected:true,observedAt:2000,error:null,tasks:[],terminals:[]}]}));
    host.executionCatalog=vi.fn(async():Promise<import("@shared/execution-catalog").ExecutionCatalog>=>({version:1,hostId:"remote",platform:"linux",launchProfiles:[{id:"remote-profile",name:"Remote choice",agentId:"codex",model:"remote-model",effort:null}],defaultLaunchProfiles:{codex:"remote-profile"},availableProviders:["codex"],repositories:[repository]}));
    host.inspectHostRepository=vi.fn(async()=>({repository,expectedHead:"b".repeat(40)}));
    host.startRegisteredTask=vi.fn(async()=>({terminals:[]}));
    vi.mocked(host.listTasks).mockResolvedValue([]);vi.mocked(host.createTask).mockResolvedValue(remote);
    render(<TaskPanel api={host} hostId="remote" hostName="Lab"/>);
    await screen.findByRole("option",{name:/Remote choice/});
    expect(screen.queryByRole("option",{name:"Codex 기본"})).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("작업 제목"),{target:{value:"Remote launch"}});fireEvent.change(screen.getByLabelText("작업 지시"),{target:{value:"Check remote"}});
    fireEvent.change(screen.getByLabelText("작업 저장소"),{target:{value:"remote-repo"}});
    fireEvent.click(screen.getByRole("button",{name:"작업 만들기"}));
    await waitFor(()=>expect(host.createTask).toHaveBeenCalledWith(expect.objectContaining({projectId:"remote-project",lead:{hostId:"remote",provider:"codex",profileId:"remote-profile"}}),"remote"));
    fireEvent.change(await screen.findByLabelText("실행 저장소"),{target:{value:"remote-repo"}});
    fireEvent.click(screen.getByRole("button",{name:"기준 커밋 확인"}));
    await waitFor(()=>expect(host.inspectHostRepository).toHaveBeenCalledWith("remote-repo","remote"));
    await screen.findByText("/lab/repo");
    vi.mocked(host.listTasks).mockResolvedValue([remote]);
    fireEvent.click(screen.getByRole("button",{name:"선택한 구성으로 시작"}));
    await waitFor(()=>expect(host.startRegisteredTask).toHaveBeenCalledWith("new-remote",{repositoryId:"remote-repo",expectedPath:"/lab/repo",expectedHead:"b".repeat(40)},"remote"));
    expect(host.startTask).not.toHaveBeenCalled();expect(host.repositoryHead).not.toHaveBeenCalled();
  });
  it("shows an offline owner's cached results without issuing a failing live read on entry",async()=>{
    const host=api(),remote=task();remote.ownerHostId="remote";remote.participants[0].hostId="remote";remote.title="Offline task";
    host.hostState=vi.fn(async()=>({tasks:[task()],terminals:[],connected:true,observedAt:2000,hosts:[{hostId:"remote",name:"Lab",enabled:false,connected:false,observedAt:1000,error:null,tasks:[remote],terminals:[]}]}));
    vi.mocked(host.listTasks).mockRejectedValue(new Error("Error invoking remote method 'v2:tasks': Error: Remote host is not observed"));
    render(<TaskPanel api={host} hostId="remote"/>);
    await screen.findByText("Offline task");await waitFor(()=>expect(screen.queryByText(/불러오는 중/)).not.toBeInTheDocument());
    expect(host.listTasks).not.toHaveBeenCalled();expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/호스트 연결 끊김/)).toHaveTextContent("마지막 수신");
  });
  it("scopes remote inspection and actions to the selected owner, keeps stale data and opens its terminal",async()=>{
    const host=api(),remote=task();remote.ownerHostId="remote";remote.participants[0].hostId="remote";
    remote.title="Remote task";remote.projectId="unrelated-remote-project";
    host.taskAction=vi.fn(async()=>{});host.terminalViewId=vi.fn(async()=>"mcwr-observed");
    vi.mocked(host.listTasks).mockResolvedValue([remote]);vi.mocked(host.inspectTask).mockResolvedValue(remote);
    let changed!:Parameters<NonNullable<McwV2Api["onState"]>>[0];host.onState=listener=>{changed=listener;return()=>{};};
    const state=(connected:boolean)=>({tasks:[task()],terminals:[],observedAt:2000,connected:true,hosts:[{hostId:"remote",name:"Lab",enabled:true,connected,observedAt:1000,error:null,tasks:[remote],terminals:[]}]});
    host.hostState=vi.fn(async()=>state(true));const open=vi.fn();
    render(<TaskPanel api={host} hostId="remote" hostName="Lab" onOpenTerminal={open}/>);
    await screen.findByText("Remote task");expect(host.listTasks).toHaveBeenCalledWith("remote");
    expect(screen.queryByRole("button",{name:"작업 만들기"})).not.toBeInTheDocument();
    expect(screen.queryByText("Existing task")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:/Remote task/}));
    expect(host.taskAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"요청 확인"}));
    await waitFor(()=>expect(host.taskAction).toHaveBeenCalledWith("task","acknowledge",{eventId:"q"},"remote"));
    await waitFor(()=>expect(host.inspectTask).toHaveBeenCalledWith("task","remote"));
    fireEvent.click(screen.getByRole("button",{name:"터미널 열기"}));
    await waitFor(()=>expect(open).toHaveBeenCalledWith("mcwr-observed"));
    expect(host.terminalViewId).toHaveBeenCalledWith("attempt","remote");
    fireEvent.change(screen.getByLabelText("팀 메시지"),{target:{value:"remote draft"}});
    act(()=>changed(state(false)));
    expect(screen.getByRole("button",{name:"메시지 보내기"})).toBeDisabled();
    expect(screen.getByLabelText("팀 메시지")).toHaveValue("remote draft");
    act(()=>changed(state(true)));
    await waitFor(()=>expect(screen.getByRole("button",{name:"메시지 보내기"})).toBeEnabled());
    fireEvent.click(screen.getByRole("button",{name:"메시지 보내기"}));
    await waitFor(()=>expect(host.taskAction).toHaveBeenCalledWith("task","message",{text:"remote draft"},"remote"));
    expect(host.createTask).not.toHaveBeenCalled();expect(host.startTask).not.toHaveBeenCalled();
  });
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
