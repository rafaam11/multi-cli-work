# 에이전트 레지스트리 설계 (Orca 도입 1단계)

## 왜

`stablyai/orca`(16.9k★)는 30개 넘는 CLI 에이전트를 붙인다. 그럴 수 있는 이유는 **provider가 코드가 아니라 데이터**이기 때문이다.

우리는 앱 이름이 **multi-cli**인데 `TerminalKind = "powershell" | "claude" | "codex"` 유니온이 하드코딩돼 있었다. CLI 하나를 더 붙이려면 main·preload·renderer 전반에 분기를 추가해야 했다. Orca에서 가져오기로 한 나머지(worktree 병렬 세션, Quick Open, unread 배지, 터미널 분할)도 전부 이 위에 얹히므로, 여기를 먼저 풀지 않으면 하드코딩 위에 쌓았다가 나중에 재작업이 된다.

## 무엇을

에이전트를 `AgentDefinition` 데이터로 기술한다. 빌트인 3종은 코드에 있는 정의일 뿐 특별한 존재가 아니고, 사용자는 `~/.multi-cli-work/agents.json`에 같은 형식으로 임의의 CLI를 추가한다.

### 스키마 (`src/shared/agent-types.ts`)

```ts
interface AgentDefinition {
  id: AgentId;                    // ^[a-z0-9][a-z0-9-]{0,31}$
  label: string;
  commands: string[];             // PATH에서 순서대로 탐색 (PowerShell은 pwsh → powershell)
  args: string[];                 // 항상 붙는다
  newSessionArgs: string[];       // 새 세션일 때 앞에
  resumeArgs: string[];           // 재개일 때 앞에
  conversationId: "none" | "app-generated" | "provider-assigned";
  statusAdapter: "signals" | "osc9" | "claude-hook";
  titleSource: "none" | "claude-transcript" | "codex-transcript";
  icon: string | null;            // 빌트인 브랜드 아이콘 키. null → 모노그램
  accentColor: string | null;
  builtin: boolean;
}
```

치환 토큰: `{cwd}` · `{sessionId}` · `{conversationId}` · `{claudeSettings}`. `{{` `}}`는 리터럴 중괄호.

빌트인 3종이 이 스키마로 **손실 없이** 표현된다는 것이 이 설계의 성립 조건이다. `agent-launch.test.ts`가 세 에이전트의 커맨드라인을 리터럴로 고정해 그것을 보장한다.

### 상태 감지는 어댑터가 정한다

`terminal-session-manager.ts`에는 두 개의 kind 분기가 있었다.

1. `kind === "codex"` → OSC 9 파싱 → **`statusAdapter === "osc9"`** 로 일반화.
2. `kind !== "powershell"` → 엔터 입력 시 `working` → **`statusAdapter !== "signals"`** 로 일반화.

두 번째가 핵심이다. 이 규칙이 진짜 묻는 것은 "이게 셸이냐"가 아니라 **"이 에이전트를 `working`에서 다시 빼줄 수단이 있느냐"** 다. 훅도 OSC 9도 없는 에이전트를 `working`으로 표시하면 영원히 거기 갇힌다. 그래서 `signals` 에이전트는 `대기`에 머문다 — "모르겠다"가 정직한 답이고, 빠져나올 수 없는 거짓말보다 낫다. 이 일반화로 빌트인 3종의 동작은 **바뀌지 않는다**.

### 사용자 정의 에이전트가 가질 수 없는 것

`claude-hook`(Claude 훅 프로토콜), `provider-assigned`(Codex 대화 id 역추적), 트랜스크립트 제목 파서, 브랜드 아이콘 — 전부 빌트인 전용이다. 각자 전용 코드가 딸려 있어 데이터만으로는 성립하지 않는다. `agents.json`이 이들을 요구하면 **로드 시점에 거부하고 이유를 말한다**.

토큰 검증도 같은 성격이다. 모르는 토큰(`{workingDirectory}` 같은 오타)은 조용히 리터럴로 통과시키지 않고 거부한다. `{conversationId}`를 `resumeArgs` 밖에서 쓰면 값이 없어 매번 실패하므로 그것도 거부한다.

**보안 관점을 정직하게** — 이 파일은 사용자 홈에 있고 임의 실행파일을 띄우는 것이 목적이다. 샌드박스가 아니며, 검증은 **오작동 방지**이지 악성 입력 차단이 아니다. 실제 방벽은 다른 곳에 있다: 렌더러는 **에이전트 id만** 보내고, 실행파일과 인자는 main이 레지스트리에서 꺼낸다. 렌더러는 명령을 짤 수 없다. 그리고 셸을 경유하지 않는다(node-pty 직접 spawn).

## 없어진 에이전트가 세션을 죽이지 않는다

`agents.json`은 사용자가 편집하는 파일이다. 에이전트를 지우면 그걸로 만든 세션이 남는다. 이 경우가 설계에서 가장 위험한 지점이었고, 두 군데를 고쳤다.

1. **`app-state.ts`** — `kind`가 알려진 집합에 없으면 `state.json` **전체를 거부**했다. `agents.json` 한 줄 지우면 **모든 세션이 사라진다.** 이제 슬러그 형식만 검사한다. 상태 파일이 에이전트 레지스트리에 의존하면 안 된다.
2. **`session-labels.ts`** — `providerDetails[session.kind].label`을 무조건 인덱싱했다. 모르는 kind면 렌더러가 죽는다. 이제 에이전트 id로 폴백한다.

결과: 세션은 **목록에 남고 스크롤백도 읽힌다**. 다시 시작하는 것만 막히고, 이유를 말한다("Unknown agent: gemini. Add it back to agents.json to run it again.").

## 낡은 문서를 함께 고쳤다

`registry-contract.md`는 `~/.harness-manager/projects.json`을 harness-manager와 **공유**하며 스키마가 **동결**이라고 말하고 있었다. 실제로는 커밋 `84c5be3`(2026-07-12)이 공유를 끊고 디스커버리를 제거했다 — 레지스트리는 `~/.multi-cli-work/projects.json`이고 우리 단독 소유다. 문서만 갱신되지 않았다.

이게 중요한 이유: 그 문서를 믿으면 worktree를 저장할 곳을 잘못 고른다. 실제 제약은 lock-step 배포가 아니라 **exact-keys 파서**다 — `projects.json`에 필드를 추가하면 **구버전 앱이 레지스트리 전체를 거부**하고 읽기 전용으로 내려앉는다. 자동 업데이트를 하는 앱에서 롤백한 사용자는 폴더 목록을 전부 잃은 것처럼 본다.

→ **새 개념은 별도 파일에 담는다.** 에이전트는 `agents.json`, worktree는 `worktrees.json`. 구버전은 모르는 파일을 무시하고 `projects.json`은 멀쩡히 읽는다. 잠금·원자적 쓰기·`.bak` 프로토콜은 `src/main/storage/json-store.ts`로 추출해 세 파일이 공유한다.

## 구조

```
src/shared/agent-types.ts          AgentDefinition · StatusAdapter · 토큰 목록
src/main/agents/
  builtin-agents.ts                powershell · claude · codex 정의
  agent-launch.ts                  토큰 치환 → 커맨드라인
  agent-registry.ts                agents.json 로드 · 검증 · 빌트인과 병합
  agent-registry-file.ts           예시 파일 생성 + 편집기로 열기
src/main/storage/json-store.ts     락 · 원자적 쓰기 · .bak (projects/agents/worktrees 공유)
```

## 검증

- `agent-launch.test.ts` — 빌트인 3종의 커맨드라인을 리터럴로 고정(회귀 방지의 핵심).
- `agent-registry.test.ts` — 빌트인 id 잠식, 잘못된 슬러그, 모르는 토큰, 빌트인 전용 기능 요구, 깨진 JSON(→ 빌트인만 싣고 경고).
- `app-state.test.ts` · `terminal-coordinator.test.ts` — 없어진 에이전트의 세션이 살아남고, 재개만 막힌다.
- `App.test.tsx` — 없어진 에이전트의 세션 행이 렌더러를 죽이지 않는다.
- `e2e/desktop.spec.ts` — `agents.json`에만 정의된 CLI가 실제 ConPTY 세션으로 뜨고 출력이 나온다. 런처 행이 좁은 창에서 잘리지 않고 스크롤된다.

## 다음

이 위에 Quick Open(Ctrl+P) → unread 배지 → 파일 드래그&드롭 → git worktree 병렬 세션 → 프롬프트 팬아웃 → diff 뷰 → 터미널 2분할이 얹힌다. (2차 브레인스토밍(2026-07-13)에서 팬아웃·드래그&드롭·읽기 전용 diff 뷰가 추가됐다 — "한 프롬프트를 여러 worktree 에이전트에 뿌리고 결과를 비교해 승자를 고른다"는 흐름을 완성하기 위해서다.)
