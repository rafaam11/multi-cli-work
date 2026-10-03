# 원격 PC 이어받기(데스크톱 원격 창) 설계

> 상태: R1·R2·R3 구현됨 (2026-10-03)
> 범위: 한 PC의 multi-cli-work에서 다른 PC의 multi-cli-work가 돌리는 세션을 열어 이어서 작업하고, 세션을 만들고 정리하고, 입력 대기 알림을 받는다.
> 선행 설계: [모바일 컴패니언](2026-09-30-mobile-companion-design.md) — 호스트 서버·인증·프로토콜·웹 UI를 그대로 쓴다.

## 1. 목적과 전제

집에서 회사 PC(또는 반대)에 돌려 둔 claude/codex 세션에 **들어가 이어서 작업한다.** 폰 컴패니언이 하는 일을 키보드와 큰 화면이 있는 PC에서 한다.

전제:

- 두 PC가 **Tailscale** 로 같은 tailnet에 있다. 전송·인증은 모바일 컴패니언과 같다(Tailscale 주소 bind, 페어링 코드 → 기기 토큰). 릴레이·TLS는 만들지 않는다.
- **호스트는 데스크톱 앱이다.** 원격 PC의 앱이 꺼져 있으면 접속할 수 없다.
- 호스트를 **한 대씩 골라** 접속한다. 여러 PC의 세션을 한 목록으로 합치지 않고, 메인 창 그리드에 원격 세션을 섞지 않는다.
- 모든 PC는 호스트이면서 다른 PC의 클라이언트가 될 수 있다. 두 역할은 서로 독립이다.
- 두 PC의 앱 버전은 다를 수 있다(자동 업데이트 시점이 다르다).

## 2. 결정 요약

| 항목 | 결정 | 버린 대안 |
|---|---|---|
| 구조 | 원격 창 — 데스크톱 앱이 PC용 셸, 세션 화면은 호스트가 서빙한 UI를 별도 창에 로드 | 메인 창 그리드 통합(버전 맞춤 필요, 세션·저장 구조 전면 수정) / 브라우저만(알림 불가, Ctrl+W·T 충돌, 클립보드 제약) |
| 화면 | 기존 모바일 웹 UI에 넓은 화면 레이아웃 추가 | PC 전용 UI를 따로 만들기 |
| 터미널 크기 | 원격 창 크기에 PTY 자동 맞춤, "호스트 크기 유지" 토글 | 폰처럼 버튼을 눌러야 맞춤 |
| 세션 관리 | 새 세션·중지·재시작·삭제 | 보기·입력만 |
| 알림 | 클라이언트 main이 attach 없는 상태 연결 유지 | 호스트에 `mode: "status"`·`attention` 추가(구버전 호스트와 호환 안 됨, 폰 P3에서 다룸) |
| 토큰 보관 | `safeStorage` 암호문을 `userData/remote-hosts.json`에 | 평문 설정 파일 |
| 클립보드 | 브라우저 기본 이벤트, 읽기 브리지 없음 | 읽기·쓰기 브리지(원격 페이지가 이 PC 클립보드를 읽게 됨) |

## 3. 구조

```
[이 PC — 클라이언트 역할]                          [원격 PC — 호스트 역할]
main 프로세스
├ HostRegistry    userData/remote-hosts.json      RemoteServer (Tailscale bind, 기존)
├ pairHost        POST /pair ─────────────────▶   ├ POST /pair
├ RemoteWindows   호스트당 BrowserWindow           ├ GET /mobile/*  (웹 UI 번들)
│   └ loadURL http://<host>/mobile/ ◀──────────   └ WS /ws → RemoteSessionHub
│      preload: window.McwShell                                └ TerminalCoordinator
└ HostStatusLink  WS /ws, attach 없이 ─────────▶   status·created·exit·title 방송
메인 창 사이드바 "원격 PC" → 원격 창 열기
```

원격 창이 그리는 UI는 **호스트의 번들**이다. 화면과 서버가 항상 같은 빌드라서 두 PC의 앱 버전이 달라도 어긋나지 않는다. 버전이 엇갈릴 수 있는 면은 셸 브리지와 상태 연결 둘뿐이다(§8).

### 3.1 호스트 레지스트리와 페어링 — `src/main/remote-client/` (신규)

- `host-registry.ts`: `userData/remote-hosts.json`에 `{version: 1, hosts: [{hostId, name, address, deviceId, token, notify, addedAt}]}`.
  - `address`는 `"100.x.y.z:47821"` 형식, `token`은 `safeStorage` 암호문의 base64 또는 `null`, `notify` 기본값은 `true`.
  - 암호화는 `src/main/notion/notion-token-store.ts`의 `SafeStorageLike`를, 파일 쓰기는 기존 json-store의 atomic write를 쓴다. `safeStorage`를 쓸 수 없는 환경이면 호스트 추가를 거부한다.
  - 같은 `hostId`를 다시 추가하면 그 항목을 새 토큰으로 바꾼다.
  - 호스트가 토큰을 거절하면(철회) 항목은 남기고 `token`만 `null`로 바꾼다. 그런 호스트는 "다시 페어링 필요"로 표시하고, 원격 창과 상태 연결을 열지 않는다. 다시 추가하면 풀린다.
- `pair-host.ts`: 입력은 `{address, code}` 또는 `{uri}`(`mcw://pair?host=…&name=…&code=…&fp=…`, 형식은 `remote-access.ts`의 `pairingUri`).
  - 주소의 IP는 `isTailscaleAddress`(`src/main/remote/tailscale-address.ts`)를 통과해야 한다. loopback은 `MULTI_CLI_WORK_REMOTE_BIND`가 설정돼 있을 때만 허용한다(e2e·개발용). 호스트 설정이 보여 주는 `http://…/mobile/` 주소를 그대로 붙여 넣어도 받는다.
  - `POST http://<address>/pair {code, deviceName: os.hostname()}` → `{token, deviceId, hostId, hostName}`.
  - URI로 추가했으면 응답 `hostId`가 `fp`와 같아야 한다. 다르면 저장하지 않는다.
- 호스트 쪽 설정 화면에 **페어링 링크 복사** 버튼을 둔다(`pairUri` 문자열). 다른 PC에서는 QR을 찍을 수 없기 때문이다.

### 3.2 원격 창과 셸 브리지

- `src/main/remote-client/remote-windows.ts`: 호스트당 창 하나. 이미 열려 있으면 그 창을 앞으로 가져온다.
  - `http://<address>/mobile/`을 로드한다. 세션을 지정해 열 때는 `/mobile/#session=<sessionId>`.
  - 기본 1200×800, 최소 900×600, 제목은 `<호스트 이름> — 원격`. 닫으면 그 창만 닫힌다(앱은 트레이에 남는다). 앱 종료 때 함께 닫는다.
  - 창은 페이지 로드가 끝난 뒤에 보인다. 호스트가 15초 안에 응답하지 않으면 창을 버리고 연결 실패를 알린다. 로드 중에 다시 열면 새 창을 만들지 않고 그 로드의 결과를 같이 기다린다. 그동안 사이드바의 호스트 행은 "여는 중…"을 보인다.
- `src/preload/remote-shell.ts`: Android 셸과 같은 계약의 `window.McwShell`을 제공한다.

  | 메서드 | 동작 |
  |---|---|
  | `bridgeVersion()` | `1` |
  | `pairingJson()` | `{token, deviceId, hostName}` JSON. 동기 계약이라 `ipcRenderer.sendSync`로 main에 묻는다 |
  | `unpaired()` | 호스트가 토큰을 거절했다 → main이 그 호스트의 토큰을 비우고(§3.1) 창을 닫는다 |
  | `backToHosts()` | 창을 닫고 메인 창을 앞으로 가져온다 |

- 웹 UI는 `readShellBridge`(`src/renderer/src/mobile/shell-bridge.ts`)로 이미 이 계약을 읽는다. 브리지가 있으면 `PairScreen`을 건너뛰고 셸이 준 토큰으로 접속한다.
- `electron.vite.config.ts`의 preload `input`을 `{index, "remote-shell"}`로 바꾼다. `remote-shell.ts`는 `electron`과 type import만 쓴다 — sandbox preload는 분리된 청크를 `require`할 수 없다.

### 3.3 웹 UI의 넓은 화면 — `src/renderer/src/mobile/`

판정은 `matchMedia("(min-width: 900px) and (pointer: fine)")`. 셸 여부와 무관해서 PC 브라우저도 같은 화면을 얻는다. 좁은 화면의 동작은 바꾸지 않는다.

- `MobileApp.tsx`: 넓은 화면이면 `SessionList`(왼쪽 고정 폭)와 `SessionScreen`(오른쪽)을 나란히 둔다. `location.hash`의 `session=<id>`가 목록에 있으면 그 세션을 연다.
- `SessionScreen.tsx`(넓은 화면):
  - 빠른 키 바와 입력창을 접어 두고 버튼으로 펼친다. 키 입력은 `terminal.onData`로 이미 PTY에 간다.
  - 세션을 열면 터미널에 포커스를 준다.
  - 터미널 크기는 §6의 자동 맞춤.
  - 복사: 선택 영역이 있을 때 Ctrl+C 또는 Ctrl+Shift+C → `document.execCommand("copy")`. 데스크톱 `TerminalPane`과 같은 키 규칙이라, 선택이 없으면 Ctrl+C는 인터럽트로 PTY에 간다. 붙여넣기: Ctrl+V·Ctrl+Shift+V를 xterm이 가로채지 않게 해서 브라우저의 paste 이벤트가 xterm에 닿게 한다.
- 이 방식의 복사가 비보안 출처(http://100.x)에서도 동작하는 것을 e2e로 확인했다(R1). 그래서 쓰기 전용 `McwShell.copyText`는 넣지 않았고 `bridgeVersion`은 1이다. 읽기 메서드는 앞으로도 추가하지 않는다.

### 3.4 메인 창 UI

- `ProjectSidebar.tsx`의 `UpdateBadge` 위에 `RemoteHostsSection.tsx`: 등록된 호스트마다 한 행(이름). 클릭하면 원격 창을 연다. "다시 페어링 필요"인 호스트는 그렇게 표시하고, 클릭하면 설정의 "원격" 탭을 연다. 호스트가 없으면 섹션을 그리지 않는다.
- `SettingsDialog.tsx`의 탭 이름을 "모바일"에서 "원격"으로 바꾼다. `RemoteSettings.tsx`는 두 부분으로 나눈다.
  - **이 PC에 접속 허용** — 기존 내용(켜기·포트·상태·기기 목록·페어링 코드)과 페어링 링크 복사 버튼. 체크박스 문구는 "원격 접속 허용"이다. Android 셸 안의 안내 문구("설정 ▸ 모바일")는 다음 셸 릴리스에서 고친다 — 문구 하나로 `shellVersion`을 올리지 않는다.
  - **다른 PC에 접속** — 호스트 목록(이름·주소·알림 토글·열기·삭제)과 "PC 추가"(주소+코드 입력, 또는 페어링 링크 붙여넣기).
- IPC: `remote-hosts:list` · `add` · `remove` · `open` · `set-notify`, 이벤트 `remote-hosts:changed`. 렌더러로 가는 `RemoteHostInfo{hostId, name, address, notify, paired, addedAt}`에는 토큰이 없다.
- `PairScreen.tsx`의 안내 문구 "설정 ▸ 모바일"을 "설정 ▸ 원격"으로 고친다.

## 4. 보안

원격 창은 다른 기기가 서빙한 http 페이지를 이 앱 안에 띄운다. 그 페이지는 등록한 호스트의 것이고 Tailscale 안에서만 오지만, 이 PC의 자원에는 닿지 못하게 한다.

- **창 설정**: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webviewTag: false`, 호스트별 `partition`(메모리 세션).
- **탐색**: 등록된 호스트 출처로만. `window-security.ts`의 `secureBrowserWindow`가 판정 함수를 인자로 받게 고치고 `isSameOriginNavigation`을 추가한다(지금 구현은 http 탐색을 loopback에만 허용한다). `window.open`은 거부한다.
- **권한·다운로드**: 그 세션의 권한 요청을 모두 거부하고 다운로드를 막는다(호스트는 `/shell.apk`를 서빙한다).
- **토큰 전달**: `pairingJson` 요청을 main이 검사한다 — sender가 열려 있는 원격 창의 webContents이고, 메인 프레임이고, 프레임 URL의 출처가 그 창에 등록된 호스트 출처일 때만 그 호스트의 토큰을 준다. 그 밖에는 빈 문자열을 준다. 검사는 preload가 아니라 main에서 한다.
- **메인 창과의 격리**: main이 지금 "창은 하나"를 전제한 곳을 메인 창 기준으로 좁힌다.
  - `runtime.ts`의 `terminal:event` 방송 — 지금은 모든 창에 이 PC의 터미널 출력을 보낸다.
  - 알림 억제의 `windowState` — 지금은 아무 창이나 포커스가 있으면 로컬 세션 알림을 억제한다.
  - `attention:event`·`settings:changed`·`workspace:changed`·`navigation:session-requested` 방송, 대화상자·HTML 미리보기의 부모 창, `updater.ts`의 방송.
  - `registerMainIpc`의 핸들러는 메인 창 webContents가 보낸 요청만 받는다.
- **클립보드**: 이 PC의 클립보드를 읽는 브리지를 두지 않는다(§3.3).
- 전송 암호화는 Tailscale이 맡는다. 호스트 쪽 규칙(토큰 해시 저장, 철회 시 즉시 끊기, `/pair` 시도 제한)은 모바일 스펙 §4 그대로다.

## 5. 세션 관리 프로토콜 (R2)

`src/shared/remote-types.ts`에 **추가만** 한다. 이 메시지를 쓰는 UI와 hub가 같은 빌드에서 나오므로 `REMOTE_PROTOCOL_VERSION`은 올리지 않는다.

클라이언트 → 호스트:

| type | 필드 | 설명 |
|---|---|---|
| `catalog` | — | 새 세션에 쓸 프로젝트·에이전트 목록 요청 |
| `create` | `projectId, kind` | 프로젝트 루트에서 새 세션 시작 |
| `stop` | `sessionId` | 프로세스 중지. 세션은 목록에 남는다 |
| `resume` | `sessionId` | 끝난 세션을 같은 대화로 다시 시작 |
| `remove` | `sessionId` | 세션과 그 로그를 지운다 |

호스트 → 클라이언트:

| type | 필드 | 설명 |
|---|---|---|
| `catalog` | `projects: {id, name}[], agents: {id, label}[]` | 숨기지 않은 폴더와 `listAgents`의 에이전트 |
| `started` | `sessionId` | `create`·`resume`을 보낸 연결에만. UI가 그 세션을 연다 |
| `removed` | `sessionId` | 인증된 모든 연결에 방송 |

규칙:

- `create`·`resume`은 `coordinator.create/resume(input, { updateSelection: false })`로 부른다. 호스트 데스크톱의 선택과 그리드를 건드리지 않는다(제어 CLI의 선례, `runtime.ts`의 `controlContext.create`). 새 세션은 코디네이터의 `created` 이벤트로 호스트 렌더러와 다른 클라이언트의 목록에 나타난다.
- **크기는 호스트가 정한다.** 세션을 만드는 시점에는 클라이언트에 터미널이 없어 크기를 잴 수 없으므로 메시지에 크기를 싣지 않는다. 새 세션은 데스크톱과 같은 기본값(`DEFAULT_TERMINAL_SIZE`, 80×24)으로, 재시작은 그 세션의 마지막 크기(없으면 기본값)로 시작한다. hub가 그 크기를 `TerminalSizeArbiter.hostStarted`로 적어 `attached`의 `cols`·`rows`가 비지 않게 하고, 소유자는 호스트로 둔다 — 만든 기기가 소유자가 되지 않는다. 넓은 화면은 붙은 뒤 자동 맞춤이 가져가고, 폰은 "폰 크기로"를 켜야 가져간다. 기존 세션과 같은 규칙이다.
- `stop`·`resume`·`remove`는 attach 여부와 무관하게 받는다. `stop`은 돌고 있는 세션에만, `resume`은 끝난 세션(`exited`·`error`)에만 통한다 — 두 기기가 같은 세션을 볼 때 엇갈린 요청이 프로세스를 둘 띄우지 않게 한다. 실패는 기존 `error{code: "failed", message}`로 알리고, 웹 UI는 그 문구를 화면 아래 알림으로 보인다.
- 다시 시작한 세션을 보고 있던 화면은 다시 `attach`한다. 새 프로세스의 출력은 sequence를 처음부터 세기 때문이다. 신호는 `started`가 아니라 **목록에서 그 세션의 상태가 "끝남"에서 벗어나는 것**이다 — `started`는 요청한 연결에만 가므로, 다른 기기나 호스트가 재시작했을 때는 오지 않는다. 목록의 상태는 `created`가 실어 오는 새 상태로 바꾼다.
- 세션이 지워지면 hub는 크기 기록도 지운다(`TerminalSizeArbiter.forget`). 그 세션을 보던 화면이 닫히며 보내는 `detach`가 없는 PTY의 크기를 되돌리려다 실패로 돌아가지 않게 한다.
- **삭제**
  - `TerminalEvent`에 `{type: "removed", sessionId}`를 추가하고 `TerminalCoordinator.remove()`가 끝에서 발행한다.
  - 호스트 렌더러(`App.tsx`)는 이 이벤트로 목록에서 세션을 뺀다. 지금은 자기가 지운 세션만 안다.
  - `runtime.ts`는 이 이벤트에서 그 세션의 attention을 지운다.
  - 진행 중인 PR 리뷰 세션은 지울 수 없다. `ipc.ts`의 `terminals:remove`에 있는 검사를 함수로 빼서 IPC와 원격 경로가 같이 쓴다.
  - 웹 UI는 삭제 전에 화면 안에서 한 번 더 묻는다("삭제" → "정말 삭제 / 취소"). `window.confirm`은 Android WebView가 조용히 거절하므로 쓰지 않는다.
- 워크트리를 골라 만드는 것은 범위 밖이다. `create`는 프로젝트 루트만 받는다.

웹 UI: 목록 머리줄에 "새 세션"(`NewSessionForm.tsx` — 폴더·에이전트 선택, 누를 때 `catalog`를 다시 묻는다). 중지·재시작·삭제는 목록 행이 아니라 **세션 화면의 머리줄**에 둔다 — 폰의 목록 행에는 버튼 셋을 더 넣을 자리가 없다. `session-list-model.ts`에 `removed` 처리를 더한다. 폰에서도 같은 버튼이 보인다.

## 6. 터미널 크기

서버(`size-arbiter.ts`)는 바꾸지 않는다. 기기가 `resize`로 크기를 가져가고, 호스트 데스크톱이 그 세션에 입력하거나 패인 크기를 바꾸면 호스트가 되찾는 기존 규칙 그대로다.

넓은 화면의 `SessionScreen`은 **자동 맞춤**이 기본이다.

- 세션을 열면(`attached` 뒤) 터미널 영역에 맞는 `cols`·`rows`로 `resize`를 보낸다.
- 터미널 영역의 `ResizeObserver` 콜백을 150ms 디바운스해서 크기가 달라졌을 때만 `resize`를 보낸다.
- `size`·`attached`의 `sizeOwner`가 자기 기기가 아니게 되면(호스트가 되찾음) 자동 맞춤을 멈추고 "호스트가 크기를 가져갔습니다 · 다시 맞추기"를 보인다. 사용자가 그 버튼을 누르거나 창 크기를 바꾸면 다시 맞춘다. 멈춘 동안에는 `resize`를 보내지 않는다 — 호스트와 번갈아 크기를 바꾸는 일을 막는다.
  - 멈춘 동안의 재개 계기는 창의 `resize` 이벤트와 버튼뿐이다. 터미널 영역의 `ResizeObserver`는 맞추는 중에만 따른다: 호스트 크기로 그려진 터미널이 이 창을 넘치면 스크롤바가 생기고, 그것만으로 영역과 들어가는 열·행 수가 달라지기 때문이다(R1 e2e에서 확인).
  - 멈춤은 재연결로도 풀리지 않는다.
- "호스트 크기 유지" 토글을 켜면 `releaseSize`를 보내고 호스트의 열 수 그대로 그린다(넘치면 스크롤).
- 다른 세션으로 옮기거나 창을 닫으면 기존대로 `detach`가 가고 PTY는 호스트의 마지막 크기로 돌아간다.

자동 맞춤이 켜진 동안 호스트 PC 화면의 그 세션은 줄바꿈이 어긋나 보인다. 호스트에서 입력하거나 패인 크기를 바꾸는 순간 바로잡힌다.

## 7. 알림 (R3)

- `src/main/remote-client/host-status-link.ts`: 등록된 호스트마다 `ws://<address>/ws` 연결 하나를 유지한다. `hello{token, protocolVersion: 1, mode: "ui"}`를 보내고 **attach하지 않는다.** hub는 `sessions`·`status`·`title`·`exit`·`created`를 인증된 모든 연결에 보내고 `data`는 attach한 세션에만 보내므로, 터미널 출력 없이 상태만 받는다. 이미 배포된 v1.35.x 호스트에도 그대로 붙는다.
- `RemoteClient`(`src/renderer/src/mobile/remote-client.ts`)를 `src/shared/`로 옮겨 재연결·백오프를 같이 쓴다. main에서는 소켓 팩토리로 `ws`의 `WebSocket`을 넣는다. Node 클라이언트는 `Origin` 헤더를 보내지 않으므로 호스트의 Origin 검사를 통과한다.
- 링크는 페어링된 호스트 전부에 유지한다. `notify`가 꺼진 호스트도 사이드바 상태 표시를 위해 붙어 있고, 알림만 띄우지 않는다.
- 링크 상태: `connecting` · `open` · `reconnecting` · `incompatible`(4400 — 재시도하지 않음). 4401·4403을 받으면 그 호스트의 토큰을 비우고(§3.1) 링크를 닫는다.
- 세션이 `awaiting-input` · `awaiting-approval` · `exited` · `error`가 되면 다음을 순서대로 본다.
  1. 그 호스트의 `notify`가 켜져 있는가.
  2. 이 PC의 알림 설정 — `notifications.desktop`, 상태별 토글, `notificationsMuted`.
  3. 그 호스트의 원격 창에 포커스가 없는가.
  4. `createTerminalNotificationDeduper`(`notification-policy.ts`)가 같은 상태의 반복이 아니라고 하는가.

  모두 통과하면 Electron `Notification`을 띄운다. 제목은 `<호스트 이름> · <세션 이름>`, 본문은 로컬 알림과 같은 문구. 클릭하면 그 호스트의 원격 창을 `#session=<id>`로 연다.
- 사이드바의 호스트 행에 링크 상태(연결됨·연결 중·연결 끊김·버전이 맞지 않음)와 대기(`awaiting-*`) 세션 수를 보인다. 렌더러로 가는 `RemoteHostView`는 `RemoteHostInfo`에 `link`와 `awaiting`을 더한 것이고 `remote-hosts:changed`로 알린다.
- **알림은 상태가 바뀌는 메시지(`status`)에서만 낸다.** 연결할 때 받는 `sessions` 목록에 이미 기다리는 세션이 있어도 알리지 않는다 — 앱을 켜거나 다시 붙을 때 알림이 쏟아지지 않게. 그 수는 대기 수로만 보인다. 지금 알릴 수 없어(음소거, 원격 창 포커스) 건너뛴 것은 알린 것으로 치지 않는다.
- 연결이 끊긴 동안은 그 호스트의 세션을 모르는 것으로 본다(대기 수 0). 다시 붙으면 호스트가 목록을 새로 준다.
- main의 소켓은 `ws`다. `ws`는 듣는 곳 없는 `error`를 예외로 던지므로 `createStatusSocket`이 받아 두고, 뒤따르는 close가 재시도로 이어진다. 응답 없는 주소에 오래 매달리지 않게 핸드셰이크는 10초로 제한한다.
- 호스트 PC 앞에 사람이 있는지는 따지지 않는다. 이 PC에 사람이 없으면 알림은 해가 없다.

## 8. 버전 호환

| 면 | 규칙 |
|---|---|
| 원격 창 UI ↔ hub | 같은 빌드다. 규칙이 필요 없다 |
| 셸 브리지 | 웹 UI는 `bridgeVersion`과 메서드 존재 여부로 기능을 감지한다(모바일 스펙 §3.2). 구버전 호스트의 UI는 넓은 화면이 없으므로 폰 레이아웃으로 뜬다 |
| 상태 연결 ↔ hub | 상태 연결은 항상 `protocolVersion: 1`을 보낸다. 호스트 `authenticate`의 검사를 정확 일치에서 `REMOTE_MIN_PROTOCOL_VERSION ≤ v ≤ REMOTE_PROTOCOL_VERSION`으로 바꾼다. 서버 메시지는 추가만 하고, 클라이언트는 모르는 `type`을 무시한다 |

## 9. 단계

각 단계는 따로 쓸 수 있는 결과물을 낸다. 단계마다 별도 구현 계획을 쓴다.

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **R1** | 메인 창 격리(§4) + 호스트 레지스트리·페어링(§3.1) + 원격 창·브리지(§3.2) + 넓은 화면·자동 맞춤·클립보드(§3.3, §6) + 사이드바·설정(§3.4) | 호스트를 등록하고 원격 창을 열어, 창 크기에 맞는 터미널에서 키보드로 세션을 이어 작업한다. v1.35.x 호스트에도 폰 레이아웃으로 붙는다 |
| **R2** | 세션 관리 프로토콜과 UI(§5), 코디네이터 `removed` 이벤트 | 원격 창과 폰에서 세션을 새로 띄우고 중지·재시작·삭제하며, 호스트 화면이 따라 바뀐다 |
| **R3** | 상태 연결과 알림(§7), 버전 검사 완화(§8), 사이드바 대기 수 | 원격 창을 닫아 둔 채로 원격 세션의 입력 대기 알림을 받고, 누르면 그 세션이 열린다 |

## 10. 검증

- **vitest** (`--pool=threads`)
  - 탐색 출처 판정(`isSameOriginNavigation`), 메인 창이 아닌 sender의 IPC 거부.
  - 레지스트리: 가짜 `safeStorage`로 평문이 파일에 남지 않는지, 암호화 불가 시 추가 거부, 같은 `hostId` 교체, 거절된 호스트의 토큰 비우기.
  - 페어링: URI 파싱, Tailscale 밖 주소 거부, `fp` 불일치 거부, 401·429 처리.
  - 브리지 핸들러: 하위 프레임·다른 출처·등록되지 않은 webContents에 토큰을 주지 않음.
  - hub: `create`·`resume`의 `updateSelection: false`와 크기 소유 기록, `started`가 요청한 연결에만 감, `remove`의 PR 리뷰 보호와 `removed` 방송.
  - 상태 링크: attach 없이 상태만 받음, dedupe, 음소거, 원격 창 포커스 시 생략, 4400·4401 처리.
  - 웹 UI: 넓은 화면 2단, 해시 딥링크, 자동 맞춤이 소유를 잃으면 멈춤, `removed` 반영.
- **Playwright** `e2e/remote-window.spec.ts`: `e2e/mobile.spec.ts`의 구성을 따라 앱 하나가 `MULTI_CLI_WORK_REMOTE_BIND=127.0.0.1`로 **자기 자신을 호스트로 등록**한다. 코드 발급 → 호스트 추가 → `app.windows()`에서 원격 창 → 입력 에코 → 자동 맞춤 → 복사·붙여넣기 → (R2) 새 세션·중지·재시작·삭제와 메인 창 목록 반영 → (R3) 사이드바 대기 수. `e2e/mobile.spec.ts`는 수정 없이 통과해야 한다.
- **수동**: Tailscale로 묶인 두 PC에서 이어받기, 호스트에서 타이핑할 때 크기 회수, v1.35.4 호스트에 새 클라이언트 접속, 원격 창에 포커스를 둔 채 로컬 세션 알림이 뜨는지, `/shell.apk` 다운로드가 막히는지.

## 11. 범위 밖

- 여러 PC 세션 통합 목록, 메인 창 그리드에 원격 세션 섞기
- Tailscale 없는 접속, 릴레이, TLS, MagicDNS 이름으로 등록
- 워크트리를 골라 새 세션 만들기, 파일·diff·git 패널
- 폰 알림(Kotlin 포그라운드 서비스), 호스트의 `mode: "status"`·`attention` 메시지 — 모바일 P3
- 트레이·작업 표시줄 배지에 원격 대기 수 합치기
- 호스트 PC 화면에 "원격에서 크기 사용 중" 표시 — 모바일 P4
