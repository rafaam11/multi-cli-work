import type { ChipsChip, ChipsColor, ChipsModel, ChipsProgress, ChipsWire } from '../types'
import { todoCounts } from './model'

// ChipsModel → 머리줄에 보일 칩과 진행선. 순수 함수: 시각과 옵션은 인자로.

// 이 mod가 소유하는 Herdr 표시 토큰 키.
export const CHIP_KEYS = ['todo', 'ctx', 'agents', 'test', 'bg', 'bg-done'] as const

export const MAX_CHIP_TEXT = 40

export type DeriveOptions = { ctxStep: number; lingerMs: number }

// 서버(control-commands.ts)와 같은 정리: 제어 문자 제거, trim, 40자 넘으면 39자 + …
export function sanitize(text: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, '').trim()

  return clean.length > MAX_CHIP_TEXT ? `${clean.slice(0, MAX_CHIP_TEXT - 1)}…` : clean
}

// 경과 시간은 분 단위로만 바꾼다(칩은 텍스트가 바뀔 때 깜빡인다).
export function elapsed(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) {
    return '<1m'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

// 끝난 작업의 걸린 시간: 45s, 2m03s, 1h05m
export function duration(ms: number): string {
  const seconds = Math.round(Math.max(0, ms) / 1000)
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
  }

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

export function ctxColor(percent: number): ChipsColor {
  return percent < 60 ? 'green' : percent < 85 ? 'amber' : 'red'
}

function quantize(percent: number, step: number): number {
  const size = step >= 1 ? Math.floor(step) : 1

  return Math.min(100, Math.max(0, Math.floor(Math.round(percent) / size) * size))
}

function put(chips: Record<string, ChipsChip>, key: string, text: string, color: ChipsColor) {
  const clean = sanitize(text)
  if (clean !== '') {
    chips[key] = { text: clean, color }
  }
}

const DONE_MARK = { completed: '✓', failed: '✗', killed: '■' } as const
const DONE_COLOR = { completed: 'green', failed: 'red', killed: 'gray' } as const

export function deriveWire(model: ChipsModel, now: number, options: DeriveOptions): ChipsWire {
  const chips: Record<string, ChipsChip> = {}

  const { done, total } = todoCounts(model)
  const hasTodo = total > 0 && done < total
  if (hasTodo) {
    put(chips, 'todo', `할 일 ${done}/${total}`, 'blue')
  }

  if (model.ctxPercent !== null) {
    put(chips, 'ctx', `ctx ${quantize(model.ctxPercent, options.ctxStep)}%`, ctxColor(model.ctxPercent))
  }

  const running = model.agents.filter(agent => agent.isRunning)
  if (running.length > 0) {
    const families = [...new Set(running.map(agent => agent.model).filter((model): model is string => model !== null))]
    const background = running.filter(agent => agent.isBackground).length
    put(chips, 'agents', `에이전트 ${running.length}${families.length > 0 ? ` · ${families.join('+')}` : ''}${background > 0 ? ` (bg ${background})` : ''}`, 'blue')
  }

  const test = model.test
  if (test?.state === 'running') {
    put(chips, 'test', '테스트 실행 중', 'blue')
  } else if (test?.state === 'passed') {
    put(chips, 'test', `테스트 ${test.passed}/${test.total}`, 'green')
  } else if (test?.state === 'failed') {
    put(chips, 'test', `테스트 ${test.failed} 실패`, 'red')
  } else if (test?.state === 'failed-unparsed') {
    put(chips, 'test', '테스트 실패', 'red')
  }

  if (model.bg.length > 0) {
    const oldest = [...model.bg].sort((a, b) => a.startedAt - b.startedAt)[0]
    if (oldest) {
      put(chips, 'bg', `bg ${model.bg.length} · ${oldest.label} ${elapsed(now - oldest.startedAt)}`, 'amber')
    }
  }

  const finished = model.done
  if (finished && now - finished.at < options.lingerMs) {
    const time = finished.status === 'completed' && finished.durationMs !== null ? ` ${duration(finished.durationMs)}` : ''
    put(chips, 'bg-done', `${DONE_MARK[finished.status]} ${finished.short}${time}`, DONE_COLOR[finished.status])
  }

  // 진행선: 할 일 칩이 있으면 완료 %, 없고 shell·workflow·백그라운드 에이전트가 돌면 busy, 아니면 없음(모니터 제외).
  let progress: ChipsProgress | null = null
  if (hasTodo) {
    progress = { kind: 'value', value: Math.round((done / total) * 100) }
  } else if (model.bg.some(bg => bg.kind !== 'monitor') || running.some(agent => agent.isBackground)) {
    progress = { kind: 'busy' }
  }

  return { chips, progress }
}
