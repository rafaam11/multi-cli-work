import type { TaskAgentChoice, TaskCreateInput, TaskHostSnapshot, TaskIdentity, TaskResultInput, RemoteTaskResult, TaskAttempt } from "../../shared/host-types";

type Check = (value: unknown) => void;
export class TaskValidationError extends Error {}
function fail(): never { throw new TaskValidationError("Invalid task data"); }
const text = (max = 20000): Check => value => { if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) fail(); };
const id = text(200);
const integer: Check = value => { if (!Number.isSafeInteger(value) || (value as number) < 0) fail(); };
const bool: Check = value => { if (typeof value !== "boolean") fail(); };
const one = (...choices: unknown[]): Check => value => { if (!choices.includes(value)) fail(); };
const nullable = (check: Check): Check => value => { if (value !== null) check(value); };
const array = (check: Check, max = 100000): Check => value => { if (!Array.isArray(value) || value.length > max) fail(); value.forEach(check); };
function object(fields: Record<string, Check>, optional: string[] = []): Check {
  return value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail();
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some(key => !Object.hasOwn(fields, key))) fail();
    for (const [key, check] of Object.entries(fields)) { if (record[key] === undefined && optional.includes(key)) continue; check(record[key]); }
  };
}
const choice = object({ provider: one("claude", "codex"), profileId: id, hostId: id }, ["hostId"]);
const identity = object({ taskId: id, participantId: id, attemptId: id, generation: integer, hostId: id, role: one("lead", "worker") });
const sameIdentity = (left:TaskIdentity|undefined,right:TaskIdentity|undefined) => left===undefined || right===undefined ? left===right :
  left.taskId===right.taskId && left.participantId===right.participantId && left.attemptId===right.attemptId && left.generation===right.generation && left.hostId===right.hostId && left.role===right.role;
const result = object({ summary: text(), changes: array(text(), 1000), verification: array(text(), 1000), artifacts: array(text(), 1000), issues: array(text(), 1000) });
const attempt = object({ id, generation: integer, execution: one("not_started", "running", "idle", "exited", "lost"), delivery: one("none", "pending", "delivered", "unknown", "rejected"), commandId: nullable(id), submittedResultId: nullable(id), observedAt: nullable(integer) });
const participant = object({ id, role: one("lead", "worker"), provider: one("claude", "codex"), profileId: id, hostId: id, attempt, previousAttempts: array(attempt, 10000) });
const event = object({ id, sequence: integer, kind: one("message", "question", "answer", "result", "cancellation", "assigned"), from: id, to: nullable(id), text: text(), at: integer, source:identity, recipients:array(identity,4) },["source","recipients"]);
const question = object({ id, participantId: id, kind: one("question", "approval"), text: text(), acknowledged: bool, answer: nullable(text()), source:identity },["source"]);
const attention: Check = value => { if ((value as { status?: string })?.status === "clear") object({ status: one("clear") })(value); else object({ status: one("waiting"), eventId: id, kind: one("question", "approval"), acknowledged: bool })(value); };
const storedResult: Check = value => { const item = value as Record<string, unknown>; if (!item || typeof item !== "object") fail(); const { id: resultId, source, submittedAt, integration, review, ...evidence } = item; id(resultId); identity(source); integer(submittedAt); one("unintegrated")(integration); one("pending", "acknowledged")(review); result(evidence); };
const task = object({ id, ownerHostId: id, title: text(1000), brief: text(100000), projectId: id, workerPool: array(choice, 3), createdAt: integer, participants: array(participant, 4), events: array(event), questions: array(question), attention, results: array(storedResult), review: one("none", "pending", "acknowledged"), cancellation: one("none", "requested") }, ["projectId"]);
const envelope = object({ id, ownerHostId: id, source: identity, result });
export function validateTaskIdentity(value: unknown): TaskIdentity { identity(value); return value as TaskIdentity; }
export function validateTaskAttempt(value:unknown):TaskAttempt {attempt(value);const parsed=value as TaskAttempt;if(parsed.generation<1||(parsed.delivery==="none")!==(parsed.commandId===null))fail();return parsed;}
export function validateTaskResult(value: unknown): TaskResultInput { result(value); return value as TaskResultInput; }
export function validateTaskChoice(value: unknown): TaskAgentChoice { choice(value); return value as TaskAgentChoice; }
export function validateTaskCreate(value: unknown): TaskCreateInput { object({ title: text(1000), brief: text(100000), projectId: id, lead: choice, workers: array(choice, 3), workerPool: array(choice, 3) }, ["workers", "projectId", "workerPool"])(value); const input = value as TaskCreateInput; id(input.lead.hostId); return input; }
export function validateRemoteResult(value: unknown): RemoteTaskResult { envelope(value); return value as RemoteTaskResult; }
export function validateTaskSnapshot(value: unknown): TaskHostSnapshot {
  object({ schemaVersion: one(2), hostId: id, tasks: array(task), outbox: array(envelope) })(value);
  const snapshot = value as TaskHostSnapshot;
  const taskIds = new Set<string>();
  for (const entry of snapshot.tasks) {
    if (entry.ownerHostId !== snapshot.hostId || taskIds.has(entry.id) || entry.participants.filter(item => item.role === "lead").length !== 1 || entry.participants.length === 0) fail();
    taskIds.add(entry.id);
    if (new Set(entry.participants.map(item => item.id)).size !== entry.participants.length) fail();
    if (entry.participants.find(item => item.role === "lead")?.hostId !== snapshot.hostId) fail();
    const slots = entry.workerPool.map(item => JSON.stringify([item.provider, item.profileId, item.hostId ?? entry.ownerHostId]));
    for (const member of entry.participants.filter(item => item.role === "worker")) {
      const slot = slots.indexOf(JSON.stringify([member.provider, member.profileId, member.hostId])); if (slot < 0) fail(); slots.splice(slot, 1);
    }
    const eventIds = new Set<string>();
    const knownScope = (scope:TaskIdentity) => {
      const member=entry.participants.find(item=>item.id===scope.participantId);
      return scope.taskId===entry.id && member && member.role===scope.role && member.hostId===scope.hostId && [...member.previousAttempts,member.attempt].some(attempt=>attempt.id===scope.attemptId && attempt.generation===scope.generation);
    };
    for (const [index, event] of entry.events.entries()) {
      if (event.sequence !== index + 1 || eventIds.has(event.id) || (event.from !== "user" && !entry.participants.some(item => item.id === event.from)) || (event.to !== null && !entry.participants.some(item => item.id === event.to))) fail();
      eventIds.add(event.id);
      if(event.source && (!knownScope(event.source) || event.source.participantId!==event.from))fail();
      if(event.recipients?.some(scope=>!knownScope(scope) || event.to!==null && event.to!==scope.participantId))fail();
    }
    for (const member of entry.participants) {
      const attempts = [...member.previousAttempts, member.attempt];
      if (new Set(attempts.map(item => item.id)).size !== attempts.length) fail();
      for (const [index, attempt] of attempts.entries()) {
        if (attempt.generation !== index + 1 || (attempt.delivery === "none") !== (attempt.commandId === null)) fail();
        if (attempt.submittedResultId !== null && !entry.results.some(result => result.id === attempt.submittedResultId && result.source.attemptId === attempt.id)) fail();
      }
    }
    if (new Set(entry.results.map(item => item.id)).size !== entry.results.length || new Set(entry.questions.map(item => item.id)).size !== entry.questions.length) fail();
    for (const result of entry.results) {
      const member = entry.participants.find(item => item.id === result.source.participantId);
      if (!member || result.source.taskId !== entry.id || result.source.role !== member.role || result.source.hostId !== member.hostId || ![...member.previousAttempts, member.attempt].some(attempt => attempt.id === result.source.attemptId && attempt.generation === result.source.generation && attempt.submittedResultId === result.id)) fail();
    }
    for (const question of entry.questions) {
      if (!entry.events.some(event => event.id === question.id && event.kind === "question" && event.from === question.participantId && sameIdentity(event.source,question.source))) fail();
      if(question.source && (!knownScope(question.source) || question.source.participantId!==question.participantId))fail();
    }
    const waiting = entry.questions.find(item => item.answer === null);
    if (waiting ? entry.attention.status !== "waiting" || entry.attention.eventId !== waiting.id || entry.attention.kind !== waiting.kind || entry.attention.acknowledged !== waiting.acknowledged : entry.attention.status !== "clear") fail();
    if (entry.review !== (entry.results.length === 0 ? "none" : entry.results.some(item => item.review === "pending") ? "pending" : "acknowledged")) fail();
  }
  if (new Set(snapshot.outbox.map(item => item.id)).size !== snapshot.outbox.length || snapshot.outbox.some(item => item.source.hostId !== snapshot.hostId || item.ownerHostId === snapshot.hostId || item.source.generation < 1)) fail();
  return snapshot;
}
export function validateTaskText(value: unknown, max = 20000): asserts value is string { text(max)(value); }
export function validateTaskId(value: unknown): asserts value is string { id(value); }
export function validateTaskInteger(value: unknown): asserts value is number { integer(value); }
