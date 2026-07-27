# Stale worktree 자동 정리

## 문제

`git worktree list --porcelain`이 프로젝트 루트만 반환해도
`~/.multi-cli-work/worktrees.json`에 과거 worktree 항목이 남아 있으면 사이드바가 이를
`missing` worktree로 표시한다. 현재 `WorktreeService.performSync()`는 Git에서 발견한
worktree는 레지스트리에 추가하지만, Git에서 사라진 항목은 세션 유무와 관계없이 화면에 다시
추가한다. 그 결과 이미 제거된 `codex/cockpit-install-621`이 존재하는 것처럼 보인다.

## 동작

- Git 목록에 없는 레지스트리 항목에 연결된 세션이 없으면 동기화 중 레지스트리에서 자동 제거하고
  `WorktreeWorkspaceSnapshot.workspaces`에도 포함하지 않는다.
- 연결된 세션이 하나라도 있으면 항목과 세션 복구 경로를 보존하고 기존처럼
  `availability: "missing"`으로 표시한다. 사용자는 해당 세션을 식별하고 명시적으로 정리할 수 있다.
- Git이 실제로 반환한 worktree와 프로젝트 메인 작업공간의 동작은 바꾸지 않는다.
- Git 조회가 실패하면 기존처럼 프로젝트 경고를 반환하며, 그 프로젝트의 레지스트리는 변경하지
  않는다.

## 구현 경계

수정은 `src/main/projects/worktree-service.ts`의 동기화 경로에 한정한다. 각 프로젝트에서 Git이
보고하지 않은 레지스트리 항목을 만났을 때 `hasWorktreeSessions(entry.id)`를 확인하고, 세션이 없으면
복사본인 `entries`에서 삭제한 뒤 저장 플래그를 설정한다. 별도 UI 필터나 새 IPC는 추가하지 않는다.

## 검증

`src/main/projects/worktree-service.test.ts`의 실제 임시 Git 저장소 통합 테스트로 다음 계약을 고정한다.

1. 외부에서 worktree를 제거하고 연결 세션이 없으면 다음 `sync()`가 레지스트리와 화면 스냅샷에서
   항목을 제거한다.
2. 같은 상황에서 연결 세션이 있으면 항목과 `missing` 화면 스냅샷을 보존한다.
3. 전체 테스트, 타입 검사, Electron 빌드를 실행한다.

현재 사용자 데이터는 Git 목록과 활성 세션을 다시 확인한 후
`codex/cockpit-install-621` 레지스트리 항목만 제거한다.
