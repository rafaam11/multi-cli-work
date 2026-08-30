/**
 * ws-root 워크스페이스 루트 설정. `~/.multi-cli-work/workspace.json`에 **따로** 산다 —
 * `projects.json`·`state.json`·`work-projects.json`은 손대지 않는다. 구버전 앱은 모르는 파일을
 * 그냥 무시하므로 다운그레이드가 안전하다(docs/superpowers/specs/registry-contract.md §8).
 */

/**
 * 사용자가 등록한 워크스페이스 루트 하나. `label`은 사이드바·설정에 쓰는 표시명.
 *
 * 루트는 셋이다 — 채널·셸이 사는 work, 레포가 사는 dev, 데이터셋이 사는 data(루트 CLAUDE.md §1).
 * 셋의 위치는 PC마다 다르고(`DEV_ROOT`/`DATA_ROOT` 환경변수, 형제 폴더, 예전의 중첩 배치) 옮겨지는
 * 중일 수도 있으므로, 추측하지 않고 **등록할 때 찾아 적어 둔다** — 그래야 렌더러의 순수 함수도
 * 파일시스템을 보지 않고 같은 답을 낸다. 다시 찾게 하려면 `workspace:sync`가 갱신한다.
 */
export interface WorkspaceRoot {
  /** work 루트의 절대경로(path.resolve 형태). 정규화형이 아니라 원형을 저장한다(계약 §7). */
  path: string;
  label: string;
  /** 개발 레포 루트. 관례는 work의 형제 `dev/`이고, 예전 배치에서는 `<work>/dev`다. */
  devPath: string;
  /** 데이터셋 루트. 관례는 work의 형제 `data/`. */
  dataPath: string;
}

/**
 * 자동 생성된 업무 프로젝트 ↔ 셸 연결. **`work-projects.json`의 스키마를 건드리지 않으려고**
 * 여기 둔다(계약 §8): 어느 항목이 워크스페이스에서 만들어졌는지 알아야 사용자가 손으로 만든
 * 항목을 덮어쓰지 않고 갱신할 수 있는데, 그 표식을 `memo` 같은 사용자 소유 필드에 심으면
 * 사용자가 메모를 고치는 순간 출처를 잃는다.
 */
export interface WorkspaceShellLink {
  /** `WorkProject.id`. 대응하는 업무 프로젝트가 사라지면 읽을 때 무시된다. */
  workProjectId: string;
  root: string;
  channel: string;
  shell: string;
}

export interface WorkspaceRegistryV1 {
  schemaVersion: 1;
  updatedAt: string;
  roots: WorkspaceRoot[];
  shellLinks: WorkspaceShellLink[];
}

/** 루트를 훑어 만든 셸 한 칸. 파일이 아니라 스캔 결과라 저장하지 않는다. */
export interface WorkspaceShellInfo {
  /** 이 셸이 속한 루트(등록된 원형). */
  root: string;
  /** `<채널>/<셸>` — `.ws-index.json`의 `ref`와 같은 표기. */
  ref: string;
  channel: string;
  channelLetter: string;
  channelLabel: string;
  shell: string;
  /** 셸 CLAUDE.md의 `title:`(한글). 없으면 폴더명. */
  title: string;
  status: string | null;
  /** 셸 폴더의 절대경로. */
  path: string;
  repos: string[];
  externalPaths: string[];
  /** 셸 프론트매터의 `data:` — DS-#### id 목록. */
  data: string[];
}

/** 루트 목록 + 역인덱스. 렌더러는 이것만으로 트리를 그린다. */
export interface WorkspaceSnapshot {
  registry: WorkspaceRegistryV1;
  shells: WorkspaceShellInfo[];
  /**
   * 정규화된 절대경로 → 셸 `ref`. `<root>/dev/<repo>`(셸 `repos:`)와 `external_paths:`의
   * 절대경로가 함께 들어가므로, 루트 밖에 있는 레포도 자기 셸을 안다.
   */
  repoOwners: Record<string, string>;
  warnings: string[];
}
