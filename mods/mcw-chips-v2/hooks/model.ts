import type { ChipsAgent, ChipsBg, ChipsBgKind, ChipsDone, ChipsModel, ChipsTest, ChipsTestResult } from '../types'
import type { TestSummary } from './parse-tests'

// 엔진 이벤트 → ChipsModel. 모두 순수 함수(제자리 갱신)이고 IO·시계 없음: 시각은 인자로 받는다.

export const AGENT_KEEP = 30
export const NOTIFIED_KEEP = 50
// Stop 보정에서 막 시작한 작업은 목록에 아직 없을 수 있다.
export const RECONCILE_GRACE_MS = 3_000

export function emptyModel(): ChipsModel {
  return { todo: { source: null, items: [] }, ctxPercent: null, agents: [], test: null, bg: [], done: null }
}

// ---- 할 일 (jinmin-hud register.tsx의 TodoWrite·TaskCreate·TaskUpdate 추출을 옮김) ----

export function applyTodoWrite(model: ChipsModel, todos: ReadonlyArray<{ status?: unknown }>) {
  model.todo = { source: 'todo', items: todos.map((todo, i) => ({ id: String(i), status: String(todo.status ?? 'pending') })) }
}

export function applyTaskCreate(model: ChipsModel, taskId: string) {
  if (model.todo.source !== 'task') {
    model.todo = { source: 'task', items: [] }
  }
  if (!model.todo.items.some(item => item.id === taskId)) {
    model.todo.items.push({ id: taskId, status: 'pending' })
  }
}

export function applyTaskUpdate(model: ChipsModel, taskId: string, status: string | undefined) {
  if (model.todo.source !== 'task' || status === undefined) {
    return
  }
  model.todo.items = status === 'deleted' ? model.todo.items.filter(item => item.id !== taskId) : model.todo.items.map(item => (item.id === taskId ? { ...item, status } : item))
}

// TaskList 결과는 그 시점의 전체 목록이라 통째로 맞춘다.
export function applyTaskList(model: ChipsModel, tasks: ReadonlyArray<{ id?: unknown; status?: unknown }>) {
  model.todo = { source: 'task', items: tasks.map(task => ({ id: String(task.id ?? ''), status: String(task.status ?? 'pending') })) }
}

export function todoCounts(model: ChipsModel): { done: number; total: number } {
  const items = model.todo.items

  return { done: items.filter(item => item.status === 'completed').length, total: items.length }
}

// ---- 에이전트 ----

export function addAgent(model: ChipsModel, agent: ChipsAgent) {
  model.agents = [...model.agents.filter(one => one.id !== agent.id), agent]
  if (model.agents.length > AGENT_KEEP) {
    const running = model.agents.filter(one => one.isRunning)
    const idle = model.agents.filter(one => !one.isRunning)
    model.agents = [...idle.slice(Math.max(0, idle.length - (AGENT_KEEP - running.length))), ...running]
  }
}

export function setAgentRunning(model: ChipsModel, agentId: string, isRunning: boolean): boolean {
  const agent = model.agents.find(one => one.id === agentId)
  if (!agent || agent.isRunning === isRunning) {
    return false
  }
  agent.isRunning = isRunning

  return true
}

const DONE_AGENT_STATUSES = new Set(['completed', 'failed', 'killed', 'idle'])

export function reconcileAgentList(model: ChipsModel, listed: ReadonlyArray<{ id: string; status: string }>): boolean {
  let changed = false
  for (const agent of model.agents) {
    const status = listed.find(one => one.id === agent.id)?.status
    if (agent.isRunning && status && DONE_AGENT_STATUSES.has(status)) {
      agent.isRunning = false
      changed = true
    }
  }

  return changed
}

// ---- 테스트 ----

export function startTest(model: ChipsModel) {
  const current = model.test
  model.test = { state: 'running', previous: current === null ? null : current.state === 'running' ? current.previous : current }
}

// 실행 중이었다면 이전 값으로 되돌린다(결과를 알 수 없는 끝).
export function revertTest(model: ChipsModel) {
  if (model.test?.state === 'running') {
    model.test = model.test.previous
  }
}

export function testFromSummary(summary: TestSummary): ChipsTestResult {
  const total = summary.passed + summary.failed

  return summary.failed > 0 ? { state: 'failed', failed: summary.failed, total } : { state: 'passed', passed: summary.passed, total }
}

// 요약이 있으면 그것, 없고 오류면 failed-unparsed, 없고 오류도 아니면 그대로(실행 중이면 이전 값).
export function finishTest(model: ChipsModel, summary: TestSummary | null, isError: boolean) {
  if (summary) {
    model.test = testFromSummary(summary)
  } else if (isError) {
    model.test = { state: 'failed-unparsed' }
  } else {
    revertTest(model)
  }
}

export function isTestRunning(test: ChipsTest | null): boolean {
  return test?.state === 'running'
}

// ---- 백그라운드 작업 ----

const LEADING_CD = /^(?:cd|pushd|Set-Location|sl)\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/i
const LEADING_ENV = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/

function stripPrefixes(command: string): string {
  let rest = command.trim()
  for (let i = 0; i < 5; i += 1) {
    const next = rest.replace(LEADING_CD, '').replace(LEADING_ENV, '').trim()
    if (next === rest) {
      break
    }
    rest = next
  }

  return rest
}

function tokensOf(command: string): string[] {
  return stripPrefixes(command).split(/\s+/).filter(Boolean)
}

// 칩 본문용: 앞의 `cd … &&`, `VAR=… `를 떼고 첫 세 토큰.
export function bgLabel(command: string): string {
  return tokensOf(command).slice(0, 3).join(' ') || command.trim()
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

// 끝난 칩용 짧은 이름: `npm run build` → build, `npx tsc` → tsc, 그 외 첫 토큰의 파일 이름.
export function bgShort(command: string): string {
  const tokens = tokensOf(command)
  const [first = '', second, third] = tokens
  if (/^(?:npm|pnpm|yarn|bun)$/.test(first) && second === 'run' && third) {
    return third
  }
  if (first === 'npx' && second) {
    return second
  }

  return basename(first) || command.trim()
}

export function addBg(model: ChipsModel, bg: ChipsBg) {
  model.bg = [...model.bg.filter(one => one.id !== bg.id), bg]
}

export function bgFromCommand(id: string, command: string, startedAt: number, isTest: boolean): ChipsBg {
  return { id, kind: 'shell', label: bgLabel(command), short: bgShort(command), startedAt, isTest }
}

export function bgNamed(id: string, kind: ChipsBgKind, name: string, startedAt: number): ChipsBg {
  const label = name.trim() || kind

  return { id, kind, label, short: label, startedAt, isTest: false }
}

export function doneStatus(status: string): ChipsDone['status'] {
  return /fail|error|timed?[_ -]?out/i.test(status) ? 'failed' : /kill|stop|cancel|abort/i.test(status) ? 'killed' : 'completed'
}

// 끝난 작업을 bg에서 빼고 bg-done으로. 모르는 작업이면 에이전트인지 보고, 아니면 아무것도 안 한다.
export function finishTask(model: ChipsModel, taskId: string, status: string, now: number): { bg: ChipsBg | null; changed: boolean } {
  const bg = model.bg.find(one => one.id === taskId) ?? null
  if (bg) {
    model.bg = model.bg.filter(one => one.id !== taskId)
    const finished = doneStatus(status)
    model.done = { short: bg.short, status: finished, durationMs: finished === 'completed' ? Math.max(0, now - bg.startedAt) : null, at: now }

    return { bg, changed: true }
  }

  return { bg: null, changed: setAgentRunning(model, taskId, false) }
}

export type BackgroundSummary = { id: string; type: string; status: string; description: string; command?: string; name?: string }

// classic.Stop의 background_tasks로 놓친 시작·끝을 맞춘다. 사라진 것은 끝 표시 없이 뺀다.
export function reconcileBackground(model: ChipsModel, tasks: ReadonlyArray<BackgroundSummary>, now: number): boolean {
  const ids = new Set(tasks.map(task => task.id))
  let changed = false
  const kept = model.bg.filter(bg => ids.has(bg.id) || now - bg.startedAt < RECONCILE_GRACE_MS)
  if (kept.length !== model.bg.length) {
    model.bg = kept
    changed = true
  }
  for (const agent of model.agents) {
    if (agent.isBackground && agent.isRunning && !ids.has(agent.id) && now - agent.startedAt >= RECONCILE_GRACE_MS) {
      agent.isRunning = false
      changed = true
    }
  }
  for (const task of tasks) {
    if (model.bg.some(bg => bg.id === task.id)) {
      continue
    }
    if (task.type === 'shell') {
      addBg(model, bgFromCommand(task.id, task.command ?? task.description, now, false))
      changed = true
    } else if (task.type === 'monitor' || task.type === 'workflow') {
      addBg(model, bgNamed(task.id, task.type, task.type === 'workflow' ? task.name ?? task.description : task.description, now))
      changed = true
    }
  }

  return changed
}

// ---- task-notification ----

export type TaskNotice = { taskId: string; status: string; outputFile: string | null; summary: string | null }

function tag(block: string, name: string): string | null {
  const hit = block.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))

  return hit?.[1]?.trim() || null
}

const TERMINAL_STATUS = /^(?:completed|complete|done|success|succeeded|failed|failure|error|killed|stopped|cancell?ed|aborted|timed?[_-]?out)$/i

// `<task-notification><task-id>…</task-id><status>…</status>[<output-file>…</output-file>]…` (계약이 아니라 관찰한 형식).
// 끝난 상태어가 없는 알림(모니터 이벤트 등)은 버린다.
export function parseTaskNotifications(text: string): TaskNotice[] {
  const blocks = [...text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)].map(hit => hit[1] ?? '')
  if (blocks.length === 0 && text.includes('<task-id>')) {
    blocks.push(text)
  }
  const notices: TaskNotice[] = []
  for (const block of blocks) {
    const taskId = tag(block, 'task-id')
    const status = tag(block, 'status')
    if (taskId && status && TERMINAL_STATUS.test(status)) {
      notices.push({ taskId, status, outputFile: tag(block, 'output-file'), summary: tag(block, 'summary') })
    }
  }

  return notices
}

export function hasRunning(model: ChipsModel): boolean {
  return model.bg.length > 0 || model.agents.some(agent => agent.isRunning)
}
