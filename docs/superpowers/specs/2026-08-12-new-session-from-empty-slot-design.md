# 빈 슬롯에서 최근 폴더로 새 세션 시작

## 문제

그리드에 프리셋 배치(`3열`, `2열 · 1분할` 등)를 고르면 세션 수보다 슬롯이 많아 빈 슬롯이 남는다.
그 빈 슬롯이 하는 말은 `WorkspaceGrid.tsx`의 한 덩어리가 전부다 — 슬롯 번호와
"세션 탭을 끌어다 놓기" 한 줄. 즉 **이미 존재하는 세션을 옮겨 담는 그릇**일 뿐이라, 새 작업을
시작하려면 사이드바에서 폴더를 찾아 우클릭하거나 헤더 런처로 가야 한다. 화면에서 가장 넓은
빈 자리가 정작 "여기서 시작"이라는 말을 못 하고 있다.

폴더에 세션이 하나도 없을 때는 `FolderStartPage`가 이 역할을 이미 한다. 비어 있는 것이 폴더가
아니라 **슬롯**인 경우가 이번 대상이다.

## 동작

빈 슬롯은 슬롯 번호와 드래그 안내 사이에 `＋ 새 세션` 버튼을 갖는다. 버튼을 누르면 버튼 아래에
최근 폴더 목록이 팝오버로 열린다.

```
┌────────────────────────────────┐
│ 최근 폴더                      │
│ multi-cli-work      ▣ ◈ ⌘ ⬢   │
│   └ feature/login   ▣ ◈ ⌘ ⬢   │
│ DtWorkbench         ▣ ◈ ⌘ ⬢   │
│ ChaksuReportSkill   ▣ ◈ ⌘ ⬢   │
└────────────────────────────────┘
```

- 목록은 **최근 활동순 상위 5개 폴더**다. 홈 대시보드의 빠른 실행과 같은 계산을 쓰므로 두 화면이
  말하는 "최근"이 갈라지지 않는다. 정렬 키는 그 폴더 세션들의 최대 `updatedAt`, 세션이 없으면
  `project.createdAt`이다.
- worktree가 있는 폴더는 브랜치 행이 폴더 행 아래에 들여쓰기되어 함께 나온다. 폴더 행은
  `worktreeId` 없는 세션(= 메인)을, 브랜치 행은 그 worktree의 세션을 시작한다.
- 에이전트 아이콘은 레지스트리(`AgentView[]`)에서 오므로 `agents.json`이 추가한 CLI도 그대로 나온다.
  실행 파일이 없는 에이전트는 보이되 비활성이고 이유를 title로 말한다. 루트가 사라진 폴더는 행 전체가
  비활성이고 사유는 "폴더를 찾을 수 없습니다". 다른 작업이 진행 중이면(`pendingAction`) 전부 비활성 —
  `NewSessionMenuItems`와 같은 규칙이다.
- 폴더가 하나도 없으면 "폴더를 열면 여기에 표시됩니다".
- 아이콘을 누르면 팝오버가 닫히고 세션이 **누른 그 슬롯에** 나타난다. 페이지·선택 폴더·활성 뷰는
  그대로다. 새 패인이 키보드 포커스를 받고, 사이드바의 해당 폴더 행이 3초 펄스한다.
- 시작한 세션은 자기 폴더의 그리드에도 자리를 받으므로 나중에 그 폴더로 갔을 때 이미 놓여 있다.
- `자동` 배치에는 빈 슬롯이 존재하지 않으므로(`slot-view.ts`의 `tidySlots`가 구멍을 없앤다) 이 기능은
  프리셋 배치에서만 보인다. 기존 드래그 안내와 같은 조건이다.
- 숨김 선반에서 눌러 시작하면 그 세션은 숨김에 들어간다 — 그 선반에 패인을 떨어뜨렸을 때와 같은
  의미론이라 예외를 두지 않는다.
- 드래그 안내 문구는 그대로 남는다. 슬롯이 여전히 드롭 대상이라는 사실을 말하는 유일한 줄이다.

## 구현 경계

**메인** — 변경 없다. `CreateTerminalInput`은 이미 `worktreeId`와 `background`를 받는다.

**최근 폴더** — `HomeDashboard`에 있던 `projectActivityTimestamp` / `quickLaunchProjects`를
`recent-folders.ts`의 `recentProjects(projects, sessions, limit)`로 **동작 변경 없이** 옮기고
양쪽이 이를 import 한다. 두 화면이 "최근"을 다르게 정의할 여지를 없애기 위한 추출이다.

**팝오버** — `NewSessionLauncher`는 `ProjectContextMenu`의 골격을 그대로 쓴다:
`className="context-menu new-session-launcher"`, `useClampedMenuPosition(x, y, ref)`,
바깥 mousedown/Escape로 닫기. 새 위치 계산 코드는 없다. 폴더 목록은 이미 최근순으로 걸러져서
들어오고, worktree는 전체를 받아 컴포넌트가 `projectId`로 거른다.

**빈 슬롯** — `WorkspaceGrid`에 `onRequestNewSession(index, anchor)` prop을 더한다. 앵커는
포인터가 아니라 **버튼의 `getBoundingClientRect()`** 에서 잡는다. 키보드로 눌러도 제자리에 뜨게
하려면 포인터 좌표를 쓸 수 없다.

**배선** — `App`이 `{ index, x, y }` 한 조각을 상태로 들고 있다가 팝오버에 넘긴다.
`startSessionInSlot(project, kind, worktreeId, slotIndex)`는 `startSessionInBackground`와 같은
가드·같은 `background: true` create를 쓰되, 배치를 두 번 한다.

```ts
placeInFolderView({ paneId: created.id, projectId: project.id, worktreeId });
placePaneOnCurrentView(created.id, (view) => placeInSlot(view, absoluteSlot(slotIndex), created.id));
```

순서가 중요하다. 첫 호출이 그 세션의 **폴더 그리드**에 자리를 주고, 둘째 호출이 **지금 보고 있는
뷰**의 그 슬롯으로 넣는다. 보고 있는 뷰가 마침 그 폴더의 그리드이면 둘째가 첫째의 자리를 눌러
쓴다 — `placeInSlot`이 옛 슬롯에서 빼고 넣기 때문이다. `absoluteSlot`이 페이지 오프셋을 더하므로
2페이지에서 눌러도 1페이지의 같은 번호가 아니라 맞는 슬롯에 들어간다.

작업공간 선반의 자동 수집 effect는 같은 배치에서 이미 선반에 올라간 패인을 건드리지 않으므로
중복 배치는 생기지 않는다.

**CSS** — `.context-menu button`이 `grid-template-columns: 17px minmax(0, 1fr)`(체크 표시 자리)로
두고 있어, 아이콘 하나뿐인 런처 버튼은 그대로 두면 중심에서 밀린다.
`.new-session-launcher .new-session-row-actions button`이 이를 `minmax(0, 1fr)`로 되돌린다.

## 검증

1. `recent-folders.test.ts` — 최근 세션 `updatedAt` 내림차순 정렬, 세션 없는 폴더는 `createdAt`
   사용, 상한 5개, 입력 배열 불변. 기존 `HomeDashboard.test.tsx`의 빠른 실행 테스트가 계속 통과하는
   것으로 추출이 동작을 바꾸지 않았음을 확인한다.
2. `NewSessionLauncher.test.tsx` — worktree 행이 자기 폴더 그룹 안에 들어간다; 아이콘 클릭이
   `onStart(project, agentId, worktreeId)`를 정확한 인자로 부른다; 미설치 에이전트와 루트 누락
   폴더가 각각의 사유로 비활성이다; 폴더가 없을 때의 문구; Escape/바깥 클릭으로 닫힌다.
3. `WorkspaceGrid.test.tsx` — 빈 슬롯이 버튼과 드래그 안내를 함께 그리고, 클릭이 슬롯 인덱스와
   버튼 rect로 `onRequestNewSession`을 부른다.
4. `App.test.tsx` — 다른 폴더의 세션을 2번 슬롯에서 시작하면 그 슬롯에 들어오고 1번 패인은
   제자리이며 선택 폴더는 그대로다; 2페이지에서 시작해도 맞는 슬롯에 들어가고 1페이지는 변하지
   않는다; 루트가 사라진 폴더는 create를 부르지 않는다.
5. `npm run typecheck`, `npm test`.

## 건드리지 않는 것

- `FolderStartPage` — 폴더에 세션이 0개일 때의 화면.
- 드래그 앤 드롭·스냅 존·배치 프리셋 로직.
- 메인 프로세스와 IPC.
