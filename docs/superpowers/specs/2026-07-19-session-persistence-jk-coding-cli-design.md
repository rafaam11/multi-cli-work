# 세션 영속성 + jk-coding-cli 설계 (2026-07-19)

## 배경

이 앱은 Orca(멀티 에이전트 오케스트레이션 앱)를 대체하는 것을 목표로 하며, 차별점은 경량성이다. 두 가지 갭을 이번에 메운다.

1. **세션 영속성** — PTY는 앱(utilityProcess)의 자식이라 Quit·업데이트·재부팅 시 함께 죽는다. 재시작하면 `state.json`의 메타데이터가 전부 `exited`로 복원되고, 사용자가 세션마다 수동 "재개"를 눌러야 했다. 스크롤백 복원(`attach()`의 `readSessionLog` 재생)은 이미 있었다 — 부족한 것은 재개의 자동화였다.
2. **오케스트레이션 CLI** — Orca의 orca-cli처럼 터미널 안의 에이전트가 앱을 제어(다른 세션에 프롬프트 전송, 출력 읽기, 상태 대기, 세션 생성)할 수단이 없었다.

## 결정

- 영속성 수준: **스크롤백 복원 + 지연(lazy) 자동 재개**. 재시작 직후에는 화면 복원만 하고, 세션을 실제로 열람할 때 그 세션만 재개한다. 프로세스는 필요한 만큼만 뜬다 — 경량성 유지가 핵심 동기.
- tmux식 상주 데몬(완전한 프로세스 생존)은 채택하지 않았다: Windows ConPTY 제약으로 복잡도가 크고, 상주 프로세스만큼 메모리를 항상 점유한다.
- CLI 이름: **jk-coding-cli** (별칭 `jk`). 파괴적 명령(stop/remove)은 MVP에서 의도적으로 제외.

## 기능 A: 세션 영속성

### 데이터: `interruptedByShutdown`

`PersistedTerminalSession`에 불리언 하나를 추가했다. 뜻은 "이 세션이 exited로 기록된 이유가 CLI의 종료가 아니라 **앱의 종료**"라는 것. `shutdown()`이 활성 세션에 이 마킹을 **PTY를 죽이기 전에** 디스크에 기록하므로, 뒤따르는 exit 이벤트가 상태를 재저장해도(같은 view 객체) 마킹은 살아남는다. 모든 `launch()`는 마킹을 `false`로 초기화한다 — 재개 성공이 곧 마킹 해제다.

- 구버전 state.json은 키가 없고, 파서는 이를 `false`로 읽는다(선례: `title`/`name`/`worktreeId`).
- **크래시는 마킹되지 않는다** — 의도된 보수적 기본값. 마지막 상태가 불확실한 세션을 함부로 자동 재실행하지 않고, 수동 "재개" 버튼만 남긴다.

### 지연 자동 재개: `attachForRenderer()`

렌더러의 attach(IPC `terminals:attach`)만 새 경로를 탄다. 기존 `attach()`는 부작용 없는 원형 그대로 남아 jk-coding-cli의 `read`가 재사용한다.

```
attachForRenderer(sessionId)
  ├─ 마킹 없음/이미 실행 중 → 기존 attach() (변화 없음)
  └─ interruptedByShutdown && exited
       ├─ 로그에 구분선 append ("── 세션 재개됨 (앱 재시작) · <시각> ──")
       ├─ 로그 읽기  ← 새 PTY의 첫 출력이 로그에 닿기 전에 읽으므로 중복 재생이 없다
       ├─ resume({updateSelection: false})  ← 80x24로 시작, 렌더러가 attach 후 fit/resize
       └─ replay = (이전 기록 + 구분선) + 새 PTY 링버퍼
```

- **동시 attach 합류**: 프라이머리/스플릿 패널이 같은 세션을 동시에 열면 `pendingResumes` 맵으로 한 번만 재개한다.
- **실패 시**: 마킹을 유지한 채 기존 attach로 폴백 — 다음 열람 또는 수동 버튼이 재시도한다.
- **선택 상태 보존**: `launch()`에 `updateSelection` 옵션을 추가(기본 true = 기존 동작). 백그라운드 재개와 CLI spawn은 false로 호출해 사용자가 보고 있는 화면을 뺏지 않는다.
- 렌더러는 무수정: `TerminalPane`이 attach 완료 후 `scheduleResize()`를 부르고 readOnly 해제 시 재fit하므로 80x24 시작이 즉시 보정된다.

### 함께 고친 기존 버그

`resume()`의 가드가 "대화 id를 가진 에이전트인데 id가 없으면 무조건 throw"여서, 상관관계가 끝나지 않은 Codex 세션은 **수동 재개조차 항상 실패**했다. 이제 `app-generated`(Claude)만 id를 요구하고, `provider-assigned`(Codex)는 id가 없으면 **새 대화로 재실행** + `launch()`가 새 트랜스크립트를 재상관관계한다.

## 기능 B: jk-coding-cli

### 구조

```
PTY 세션 안의 CLI (userData/bin/jk-coding-cli.ps1, PowerShell 5.1)
  │  한 줄 JSON 요청/응답, 연결당 요청 1개
  ▼
named pipe \\.\pipe\jk-coding-cli  (JK_CODING_CLI_PIPE로 오버라이드 가능)
  ▼
main: control-server.ts (토큰 검증) → control-commands.ts (명령 5종) → TerminalCoordinator
```

- **배포**: Claude 훅 오버레이와 같은 패턴 — TS 문자열 리터럴을 앱 시작마다 `userData/bin`에 원자적으로 재생성. 시스템 전역 설치 없음.
- **접근 제어 2중**: ① `userData\bin`을 **앱이 띄우는 PTY의 PATH에만** 앞에 붙인다(시스템 PATH 무변경). ② 실행마다 회전하는 토큰(`JK_CODING_CLI_TOKEN`)을 같은 env로만 나눠주고 서버가 timingSafeEqual로 검증한다. 파이프의 OS ACL(동일 사용자)에 더해, 앱 밖 프로세스는 토큰이 없어 거부된다.
- **파이프 충돌**: dev 빌드와 설치 빌드를 동시에 띄우면 두 번째 바인딩은 실패하되 앱은 살고 CLI만 비활성화된다("실패해도 앱은 산다" 관례).

### 명령 5종과 재사용 경로

| 명령 | 재사용 | 비고 |
|---|---|---|
| `list [--project id] [--json]` | `coordinator.list()` + 프로젝트명 | |
| `send <id> <텍스트…>` / `--stdin` | `promptAsTerminalInput()`(shared로 이동) + `write()` | 자기 자신 거부, 종료 세션 거부, 멀티라인은 bracketed paste |
| `read <id> [--lines N]` | 부작용 없는 `attach()`의 replay | 기본 100줄, 상한 2000줄 |
| `wait <id> [--status s] [--timeout 초]` | `onEvent()` 구독 | 기본 120초·상한 1800초, 폴링 없음. 세션이 종료(exited/error)돼도 대기가 풀린다 |
| `spawn --project id [--worktree id] --agent kind` | `create(…, {updateSelection: false})` | 80x24로 생성, 첫 열람 시 fit |

### 파생 수정: `created` 이벤트

렌더러의 이벤트 리듀서는 모르는 sessionId를 버렸다 — CLI `spawn`(또는 다른 패널의 지연 재개)으로 생긴 세션이 목록에 안 나타난다. `launch()`가 `{type:"created", session}`을 발행하고 App이 upsert한다.

## 검증

- 유닛: coordinator 재시작 시뮬레이션(마킹→재시작→지연재개→구분선→선택 미변경→동시 attach 합류→실패 폴백→크래시 미재개), app-state 라운드트립·구버전 호환, control-commands(자기자신 send 거부·timeout·상태 검증·매핑), control-server(실제 파이프로 토큰·프레이밍·중복 바인딩), CLI 설치기. PS 스크립트는 PowerShell 파서로 문법 검증.
- 전체: `npm run typecheck` + vitest 366개 통과.
- 수동 시나리오: ① 활성 세션 중 Quit → 재시작 → 열람 시 스크롤백+구분선+대화 이어짐 ② Codex 상관관계 전 Quit → 새 대화로 재시작 ③ 강제 종료(크래시) → 자동 재개 안 됨 ④ 터미널 안 `jk list/send/read/wait/spawn` ⑤ 자기 자신 send 거부, 앱 밖 무토큰 접속 거부.

## 리스크와 수용

- state.json 필드 추가로 구버전이 새 파일을 거부할 수 있다 — 기존 5회 선례와 동일하게 수용(앱 전용 데이터, 최악은 빈 상태 시작).
- 지연 재개 직후 로그와 링버퍼의 수 바이트 경합 — 읽기 순서(로그 먼저)로 attach 경로에선 제거, 극단 케이스만 잔존, 수용.
- SSH 등으로 세션 env가 원격에 전파되면 토큰 노출 가능 — 실행마다 회전으로 완화.

## 이후 로드맵 (미착수)

worktree 카드 보드 + 머지 플로우 → 자동화(스케줄/이벤트 트리거) → jk-coding-cli 확장(파괴적 명령 옵트인, 핸드오프 헬퍼).
