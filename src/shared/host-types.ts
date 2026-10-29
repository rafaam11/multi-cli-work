/** v2 durable collaboration. These records never imply terminal process survival. */
export type TaskProvider = "claude" | "codex";
export type TaskRole = "lead" | "worker";
export interface TaskAgentChoice { provider: TaskProvider; profileId: string; hostId?: string }
export interface TaskCreateInput { title: string; brief: string; projectId?: string; lead: TaskAgentChoice & { hostId: string }; workers?: TaskAgentChoice[]; workerPool?: TaskAgentChoice[] }
export interface AttemptRef { taskId: string; participantId: string; attemptId: string; generation: number }
/** Authenticated transport binds this identity; clients cannot choose their own scope. */
export interface TaskIdentity extends AttemptRef { hostId: string; role: TaskRole }
export type TaskExecution = "not_started" | "running" | "idle" | "exited" | "lost";
export type TaskDelivery = "none" | "pending" | "delivered" | "unknown" | "rejected";
export interface TaskAttempt { id: string; generation: number; execution: TaskExecution; delivery: TaskDelivery; commandId: string | null; submittedResultId: string | null; observedAt: number | null }
export interface TaskParticipant { id: string; role: TaskRole; provider: TaskProvider; profileId: string; hostId: string; attempt: TaskAttempt; previousAttempts: TaskAttempt[] }
export interface TaskResultInput { summary: string; changes: string[]; verification: string[]; artifacts: string[]; issues: string[] }
export interface TaskResult extends TaskResultInput { id: string; source: TaskIdentity; submittedAt: number; integration: "unintegrated"; review: "pending" | "acknowledged" }
export interface TaskEvent { id: string; sequence: number; kind: "message" | "question" | "answer" | "result" | "cancellation" | "assigned"; from: string; to: string | null; text: string; at: number; source?:TaskIdentity; recipients?:TaskIdentity[] }
export interface TaskQuestion { id: string; participantId: string; kind: "question" | "approval"; text: string; acknowledged: boolean; answer: string | null; source?:TaskIdentity }
export type TaskAttention = { status: "clear" } | { status: "waiting"; eventId: string; kind: "question" | "approval"; acknowledged: boolean };
export interface Task { id: string; ownerHostId: string; title: string; brief: string; projectId?: string; workerPool: TaskAgentChoice[]; createdAt: number; participants: TaskParticipant[]; events: TaskEvent[]; questions: TaskQuestion[]; attention: TaskAttention; results: TaskResult[]; review: "none" | "pending" | "acknowledged"; cancellation: "none" | "requested" }
export interface RemoteTaskResult { id: string; ownerHostId: string; source: TaskIdentity; result: TaskResultInput }
export interface TaskHostSnapshot { schemaVersion: 2; hostId: string; tasks: Task[]; outbox: RemoteTaskResult[] }
export interface TaskInbox { events: TaskEvent[]; cursor: number }
