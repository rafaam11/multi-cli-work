# 공유 프로젝트 레지스트리 계약 (projects.json)

`~/.harness-manager/projects.json`을 읽고 쓰는 두 앱 — **harness-manager**(HM)와 **multi-cli-work**(MCW) — 가 지켜야 하는 계약을 기록한다. 이 문서의 canonical 사본은 MCW 저장소에 있으며, HM은 이 문서를 참조한다. 계약을 바꾸는 변경은 반드시 양 저장소의 코드와 이 문서를 함께 갱신해야 한다.

## 1. 파일 위치와 소유

- 본 파일: `~/.harness-manager/projects.json`
- 백업: `~/.harness-manager/projects.json.bak`
- 잠금: `~/.harness-manager/projects.json.lock` (proper-lockfile이 생성/관리)
- 두 앱은 대등한 writer다. 어느 쪽도 파일을 독점하지 않으며, 새로운 writer가 참여하려면 이 문서의 프로토콜 전체를 준수해야 한다.

구현 위치: HM `src/main/lib/project-registry.ts`, MCW `src/main/projects/project-registry.ts`.

## 2. 스키마 v1 (동결)

```
{
  schemaVersion: 1,
  updatedAt: <canonical ISO>,
  migratedFromBoardAt?: <canonical ISO>,   // 옵션
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

- **exact-keys**: 양쪽 파서 모두 나열된 필드 외의 키가 하나라도 있으면 레지스트리 **전체를 거부**한다.
- providerRefs 규칙: `claude` 배열 원소는 raw id이며 `:` 포함 금지, `codex` 배열 원소는 반드시 `codex:` 접두사.
- 전역 유일성: 정규화된 `rootPath`(9절)와 각 providerRef는 프로젝트 간 중복 금지.
- UUID는 `id === 맵 키`이며 UUID 형식 검증을 통과해야 한다.

## 3. 타임스탬프 규칙

- 저장되는 모든 타임스탬프는 **canonical ISO**여야 한다: `new Date(Date.parse(v)).toISOString() === v` (밀리초 포함, `Z` 접미).
- HM은 위반 시 레지스트리 전체를 거부한다 (`assertIsoTimestamp`).
- MCW는 읽기 시 `Date.parse` 가능한 값을 canonical로 **정규화 수용**하고, 쓰기 시 항상 canonical만 기록한다 → 비정규 파일은 MCW가 한 번 읽고 쓰면 자가 치유된다.
- 주의: MCW의 `isoString`은 `Date.parse`가 수용하는 **모든** 입력을 유효로 보고 canonical로 재기록한다 — ISO 형식 변형만이 아니라, V8이 관용적으로 해석하는 값(예: 롤오버되는 날짜)도 "보정"되어 저장된다. 시각의 의미(epoch ms)는 보존된다.

## 4. 잠금 프로토콜

- 라이브러리: `proper-lockfile` (양쪽 모두), 대상 파일 자체를 잠금.
- 옵션: `realpath: false`, lockfile 경로는 기본값(`<파일>.lock`), stale 10초.
- 재시도 예산: 총 ~5초 (HM은 50ms 자체 루프, MCW는 100ms×~50회 — 알고리즘은 달라도 상호 배타는 동일하게 성립).
- 모든 쓰기는 잠금 하에서 read–merge–write로 수행한다. 잠금 없이 파일을 직접 쓰는 도구는 이 계약 위반이다.

## 5. 원자적 쓰기와 백업

- 쓰기는 반드시 임시 파일 + `rename`(원자적 교체)으로 수행한다.
- `.bak`은 **현재 파일이 스키마 검증을 통과할 때만** 갱신한다 — 손상된 primary가 마지막 정상 백업을 덮어쓰지 않도록 하기 위함(마지막 정상본 보존 원칙).

## 6. rootPath 정책 — manual/relink 우선

- `sources`에 `"manual"`이 포함된 프로젝트의 `rootPath`는 **디스커버리가 절대 덮어쓰지 않는다**. 사용자가 수동 등록/relink한 경로가 항상 이긴다.
- providerRef 소유권 이전(같은 ref를 가진 다른 프로젝트에서 떼어와 병합)은 manual 여부와 무관하게 허용된다 — 금지되는 것은 rootPath 이동뿐이다.
- 재조정 필요 판정(HM `projectRegistryNeedsReconciliation`)도 동일한 가드를 따른다: manual 프로젝트의 rootPath 불일치는 재조정 사유가 아니라 지속 상태다.
- 구현: HM `applyDiscovery`/`projectRegistryNeedsReconciliation`(`src/main/lib/project-registry.ts`), MCW `reconcileProject`(`src/main/projects/project-registry.ts`).

## 7. providerRef 슬러그 파생 규칙

- **claude**: `~/.claude/projects/<dir>/`의 디렉토리명 그대로 (Claude Code가 생성한 flatten 이름). 두 앱 모두 자체 계산하지 않고 디렉토리명을 그대로 쓴다.
- **codex**: `codex:` + cwd flatten —
  - Windows 드라이브 경로: `{드라이브 대문자}--{나머지 경로의 [\\/]+를 -로 치환, 앞뒤 - 트림}` (예: `D:\hdx\agv` → `codex:D--hdx-agv`)
  - POSIX: 선행 `/` → `-`, 이후 `/` → `-` (예: `/home/user/proj` → `codex:-home-user-proj`)
  - 빈 결과는 `unknown`.
- **주의(드리프트 위험)**: codex 슬러그 알고리즘은 HM `src/main/providers/codex.ts`(localProjectIdFromCwd)와 MCW `src/main/projects/project-discovery.ts`(codexProjectRefFromCwd)에 **동일 로직이 중복 구현**되어 있다. 한쪽만 바꾸면 같은 프로젝트가 서로 다른 ref를 갖게 된다 — 변경 시 양쪽 동기화 의무.

## 8. 복구 시맨틱 (현행 차이의 기록)

| 상황 | MCW | HM |
|---|---|---|
| primary 손상 + `.bak` 유효 | `.bak`로 read-only 폴백 + UI 복원 액션 | `.bak` 읽기 폴백 |
| primary 없음(ENOENT) + `.bak` 존재 | `.bak`로 read-only 폴백 | 빈 레지스트리로 시작 |
| 둘 다 없음 | 빈 레지스트리(writable) | 빈 레지스트리 |

ENOENT 시 동작이 다르다는 점을 인지할 것 — 어느 쪽도 `.bak`을 파괴하지 않으므로 데이터 유실은 없지만, HM이 빈 레지스트리로 시작해 디스커버리를 다시 쓰면 id가 재발급될 수 있다.

## 9. 경로 정규화 (중복 판정용)

- 두 앱 모두 rootPath 중복 판정에 **정규화 경로**를 쓴다: `path.resolve` 후 구분자 통일, 후행 구분자 제거, Windows에서는 소문자화(대소문자 무시).
- 저장되는 값 자체는 `path.resolve`된 원형이다(정규화형이 아님).

## 10. 스키마 진화 절차

exact-keys 검증 때문에 **한쪽 앱만 새 필드를 쓰기 시작하면 다른 쪽이 레지스트리 전체를 거부한다.** 필드 추가/변경은 다음 절차로만 한다:

1. `schemaVersion`을 올리고, 구버전 파일을 읽어 마이그레이션하는 파서를 **양쪽 앱에** 구현한다.
2. 양쪽 배포(양 저장소 커밋·빌드 교체)가 끝난 뒤에만 새 버전으로 기록을 시작한다 (lock-step).
3. 대안 경로(참고): "알 수 없는 필드 무시" 파서를 먼저 양쪽에 배포한 뒤 필드를 채우는 방식도 가능하나, 현행 정책은 exact-keys이므로 기본 절차는 lock-step이다.

## 11. Claude 훅 공존 (참고)

- HM은 `~/.claude/settings.json` **전역 훅**(`~/.harness-manager/hooks/claude-live-session.mjs`)을 병합 설치해 라이브 세션을 추적한다.
- MCW는 `claude --settings` **세션 오버레이 훅**(`userData/hooks/claude-status.ps1`)으로 세션 상태를 추적한다.
- Claude Code는 여러 설정 소스의 훅을 병합 실행하므로 두 훅은 충돌 없이 공존한다.
