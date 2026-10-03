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

## 모바일(Android) 컴패니언

폰에서 PC의 세션을 보고 조작하는 Android 앱이다. 데스크톱 설치본이 앱(APK)을 동봉해 직접 나눠준다.

- 요구: PC와 폰 모두 Tailscale에 로그인되어 있어야 하고, Android 12 이상(권장 14 이상)이어야 한다.
- 처음 설치: 설정 ▸ 원격에서 **원격 접속 허용**을 켜고 **기기 추가**를 누른다. 표시된 **앱 설치 QR**을 폰 카메라로 찍어
  APK를 내려받고, 설치 허용 안내가 뜨면 허용한 뒤 설치한다.
- 페어링: 앱의 **QR로 PC 추가**로 페어링 QR을 찍거나, 앱 밖에서 폰 카메라로 페어링 QR(`mcw://pair`
  딥링크)을 찍는다. 같은 PC를 다시 페어링하면 중복 없이 기존 항목이 갱신된다.
- 업데이트: 새 데스크톱 버전이 더 높은 셸을 동봉하면 앱 첫 화면에 배너가 뜬다. **업데이트**를 누른다.
  처음 한 번은 "이 출처의 앱 설치 허용"을 켜야 한다. 서명이나 해시가 설치본과 다르면 설치하지 않는다.

### 개발 빌드에서 동봉하기

릴리스 CI는 셸 APK를 항상 동봉한다. 반면 로컬 `npm run dist:*`는 `build/mobile`을 먼저 준비하지
않으면 셸을 **포함하지 않는다** — electron-builder가 경고만 하고 `resources/mobile` 없이 패키징한다.
로컬에서 동봉하려면 dist 전에 아래를 실행한다.

```powershell
cd android; .\gradlew.bat assembleRelease; cd ..; npm run mobile:prepare
```

### 서명 키 백업

> **`%USERPROFILE%\.multi-cli-work-signing\`을 반드시 백업한다.** 이 키를 잃으면 서명이 달라져
> 기존 앱을 업데이트할 수 없고, 폰에서 앱을 지우고 다시 깔아야 한다(저장된 호스트·토큰도 사라진다).

## 다른 PC에서 이어받기

한 PC에서 돌려 둔 세션을 다른 PC의 앱에서 열어 이어서 작업할 수 있다. 두 PC가 같은 Tailscale tailnet에
있어야 하고, 세션이 도는 PC(호스트)의 앱이 켜져 있어야 한다.

1. 호스트 PC: 설정 ▸ 원격에서 **원격 접속 허용**을 켜고 **기기 추가**를 누른다. **페어링 링크 복사**로
   링크를 복사하거나, 화면의 접속 주소와 코드를 적어 둔다. 코드는 5분 동안 한 번만 쓸 수 있다.
2. 이 PC: 설정 ▸ 원격 ▸ **다른 PC에 접속**에 링크를 붙여 넣거나 주소와 코드를 입력하고 **PC 추가**를 누른다.
3. 사이드바 아래 **원격 PC**에서 그 PC를 누르면 세션 화면이 별도 창으로 열린다.

원격 창의 터미널은 창 크기에 맞춰진다. 호스트 PC에서 그 세션에 입력하거나 패인 크기를 바꾸면 호스트가
크기를 되찾고, 원격 창에서 **다시 맞추기**를 누르거나 창 크기를 바꾸면 다시 맞춘다. 호스트 크기 그대로
보려면 **호스트 크기 유지**를 켠다. 복사는 Ctrl+Shift+C(선택 영역이 있으면 Ctrl+C도), 붙여넣기는 Ctrl+V다.

호스트 PC에서 이 PC의 연결을 해제하면 원격 창이 닫히고 목록에 "다시 페어링 필요"로 남는다. 2번을 다시
하면 풀린다.

올바른 키인지는 서명 인증서 SHA-256 지문으로 확인한다.

```
f313f9a57702bff47c5e2b6fa10b032e3f434513004ca14ca8834457ffb844e9
```

CI는 같은 키를 GitHub Secrets(`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`)로 받는다.

## 제거

- Windows — 설정 → 앱에서 제거하거나 설치 폴더의 언인스톨러를 실행한다
- Ubuntu — `sudo apt remove multi-cli-work`, AppImage는 파일을 지운다

제거해도 `~/.multi-cli-work/`의 레지스트리는 남는다. 완전히 지우려면 그 디렉터리와
`userData` 경로를 직접 삭제한다 — 목록은 [로컬 데이터와 플랫폼 동작](local-data.md)에 있다.
