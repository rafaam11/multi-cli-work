# Quick Open · Unread 배지 · 파일 드래그&드롭 (Orca 도입 2단계)

## 왜

에이전트 레지스트리(1단계)로 세션이 늘어날 길이 열렸다. 세션이 늘면 두 가지가 아프다:
**찾아가기**(사이드바 스크롤·클릭)와 **놓치기**(화면 밖 세션이 입력을 기다리는데 모른다).
Quick Open이 앞을, unread 배지가 뒤를 푼다. 드래그&드롭은 독립적인 작은 기능이라 이 단계에 얹었다.

## Quick Open (Ctrl+P)

- `quick-open.ts` — 순수 함수. 부분열(subsequence) 매칭에 연속 일치·단어 시작 보너스.
  점수 동률이면 호출자가 준 순서를 지킨다 — 그래서 같은 점수의 세션이 명령보다 앞선다.
- 검색 대상은 렌더러 상태에 이미 다 있다: 세션(최근 사용 순) · 폴더 · 명령(새 세션 ×
  설치된 에이전트, 홈, 에이전트 추가, 업데이트 확인). **새 IPC 없음.**
- 단축키는 **capture 단계** window 리스너다. 이 앱에서는 키보드를 보통 터미널이 쥐고
  있고(xterm이 keydown을 삼킨다), xterm보다 먼저 실행되는 리스너만이 Ctrl+P를 앱
  단축키로 만들 수 있다. `preventDefault + stopPropagation`으로 PTY에는 Ctrl+P가
  들어가지 않는다.

## Unread 배지

핵심 관찰: `attention-policy.ts`의 `unseen` 맵이 **이미 unread 상태 그 자체**였다.
"화면에 없는 세션이 주의 상태로 진입하면 넣고, 열면 뺀다"는 판정이 창 깜빡임을 위해
존재했고, 배지는 같은 데이터의 다른 표현일 뿐이다. 그래서 새 정책을 만들지 않고
추적기가 `AttentionSnapshot { window, unread }`를 반환하게 바꿨다.

- 스냅숏 하나가 모든 표면을 먹인다: 창 제목·깜빡임(기존), **작업표시줄 오버레이 점 +
  트레이 툴팁**(신규 `window-badge.ts`), **사이드바 점 배지**(`attention:event` 브로드캐스트
  + `attention:state` 초기 조회).
- 배지는 기다림이 **스스로 풀려도** 사라진다(세션이 working으로 복귀 등) — 아무도
  필요로 하지 않는 세션의 배지는 거짓말이다.
- 폴더 행은 하위 세션 중 **가장 급한 상태**(approval > input)를 올린다. 접힌 폴더가
  승인 대기를 숨기지 못하게.
- 오버레이 점은 픽셀 단위로 그린다(`attentionDotBitmap`) — nativeImage는 SVG를
  래스터화하지 못하고, 색상별 PNG를 미리 굽는 건 과하다. 순수 함수라 Electron 없이
  테스트된다. 색은 사이드바 상태 색과 같다(violet=input, amber=approval).
- `notification-policy.ts`는 건드리지 않았다 — 중복 알림 억제 규칙은 그대로다.

## 파일 드래그&드롭

- Electron 32에서 `File.path`가 제거됐다. preload의 `webUtils.getPathForFile`이
  드래그된 File을 절대 경로로 푸는 **유일한** 경로라 `files.pathFor`로 노출했다.
- 경로 인용·결합은 순수 함수(`drop-paths.ts`): 각 경로를 큰따옴표로 감싼다(Windows
  파일명에 `"`는 불가), 공백으로 잇고, 끝에 공백 하나 — 사용자가 이어서 타이핑한다.
- 삽입은 `terminal.paste()` — 기존 onData→write 경로와 bracketed paste를 그대로
  재사용하므로 CLI는 타이핑이 아니라 **한 덩어리 붙여넣기**로 받는다. 종료된 세션은
  무시하고, 경로 없는 File만 있으면 drop을 건드리지 않고 흘려보낸다.

## 검증

- `quick-open.test.ts` — 매칭·랭킹·동률 순서. `drop-paths.test.ts` — 인용·결합·빈 입력.
- `attention-policy.test.ts` — unread 진입/해제 전이. `window-badge.test.ts` — 비트맵
  알파·툴팁 문구. `ipc.test.ts` — `attention:state`.
- `App.test.tsx` — Ctrl+P 열기→검색→이동→Esc, 폴더/명령 항목, 배지 표시/해제,
  드롭→paste, 종료된 세션 드롭 무시.
- `e2e/desktop.spec.ts` — 실제 앱에서 Ctrl+P(터미널 포커스 상태에서)→"power" 검색→
  Enter→PowerShell 세션 전환.
- 수동: 드래그&드롭의 실제 `webUtils` 경로 해석과 작업표시줄 오버레이는 E2E로 잡히지
  않는다 — 계획의 P2 수동 시나리오로 확인한다.

## 다음

git worktree 병렬 세션(3단계: worktree → 프롬프트 팬아웃 → 읽기 전용 diff 뷰) →
터미널 2분할(4단계).
