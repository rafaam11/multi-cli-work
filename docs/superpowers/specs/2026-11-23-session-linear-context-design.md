# 세션 브리프의 Linear 맥락 + 작업 기록 리마인드

- 작성: 2026-11-23 · 상태: **설계 승인**(사용자 인터뷰) · 구현 계획 전
- 상위 설계: `C:/dev/llmwiki/docs/superpowers/specs/2026-11-23-linear-notion-agent-context-design.md`(P1). 이 문서는 그중 P2인 "MCW 세션 ↔ Linear"만 다룬다.
- **개정(같은 날, 역할 감사 A4)**: `C:/dev/llmwiki/docs/superpowers/specs/2026-11-23-system-roles-audit.md`에 따라 프로젝트 상태는 Notion 프로젝트 DB가 정본이다. Linear 프로젝트 업데이트는 쓰지 않으므로, 브리프도 읽지 않고 싣지 않는다(v1.63.0 다음 버전부터).

## 1. 배경

사용자의 두 번째로 큰 불편은 "MCW 세션마다 맥락을 직접 다시 설명해야 한다"였다. P1에서 저장소의 역할을 이렇게 나눴다.
- **Linear**: 할 일·개발 이슈·진행 기록처럼 움직이는 것
- **노션**: 기록·자료처럼 쌓이는 것

Grok Bot의 봇 6종(메타몽 등)은 Linear를 읽고 쓴다. MCW 세션도 같은 Linear를 읽고 쓰면 봇과 세션이 같은 맥락을 갖는다.

MCW의 역할은 바뀌지 않는다. **사용자가 직접 지휘하는 개발 공간**이고, 봇은 MCW 세션을 지시하거나 조작하지 않는다. MCW가 할 일은 두 가지뿐이다.
1. 세션이 시작할 때 그 프로젝트의 Linear 맥락을 짧게 실어 준다.
2. 작업이 한 단위 끝나면 Linear에 기록을 남기라고 한 번 일러 준다.

## 2. 목표 · 비목표

**목표**
- 업무 프로젝트에 속한 폴더에서 claude·codex 세션을 열면, 브리프에 "Linear 맥락" 절이 실린다.
- Claude 세션이 커밋을 남기고 멈추면, 해당 이슈·프로젝트에 기록을 남기라는 리마인드가 **한 번** 들어간다.
- Linear 키가 없거나, 오프라인이거나, 응답이 느려도 세션 시작은 **3초 넘게** 늦어지지 않는다.

**비목표**
- 새 jk 도구를 만들지 않는다. 세션은 `linear` CLI(`schpet/linear-cli`)를 직접 쓴다.
- 노션 클라이언트는 확장하지 않는다. 노션은 지금처럼 링크 제목만 읽는다.
- Linear와 다른 저장소 사이에 동기화를 두지 않는다.
- 앱 안에 Linear 화면을 만들지 않는다. 현황판은 Bolt(P3)가 맡는다.
- 봇이 세션에 프롬프트를 넣지 않는다.

## 3. 현재 구조 (재사용)

| 단계 | 위치 |
|---|---|
| 브리프 렌더 | `src/main/projects/work-project-brief.ts` `renderWorkProjectBrief`, `buildWorkspaceBrief`(`workspace-brief.ts`) |
| 브리프 파일 쓰기 | `writeSessionBrief` → `userData/project-briefs/<projectId>.md` (`runtime.ts` 416행 부근) |
| 세션으로 전달 | 환경변수 `MULTI_CLI_WORK_PROJECT_BRIEF` (`terminal/terminal-coordinator.ts:894`). `:854`에서 브리프가 준비될 때까지 프로세스 시작을 기다린다 |
| Claude가 읽음 | SessionStart 훅 (`providers/claude-integration.ts`, PS1 `:122` 부근·Python `:193` 부근) |
| Codex가 읽음 | `providers/codex-integration.ts:58` `emitBrief` |
| 비밀값 보관 | `notion/notion-token-store.ts` (safeStorage). 같은 패턴을 쓴다 |
| PROJECT.yaml 파싱 | `projects/workspace-index.ts` (v2 `<root>/projects/<PRJ-key>/PROJECT.yaml`의 `repos:`) |
| Stop 훅 | Claude 훅의 `CLAUDE_EVENTS`에 Stop이 이미 등록돼 있다(10초 타임아웃). 지금은 아무것도 출력하지 않는다 |

## 4. 설계

### 4.1 Linear API 키

- 설정 › 연동(노션 항목 옆)에 Linear API 키 칸을 둔다.
- 저장하기 전에 `viewer { id name }` 질의로 검증한다. 실패하면 저장하지 않고 이유를 보여 준다.
- `linear/linear-key-store.ts`는 `notion-token-store.ts`와 같은 구조로 만든다. safeStorage 암호문으로 `userData/linear-credentials.json`에 저장한다.
- 키를 지우면 브리프의 Linear 절과 리마인드도 꺼진다.
- 세션 쪽 `linear` CLI는 자기 인증을 따로 쓴다(`linear auth`). MCW는 키를 세션 환경변수로 넘기지 않는다. 키가 터미널 기록이나 자식 프로세스에 새는 것을 막기 위해서다.

### 4.2 폴더 → PRJ-key → Linear 프로젝트

- **자동 매핑**
  - `workspace-index.ts`의 PROJECT.yaml 파서를 재사용한다. 설정의 ws-root 경로(기본값 `C:\work`, 실재할 때만)에서 `projects/*/PROJECT.yaml`의 `repos:`를 읽어 **레포 이름 → PRJ-key 목록**을 만든다.
  - **ws-root를 워크스페이스로 등록하지 않는다.** 등록하면 v1.31 D9/D10 때문에 빈 업무 프로젝트가 생긴다. 이 조회는 읽기만 하며, 결과는 mtime 지문으로 캐시한다.
- **수동 매핑은 두지 않는다**(구현 계획 2026-11-23의 결정). `work-projects.json`은 모르는 필드를 거부하는 파서라 필드를 더하면 이전 버전으로 되돌릴 때 깨지고, 레포 → PRJ의 정본은 이미 `PROJECT.yaml`의 `repos:`다. 레포를 PRJ에 잇는 방법은 `/ws-link-repo`다.
- **한 레포가 여러 PRJ에 걸릴 때**: 워크스페이스 색인의 규칙(프로젝트 폴더 이름 순으로 마지막이 이긴다)을 그대로 따른다.
- 매핑이 없는 폴더에는 Linear 절을 넣지 않는다.
- PRJ-key로 Linear 프로젝트를 찾는 규칙: 이름이 정확히 그 키로 시작하고 뒤가 공백이거나 끝인 프로젝트(`PRJ-0017 세컨드브레인`). 설명 첫 줄 매칭은 하지 않는다(구현 계획의 결정 — 이름 규약 하나로 충분하다).

### 4.3 조회

- main 프로세스에서 Linear GraphQL(`https://api.linear.app/graphql`)을 직접 호출한다. CLI를 띄우지 않는 이유는 세션 시작 경로에서 자식 프로세스를 늘리지 않기 위해서다.
- 한 번의 질의로 다음을 가져온다.
  - 열린 이슈 최대 8개
    - 필터: 상태 유형이 completed·canceled가 아닌 것
    - 정렬: `repo:<폴더 레포>` 라벨을 먼저, 그다음 우선순위, 기한 순
    - 필드: identifier, title, state, dueDate, 라벨 이름
  - ~~최근 프로젝트 업데이트 2건~~ — 역할 감사 A4로 뺐다
  - 최근 댓글 5건: 위 이슈들에 달린 것, 작성자 라벨과 첫 줄
- 상한은 **3초**다(AbortController). 응답이 늦으면 절을 빼고 세션을 띄운다.
- 캐시: 키·프로젝트별로 5분. 같은 폴더에서 세션을 연달아 열어도 다시 조회하지 않는다.
- 실패해도(네트워크·401·한도) 사용자에게 알리지 않는다. 마지막 오류는 설정 화면의 연동 상태에 한 줄로만 보여 준다.

### 4.4 브리프 절 (형식 예)

```markdown
## Linear 맥락 (PRJ-0017 세컨드브레인 · 조회 11-23 09:12)
- 열린 이슈
  - SB-41 [진행 중] 세션 브리프 Linear 절 · repo:multi-cli-work · 기한 11-30
  - SB-38 [할 일] Grok Bot 시험 판정표 채우기 · 기한 12-07
- 최근 기록
  - 11-23 by:메타몽 SB-38 "06:30 브리핑 첫 도착 확인"
  - 11-22 by:mcw-claude SB-35 "명령 레지스트리 배포 후 회귀 없음"

더 필요하면 `linear issue list --project "PRJ-0017"`·`linear issue view <키>`로 읽는다.
작업 단위가 끝나면 해당 이슈에 댓글로 진행·결정·막힘·다음 할 일을 남기고, 라벨 by:mcw-<cli>·repo:<레포>를 붙인다.
커밋·브랜치·PR에는 이슈 키를 넣는다(Linear의 GitHub 연동이 상태를 옮긴다).
```

- 절 전체는 30줄을 넘지 않는다. 제목 길이도 자른다.
- 이 절은 업무 프로젝트 절 뒤에 붙인다. `writeSessionBrief`의 sections 배열에 하나를 더 넣는 구조다.

### 4.5 작업 기록 리마인드

**Claude**
- **이 세션이 만든 커밋만 센다**(최종 검토 반영). 여러 세션이 한 작업 트리를 함께 쓰므로, 다른 세션의 커밋·pull·checkout으로 HEAD가 움직여도 리마인드하지 않는다.
  1. 셸 도구(Bash·PowerShell)의 명령이 `git … commit`이면 PreToolUse에서 `HEAD`를 `userData/session-linear/<sessionId>.prehead`에 적는다.
  2. 같은 명령의 PostToolUse에서 `HEAD`가 그 값과 다르면(커밋이 실제로 생김) `<sessionId>.pending`을 만든다.
  3. 다음 Stop에서 `stop_hook_active`가 거짓이고 `.pending`이 있으면 지우고 `decision: "block"`과 리마인드 문구(`reason`)를 낸다.
- 브리프에 마커가 없는 세션(Linear 매핑 없음·리마인드 꺼짐), git이 아닌 폴더, git 미설치에서는 아무것도 쓰거나 출력하지 않는다. 커밋이 하나도 없는 새 레포의 첫 커밋은 세지 않는다(직전 `HEAD`가 없다).
- 이 출력은 Claude에게 기록 한 턴을 더 하게 만든다. 커밋이 생길 때만 이런 일이 일어나므로, 턴마다 기록이 쌓이지는 않는다.
- 문구 예: "방금 커밋이 생겼다. 관련 Linear 이슈에 진행·결정·다음 할 일을 댓글 1건으로 남기고 멈춰라. 이미 남겼으면 바로 멈춰라."
- PS1 훅은 BOM 없는 파일의 한글이 깨지는 문제가 있다(릴리스 메모리). 그래서 문구를 `\uXXXX`로 이스케이프해 JSON에 넣는다.

**Codex**: 훅이 없으므로 브리프의 지시 문장만 둔다.

**설정**: 설정 › 연동에 토글 두 개를 둔다. 둘 다 기본값은 켬이고, 키가 없으면 비활성이다.
- "브리프에 Linear 맥락 싣기"
- "커밋 후 기록 리마인드"

### 4.6 CLI 설치

- 이 앱은 `linear` CLI를 설치하지 않는다. harness-manager manifest가 CLI(`schpet/linear-cli`)와 그 Claude Code 스킬을 맡는다(P1 §10).
- 브리프의 지시 문장은 CLI가 없어도 무해하다. 세션이 "CLI 없음"을 만나면 사용자에게 알리고 넘어간다.

## 5. 테스트

vitest(`--pool=threads`, 전체 스위트는 `--maxWorkers=2`)로 다음을 확인한다.
- 브리프 렌더
  - Linear 절이 있을 때, 키가 없을 때, 조회가 실패할 때(401·네트워크), 3초를 넘길 때
  - 30줄 상한, 제목 자르기, 같은 레포 라벨 우선 정렬
- 매핑
  - PROJECT.yaml `repos:`의 역인덱스
  - 한 레포가 여러 PRJ에 걸릴 때
  - PRJ가 없는 폴더
  - ws-root가 없을 때
- Linear 응답 파싱: 모의 GraphQL 응답에서 필드가 빠졌을 때, health 값별 표시
- 키 저장소: 암호화·복호화, 검증 실패 시 저장하지 않는지(`notion-token-store.test.ts`와 같은 방식)
- Stop 훅
  - 같은 HEAD에서는 다시 리마인드하지 않는다.
  - `stop_hook_active`가 참이면 통과시킨다.
  - 매핑이 없으면 아무것도 출력하지 않는다.
  - PS1에서 이스케이프한 문구가 올바른 JSON이 된다.

## 6. 실기 검증

탐색용 Playwright 하네스로 격리 인스턴스를 띄우고 `MULTI_CLI_WORK_*` 환경변수를 지정해 확인한다.

1. 키를 넣고, 매핑된 폴더(예: multi-cli-work → PRJ-0017)에서 claude 세션을 연다. 첫 응답 전에 Linear 절이 컨텍스트에 실렸는지 본다.
2. 같은 폴더에서 codex 세션도 연다. `emitBrief` 출력에 같은 절이 있는지 본다.
3. 커밋을 하나 만들고 멈춘다. 리마인드가 한 번만 들어오고, Linear에 댓글이 생기는지 본다.
4. 키를 지우고, 이어서 네트워크를 끊고 세션을 연다. 시작 지연이 3초를 넘지 않고 절이 빠지는지 본다.

## 7. 관련: 세션 현황 내보내기

봇(네이티오·메타몽)이 MCW 세션 현황을 보도록, MCW는 상태 스냅샷을 Bolt 사이드카로 **내보내기만** 한다. 기본값은 꺼짐이고 터미널 내용은 보내지 않는다. 설계는 `C:/dev/bolt/docs/superpowers/specs/2026-11-23-personal-mcp-connector-design.md` §6에 있다. 이 기능은 브리프 작업과 별개로 구현할 수 있다.

## 8. 위험 · 열린 점

- `linear` CLI는 제3자 도구다. 명령 이름이 바뀌면 브리프의 지시 문장만 고치면 된다(앱 코드는 CLI에 의존하지 않는다).
- Stop의 block은 비용이 드는 턴을 한 번 더 만든다. 사용자가 시끄럽다고 느끼면 토글을 끄거나, 조건을 "커밋 3개 이상" 등으로 올린다.
- Linear의 요청 한도는 넉넉하지만, 캐시가 없으면 세션을 자주 열 때마다 질의가 몰린다. 그래서 5분 캐시는 필수다.
