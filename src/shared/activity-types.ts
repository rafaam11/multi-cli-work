export interface ProviderActivity {
  id: string;
  sessionId: string;
  generation: string;
  provider: "claude" | "codex";
  event: string;
  at: string;
  toolName?: string;
  toolCallId?: string;
  agentId?: string;
  agentType?: string;
  model?: string;
  taskId?: string;
  taskSubject?: string;
}
