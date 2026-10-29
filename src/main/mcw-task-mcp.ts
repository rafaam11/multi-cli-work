import type { TaskIdentity } from "../shared/host-types";
import { TaskStore } from "./host/task-store";
import { validateTaskChoice, validateTaskResult } from "./host/task-validation";

type RecordValue = Record<string, unknown>;
export interface TaskMcpResponse { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } }
function record(value: unknown): RecordValue { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object"); return value as RecordValue; }
function fields(value: unknown, allowed: string[], required: string[] = []): RecordValue {
  const args = record(value);
  if (Object.keys(args).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(args, key))) throw new Error("Invalid operation arguments");
  return args;
}
function requestParams(value:unknown,allowed:string[],required:string[]=[]):RecordValue {
  const params=fields(value,[...allowed,"_meta"],required);
  // MCP clients may attach progress/extension metadata. It is transport data,
  // never task identity and never forwarded into the operation's arguments.
  if(params._meta!==undefined)record(params._meta);
  return params;
}
const stringSchema = { type: "string", minLength: 1, maxLength: 20000 };
const arraySchema = { type: "array", items: stringSchema, maxItems: 1000 };
function tool(name: string, description: string, properties: RecordValue, required: string[] = [], readOnly=false) {
  // These tools access only the authenticated task store. Mutation tools append
  // task data/requests; none executes commands, edits a checkout or kills work.
  return { name, description, inputSchema: { type: "object", properties, required, additionalProperties: false },annotations:{readOnlyHint:readOnly,destructiveHint:false,idempotentHint:readOnly,openWorldHint:false} };
}
export const TASK_MCP_TOOLS = [
  tool("task_inspect", "Inspect this task, participants, questions, messages and unintegrated results.", {},[],true),
  tool("task_assign", "Lead assigns a worker using the user-selected provider and profile. At most three workers.", { provider: { enum: ["claude", "codex"] }, profileId: stringSchema, hostId: stringSchema }, ["provider", "profileId"]),
  tool("task_message", "Durably message another participant or broadcast; ask a question/approval or answer a viewed event.", { kind: { enum: ["message", "question", "approval", "answer"] }, to: { anyOf: [stringSchema, { type: "null" }] }, text: stringSchema, eventId: stringSchema }, ["text"]),
  tool("task_wait", "Receive events after a cursor, waiting for a message, question, result or cancellation.", { cursor: { type: "integer", minimum: 0 }, timeoutMs: { type: "integer", minimum: 0, maximum: 60000 } },[],true),
  tool("task_submit", "Submit evidence for user review; does not integrate code or declare terminal idle complete.", { summary: stringSchema, changes: arraySchema, verification: arraySchema, artifacts: arraySchema, issues: arraySchema }, ["summary", "changes", "verification", "artifacts", "issues"]),
  tool("task_cancel", "Lead requests cancellation. This never kills a process.", {}),
];

/** Transport authenticates and binds identity once. No operation accepts client task/role/generation overrides. */
export class TaskMcpServer {
  private readonly identity: TaskIdentity;
  constructor(private readonly store: TaskStore, identity: TaskIdentity) { this.identity = structuredClone(identity); }
  async dispatch(name: string, input: unknown = {}): Promise<unknown> {
    // Revalidate current run even on inspect so a superseded capability loses all task access.
    await this.store.receive(this.identity, 0);
    switch (name) {
      case "task_inspect": fields(input, []); return this.store.inspect(this.identity.taskId);
      case "task_assign": return this.store.assign(this.identity, validateTaskChoice(input));
      case "task_message": {
        const args = fields(input, ["kind", "to", "text", "eventId"], ["text"]);
        const kind = args.kind === undefined ? "message" : args.kind;
        if (kind === "message") { if (args.eventId !== undefined) throw new Error("Message cannot answer an event"); return this.store.message(this.identity, (args.to ?? null) as string | null, args.text as string); }
        if (kind === "question" || kind === "approval") { if (args.to !== undefined || args.eventId !== undefined) throw new Error("Question is broadcast to the task"); return this.store.ask(this.identity, kind, args.text as string); }
        if (kind === "answer") { if (args.to !== undefined || args.eventId === undefined) throw new Error("Answer requires the exact question eventId"); await this.store.answer(this.identity, args.eventId as string, args.text as string); return { answered: args.eventId }; }
        throw new Error("Invalid message kind");
      }
      case "task_wait": { const args = fields(input, ["cursor", "timeoutMs"]); return this.store.wait(this.identity, args.cursor === undefined ? 0 : args.cursor as number, args.timeoutMs === undefined ? 30000 : args.timeoutMs as number); }
      case "task_submit": return this.store.submitResult(this.identity, validateTaskResult(input));
      case "task_cancel": fields(input, []); await this.store.cancel(this.identity); return { cancellation: "requested" };
      default: throw new Error("Unknown task tool");
    }
  }
  async handle(input: unknown): Promise<TaskMcpResponse | null> {
    let request: RecordValue;
    try { request = fields(input, ["jsonrpc", "id", "method", "params"], ["jsonrpc", "method"]); if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || (request.id !== undefined && request.id !== null && typeof request.id !== "string" && !(typeof request.id === "number" && Number.isSafeInteger(request.id)))) throw new Error("Invalid JSON-RPC request"); }
    catch { return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } }; }
    const id = request.id as string | number | null | undefined;
    if (id === undefined) return null;
    const response = (result: unknown): TaskMcpResponse => ({ jsonrpc: "2.0", id, result });
    try {
      if (request.method === "initialize") {
        const params = record(request.params); const supported = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
        return response({ protocolVersion: supported.includes(params.protocolVersion as string) ? params.protocolVersion : "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mcw-task", version: "2" } });
      }
      if (request.method === "ping") return response({});
      if (request.method === "tools/list") { if (request.params !== undefined) requestParams(request.params, []); return response({ tools: TASK_MCP_TOOLS }); }
      if (request.method === "tools/call") {
        const params = requestParams(request.params, ["name", "arguments"], ["name"]); if (typeof params.name !== "string") throw new Error("Tool name required");
        try { const value = await this.dispatch(params.name, params.arguments === undefined ? {} : params.arguments); return response({ content: [{ type: "text", text: JSON.stringify(value) }], isError: false }); }
        catch (error) { return response({ content: [{ type: "text", text: (error as Error).message }], isError: true }); }
      }
      return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
    } catch { return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params" } }; }
  }
}
