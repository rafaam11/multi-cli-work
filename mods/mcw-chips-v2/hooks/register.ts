import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, ToolCallResult } from 'claude-code'

import type { ChipsChip, ChipsHealth, ChipsModel, ChipsProgress, ChipsWire } from '../types'
import { CHIP_KEYS, deriveWire } from './chips'
import { emptyHealth, Flusher, latencySummary, makeTransport, type Run, type Transport } from './metadata'
import {
  addAgent,
  addBg,
  applyTaskCreate,
  applyTaskList,
  applyTaskUpdate,
  applyTodoWrite,
  bgFromCommand,
  bgNamed,
  doneStatus,
  emptyModel,
  finishTask,
  finishTest,
  hasRunning,
  NOTIFIED_KEEP,
  parseTaskNotifications,
  reconcileAgentList,
  reconcileBackground,
  revertTest,
  setAgentRunning,
  startTest,
  todoCounts,
} from './model'
import { isTestCommand, parseTestSummary } from './parse-tests'

// multi-cli-work 패인 머리줄에 칩·진행선을 자동으로 띄운다: 할 일·컨텍스트·에이전트·테스트·백그라운드 작업.

const modelAtom = atom({ plugin: 'mcw-chips-v2', key: 'model' } as const, null)
const sentAtom = atom({ plugin: 'mcw-chips-v2', key: 'sent' } as const, null)
const healthAtom = atom({ plugin: 'mcw-chips-v2', key: 'health' } as const, null)

type Settings = { debounceMs: number; tickMs: number; lingerMs: number; ctxStep: number }

// 모듈 환경 하나의 상태. 타이머는 hot reload 때 엔진이 함께 버린다.
type Chips = {
  settings: Settings
  isActive: boolean
  model: ChipsModel
  flusher: Flusher | null
  transport: Transport | null
  heartbeat: Timer | null
  ticker: Timer | null
  linger: Timer | null
  callerSessionId: string
  // prompt.submit과 session.receive가 같은 알림을 두 번 처리하지 않게.
  notified: string[]
}

// jinmin-hud/hooks/visual.ts에서 복사(HUD에 의존하지 않는다).
function modelFamily(model: string): string {
  return model.match(/(opus|sonnet|haiku|fable)/i)?.[1]?.toLowerCase() ?? model
}

function num(value: unknown, fallback: number, min: number): number {
  const n = Number(value)

  return Number.isFinite(n) && n >= min ? n : fallback
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function outputText(ran: ToolCallResult): string {
  const result = record(ran.result)
  if (result && (typeof result['stdout'] === 'string' || typeof result['stderr'] === 'string')) {
    return `${String(result['stdout'] ?? '')}\n${String(result['stderr'] ?? '')}`
  }

  return [typeof ran.result === 'string' ? ran.result : '', ran.text ?? ''].join('\n')
}

function chipText(chip: ChipsChip | undefined): string {
  return chip ? `${chip.text} [${chip.color}]` : '(없음)'
}

function progressText(progress: ChipsProgress | null | undefined): string {
  return progress == null ? '(없음)' : progress.kind === 'busy' ? 'busy' : `${progress.value}%`
}

function desired(s: Chips, now: number): ChipsWire {
  return deriveWire(s.model, now, { ctxStep: s.settings.ctxStep, lingerMs: s.settings.lingerMs })
}

function ensureTicker($: EngineInterface, s: Chips) {
  if (s.ticker === null && hasRunning(s.model)) {
    s.ticker = $.clock.every(s.settings.tickMs, () => void tick($, s))
  }
}

// 돌고 있는 bg·에이전트가 있는 동안만: 경과 분 갱신과 $.agent.list() 대조.
async function tick($: EngineInterface, s: Chips) {
  if (!hasRunning(s.model)) {
    s.ticker?.cancel()
    s.ticker = null
    s.flusher?.request()

    return
  }
  if (s.model.agents.some(agent => agent.isRunning)) {
    const listed = await $.agent.list().catch(() => null)
    if (listed) {
      reconcileAgentList(s.model, listed)
    }
  }
  s.flusher?.request()
}

function changed($: EngineInterface, s: Chips) {
  s.flusher?.request()
  ensureTicker($, s)
}

function scheduleLinger($: EngineInterface, s: Chips, at: number, delayMs: number) {
  s.linger?.cancel()
  s.linger = $.clock.after(Math.max(0, delayMs), () => {
    s.linger = null
    if (s.model.done?.at === at) {
      s.model.done = null
    }
    s.flusher?.request()
  })
}

function remember(s: Chips, taskId: string): boolean {
  if (s.notified.includes(taskId)) {
    return false
  }
  s.notified.push(taskId)
  if (s.notified.length > NOTIFIED_KEEP) {
    s.notified.splice(0, s.notified.length - NOTIFIED_KEEP)
  }

  return true
}

// 출력 파일(너무 커서 따로 저장된 출력, 백그라운드 테스트의 출력)에서 요약을 찾는다. 훅은 이걸 기다리지 않는다.
async function readTestOutput($: EngineInterface, s: Chips, path: string, isError: boolean) {
  const text = await $.fs.read(path).catch(() => null)
  finishTest(s.model, typeof text === 'string' ? parseTestSummary(text) : null, isError)
  changed($, s)
}

function finish($: EngineInterface, s: Chips, taskId: string, status: string, now: number, outputFile: string | null): boolean {
  if (!remember(s, taskId)) {
    return false
  }
  const ended = finishTask(s.model, taskId, status, now)
  if (ended.bg && s.model.done) {
    scheduleLinger($, s, s.model.done.at, s.settings.lingerMs)
    if (ended.bg.isTest && outputFile) {
      void readTestOutput($, s, outputFile, doneStatus(status) === 'failed').catch(() => undefined)
    }
  }

  return ended.changed
}

async function onNotification($: EngineInterface, s: Chips, text: string) {
  const notices = parseTaskNotifications(text)
  if (notices.length === 0) {
    return
  }
  const now = await $.clock.now()
  let isChanged = false
  for (const notice of notices) {
    isChanged = finish($, s, notice.taskId, notice.status, now, notice.outputFile) || isChanged
  }
  if (isChanged) {
    changed($, s)
  }
}

type Call = {
  agentId: string | undefined
  tool: string
  input: Readonly<Record<string, unknown>>
  command: string
  isTest: boolean
}

async function observeTool($: EngineInterface, s: Chips, call: Call, ran: ToolCallResult) {
  const { tool, input, command, isTest } = call
  const model = s.model
  if (ran.deny !== undefined) {
    if (isTest) {
      revertTest(model)
      changed($, s)
    }

    return
  }
  const isError = ran.isError === true
  const result = record(ran.result)
  const now = await $.clock.now()

  if (tool === 'Bash' || tool === 'PowerShell') {
    const bgId = str(result?.['backgroundTaskId'])
    if (bgId && result?.['backgroundEndsWithFinalResponse'] !== true) {
      if (isTest) {
        revertTest(model)
      }
      addBg(model, bgFromCommand(bgId, command, now, isTest))
      changed($, s)
    } else if (isTest) {
      const summary = parseTestSummary(outputText(ran))
      const persisted = str(result?.['persistedOutputPath'])
      if (summary === null && persisted) {
        void readTestOutput($, s, persisted, isError).catch(() => undefined)
      } else {
        finishTest(model, summary, isError)
        changed($, s)
      }
    }

    return
  }
  if (isError) {
    return
  }
  if (tool === 'Monitor') {
    const taskId = str(result?.['taskId'])
    if (taskId) {
      addBg(model, bgNamed(taskId, 'monitor', str(input['description']) ?? 'monitor', now))
      changed($, s)
    }
  } else if (tool === 'Workflow') {
    const taskId = str(result?.['taskId'])
    if (taskId) {
      addBg(model, bgNamed(taskId, 'workflow', str(result?.['workflowName']) ?? str(input['name']) ?? 'workflow', now))
      changed($, s)
    }
  } else if (tool === 'TaskStop') {
    const taskId = str(result?.['task_id']) ?? str(input['task_id']) ?? str(input['shell_id'])
    if (taskId && finish($, s, taskId, 'killed', now, null)) {
      changed($, s)
    }
  } else if (call.agentId === undefined) {
    // 할 일은 메인 루프 것만(하위 에이전트의 TodoWrite는 무시).
    if (tool === 'TodoWrite') {
      const todos = Array.isArray(result?.['newTodos']) ? result['newTodos'] : Array.isArray(input['todos']) ? input['todos'] : null
      if (todos) {
        applyTodoWrite(model, todos as Array<{ status?: unknown }>)
        changed($, s)
      }
    } else if (tool === 'TaskCreate') {
      const taskId = str(record(result?.['task'])?.['id'])
      if (taskId) {
        applyTaskCreate(model, taskId)
        changed($, s)
      }
    } else if (tool === 'TaskUpdate') {
      const taskId = str(input['taskId'])
      if (taskId && result?.['success'] !== false) {
        applyTaskUpdate(model, taskId, str(input['status']))
        changed($, s)
      }
    } else if (tool === 'TaskList') {
      if (Array.isArray(result?.['tasks'])) {
        applyTaskList(model, result['tasks'] as Array<{ id?: unknown; status?: unknown }>)
        changed($, s)
      }
    }
  }
}

function describe(s: Chips, now: number): string {
  if (!s.isActive) {
    return 'mcw-chips-v2: inactive outside an MCW v2 Herdr session.'
  }
  const model = s.model
  const health: ChipsHealth = s.flusher?.health ?? emptyHealth(s.transport?.name() ?? '-')
  const want = desired(s, now)
  const sent = s.flusher?.sent ?? null
  const latency = latencySummary(health.latencies)
  const lines = [
    `mcw-chips · multi-cli-work 세션 ${s.callerSessionId}`,
    `- 전송: ${s.transport?.name() ?? '-'} · 배치 ${health.flushes}회 · 실패 ${health.failures}회(연속 ${health.consecutive})${latency ? ` · 지연 평균 ${latency.avg}ms / p95 ${latency.p95}ms` : ''}`,
    `- 상태: ${health.disabled !== null ? `꺼짐 — ${health.disabled}` : health.backoffUntil > now ? `쉬는 중(${Math.ceil((health.backoffUntil - now) / 1000)}초 남음)` : '켜짐'}${health.lastError ? ` · 마지막 오류: ${health.lastError}` : ''}`,
  ]
  if (health.blocked.length > 0) {
    lines.push(`- 칩 한도(8개)에 막힌 키: ${health.blocked.join(', ')}`)
  }
  lines.push(sent === null ? '- 칩 (보낸 값은 아직 모름 — 다음 전송에서 우리 키를 먼저 지움):' : '- 칩 (원하는 값, 다르면 ⇄ 보낸 값):')
  for (const key of CHIP_KEYS) {
    const wanted = want.chips[key]
    const had = sent?.chips[key]
    if (wanted === undefined && had === undefined) {
      continue
    }
    const same = sent === null || chipText(wanted) === chipText(had)
    lines.push(`  ${key.padEnd(7)} ${chipText(wanted)}${same ? '' : `  ⇄ 보낸 값 ${chipText(had)}`}`)
  }
  const sameProgress = sent === null || progressText(want.progress) === progressText(sent.progress)
  lines.push(`- 진행선: ${progressText(want.progress)}${sameProgress ? '' : `  ⇄ 보낸 값 ${progressText(sent.progress)}`}`)
  const todo = todoCounts(model)
  const agents = model.agents.filter(agent => agent.isRunning)
  const bgList = model.bg.length > 0 ? `(${model.bg.map(bg => `${bg.kind}:${bg.short}`).join(', ')})` : ''
  lines.push(
    `- 모델: 할 일 ${todo.done}/${todo.total}${model.todo.source ? `(${model.todo.source})` : ''} · ctx ${model.ctxPercent ?? '-'}% · 에이전트 실행 ${agents.length}(bg ${agents.filter(agent => agent.isBackground).length}) · 테스트 ${model.test?.state ?? '-'} · bg ${model.bg.length}${bgList} · 끝난 작업 ${model.done ? `${model.done.status}:${model.done.short}` : '-'}`,
  )

  return lines.join('\n')
}

async function start($: EngineInterface, s: Chips, sessionId: string, binary: string, paneId: string) {
  s.flusher?.stop()
  s.heartbeat?.cancel()
  s.ticker?.cancel()
  s.linger?.cancel()
  s.ticker = null
  s.linger = null
  s.callerSessionId = sessionId

  // hot reload면 직전 환경이 남긴 model·sent를 이어 받는다(새 프로세스면 둘 다 null).
  s.model = (await read($, modelAtom).catch(() => null)) ?? emptyModel()
  const sent = null // Report this producer's complete display on every start.

  const run: Run = (argv, init) => $.process.run(argv, init)
  const transport = makeTransport(run, { binary, paneId })
  s.transport = transport
  s.flusher = new Flusher({
    clock: { now: () => $.clock.now(), after: (ms, fn) => $.clock.after(ms, fn) },
    transport,
    debounceMs: s.settings.debounceMs,
    sent,
    desired: now => {
      // 전송할 때 model도 $.state에 남긴다(hot reload 대비).
      const snapshot = JSON.parse(JSON.stringify(s.model)) as ChipsModel
      void update($, modelAtom, () => snapshot).catch(() => undefined)

      return desired(s, now)
    },
    onSent: value => void update($, sentAtom, () => value).catch(() => undefined),
    onHealth: value => void update($, healthAtom, () => value).catch(() => undefined),
    log: text => $.ui.log(text, { to: 'debug' }),
  })

  if (s.model.done) {
    const now = await $.clock.now()
    scheduleLinger($, s, s.model.done.at, s.model.done.at + s.settings.lingerMs - now)
  }
  ensureTicker($, s)
  // 시작 때 한 번: sent를 모르면 우리 키를 먼저 리셋하고, 알면 이어서 맞춘다.
  s.flusher.request()
  s.heartbeat = $.clock.every(45_000, () => { if(s.flusher){s.flusher.sent=null;s.flusher.request()} })
}

// /clear: 프로세스는 이어지므로 우리 칩과 진행선을 전부 지운다. 그 밖의 끝: 타이머를 끄고 지우기만 던져 둔다.
function end(s: Chips, reason: string) {
  if (reason === 'clear') {
    s.model = emptyModel()
    s.notified.length = 0
    s.linger?.cancel()
    s.linger = null
    s.flusher?.flushNow()

    return
  }
  s.heartbeat?.cancel()
  s.heartbeat=null
  s.ticker?.cancel()
  s.linger?.cancel()
  s.ticker = null
  s.linger = null
  s.flusher?.stop()
  if (s.transport) {
    void s.transport.send({ chips: {}, progress: null }).catch(() => undefined)
  }
}

export const register: Register = (on, options) => {
  const s: Chips = {
    settings: {
      debounceMs: num(options['debounceMs'], 750, 0),
      tickMs: num(options['bgTickSeconds'], 30, 1) * 1000,
      lingerMs: num(options['doneLingerSeconds'], 60, 0) * 1000,
      ctxStep: num(options['ctxStep'], 1, 1),
    },
    isActive: false,
    model: emptyModel(),
    flusher: null,
    transport: null,
    heartbeat: null,
    ticker: null,
    linger: null,
    callerSessionId: '',
    notified: [],
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'chips-v2', description: 'mcw-chips: multi-cli-work 머리줄 칩 상태(원하는 값·보낸 값·전송·지연)' }).catch(() => undefined)

    const sessionId = await $.env.get('MULTI_CLI_WORK_SESSION_ID')
    const runtime = await $.env.get('MCW_RUNTIME')
    const binary = await $.env.get('MCW_HERDR_BINARY')
    const paneId = await $.env.get('HERDR_PANE_ID')
    s.isActive = Boolean(sessionId && binary && paneId && runtime === 'v2')
    if (!s.isActive || !sessionId) {
      return next(e)
    }
    try {
      await start($, s, sessionId, binary!, paneId!)
    } catch {
      s.isActive = false
    }

    return next(e)
  })

  on('command.run', { command: 'chips-v2' }, async $ => ({ text: describe(s, await $.clock.now()) }))

  on('tool.call', async ($, e, next) => {
    if (!s.isActive) return next(e)
    const tool = String(e.tool)
    const input = e as unknown as Readonly<Record<string, unknown>>
    const command = (tool === 'Bash' || tool === 'PowerShell') && typeof input['command'] === 'string' ? input['command'] : ''
    const isTest = command !== '' && input['run_in_background'] !== true && isTestCommand(command)
    if (isTest) {
      startTest(s.model)
      changed($, s)
    }

    const ran = await next(e)

    try {
      await observeTool($, s, { agentId: e.agentId, tool, input, command, isTest }, ran)
    } catch {
      if (isTest) {
        revertTest(s.model)
        changed($, s)
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    if (!s.isActive) return next(e)
    const spawned = await next(e)
    try {
      // 워크플로 안의 에이전트는 Workflow bg로 이미 보인다.
      if (!e.workflow && spawned.agentId) {
        addAgent(s.model, {
          id: spawned.agentId,
          model: spawned.model ? modelFamily(spawned.model) : null,
          isBackground: e.background,
          isRunning: true,
          startedAt: await $.clock.now(),
        })
        changed($, s)
      }
    } catch {
      // 관찰 실패는 무시한다.
    }

    return spawned
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    if (!s.isActive) return next(e)
    if (e.agentId !== undefined && setAgentRunning(s.model, e.agentId, true)) {
      changed($, s)
    }

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (!s.isActive) return next(e)
    if (e.agentId !== undefined && setAgentRunning(s.model, e.agentId, false)) {
      changed($, s)
    }

    return next(e)
  })

  on('session.measure', ($, e, next) => {
    if (!s.isActive) return next(e)
    const percent = e.context.percent
    if (percent !== undefined && percent !== s.model.ctxPercent) {
      s.model.ctxPercent = percent
      changed($, s)
    }

    return next(e)
  })

  // 백그라운드 작업의 끝: 알림이 프롬프트로 들어온다(origin task-notification).
  on('prompt.submit', async ($, e, next) => {
    if (!s.isActive) return next(e)
    if (e.origin?.kind === 'task-notification') {
      await onNotification($, s, e.text).catch(() => undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // 보조 경로: 같은 알림이 delivery로 올 때. remember()가 중복을 거른다.
  on('session.receive', async ($, e, next) => {
    if (!s.isActive) return next(e)
    if (e.origin.kind === 'task-notification') {
      await onNotification($, s, e.text).catch(() => undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // 놓친 시작·끝 보정: Stop 때 아직 도는 백그라운드 작업 목록.
  on('classic.Stop', async ($, e, next) => {
    if (!s.isActive) return next(e)
    try {
      if (Array.isArray(e.background_tasks) && reconcileBackground(s.model, e.background_tasks, await $.clock.now())) {
        changed($, s)
      }
    } catch {
      // 관찰 실패는 무시한다.
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', ($, e, next) => {
    if (!s.isActive) return next(e)
    try {
      end(s, e.reason)
    } catch {
      // 관찰 실패는 무시한다.
    }

    return next(e)
  })
}
