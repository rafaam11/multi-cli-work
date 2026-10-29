// 테스트 명령 판정과 러너 출력의 요약 줄 파싱. IO 없음.

export type TestSummary = { passed: number; failed: number }

// 명령 자리(맨 앞, 또는 &&·;·|·|| 뒤)에서만 본다. `cat vitest.config.ts`, `git log --grep test`는 아니다.
const RUNNER =
  /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w:-]+)?|(?:npx\s+|pnpm\s+(?:exec\s+)?|bunx\s+)?(?:vitest|jest|playwright\s+test)|(?:python3?\s+-m\s+)?pytest|bun\s+test|node\s+--test)(?=\s|$)/
const ENV_ASSIGN = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/

export function isTestCommand(command: string): boolean {
  return command
    .split(/&&|\|\||;|\||\r?\n/)
    .map(segment => segment.trim().replace(/^\(+\s*/, '').replace(ENV_ASSIGN, ''))
    .some(segment => RUNNER.test(segment))
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

type Found = TestSummary & { at: number }

function count(text: string, word: RegExp): number {
  const hit = text.match(word)

  return hit?.[1] ? Number(hit[1]) : 0
}

function lastMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  let last: RegExpExecArray | null = null
  for (const hit of text.matchAll(pattern)) {
    last = hit as RegExpExecArray
  }

  return last
}

// vitest: ` Tests  3 failed | 38 passed (41)` — `Test Files` 줄은 정규식이 걸러 낸다.
function vitest(text: string): Found | null {
  const hit = lastMatch(text, /^[ \t]*Tests[ \t]+(.+?)[ \t]*\((\d+)\)[ \t]*$/gm)
  if (!hit?.[1]) {
    return null
  }

  return { passed: count(hit[1], /(\d+)\s+passed/), failed: count(hit[1], /(\d+)\s+failed/), at: hit.index }
}

// jest: `Tests:       3 failed, 38 passed, 41 total`
function jest(text: string): Found | null {
  const hit = lastMatch(text, /^[ \t]*Tests:[ \t]+(.+)$/gm)
  if (!hit?.[1] || !/\d+\s+total/.test(hit[1])) {
    return null
  }

  return { passed: count(hit[1], /(\d+)\s+passed/), failed: count(hit[1], /(\d+)\s+failed/), at: hit.index }
}

// playwright: 마지막 `Running N tests` 뒤의 `  N passed|failed|flaky|skipped` 줄들. flaky는 통과로 센다.
function playwright(text: string): Found | null {
  const running = lastMatch(text, /^[ \t]*Running \d+ tests? using/gm)
  const from = running?.index ?? 0
  const body = text.slice(from)
  const counts: Record<string, number> = {}
  let at = -1
  for (const hit of body.matchAll(/^[ \t]*(\d+)[ \t]+(passed|failed|flaky|skipped|interrupted|did not run)\b/gm)) {
    counts[hit[2] ?? ''] = Number(hit[1])
    at = from + (hit.index ?? 0)
  }
  if (at < 0) {
    return null
  }

  return { passed: (counts['passed'] ?? 0) + (counts['flaky'] ?? 0), failed: (counts['failed'] ?? 0) + (counts['interrupted'] ?? 0), at }
}

// pytest: `==== 2 failed, 10 passed, 1 error in 1.23s ====` — error도 실패로 센다.
function pytest(text: string): Found | null {
  const hit = lastMatch(text, /^=+[ \t]*(.+?)[ \t]+in[ \t]+[\d.]+s(?:[ \t]*\([^)]*\))?[ \t]*=+[ \t]*$/gm)
  if (!hit?.[1] || !/\b(?:passed|failed|errors?|skipped|no tests ran|deselected|xfailed|xpassed)\b/.test(hit[1])) {
    return null
  }

  return {
    passed: count(hit[1], /(\d+)\s+passed/),
    failed: count(hit[1], /(\d+)\s+failed/) + count(hit[1], /(\d+)\s+errors?\b/),
    at: hit.index,
  }
}

// node --test: TAP의 `# pass N` / `# fail N`, spec 리포터의 `ℹ pass N`.
function nodeTest(text: string): Found | null {
  const pass = lastMatch(text, /^[ \t]*(?:#|ℹ)[ \t]+pass[ \t]+(\d+)[ \t]*$/gm)
  const fail = lastMatch(text, /^[ \t]*(?:#|ℹ)[ \t]+fail[ \t]+(\d+)[ \t]*$/gm)
  if (!pass && !fail) {
    return null
  }

  return { passed: Number(pass?.[1] ?? 0), failed: Number(fail?.[1] ?? 0), at: Math.max(pass?.index ?? -1, fail?.index ?? -1) }
}

// bun test: ` 38 pass` / ` 3 fail` 다음 `Ran 41 tests across ...`
function bunTest(text: string): Found | null {
  const ran = lastMatch(text, /^[ \t]*Ran \d+ tests? across/gm)
  if (!ran) {
    return null
  }
  const head = text.slice(0, ran.index)
  const pass = lastMatch(head, /^[ \t]*(\d+)[ \t]+pass[ \t]*$/gm)
  const fail = lastMatch(head, /^[ \t]*(\d+)[ \t]+fail[ \t]*$/gm)

  return { passed: Number(pass?.[1] ?? 0), failed: Number(fail?.[1] ?? 0), at: ran.index }
}

const PARSERS = [vitest, jest, playwright, pytest, nodeTest, bunTest]

// 여러 번 돌린 출력이면 가장 뒤에 나온 요약을 쓴다.
export function parseTestSummary(output: string): TestSummary | null {
  const text = stripAnsi(output).replace(/\r\n?/g, '\n')
  let best: Found | null = null
  for (const parse of PARSERS) {
    const found = parse(text)
    if (found && (best === null || found.at > best.at)) {
      best = found
    }
  }

  return best ? { passed: best.passed, failed: best.failed } : null
}
