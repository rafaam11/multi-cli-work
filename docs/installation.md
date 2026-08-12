# 설치

Windows 10 1809 이상과 Ubuntu 22.04 x64를 지원한다. macOS, Ubuntu 20.04 이하, x64가 아닌 CPU,
headless 환경은 현재 공식 지원 범위가 아니다 — 데스크톱 GUI 세션이 필요하다.

설치 파일은 [GitHub 최신 릴리스](https://github.com/rafaam11/multi-cli-work/releases/latest)에서 받는다.

## Windows

`Multi-CLI-Work-Setup-x.y.z.exe`를 실행한다. 사용자 단위 NSIS 설치라 관리자 권한이 필요 없고,
설치 경로를 바꿀 수 있다. 서명되지 않은 빌드라 SmartScreen이 뜨면 게시자를 확인한 뒤 진행한다.

## Ubuntu 22.04 x64

DEB가 기본 설치 방식이다.

```bash
sudo apt install ./Multi-CLI-Work-x.y.z-linux-x64.deb
```

DEB는 런타임 의존성을 선언한다 — `libgtk-3-0`, `libnotify4`, `libnss3`, `libxss1`, `libxtst6`,
`xdg-utils`, `libatspi2.0-0`, `libuuid1`, `libsecret-1-0`, 그리고 **`python3`**.
`python3`는 Claude 세션 상태 훅이 Linux에서 Python 스크립트로 생성되기 때문에 필요하다.

AppImage는 FUSE2 없이 도는 정적 runtime으로 빌드하므로 `libfuse2`를 따로 깔지 않아도 된다.

```bash
chmod +x Multi-CLI-Work-x.y.z-linux-x64.AppImage
./Multi-CLI-Work-x.y.z-linux-x64.AppImage
```

## 에이전트 CLI는 따로 설치한다

앱은 터미널을 띄우는 쪽이고, Claude Code와 Codex CLI 자체는 포함하지 않는다. PATH에서 찾지 못한
에이전트는 실행 버튼이 `미설치`로 비활성화된다. Linux GUI에서만 못 찾는다면 PATH 탐색
동작을 [로컬 데이터와 플랫폼 동작](local-data.md#플랫폼별-동작)에서 확인한다.

## 업데이트

앱은 시작할 때 한 번 조용히 새 릴리스를 확인하고, 있으면 자동으로 내려받는다. 사이드바 하단
배지가 진행 상황을 보여주고, 다 받으면 **재시작**을 누르는 순간 설치 후 앱이 다시 뜬다.
누르지 않아도 다음 종료 때 설치된다. 배지의 **확인**으로 즉시 확인할 수도 있다.

DEB로 설치한 경우에는 자리에서 교체할 수 없으므로, 새 DEB를 받아 위 명령으로 다시 설치한다.
개발 빌드(`npm run dev`)에는 업데이트 피드가 없어 항상 `idle`이다.

## 제거

- Windows — 설정 → 앱에서 제거하거나 설치 폴더의 언인스톨러를 실행한다
- Ubuntu — `sudo apt remove multi-cli-work`, AppImage는 파일을 지운다

제거해도 `~/.multi-cli-work/`의 레지스트리는 남는다. 완전히 지우려면 그 디렉터리와
`userData` 경로를 직접 삭제한다 — 목록은 [로컬 데이터와 플랫폼 동작](local-data.md)에 있다.
