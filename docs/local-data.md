# 로컬 데이터와 플랫폼 동작

프로젝트·에이전트·worktree 레지스트리는 `~/.multi-cli-work/`에 있고 스키마 변경 없이 Windows와 Linux에서 읽힌다. Electron `userData` 아래에는 `state.json`, `session-logs/`, `provider-status/`, `hooks/`, `bin/`이 생성된다.

Linux GUI 실행에서는 `/bin/bash --login`으로 PATH를 최대 3초 동안 읽는다. 실패하면 상속 PATH와 `~/.local/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`을 사용한다.

Windows 제어 서버는 named pipe, Linux는 실행마다 선택한 `127.0.0.1` TCP 포트를 쓴다. endpoint와 token은 앱이 시작한 자식 세션에만 전달된다. 요청은 최대 1MiB의 한 줄 JSON이다.

Claude 상태 훅은 Windows에서 PowerShell, Linux에서 Python 3 스크립트로 생성되며 상태 파일은 임시 파일에서 원자적으로 교체된다.
