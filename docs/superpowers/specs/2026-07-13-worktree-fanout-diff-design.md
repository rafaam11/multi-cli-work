# Git worktree 병렬 세션 · 프롬프트 팬아웃 · diff 뷰 (Orca 도입 3단계)

## 왜

Orca의 간판 문구는 "한 프롬프트를 5개 에이전트에, 각자 자기 worktree에서 — 결과를 비교해
승자를 머지"다. 이 흐름은 세 조각이다: **격리**(worktree), **분배**(팬아웃), **비교**(diff).
셋 중 하나만 없어도 병렬 작업대가 아니라 그냥 탭 여러 개다.

## 격리 — worktree

- 저장은 `~/.multi-cli-work/worktrees.json`. **`projects.json`은 건드리지 않는다** — exact-keys
  파서 때문에 거기 필드를 추가하면 구버전이 폴더 목록 전체를 거부한다(레지스트리 계약 §8).
  json-store의 락·원자적 쓰기·`.bak` 프로토콜을 그대로 재사용한다.
- 경로는 `<repo>/../<repo명>-wt/<브랜치 슬러그>` — 저장소 **밖**이라 에이전트가 옆 worktree를
  훑지 않고 `.gitignore`도 오염되지 않는다.
- 세션 바인딩: `PersistedTerminalSession.worktreeId`는 **옵셔널이고, 없으면 키 자체를 직렬화하지
  않는다**. worktree를 안 쓰는 사용자의 `state.json`은 바이트 하나 안 바뀌므로 구버전으로
  롤백해도 세션을 잃지 않는다.
- worktree가 사라진 세션의 재개는 **거부한다** — 프로젝트 루트로 조용히 폴백하면 에이전트가
  엉뚱한 트리에서 작업한다. 시작 시 디렉토리가 사라진 레지스트리 항목은 정리한다(fs 존재 검사;
  손으로 지웠든 git CLI로 지웠든 같은 결과).
- UI: 사이드바가 **프로젝트 > worktree > 세션** 3단이 된다. worktree 없는 프로젝트는 기존 2단
  그대로 — 빈 중간 노드를 만들지 않는다. worktree를 선택하면 상세 페이지가 그 worktree로
  스코프되고(세션 목록·git 상태·탐색기/VS Code·새 세션의 cwd), 메모·체크리스트 카드는
  프로젝트 메타데이터라 루트에서만 보인다.

### 제거의 안전장치 (계획의 핵심 요구)

`remove(worktreeId, force)`는 실패를 던지지 않고 **결과를 돌려준다**:
`{removed:true} | {removed:false, reason:"dirty", message}`. 렌더러가 에러 메시지를 파싱하는
대신 결과로 분기한다.

순서가 전부다: **(1) dirty 검사** — 커밋 안 된 변경이 있으면 세션을 건드리기 **전에** 거부하고,
렌더러는 git이 거부한 이유를 그대로 보여주는 두 번째 다이얼로그("변경을 버리고 강제 제거")를
연다. **(2) 세션 중지** — Windows에서는 cwd를 쥔 살아 있는 프로세스가 디렉토리 삭제를 막으므로
git보다 먼저다. **(3) `git worktree remove [--force]`** → **(4) 레지스트리 정리**.

## 분배 — 프롬프트 팬아웃

- 새 IPC 없음: 세션별 `terminals.write`가 이미 있으므로 렌더러 루프면 충분하다.
- 멀티라인 프롬프트는 bracketed paste(ESC[200~ … ESC[201~)로 감싼다 — 중간 개행이 프롬프트를
  조기 발사하지 못하게. Claude·Codex·PSReadLine 모두 지원. 한 줄이면 그냥 텍스트 + CR.
- 전송은 **모달에서 대상 목록을 보고 명시적 버튼을 눌러야만** 일어난다. 단축키 직결은 없다 —
  키 하나로 에이전트 N개를 움직이는 것은 사고 제조기다. `exited`/`error` 세션은 목록에서 빠진다.

## 비교 — 읽기 전용 diff 뷰

- main의 `git-diff.ts`는 `git-status.ts`의 원칙을 따른다: repo가 아니면 정상 케이스, throw 금지.
  `git diff HEAD`(추적 파일) + `ls-files --others`(추적 외 파일, diff에 절대 안 나오므로 별도
  섹션). execFile 기본 1MiB 버퍼가 큰 diff를 "repo 아님"으로 둔갑시키므로 버퍼를 올리고, 1MB
  초과분은 자르되 잘렸음을 표시한다.
- 렌더러 파서(`diff-parse.ts`)는 외부 라이브러리 없이 줄 단위 분류만 한다 — git 출력의
  렌더러이지 검증기가 아니다.
- **읽기 전용으로 못박는다.** 스테이징·주석·머지는 이미 잘하는 도구들의 일이고, 이 뷰의 일은
  병렬 에이전트가 만든 결과의 비교다. (Orca의 "diff 주석 → 에이전트 회신"은 별도 판단.)

## 검증

- `worktree-service.test.ts` — **실제 임시 git repo** 통합: 생성(저장소 밖 경로·브랜치 체크아웃·
  레지스트리 기록), 중복 거부(레지스트리/git 각각), 깨끗한 제거, dirty 거부→강제, 유령 정리.
- `terminal-coordinator.test.ts` — worktree cwd로 spawn·바인딩 영속화, 루트 세션의 직렬화 형태
  불변(worktreeId 키 부재), 사라진 worktree의 재개 거부, worktree 세션만 골라 제거.
- `fan-out.test.ts` · `diff-parse.test.ts` — 순수 함수.
- `App.test.tsx` — 3단 트리·스코프된 상세 페이지·worktree로 세션 생성, dirty→강제 제거 2단계,
  팬아웃(죽은 세션 제외), diff 다이얼로그.
- `e2e/desktop.spec.ts` — 실제 git repo에서: worktree 생성 → 그 안의 실제 ConPTY 세션의 pwd
  확인 → 살아 있는 세션 2개에 팬아웃 → 양쪽 출력 확인 → 미커밋 파일을 diff로 확인 → 제거가
  거부되고 강제 제거로만 통과 → 디렉토리 소멸 확인.

## 다음

터미널 2분할(4단계) — 분할된 세션은 "화면에 있는" 것이므로 attention 판정에서 제외돼야 한다.
