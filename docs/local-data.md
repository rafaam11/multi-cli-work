# 로컬 데이터와 플랫폼 동작

앱이 만드는 파일은 전부 로컬에 있다. 텔레메트리는 없고, 아래 경로 밖으로 나가는 데이터도 없다.

## 홈 레지스트리 — `~/.multi-cli-work/`

플랫폼과 무관하게 같은 스키마를 쓴다. Windows와 Ubuntu에서 홈 디렉터리를 공유하거나 옮겨 붙여도
그대로 읽힌다. 모든 쓰기는 **잠금 → 읽기 → 병합 → 원자적 교체** 순서를 거치므로 창을 여러 개
띄워도 서로의 변경을 덮어쓰지 않는다.

| 파일 | 내용 |
|---|---|
| `agents.json` | 사용자가 추가한 에이전트 정의. 이 파일만 손으로 편집한다 |
| `projects.json` | 사이드바에 등록한 폴더 목록과 마지막 사용 시각 |
| `work-projects.json` | 업무 프로젝트(폴더 묶음)와 소속 폴더 |
| `project-tags.json` | 업무 프로젝트에 붙인 자유 태그. 사이드바 "묶기"의 후보 |
| `worktrees.json` | 앱이 만든 worktree의 원본 저장소·브랜치·경로 |
| `pr-reviews.json` | PR 리뷰 세션의 진행 상태와 비공개 line note |

## 실행 상태 — Electron `userData`

세션 스크롤백처럼 앱이 다시 만들 수 있거나, 앱 설치와 수명을 같이하는 것들이다.
지우면 등록한 폴더는 남고 열려 있던 세션 배치만 초기화된다.

- Windows: `%APPDATA%\Multi CLI Work\`
- Linux: `~/.config/Multi CLI Work/`

| 경로 | 내용 |
|---|---|
| `state.json` | 창 크기, 선택된 폴더, 레이아웃, 패인 배치, 작업공간·숨김 소속 |
| `settings.json` | 언어·터미널·알림·단축키·업무 프로젝트 구분 목록. 모르는 필드는 버린다 |
| `shutdown-recovery.json` | 정상 종료 표시. 없으면 지난 실행이 비정상 종료된 것으로 본다 |
| `session-logs/` | 세션별 스크롤백. 세션마다 상한이 있는 링 버퍼라 무한히 자라지 않는다 |
| `project-briefs/` | 업무 프로젝트 브리프. Claude 세션 시작 훅이 읽어 초기 컨텍스트로 넣는다 |
| `hooks/` | Claude 상태 훅 스크립트 (`claude-status.ps1` 또는 `claude-status.py`) |
| `provider-hooks/` | Codex 세션 시작 훅 스크립트 (`codex-session-start.cjs`) |
| `provider-status/` | 훅이 남기는 세션별 상태 파일. 임시 파일에서 원자적으로 교체된다 |
| `claude-settings.json` | 위 훅만 얹은 Claude 설정 오버레이 |
| `bin/` | jk-coding-cli 클라이언트와 명령 shim. 앱이 띄운 세션의 PATH 앞에 붙는다 |

## 외부 설정에 남기는 것

| 경로 | 내용 |
|---|---|
| `~/.codex/multi-cli-work.config.toml` | Codex 프로파일 레이어. 앱이 띄운 세션만 이 프로파일을 쓰므로 사용자의 기존 Codex 설정은 건드리지 않는다 |

Claude 쪽도 같은 원칙이다. 사용자의 `~/.claude/settings.json`을 고치지 않고, `userData`에 둔
오버레이를 앱이 띄운 세션에만 지정한다.

## 플랫폼별 동작

**Linux PATH 탐색.** GUI에서 실행하면 데스크톱 환경이 물려주는 PATH에 `~/.local/bin` 같은 경로가
빠져 있어 CLI를 못 찾는 일이 잦다. 그래서 `/bin/bash --login`으로 로그인 셸의 PATH를 최대 3초 동안
읽는다. 실패하거나 시간이 지나면 상속 PATH + `~/.local/bin` + `/usr/local/bin` + `/usr/bin` + `/bin`을
쓴다 — 셸 시작 스크립트가 멈춰도 앱은 뜬다. Windows는 이 탐색을 하지 않는다.

**제어 서버.** jk-coding-cli가 앱에 말을 거는 통로다. Windows는 named pipe(`\\.\pipe\...`),
Linux는 실행할 때마다 새로 고르는 `127.0.0.1` 루프백 TCP 포트를 쓴다. endpoint와 토큰은 앱이 직접
띄운 자식 세션의 환경변수로만 전달되므로 다른 프로세스는 주소를 알 수 없다. 요청은 한 줄 JSON이고
1MiB를 넘으면 끊는다.

**상태 훅.** Claude 훅은 Windows에서 PowerShell, Linux에서 Python 3 스크립트로 생성된다.
Ubuntu DEB가 `python3`를 의존성으로 선언하는 이유다. Codex 훅은 양쪽 모두 Electron을 Node로
실행해 돌린다.
