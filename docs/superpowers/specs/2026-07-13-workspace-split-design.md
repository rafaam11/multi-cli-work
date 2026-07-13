# 터미널 좌/우 2분할 (Orca 도입 4단계, 마지막)

## 왜

병렬 작업대의 마지막 조각. worktree(3단계)가 에이전트들을 격리하고 팬아웃이 일을 뿌렸다면,
분할은 **두 세션을 한 화면에서 지켜보는** 수단이다. Orca는 무한 분할을 하지만 우리는
**2분할까지만** — 에이전트 한 쌍을 비교하는 것이 용도이지, 타일링 윈도우 매니저가 아니다.

## 구조

- `WorkspaceSplit.tsx`는 **순수 레이아웃**이다. `TerminalPane`이 이미 자립적이라(각자 xterm·
  fit·resize 보고) 두 번 마운트하고 드래그 divider로 비율만 조절한다. 주 세션은 기존
  `selectedSessionId` 그대로 — 포커스·선택 로직을 흔들지 않는다.
- 보조 세션은 헤더의 분할 버튼 → 세션 목록에서 고른다. **종료된 세션도 후보다** — 읽기 전용
  스크롤백을 옆에 두고 비교하는 것이 바로 이 기능의 용도다. 분할 중 버튼은 한 번에 해제.
- 분할 세션을 사이드바에서 클릭해 주 세션으로 승격하면 분할은 접힌다 — 양쪽에 같은 세션을
  보여줄 이유가 없다.

## 영속화 — 또 한 번, 키 생략

`AppStateV1.splitSessionId`는 세션의 `worktreeId`와 같은 원칙이다: **분할 중일 때만 키가
존재한다.** 분할을 안 쓰는 사용자의 `state.json`은 바이트 하나 안 바뀌므로 구버전 롤백에
안전하다. 세션이 제거되면 함께 지워지고, 복원 시 세션이 사라졌으면 조용히 접힌다.

## 화면에 있는 세션은 조르지 않는다 (계획의 핵심 요구)

`shouldShowTerminalStatusNotification`의 가시성 판정이 `selectedSessionId`에 더해
`splitSessionId`를 본다 — 분할 창에 떠 있는 세션은 선택된 세션과 똑같이 "화면에 있는"
것이므로 Windows 알림도, unread 배지도 만들지 않는다. 분할을 여는 순간 그 세션의 기존
배지도 markSeen으로 지워진다(선택과 동일한 의미론). 창이 포커스를 잃으면 분할 여부와
무관하게 다시 알린다.

## 검증

- `notification-policy.test.ts` — 분할 세션은 화면에 있는 것으로 취급, 포커스 잃으면 예외 없음.
- `app-state.test.ts` — splitSessionId/worktreeId 라운드트립 + 미사용 시 키 부재.
- `terminal-coordinator.test.ts` — 분할 영속화, 모르는 세션 거부, 세션 제거 시 함께 소멸.
- `ipc.test.ts` — `terminals:split`이 좌표자와 markSeen을 모두 부른다.
- `App.test.tsx` — 분할 열기/닫기, 분할 세션 승격 시 접힘.
- `e2e/desktop.spec.ts` — 실제 ConPTY 세션 2개를 분할해 **양쪽에 각각 입력하고 출력이 서로의
  창에 새지 않는지** 확인. 재시작으로 종료된 세션을 재개해 양쪽 모두 살아 있는 상태로 검증.

## Orca 도입 계획 종결

이로써 승인된 도입 항목 8개가 전부 끝났다: 에이전트 레지스트리 → Quick Open → unread 배지 →
드래그&드롭 → worktree 병렬 세션 → 프롬프트 팬아웃 → diff 뷰 → 2분할. 보류: GitHub 연동
(worktree를 써본 뒤 재평가). 제외 유지: Mobile Companion · SSH 원격 · Design Mode/Computer
Use · Linear · headless CLI · 계정/사용량 추적.
