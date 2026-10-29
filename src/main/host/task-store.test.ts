// @vitest-environment node
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { TaskStore } from "./task-store";
import type { Task, TaskIdentity } from "../../shared/host-types";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function store(hostId = "pc-a") { const directory = await mkdtemp(path.join(os.tmpdir(), "mcw-tasks-")); directories.push(directory); return new TaskStore({ directory, hostId }); }
const input = { title: "Implement toolbar", brief: "Keep changes for review", lead: { provider: "codex" as const, profileId: "careful", hostId: "pc-a" } };
function identity(task: Task, index = 0): TaskIdentity { const member = task.participants[index]; return { taskId: task.id, participantId: member.id, attemptId: member.attempt.id, generation: member.attempt.generation, hostId: member.hostId, role: member.role }; }
const evidence = { summary: "Implemented", changes: ["toolbar"], verification: ["unit tests passed"], artifacts: ["commit:abc"], issues: [] };
it("compares question identities by fields independent of JSON key order",async()=>{
  const first=await store(),task=await first.createTask(input),lead=identity(task);
  const reordered={role:lead.role,hostId:lead.hostId,generation:lead.generation,attemptId:lead.attemptId,participantId:lead.participantId,taskId:lead.taskId};
  const question=await first.ask(reordered,"question","Which repository?");
  expect((await new TaskStore(first.options).inspect(task.id)).questions[0].id).toBe(question.id);
});
it("keeps an unscoped historical question unanswered instead of claiming an undelivered answer",async()=>{
  const first=await store(),task=await first.createTask(input),lead=identity(task);
  const question=await first.ask(lead,"question","Historical question");
  const snapshot=await first.snapshot();delete snapshot.tasks[0].questions[0].source;delete snapshot.tasks[0].events[0].source;
  await writeFile(first.filePath,JSON.stringify(snapshot));
  await expect(first.answerAsUser(task.id,question.id,"Do this")).rejects.toThrow(/execution.*unknown/i);
  expect((await first.inspect(task.id)).questions[0].answer).toBeNull();
});
it("binds messages and questions to attempts so a later run never receives an old command", async () => {
  const first=await store(),task=await first.createTask({...input,workers:[{provider:"claude",profileId:"p"}]}),lead=identity(task),worker=identity(task,1);
  const old=await first.message(lead,worker.participantId,"Old instruction");
  const question=await first.ask(worker,"approval","Old approval");
  expect(old).toMatchObject({source:lead,recipients:[worker]});
  expect((await first.inspect(task.id)).questions[0]).toMatchObject({source:worker});
  await first.observeExecution(worker,"exited");await first.restartAttempt(lead,worker.participantId);
  const next=identity(await first.inspect(task.id),1);
  await first.answerAsUser(task.id,question.id,"Answer for prior run");
  expect((await first.receive(next,0)).events).toEqual([]);
  await first.message(lead,next.participantId,"New instruction");
  expect((await first.receive(next,0)).events.map(event=>event.text)).toEqual(["New instruction"]);
  expect((await first.inspect(task.id)).events.find(event=>event.id===old.id)?.source).toEqual(lead);
});
it("reserves approval answers for the user, while allowing lead answers to ordinary team questions", async () => {
  const first=await store(),task=await first.createTask(input),lead=identity(task);
  const approval=await first.ask(lead,"approval","Integrate changes?");
  await expect(first.answer(lead,approval.id,"yes")).rejects.toThrow(/user/i);
  expect((await first.inspect(task.id)).attention.status).toBe("waiting");
  await first.answerAsUser(task.id,approval.id,"Keep unintegrated");
  expect((await first.inspect(task.id)).questions[0].answer).toBe("Keep unintegrated");
  const question=await first.ask(lead,"question","Which file?");
  await first.answer(lead,question.id,"source.ts");
});

it("durably creates a fresh lead per task, defaults worker host and caps selected workers", async () => {
  const first = await store(); const task = await first.createTask({ ...input, projectId: "project-toolbar", workers: [{ provider: "claude", profileId: "review" }] });
  const next = await first.createTask(input);
  expect(next.participants[0].id).not.toBe(task.participants[0].id);
  expect(task.participants[1]).toMatchObject({ hostId: "pc-a", role: "worker", provider: "claude", profileId: "review" });
  expect((await new TaskStore(first.options).inspect(task.id)).ownerHostId).toBe("pc-a");
  expect((await new TaskStore(first.options).inspect(task.id)).projectId).toBe("project-toolbar");
  await expect(first.createTask({ ...input, workers: Array.from({ length: 4 }, () => ({ provider: "codex", profileId: "p" })) })).rejects.toThrow();
});

it("keeps idle, delivery uncertainty, questions, result submission and user review separate across restart", async () => {
  const first = await store(); const task = await first.createTask(input); const lead = identity(task);
  await first.beginDelivery(lead, "launch-1");
  await first.observeExecution(lead, "idle");
  expect((await first.inspect(task.id)).participants[0].attempt).toMatchObject({ execution: "idle", submittedResultId: null });
  const reopened = new TaskStore(first.options);
  await reopened.recover();
  expect((await reopened.inspect(task.id)).participants[0].attempt).toMatchObject({ execution: "lost", delivery: "unknown", submittedResultId: null });
  await expect(reopened.beginDelivery(lead, "launch-2")).rejects.toThrow(/unknown|uncertain/i);
  const question = await reopened.ask(lead, "approval", "May I change API?");
  await reopened.acknowledge(task.id, question.id);
  expect((await reopened.inspect(task.id)).attention).toMatchObject({ status: "waiting", eventId: question.id, acknowledged: true });
  await reopened.answerAsUser(task.id, question.id, "Approved");
  await reopened.resolveDelivery(lead, "launch-1", "delivered");
  await reopened.submitResult(lead, evidence);
  expect(await reopened.inspect(task.id)).toMatchObject({ review: "pending", attention: { status: "clear" }, results: [{ ...evidence, integration: "unintegrated" }] });
});

it("serializes independent writers without dropping messages and wakes waiting peers", async () => {
  const first = await store(); const task = await first.createTask({ ...input, workers: [{ provider: "claude", profileId: "p" }, { provider: "codex", profileId: "q" }] });
  const peer = new TaskStore(first.options); const worker = identity(task, 1); const other = identity(task, 2);
  const waiting = first.wait(other, 0, 2000);
  await Promise.all(Array.from({ length: 8 }, (_, index) => peer.message(worker, other.participantId, `message ${index}`)));
  expect((await waiting).events.some(event => event.kind === "message")).toBe(true);
  expect((await first.receive(other, 0)).events.filter(event => event.kind === "message")).toHaveLength(8);
});

it("rejects stale generations, forged roles, cross task addresses and cancellation without killing execution", async () => {
  const first = await store(); const task = await first.createTask({ ...input, workers: [{ provider: "claude", profileId: "p" }] });
  const lead = identity(task); const worker = identity(task, 1); const foreign = await first.createTask(input);
  await expect(first.message(worker, foreign.participants[0].id, "escape")).rejects.toThrow();
  await expect(first.cancel({ ...worker, role: "lead" })).rejects.toThrow();
  await first.observeExecution(worker, "running"); await first.cancel(lead);
  expect((await first.inspect(task.id))).toMatchObject({ cancellation: "requested", participants: [{}, { attempt: { execution: "running" } }] });
  await expect(first.submitResult({ ...worker, generation: 99 }, evidence)).rejects.toThrow();
});

it("persists remote result outbox across failure and deduplicates delivery without reexecuting work", async () => {
  const owner = await store(); const task = await owner.createTask({ ...input, workers: [{ provider: "claude", profileId: "p", hostId: "pc-b" }] }); const worker = identity(task, 1);
  const remote = await store("pc-b"); const envelope = await remote.queueRemoteResult("pc-a", worker, evidence);
  await expect(remote.flushOutbox(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  const reopened = new TaskStore(remote.options); expect((await reopened.snapshot()).outbox).toHaveLength(1);
  await reopened.flushOutbox(async item => { await owner.ingestRemoteResult(item, "pc-b"); });
  await owner.ingestRemoteResult(envelope, "pc-b");
  expect((await owner.inspect(task.id)).results).toHaveLength(1);
  expect((await reopened.snapshot()).outbox).toHaveLength(0);
  expect((await owner.inspect(task.id)).participants[1].attempt.execution).toBe("not_started");
  await expect(owner.ingestRemoteResult(envelope, "pc-c")).rejects.toThrow();
});

it("preserves a corrupt primary and rejects invalid runtime values", async () => {
  const first = await store(); const task = await first.createTask(input);
  await expect(first.createTask({ ...input, lead: { ...input.lead, provider: "shell" } } as never)).rejects.toThrow();
  await writeFile(first.filePath, "corrupt");
  await expect(first.message(identity(task), null, "must not overwrite")).rejects.toThrow();
  expect(await readFile(first.filePath, "utf8")).toBe("corrupt");
});

it("requires explicit delivery reconciliation before replacing a lost run and revokes superseded identities", async () => {
  const first = await store(); const task = await first.createTask({ ...input, workers: [{ provider: "claude", profileId: "p" }] });
  const lead = identity(task); const worker = identity(task, 1);
  await first.beginDelivery(worker, "command"); await first.observeExecution(worker, "running"); await first.recover();
  const observedAt = (await first.inspect(task.id)).participants[1].attempt.observedAt;
  await expect(first.restartAttempt(lead, worker.participantId)).rejects.toThrow(/delivery/i);
  await first.resolveDelivery(worker, "command", "delivered");
  await expect(first.restartAttempt(lead, worker.participantId)).rejects.toThrow(/stopped|exited/i);
  await first.observeExecution(worker, "exited");
  await first.restartAttempt(lead, worker.participantId);
  const after = await first.inspect(task.id);
  expect(after.participants[1]).toMatchObject({ attempt: { generation: 2, execution: "not_started", delivery: "none" }, previousAttempts: [{ generation: 1, execution: "exited" }] });
  expect(after.participants[1].previousAttempts[0].observedAt).toBeGreaterThanOrEqual(observedAt!);
  await expect(first.message(worker, null, "late old run")).rejects.toThrow();
  await expect(first.submitResult(worker, evidence)).rejects.toThrow();
});

it("retains outbox after receiver commit with lost acknowledgement and reconciles exactly once", async () => {
  const owner = await store(); const task = await owner.createTask({ ...input, workers: [{ provider: "claude", profileId: "p", hostId: "pc-b" }] });
  const remote = await store("pc-b"); await remote.queueRemoteResult("pc-a", identity(task, 1), evidence);
  await expect(remote.flushOutbox(async envelope => { await owner.ingestRemoteResult(envelope, "pc-b"); throw new Error("ack lost"); })).rejects.toThrow("ack lost");
  expect((await remote.snapshot()).outbox).toHaveLength(1);
  await remote.flushOutbox(async envelope => { await owner.ingestRemoteResult(envelope, "pc-b"); });
  expect((await owner.inspect(task.id)).events.filter(event => event.kind === "result")).toHaveLength(1);
  expect((await remote.snapshot()).outbox).toHaveLength(0);
});

it("acknowledges only the viewed question and does not clear a second waiting event", async () => {
  const first = await store(); const task = await first.createTask(input); const lead = identity(task);
  const firstQuestion = await first.ask(lead, "question", "First?"); const secondQuestion = await first.ask(lead, "approval", "Second?");
  await first.acknowledge(task.id, firstQuestion.id); await first.answer(lead, firstQuestion.id, "yes");
  expect((await first.inspect(task.id)).attention).toMatchObject({ eventId: secondQuestion.id, acknowledged: false });
  await expect(first.acknowledge(task.id, firstQuestion.id)).rejects.toThrow();
});

it("rejects valid JSON with invalid task invariants without modifying it", async () => {
  const first = await store(); await first.createTask(input);
  const snapshot = await first.snapshot(); snapshot.tasks[0].participants[0].attempt.generation = 0;
  const invalid = JSON.stringify(snapshot); await writeFile(first.filePath, invalid);
  await expect(first.createTask(input)).rejects.toThrow();
  expect(await readFile(first.filePath, "utf8")).toBe(invalid);
});

it("assigns only unused worker slots explicitly selected by the user including host scope", async () => {
  const first = await store(); const task = await first.createTask({ ...input, workerPool: [{ provider: "claude", profileId: "chosen" }, { provider: "codex", profileId: "remote", hostId: "pc-b" }] }); const lead = identity(task);
  await expect(first.assign(lead, { provider: "codex", profileId: "unselected" })).rejects.toThrow(/authoriz|select/i);
  await expect(first.assign(lead, { provider: "claude", profileId: "chosen", hostId: "pc-b" })).rejects.toThrow(/authoriz|select/i);
  const assigned = await first.assign(lead, { provider: "claude", profileId: "chosen" });
  expect(assigned.hostId).toBe("pc-a");
  await expect(first.assign(lead, { provider: "claude", profileId: "chosen" })).rejects.toThrow(/authoriz|select/i);
  await first.assign(lead, { provider: "codex", profileId: "remote", hostId: "pc-b" });
  expect((await first.inspect(task.id)).participants).toHaveLength(3);
  await expect(first.createTask({ ...input, workers: [{ provider: "claude", profileId: "not-in-pool" }], workerPool: [] })).rejects.toThrow();
});

it("delivers later independent owner results when an earlier owner is offline", async () => {
  const firstOwner = await store(); const secondOwner = await store("pc-c"); const remote = await store("pc-b");
  const firstTask = await firstOwner.createTask({ ...input, workers: [{ provider: "claude", profileId: "p", hostId: "pc-b" }] });
  const secondTask = await secondOwner.createTask({ ...input, lead: { ...input.lead, hostId: "pc-c" }, workers: [{ provider: "claude", profileId: "p", hostId: "pc-b" }] });
  await remote.queueRemoteResult("pc-a", identity(firstTask, 1), evidence); await remote.queueRemoteResult("pc-c", identity(secondTask, 1), evidence);
  await expect(remote.flushOutbox(async envelope => { if (envelope.ownerHostId === "pc-a") throw new Error("first owner offline"); await secondOwner.ingestRemoteResult(envelope, "pc-b"); })).rejects.toThrow(/offline/);
  expect((await secondOwner.inspect(secondTask.id)).results).toHaveLength(1);
  expect((await remote.snapshot()).outbox).toMatchObject([{ ownerHostId: "pc-a" }]);
});
