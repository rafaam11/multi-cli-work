# 설정 창과 리매핑 가능한 단축키

## 문제

사용자 선호가 전부 코드에 하드코딩되어 있고, 바꿀 수 있는 창구가 없다.

- 터미널 폰트·크기·스크롤백·커서는 `TerminalPane.tsx`의 리터럴이다.
- 데스크톱 알림은 항상 켜져 있다. 세션이 많아지면 입력 대기 알림만으로도 피로해지는데
  줄일 방법이 없다.
- ✕는 항상 트레이로 숨고, 업데이트는 항상 시작 시 확인하며, 세션은 항상 자동 재개된다.
- 단축키는 `App.tsx`의 capture 리스너 세 곳에 흩어져 있고, `title-bar-menu.ts`의 표기는
  별도의 하드코딩 문자열이다 — 동작과 표기가 서로 다른 파일에 살아서 어긋날 수 있는 구조다.
- 키보드만으로 세션을 오갈 방법이 없다. 새로고침도 메뉴까지 가야 한다.

요구사항: 타이틀바 "도움말" 옆의 "설정" 진입점, 인앱 모달 설정 창, 일반·터미널·알림·단축키
네 카테고리, 그리고 단축키는 표시만이 아니라 **리매핑까지**.

## 동작

### 진입

- 타이틀바 메뉴줄의 "도움말" 오른쪽에 **"설정"** 이 선다. 드롭다운이 아니라 버튼이다 —
  누르면 메뉴가 펼쳐지는 대신 설정 창이 바로 열린다.
- `Ctrl+,`(리매핑 가능한 `settings.open` 액션)과 빠른 열기(Ctrl+P)의 "설정 열기" 명령도
  같은 창을 연다.

### 설정 창

`.modal-backdrop` 위의 다이얼로그다. 좌측 세로 내비(일반 · 터미널 · 알림 · 프로젝트 · 단축키), 우측 폼,
ESC나 바깥 클릭으로 닫힌다. **저장 버튼은 없다** — 컨트롤을 바꾸는 순간 저장되고 적용된다.

**일반**
- 언어: 한국어 / English. 지금은 선택을 저장할 뿐 UI는 계속 한국어다. 항목 설명에
  "다음 버전에서 적용"을 명시한다. i18n 도입은 별도 작업이다.
- 창 닫기(✕) 동작: 트레이에 남기기(기본) / 앱 종료.
- 시작 시 이전 세션 자동 재개: 켬(기본) / 끔.
- 시작 시 업데이트 자동 확인: 켬(기본) / 끔. 꺼도 도움말 > 업데이트 확인은 그대로 동작한다.

**터미널** — 살아있는 모든 세션에 즉시 반영된다.
- 폰트 패밀리(기본 Cascadia Code 스택), 크기 8~32(기본 13), 행간(기본 1.25).
- 스크롤백 1,000~100,000줄(기본 10,000).
- 커서 스타일 bar/block/underline(기본 bar), 커서 깜빡임(기본 끔).

**알림**
- 데스크톱 알림 마스터 토글(기본 켬).
- 상태별 토글: 입력 대기(기본 켬) · 승인 대기(기본 켬) · 종료(기본 끔) · 오류(기본 끔).
  종료·오류 알림은 이번에 새로 생기는 능력이지만 기본이 꺼짐이라, 설정을 건드리지 않은
  사용자에게는 오늘과 완전히 같은 동작이다. 배지·트레이·창 attention은 알림 설정과 무관하게
  지금처럼 동작한다 — 이 설정은 데스크톱 알림만 다스린다.

**프로젝트** (v1.29에서 추가)
- 업무 프로젝트 구분 목록: 이름(32자)·색(7색 팔레트)·순서·삭제(마지막 하나는 불가)와 기본 구분.
  기본 목록은 업무·개인·연구·기타. 이름을 바꾸거나 지워도 기존 프로젝트의 값은 그대로이고,
  목록에 없는 값은 회색으로 보인다. 저장 모델과 파서 규칙은 `settings-types.ts`의 `projects`.

**단축키**
- 카테고리별 액션 목록과 현재 키. 키를 클릭하면 캡처 모드로 들어가 다음 키 입력을 바인딩한다.
- 이미 쓰는 키를 넣으면 어느 액션과 충돌하는지 보여주고, 기존 바인딩을 해제할지 묻는다.
- 항목별 "기본값으로", 전체 "모두 초기화".
- 수식어 없는 단독 문자·숫자 키는 거부한다(터미널 입력과 충돌). F1~F12 같은 기능키는 단독 허용.
- `edit.copy`/`edit.paste`/`edit.select-all`/`edit.clear`는 목록에 **고정으로 표시**되고 리매핑할
  수 없다. 이 키들은 `TerminalPane`의 `attachCustomKeyEventHandler`가 터미널 자체 의미론
  (선택 없는 Ctrl+C는 인터럽트, Shift+Enter 대체 바이트)과 함께 처리하므로, 옮기면 표기만
  바뀌고 동작이 남는 반쪽 리매핑이 된다.

### 기본 키맵

기존 키는 전부 그대로다: Ctrl+P(빠른 열기), Ctrl+S(파일 저장), Ctrl+=/-/0(줌), F11(전체 화면),
F12(개발자 도구). 새로 생기는 것:

| 키 | 액션 |
|---|---|
| `Ctrl+1` ~ `Ctrl+9` | 현재 화면의 슬롯 1~9 포커스 (`workspace.focus-slot-N`) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 보이는 세션 순환 (`session.next` / `session.prev`) |
| `F5` | 선택된 세션 새로고침 (`session.refresh` — 액션은 이미 있고 키만 없었다) |
| `Ctrl+,` | 설정 열기 (`settings.open`) |

`Ctrl+0`은 줌 리셋이 이미 쓰므로 슬롯 포커스는 1~9다. 슬롯 번호는 그리드가 그리는 순서
(좌→우, 위→아래)와 같고, 현재 페이지에 보이는 슬롯만 대상이다.

### 저장

- userData의 `settings.json`. 기기별 선호이므로 `~/.multi-cli-work/`(기기 간 공유되는 홈
  레지스트리)가 아니라 `state.json` 옆이 맞다. 다만 state.json(런타임 상태)에 합치지는 않는다 —
  "창이 마지막에 어디 있었나"와 "사용자가 무엇을 원하나"는 초기화·복구 시나리오가 다르다.
- `json-store.ts` 프로토콜(락 → 원자적 rename → 검증된 `.bak`)을 그대로 쓴다.
- 파서는 관용적이다: 모르는 필드는 버리고 빠진 필드는 기본값으로 채운다. 버전 필드나
  마이그레이션 코드 없이 필드 추가·제거가 안전해진다.
- `keybindings`는 기본값과 다른 것만 `액션id → 키`(해제는 `null`)로 저장한다. 기본 키맵이
  바뀌는 업데이트에서 사용자가 안 건드린 키는 새 기본값을 따라간다.
- **기본값 전체가 현행 하드코딩 동작과 동일하다.** settings.json이 없는 기동은 오늘의 앱과
  구별할 수 없어야 한다.

## 구현 경계

**shared** — `settings-types.ts`: `AppSettings` 타입, `DEFAULT_SETTINGS`, 관용적
`parseSettings(unknown)`. 알림 상태 키는 `TerminalStatus`의 실제 값(`awaiting-input`,
`awaiting-approval`, `exited`, `error`)을 그대로 쓴다.

**main** — `settings/settings-store.ts`가 `JsonStoreSpec` 하나로 읽기·패치를 감싼다. IPC는
`settings:get` / `settings:update`(부분 패치, `ipc.ts`의 기존 검증 헬퍼로 범위 검사), 변경은
`settings:changed`로 전 창에 브로드캐스트(`updater.ts`의 publish와 같은 모양). 게이트 네 곳:

1. `index.ts`의 `window.on("close")` — `closeToTray`가 꺼져 있으면 hide 대신 종료.
2. `updater.ts` `initUpdater` — `autoCheckUpdates`가 꺼져 있으면 시작 시 자동 확인만 생략.
3. 알림 — `session-attention-controller.ts`가 지금은 `awaiting-input`/`awaiting-approval`에서만
   `notify`를 부른다. 여기의 상태 필터를 설정에서 읽고, `exited`/`error`가 켜졌을 때도 부르도록
   넓힌다. `runtime.ts`의 notify 구현에 두 상태의 본문 문구를 더한다. 마스터 토글은 notify
   진입에서 자른다. `notification-policy.ts`의 순수함수 구조를 유지해 테스트 가능하게 한다.
4. 세션 자동 재개 — `terminal-coordinator.ts`의 lazy auto-resume(attach가 interrupted 세션을
   되살리는 경로, `MAX_CONCURRENT_AUTO_RESUMES` 근처)에 `autoResumeSessions` 게이트를 둔다.
   꺼져 있으면 세션은 종료 상태로 그려지고, 수동 "재개"(세션 메뉴)는 그대로 동작한다.

**renderer**
- `SettingsDialog.tsx` 신규. 폼 상태는 App이 들고 있는 settings 복사본이고, 변경은
  `settings:update` → `settings:changed` 왕복으로 돌아온다(모달 자신도 브로드캐스트로 갱신).
- `keymap.ts` 신규: 액션 카탈로그(id · 한국어 label · 카테고리 · 기본 키 · terminalSafe ·
  리매핑 가능 여부), `normalizeEvent(KeyboardEvent) → "Ctrl+Shift+Tab"`, `resolveKeymap(오버라이드)`.
  액션 id는 `handleMenuAction`(App.tsx)의 스위치 케이스를 그대로 쓴다 — 카탈로그는 그 스위치의
  색인이지 새 실행 경로가 아니다.
- **디스패처 통합**: App.tsx의 capture keydown 세 곳(Ctrl+P · F11/F12/줌 · Ctrl+S)을 키맵을
  조회하는 리스너 하나로 합친다. capture 단계라 xterm보다 먼저 본다 — 터미널 포커스 중에도
  `terminalSafe` 액션은 여기서 잡고, 아니면 흘려보낸다. `attachCustomKeyEventHandler`는
  건드리지 않는다. 모달·텍스트 입력 포커스 중에는 슬롯 포커스류를 무시하는 가드를 디스패처
  한 곳에 둔다.
- `title-bar-menu.ts`: `shortcut` 하드코딩 문자열을 지우고 유효 키맵에서 표기를 파생한다.
  리매핑하면 메뉴 표기가 따라온다. `TitleBar.tsx`에는 entries 없는 버튼형 최상위 항목을 더한다.
- 신규 액션 구현: `workspace.focus-slot-N`은 현재 뷰의 N번째 슬롯 패인에 키보드 포커스,
  `session.next/prev`는 보이는 세션 순환. 실행은 전부 `handleMenuAction` 스위치에 케이스로 는다.

## 검증

1. `settings-store.test.ts` — 빈 파일·부분 파일·모르는 필드·범위 밖 값의 파싱, 패치 병합,
   `.bak` 폴백.
2. `keymap.test.ts` — 이벤트 정규화(수식어 순서·기능키·Shift 글리프), 오버라이드 해석, 충돌
   감지, 단독 문자키 거부.
3. `title-bar-menu.test.ts` 확장 — shortcut 표기가 키맵에서 나온다; 리매핑된 키가 반영된다.
4. `session-attention-controller.test.ts` / `notification-policy.test.ts` 확장 — 마스터 토글,
   상태별 토글, exited/error 기본 꺼짐.
5. `App.test.tsx` — Ctrl+1이 두 번째가 아니라 첫 번째 슬롯을 포커스한다; 입력 필드 포커스 중
   Ctrl+1은 무시된다; F5가 선택 세션을 새로고침한다.
6. e2e 1~2개 — 설정 열기 → 폰트 크기 변경 → xterm에 반영; F5 새로고침.
7. `npm run typecheck`, `npm run test`, `npm run test:e2e:smoke`.
8. 수동 — 트레이 끔 상태에서 ✕로 실제 종료, 알림 끔, 리매핑 후 메뉴 표기.

## 건드리지 않는 것

- i18n — 언어는 저장만 한다. 문자열 추출·번역은 별도 스펙.
- 라이트 테마 — 팔레트가 없다. 별도 작업.
- `edit.*` 단축키의 동작 — 터미널 의미론과 결합. 목록에 고정으로 보여만 준다.
- 에이전트 편집 — 도구 > 에이전트 추가가 이미 있다.
- Electron 네이티브 메뉴 — 계속 없음(`Menu.setApplicationMenu(null)`).
- `~/.multi-cli-work/` 레지스트리 형식과 `state.json`의 내용.
