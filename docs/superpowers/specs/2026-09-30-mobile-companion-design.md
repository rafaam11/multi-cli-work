# 모바일(Android) 컴패니언 설계

> 상태: 설계 확정 (2026-09-30 인터뷰) · 구현 전
> 범위: 데스크톱 multi-cli-work를 호스트로 삼아 Android 폰에서 세션을 감시·조작하고 알림을 받는다.

## 1. 목적과 전제

외출 중에도 호스팅 PC에서 돌고 있는 claude/codex 세션을 **보고, 입력하고, 입력 대기·작업 완료 알림을 받는다.** 세 가지 용도의 비중은 비슷하다.

전제:

- 폰과 PC가 **Tailscale** 로 같은 tailnet에 있다 (sunshine-moonlight와 같은 방식). 공인 인터넷 노출·릴레이 서버는 만들지 않는다.
- **데스크톱 앱이 호스트다.** 트레이에 상주하는 multi-cli-work 안에 원격 서버가 있고, 앱이 꺼져 있으면 폰도 쓸 수 없다. 별도 헤드리스 데몬은 만들지 않는다.
- 폰은 **여러 PC**(집·회사 등)를 등록해 두고 골라 접속한다. 여러 PC의 세션을 한 목록으로 합쳐 보이지는 않는다.
- Android 설치형 앱(APK)으로 배포하고 이 레포에서 버전 관리한다. **최초 설치 이후 APK를 손으로 다시 받지 않는다.**

## 2. 결정 요약

| 항목 | 결정 | 버린 대안 |
|---|---|---|
| 업데이트 구조 | 얇은 네이티브 셸 + 호스트가 모바일 UI 서빙 | UI 내장 + OTA (PC별 버전 불일치 관리 필요) |
| 셸 기술 | Kotlin + WebView | Capacitor (원격 URL·포그라운드 서비스가 결국 네이티브) |
| 화면 | 실제 터미널(xterm) + 입력창·빠른 키 바 | 채팅형 파싱 UI (CLI별 파서, 깨지기 쉬움) |
| 화면 크기 | 기본 PC 크기 유지, 폰에서 "폰 크기로" 선택 | 항상 폰 크기 / 항상 PC 크기 |
| 알림 | 포그라운드 서비스가 상태 전용 WS 유지 | FCM(외부 의존), ntfy |
| 인증 | Tailscale 주소에만 bind + QR 페어링 기기 토큰 | Tailscale만 신뢰 |
| APK 버전 | 데스크톱 `v*` 릴리스에 동봉, 셸은 독립 shellVersion | 별도 `android-v*` 태그 |
| MVP 기능 | 세션 목록·상태, 세션 보기·입력 | 새 세션 시작·종료, 파일·diff 보기 (후속) |

## 3. 구조

```
[Android 폰]                                    [호스팅 PC — 데스크톱 multi-cli-work]
┌──────────────────────────┐   Tailscale     ┌─────────────────────────────────────┐
│ Kotlin 셸 (APK)           │  (100.x, WG암호화)│ RemoteServer (main 프로세스, 신규)   │
│ ├ 호스트 목록·QR 페어링   │ ◀─────────────▶ │ ├ Tailscale 주소에만 bind, 기본 OFF  │
│ ├ 포그라운드 서비스       │   HTTP + WS     │ ├ 기기 토큰 인증(페어링·철회)        │
│ │  (상태 WS 유지→알림)    │                 │ ├ GET /mobile/*  → 모바일 웹 번들    │
│ ├ 셸 자가 업데이트        │                 │ ├ GET /install, /shell.apk           │
│ └ WebView ───────────────┼─ 로드 ─────────▶│ └ WS /ws → TerminalCoordinator       │
│    (호스트가 준 모바일 UI) │                 │                                      │
└──────────────────────────┘                 └─────────────────────────────────────┘
```

### 3.1 RemoteServer — `src/main/remote/` (신규)

- main 프로세스 안의 HTTP + WebSocket 서버. 설정 "모바일 연결"을 켜야 listen한다(**기본 OFF**).
- bind 주소: `os.networkInterfaces()`에서 `100.64.0.0/10` 대역 IPv4만. 없으면 listen하지 않고 설정 화면에 "Tailscale 미감지"를 표시한다. `0.0.0.0` bind는 하지 않는다. 포트 기본값은 설정에 둔다.
- `TerminalCoordinator`(`src/main/terminal/terminal-coordinator.ts`)의 `list` · `attachForRenderer` · `write` · `resize` · `onEvent`를 쓰는 **두 번째 클라이언트**다. `ipc.ts`가 렌더러에 해 주는 일을 WS로 똑같이 한다. PTY 워커·링 버퍼는 바꾸지 않는다.
- 라우트:
  - `GET /mobile/*` — 모바일 웹 번들(정적)
  - `GET /install` — 최초 설치 안내 페이지 + APK 다운로드 링크
  - `GET /shell.apk`, `GET /shell.json` — 설치본에 동봉된 셸 APK와 메타데이터
  - `POST /pair` — 일회용 코드 → 기기 토큰 교환
  - `WS /ws` — 세션 프로토콜(§5)
- 앱 종료 시 `runtime-disposal`/`quit-coordinator` 흐름에 서버 close를 끼운다.

### 3.2 모바일 웹 UI — `src/mobile/` (신규)

- electron-vite 설정에 렌더러 엔트리를 하나 더 추가해 빌드한다. React + xterm.js(fit·search addon) 코드는 렌더러와 공유할 수 있는 부분을 공유한다.
- 화면:
  1. **세션 목록** — 프로젝트별 그룹, 상태 배지(working / awaiting-input / awaiting-approval / idle / exited), 제목.
  2. **세션 화면** — xterm + 여러 줄 입력창(전송 시 bracketed paste 후 Enter) + 빠른 키 바 `Esc` `Tab` `↑` `↓` `Enter` `Ctrl+C` `1` `2` `3` `/` + 상단 "📱 폰 크기로" 토글.
- 데스크톱 설치본에 들어가므로 **데스크톱이 electron-updater로 업데이트되면 폰 UI도 함께 바뀐다.** PC마다 버전이 달라도 각 PC가 자기 버전의 UI를 서빙하므로 호환성 문제가 없다.
- 셸 없이 폰 브라우저로도 동작한다(토큰 수동 입력). P1은 이 형태로 검증한다.
- 셸 기능은 `window.McwShell?.bridgeVersion`으로 감지하고, 없거나 낮으면 해당 기능을 숨기거나 업데이트를 안내한다.

### 3.3 Kotlin 셸 — `android/` (신규 Gradle 프로젝트)

- 네이티브 화면은 **호스트 목록 · QR 페어링 · 설정**뿐이다. 세션은 WebView로 `http://<host>:<port>/mobile/`을 로드한다.
- 호스트별 `{id(fp), 이름, 주소, 토큰}`을 저장하고, 토큰은 Android Keystore 키로 암호화한다.
- JS 브리지 `window.McwShell`: `bridgeVersion`, 알림 딥링크 전달, 진동, 호스트 목록으로 돌아가기.
- 호스트 주소가 Tailscale IP라 cleartext HTTP를 허용한다(network security config). WebView는 등록된 호스트 origin 외로 이동하지 않는다.
- 포그라운드 서비스(§7)와 자가 업데이트(§8)를 가진다.

## 4. 페어링과 보안

1. 데스크톱 설정 → "모바일 연결" → **기기 추가**를 누르면 5분 유효한 일회용 코드로 QR을 만든다.
   `mcw://pair?host=<tailscale-ip>:<port>&name=<PC 이름>&code=<일회용 코드>&fp=<호스트 ID>`
2. 같은 화면에 최초 설치용 `http://<tailscale-ip>:<port>/install` QR을 함께 보여준다. 폰 브라우저로 APK를 받는 건 **이때 한 번뿐**이다.
3. 셸이 QR을 스캔 → `POST /pair {code, deviceName}` → 호스트가 256bit 기기 토큰을 발급한다. 코드는 한 번 쓰면 폐기된다.
4. 호스트는 토큰의 **해시만** `~/.multi-cli-work/remote-devices.json`에 둔다(`{deviceId, name, tokenHash, createdAt, lastSeenAt}`). 기존 storage 계층의 atomic write를 쓴다.
5. 설정에 기기 목록(이름·마지막 접속)과 **철회** 버튼을 둔다. 철회하면 그 기기의 열린 WS를 즉시 끊는다.

규칙:

- 토큰은 WS `hello` 메시지로만 보낸다. URL 쿼리에 넣지 않는다. HTTP 정적 경로(`/mobile/*`, `/install`, `/shell.*`)는 인증 없이 열려 있고, 세션 데이터는 WS 인증 뒤에만 흐른다.
- `/pair`는 IP당 시도 횟수를 제한하고, 실패가 이어지면 해당 페어링 코드를 무효화한다.
- WS 핸드셰이크에 `Origin` 헤더가 있으면 호스트 자신의 origin이어야 한다(WebView는 호스트가 서빙한 페이지라 같은 origin). 셸의 네이티브 상태 연결은 `Origin`이 없고, 토큰으로만 인증한다.
- 전송 암호화는 Tailscale(WireGuard)이 맡는다. TLS는 두지 않는다.

## 5. WS 프로토콜

JSON 메시지, 연결 시 첫 메시지는 반드시 `hello`. `protocolVersion`은 정수이며, 모바일 UI와 서버가 같은 빌드에서 나오므로 불일치는 셸의 상태 전용 연결에서만 의미가 있다.

클라이언트 → 호스트:

| type | 필드 | 설명 |
|---|---|---|
| `hello` | `token, protocolVersion, shellVersion?, mode: "ui" \| "status"` | 인증. `status`는 알림 전용 연결 |
| `list` | — | 세션 목록 요청 |
| `attach` | `sessionId, lastSequence?` | 세션 붙기. `lastSequence`가 있으면 이어받기 시도 |
| `detach` | `sessionId` | 떼기(크기 소유 반환 포함) |
| `write` | `sessionId, data` | 입력 |
| `resize` | `sessionId, cols, rows` | "폰 크기로" 켜진 동안만 보냄 |
| `releaseSize` | `sessionId` | "폰 크기로" 끄기 |

호스트 → 클라이언트:

| type | 필드 |
|---|---|
| `welcome` | `hostId, hostName, protocolVersion, shellLatest{versionCode, versionName, sha256}` |
| `sessions` | `TerminalSessionView[]` (projectId·제목·상태 포함) |
| `attached` | `sessionId, replay, sequence, cols, rows, sizeOwner` |
| `data` | `sessionId, data, sequence` |
| `status` / `title` / `exit` / `created` | 기존 `TerminalEvent`와 같은 모양 |
| `size` | `sessionId, cols, rows, sizeOwner` |
| `attention` | `sessionId, kind: "awaiting-input" \| "awaiting-approval" \| "done", title, desktopFocused` |
| `error` | `code, message` |

- `mode: "status"` 연결에는 `sessions`·`status`·`title`·`exit`·`created`·`attention`만 보내고 `data`는 보내지 않는다.
- 재연결: `attach{lastSequence}` → 서버는 링 버퍼로 이어 줄 수 있으면 그 뒤의 `data`만, 아니면 전체 `replay`를 담은 `attached`를 보낸다.
- 서버는 30초 간격 ping, 셸·UI는 끊기면 지수 백오프로 재연결한다.

## 6. 화면 크기 ("폰에서 선택")

PTY는 크기가 하나뿐이다.

- **기본: PC 크기 유지.** 폰 xterm은 `attached`/`size`에 담긴 PC의 cols·rows 그대로 렌더하고, 핀치 줌·가로 스크롤로 본다.
- **"📱 폰 크기로" 켜기:** 폰 폭에 맞춘 `resize`를 보낸다. 호스트는 세션별 `sizeOwner = deviceId`를 기록하고, 데스크톱 렌더러에 알려 해당 패인에 "폰에서 크기 사용 중" 표시를 띄운다.
- **PC가 회수하는 경우:** 데스크톱에서 그 패인에 포커스나 입력이 들어올 때, 폰이 `releaseSize`/`detach`를 보낼 때, 폰 WS가 끊길 때. 이때 호스트가 데스크톱의 마지막 크기로 되돌리고 `sizeOwner = "desktop"`으로 바꾼 뒤 `size`를 방송한다.
- 구현 지점: 데스크톱 렌더러의 resize 경로(→ `TerminalCoordinator.resize`)에 "데스크톱 크기 기억"과 "포커스 시 회수" 훅을 추가한다.

## 7. 알림

- 셸의 **포그라운드 서비스**가 등록된 호스트 전부에 `mode: "status"` WS를 유지한다(상주 알림 아이콘 1개). 터미널 데이터는 받지 않는다.
- 호스트는 기존 `notification-policy.ts`(`shouldShowTerminalStatusNotification`, `createTerminalNotificationDeduper`)와 `session-attention-controller.ts`의 판단 결과를 `attention` 이벤트로 내보낸다. 폰이 따로 판단하지 않는다.
- 셸은 `attention`을 받으면 Android 알림을 띄우고, 알림을 탭하면 해당 호스트·세션 화면으로 딥링크한다.
- `desktopFocused`가 true(데스크톱 창에 포커스)면 폰 알림을 생략한다. 셸 설정에서 끌 수 있고, 기본은 켜짐이다.
- 배터리 최적화 예외 요청은 셸 설정에서 안내만 하고 강제하지 않는다.

## 8. 릴리스와 자가 업데이트

### 8.1 버전

- 데스크톱은 기존대로 `package.json` 버전과 `v*` 태그를 쓴다.
- 셸은 `android/version.properties`에 **독립** `shellVersionCode` / `shellVersionName`을 둔다. 셸 코드가 바뀐 릴리스에서만 올린다. 데스크톱 릴리스마다 폰에 업데이트 알림이 뜨지 않도록 하기 위해서다.
- 릴리스 노트(`docs/release/v*.md`)에 셸 버전 변경을 적는다.

### 8.2 빌드 파이프라인 (`.github/workflows/release.yml`)

- `android` 잡 추가: JDK 17 + Gradle로 서명된 release APK(`Multi-CLI-Work-Mobile-<shellVersionName>.apk`)와 `shell.json{versionCode, versionName, sha256}`을 만든다.
- windows·linux 잡은 `needs: android`로 APK 아티팩트를 받아 electron-builder `extraResources`로 `mobile/shell.apk`, `mobile/shell.json`을 설치본에 넣는다.
- draft-release에 APK도 첨부한다(백업 설치 경로).
- 서명 키: 로컬에서 한 번 생성해 GitHub Secrets(`ANDROID_KEYSTORE_B64`, 비밀번호들)와 개인 백업(비밀번호 관리자 + 오프라인 사본)에 둔다. **키를 잃어버리면 기존 설치본을 업데이트할 수 없고 삭제 후 재설치해야 한다.** 백업 확인을 P2 완료 조건에 넣는다.

### 8.3 셸 자가 업데이트 흐름

1. `welcome.shellLatest.versionCode` > 설치된 versionCode이면(호스트가 여러 대면 가장 높은 값) 호스트 목록 상단에 "셸 업데이트" 배너를 띄운다.
2. 그 호스트의 `/shell.apk`를 내려받아 `sha256`을 대조하고, APK 서명 인증서가 설치본과 같은지 확인한다.
3. `PackageInstaller` 세션으로 설치한다. Android 12+에서는 `setRequireUserAction(USER_ACTION_NOT_REQUIRED)`를 요청한다. 조건이 맞지 않으면 시스템 확인 탭이 한 번 뜬다.
4. 최초 1회는 "이 출처의 앱 설치 허용"을 켜야 한다(`REQUEST_INSTALL_PACKAGES`). 셸이 설정 화면으로 안내한다.

**자가 업데이트는 처음 배포하는 APK에 반드시 들어가야 한다.** 빠지면 다음 버전도 손으로 설치해야 한다.

## 9. 단계

각 단계는 따로 쓸 수 있는 결과물을 낸다. 단계마다 별도 구현 계획을 쓴다.

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **P1** | RemoteServer(설정 토글·Tailscale bind·기기 토큰·WS 프로토콜) + 모바일 웹 UI(목록·세션·입력·빠른 키·크기 토글) + 데스크톱 설정 화면(페어링 코드는 텍스트로 표시) | 폰 브라우저에서 Tailscale IP로 접속해 토큰으로 세션을 보고 입력할 수 있다 |
| **P2** | Kotlin 셸 v1(QR 페어링·다중 호스트·WebView·자가 업데이트) + release.yml `android` 잡 + APK 동봉 + 데스크톱 QR 표시 | 설치본 하나로 페어링·접속되고, shellVersion을 올린 테스트 빌드로 업데이트 1사이클이 성공한다. 서명 키 백업을 확인했다 |
| **P3** | 포그라운드 서비스 + `attention` 이벤트 + 알림 딥링크 + 포커스 억제 | 폰이 잠긴 상태에서 입력 대기 알림을 받고, 탭하면 그 세션이 열린다 |
| **P4** | 크기 소유 UX 다듬기, 기기 관리 UI 개선, 후속 기능 후보(새 세션 시작·종료, 파일·diff 보기) 검토 | — |

## 10. 검증

- **vitest** (`--pool=threads`): RemoteServer의 토큰 인증·철회 즉시 차단, 페어링 코드 만료·일회성·rate limit, Tailscale 외 주소 bind 거부, `attach{lastSequence}` 이어받기와 전체 replay 분기, `sizeOwner` 전이(폰 resize → 데스크톱 포커스 회수 → WS 끊김 회수), `status` 모드에 `data`가 흐르지 않음.
- **Playwright**: 모바일 뷰포트로 서빙된 `/mobile/`에 접속해 목록 → 세션 → 입력 → 빠른 키 → 크기 토글을 e2e로 확인한다.
- **Kotlin 단위 테스트**: QR URI 파싱, 버전 비교(여러 호스트 최대값), sha256 검증.
- **실기기 체크리스트**: Tailscale 켠 폰에서 접속, 잠금 상태 알림, 업데이트 1사이클, Windows 방화벽의 첫 listen 허용 프롬프트 안내 문구.

## 11. 범위 밖

- Tailscale 없는 공인 인터넷 접속, 릴레이 서버, TLS
- iOS
- 여러 PC 세션 통합 목록
- 새 세션 시작·종료, 파일·diff·git 패널 (P4에서 검토)
- 헤드리스 호스트 데몬
