# 프로젝트 레지스트리 계약 (projects.json)

`~/.multi-cli-work/projects.json` — 열어둔 폴더 목록 — 을 읽고 쓰는 규칙을 기록한다.

## 0. 이 파일은 MCW 단독 소유다

**과거에는** `~/.harness-manager/projects.json`을 harness-manager(HM)와 공유했고, `project-discovery`가 `~/.claude/projects`·`~/.codex/sessions`를 훑어 CLI 이력이 있는 폴더를 자동 등록했다. 그래서 목록이 저절로 늘어났고, 스키마는 양 앱 lock-step 배포 없이는 못 바꾸는 동결 상태였다.

**`84c5be3` (refactor: make the folder list standalone and folder-centric) 에서 둘 다 사라졌다:**

- 레지스트리가 `~/.multi-cli-work/projects.json`으로 옮겨졌다. HM의 파일은 **읽지도 쓰지도 않는다** (마이그레이션 없음 — 목록은 빈 상태에서 시작했다).
- 디스커버리가 제거됐다. 폴더는 **사용자가 여는 것만** 등록된다. `reconcileProject`는 `upsertManualProject`로 붕괴했다.

구현: `src/main/projects/project-registry.ts` (파서·잠금·쓰기), `project-service.ts` (CRUD).
`PROJECT_REGISTRY_PATH`가 `harness-manager`를 담지 않는다는 것은 `project-registry.test.ts`가 회귀 테스트로 못박아 둔다.

따라서 **스키마는 우리가 단독으로 소유한다.** 다른 앱과의 lock-step 배포 의무는 없다. 대신 8절의 다운그레이드 함정이 그 자리를 대신한다.

## 1. 파일

- 본 파일: `~/.multi-cli-work/projects.json`
- 백업: `~/.multi-cli-work/projects.json.bak`
- 잠금: `~/.multi-cli-work/projects.json.lock` (proper-lockfile이 생성/관리)

앱은 단일 인스턴스 락으로 중복 실행을 막지만, 레지스트리 잠금은 그와 별개로 유지한다 — 설치본과 개발 빌드가 동시에 도는 경우, 그리고 업데이트 재시작 중의 겹침을 막는 안전망이다.

## 2. 스키마 v1

```
{
  schemaVersion: 1,
  updatedAt: <canonical ISO>,
  migratedFromBoardAt?: <canonical ISO>,   // 옵션. 더 이상 기록하지 않으며, 옛 파일을 읽기 위해서만 수용한다
  projects: {
    "<uuid>": {
      id: "<uuid>",                        // 맵 키와 동일해야 함
      rootPath: string,                    // 절대경로 (path.resolve 형태)
      displayName: string | null,
      sources: ("manual"|"claude"|"codex")[],   // 비어있으면 안 되고 중복 금지
      providerRefs: { claude: string[], codex: string[] },
      status: "진행중"|"보류"|"완료"|"보관" | null,
      memo: string,
      tracks: [{ id, title, items: [{ id, text, done: boolean }] }],
      hidden: boolean,
      order: number(정수, >=0) | null,
      createdAt: <canonical ISO>,
      updatedAt: <canonical ISO>,
    }
  }
}
```

- **exact-keys**: 파서는 나열된 필드 외의 키가 하나라도 있으면 레지스트리 **전체를 거부**한다 (`assertExactKeys`). 레지스트리 최상위·project·providerRefs·tracks·tracks.items 모두에 적용된다.
- 전역 유일성: 정규화된 `rootPath`(7절)와 각 providerRef는 프로젝트 간 중복 금지.
- UUID는 `id === 맵 키`이며 UUID 형식 검증을 통과해야 한다.

### `sources`와 `providerRefs`는 흔적기관이다

디스커버리가 사라지면서 **새 프로젝트는 항상 `sources: ["manual"]`, `providerRefs: { claude: [], codex: [] }`** 로 만들어진다 (`upsertManualProject`). 어떤 코드도 provider ref를 채우지 않는다.

파서는 여전히 이들의 형태를 검증한다 — claude ref는 `:` 포함 금지, codex ref는 `codex:` 접두사 필수, ref가 있으면 대응하는 source가 있어야 함 — 하지만 이 규칙들이 지키는 것은 **옛 파일에 남아 있을 수 있는 데이터뿐**이다. 새로 쓰이는 값은 없다.

지우지 않고 두는 이유: exact-keys 파서에서 필드를 **빼는 것** 역시 8절의 다운그레이드 문제를 그대로 일으킨다. 얻는 것 없이 위험만 지므로 그대로 둔다.

## 3. 타임스탬프

- 저장되는 모든 타임스탬프는 **canonical ISO**여야 한다: `new Date(Date.parse(v)).toISOString() === v` (밀리초 포함, `Z` 접미).
- 읽기 시 `Date.parse` 가능한 값을 canonical로 **정규화 수용**하고, 쓰기 시 항상 canonical만 기록한다 → 비정규 파일은 한 번 읽고 쓰면 자가 치유된다.
- 주의: `isoString`은 `Date.parse`가 수용하는 **모든** 입력을 유효로 본다 — ISO 변형만이 아니라 V8이 관용적으로 해석하는 값(예: 롤오버되는 날짜)도 "보정"되어 저장된다. 시각의 의미(epoch ms)는 보존된다.

## 4. 잠금 프로토콜

- 라이브러리: `proper-lockfile`, 대상 파일 자체를 잠근다.
- 옵션: `realpath: false`, lockfile 경로는 `<파일>.lock`, stale 10초, 재시도 예산 ~5초 (100ms × ~50회).
- 모든 쓰기는 잠금 하에서 read–merge–write로 수행한다. **잠금 없이 파일을 직접 쓰는 도구는 이 계약 위반이다.**

## 5. 원자적 쓰기와 백업

- 쓰기는 반드시 임시 파일 + `rename`(원자적 교체)으로 수행한다.
- `.bak`은 **현재 파일이 스키마 검증을 통과할 때만** 갱신한다 — 손상된 primary가 마지막 정상 백업을 덮어쓰지 않도록 (마지막 정상본 보존 원칙).

## 6. 복구 시맨틱

| 상황 | 동작 |
|---|---|
| primary 손상 + `.bak` 유효 | `.bak`로 **읽기 전용** 폴백 + UI 경고 배너에 복원 액션 |
| primary 없음(ENOENT) + `.bak` 존재 | `.bak`로 읽기 전용 폴백 |
| 둘 다 없음 | 빈 레지스트리 (쓰기 가능) |

읽기 전용 상태에서는 폴더 추가·제거·메타데이터 수정이 모두 막힌다. 사용자가 **복구**를 누르면 검증을 통과한 `.bak`을 primary로 되돌린다.

## 7. 경로 정규화 (중복 판정용)

- 중복 판정에는 **정규화 경로**를 쓴다: `path.resolve` 후 구분자 통일, 후행 구분자 제거, Windows에서는 소문자화(대소문자 무시).
- **저장되는 값 자체는 `path.resolve`된 원형**이다 (정규화형이 아니다).
- relink한 경로는 `sources`에 `"manual"`을 추가한다. 덮어쓸 디스커버리가 더 이상 없으므로 이는 기록일 뿐 우선순위 규칙이 아니다.

## 8. 스키마 진화 — 필드 추가는 구버전을 깨뜨린다

파서가 exact-keys이므로, **새 버전이 필드를 하나 추가하면 구버전 앱은 레지스트리 전체를 거부한다.** 6절에 따라 구버전은 `.bak`으로 읽기 전용 폴백하거나 빈 목록으로 시작한다 — 사용자 눈에는 **열어둔 폴더가 전부 사라진 것처럼** 보인다.

이건 이론적 위험이 아니다. 앱은 자동 업데이트를 하고, 사용자가 구버전 설치본으로 롤백하는 것을 막을 방법이 없다.

**그래서 순서는 이렇다:**

1. **새 개념은 별도 파일에 담는다.** 구버전은 모르는 파일을 그냥 무시하고, `projects.json`은 멀쩡히 읽는다. 다운그레이드가 안전하다.
   예: worktree는 `~/.multi-cli-work/worktrees.json`, 에이전트 정의는 `~/.multi-cli-work/agents.json`.
   별도 파일도 이 문서의 잠금·원자적 쓰기·`.bak` 프로토콜(4·5·6절)을 똑같이 따른다.
2. **`projects.json`에 필드를 추가하는 것은 최후수단이다.** 정말 필요하다면 `schemaVersion`을 올리고, 구버전이 새 파일을 **거부하지 않도록** 먼저 "알 수 없는 필드 무시" 파서를 배포한 뒤 한 릴리스를 기다렸다가 필드를 채우기 시작한다. 이 두 단계를 건너뛰면 롤백한 사용자가 목록을 잃는다.
3. **필드를 빼는 것도 같은 문제다** (구버전이 필수 필드의 부재로 거부한다). 2절의 흔적기관을 그대로 두는 이유가 이것이다.

## 9. Claude 훅 공존 (참고)

MCW는 `claude --settings` **세션 오버레이 훅**(`userData/hooks/claude-status.ps1`)으로만 세션 상태를 추적하며, 사용자의 `~/.claude/settings.json`은 건드리지 않는다. Claude Code는 여러 설정 소스의 훅을 병합 실행하므로, 사용자가 전역 훅을 따로 두고 있어도 충돌 없이 공존한다.
