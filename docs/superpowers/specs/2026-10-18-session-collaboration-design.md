# 세션 협업 — 안전한 send · 팀 보드 · 세션 프리셋 · jk MCP

## 배경

OpenRig(mvschwarz/openrig)를 검토한 결과다. OpenRig는 YAML로 정의한 에이전트 팀을 tmux 데몬 위에서 띄우고, send·채팅방·작업 큐·스냅샷·MCP를 제공한다. 그대로 가져올 수는 없다. tmux와 macOS/Linux 전용(Windows는 WSL2)이고, 이 앱이 기각한 상주 데몬 노선이며(`2026-07-19-session-persistence-jk-coding-cli-design.md`), Claude·Codex 전역 설정을 고쳐 쓴다. 그래서 아이디어 네 가지만 이 앱의 방식(ConPTY·`jk` 제어 파이프·실행별 overlay)으로 다시 만들었다.

가져오지 않은 것은 작업 큐(이슈는 atlas가 SSOT), Slack, 리드 에이전트(2026-09-28 페르소나 레이어 폐기와 상충), tmux 데몬이다.

## 1. 전달 큐 — `jk send`가 끼어들지 않게

예전 `send`는 대상이 살아 있으면 바로 PTY에 썼다. 그래서 작업 중인 턴, 승인 프롬프트, 사람이 치던 입력창, 첫 실행 확인 창에 글이 섞여 들어갔다.

- `src/main/control/delivery-queue.ts`
  - 메시지는 먼저 보류되고, 아래 조건이 모두 맞을 때 대상당 한 건씩 오래된 것부터 들어간다.
    - 상태가 `idle` 또는 `awaiting-input`
    - 확인 창이 떠 있지 않음
    - 초안이 비어 있고 마지막 키 입력 후 3초가 지남
    - 화면 출력이 1.2초 멈춤
    - 직전 전달 후 2.5초가 지남
  - 보류 사유는 `working`·`awaiting-approval`·`typing`·`starting`·`settling`·`dialog`다.
  - 대상이 끝나면 보류분은 실패로 바뀌고, 30분이 지나면 만료된다.
  - 보류 개수는 대상 패인 머리줄의 `보류 N` 칩으로 보인다.
- **확인 창**
  - 상태 훅이 알려 주지 않는 첫 실행 화면들이다: Claude의 폴더 신뢰·권한 우회 경고, Codex의 훅 신뢰·폴더 승인.
  - 화면 출력에서 공백과 대소문자를 뺀 문구로 찾는다. 사람이 키를 누르거나, 창 문구 뒤에 입력창 문구(`Ask Codex to do anything`·`? for shortcuts` 등)가 그려지면 닫힌 것으로 본다. Codex는 답한 뒤 훅 창을 한 번 더 그리므로 키 입력만으로는 부족하다.
  - 이것이 없으면 글자가 선택지를 고른다. Claude 신뢰 창에서는 "2"가 "No, exit"다(2026-10-18 실기에서 확인).
- **사람 입력 추적**: `src/main/terminal/human-input-tracker.ts`
  - 데스크톱 `terminals:write`와 폰 입력만 센다. 문자는 더하고 백스페이스는 빼며, Enter·Ctrl+C에서 0으로 돌린다.
  - Ctrl+U는 초기화하지 않는다. PowerShell은 Ctrl+U로 줄을 지우지 않기 때문이다.
- **전달 형식**
  - 앞에 `[from <이름> (<kind>)] `를 붙인다. PowerShell이 가운뎃점을 공백으로 그려서 ASCII로 정했다.
  - 보드 글은 `[board: <작성자>] `로 붙인다.
  - 본문을 쓰고 300ms 뒤에 Enter(`\r`)를 따로 쓴다. Claude는 긴 덩어리 끝의 `\r`을 붙여넣기의 일부로 삼켜 제출하지 않는다(2026-10-18 실기에서 확인).
  - ESC와 C0 제어문자는 지운다. 본문의 `ESC[201~`가 bracketed paste를 일찍 끝내는 것을 막기 위해서다.
- **jk 명령**
  - `send --now/--raw/--wait`
  - `broadcast`: 범위를 반드시 지정한다. 기본값은 호출한 세션의 폴더다.
  - `held [--drop]`
  - `spawn --name --prompt`: 첫 프롬프트는 접두 없이 큐로 들어간다.
- 큐는 메모리에만 있다. 앱을 재시작하면 보류분은 사라진다.

## 2. 팀 보드

- 폴더마다 피드가 하나씩 있다. `userData/board/<projectId>.jsonl`에 append-only로 쓰며, 메시지는 `message` 줄, 전달 진행은 `patch` 줄로 남긴다.
  - 메모리에는 마지막 500건만 둔다. 파일이 2,000줄을 넘으면 압축한다.
- 메시지 종류는 셋이다.
  - `post`: 사용자 또는 `jk post`
  - `direct`: 모든 `jk send`·broadcast·첫 프롬프트·역할 프롬프트. 폴더를 넘는 send는 양쪽 보드에 다 남는다.
  - `event`: 프리셋 기동 같은 앱의 기록
- 멘션(`@` 또는 `--to`)한 세션에는 같은 전달 큐로 프롬프트도 넣는다. 큐 진행은 메시지의 받는 쪽마다 기록된다.
- UI는 오른쪽 사이드바 `보드` 탭이다(`TeamBoard.tsx`).
  - 로스터: 상태 색 링 아바타. 작업 중이면 맥동한다.
  - 피드: 같은 작성자가 3분 안에 이어 쓴 글은 묶는다. 코드 펜스도 표시한다.
  - 작성창: `@` 자동완성
  - 숨긴 동안 온 글은 읽지 않음 배지로 센다.
  - direct는 보낸 쪽과 받는 쪽을 잇는 **전선**으로 그린다. 보류 중이면 점선 위로 점이 오가고, 전달되면 이어진 초록 선, 실패하면 끊긴 빨간 선이다.
- `jk board`로 읽는다.

## 3. 세션 프리셋

- `~/.multi-cli-work/session-presets.json`(json-store 프로토콜). 형식은 `{ id, name, description?, members: [{ agentId, name, prompt? }] }`이다.
- 파일이 없으면 내장 예시 "빌더 + 리뷰어"(Claude 빌더, Codex 리뷰어)가 보인다. 파일이 생기면 그 내용이 전부다.
- 기동(`preset-service.ts`)
  - 멤버를 차례로 띄운다. 선택은 가져가지 않는다.
  - 보드에 기동 줄을 남기고, 역할 프롬프트를 큐에 넣는다.
  - 렌더러는 멤버 순서대로 그리드에 놓은 뒤 그 폴더와 보드를 연다.
- 진입점은 네 곳이다: 폴더·워크트리 우클릭 메뉴, 폴더 시작 화면의 "팀으로 시작", 세션이 없는 보드, 설정 › 팀 프리셋(편집).

## 4. jk MCP 서버

- `src/main/jk-mcp.ts`
  - electron-vite 별도 엔트리로 빌드한다. `jk-mcp.js`는 node 내장 모듈만 쓰고 index와 청크를 나누지 않는다.
  - 시작 시 `userData/bin`에 복사하고, 앱 실행 파일을 `ELECTRON_RUN_AS_NODE=1`로 띄워 실행한다. 설치본에서 파이프 입출력이 되는 것을 확인했다(2026-10-18).
- MCP는 직접 구현했다. `initialize`·`tools/list`·`tools/call`·`ping`을 줄 단위 JSON-RPC로 처리하며, SDK 의존성은 없다(`jk-mcp-protocol.ts`).
- 도구는 jk 명령과 1:1이다(`jk-mcp-tools.ts`): `jk_list`·`jk_send`·`jk_broadcast`·`jk_held`·`jk_read`·`jk_wait`·`jk_spawn`·`jk_status`·`jk_progress`·`board_post`·`board_read`.
- 주입(`jk-mcp-launch.ts`)은 전역 설정을 건드리지 않는다.
  - Claude: 세션별 `userData/mcp/<sessionId>.json`을 `--mcp-config`로 넘긴다. 시작할 때 이전 실행분을 지운다.
  - Codex: `-c mcp_servers.jk.command/args/env/tool_timeout_sec` 오버라이드를 쓴다.
  - CLI가 자기 환경을 MCP 자식에게 넘기지 않을 수 있어서, 파이프·토큰·세션 id는 서버 `env`에 명시한다.
  - 토큰은 앱 실행마다 바뀌고, 세션이 다시 뜰 때마다 설정도 새로 쓴다.
- 설정 › 일반의 "Claude·Codex 세션에 jk 도구(MCP) 제공"(기본 켬)으로 끈다. 새로 시작하는 세션부터 적용된다.
