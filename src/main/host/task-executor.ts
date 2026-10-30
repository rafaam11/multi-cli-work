import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import type { AttemptRef, Task, TaskIdentity, TaskParticipant, TaskAttempt } from "../../shared/host-types";
import { parseLaunchProfile, type LaunchProfile } from "../../shared/launch-profile";
import { buildAgentLaunch } from "../agents/agent-launch";
import { BUILTIN_AGENTS } from "../agents/builtin-agents";
import { prepareTaskWorkspace, type TaskExecutionWorkspace } from "./execution-workspace";
import { TaskStore } from "./task-store";
import { writePrivateJson, type HostTerminalService } from "./gateway";
import type {RemoteWorkerSelection} from "../../shared/remote-task-types";
import {validateRemoteSelection,type RemoteWorkers} from "./remote-workers";

export interface TaskExecutionProfile { participantId: string; profile: LaunchProfile; executable: string }
export interface TaskStartInput { repositoryPath: string; expectedHead: string; profiles: TaskExecutionProfile[]; projectId?: string | null;remoteWorkers?:RemoteWorkerSelection[] }
export interface TaskExecutorOptions {
  directory: string; store: TaskStore; terminals: HostTerminalService;
  issueTaskToken(ref: AttemptRef): Promise<string>; gatewayUrl(): string;
  mcpClientPath: string; mcpExecutable?: string; mcpElectron?: boolean;
  remoteWorkers?:Pick<RemoteWorkers,"prepare"|"admit">;
}
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected task start object"); return value as Record<string, unknown>; }
function identity(task: Task, participant: TaskParticipant): TaskIdentity { return { taskId: task.id, participantId: participant.id, attemptId: participant.attempt.id, generation: participant.attempt.generation, hostId: participant.hostId, role: participant.role }; }
function generation(participant: TaskParticipant): string { return `${participant.attempt.id}-${participant.attempt.generation}`; }
/** Explicit owner-triggered execution. No automatic retry, typing, merge or provider resumption. */
export class TaskExecutor {
  private readonly starting = new Set<string>();
  constructor(readonly options: TaskExecutorOptions) {}
  private async validate(task: Task, value: unknown): Promise<TaskStartInput> {
    const raw = record(value);
    const localMembers=task.participants.filter(member=>member.hostId===task.ownerHostId),remoteMembers=task.participants.filter(member=>member.hostId!==task.ownerHostId);
    if (Object.keys(raw).some(key => !["repositoryPath", "expectedHead", "profiles", "projectId","remoteWorkers"].includes(key)) || typeof raw.repositoryPath !== "string" || !path.isAbsolute(raw.repositoryPath) || typeof raw.expectedHead !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(raw.expectedHead) || !Array.isArray(raw.profiles) || raw.profiles.length !== localMembers.length || (raw.projectId !== undefined && raw.projectId !== null && typeof raw.projectId !== "string")) throw new Error("Invalid task start configuration");
    if (task.cancellation !== "none" || task.ownerHostId !== this.options.store.options.hostId) throw new Error("Cancelled or foreign task cannot start here");
    const remoteWorkers=raw.remoteWorkers??[];
    if(!Array.isArray(remoteWorkers)||remoteWorkers.length!==remoteMembers.length||(remoteMembers.length&&!this.options.remoteWorkers))throw new Error("Confirm every remote worker checkout before launch");
    const remoteIds=new Set<string>();
    for(const value of remoteWorkers){const selected=record(value);validateRemoteSelection(selected.selection);
      if(Object.keys(selected).sort().join(",")!=="participantId,selection"||typeof selected.participantId!=="string"||remoteIds.has(selected.participantId)||!remoteMembers.some(member=>member.id===selected.participantId&&member.role==="worker")||selected.selection.expectedHead!==raw.expectedHead)throw new Error("Remote worker checkout differs from the selected base");remoteIds.add(selected.participantId);
    }
    if (task.participants.some(member => member.attempt.delivery !== "none" || member.attempt.execution !== "not_started")) throw new Error("Task delivery already attempted; reconcile or explicitly create a fresh attempt");
    const seen = new Set<string>();
    const profiles = raw.profiles.map(value => {
      const input = record(value); const profile = parseLaunchProfile(input.profile);
      if (Object.keys(input).some(key => !["participantId", "profile", "executable"].includes(key)) || typeof input.participantId !== "string" || seen.has(input.participantId) || typeof input.executable !== "string" || !path.isAbsolute(input.executable) || input.executable.includes("\0")) throw new Error("Invalid task execution profile");
      const participant = task.participants.find(member => member.id === input.participantId);
      if (!participant || participant.hostId!==task.ownerHostId || participant.profileId !== profile.id || participant.provider !== profile.agentId) throw new Error("Task participant profile differs from the user selection");
      seen.add(input.participantId); return { participantId: input.participantId, profile, executable: input.executable };
    });
    await Promise.all(profiles.map(profile => access(profile.executable))); await access(this.options.mcpClientPath);
    return { repositoryPath: raw.repositoryPath, expectedHead: raw.expectedHead, profiles, projectId: raw.projectId as string | null | undefined,remoteWorkers:remoteWorkers as RemoteWorkerSelection[] };
  }
  async start(taskId: string, value: unknown): Promise<{ terminals: unknown[] }> {
    if (this.starting.has(taskId)) throw new Error("Task start is already in progress");
    this.starting.add(taskId);
    try {
      const task = await this.options.store.inspect(taskId); const input = await this.validate(task, value);
      // Prepare every selected workspace before admitting any provider command.
      const prepared = new Map<string,TaskExecutionWorkspace>();
      for (const participant of task.participants) {
        if(participant.hostId!==task.ownerHostId){await this.options.remoteWorkers!.prepare(task,identity(task,participant),input.remoteWorkers!.find(selected=>selected.participantId===participant.id)!.selection);continue;}
        prepared.set(participant.id,await prepareTaskWorkspace({ ownedRoot: path.join(this.options.directory, "task-workspaces"), taskId, participantId: participant.id, role: participant.role, repositoryPath: input.repositoryPath, expectedHead: input.expectedHead, brief: task.brief, provider: participant.provider, profileId: participant.profileId }));
      }
      const terminals: unknown[] = [];
      for (const participant of task.participants) {
        if(participant.hostId!==task.ownerHostId){terminals.push(await this.options.remoteWorkers!.admit(identity(task,participant)));continue;}
        const workspace=prepared.get(participant.id)!;
        const selection=input.profiles.find(profile=>profile.participantId===participant.id)!;
        terminals.push(await launchTaskParticipant({...this.options,inspectAttempt:async scope=>(await this.options.store.inspect(scope.taskId)).participants.find(member=>member.id===scope.participantId)!.attempt},task,participant,workspace,selection,input.projectId??null));
      }
      return { terminals };
    } finally { this.starting.delete(taskId); }
  }
  /** Refresh observations from confirmed broker state without relaunching missing or lost work. */
  async reconcile(): Promise<void> {
    const sessions = await this.options.terminals.list() as Record<string, unknown>[];
    for (const task of await this.options.store.list()) for (const participant of task.participants) {
      if (participant.hostId !== this.options.store.options.hostId || participant.attempt.delivery === "none") continue;
      const session = sessions.find(value => value.id === participant.attempt.id && value.generation === generation(participant));
      const scope = identity(task, participant);
      if (!session || session.connected !== true) { if (["running", "idle"].includes(participant.attempt.execution)) await this.options.store.observeExecution(scope, "lost"); continue; }
      if (["pending", "unknown"].includes(participant.attempt.delivery) && participant.attempt.commandId && ["delivered", "rejected"].includes(session.delivery as string)) await this.options.store.resolveDelivery(scope, participant.attempt.commandId, session.delivery as "delivered" | "rejected");
      if (session.delivery === "delivered") {
        const execution = session.status === "exited" ? "exited" : session.status === "idle" ? "idle" : "running";
        if (execution !== participant.attempt.execution) await this.options.store.observeExecution(scope, execution);
      }
    }
  }
}

export type ParticipantLaunchOptions=Omit<TaskExecutorOptions,"store">&{
  store:Pick<TaskStore,"beginDelivery"|"resolveDelivery"|"observeExecution">;
  inspectAttempt(identity:TaskIdentity):Promise<TaskAttempt>;
};
/** A single already prepared participant. Callers own admission; uncertain commands are never repeated. */
export async function launchTaskParticipant(options:ParticipantLaunchOptions,task:Task,participant:TaskParticipant,workspace:TaskExecutionWorkspace,selection:TaskExecutionProfile,projectId:string|null,commandId:string=randomUUID()):Promise<unknown>{
  if(!/^[\w-]{1,128}$/.test(participant.attempt.id))throw new Error("Invalid execution attempt identifier");
  const scope = identity(task, participant); const token = await options.issueTaskToken(scope);
  // A process command line (including Herdr's saved layout) must never
  // contain task capabilities. Both providers receive only a private path.
  const connectionFile=path.join(options.directory,"task-mcp",`${participant.attempt.id}.connection.json`);
  await writePrivateJson(connectionFile,{endpoint:`${options.gatewayUrl()}/mcp`,token});
  const env = options.mcpElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
  const mcp = { command: options.mcpExecutable ?? process.execPath, args: [options.mcpClientPath, "--task-mcp-client", "--connection-file", connectionFile], env };
  const configPath = path.join(options.directory, "task-mcp", `${participant.attempt.id}.json`);
  await writePrivateJson(configPath, { mcpServers: { mcw_task: { type: "stdio", ...mcp } } });
  const definition = { ...BUILTIN_AGENTS[participant.provider], newSessionArgs: participant.provider === "codex" ? [] : [...BUILTIN_AGENTS.claude.newSessionArgs], args: participant.provider === "claude" ? ["--dangerously-skip-permissions"] : [...BUILTIN_AGENTS.codex.args] };
  const toml = JSON.stringify;
  // --mcp-config is variadic: terminate it with the boolean option so the
  // following prompt is not parsed as another configuration file.
  const mcpArgs = participant.provider === "claude" ? ["--mcp-config", configPath, "--strict-mcp-config"] : ["-c", `mcp_servers.mcw_task.command=${toml(mcp.command)}`, "-c", `mcp_servers.mcw_task.args=${toml(mcp.args)}`, "-c", `mcp_servers.mcw_task.env={${Object.entries(env).map(([key, value]) => `${key}=${toml(value)}`).join(",")}}`, "-c", "mcp_servers.mcw_task.tool_timeout_sec=65"];
  const prompt = `You are the ${participant.role} for task ${task.id}. Read ${workspace.briefPath}. Repository: ${workspace.repositoryPath}; verified base: ${workspace.baseCommit}. Use only the mcw_task task tools for team communication: inspect, message, wait, submit and cancellation. ${participant.role === "lead" ? "Coordinate the selected workers; the current directory holds your brief, not a writable repository." : "Work only in this MCW-owned checkout."} Submit changes, verification, artifacts and unresolved issues for user review. Keep code unintegrated; never merge, push or reset. Idle is not completion. Do not acknowledge user questions on their behalf.`;
  const waitInstruction = " After submitting or while waiting for other participants, call task_wait with your last received cursor; on timeout call it again. Process new questions, messages, results and cancellation requests before waiting again. Do not exit or invent new work while waiting for the user.";
  const command = buildAgentLaunch(definition, selection.executable, { cwd: workspace.directory, sessionId: participant.attempt.id, claudeSettingsPath: "", codexProfileName: "", resumeConversationId: null, launchProfile: selection.profile, extraArgs: [...mcpArgs, prompt + waitInstruction] });
  const terminalEnv = {
    MULTI_CLI_WORK_PROJECT_BRIEF: workspace.briefPath,
    MULTI_CLI_WORK_SESSION_ID: participant.attempt.id,
    MULTI_CLI_WORK_GENERATION: generation(participant),
    MCW_TASK_ID: task.id, MCW_PARTICIPANT_ID: participant.id, MCW_TASK_ROLE: participant.role,
    MCW_TASK_OWNER_HOST_ID: task.ownerHostId, MCW_RUNTIME: "v2",
  };
  await options.store.beginDelivery(scope, commandId);
  try {
    const terminal = await options.terminals.create({ sessionId: participant.attempt.id, generation: generation(participant), kind: participant.provider, cwd: workspace.directory, executable: command.executable, args: command.args, env: terminalEnv, projectId: projectId ?? null, createdAt: new Date().toISOString() });
    await options.store.resolveDelivery(scope, commandId, "delivered"); await options.store.observeExecution(scope, "running"); return terminal;
  } catch (error) {
    // A lost response may follow an accepted command. Only a durable broker rejection proves no dispatch.
    const session = (await options.terminals.list().catch(() => [])).find(value => value && typeof value === "object" && (value as Record<string, unknown>).id === participant.attempt.id) as Record<string, unknown> | undefined;
    const attempt = await options.inspectAttempt(scope);
    if (attempt.delivery === "pending") await options.store.resolveDelivery(scope, commandId, session?.delivery === "rejected" ? "rejected" : "unknown");
    throw error;
  }
}
