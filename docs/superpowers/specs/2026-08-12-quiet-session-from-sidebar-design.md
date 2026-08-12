# 사이드바에서 화면을 바꾸지 않고 세션 추가

## 문제

세션을 만드는 모든 경로가 `startSession()`(`src/renderer/src/App.tsx`)을 거치고, 이 함수는 생성
직후 `revealSession()` → `revealPane()`를 호출한다. `revealPane()`은 슬롯 배정과 화면 이동을 한
덩어리로 수행하므로, 세션 하나를 추가하는 것만으로 다음이 함께 일어난다.

- `setWorkspaceIndex(null)` — 작업공간1/2/3을 보고 있었다면 거기서 튕겨나온다.
- `setSelectedProjectId` / `setSelectedWorktreeId` / `setPage(...)` — 다른 폴더의 그리드로 화면이
  갈아치워진다.
- `setFocusedPaneId(...)` — 키보드 포커스를 새 패인이 가져간다.

작업 중 세션을 하나 더 띄우려던 것뿐인데 보던 화면이 통째로 바뀌어 집중이 끊긴다.

## 동작

좌측 사이드바의 **폴더(프로젝트) 행과 worktree 행**을 우클릭하면 메뉴 최상단에 `새 세션` 블록이
나타나고, 에이전트를 고르면 세션이 즉시 시작된다. 이때

- 새 패인은 자기 폴더 그리드에서 다음 빈 슬롯을 받고 작업공간 선반에도 적재된다. 보고 있는 화면이
  그 그리드이고 빈 슬롯이 있으면 조용히 등장한다. 화면에 이미 있던 패인은 밀려나지 않는다.
- 페이지·선택·키보드 포커스·작업공간 인덱스는 그대로다. 사이드바 폴더 행의 3초 펄스가 세션이 어디에
  생겼는지 알려주는 유일한 신호다.
- 다음 실행 때 복원되는 선택(`selectedProjectId` / `selectedSessionId`)도 바뀌지 않는다. 사용자가
  가본 적 없는 세션이 재시작 후 열리는 것은 이 기능의 약속을 어기는 것이다.
- 에이전트 목록은 레지스트리(`agents.json` 포함)에서 온다. 실행 파일이 없는 에이전트는 보이되
  비활성 상태로 이유를 말한다. 루트가 사라진 폴더와 다른 작업이 진행 중인 상태도 같은 방식으로
  막힌다.

파일 트리의 하위 폴더는 이번 범위 밖이다. `CreateTerminalInput`이 이미 `projectId` / `worktreeId`로
cwd를 정하므로 cwd 오버라이드나 경로 검증은 필요 없다. git 폴더의 `메인` 노드는 컨텍스트 메뉴가
없고 폴더 행이 그 역할을 대신한다(worktreeId 없는 세션 = 메인).

## 구현 경계

**메인** — `CreateTerminalInput`에 `background?: boolean`을 추가하고, `ipc.ts`의
`validateCreateInput`이 이를 검증한 뒤 핸들러가
`coordinator.create(input, { updateSelection: input.background !== true })`로 넘긴다.
`LaunchOptions.updateSelection`은 control CLI가 이미 쓰던 옵션이고 `launch()`는 `=== false`만
검사하므로 기존 호출 경로의 동작은 변하지 않는다.

**렌더러** — `revealPane()`의 슬롯 배정 부분을 `placeInFolderView(target)`으로 추출한다.
`revealPane()`은 이를 호출한 뒤 기존 네비게이션을 이어가므로 동작이 같고, 새 경로가 같은 슬롯 규칙을
재사용한다. `startSessionInBackground(project, kind, worktreeId?)`는 `startSession()`과 같은 가드를
쓰되 `placeInFolderView` → `collectIntoWorkspace` → `flashFolder`만 호출하고 네비게이션 setter는
하나도 호출하지 않는다.

**메뉴** — `NewSessionMenuItems`가 두 메뉴가 공유하는 `새 세션` 블록을 렌더한다. 이 메뉴들에는
서브메뉴 인프라가 없으므로 `프로젝트로 이동`이 쓰는 `.context-menu-label` 패턴을 따라 평평한 그룹으로
둔다. 접힌 레일 버튼도 같은 `ProjectContextMenu`를 띄우므로 자동으로 따라온다.

**메뉴 위치** — 메뉴가 길어지면서 창 아래쪽에서 연 메뉴의 마지막 항목(파괴적 동작이 있는 자리)이
화면 밖으로 나가는 문제가 드러났다. `useClampedMenuPosition`이 마운트 직후 크기를 재서 메뉴를 창
안으로 되돌리고, 창보다 큰 메뉴는 `.context-menu`가 스크롤한다.

## 검증

1. `src/main/ipc.test.ts` — `background: true`면 `{ updateSelection: false }`로, 생략하면
   `{ updateSelection: true }`로 coordinator를 부른다. boolean이 아니면 거부한다.
2. `src/main/terminal/terminal-coordinator.test.ts` — `create(..., { updateSelection: false })`가
   저장된 `selectedProjectId` / `selectedSessionId`를 바꾸지 않는다.
3. `e2e/desktop.spec.ts` — 홈 대시보드를 띄운 상태에서 폴더 행을 우클릭해 세션을 시작하면 사이드바
   세션 행은 하나 늘고, 대시보드는 그대로이며 포커스도 옮겨가지 않는다.
4. `npm run typecheck`, `npm test`, `npm run test:e2e`.
