export type ChipsColor = 'green' | 'amber' | 'red' | 'blue' | 'gray'

// 할 일: TodoWrite(목록 통째) 또는 TaskCreate·TaskUpdate·TaskList(항목 단위) 중 마지막으로 쓴 쪽.
export type ChipsTodoItem = { id: string; status: string }

export type ChipsTodo = { source: 'todo' | 'task' | null; items: ChipsTodoItem[] }

export type ChipsAgent = {
  id: string
  model: string | null
  isBackground: boolean
  isRunning: boolean
  startedAt: number
}

export type ChipsTestResult =
  | { state: 'passed'; passed: number; total: number }
  | { state: 'failed'; failed: number; total: number }
  | { state: 'failed-unparsed' }

// running이면 끝났을 때 결과가 없을 경우 되돌아갈 이전 값을 들고 있다.
export type ChipsTest = ChipsTestResult | { state: 'running'; previous: ChipsTestResult | null }

export type ChipsBgKind = 'shell' | 'monitor' | 'workflow'

export type ChipsBg = {
  id: string
  kind: ChipsBgKind
  label: string
  short: string
  startedAt: number
  isTest: boolean
}

export type ChipsDone = {
  short: string
  status: 'completed' | 'failed' | 'killed'
  durationMs: number | null
  at: number
}

export type ChipsModel = {
  todo: ChipsTodo
  ctxPercent: number | null
  agents: ChipsAgent[]
  test: ChipsTest | null
  bg: ChipsBg[]
  done: ChipsDone | null
}

export type ChipsChip = { text: string; color: ChipsColor }

export type ChipsProgress = { kind: 'value'; value: number } | { kind: 'busy' }

// jk로 보낼(또는 보낸) 머리줄 상태: 키별 칩과 진행선. progress null은 진행선 없음.
export type ChipsWire = { chips: Record<string, ChipsChip>; progress: ChipsProgress | null }

export type ChipsHealth = {
  transport: string
  flushes: number
  failures: number
  consecutive: number
  backoffUntil: number
  disabled: string | null
  blocked: string[]
  latencies: number[]
  lastError: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'mcw-chips-v2': {
      model: ChipsModel | null
      sent: ChipsWire | null
      health: ChipsHealth | null
    }
  }
}
