# PRJ-key 일원화 — ws-root v2 구조를 업무 프로젝트로 읽기 (v1.31.0)

## 배경과 문제

`multi-cli-work`(이하 MCW)는 `C:\work`(ws-root)를 **읽기 전용으로 소비**해 사이드바 묶음과
SessionStart 브리프를 만든다. 그 소비 지점은 세 곳이다.

1. `WorkspaceIndex.snapshot` — 루트를 훑어 `WorkspaceShellInfo[]`와 레포→셸 역인덱스를 만든다.
2. `WorkProjectService.syncFromWorkspace` — 그 결과를 업무 프로젝트로 upsert한다.
3. `buildWorkspaceBrief` — 세션이 선 폴더가 어느 셸의 일인지 적어 준다.

2026-09-05에 ws-root가 옛 2단 구조 `<채널>/<셸>`(예: `O_ATNC/24_ATNC_NeuroPilot-1`)에서
**PRJ-key 평면 구조** `C:\work\projects\PRJ-####-slug\`(휴면은 `projects\_archive\`)로 바뀌었다.
`.ws-index.json`도 `schemaVersion: 2`가 되어 `shells[]`가 사라지고 `projects[]`·`repos{}`·
`datasets[]`가 들어왔다.

MCW는 아직 v1만 안다. 구체적으로:

- `workspace-index.ts:130` `statShells`가 `<root>/<채널>/<셸>/CLAUDE.md`만 찾는다. 지금
  `C:\work` 최상위에는 `projects`·`wiki`·`_scripts`·`_templates`·`_local`뿐이므로 **스캔 결과가 0건**이다.
- `workspace-index.ts:215` `shellsFromWsIndex`가 v1 `shells[]`만 읽는다. v2 파일에는 그 키가 없어 `null`을 준다.

결과적으로 동기화가 끊겼고, 사용자는 앱 안에 수제 업무 프로젝트 4건을 따로 들고 있다
(`~/.multi-cli-work/work-projects.json`: `Z_기타`·`O_에이티앤씨`·`R_세컨드브레인`·`S_결혼식`).
분류 체계가 **PRJ-key / 수제 업무 프로젝트 / (Google Drive 폴더)** 세 벌로 갈라져 있다.

덧붙여 두 가지 군더더기가 같은 자리에 있다.

- `work-project-brief.ts:55-56`이 **무조건** "문서 작업은 팀즈 폴더, 진행 관리는 노션"을 찍는다.
  이 사용자의 `teamsSyncRoot`는 `null`이고 네 업무 프로젝트 모두 `notionLinks`가 비어 있다 —
  세션마다 틀린 문장이 브리프에 들어간다.
- `WorkspaceShellInfo.channelLetter`는 쓰는 곳이 없다(`workspace-index.ts:176`이 채우고 아무도 읽지 않는다).

### 이 결정이 2026-09-03 스펙과 부딪히는 지점

`2026-09-03-project-tags-design.md`는 "**워크스페이스 모델의 도메인 개념(finite/continuous,
PRJ 키, PROJECT.yaml)**을 앱에 넣지 않는다"를 *하지 않는 것*으로 못박았다. 이 스펙은 그 선을
다음과 같이 지킨다.

- 앱의 **개념**은 늘어나지 않는다. 사이드바·트리·업무 프로젝트·태그는 그대로고,
  `work-projects.json`·`projects.json`·`state.json`·`workspace.json`의 스키마도 그대로다.
- PRJ-key와 PROJECT.yaml은 **읽는 층 한 곳**(`workspace-index.ts`)에만 들어온다. 그 위의 코드는
  v1과 같은 `WorkspaceShellInfo`를 본다.
- `mode`(continuous/finite)는 **브리프 한 줄로 흘려보내는 문자열**로만 들어온다. 어떤 코드도 이
  값으로 분기하지 않는다(D8).

즉 9/3 결정이 막은 것은 "도메인 개념이 앱의 데이터 모델·UI 분기가 되는 것"이고, 읽기 어댑터가
v2 폴더 배치를 읽는 것은 이미 v1 채널·셸 규약을 읽던 일과 같은 종류다.

## 목표

- `C:\work`를 등록하면 v2 Project가 업무 프로젝트로 다시 흘러들어온다.
- 브리프가 PRJ 어휘로 말한다: key·표시명·상태·mode·work 경로·drive 경로·지식 정본·레포·데이터셋.
- "문서 작업은 팀즈 폴더, 진행 관리는 노션"이 **있을 때만** 나온다.
- `work-projects.json`·`projects.json`·`workspace.json` **스키마 무변경**, v1 폴백 유지, 다운그레이드 안전.
- `roots.drive`가 없는 PC에서 경고도 오류도 없이 조용히 생략한다.

## 비목표

- `C:\work`·`C:\data`에 쓰는 일. MCW는 읽기 전용 소비자다.
- PROJECT.yaml에 새 키를 요구하는 일. work 쪽 스키마는 고정이다.
- 수제 업무 프로젝트 4건의 자동 마이그레이션 스크립트(§5, D10).
- Google Drive 루트(`G:`)를 MCW의 네 번째 루트로 등록하는 일(§10 보류).
- 앱 UI에 PRJ-key·mode·primaryContext를 위한 **새 칸이나 필터**를 만드는 일.

## 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | v2 Project를 기존 `WorkspaceShellInfo`에 **어댑터로 싣는다**. `channel = "projects"`(휴면 `"projects/_archive"`), `shell = <PRJ-key>` | `projects/<key>`는 물리적으로 옛 `<채널>/<셸>`과 같은 2단 배치다. `workspace-registry.ts:25` `SHELL_LINK_KEYS`는 네 키의 **정확한 집합**을 요구하고 값은 `requiredString`만 검사하므로(정규식 없음) `channel:"projects"`·`shell:"PRJ-0017-secondbrain"`이 그대로 통과한다 → 레지스트리 스키마 변경 0 |
| D2 | `ref = \`${channel}/${shell}\`` — 즉 `projects/PRJ-0017-secondbrain`. **`ref = <key>`가 아니다** | `work-project-service.ts:350-353`이 링크를 `linkKey(link.root, \`${link.channel}/${link.shell}\`)`로 키잉하고 `linkKey(shell.root, shell.ref)`로 조회한다. `ref ≠ channel/shell`이면 조회가 매번 빗나가 **동기화마다 업무 프로젝트가 중복 생성**된다. `shellRef()`의 계약도 같다(`workspace-path.ts:329`) |
| D3 | v2 데이터는 **항상 `PROJECT.yaml`을 읽어** 만든다. `.ws-index.json`은 `roots`(특히 `drive`)를 얻는 데만 쓴다 | ① `.ws-index.json`의 `projects[]`에는 `externalPaths`가 **없다**(`ws-index.mjs`에 그 키가 등장하지 않는다) — 인덱스만 믿으면 루트 밖 레포가 소속을 잃는다. ② `drive` 불리언은 생성한 PC의 답이다. ③ 신선도 판정은 어차피 19개 `PROJECT.yaml`을 stat해야 하고, 읽는 비용은 1KB×19이다. v1이 "인덱스가 뒤처지면 직접 훑는 쪽이 정답"이라 적어 둔 규칙(`workspace-index.ts:31`)을 v2에서는 **기본값으로** 올린다 |
| D4 | 새 YAML 의존성을 넣지 않는다. 기존 `parseYamlFlat`으로 `PROJECT.yaml`을 읽는다 | 실제 파일로 검증했다: `key·slug·title·mode·status·primaryContext·topics·repos·externalPaths·data·wikiSource·sync`가 전부 스칼라 또는 인라인 배열이고, 중첩 블록(`legacy:`·`atlas:`)은 들여쓴 줄이 `^([A-Za-z0-9_-]+):`에 걸리지 않아 **조용히 `null`로 건너뛴다**. `package.json`에 YAML 파서가 없고 넣을 이유도 없다 |
| D5 | `WorkspaceShellInfo`에 `archived`·`mode`·`drivePath`·`wikiPath`·`topics`를 더하고, `channelLabel`을 **`groupLabel`로 개칭**하고, `channelLetter`를 **삭제**한다 | 이 타입은 `workspace-types.ts:51`이 "파일이 아니라 스캔 결과라 저장하지 않는다"고 적어 둔 **메모리 전용** 타입이다 → 계약 §8의 다운그레이드 문제가 없다. `channelLetter`는 생산 코드에서 읽는 곳이 0개다. `channelLabel`은 v2에서 채널이 아니라 `primaryContext`를 담으므로 이름이 거짓이 된다(비생산 사용처 2곳: `work-project-service.ts:412`, `workspace-brief.ts:53`) |
| D6 | v2 `groupLabel = primaryContext` | 태그 시드와 기본 묶기의 자리를 채널 라벨이 물려받는다. `parseChannel("projects")`는 `null`이라 현행 코드는 letter `"Z"` → 라벨 `"기타"`로 떨어지고, **19개가 전부 `기타` 하나로 묶인다** — 어댑터가 반드시 이 값을 바꿔 줘야 한다 |
| D7 | 태그 시드 = `[primaryContext, ...topics]`. 시드 조건은 지금과 같다 — `project-tags.json`에 **행이 없을 때 한 번만** | `2026-09-03` 스펙의 "행의 존재가 사용자가 한 번은 태그를 손댔다는 표식" 규칙을 그대로 쓴다(`work-project-service.ts:411`). 현재 19개 Project 모두 `topics: []`라 실질 시드는 `primaryContext` 하나지만, 표현식은 work 쪽이 topic을 채우기 시작하는 날을 그냥 따라간다 |
| D8 | `mode`는 브리프에 찍는 문자열로만 존재한다. 어떤 분기도 만들지 않는다 | 2026-09-03 "워크스페이스 모델의 도메인 개념을 반영하지 않는다"와 공존하는 선. 분기가 없으면 work 쪽이 어휘를 바꿔도 앱을 고칠 일이 없다 |
| D9 | 휴면(`archived`) Project는 스냅샷에 **넣되** 업무 프로젝트로 **만들지 않는다**. 이미 링크된 것은 그대로 둔다 | 넣는 이유: `C:\dev\_archive\*` 레포 19개가 소속을 알아야 하고, 그 폴더에서 연 세션도 브리프를 받아야 한다. 만들지 않는 이유: 사이드바에 멤버 0인 줄 8개가 선다. 지우지 않는 이유: 상태가 바뀌었다고 사용자 데이터를 삭제하는 것은 이 코드베이스의 어떤 규칙과도 맞지 않는다 |
| D10 | 수제 4건의 마이그레이션 코드를 만들지 않는다. §5의 **수동 4단계 절차**를 릴리스 노트에 적는다 | 4건이고, 잃는 것은 이름·구분·상태뿐이다(네 건 모두 `memo`·`notionLinks`·`localFolders`가 비어 있다). "기존 업무 프로젝트를 PRJ에 연결" 액션은 존재하지 않고, 만들면 IPC + 서비스 메서드 + 상세 페이지 피커가 새로 생긴다 — 4건을 위한 값이 아니다 |
| D11 | `name = title`이고, 만든 뒤에는 **다시 쓰지 않는다** | 지금 구조가 이미 그렇다: `syncFromWorkspace`는 생성 시에만 `name`을 정하고 이후엔 `members`만 갱신한다(`work-project-service.ts:414-420`). `work-project-workspace-sync.test.ts:178` "refreshes members on a later run without touching the metadata the user owns"가 그 선을 못박아 둔다. 뒤집으려면 "사용자가 바꿨는가"를 알아야 하고, 그러려면 **심어 준 title을 어딘가 기록해야** 한다 → 계약 §8에 따라 새 파일이 하나 더 생긴다. title은 거의 안 바뀌고, 바뀌었을 때 상세 페이지에서 한 번 고치면 된다 |
| D12 | `classifyWorkspacePath`의 kind 어휘를 `ws-path.vectors.json`(교차 저장소 **정본**)에 맞춘다: `channel`→`legacy-channel`, `shell`→`legacy-shell`, `shell-sub`→`legacy-shell-sub`, 그리고 v2 kind 5개 추가 | 정본 파일이 이미 `legacy-*`로 개칭했고 앱만 뒤처져 있다. 생산 코드에는 `classifyWorkspacePath`·`deriveWorkspaceLocation`·`WorkspaceLocationKind`의 **외부 소비자가 하나도 없다**(`resolveShellRefForPath` 내부 호출과 테스트뿐) → 개칭 비용이 테스트 파일 하나다 |
| D13 | UI의 "채널·셸" 문구를 v2 어휘로 **교체**한다. v1 문구를 병기하지 않는다 | `~/.multi-cli-work/workspace.json`이 **존재하지 않는다** — 이 사용자는 워크스페이스 루트를 한 번도 등록한 적이 없고, 따라서 v1 어휘를 보고 있는 사용자가 0명이다. 대상은 `SettingsDialog.tsx:238-239`(안내문)·`255`("셸 N개")·`290`("셸을 다시 읽었습니다") |
| D14 | 브리프의 맺음 문장을 **실린 절에서** 조립한다. `## 팀즈 문서 폴더`는 `## 문서 폴더`로 바꾼다 | v2에서 `docs` 멤버는 팀즈 폴더가 아니라 `C:\work\projects\PRJ-…` 프로젝트 폴더다. 브랜드 낱말을 제목에서 떼고, "팀즈"는 `teamsSyncRoot`가 설정됐을 때만 문장에 넣는다 |
| D15 | v2 `externalPaths`는 **논리 경로**다 — `wikiSource`와 같은 `resolveLogicalPath`로 풀어 절대경로로 싣는다. 못 푸는 값은 **조용히 뺀다** | work 쪽 `_scripts/lib/project-manifest.mjs:32` `ABS_OR_ESCAPE_RE = /^[A-Za-z]:\|^[\\/]\|^~\|^\.\.[\\/]/`가 `validateManifest:317`에서 `externalPaths`·`repos`·`data`·`related`의 절대경로·탈출 경로를 위반으로 보고한다. `C:\work\CLAUDE.md` 56·86·131행도 명시한다: "`externalPaths[]` = 논리 경로 접두", "제자리 + `externalPaths: [onedrive/<상대경로>]`", "루트 밖 레포는 논리 경로 접두로 등록(**절대경로 금지**)". v1의 `external_paths`(절대경로 + `cleanWorkspacePath`)와 **의미가 다르다** — 그대로 절대경로로 읽으면 `onedrive/…` 값이 역인덱스에서 아무 폴더와도 맞지 않는다. 못 푸는 값을 조용히 빼는 것은 `roots.drive` 없음과 같은 선이다 |
| D16 | 한 경로를 여러 Project가 등록하면 **마지막에 쓴 것이 이긴다**(v1부터의 규칙 유지). 다만 그 사실을 경고 한 줄로 드러낸다 | `workspace-index.ts:279-292`의 역인덱스는 평범한 대입(`repoOwners[key] = shell.ref`)이라 나중 항목이 앞의 것을 덮는다. `WorkProject.members`가 "한 폴더는 한 업무 프로젝트에만 속한다"를 SSOT로 두므로 **누군가는 이겨야 한다**. 순서는 프로젝트 폴더 이름 정렬이라 실행마다 같다(`PRJ-0006` < `PRJ-0010` < `PRJ-0011` → 마지막이 이긴다). 규칙을 바꾸지 않는 이유는 v1 동작을 건드리지 않기 위해서고, 경고를 더하는 이유는 사이드바에서 줄이 옮겨 간 까닭이 지금은 아무 데도 안 나오기 때문이다 — 실제로 `onedrive/수행프로젝트(기술연구소) - 문서/O_삼성서울병원` 한 폴더가 PRJ-0006·0010·0011 셋의 `externalPaths`에 동시에 들어간다 |

## 컴포넌트별 설계

### 1. `src/shared/workspace-types.ts`

```ts
export interface WorkspaceShellInfo {
  root: string;
  /** 반드시 `${channel}/${shell}` — 링크 조회의 키다(D2). */
  ref: string;
  /** v2: "projects" | "projects/_archive" · v1: 채널 폴더명. shellLink.channel로 저장된다. */
  channel: string;
  /** v2: PRJ-key · v1: 셸 폴더명. shellLink.shell로 저장된다. */
  shell: string;
  /** 태그 시드와 기본 묶기가 쓰는 묶음 라벨. v2: primaryContext · v1: 채널 라벨. (구 channelLabel) */
  groupLabel: string;
  /** v2: PROJECT.yaml topics · v1: 항상 []. groupLabel과 함께 태그로 심긴다. */
  topics: string[];
  title: string;
  status: string | null;
  /** 브리프 한 줄로만 흘러가는 문자열. 이 값으로 분기하지 않는다(D8). v1은 null. */
  mode: string | null;
  /** v2: `projects/_archive` 하위인가 · v1: 항상 false. 업무 프로젝트 생성 제외 판정(D9). */
  archived: boolean;
  path: string;
  /** 레포 **이름** 배열. 경로는 등록된 dev 루트에서 만든다. */
  repos: string[];
  /**
   * 루트 밖 경로의 **절대경로**. v2의 `PROJECT.yaml`은 이 값을 논리 경로(`onedrive/…`·`dev/…`)로
   * 들고 있으므로 어댑터가 `resolveLogicalPath`로 풀어 넣는다(D15). 못 푼 값은 여기 없다.
   */
  externalPaths: string[];
  data: string[];
  /** `<roots.drive>\projects\<key>` — 그 폴더가 실재할 때만. 그 밖엔 null(D3). */
  drivePath: string | null;
  /** PROJECT.yaml `wikiSource`의 논리 경로를 등록된 루트로 푼 절대경로. 못 풀면 null. */
  wikiPath: string | null;
}
```

`channelLetter`는 삭제한다(D5). `WorkspaceRoots`·`WorkspaceRoot`·`WorkspaceRegistryV1`·
`WorkspaceShellLink`·`WorkspaceSnapshot`은 **그대로**다 — 특히 `WorkspaceRoot`에 `drive`를 더하지
않는다: `workspace-registry.ts:24` `ROOT_KEYS`가 exact-keys라 구버전이 파일 전체를 거부한다.

### 2. `src/shared/workspace-path.ts`

`C:\work\_scripts\lib\ws-path.mjs`의 미러를 갱신한다. 정규식과 kind 어휘는 문자 단위로 같아야
한다. `C:\work\_scripts\lib\ws-path.vectors.json`은 **읽기만 하고 고치지 않는다**(교차 저장소 계약).

추가:

```ts
export const PROJECT_KEY_RE = /^PRJ-(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
export const PROJECTS_DIR = "projects";
export const ARCHIVE_DIR = "_archive";

export interface ParsedProjectKey { seq: number; slug: string; key: string }
export function parseProjectKey(key: string): ParsedProjectKey | null;
```

`WorkspacePathKind` 개편(D12):

```
root | projects-root | project | project-sub | project-archive | project-archive-sub
     | legacy-channel | legacy-shell | legacy-shell-sub
     | dev-dir | repo | repo-archive | repo-sub
     | data-root | data-purpose | dataset | dataset-sub | wiki | other | outside
```

`classifyWorkspacePath`의 work 루트 분기에 `ws-path.mjs:153-167`과 같은 순서로 `projects` 절을
끼운다 — `wiki` → 예약/`_`/`.` 접두 → **`projects`** → 채널. `projects` 절은 `project`/`project-sub`/
`project-archive`/`project-archive-sub`에서 다음을 함께 채운다:

| 필드 | 값 |
|---|---|
| `project` | PRJ-key (`ws-path.mjs`와 같은 필드명) |
| `channel` | `"projects"` 또는 `"projects/_archive"` |
| `shell` | PRJ-key |
| `archived` | `_archive` 하위인가 |
| `parsedProject` | `parseProjectKey` 결과 |

`channel`·`shell`을 채우는 이유는 `resolveShellRefForPath`가 `location.channel && location.shell`로
ref를 조립하기 때문이다(`workspace-path.ts:368`) — 이 한 줄로 `C:\work\projects\PRJ-0017-secondbrain\wiki`도
`projects/PRJ-0017-secondbrain`을 답한다. `KIND_MAP`은 새 kind 네 개를 각각 `shell`/`shell-sub`
(`WorkspaceLocationKind`는 앱 내부 어휘라 그대로 둔다)로 접고, `projects-root`는 `other`로 접는다.

### 3. `src/main/projects/workspace-index.ts`

#### 레이아웃 판정

```ts
/** `<root>/projects` 아래에 PRJ-key 폴더가 하나라도 있으면 v2다. 없으면 v1 채널 스캔. */
async function detectLayout(root: string): Promise<"v2" | "v1">;
```

v2로 판정되면 최상위의 채널 꼴 폴더는 **무시하고 경고 한 줄**을 남긴다:
`[legacy-layout] O_SMCH: projects/ 평면 구조로 옮긴 뒤 남은 폴더` — 컷오버 중간 상태를 조용히
먹어 버리지 않기 위한 것이고, 지금 `C:\work`에는 해당 폴더가 없다.

#### v2 스캔

```ts
interface ProjectStat { key: string; archived: boolean; yamlPath: string; mtimeMs: number }

async function statProjects(root: string): Promise<{ projects: ProjectStat[]; warnings: string[] }>;
async function scanProjects(
  root: WorkspaceRoot,
  stats: ProjectStat[],
  drive: string | null,
): Promise<WorkspaceShellInfo[]>;
```

`statProjects`는 `<root>/projects`와 `<root>/projects/_archive`의 디렉터리를 열거한다.
`.`·`_` 접두는 건너뛰고(`_archive` 자체는 따로 다룬다), 나머지에 대해:

| 상황 | 동작 |
|---|---|
| `parseProjectKey` 실패 | `[project-key] projects/<이름>: 프로젝트 키 규약 위반(PRJ-####-slug)` 경고, 건너뜀 |
| `PROJECT.yaml` 없음 | `[project-yaml] projects/<key>: PROJECT.yaml 없음` 경고, 건너뜀 |

v1의 두 경고(`[shell-name]`·`[shell-claude]`)와 대칭이고, 설정 화면의 경고 목록
(`SettingsDialog.tsx:300`)이 그대로 보여 준다.

`scanProjects`는 `PROJECT.yaml`을 `splitFrontmatter`로 읽는다. `PROJECT.yaml`은 `---` 울타리가
없는 순수 YAML이므로 `parseYamlFlat`을 직접 부른다.

**필드 매핑표**

| `WorkspaceShellInfo` | v2 출처 | v1 출처 |
|---|---|---|
| `root` | 등록된 `root.work` | 같음 |
| `ref` | `` `${channel}/${key}` `` | `` `${채널}/${셸}` `` |
| `channel` | `"projects"` / `"projects/_archive"` | 채널 폴더명 |
| `shell` | PRJ-key(폴더명) | 셸 폴더명 |
| `groupLabel` | `primaryContext` → 없으면 `""` | `CHANNEL_LETTER_LABEL[letter]` |
| `topics` | `topics` | `[]` |
| `title` | `title` → 없으면 PRJ-key | CLAUDE.md `title` → 폴더명 |
| `status` | `status` | `status` |
| `mode` | `mode` | `null` |
| `archived` | `_archive` 하위 | `false` |
| `path` | `<work>\projects[\_archive]\<key>` | `<work>\<채널>\<셸>` |
| `repos` | `repos` | `repos` |
| `externalPaths` | `externalPaths`, 각 값을 **`resolveLogicalPath`로 푼 절대경로**. 못 푸는 값은 조용히 뺀다(D15) | `external_paths`, 각 값 `cleanWorkspacePath` (절대경로) |
| `data` | `data` | `data` |
| `drivePath` | `<drive>\projects\<key>`가 실재하면 그 값, 아니면 `null` | `null` |
| `wikiPath` | `wikiSource`를 논리 경로로 해석, 못 풀면 `null` | `null` |

`repos`는 **이름 배열 그대로** 둔다. `.ws-index.json`의 `repos{}.path`는 쓰지 않는다 —
생성한 PC의 절대경로이고, v1 어댑터가 같은 이유로 `.ws-index.json`의 `path`를 버리고 다시
만든다(`workspace-index.ts:212-214`). 경로 해석은 지금처럼 `snapshot()`이 등록된 dev 루트에서
`<dev>\<name>`과 `<dev>\_archive\<name>` **두 키를** 등록한다(`workspace-index.ts:284-287`) —
`repos{}.archive`를 볼 필요가 없다.

#### 논리 경로 해석 (`wikiSource`와 `externalPaths`)

```ts
/** `dev/…`·`data/…`·`drive/…`·`onedrive/…` 접두를 등록된 루트로 푼다. 못 풀면 null. */
function resolveLogicalPath(
  root: WorkspaceRoot,
  extra: { drive: string | null; onedrive: string | null },
  logical: string,
): string | null;
```

`ws-path.mjs:81-95` `resolveLogical`의 축약본이다. 원본은 미설정 루트에 대해 **던지지만**,
여기서는 `null`을 준다 — 브리프 한 줄이나 역인덱스 한 칸이 빠지는 것이 세션 시작이 깨지는 것보다
낫고, 이 스펙의 "`roots.drive`가 없으면 조용히 생략" 규칙과 같은 문장이다. 접두가 없으면 work
기준으로 푼다. 단 `drive/`·`onedrive/` 접두를 **미설정이라고 work 기준으로 떨어뜨리지는 않는다** —
`C:\work\onedrive\…` 같은 유령 경로가 되고, 원본이 던지는 이유도 그것이다.

이 해석기가 두 곳에 쓰인다.

| 쓰는 곳 | 값 | 못 풀 때 |
|---|---|---|
| `wikiPath` | `wikiSource`(스칼라 하나) | `null` |
| `externalPaths` | `externalPaths`(배열, 각 값) | 그 항목을 **배열에서 뺀다** |

`externalPaths`가 논리 경로라는 것이 v1과의 **의미 차이**다(D15). work 쪽
`project-manifest.mjs:32`의 `ABS_OR_ESCAPE_RE`가 절대경로를 거부하므로 v2에는 절대경로가 올 수
없다. 실제 값의 모양은 이렇다(한글·공백·괄호가 그대로 들어간다).

```
onedrive/수행프로젝트(기술연구소) - 문서/O_삼성서울병원
  → C:\Users\uiop3\OneDrive - 노바테크\수행프로젝트(기술연구소) - 문서\O_삼성서울병원
```

v1 경로(`scanShells`/`shellsFromWsIndex`)는 `external_paths`를 **절대경로**로 계속 읽고
`cleanWorkspacePath`로 겹백슬래시만 접는다 — 한 줄도 바뀌지 않는다.

#### 한 경로를 여러 Project가 등록할 때 (D16)

`snapshot()`의 역인덱스는 평범한 대입이라 **마지막에 쓴 것이 이긴다**
(`workspace-index.ts:279-292`). `WorkProject.members`가 "한 폴더는 한 업무 프로젝트에만 속한다"를
SSOT로 못박고 있어 누군가는 이겨야 하고, 순서는 프로젝트 폴더 이름 정렬이므로 실행마다 같다.

이 규칙은 **바꾸지 않는다**(v1 동작 유지). 대신 `snapshot()`이 중복 등록을 모아 경고를 남긴다 —
사이드바에서 폴더 줄이 어느 프로젝트 아래에 선 까닭이 지금은 아무 데도 나오지 않기 때문이다.

```
[path-owner] C:\Users\uiop3\OneDrive - 노바테크\수행프로젝트(기술연구소) - 문서\O_삼성서울병원:
  3개 프로젝트가 같은 경로를 등록했다(projects/PRJ-0006-vsp · projects/PRJ-0010-foaa ·
  projects/PRJ-0011-navi) — projects/PRJ-0011-navi가 이긴다
[repo-owner] shared-lib: 2개 프로젝트가 같은 레포를 등록했다(… ) — …가 이긴다
```

레포는 **이름 단위로** 한 번만 경고한다 — 역인덱스가 이름 하나로 `<dev>\<name>`과
`<dev>\_archive\<name>` 두 키를 등록하므로, 경로 단위로 세면 같은 충돌이 두 줄로 나온다.
경고에 적는 경로는 정규화 키(win32에서 소문자)가 아니라 **원본 표기**다.

#### `drive`·`onedrive` 루트 얻기

`readWsIndexRoots`는 이미 string 값만 거르므로 `drive`·`onedrive`가 늘어도 깨지지 않는다
(`workspace-index.ts:110-124`). 이 값을 `scanRoot`에서 한 번 읽어 `scanProjects`에 넘긴다.
`resolveWorkspaceRoots`의 반환 타입(`{dev, data}`)은 **건드리지 않는다** — 그 값은
`workspace.json`에 저장되고 `ROOT_KEYS`가 exact-keys다(D5).

`.ws-index.json`이 없으면 `drive`·`onedrive`는 `null`이고 `drivePath`도 `null`이다. 경고를 남기지
않는다: DRIVE_ROOT 미설정은 정상 상태다.

#### 신선도와 캐시

`scanRoot`의 fingerprint를 레이아웃별로 짓는다.

- v2: `JSON.stringify([wsIndexMtime, projects.map(p => [p.key, p.archived, p.mtimeMs])])`
- v1: 지금 그대로

`wsIndexMtime`을 v2에서도 넣는 이유는 그 파일이 `roots.drive`의 출처이기 때문이다 —
DRIVE_ROOT를 새로 설정해 인덱스를 다시 만들면 캐시가 버려져야 한다.

v2에는 "인덱스가 최신이면 지름길" 분기가 **없다**(D3). `shells.length !== stats.length` 같은
불신 휴리스틱도 함께 사라진다 — 읽는 원본이 하나이므로 어긋날 대상이 없다.
`shellsFromWsIndex`는 v1 전용으로 남는다(주석에 그 사실을 적는다).

### 4. `src/main/projects/work-project-service.ts` — `syncFromWorkspace`

시그니처와 반환 타입(`WorkspaceSyncResult`)은 그대로다. 변경 두 줄.

```ts
for (const shell of snapshot.shells) {
  // 휴면 Project는 새로 만들지 않는다(D9). 이미 링크된 것은 아래 분기에서 그대로 갱신된다.
  const link = linksByKey.get(linkKey(shell.root, shell.ref));
  let target = link ? next[link.workProjectId] : undefined;
  if (!target && shell.archived) continue;
  if (!target) {
    const name = shell.title;                       // ← 기존 `shell.ref`
    …
  }
  if (!Object.prototype.hasOwnProperty.call(tagRegistry.tags, target.id)) {
    tagSeeds.set(target.id, normalizeTags([shell.groupLabel, ...shell.topics]));  // ← D7
  }
  …
}
```

`skipped.push(shell.ref)`는 그대로 `ref`를 담는다 — 어느 Project가 건너뛰어졌는지가 요점이고
`ref`가 그 전역 키다. 이름 충돌 판정도 그대로 `name`(= title) 비교다.

`membersByRef`·`manualOwned`·`claimed`·태그 정리 로직은 **한 줄도 바뀌지 않는다**. v2가
`resolveShellRefForPath`를 통해 같은 `ref`를 받기 때문이다.

### 5. `src/main/projects/workspace-brief.ts`

`WorkspaceBriefInput`에 `siblingShells`를 `siblingProjects`로 두고(같은 `groupLabel`을 가진 다른
Project), `renderWorkspaceBrief`의 머리 절을 다음으로 바꾼다.

```
# 워크스페이스: projects/PRJ-0017-secondbrain

- 표시명: 세컨드브레인(LLMwiki·atlas·bolt·multi-cli-work)
- 상태: active                       ← status 있을 때만
- 진행 방식: continuous               ← mode 있을 때만 (D8)
- 컨텍스트: 개인                      ← groupLabel 있을 때만
- 프로젝트 폴더: C:\work\projects\PRJ-0017-secondbrain
- 프로젝트 문서: C:\work\projects\PRJ-0017-secondbrain\CLAUDE.md
- drive 폴더: G:\내 드라이브\projects\PRJ-0017-secondbrain   ← drivePath 있을 때만
- 지식 정본: C:\dev\llmwiki\wiki                             ← wikiPath 있을 때만
- 루트 원칙: C:\work\CLAUDE.md
```

이어지는 절 제목은 v2 어휘로 바꾼다.

| 기존 | v2 |
|---|---|
| `## 같은 셸의 레포 (로컬 절대경로)` | `## 이 프로젝트의 레포 (로컬 절대경로)` |
| `## 같은 채널(<채널>)의 다른 셸` | `## 같은 컨텍스트(<groupLabel>)의 다른 프로젝트` |
| `## 이 셸이 쓰는 데이터셋` | `## 이 프로젝트가 쓰는 데이터셋` |
| 맺음: "코드는 `dev/` 레포에, 문서·지식·데이터 명세는 셸 폴더에 둔다" | "…프로젝트 폴더에 둔다" |

`groupLabel`이 빈 문자열이면 "같은 컨텍스트" 절을 생략한다. `buildWorkspaceBrief`의 흐름
(ref 해석 → shell 찾기 → owner 루트 → 데이터셋 경로)은 그대로고, `wiki/data.md` 발췌도
`<project>\wiki\data.md`로 같은 상대 위치를 본다.

휴면 Project도 브리프를 받는다(D9) — 상태 줄이 `archived`로 나오는 것이 그 사실을 전달한다.

### 6. `src/main/projects/work-project-brief.ts`

`renderWorkProjectBrief`에 네 번째 인수를 더한다.

```ts
export function renderWorkProjectBrief(
  workProject: WorkProject,
  members: WorkProjectBriefMember[],
  tags: readonly string[] = [],
  options: { teamsSyncRoot?: string | null } = {},
): string;
```

호출부는 `runtime.ts:299`뿐이고, 그 함수는 이미 `readWorkProjectRegistry()`를 불러 두었으므로
`{ teamsSyncRoot: workProjectRegistry.teamsSyncRoot }`를 그대로 넘긴다(`ipc.ts:816`이 같은 값을
같은 방식으로 읽는다).

- 문서 절 제목: `## 팀즈 문서 폴더 (공식 문서: 계획서·보고서·발표자료)` →
  `teamsSyncRoot`가 설정돼 있으면 `## 팀즈 문서 폴더 (공식 문서: 계획서·보고서·발표자료)`,
  아니면 `## 문서 폴더 (공식 문서: 계획서·보고서·발표자료)`.
- 맺음 문장: 고정 문구를 버리고 **실린 절에서 조립한다.**

| 조각 | 조건 |
|---|---|
| `문서 작업은 팀즈 폴더` | `docs.length > 0 && teamsSyncRoot` |
| `문서 작업은 위 문서 폴더` | `docs.length > 0 && !teamsSyncRoot` |
| `진행 관리는 노션` | `notionLinks.length > 0` |
| `코드는 위 레포 경로` | `repos.length > 0` |

조각이 하나 이상이면 `이 세션은 위 업무 프로젝트에 소속된 작업 공간에서 실행 중이다. <조각들을
", "로 이어>를 기준으로 한다.`, 없으면 첫 문장만 남긴다. 참고 로컬 폴더 줄은 지금 그대로다.

### 7. 렌더러

#### `src/renderer/src/sidebar-tree.ts`

`CHANNEL_LABEL_ORDER`를 `LEGACY_LABEL_ORDER`로 개칭하고(값은 그대로), `defaultGroupingTags`가
라벨 목록을 **받도록** 바꾼다.

```ts
export function defaultGroupingTags(
  tagsByWorkProject: Readonly<Record<string, readonly string[]>>,
  orderedLabels: readonly string[],
): string[];
```

`orderedLabels`에서 실제로 붙어 있는 태그만 남긴다. `hasWorkspaceShells: boolean`은 사라진다 —
빈 배열이 곧 "묶을 것이 없다"다(옛 판정과 결과가 같다: 라벨이 하나도 없으면 옛 코드도 `[]`를 줬다).

`ProjectSidebar.tsx:490-493`이 호출부다.

```ts
const orderedLabels = useMemo(() => orderWorkspaceLabels(Object.values(workspaceShells)), [workspaceShells]);
```

`orderWorkspaceLabels`는 `groupLabel`의 중복을 첫 등장 순서로 없애고, `LEGACY_LABEL_ORDER`에
있는 라벨을 **앞으로 끌어올린다**. v1 사용자의 화면 순서(과제·용역·연구·기타·개인)가 바이트
단위로 보존되고, v2 컨텍스트는 스냅샷 순서(= PRJ seq 순서)를 따른다. 하드코딩되는 컨텍스트
이름은 하나도 없다.

#### `src/renderer/src/SettingsDialog.tsx` (D13)

| 위치 | 기존 | v2 |
|---|---|---|
| `238-239` | "채널·프로젝트 셸·`dev/` 레포가 사는 폴더입니다. 등록하면 사이드바가 레포를 소속 셸 아래로 묶고…" | "Project 폴더(`projects/PRJ-####-slug`)와 `dev/` 레포가 사는 폴더입니다. 등록하면 사이드바가 레포를 소속 프로젝트 아래로 묶고…" |
| `232`·`255` | `shellsOf` / `셸 {n}개` | `projectsOf` / `프로젝트 {n}개` (휴면 포함 — 스냅샷에 든 수를 그대로 센다) |
| `290` | `"셸을 다시 읽었습니다"` | `"프로젝트를 다시 읽었습니다"` |

`App.tsx:409`·`ProjectSidebar.tsx:75-76,702` 등의 주석 어휘도 함께 손본다. 동작 변경은 없다.

## 첫 동기화 시나리오와 수제 4건 처리

### 지금 상태 (읽어서 확인한 사실)

- `~/.multi-cli-work/workspace.json`이 **없다** → 등록된 루트 0개, `shellLinks` 0개.
- `~/.multi-cli-work/project-tags.json`이 **없다** → 태그 행 0개. 첫 동기화가 전부 시드한다.
- `projects.json`에 폴더 11개, `work-projects.json`에 수제 4건. **11개 폴더가 모두** 어느 수제
  업무 프로젝트의 멤버다(미분류 0개).
- `C:\work\.ws-index.json`: `schemaVersion: 2`, Project 19건(active 11 · archived 8),
  `roots = {work, dev, data, onedrive}` — **`drive`가 없다**(DRIVE_ROOT 미설정).

### `C:\work`를 등록한 직후 (1차 동기화)

`workspace:add`가 루트를 등록하고 곧바로 `sync`를 돈다(`ipc.ts:876-883`).

- 스냅샷: Project 19건(휴면 8 포함), 레포 역인덱스 키 약 116개(`<dev>\<name>` + `<dev>\_archive\<name>`).
- 업무 프로젝트 생성: **active 11건만**(D9). `name`은 PROJECT.yaml `title`.
- `skipped`: **빈 배열.** 수제 이름(`R_세컨드브레인` 등)과 title(`세컨드브레인(LLMwiki·…)`)이
  달라 충돌 판정에 걸리지 않는다.
- 멤버: 11개 폴더가 전부 `manualOwned`라 `work-project-service.ts:414-416`이 걸러낸다 →
  **새로 생긴 11건은 멤버가 0개**다. 사이드바에 빈 줄 11개가 선다.
- 태그: 11건에 `primaryContext`가 심긴다(개인 · 병원 공동연구 · 외부기관 협업 · 디지트랙).
  저장된 묶기 선호가 없으므로 기본 묶기가 그 네 라벨로 돈다.

이 "빈 줄 11개"가 자동 마이그레이션을 만들지 않기로 한(D10) 대가이며, 아래 절차로 한 번에 풀린다.

### 수동 절차 (릴리스 노트에 적는다)

1. 설정 › 워크스페이스 루트에서 `C:\work`를 등록한다. → active 11건이 멤버 0으로 생긴다.
2. 수제 4건(`Z_기타`·`O_에이티앤씨`·`R_세컨드브레인`·`S_결혼식`)을 삭제한다. 폴더는
   `projects.json`에 그대로 남아 **미분류**로 내려앉는다(`removeWorkProject`는 폴더를 지우지 않는다).
3. 설정 › **다시 읽기**. → 8개 폴더가 제 PRJ 아래로 붙는다.

| 폴더 | 붙는 곳 |
|---|---|
| `C:\dev\multi-cli-work`, `llmwiki`, `deck`, `atlas`, `bolt` | 세컨드브레인(LLMwiki·atlas·bolt·multi-cli-work) |
| `C:\dev\mobile-invitation` | PRJ-0018-wedding |
| `C:\dev\rafaam11`, `rafaam11.github.io` | PRJ-0015-career |

4. 남는 3개는 붙을 자리가 없다. 필요하면 수제 업무 프로젝트 하나에 모아 둔다.

| 남는 폴더 | 이유 |
|---|---|
| `C:\Users\uiop3` | 세 루트 어디에도 없다 |
| `G:\내 드라이브\S_결혼식\결혼식준비` | drive는 MCW의 루트가 아니다(§10 보류) |
| `C:\NeuroPilot\neuropilot_develop` | **어느 논리 루트에도 속하지 않는다.** v1에서는 셸 `external_paths`가 절대경로로 들고 있었지만, v2의 `externalPaths`는 논리 경로만 받는다(D15) — `C:\NeuroPilot`은 work·dev·data·drive·onedrive 어느 것의 하위도 아니어서 적을 수 있는 논리 경로가 없다 |

잃는 것은 4건의 이름·구분·상태뿐이다(네 건 모두 `memo`·`notionLinks`·`localFolders`가 비어 있다).
새로 생긴 업무 프로젝트의 구분은 설정의 기본 구분이므로, 원하는 구분은 상세 페이지에서 다시 고른다.

### 곧 들어올 `externalPaths`가 무엇을 바꾸는가

work 쪽이 2026-09-21에 조직 OneDrive 폴더를 `externalPaths`로 등록했다(폴더를 옮기지 않고 제자리 참조).

| Project | `externalPaths` |
|---|---|
| PRJ-0005-neuropilot | `onedrive/수행프로젝트(기술연구소) - 문서/G_보건의료과제`, `onedrive/수행프로젝트(기술연구소) - 문서/O_에이티앤씨` |
| PRJ-0006-vsp · PRJ-0010-foaa · PRJ-0011-navi | 셋 다 `onedrive/수행프로젝트(기술연구소) - 문서/O_삼성서울병원` |

이 PC의 `roots.onedrive`는 `C:\Users\uiop3\OneDrive - 노바테크`이므로 다섯 값 모두 풀린다. 결과:

- 그 폴더들은 **아직 `projects.json`에 없다**(열어 둔 폴더 11개에 없다) → 당장 멤버가 생기지 않는다.
- 사용자가 그중 하나를 열면 역인덱스가 소속을 답한다. `O_삼성서울병원`은 셋이 등록했으므로 **마지막인
  PRJ-0011-navi가 이기고**(D16) 설정 화면에 `[path-owner]` 경고 한 줄이 선다.
- 브리프의 "이 프로젝트의 레포" 절에 그 절대경로가 실린다.

### 경계: 링크된 업무 프로젝트의 수동 멤버는 오래 살지 않는다

`work-project-service.ts:414`가 링크된 업무 프로젝트의 `members`를 **매 동기화마다 스냅샷에서
다시 계산한다.** 사이드바 드래그로 넣은 폴더가 `repos`/`externalPaths`에서 유도되지 않으면 다음
동기화에 빠진다. 이것은 v1부터의 동작이고 바꾸지 않는다 — 소속의 SSOT는 PROJECT.yaml이다.

그래서 어떤 폴더를 PRJ 아래에 **오래 두려면** work 쪽 `PROJECT.yaml`이 그 폴더를 가리킬 수 있어야
한다. 논리 경로로 적을 수 없는 폴더(`C:\NeuroPilot\neuropilot_develop`·`C:\Users\uiop3`)는 방법이
없다 — 그 폴더를 `C:\dev` 아래로 옮기거나, 수제 업무 프로젝트에 두는 것 둘뿐이다.

## 오류와 경계

| 상황 | 동작 |
|---|---|
| `.ws-index.json` 없음 | v2 스캔은 그대로 돈다(D3 — 원본은 `PROJECT.yaml`이다). `drivePath`·`wikiPath`의 `drive/`·`onedrive/` 해석만 `null`. 경고 없음 |
| `.ws-index.json`이 v1(`shells[]`, `projects[]` 없음) | `<root>/projects`도 없을 것이므로 레이아웃 판정이 v1로 떨어지고 기존 경로를 그대로 탄다. 지름길·재스캔·캐시 판정 전부 현행 유지 |
| `roots.drive` 없음 (지금 이 PC) | `drivePath = null`, 브리프에 drive 줄이 없다. 경고·오류 없음 |
| `roots.drive`는 있지만 `<drive>\projects\<key>` 폴더가 없음 | `drivePath = null`. 인덱스의 `project.drive` 불리언을 믿지 않고 직접 stat한다 |
| `externalPaths`에 `onedrive/…`가 있는데 `roots.onedrive`가 없음 | 그 항목만 배열에서 빠진다. **경고 없음**(D15) — `roots.drive` 없음과 같은 선이다 |
| `externalPaths`에 절대경로가 들어 있음(손편집한 파일) | `resolveLogicalPath`가 `C:\…`를 접두 없는 상대 경로로 보고 work 기준으로 이어 붙여 `C:\work\C:\…` 같은 값을 만든다. work 쪽 `validateManifest`가 그 파일을 이미 위반으로 보고하므로 MCW는 **따로 검사하지 않는다** — 루트 등록이 폴더를 검증하지 않는 것과 같은 선이고, 잘못된 키는 아무 폴더와도 맞지 않아 조용히 무해하다 |
| 한 경로·레포를 여러 Project가 등록 | **마지막에 쓴 것이 이긴다**(D16, v1 규칙 유지). `[path-owner]`/`[repo-owner]` 경고 한 줄 |
| `PROJECT.yaml`의 레포 이름이 `<dev>`에도 `<dev>\_archive`에도 없음 | 역인덱스에 두 키가 그냥 등록되고 아무 폴더도 맞지 않는다. 브리프는 유도한 경로를 적는다. **존재 검사를 하지 않는다** — 루트 등록이 폴더를 검증하지 않는 것과 같은 선이고, v1도 같았다 |
| `projects/`에 키 규약을 어긴 폴더 | 경고 한 줄, 건너뜀 |
| `projects/<key>/PROJECT.yaml` 없음 | 경고 한 줄, 건너뜀 |
| `title`이 비었거나 없음 | PRJ-key로 떨어진다(v1이 폴더명으로 떨어지는 것과 같다) |
| `primaryContext` 없음 | `groupLabel = ""`. 태그를 심지 않고, "같은 컨텍스트" 절과 기본 묶기에서 빠진다 |
| `PROJECT.yaml`의 중첩 블록(`legacy:`·`atlas:`) | `parseYamlFlat`이 들여쓴 줄을 건너뛰고 블록 키를 `null`로 읽는다. 쓰지 않는 값이다 |
| archived Project | 스냅샷에 들어가고 브리프를 받는다. 업무 프로젝트를 새로 만들지 않는다. 이미 링크된 것은 멤버가 계속 갱신된다 |
| active → archived로 바뀐 Project | 링크와 업무 프로젝트가 살아 있다. 지우지 않는다 |
| v2와 legacy 채널 폴더가 섞여 있음 | v2가 이기고, 남은 채널 폴더마다 `[legacy-layout]` 경고 한 줄 |
| 등록한 루트가 존재하지 않음 | 지금처럼 빈 스냅샷. 던지지 않는다 |

## 다운그레이드 안전성

v1.31.0이 만든 상태를 v1.30.1이 읽어도 아무것도 잃지 않는다.

1. **`projects.json` 무변경.** 이 스펙은 폴더 레지스트리를 건드리지 않는다.
2. **`work-projects.json` 무변경.** 바뀌는 것은 `name` **값**(ref → title)뿐이고 스키마는 그대로다.
   v1.30.1의 exact-keys 파서가 그대로 통과시킨다.
3. **`workspace.json` 무변경.** `shellLinks`에 들어가는 값이
   `{workProjectId, root, channel: "projects", shell: "PRJ-0017-secondbrain"}`으로 바뀌지만,
   `workspace-registry.ts:104-109`은 네 값에 `requiredString`만 적용하고 정규식을 걸지 않는다 →
   v1.30.1이 파일을 **그대로 파싱한다.** `parseShellLinks`의 두 유일성 검사
   (`workProjectId` 유일 · `root|channel/shell` 유일)도 만족한다.
4. **`project-tags.json` 무변경.** `tags`는 열린 레코드이고 값은 문자열 배열이다. 컨텍스트 이름
   (`병원 공동연구` 등)은 `normalizeTags`를 통과하는 평범한 태그다.
5. **`WorkspaceShellInfo`의 필드 변경은 파일에 닿지 않는다.** 메모리 전용 타입이다
   (`workspace-types.ts:51`). `channelLetter` 삭제·`channelLabel` 개칭·새 필드 추가 모두 디스크에
   흔적이 없다.
6. **v1.30.1로 내려간 뒤의 동작**: `statShells`가 채널 폴더를 못 찾아 스냅샷이 0건이 된다. 그러면
   `syncFromWorkspace`가 "셸이 사라진" 상황으로 읽어 링크된 업무 프로젝트의 `members`를 비운다
   (`work-project-service.ts:424-431`). 업무 프로젝트·태그·폴더 목록은 남고, v1.31로 다시 올라가
   한 번 동기화하면 멤버가 복구된다. **되돌릴 수 없는 손실이 없다.**

새 파일을 만들지 않으므로 계약 §8의 "새 개념은 별도 파일" 조항을 발동할 일도 없다 — 새 개념이
없고, 같은 개념의 출처만 바뀐다.

## 테스트 계획

### `src/shared/workspace-path.test.ts`

인라인 벡터 파일이다(외부 벡터 파일을 읽지 않는다). `ws-path.vectors.json`의 `cases` 16개를
**그대로 옮긴 describe**를 추가하고, 기존 kind 기대값을 `legacy-*`로 고친다.

- `parseProjectKey`: `PRJ-0017-secondbrain` → `{seq: 17, slug: "secondbrain"}`;
  `PRJ-17-x`·`PRJ-0017-Second`(대문자)·`PRJ-0017-`·`prj-0017-x` → `null`.
- `classifyWorkspacePath`: `projects` → `projects-root`; `projects/PRJ-0005-neuropilot` → `project`
  (+ `channel: "projects"`, `shell`, `archived: false`); `projects/PRJ-0005-neuropilot/wiki/permanent`
  → `project-sub`; `projects/_archive/PRJ-0001-…` → `project-archive`; 그 하위 → `project-archive-sub`;
  `projects/not-a-key` → `other` + 경고; `projects/.git`·`projects/_local`·`projects/_archive/.obsidian` → `other`.
- 개칭 회귀: `O_SMCH` → `legacy-channel`, `O_SMCH/24_SMCH_VSP-1` → `legacy-shell`,
  그 하위 → `legacy-shell-sub`, `Z_Archive/15_KITU_Undergraduate-1` → `legacy-shell`.
- `deriveWorkspaceLocation`: `projects/PRJ-0017-secondbrain` → `{kind: "shell", channel: "projects", shell: "PRJ-0017-secondbrain"}`.
- `resolveShellRefForPath`: 프로젝트 폴더·그 하위·`_archive` 프로젝트·등록된 레포·레포 하위가
  모두 `projects/PRJ-…`(또는 `projects/_archive/PRJ-…`)를 답한다.

### `src/main/projects/workspace-index.test.ts`

기존 v1 describe 전체를 **손대지 않고 그대로 통과시킨다**(폴백 회귀 테스트가 그 자체로 값이다).
`projectYaml(fields)` 헬퍼와 새 describe `"v2 PRJ 레이아웃"`을 추가한다.

- `PROJECT.yaml`에서 title·status·mode·primaryContext·topics·repos·externalPaths·data를 읽고
  `ref`가 `projects/<key>`다.
- 역인덱스가 `<dev>\<name>`과 `<dev>\_archive\<name>` 두 키를 모두 준다.
- `externalPaths`(논리 경로, D15): `onedrive/수행프로젝트(기술연구소) - 문서/O_삼성서울병원` →
  `<onedrive>\수행프로젝트(기술연구소) - 문서\O_삼성서울병원`(한글·공백·괄호 그대로); `dev/x` →
  `<dev>\x`; `roots.onedrive`가 없으면 그 항목이 배열에서 **빠지고 경고는 없다**; 여러 값이 섞여
  있으면 풀리는 것만 남는다.
- 1:N 소유권(D16): 세 Project가 같은 `onedrive/…`를 등록하면 `repoOwners`가 **마지막 ref**를
  가리키고 `[path-owner]` 경고 한 줄이 선다. 두 Project가 같은 레포 이름을 등록하면 `[repo-owner]`
  경고가 **한 줄만**(경로 두 키에 대해 두 줄이 아니다) 선다.
- `_archive` 하위 Project는 `archived: true`, `channel: "projects/_archive"`,
  `ref: "projects/_archive/<key>"`.
- `title` 없음 → PRJ-key로 떨어진다. `primaryContext` 없음 → `groupLabel: ""`.
- 경고 2종: 키 규약 위반, `PROJECT.yaml` 없음. `.`·`_` 접두 폴더는 경고 없이 무시.
- `drivePath` 4케이스: `roots.drive` 있고 폴더 실재 → 절대경로 / 있고 폴더 없음 → `null` /
  `roots.drive` 없음 → `null` / `.ws-index.json` 자체가 없음 → `null`. **네 케이스 모두 경고 0건.**
- `wikiPath`: `wikiSource: dev/llmwiki/wiki` → `<dev>\llmwiki\wiki`; `drive/…`인데 drive 미설정 → `null`;
  접두 없는 값 → work 기준.
- 캐시: `PROJECT.yaml`의 mtime을 되돌리면 캐시가 유지되고, 올리면 다시 읽는다. `.ws-index.json`의
  mtime만 바뀌어도 다시 읽는다(drive 루트가 바뀔 수 있다). `invalidate`는 mtime과 무관하게 다시 읽는다.
- 레이아웃 판정: `projects/`가 없으면 v1 채널 스캔; 둘 다 있으면 v2가 이기고 `[legacy-layout]` 경고 1줄.
- 3형제 루트 describe에 v2 판을 하나 더한다(프로젝트 경로는 work, 레포는 dev, 데이터셋은 data).

### `src/main/projects/work-project-workspace-sync.test.ts`

`shell()` 헬퍼 옆에 `prj()` 헬퍼를 두고 새 케이스를 더한다. 기존 v1 케이스는 헬퍼가 새 필드
(`groupLabel`·`topics`·`mode`·`archived`)의 기본값을 채우는 것 외에 **기대값이 바뀌지 않는다**.

- `name`이 `title`이다(ref가 아니다). `shellLinks`에 `channel: "projects"`, `shell: "PRJ-…"`가 적힌다.
- 태그 시드가 `[primaryContext, ...topics]`다. `topics: []`면 `[primaryContext]`.
  `primaryContext`가 빈 문자열이면 `normalizeTags`가 걸러 `[]`가 심긴다.
- 두 번째 실행에서 `title`이 바뀌어도 `name`이 유지된다(D11). `created: 0`.
- **휴면**: `archived: true` Project만 있는 스냅샷 → `created: 0`, 업무 프로젝트 0건, 태그 파일 무변경.
- **휴면으로 바뀐 링크된 Project**: 1차에서 active로 만들고, 2차에서 같은 ref를 `archived: true`로
  주면 업무 프로젝트가 남고 멤버가 계속 갱신된다.
- 이름 충돌: 수제 업무 프로젝트가 title과 같은 이름을 쓰면 `skipped`에 `ref`가 담기고 수제 쪽이 안 바뀐다.
- v1 → v2 전환 회귀: v1 ref로 만든 링크가 있는 파일에 v2 스냅샷을 주면 v1 링크는 버려지지 않고
  (그 업무 프로젝트가 살아 있으므로 `surviving`에 남고) v2 Project는 새로 생긴다 — 한 번은 양쪽이
  같이 서고, 사용자가 수제 쪽을 지우는 것이 §5의 2단계다.

### `src/main/projects/workspace-brief.test.ts`

- v2 브리프의 머리 줄 전부: `# 워크스페이스: projects/PRJ-…`, 표시명·상태·진행 방식·컨텍스트·
  프로젝트 폴더·프로젝트 문서·루트 원칙.
- `drivePath`·`wikiPath`가 `null`이면 그 줄이 **없다**. 값이 있으면 그 절대경로가 나온다.
- 같은 `groupLabel`의 다른 Project만 형제로 선다. 다른 컨텍스트의 Project는 나오지 않는다.
- 데이터셋 미해결은 `(data/index.md에 없음)`로 남는다(기존 계약 유지).
- `<project>\wiki\data.md` 앞 30줄만 실린다.
- `buildWorkspaceBrief`가 프로젝트 폴더 자체·그 하위·레포·레포 하위 모두에 같은 브리프를 준다.
  세 루트 밖은 `null`.
- 휴면 Project의 브리프에 `- 상태: archived`가 있다.
- `groupLabel`이 빈 문자열이면 컨텍스트 줄과 형제 절이 모두 없다.

### `src/main/projects/work-project-brief.test.ts`

- `teamsSyncRoot`가 있고 docs 멤버가 있으면 `## 팀즈 문서 폴더`와 "문서 작업은 팀즈 폴더".
- `teamsSyncRoot`가 `null`이고 docs 멤버가 있으면 `## 문서 폴더`와 "문서 작업은 위 문서 폴더",
  그리고 브리프 어디에도 `팀즈`가 없다.
- `notionLinks: []`면 맺음 문장에 "노션"이 없다.
- docs·notion·repo가 전부 없으면 맺음이 첫 문장 하나뿐이다.
- 기존 케이스(태그 줄 위치, 절 순서, 빈 절 생략, 참고 로컬 폴더)는 문구 조정만.

### `src/renderer/src/sidebar-tree.test.ts`

- `defaultGroupingTags(tags, [])` → `[]`.
- v1 순서 보존: `orderedLabels`에 `["개인","용역","과제"]`를 주고 태그가 다 붙어 있으면
  `["과제","용역","개인"]`(`LEGACY_LABEL_ORDER` 우선).
- v2: `["개인","병원 공동연구","외부기관 협업"]`을 주면 그 순서 그대로.
- 섞임: legacy 라벨이 앞으로, 그 밖은 준 순서대로.
- 붙어 있지 않은 라벨은 빠진다.
- `orderWorkspaceLabels`: 중복 제거, 빈 문자열 제외, 첫 등장 순서 유지.

### `src/renderer/src/SettingsDialog.test.tsx`

- `프로젝트 N개` 문구가 스냅샷의 Project 수를 센다(휴면 포함).
- "다시 읽기" 성공 알림이 `프로젝트를 다시 읽었습니다`다.
- 경고 목록에 `[project-key]`·`[project-yaml]` 줄이 그대로 뜬다.

### `src/renderer/src/App.test.tsx`

`182행 부근`의 ws-root 픽스처를 v2로 갱신한다(`channel: "projects"`, `shell: "PRJ-…"`,
`groupLabel: <컨텍스트>`). 영향받는 기존 테스트 5개(1695·1766·1820·1917·1984행 부근)의 기대
문자열을 컨텍스트 라벨로 고친다. 트리 구조와 접근성 이름은 바뀌지 않는다.

### e2e (`e2e/desktop.spec.ts`)

**수정 없음.** 이 파일의 `workspace` 문자열은 전부 창 안 그리드(`.workspace-grid`·`.workspace-title`)
이고 ws-root를 등록하지 않는다.

### 전체 확인

`npm run test`(vitest) · `npm run typecheck`(main·renderer 양쪽) · `npm run build`.

## 릴리스 (v1.31.0)

1. `docs/release/v1.31.0.md` 작성 — PRJ-key 일원화, 브리프 v2, 조건부 팀즈·노션 문장,
   §5의 수동 4단계 절차.
2. `README.md:254`의 "최신 변경" 링크를 `docs/release/v1.31.0.md`로 바꾼다.
3. `package.json`·`package-lock.json`의 `version`을 `1.31.0`으로 올린다.
4. `v1.31.0` 태그를 푸시하면 `release.yml`이 draft 릴리스를 만든다. `ci.yml`은 PR·main push에서 돈다.

마이너 올림이 맞는 이유: 동기화 동작과 브리프 문구가 바뀌지만 파일 스키마는 그대로이고,
사용자가 해야 할 일이 §5의 절차뿐이다.

## 하지 않는 것

- `.ws-index.json`의 `projects[]`·`repos{}`·`datasets[]`를 데이터 원본으로 쓰는 일(D3).
  단, 어댑터는 `projects[].externalPaths`가 **언젠가 생기면** 읽도록 열어 두지 않는다 — 원본이
  `PROJECT.yaml` 하나라는 것이 D3의 요점이고, 출처를 둘로 두면 어느 쪽이 이기는지 규칙이 또 필요하다.
- `data/index.md` 대신 `.ws-index.json`의 `datasets[]`를 읽는 일. `readDatasetPaths`는 잘 돌고
  있고 발급대장은 그 파일이 SSOT다.
- `PROJECT.yaml`의 `legacy.channel`/`legacy.shell`로 v1 `shellLinks`를 자동 이어 붙이는 일.
  이 사용자에게는 `workspace.json`이 없어 이어 붙일 링크가 0개다. 중첩 YAML 파서도 필요해진다.
- `WorkspaceRoot`에 `drive`를 더하거나 drive를 네 번째 루트로 등록하는 일(§10).
- PRJ-key·mode·`primaryContext`를 위한 새 UI 칸·필터·정렬.
- 업무 프로젝트를 PRJ에 수동으로 "연결"하는 액션(D10, §10).
- 업무 프로젝트 `category`를 `primaryContext`로 자동 설정하는 일. 구분은 만들 때 한 번 정해지고
  그 뒤로는 사용자의 것이라는 기존 약속을 유지한다.

## 보류

- **`ws-index.mjs`가 `projects[]`에 `externalPaths`를 싣는 일.** MCW는 `PROJECT.yaml`을 직접
  읽으므로 지금 당장 필요하지 않다. 다만 `.ws-index.json`을 소비하는 다른 도구에는 구멍이다 —
  work 쪽 과제로 남긴다.
- **`C:\NeuroPilot\neuropilot_develop`의 소속.** `externalPaths`에 적을 수 없다 — work 쪽
  `validateManifest`가 절대경로를 거부하고(D15), 이 폴더는 어느 논리 루트의 하위도 아니다. 길은 둘뿐이고
  둘 다 MCW 밖의 결정이다: 그 폴더를 `C:\dev` 아래로 옮겨 `repos`에 이름으로 적기, 또는 수제 업무
  프로젝트에 두기. `C:\Users\uiop3`도 같은 처지다.
- **drive 루트 등록.** `DRIVE_ROOT`가 설정되고 `<drive>\projects\<key>` 폴더가 실재하는 PC에서는
  브리프에 drive 줄이 나온다. 그 폴더를 MCW의 **네 번째 루트**로 등록해 세션을 열 수 있게 하는 것은
  별개 설계다(`WorkspaceRoot`가 exact-keys라 `workspace.json` 스키마 진화가 필요하다 — 계약 §8의
  2단계 절차).
- **업무 프로젝트 ↔ Project 수동 연결 액션.** 수제 항목이 다시 늘어나면 그때 만든다.

## 닫힌 질문 (2026-09-21)

초안의 열린 질문 셋은 상위 프로그램 계획(drive 루트 편입, 2026-09-20 승인)에서 이미 정해진 것이라
여기서 닫는다.

| 질문 | 결정 | 근거 |
|---|---|---|
| Q1. 수제 4건을 어떻게 정리할까 | **삭제 후 재동기화**(「첫 동기화 시나리오」의 수동 4단계). 연결 액션은 만들지 않는다(D10) | 프로그램 계획 S4: "수제 업무 프로젝트 4건은 UI에서 수동 병합(4건뿐이라 마이그레이션 스크립트는 YAGNI)" |
| Q2. `C:\Users\uiop3`와 `G:\내 드라이브\S_결혼식\결혼식준비`를 어디에 둘까 | 코드 없음. 사용자가 UI에서 수제 업무 프로젝트 1건에 모으거나 미분류로 둔다. 후자 폴더는 G: 컷오버 뒤 `G:\내 드라이브\projects\PRJ-0018-wedding\결혼식준비`로 경로가 바뀐다 — work 쪽 `ws-migrate.mjs --registries`가 `projects.json`의 경로를 치환한다 | drive 루트 등록은 「보류」 |
| Q3. 이 PC에 `DRIVE_ROOT`를 설정할까 | **설정한다** — 다만 MCW의 일이 아니라 G: 컷오버의 GATE-g0에서 한다. v1.31.0은 `roots.drive`가 없는 상태로 나가도 된다 | 프로그램 계획 결정 11 · 컷오버 런북 §2 |

Q2에 **`C:\NeuroPilot\neuropilot_develop`이 셋째로 들어간다**(2026-09-21 추가). 초안은 이 폴더를
PRJ-0005의 `externalPaths`에 적으면 붙는다고 봤지만, work 쪽이 절대경로를 거부하므로(D15) 적을 수
없다. 같은 결정이 적용된다: 코드 없음, 사용자가 UI에서 수제 업무 프로젝트에 두거나 그 폴더를
`C:\dev` 아래로 옮긴다.
