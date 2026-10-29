import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";
import type { AttemptRef, RemoteTaskResult, Task, TaskAgentChoice, TaskAttempt, TaskCreateInput, TaskDelivery, TaskEvent, TaskExecution, TaskHostSnapshot, TaskIdentity, TaskInbox, TaskParticipant, TaskResult, TaskResultInput } from "../../shared/host-types";
import { TaskValidationError, validateRemoteResult, validateTaskChoice, validateTaskCreate, validateTaskId, validateTaskIdentity, validateTaskInteger, validateTaskResult, validateTaskSnapshot, validateTaskText } from "./task-validation";

export interface TaskStoreOptions { directory: string; hostId: string }
export class TaskStore {
  readonly filePath: string;
  readonly options: TaskStoreOptions;
  private readonly changes = new EventEmitter();
  private readonly spec: JsonStoreSpec<TaskHostSnapshot>;
  constructor(options: TaskStoreOptions) {
    validateTaskId(options.hostId); validateTaskText(options.directory);
    this.options = { ...options }; this.filePath = path.join(options.directory, "tasks-v2.json");
    this.spec = { label: "task store", displayName: "v2 작업", empty: () => ({ schemaVersion: 2, hostId: options.hostId, tasks: [], outbox: [] }), parse: value => { const parsed = validateTaskSnapshot(value); if (parsed.hostId !== options.hostId) throw new TaskValidationError("Task host identity mismatch"); return parsed; }, error: (message, opts) => new Error(message, opts), isContentError: error => error instanceof TaskValidationError };
  }
  onChange(callback: () => void): () => void { this.changes.on("change", callback); return () => this.changes.off("change", callback); }
  async snapshot(): Promise<TaskHostSnapshot> { return structuredClone((await readJsonStore(this.spec, this.filePath)).value); }
  async inspect(taskId: string): Promise<Task> { validateTaskId(taskId); return this.task(await this.snapshot(), taskId); }
  async list(): Promise<Task[]> { return (await this.snapshot()).tasks; }
  private task(state: TaskHostSnapshot, taskId: string): Task { const task = state.tasks.find(item => item.id === taskId); if (!task) throw new Error("Unknown task"); return task; }
  private authorize(task: Task, input: TaskIdentity, leadOnly = false): TaskParticipant {
    validateTaskIdentity(input);
    const member = task.participants.find(item => item.id === input.participantId);
    if (input.taskId !== task.id || !member || member.hostId !== input.hostId || member.role !== input.role || member.attempt.id !== input.attemptId || member.attempt.generation !== input.generation || (leadOnly && member.role !== "lead")) throw new Error("Unauthorized or stale task attempt");
    return member;
  }
  private async update<T>(operation: (state: TaskHostSnapshot) => T): Promise<T> {
    let result!: T;
    await updateJsonStore(this.spec, this.filePath, state => { result = operation(state); return state; });
    this.changes.emit("change"); return structuredClone(result);
  }
  private event(task: Task, kind: TaskEvent["kind"], from: string, text: string, to: string | null = null, targets?:TaskIdentity[]): TaskEvent {
    const scope = (member:TaskParticipant):TaskIdentity => ({taskId:task.id,participantId:member.id,attemptId:member.attempt.id,generation:member.attempt.generation,hostId:member.hostId,role:member.role});
    const sender = task.participants.find(member=>member.id===from);
    const event:TaskEvent = { id: randomUUID(), sequence: task.events.length + 1, kind, from, to, text, at: Date.now(), ...(sender ? {source:scope(sender)} : {}), recipients: targets ?? task.participants.filter(member=>to===null || member.id===to).map(scope) }; task.events.push(event); return event;
  }
  private participant(choice: TaskAgentChoice, role: "lead" | "worker", defaultHost: string): TaskParticipant {
    return { id: randomUUID(), role, provider: choice.provider, profileId: choice.profileId, hostId: choice.hostId ?? defaultHost, attempt: { id: randomUUID(), generation: 1, execution: "not_started", delivery: "none", commandId: null, submittedResultId: null, observedAt: null }, previousAttempts: [] };
  }
  async createTask(input: TaskCreateInput): Promise<Task> {
    validateTaskCreate(input); if (input.lead.hostId !== this.options.hostId) throw new Error("Lead host must own task");
    return this.update(state => { const task: Task = { id: randomUUID(), ownerHostId: this.options.hostId, title: input.title, brief: input.brief, ...(input.projectId === undefined ? {} : { projectId: input.projectId }), workerPool: (input.workerPool ?? input.workers ?? []).map(item => ({ ...item, hostId: item.hostId ?? input.lead.hostId })), createdAt: Date.now(), participants: [this.participant(input.lead, "lead", input.lead.hostId), ...(input.workers ?? []).map(item => this.participant(item, "worker", input.lead.hostId))], events: [], questions: [], attention: { status: "clear" }, results: [], review: "none", cancellation: "none" }; state.tasks.push(task); return task; });
  }
  async assign(identity: TaskIdentity, choice: TaskAgentChoice): Promise<TaskParticipant> {
    validateTaskChoice(choice);
    return this.update(state => {
      const task = this.task(state, identity.taskId); this.authorize(task, identity, true);
      if (task.cancellation !== "none" || task.participants.length >= 4) throw new Error("Task cannot accept another worker");
      const matches = (item: TaskAgentChoice) => item.provider === choice.provider && item.profileId === choice.profileId && (item.hostId ?? task.ownerHostId) === (choice.hostId ?? task.ownerHostId);
      if (task.workerPool.filter(matches).length <= task.participants.filter(item => item.role === "worker" && matches(item)).length) throw new Error("Worker provider/profile/host was not authorized by user selection");
      const worker = this.participant(choice, "worker", task.ownerHostId); task.participants.push(worker); this.event(task, "assigned", identity.participantId, "Worker assigned", worker.id); return worker;
    });
  }
  async beginDelivery(identity: TaskIdentity, commandId: string): Promise<TaskAttempt> {
    validateTaskId(commandId);
    return this.update(state => { const task = this.task(state, identity.taskId); const { attempt } = this.authorize(task, identity); if (attempt.delivery === "unknown") throw new Error("Unknown command delivery requires explicit reconciliation"); if (attempt.delivery !== "none" || task.cancellation !== "none") throw new Error("Delivery already attempted or task cancelled"); attempt.delivery = "pending"; attempt.commandId = commandId; return attempt; });
  }
  async resolveDelivery(identity: TaskIdentity, commandId: string, delivery: Extract<TaskDelivery, "delivered" | "rejected" | "unknown">): Promise<void> {
    validateTaskId(commandId); if (!["delivered", "rejected", "unknown"].includes(delivery)) throw new Error("Invalid delivery state");
    await this.update(state => { const attempt = this.authorize(this.task(state, identity.taskId), identity).attempt; if (attempt.commandId !== commandId || !["pending", "unknown"].includes(attempt.delivery)) throw new Error("Command does not match unresolved delivery"); attempt.delivery = delivery; });
  }
  /** A user/lead explicitly starts a new run after observing the prior process stopped. */
  async restartAttempt(identity: TaskIdentity, participantId: string): Promise<TaskAttempt> {
    validateTaskId(participantId);
    return this.update(state => {
      const task = this.task(state, identity.taskId); this.authorize(task, identity, true);
      const member = task.participants.find(item => item.id === participantId); if (!member) throw new Error("Unknown participant");
      if (member.attempt.delivery === "pending" || member.attempt.delivery === "unknown") throw new Error("Uncertain delivery requires explicit reconciliation");
      if (task.cancellation !== "none" || member.attempt.execution !== "exited") throw new Error("Run has not been observed stopped/exited");
      member.previousAttempts.push(member.attempt);
      member.attempt = { id: randomUUID(), generation: member.attempt.generation + 1, execution: "not_started", delivery: "none", commandId: null, submittedResultId: null, observedAt: null };
      return member.attempt;
    });
  }
  async observeExecution(identity: TaskIdentity, execution: TaskExecution): Promise<void> {
    if (!["not_started", "running", "idle", "exited", "lost"].includes(execution)) throw new Error("Invalid execution state");
    await this.update(state => { const attempt = this.authorize(this.task(state, identity.taskId), identity).attempt; attempt.execution = execution; if (execution !== "lost") attempt.observedAt = Date.now(); });
  }
  /** Explicit recovery observation; never resends a command or infers completion. */
  async recover(): Promise<void> {
    await this.update(state => { for (const task of state.tasks) for (const { attempt } of task.participants) { if (attempt.delivery === "pending") attempt.delivery = "unknown"; if (attempt.execution === "running" || attempt.execution === "idle") attempt.execution = "lost"; } });
  }
  async message(identity: TaskIdentity, to: string | null, text: string): Promise<TaskEvent> {
    validateTaskText(text); if (to !== null) validateTaskId(to);
    return this.update(state => { const task = this.task(state, identity.taskId); this.authorize(task, identity); if (to !== null && !task.participants.some(item => item.id === to)) throw new Error("Unknown message recipient"); return this.event(task, "message", identity.participantId, text, to); });
  }
  async receive(identity: TaskIdentity, cursor = 0): Promise<TaskInbox> {
    validateTaskInteger(cursor); const task = await this.inspect(identity.taskId); this.authorize(task, identity);
    const matches = (ref:TaskIdentity) => ref.participantId===identity.participantId && ref.attemptId===identity.attemptId && ref.generation===identity.generation;
    return { events: task.events.filter(event => event.sequence > cursor && (event.recipients ? event.recipients.some(matches) || !!event.source && matches(event.source) : identity.generation===1 && (event.to===null || event.to===identity.participantId || event.from===identity.participantId))), cursor: task.events.length };
  }
  async wait(identity: TaskIdentity, cursor = 0, timeoutMs = 30000, signal?: AbortSignal): Promise<TaskInbox> {
    validateTaskInteger(timeoutMs); if (timeoutMs > 60000) throw new Error("Wait exceeds 60 seconds"); const deadline = Date.now() + timeoutMs;
    while (true) { signal?.throwIfAborted(); const inbox = await this.receive(identity, cursor); if (inbox.events.length || Date.now() >= deadline) return inbox; await delay(Math.min(100, deadline - Date.now()), undefined, { signal }); }
  }
  private attention(task: Task): void { const question = task.questions.find(item => item.answer === null); task.attention = question ? { status: "waiting", eventId: question.id, kind: question.kind, acknowledged: question.acknowledged } : { status: "clear" }; }
  async ask(identity: TaskIdentity, kind: "question" | "approval", text: string): Promise<TaskEvent> {
    validateTaskText(text); if (!["question", "approval"].includes(kind)) throw new Error("Invalid attention kind");
    return this.update(state => { const task = this.task(state, identity.taskId); this.authorize(task, identity); const event = this.event(task, "question", identity.participantId, text); task.questions.push({ id: event.id, participantId: identity.participantId, kind, text, acknowledged: false, answer: null, source: {...identity} }); this.attention(task); return event; });
  }
  /** User action: acknowledge exactly the viewed event; this does not answer it. */
  async acknowledge(taskId: string, eventId: string): Promise<void> {
    validateTaskId(taskId); validateTaskId(eventId);
    await this.update(state => { const task = this.task(state, taskId); const question = task.questions.find(item => item.id === eventId && item.answer === null); if (!question) throw new Error("Waiting event no longer exists"); question.acknowledged = true; this.attention(task); });
  }
  async answer(identity: TaskIdentity, eventId: string, text: string): Promise<void> {
    validateTaskText(text); validateTaskId(eventId);
    await this.update(state => { const task = this.task(state, identity.taskId); this.authorize(task, identity, true); const question = task.questions.find(item => item.id === eventId && item.answer === null); if (!question) throw new Error("Waiting event no longer exists"); if(question.kind === "approval") throw new Error("Approval requires the user"); if (!question.source) throw new Error("Question execution is unknown; inspect historical records before answering"); question.answer = text; this.event(task, "answer", identity.participantId, text, question.participantId, [question.source]); this.attention(task); });
  }
  async answerAsUser(taskId: string, eventId: string, text: string): Promise<void> {
    validateTaskId(taskId);validateTaskId(eventId);validateTaskText(text);
    await this.update(state=>{const task=this.task(state,taskId),question=task.questions.find(item=>item.id===eventId&&item.answer===null);if(!question)throw new Error("Waiting event no longer exists");if(!question.source)throw new Error("Question execution is unknown; inspect historical records before answering");question.answer=text;this.event(task,"answer","user",text,question.participantId,[question.source]);this.attention(task);});
  }
  async messageAsUser(taskId:string,text:string):Promise<void>{
    validateTaskId(taskId);validateTaskText(text);await this.update(state=>{this.event(this.task(state,taskId),"message","user",text);});
  }
  async cancelAsUser(taskId:string):Promise<void>{
    validateTaskId(taskId);await this.update(state=>{const task=this.task(state,taskId);if(task.cancellation==="none"){task.cancellation="requested";this.event(task,"cancellation","user","Cancellation requested by user");}});
  }
  async cancel(identity: TaskIdentity): Promise<void> {
    await this.update(state => { const task = this.task(state, identity.taskId); this.authorize(task, identity, true); if (task.cancellation === "none") { task.cancellation = "requested"; this.event(task, "cancellation", identity.participantId, "Cancellation requested"); } });
  }
  private resultId(identity: TaskIdentity): string { return createHash("sha256").update(JSON.stringify([identity.taskId, identity.participantId, identity.attemptId, identity.generation])).digest("hex"); }
  private submit(task: Task, identity: TaskIdentity, input: TaskResultInput): TaskResult {
    const member = this.authorize(task, identity); const id = this.resultId(identity); const existing = task.results.find(item => item.id === id);
    if (existing) { for (const key of ["summary", "changes", "verification", "artifacts", "issues"] as const) if (JSON.stringify(existing[key]) !== JSON.stringify(input[key])) throw new Error("Conflicting result for attempt"); return existing; }
    const result: TaskResult = { ...input, id, source: identity, submittedAt: Date.now(), integration: "unintegrated", review: "pending" }; task.results.push(result); task.review = "pending"; member.attempt.submittedResultId = id; this.event(task, "result", identity.participantId, input.summary); return result;
  }
  async submitResult(identity: TaskIdentity, input: TaskResultInput): Promise<TaskResult> { validateTaskResult(input); return this.update(state => this.submit(this.task(state, identity.taskId), identity, input)); }
  async acknowledgeResult(taskId: string, resultId: string): Promise<void> {
    validateTaskId(taskId); validateTaskId(resultId);
    await this.update(state => { const task = this.task(state, taskId); const result = task.results.find(item => item.id === resultId); if (!result) throw new Error("Unknown result"); result.review = "acknowledged"; task.review = task.results.some(item => item.review === "pending") ? "pending" : "acknowledged"; });
  }
  async queueRemoteResult(ownerHostId: string, identity: TaskIdentity, result: TaskResultInput): Promise<RemoteTaskResult> {
    validateTaskId(ownerHostId); validateTaskIdentity(identity); validateTaskResult(result); if (identity.hostId !== this.options.hostId || ownerHostId === this.options.hostId) throw new Error("Invalid outbox host scope");
    return this.update(state => { const envelope = { id: this.resultId(identity), ownerHostId, source: identity, result }; const existing = state.outbox.find(item => item.id === envelope.id); if (existing && JSON.stringify(existing) !== JSON.stringify(envelope)) throw new Error("Conflicting outbox result"); if (!existing) state.outbox.push(envelope); return existing ?? envelope; });
  }
  async ingestRemoteResult(input: RemoteTaskResult, authenticatedHostId: string): Promise<TaskResult> {
    validateRemoteResult(input); validateTaskId(authenticatedHostId); if (input.ownerHostId !== this.options.hostId || input.source.hostId !== authenticatedHostId || input.id !== this.resultId(input.source)) throw new Error("Unauthorized remote result");
    return this.submitResult(input.source, input.result);
  }
  /** Sender removes only after receiver has committed and acknowledged; failed sends stay queued. */
  async flushOutbox(deliver: (envelope: RemoteTaskResult) => Promise<void>): Promise<void> {
    const failures: Error[] = [];
    for (const envelope of (await this.snapshot()).outbox) {
      try { await deliver(structuredClone(envelope)); await this.update(state => { state.outbox = state.outbox.filter(item => item.id !== envelope.id); }); }
      catch (error) { failures.push(error instanceof Error ? error : new Error(String(error))); }
    }
    if (failures.length) throw new AggregateError(failures, `Remote result delivery failed: ${failures.map(error => error.message).join("; ")}`);
  }
  /** Identity is scoped to a participant's current run; suitable for trusted gateway binding. */
  async bind(ref: AttemptRef): Promise<TaskIdentity> {
    const task = await this.inspect(ref.taskId); const participant = task.participants.find(item => item.id === ref.participantId); if (!participant) throw new Error("Unknown participant"); const identity: TaskIdentity = { ...ref, hostId: participant.hostId, role: participant.role }; this.authorize(task, identity); return identity;
  }
}
