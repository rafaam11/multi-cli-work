/**
 * The jk commands, described as MCP tools. Each tool is one control command: its arguments map
 * straight onto the command's, so the MCP server stays a thin translator and the rules (who may send
 * to whom, what is held) stay in `control-commands.ts`.
 *
 * This file is bundled into the stand-alone `jk-mcp.js`, so it imports nothing.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
}

interface ToolSpec extends McpTool {
  command: string;
  /** MCP argument name → control argument name, where they differ. */
  rename?: Record<string, string>;
}

const string = (description: string) => ({ type: "string", description });
const boolean = (description: string) => ({ type: "boolean", description });
const integer = (description: string, minimum: number, maximum: number) => ({ type: "integer", description, minimum, maximum });

const SPECS: ToolSpec[] = [
  {
    name: "jk_list",
    command: "list",
    description: "멀티 터미널 작업기에서 실행 중인 세션 목록(id, kind, status, 폴더, 이름)을 돌려준다. 다른 세션에 보내기 전에 id를 찾을 때 쓴다.",
    inputSchema: { type: "object", properties: { projectId: string("이 폴더(프로젝트) id의 세션만") }, additionalProperties: false },
  },
  {
    name: "jk_send",
    command: "send",
    description:
      "다른 세션의 프롬프트에 텍스트를 넣는다. 대상이 작업 중·승인 대기·사람이 입력 중이면 보류했다가 한가해지면 자동으로 넣고, outcome(delivered/held/failed)을 돌려준다. 받는 쪽에는 '[from 내 이름 (kind)]'이 앞에 붙는다.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: string("받을 세션 id (jk_list로 확인)"),
        text: string("보낼 내용. 여러 줄 가능"),
        now: boolean("대상이 작업 중이어도 바로 넣는다(사람이 입력 중이거나 승인 대기면 여전히 보류)"),
        raw: boolean("보낸 세션 표기를 붙이지 않는다"),
        waitSeconds: integer("전달될 때까지 기다릴 최대 초", 0, 1800),
      },
      required: ["sessionId", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "jk_broadcast",
    command: "broadcast",
    description: "범위 안의 모든 세션(나 제외)에 같은 텍스트를 보낸다. 범위를 안 주면 지금 세션의 폴더다. 보류 규칙은 jk_send와 같다.",
    inputSchema: {
      type: "object",
      properties: {
        text: string("보낼 내용"),
        projectId: string("이 폴더의 세션에게"),
        all: boolean("모든 폴더의 세션에게"),
        agent: string("이 kind(claude, codex, powershell …)의 세션에게만"),
        now: boolean("작업 중이어도 바로"),
      },
      required: ["text"],
      additionalProperties: false,
    },
    rename: { agent: "kind" },
  },
  {
    name: "jk_held",
    command: "held",
    description: "아직 전달되지 않고 보류 중인 메시지를 보여 준다. drop에 메시지 id를 주면 취소한다.",
    inputSchema: {
      type: "object",
      properties: { sessionId: string("이 세션으로 가는 것만"), drop: string("취소할 메시지 id") },
      additionalProperties: false,
    },
  },
  {
    name: "jk_read",
    command: "read",
    description: "세션 화면의 마지막 출력(스크롤백 끝부분)을 읽는다.",
    inputSchema: {
      type: "object",
      properties: { sessionId: string("읽을 세션 id"), lines: integer("마지막 몇 줄", 1, 2000) },
      required: ["sessionId"],
      additionalProperties: false,
    },
  },
  {
    name: "jk_wait",
    command: "wait",
    description: "세션이 지정 상태(기본 awaiting-input — 한 턴을 마침)가 될 때까지 기다린다. 끝나거나 오류가 나도 돌아온다.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: string("기다릴 세션 id"),
        status: { type: "string", enum: ["starting", "working", "awaiting-input", "awaiting-approval", "idle", "exited", "error"] },
        timeoutSeconds: integer("최대 대기 초(기본 120)", 1, 1800),
      },
      required: ["sessionId"],
      additionalProperties: false,
    },
  },
  {
    name: "jk_spawn",
    command: "spawn",
    description: "폴더에 새 세션을 시작한다. prompt를 주면 CLI가 준비된 뒤 첫 프롬프트로 들어간다. 새 세션 id를 돌려준다.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: string("폴더(프로젝트) id"),
        agent: string("claude, codex, powershell 등"),
        worktreeId: string("이 워크트리에서"),
        name: string("패인 이름"),
        prompt: string("첫 프롬프트"),
      },
      required: ["projectId", "agent"],
      additionalProperties: false,
    },
    rename: { agent: "kind" },
  },
  {
    name: "jk_status",
    command: "status",
    description: "패인 머리줄에 상태 칩을 붙이거나(set) 뗀다(clear). 기본 대상은 지금 세션이다.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["set", "clear"] },
        key: string("칩 키(영문·숫자·._-, 24자까지)"),
        text: string("칩 글자(set일 때)"),
        color: { type: "string", enum: ["green", "amber", "red", "blue", "gray"] },
        sessionId: string("다른 세션에 붙일 때"),
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "jk_progress",
    command: "progress",
    description: "패인 머리줄 밑 진행선을 채운다. value(0~100) 또는 state=indeterminate(돌고 있음), clear로 지운다.",
    inputSchema: {
      type: "object",
      properties: {
        value: integer("진행률", 0, 100),
        state: { type: "string", enum: ["normal", "indeterminate", "error", "warning"] },
        clear: boolean("진행선을 지운다"),
        sessionId: string("다른 세션에 붙일 때"),
      },
      additionalProperties: false,
    },
  },
  {
    name: "board_post",
    command: "post",
    description:
      "지금 폴더의 팀 보드에 글을 올린다. 사용자와 다른 세션이 함께 보는 공개 채널이다 — 진행 상황, 결론, 넘겨줄 일을 짧게. to에 세션 id를 주면 그 세션들의 프롬프트에도 넣는다.",
    inputSchema: {
      type: "object",
      properties: {
        text: string("올릴 내용"),
        to: { type: "array", items: { type: "string" }, description: "프롬프트로도 받을 세션 id들" },
        projectId: string("다른 폴더의 보드에 올릴 때"),
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "board_read",
    command: "board",
    description: "지금 폴더의 팀 보드 최근 글을 읽는다(기본 20개). 세션끼리 주고받은 jk_send도 전달 상태와 함께 보인다.",
    inputSchema: {
      type: "object",
      properties: {
        limit: integer("최근 몇 개", 1, 200),
        sinceId: string("이 메시지 이후만"),
        projectId: string("다른 폴더의 보드"),
      },
      additionalProperties: false,
    },
  },
];

export const JK_MCP_TOOLS: McpTool[] = SPECS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

/** The control command a tool call stands for, or null for a tool this server does not have. */
export function controlCallFor(
  tool: string,
  args: Record<string, unknown> | undefined,
): { command: string; args: Record<string, unknown> } | null {
  const spec = SPECS.find((candidate) => candidate.name === tool);
  if (!spec) return null;
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === undefined || value === null) continue;
    mapped[spec.rename?.[key] ?? key] = value;
  }
  return { command: spec.command, args: mapped };
}

export const JK_MCP_INSTRUCTIONS = [
  "이 서버는 멀티 터미널 작업기(Multi CLI Work) 안에서 함께 돌고 있는 다른 CLI 세션과 협업하는 도구다.",
  "다른 세션에 일을 맡기거나 결과를 넘길 때는 jk_list로 id를 찾고 jk_send로 보낸다. 보낸 메시지는 상대가 한가해질 때 들어간다.",
  "사용자와 팀 전체가 봐야 할 진행 상황·결론은 board_post로 팀 보드에 남긴다.",
].join("\n");
