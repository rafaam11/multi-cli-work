import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import type { AttemptRef, Task, TaskIdentity, TaskParticipant } from "../../shared/host-types";
import { parseLaunchProfile, type LaunchProfile } from "../../shared/launch-profile";
import { buildAgentLaunch } from "../agents/agent-launch";
import { BUILTIN_AGENTS } from "../agents/builtin-agents";
import { prepareTaskWorkspace } from "./execution-workspace";
import { TaskStore } from "./task-store";
import { writePrivateJson, type HostTerminalService } from "./gateway";

export interface TaskExecutionProfile { participantId: string; profile: LaunchProfile; executable: string }
export interface TaskStartInput { repositoryPath: string; expectedHead: string; profiles: TaskExecutionProfile[]; projectId?: string | null }
export interface TaskExecutorOptions {
  directory: string; store: TaskStore; terminals: HostTerminalService;
  issueTaskToken(ref: AttemptRef): Promise<string>; gatewayUrl(): string;
  mcpClientPath: string; mcpExecutable?: string; mcpElectron?: boolean;
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
    if (Object.keys(raw).some(key => !["repositoryPath", "expectedHead", "profiles", "projectId"].includes(key)) || typeof raw.repositoryPath !== "string" || !path.isAbsolute(raw.repositoryPath) || typeof raw.expectedHead !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(raw.expectedHead) || !Array.isArray(raw.profiles) || raw.profiles.length !== task.participants.length || (raw.projectId !== undefined && raw.projectId !== null && typeof raw.projectId !== "string")) throw new Error("Invalid task start configuration");
    if (task.cancellation !== "none" || task.ownerHostId !== this.options.store.options.hostId || task.participants.some(member => member.hostId !== task.ownerHostId)) throw new Error("Remote or cancelled tasks require validated host dispatch before launch");
    if (task.participants.some(member => member.attempt.delivery !== "none" || member.attempt.execution !== "not_started")) throw new Error("Task delivery already attempted; reconcile or explicitly create a fresh attempt");
    const seen = new Set<string>();
    const profiles = raw.profiles.map(value => {
      const input = record(value); const profile = parseLaunchProfile(input.profile);
      if (Object.keys(input).some(key => !["participantId", "profile", "executable"].includes(key)) || typeof input.participantId !== "string" || seen.has(input.participantId) || typeof input.executable !== "string" || !path.isAbsolute(input.executable) || input.executable.includes("\0")) throw new Error("Invalid task execution profile");
      const participant = task.participants.find(member => member.id === input.participantId);
      if (!participant || participant.profileId !== profile.id || participant.provider !== profile.agentId) throw new Error("Task participant profile differs from the user selection");
      seen.add(input.participantId); return { participantId: input.participantId, profile, executable: input.executable };
    });
    await Promise.all(profiles.map(profile => access(profile.executable))); await access(this.options.mcpClientPath);
    return { repositoryPath: raw.repositoryPath, expectedHead: raw.expectedHead, profiles, projectId: raw.projectId as string | null | undefined };
  }
  async start(taskId: string, value: unknown): Promise<{ terminals: unknown[] }> {
    if (this.starting.has(taskId)) throw new Error("Task start is already in progress");
    this.starting.add(taskId);
    try {
      const task = await this.options.store.inspect(taskId); const input = await this.validate(task, value);
      // Prepare every selected workspace before admitting any provider command.
      const prepared = [];
      for (const participant of task.participants) prepared.push({ participant, workspace: await prepareTaskWorkspace({ ownedRoot: path.join(this.options.directory, "task-workspaces"), taskId, participantId: participant.id, role: participant.role, repositoryPath: input.repositoryPath, expectedHead: input.expectedHead, brief: task.brief, provider: participant.provider, profileId: participant.profileId }) });
      const terminals: unknown[] = [];
      for (const { participant, workspace } of prepared) {
        const scope = identity(task, participant); const token = await this.options.issueTaskToken(scope);
        const env = { MCW_TASK_URL: `${this.options.gatewayUrl()}/mcp`, MCW_TASK_TOKEN: token, ...(this.options.mcpElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
        const mcp = { command: this.options.mcpExecutable ?? process.execPath, args: [this.options.mcpClientPath, "--task-mcp-client"], env };
        const configPath = path.join(this.options.directory, "task-mcp", `${participant.attempt.id}.json`);
        await writePrivateJson(configPath, { mcpServers: { mcw_task: { type: "stdio", ...mcp } } });
        const selection = input.profiles.find(profile => profile.participantId === participant.id)!;
        const definition = { ...BUILTIN_AGENTS[participant.provider], newSessionArgs: participant.provider === "codex" ? [] : [...BUILTIN_AGENTS.claude.newSessionArgs], args: participant.provider === "claude" ? ["--dangerously-skip-permissions"] : [...BUILTIN_AGENTS.codex.args] };
        const toml = JSON.stringify;
        const mcpArgs = participant.provider === "claude" ? ["--strict-mcp-config", "--mcp-config", configPath] : ["-c", `mcp_servers.mcw_task.command=${toml(mcp.command)}`, "-c", `mcp_servers.mcw_task.args=${toml(mcp.args)}`, "-c", `mcp_servers.mcw_task.env={${Object.entries(env).map(([key, value]) => `${key}=${toml(value)}`).join(",")}}`, "-c", "mcp_servers.mcw_task.tool_timeout_sec=65"];
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
        const commandId = randomUUID();
        await this.options.store.beginDelivery(scope, commandId);
        try {
          const terminal = await this.options.terminals.create({ sessionId: participant.attempt.id, generation: generation(participant), kind: participant.provider, cwd: workspace.directory, executable: command.executable, args: command.args, env: terminalEnv, projectId: input.projectId ?? null, createdAt: new Date().toISOString() });
          await this.options.store.resolveDelivery(scope, commandId, "delivered"); await this.options.store.observeExecution(scope, "running"); terminals.push(terminal);
        } catch (error) {
          // A lost response may follow an accepted command. Only a durable broker rejection proves no dispatch.
          const session = (await this.options.terminals.list().catch(() => [])).find(value => value && typeof value === "object" && (value as Record<string, unknown>).id === participant.attempt.id) as Record<string, unknown> | undefined;
          const attempt = (await this.options.store.inspect(taskId)).participants.find(member => member.id === participant.id)!.attempt;
          if (attempt.delivery === "pending") await this.options.store.resolveDelivery(scope, commandId, session?.delivery === "rejected" ? "rejected" : "unknown");
          throw error;
        }
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
