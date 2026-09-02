# 사이드바 3단 트리와 세션 패널 — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 좌측 사이드바 트리를 `채널 › 프로젝트 › 폴더` 3단(폴더가 잎)으로 줄이고, 세션·문서 행은 사이드바 하단의 평면 "세션 패널"(승인 대기부터 위로, 전체/여기 범위)로 옮기며, worktree 관리는 폴더 상세 페이지의 워크트리 카드로 옮긴다.

**Architecture:** 순수 렌더러 변경. `session-panel.ts`(순수 함수)가 세션·문서를 소속·브랜치·등급이 붙은 정렬된 항목으로 만들고 App이 그것을 `SessionPanel.tsx`(표시 전용)에 넘긴다. `ProjectSidebar.tsx`는 세션·문서·worktree·도구 그룹을 잃고 폴더를 잎으로 그리며, 트리 묶음 계산은 `sidebar-tree.ts`로 나간다. `ProjectDetailPage.tsx`는 `FolderStartPage`의 워크트리 카드 문구를 물려받은 카드로 worktree 열기·컨텍스트 메뉴·만들기를 맡는다. 레지스트리·IPC·메인 프로세스는 손대지 않는다.

**Tech Stack:** Electron + electron-vite, React 18 + TypeScript, vitest(콜로케이션, @testing-library/react), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-09-02-sidebar-tree-and-session-panel-design.md`

## Global Constraints

- **세션·문서 행의 접근성 이름은 글자 그대로 보존한다.** 세션 버튼 `aria-label`은 `` `${label} 세션 열기${unread ? " (읽지 않음)" : ""}` ``, 문서 열기 `` `${pane.label} 문서 열기${pane.dirty ? " (저장 안 됨)" : ""}` ``, 문서 닫기 `` `${pane.label} 닫기` ``. 소속(폴더명)·브랜치는 눈에 보이는 별도 `<span>`과 `title`에만 넣는다. 클래스 `session-row`, `status-${status}`, `current`, `on-screen`, `.status-dot`, `.session-name`, `.session-status`, `.unread-dot unread-${attention}`, `.file-tab-row`, `.file-tab-open`, `.file-tab-close`, `.file-tab-dot`도 그대로다. `App.test.tsx`의 `getByRole("button", { name: "PowerShell 세션 열기" })` 정확 일치 테스트(폴더 colour describe 안)가 리트머스다.
- 세션 패널의 `<section>` 접근성 이름은 **`세션 패널`** 이다 — 폴더 상세 페이지에 이미 `aria-label="세션"` 카드가 있어 `세션`은 충돌한다. 목록 `<ul>`은 `role="group" aria-label="세션 목록"`.
- 세션 등급: `awaiting-approval` 0, `awaiting-input` 1, `working`/`starting` 2, `idle`/`exited`/`error` 3, 문서 5. `unread`가 `approval`이면 0, `input`이면 1로 **승격**(둘 중 작은 값). 같은 등급은 `updatedAt` 내림차순, 동률은 `id` 오름차순. 문서는 세션 뒤에 받은 순서 그대로.
- 소속 라벨: 폴더 세션은 `projectName(project)`, `projectId === null`(도구 세션)은 `"도구"`, worktree 세션은 `branch`를 따로 단다. 세션 라벨은 `sessionLabel(session, sessions.filter(s => s.projectId === session.projectId), agents)` — App의 세션 메뉴와 트리가 쓰던 peers 정의 그대로.
- localStorage: `multi-cli-work.sidebar.v1`에 `sessionPanelOpen?: boolean`(기본 `true`), `sessionScope?: "all" | "here"`(기본 `"all"`) 키를 **추가**한다. 버전은 올리지 않는다. `multi-cli-work.projects.v1`(COLLAPSED_PROJECTS_KEY)은 읽지도 쓰지도 **지우지도** 않는다.
- 사용자에게 보이는 문자열은 전부 한국어. 새 문구: 패널 제목 `세션`, 배지 `대기 N`, 범위 버튼 `전체`/`여기`, 접기 버튼 `세션 패널 접기`/`세션 패널 펼치기`, 빈 목록 `${범위 이름}에 열린 세션이 없습니다`, 워크트리 카드 제목 `워크트리`, 행 `${branch} 워크트리 열기` / `${branch} (보는 중)`, 헤더 버튼 `워크트리 만들기`, 빈 카드 `아직 워크트리가 없습니다`.
- 레지스트리·IPC·`src/main`·`src/preload`·`src/shared`는 수정하지 않는다.
- 커밋: 이 워크트리의 브랜치 `feat/sidebar-channel-tree`에 태스크마다 커밋한다. 메시지는 `feat(sidebar): …` / `test(sidebar): …` / `refactor(sidebar): …` 형식의 한국어 요약 한 줄 + 본문, 마지막 줄 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `git add`는 명시한 파일만. `--amend` 금지. push·merge 금지. `package-lock.json`이 바뀌어 있으면 커밋 전 `git checkout -- package-lock.json`.
- 이 머신의 Git Bash는 간헐적으로 `fork: Resource temporarily unavailable`을 낸다 — git·npm 명령은 PowerShell로 돌린다. 워크트리에서 `npm run dev`는 안 된다(node-pty 재빌드 실패); 검증은 `npx vitest run <파일>`, `npm test`, `npm run typecheck`로 한다. `lint` 스크립트는 없다.
- shared 코드는 renderer에서 `@shared/...`로 import한다. 테스트는 소스 옆 콜로케이션.

---

### Task 1: `session-panel.ts` — 세션 패널의 순수 함수

**Files:**
- Create: `src/renderer/src/session-panel.ts`
- Test: `src/renderer/src/session-panel.test.ts`

**Interfaces:**
- Consumes: `sessionLabel`, `projectName`(`./session-labels`), `DocumentPane`, `DocumentKind`(`./pane-items`), `TerminalSessionView`, `SessionAttention`(`@shared/api-types`), `AgentView`(`@shared/agent-types`), `AgentId`(`@shared/agent-types`), `SharedProject`(`@shared/project-types`), `SharedWorktree`(`@shared/worktree-types`), `TerminalStatus`(`@shared/terminal-types`).
- Produces (이후 모든 태스크가 이 이름을 그대로 쓴다):

```ts
export type SessionScope = "all" | "here";
export type SessionScopeTarget =
  | { kind: "none" }
  | { kind: "worktree"; worktreeId: string; label: string }
  | { kind: "folders"; projectIds: readonly string[]; label: string };

interface SessionPanelItemBase {
  /** 패인 id — 세션 id 또는 문서 id. 드래그 페이로드가 그대로 이 값이다. */
  id: string;
  label: string;
  /** 폴더명, 도구 세션이면 "도구", 소속을 모르면 null. */
  place: string | null;
  /** worktree 세션(문서)이면 브랜치, 아니면 null. */
  branch: string | null;
  projectId: string | null;
  worktreeId: string | null;
  rank: number;
}
export type SessionPanelItem =
  | (SessionPanelItemBase & {
      kind: "session";
      session: TerminalSessionView;
      status: TerminalStatus;
      agent: AgentId;
      tool: boolean;
      attention: SessionAttention | null;
    })
  | (SessionPanelItemBase & { kind: "document"; pane: DocumentPane; document: DocumentKind; dirty: boolean });

export function sessionRank(status: TerminalStatus, attention: SessionAttention | null): number;
export function buildSessionPanelItems(input: {
  sessions: readonly TerminalSessionView[];
  documentPanes: readonly DocumentPane[];
  projects: readonly SharedProject[];
  worktrees: readonly SharedWorktree[];
  agents: readonly AgentView[];
  unread: Record<string, SessionAttention>;
}): SessionPanelItem[];
export function matchesScope(item: SessionPanelItem, target: SessionScopeTarget): boolean;
/** 등급 0·1(승인·입력 대기) 세션의 수 — 패널 헤더의 `대기 N`. */
export function sessionPanelWaitCount(items: readonly SessionPanelItem[]): number;
```

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/src/session-panel.test.ts`

```ts
import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree } from "@shared/worktree-types";
import { describe, expect, it } from "vitest";
import type { DocumentPane } from "./pane-items";
import { buildSessionPanelItems, matchesScope, sessionPanelWaitCount, sessionRank } from "./session-panel";

function agent(id: string, label: string): AgentView {
  return {
    id, label, commands: [id], args: [], newSessionArgs: [], resumeArgs: [], conversationId: "none",
    statusAdapter: "signals", titleSource: "none", shiftEnter: "enter", icon: id, accentColor: null,
    builtin: true, available: true,
  };
}
const agents = [agent("powershell", "PowerShell"), agent("claude", "Claude Code")];

const atlas: SharedProject = {
  id: "project-atlas", rootPath: "C:\\work\\atlas", displayName: "Atlas", sources: ["manual"],
  providerRefs: { claude: [], codex: [] }, status: null, memo: "", tracks: [], hidden: false, order: 0,
  createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z",
};
const dashboard: SharedProject = { ...atlas, id: "project-dashboard", rootPath: "C:\\work\\dashboard", displayName: "Dashboard", order: 1 };
const worktree: SharedWorktree = {
  id: "worktree-1", projectId: atlas.id, path: "C:\\work\\atlas-wt\\feature-x", branch: "feature-x",
  createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z",
};

function session(overrides: Partial<TerminalSessionView>): TerminalSessionView {
  return {
    id: "s", projectId: atlas.id, tool: null, title: null, name: null, kind: "powershell", cwd: atlas.rootPath,
    providerConversationId: null, interruptedByShutdown: false, status: "idle", pid: 1, exitCode: null,
    createdAt: "2026-07-11T01:00:00.000Z", updatedAt: "2026-07-11T01:00:00.000Z", ...overrides,
  };
}
function document(overrides: Partial<DocumentPane>): DocumentPane {
  return { id: "file:C:\\work\\atlas\\README.md", kind: "file", label: "README.md", detail: "Atlas", dirty: false,
    owner: { kind: "project", id: atlas.id }, ...overrides };
}
const build = (input: Partial<Parameters<typeof buildSessionPanelItems>[0]>) =>
  buildSessionPanelItems({ sessions: [], documentPanes: [], projects: [atlas, dashboard], worktrees: [worktree], agents, unread: {}, ...input });

describe("sessionRank", () => {
  it("승인 대기 → 입력 대기 → 작업 중/시작 중 → 나머지 순서다", () => {
    expect(sessionRank("awaiting-approval", null)).toBe(0);
    expect(sessionRank("awaiting-input", null)).toBe(1);
    expect(sessionRank("working", null)).toBe(2);
    expect(sessionRank("starting", null)).toBe(2);
    expect(sessionRank("idle", null)).toBe(3);
    expect(sessionRank("exited", null)).toBe(3);
    expect(sessionRank("error", null)).toBe(3);
  });

  it("화면 밖에서 시작된 대기(unread)는 상태가 지나갔어도 그 등급으로 올라온다", () => {
    expect(sessionRank("idle", "approval")).toBe(0);
    expect(sessionRank("working", "input")).toBe(1);
    // 상태가 더 급하면 상태가 이긴다.
    expect(sessionRank("awaiting-approval", "input")).toBe(0);
  });
});

describe("buildSessionPanelItems", () => {
  it("승인 대기가 맨 위, 같은 등급은 updatedAt 내림차순, 동률은 id 오름차순이다", () => {
    const items = build({
      sessions: [
        session({ id: "b-idle", status: "idle", updatedAt: "2026-07-11T03:00:00.000Z" }),
        session({ id: "a-idle", status: "idle", updatedAt: "2026-07-11T03:00:00.000Z" }),
        session({ id: "working-old", status: "working", updatedAt: "2026-07-11T01:00:00.000Z" }),
        session({ id: "working-new", status: "working", updatedAt: "2026-07-11T02:00:00.000Z" }),
        session({ id: "input", status: "awaiting-input" }),
        session({ id: "approval", status: "awaiting-approval" }),
      ],
    });
    expect(items.map((item) => item.id)).toEqual(["approval", "input", "working-new", "working-old", "a-idle", "b-idle"]);
  });

  it("unread 승인 대기는 상태가 idle이어도 맨 위로 온다", () => {
    const items = build({
      sessions: [session({ id: "input", status: "awaiting-input" }), session({ id: "stale", status: "idle" })],
      unread: { stale: "approval" },
    });
    expect(items.map((item) => item.id)).toEqual(["stale", "input"]);
    expect(items[0]).toMatchObject({ kind: "session", attention: "approval", rank: 0 });
  });

  it("문서 패인은 어떤 세션보다 뒤에, 받은 순서 그대로 선다", () => {
    const items = build({
      sessions: [session({ id: "exited", status: "exited" })],
      documentPanes: [document({ id: "file:b", label: "b.md" }), document({ id: "file:a", label: "a.md" })],
    });
    expect(items.map((item) => item.id)).toEqual(["exited", "file:b", "file:a"]);
    expect(items[1]).toMatchObject({ kind: "document", rank: 5, document: "file", dirty: false });
  });

  it("폴더 세션은 폴더명을, worktree 세션은 브랜치를, 도구 세션은 '도구'를 소속으로 단다", () => {
    const items = build({
      sessions: [
        session({ id: "folder" }),
        session({ id: "wt", worktreeId: worktree.id, cwd: worktree.path }),
        session({ id: "tool", projectId: null, tool: "claude-update", kind: "claude" }),
      ],
    });
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    expect(byId.folder).toMatchObject({ place: "Atlas", branch: null, projectId: atlas.id, worktreeId: null });
    expect(byId.wt).toMatchObject({ place: "Atlas", branch: "feature-x", projectId: atlas.id, worktreeId: worktree.id });
    expect(byId.tool).toMatchObject({ place: "도구", branch: null, projectId: null, worktreeId: null, tool: true });
  });

  it("같은 폴더의 이름 없는 같은 에이전트 세션은 번호가 붙고, 다른 폴더는 따로 센다", () => {
    const items = build({
      sessions: [
        session({ id: "p1", createdAt: "2026-07-11T01:00:00.000Z" }),
        session({ id: "p2", createdAt: "2026-07-11T02:00:00.000Z" }),
        session({ id: "d1", projectId: dashboard.id, cwd: dashboard.rootPath }),
      ],
    });
    const labels = Object.fromEntries(items.map((item) => [item.id, item.label]));
    expect(labels).toEqual({ p1: "PowerShell 1", p2: "PowerShell 2", d1: "PowerShell" });
  });

  it("worktree에서 연 문서는 그 worktree의 브랜치와 소유 폴더를 물려받는다", () => {
    const [item] = build({ documentPanes: [document({ owner: { kind: "worktree", id: worktree.id } })] });
    expect(item).toMatchObject({ kind: "document", place: "Atlas", branch: "feature-x", projectId: atlas.id, worktreeId: worktree.id });
  });

  it("소유자가 없는 문서와 사라진 폴더의 세션은 소속 없이 선다", () => {
    const items = build({
      sessions: [session({ id: "orphan", projectId: "project-gone" })],
      documentPanes: [document({ owner: null })],
    });
    expect(items[0]).toMatchObject({ id: "orphan", place: null, projectId: "project-gone" });
    expect(items[1]).toMatchObject({ kind: "document", place: null, projectId: null });
  });
});

describe("matchesScope", () => {
  const folder = build({ sessions: [session({ id: "folder" })] })[0];
  const wt = build({ sessions: [session({ id: "wt", worktreeId: worktree.id })] })[0];
  const tool = build({ sessions: [session({ id: "tool", projectId: null, tool: "claude-update" })] })[0];

  it("none은 전부 통과시킨다", () => {
    for (const item of [folder, wt, tool]) expect(matchesScope(item, { kind: "none" })).toBe(true);
  });

  it("worktree 대상은 그 worktree의 항목만 남긴다", () => {
    const target = { kind: "worktree" as const, worktreeId: worktree.id, label: "feature-x" };
    expect(matchesScope(wt, target)).toBe(true);
    expect(matchesScope(folder, target)).toBe(false);
  });

  it("폴더 대상은 그 폴더의 worktree 세션까지 포함하고, 도구 세션은 어디에도 들지 않는다", () => {
    const target = { kind: "folders" as const, projectIds: [atlas.id], label: "Atlas" };
    expect(matchesScope(folder, target)).toBe(true);
    expect(matchesScope(wt, target)).toBe(true);
    expect(matchesScope(tool, target)).toBe(false);
    expect(matchesScope(folder, { kind: "folders", projectIds: [dashboard.id], label: "Dashboard" })).toBe(false);
  });
});

describe("sessionPanelWaitCount", () => {
  it("승인·입력 대기 세션만 센다 — 문서와 작업 중은 빼고", () => {
    const items = build({
      sessions: [
        session({ id: "a", status: "awaiting-approval" }),
        session({ id: "b", status: "awaiting-input" }),
        session({ id: "c", status: "working" }),
        session({ id: "d", status: "idle" }),
      ],
      documentPanes: [document({})],
      unread: { d: "input" },
    });
    expect(sessionPanelWaitCount(items)).toBe(3);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/renderer/src/session-panel.test.ts`
Expected: FAIL — `Cannot find module './session-panel'`.

- [ ] **Step 3: 구현** — `src/renderer/src/session-panel.ts`

```ts
import type { AgentId, AgentView } from "@shared/agent-types";
import type { SessionAttention, TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalStatus } from "@shared/terminal-types";
import type { SharedWorktree } from "@shared/worktree-types";
import type { DocumentKind, DocumentPane } from "./pane-items";
import { projectName, sessionLabel } from "./session-labels";

/**
 * 세션 패널의 한 줄. 트리에서 세션 행이 나온 뒤(설계 문서 참고) 사이드바가 "무엇이 나를 기다리나"를
 * 답하는 곳이다. App이 여기서 만든 정렬된 목록을 넘기고 패널은 그리기만 한다 — `shelfPaneRows`와
 * 같은 이유로, 어느 id가 무엇인지는 App만 안다.
 */
export type SessionScope = "all" | "here";

/** "여기"가 가리키는 곳. 홈·셸프·채널에는 페이지가 없으므로 none이고 토글은 비활성이다. */
export type SessionScopeTarget =
  | { kind: "none" }
  | { kind: "worktree"; worktreeId: string; label: string }
  | { kind: "folders"; projectIds: readonly string[]; label: string };

interface SessionPanelItemBase {
  id: string;
  label: string;
  place: string | null;
  branch: string | null;
  projectId: string | null;
  worktreeId: string | null;
  rank: number;
}

export type SessionPanelItem =
  | (SessionPanelItemBase & {
      kind: "session";
      session: TerminalSessionView;
      status: TerminalStatus;
      agent: AgentId;
      tool: boolean;
      attention: SessionAttention | null;
    })
  | (SessionPanelItemBase & { kind: "document"; pane: DocumentPane; document: DocumentKind; dirty: boolean });

const STATUS_RANK: Record<TerminalStatus, number> = {
  "awaiting-approval": 0,
  "awaiting-input": 1,
  working: 2,
  starting: 2,
  idle: 3,
  exited: 3,
  error: 3,
};
const ATTENTION_RANK: Record<SessionAttention, number> = { approval: 0, input: 1 };
/** 문서는 언제나 세션 뒤다 — 기다리는 것이 없으니까. */
const DOCUMENT_RANK = 5;
export const WAITING_RANK_MAX = 1;

/** 화면 밖에서 시작된 대기는 상태가 이미 지나갔을 수 있으므로 둘 중 급한 쪽을 쓴다. */
export function sessionRank(status: TerminalStatus, attention: SessionAttention | null): number {
  const fromStatus = STATUS_RANK[status];
  return attention ? Math.min(fromStatus, ATTENTION_RANK[attention]) : fromStatus;
}

export function buildSessionPanelItems(input: {
  sessions: readonly TerminalSessionView[];
  documentPanes: readonly DocumentPane[];
  projects: readonly SharedProject[];
  worktrees: readonly SharedWorktree[];
  agents: readonly AgentView[];
  unread: Record<string, SessionAttention>;
}): SessionPanelItem[] {
  const nameById = new Map(input.projects.map((project) => [project.id, projectName(project)]));
  const worktreeById = new Map(input.worktrees.map((worktree) => [worktree.id, worktree]));
  const placeOf = (projectId: string | null) => (projectId === null ? "도구" : (nameById.get(projectId) ?? null));

  const sessions = input.sessions
    .map<SessionPanelItem>((session) => {
      const peers = input.sessions.filter((candidate) => candidate.projectId === session.projectId);
      const attention = input.unread[session.id] ?? null;
      const worktree = session.worktreeId ? worktreeById.get(session.worktreeId) : undefined;
      return {
        kind: "session",
        id: session.id,
        session,
        label: sessionLabel(session, peers, input.agents),
        place: placeOf(session.projectId),
        branch: worktree?.branch ?? null,
        projectId: session.projectId,
        worktreeId: session.worktreeId ?? null,
        status: session.status,
        agent: session.kind,
        tool: session.tool !== null,
        attention,
        rank: sessionRank(session.status, attention),
      };
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        (right as { session: TerminalSessionView }).session.updatedAt.localeCompare(
          (left as { session: TerminalSessionView }).session.updatedAt,
        ) ||
        left.id.localeCompare(right.id),
    );

  const documents = input.documentPanes.map<SessionPanelItem>((pane) => {
    const owner = pane.owner;
    const worktree = owner?.kind === "worktree" ? worktreeById.get(owner.id) : undefined;
    const projectId = owner?.kind === "project" ? owner.id : (worktree?.projectId ?? null);
    return {
      kind: "document",
      id: pane.id,
      pane,
      label: pane.label,
      place: projectId === null ? null : (nameById.get(projectId) ?? null),
      branch: worktree?.branch ?? null,
      projectId,
      worktreeId: worktree?.id ?? null,
      document: pane.kind,
      dirty: pane.dirty,
      rank: DOCUMENT_RANK,
    };
  });

  return [...sessions, ...documents];
}

export function matchesScope(item: SessionPanelItem, target: SessionScopeTarget): boolean {
  switch (target.kind) {
    case "none":
      return true;
    case "worktree":
      return item.worktreeId === target.worktreeId;
    case "folders":
      // 폴더 배지가 worktree 세션을 세는 것과 같은 정의: 폴더는 자기 worktree까지 품는다.
      return item.projectId !== null && target.projectIds.includes(item.projectId);
  }
}

export function sessionPanelWaitCount(items: readonly SessionPanelItem[]): number {
  return items.filter((item) => item.kind === "session" && item.rank <= WAITING_RANK_MAX).length;
}
```

주의: 정렬 비교에서 `as { session }` 캐스트가 거슬리면 세션 항목만 담는 로컬 배열 타입으로 먼저 정렬한 뒤 합쳐도 된다 — 동작 계약(테스트)만 같으면 된다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/renderer/src/session-panel.test.ts`
Expected: PASS (12 tests). 그리고 `npm run typecheck` 통과.

- [ ] **Step 5: 커밋**

```
git add src/renderer/src/session-panel.ts src/renderer/src/session-panel.test.ts
git commit -m "feat(sidebar): 세션 패널의 정렬·범위·소속 계산을 순수 함수로 추가"
```

---

### Task 2: 세션 패널 도입 — 트리에서 세션·문서·도구 그룹을 빼고 하단 패널로

이 태스크는 쪼갤 수 없다: 패널만 먼저 붙이면 같은 세션이 트리와 패널에 두 번 서서 `getByRole(/세션 열기/)`가 "multiple elements"로 터진다. worktree 행과 폴더 체버론은 **이 태스크에서 건드리지 않는다**(Task 4·5).

**Files:**
- Create: `src/renderer/src/SessionPanel.tsx`
- Modify: `src/renderer/src/ProjectSidebar.tsx` (imports, props 52-139, `byCreation` 141-147, `readSidebarState`/`persist` 157-314, `toolSessions` 457-461, `documentsOf` 463-465, `renderSession` 495-532, `renderDocument` 539-565, 폴더 아래 `session-tree` 923-930, worktree 아래 `session-tree` 945-951과 986-992, 도구 그룹 1204-1215, 렌더 트리 끝 1216 앞에 패널 장착)
- Modify: `src/renderer/src/App.tsx` (import, `sessionPanelItems`/`sessionScopeTarget` useMemo 추가 — `shelfPaneRows`(2528) 근처, `<ProjectSidebar>` props 2820-2901)
- Modify: `src/renderer/src/index.css` (`.project-sidebar` grid 476-485, 밴드 `grid-row` 505-513, `.tools-group` 2439-2445 삭제, 신규 `.session-panel*`)
- Test: `src/renderer/src/App.test.tsx` (2040 수정 + 신규 5건)

**Interfaces:**
- Consumes: Task 1의 `SessionPanelItem`, `SessionScope`, `SessionScopeTarget`, `buildSessionPanelItems`, `matchesScope`, `sessionPanelWaitCount`.
- Produces: `SessionPanel` 컴포넌트와 `SessionPanelProps`; `ProjectSidebar` props에 `sessionPanelItems: readonly SessionPanelItem[]`, `sessionScopeTarget: SessionScopeTarget` 추가, `documentPanes` 제거. App의 `sessionPanelItems`, `sessionScopeTarget` useMemo.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/src/App.test.tsx`

(a) 기존 테스트 `hangs an opened document under its folder in the tree, and closes it from there`(2040 근처)를 찾아 이름을 `lists an opened document in the session panel with its folder, and closes it from there`로 바꾸고, `row.closest(".session-tree")` 단언을 `row.closest(".session-panel")`이 null이 아닌 것으로 바꾼다. 행에 소속 텍스트가 있는지 단언을 추가한다: `expect(within(row).getByText("Atlas")).toBeInTheDocument()` (row는 `.file-tab-row`). 나머지 단언(`README.md 문서 열기`, `README.md 닫기`)은 그대로.

(b) 새 describe를 `describe("worktrees", …)` 앞에 추가한다:

```tsx
describe("세션 패널", () => {
  const approvalSession: TerminalSessionView = {
    ...powershellSession,
    id: "session-approval",
    name: "승인 필요",
    status: "awaiting-approval",
    updatedAt: "2026-07-11T00:30:00.000Z",
  };
  const workingSession: TerminalSessionView = {
    ...powershellSession,
    id: "session-working",
    name: "돌아가는 중",
    status: "working",
    updatedAt: "2026-07-11T03:00:00.000Z",
  };
  const panel = () => screen.getByRole("region", { name: "세션 패널" });
  const rows = () =>
    within(panel())
      .getAllByRole("button", { name: /세션 열기/ })
      .map((button) => button.getAttribute("aria-label"));

  it("승인 대기 세션을 맨 위로 올리고, 폴더 소속을 행에 단다", async () => {
    const harness = createApi({ sessions: [workingSession, powershellSession, approvalSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "세션 패널" });
    expect(rows()).toEqual(["승인 필요 세션 열기", "돌아가는 중 세션 열기", "PowerShell 세션 열기"]);
    const row = within(panel()).getByRole("button", { name: "승인 필요 세션 열기" });
    expect(within(row).getByText("Atlas")).toBeInTheDocument();
    expect(within(panel()).getByText("대기 1")).toBeInTheDocument();
    // 트리에는 세션 행이 더 이상 없다.
    const nav = screen.getByRole("navigation", { name: "프로젝트" });
    expect(within(nav).queryByRole("button", { name: /세션 열기/ })).not.toBeInTheDocument();
  });

  it("도구 세션이 '도구' 소속으로 같은 패널에 서고, 별도 도구 그룹은 없다", async () => {
    const harness = createApi({ sessions: [powershellSession, toolSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "세션 패널" });
    const row = within(panel()).getByRole("button", { name: /Claude Code 업데이트 세션 열기|업데이트.*세션 열기/ });
    expect(within(row).getByText("도구")).toBeInTheDocument();
    expect(document.querySelector(".tools-group")).toBeNull();
  });

  it("'여기'는 현재 폴더의 세션만 남기고, 홈에서는 비활성이다", async () => {
    const dashboardSession: TerminalSessionView = {
      ...powershellSession,
      id: "session-dashboard",
      name: "대시보드 작업",
      projectId: dashboard.id,
      cwd: dashboard.rootPath,
    };
    const harness = createApi({
      projects: [atlas, dashboard],
      sessions: [powershellSession, dashboardSession],
      selection: { selectedProjectId: atlas.id, selectedSessionId: powershellSession.id },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "세션 패널" });
    expect(rows()).toHaveLength(2);
    fireEvent.click(within(panel()).getByRole("button", { name: "여기" }));
    expect(rows()).toEqual(["PowerShell 세션 열기"]);

    fireEvent.click(screen.getByRole("button", { name: "홈 대시보드 열기" }));
    expect(within(panel()).getByRole("button", { name: "여기" })).toBeDisabled();
    // 범위를 걸 곳이 없으면 전체가 보인다.
    expect(rows()).toHaveLength(2);
  });

  it("패널을 접어도 대기 수는 헤더에 남고, 다시 열면 접힘이 localStorage에서 되살아난다", async () => {
    const harness = createApi({ sessions: [approvalSession] });
    window.multiCliWork = harness.api;
    const { unmount } = render(<App />);

    await screen.findByRole("region", { name: "세션 패널" });
    fireEvent.click(within(panel()).getByRole("button", { name: "세션 패널 접기" }));
    expect(within(panel()).queryByRole("group", { name: "세션 목록" })).not.toBeInTheDocument();
    expect(within(panel()).getByText("대기 1")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("multi-cli-work.sidebar.v1") ?? "{}")).toMatchObject({ sessionPanelOpen: false });

    unmount();
    render(<App />);
    await screen.findByRole("region", { name: "세션 패널" });
    expect(within(panel()).getByRole("button", { name: "세션 패널 펼치기" })).toBeInTheDocument();
  });

  it("범위 안에 세션이 없으면 그렇다고 말한다", async () => {
    const harness = createApi({
      projects: [atlas, dashboard],
      sessions: [powershellSession],
      selection: { selectedProjectId: dashboard.id, selectedSessionId: null },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "세션 패널" });
    fireEvent.click(within(panel()).getByRole("button", { name: "여기" }));
    expect(within(panel()).getByText("Dashboard에 열린 세션이 없습니다")).toBeInTheDocument();
  });
});
```

`toolSession`(120번대에 정의됨)의 라벨은 `sessionLabel`이 도구 세션에 붙이는 이름이다 — 정확한 문자열은 `session-labels.ts`의 `toolDetails["claude-update"].label`을 확인해 정규식 대신 정확한 이름으로 바꿔라. `dashboard` 픽스처는 이미 있다(107번대). `localStorage`는 각 테스트 전에 비워진다 — `beforeEach`에서 `localStorage.clear()`를 하는지 확인하고, 없으면 이 describe 안에 `beforeEach(() => localStorage.clear())`를 둔다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/renderer/src/App.test.tsx -t "세션 패널"`
Expected: FAIL — `Unable to find an accessible element with the role "region" and name "세션 패널"`.

- [ ] **Step 3: `SessionPanel.tsx` 작성**

```tsx
import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import { ChevronDown, ChevronRight, GitBranch, Wrench, X } from "lucide-react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { SessionNameInput } from "./SessionNameInput";
import { AgentIcon } from "./brand-icons";
import { DocumentPaneIcon, type DocumentPane } from "./pane-items";
import { findAgent, statusLabels } from "./session-labels";
import { matchesScope, sessionPanelWaitCount, type SessionPanelItem, type SessionScope, type SessionScopeTarget } from "./session-panel";

export interface SessionPanelProps {
  /** App이 정렬까지 끝낸 전체 목록. 범위 필터는 여기서 건다. */
  items: readonly SessionPanelItem[];
  scopeTarget: SessionScopeTarget;
  scope: SessionScope;
  onChangeScope(scope: SessionScope): void;
  open: boolean;
  onToggleOpen(): void;
  agents: readonly AgentView[];
  focusedPaneId: string | null;
  onScreenPaneIds: Set<string>;
  renamingSessionId: string | null;
  onSelectSession(session: TerminalSessionView): void;
  onSelectDocument(pane: DocumentPane): void;
  onCloseDocument(pane: DocumentPane): void;
  onSessionContextMenu(session: TerminalSessionView, event: ReactMouseEvent): void;
  onRenameSession(sessionId: string, name: string | null): void;
  onCancelRename(): void;
  /** 사이드바의 드래그 핸들러 — 셸프 하이라이트 해제까지 함께 하므로 그대로 받는다. */
  paneDragProps(paneId: string): {
    draggable: boolean;
    onDragStart(event: ReactDragEvent<HTMLElement>): void;
    onDragEnd(): void;
  };
}

/**
 * 사이드바 하단의 세션 패널. 트리가 "어디에 뭐가 있나"를 답한다면 여기는 "지금 무엇이 나를
 * 기다리나"를 답한다 — 승인 대기부터 위로, 폴더를 가리지 않고. 행의 마크업과 접근성 이름은
 * 트리에 있을 때의 세션·문서 행과 같다(설계 문서 참고).
 */
export function SessionPanel({
  items, scopeTarget, scope, onChangeScope, open, onToggleOpen, agents, focusedPaneId, onScreenPaneIds,
  renamingSessionId, onSelectSession, onSelectDocument, onCloseDocument, onSessionContextMenu,
  onRenameSession, onCancelRename, paneDragProps,
}: SessionPanelProps) {
  // 범위를 걸 곳이 없으면 저장된 선호가 "여기"여도 전체를 보인다 — 홈에 다녀왔다고 토글이 리셋되면 안 된다.
  const effectiveScope: SessionScope = scopeTarget.kind === "none" ? "all" : scope;
  const visible = effectiveScope === "all" ? items : items.filter((item) => matchesScope(item, scopeTarget));
  const waiting = sessionPanelWaitCount(items);

  const rowClass = (paneId: string, ...extra: string[]) =>
    ["session-row", ...extra, focusedPaneId === paneId ? "current" : "", onScreenPaneIds.has(paneId) ? "on-screen" : ""]
      .filter(Boolean)
      .join(" ");

  const placeOf = (item: SessionPanelItem) => (
    <>
      {item.place ? <span className="session-row-place">{item.place}</span> : null}
      {item.branch ? (
        <span className="session-row-branch">
          <GitBranch size={11} aria-hidden="true" />
          {item.branch}
        </span>
      ) : null}
    </>
  );
  const titleOf = (item: SessionPanelItem) =>
    [item.place, item.branch ? `⎇ ${item.branch}` : null, item.label].filter(Boolean).join(" · ");

  const renderSession = (item: Extract<SessionPanelItem, { kind: "session" }>) => {
    if (renamingSessionId === item.id) {
      return (
        <li key={item.id}>
          <SessionNameInput
            initialName={item.session.name ?? item.label}
            onSubmit={(name) => onRenameSession(item.id, name)}
            onCancel={onCancelRename}
          />
        </li>
      );
    }
    return (
      <li key={item.id}>
        <button
          className={rowClass(item.id, `status-${item.status}`)}
          type="button"
          onClick={() => onSelectSession(item.session)}
          onContextMenu={(event) => onSessionContextMenu(item.session, event)}
          aria-label={`${item.label} 세션 열기${item.attention ? " (읽지 않음)" : ""}`}
          title={titleOf(item)}
          {...paneDragProps(item.id)}
        >
          <span className={`status-dot status-${item.status}`} aria-hidden="true" />
          {item.tool ? <Wrench size={14} /> : <AgentIcon agent={findAgent(agents, item.agent)} size={14} />}
          {placeOf(item)}
          <span className="session-name">{item.label}</span>
          {item.attention ? (
            <span className={`unread-dot unread-${item.attention}`} title="응답 대기" aria-hidden="true" />
          ) : null}
          <span className="session-status">{statusLabels[item.status]}</span>
        </button>
      </li>
    );
  };

  const renderDocument = (item: Extract<SessionPanelItem, { kind: "document" }>) => (
    <li key={item.id}>
      <div className={rowClass(item.id, "file-tab-row")} {...paneDragProps(item.id)}>
        <button
          type="button"
          className="file-tab-open"
          onClick={() => onSelectDocument(item.pane)}
          aria-label={`${item.label} 문서 열기${item.dirty ? " (저장 안 됨)" : ""}`}
          title={titleOf(item)}
        >
          <span className={`file-tab-dot ${item.dirty ? "dirty" : ""}`} aria-hidden="true" />
          <DocumentPaneIcon kind={item.document} size={13} />
          {placeOf(item)}
          <span className="session-name">{item.label}</span>
        </button>
        <button type="button" className="file-tab-close" onClick={() => onCloseDocument(item.pane)} aria-label={`${item.label} 닫기`} title="닫기">
          <X size={12} />
        </button>
      </div>
    </li>
  );

  return (
    <section className="session-panel" aria-label="세션 패널">
      <div className="section-heading session-panel-heading">
        <button
          className="tree-toggle"
          type="button"
          onClick={onToggleOpen}
          aria-label={`세션 패널 ${open ? "접기" : "펼치기"}`}
          title={`세션 패널 ${open ? "접기" : "펼치기"}`}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span>세션</span>
        {waiting > 0 ? <span className="session-panel-wait">대기 {waiting}</span> : null}
        <div className="session-panel-scope" role="group" aria-label="세션 범위">
          <button type="button" aria-pressed={effectiveScope === "all"} onClick={() => onChangeScope("all")}>
            전체
          </button>
          <button
            type="button"
            aria-pressed={effectiveScope === "here"}
            disabled={scopeTarget.kind === "none"}
            title={scopeTarget.kind === "none" ? "지금 화면에는 범위로 삼을 폴더가 없습니다" : scopeTarget.label}
            onClick={() => onChangeScope("here")}
          >
            여기
          </button>
        </div>
      </div>
      {open ? (
        <ul className="session-tree session-panel-list" role="group" aria-label="세션 목록">
          {visible.length === 0 && scopeTarget.kind !== "none" ? (
            <li className="session-panel-empty">{scopeTarget.label}에 열린 세션이 없습니다</li>
          ) : null}
          {visible.map((item) => (item.kind === "session" ? renderSession(item) : renderDocument(item)))}
        </ul>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: `ProjectSidebar.tsx` 수정**

1. props(52-139): `documentPanes` 제거. 추가:
   ```ts
   /** 세션 패널이 그리는 줄. App이 정렬까지 끝내 넘긴다 — 어느 id가 무엇인지는 App만 안다. */
   sessionPanelItems: readonly SessionPanelItem[];
   /** "여기" 토글이 가리키는 곳. 페이지가 없는 선택이면 none이고 토글은 비활성이다. */
   sessionScopeTarget: SessionScopeTarget;
   ```
   72번 줄 주석(`sessions`)을 "폴더 활동색·세션 수·레일·푸터·작업중 계산에 쓴다. 행은 세션 패널이 그린다."로 고친다.
2. `byCreation`(141-147), `toolSessions`(457-461), `documentsOf`(463-465), `renderSession`(495-532), `renderDocument`(539-565) 삭제. 안 쓰게 된 import(`Wrench`, `X`가 셸프 행에서도 안 쓰이면, `SessionNameInput`, `DocumentPaneIcon`, `DocumentPane`, `findAgent`, `sessionLabel`, `statusLabels`) 정리 — typecheck/미사용 경고로 확인.
3. `readSidebarState`(163-178)의 반환에 `sessionPanelOpen: boolean`(결측이면 `true`), `sessionScope: SessionScope`(결측이거나 `"all"|"here"`가 아니면 `"all"`) 추가. `persist`(295-302)는 네 값을 모두 쓴다: `{ version: 1, expandedWorkspaces, openShelves, sessionPanelOpen, sessionScope }`. 상태 두 개 추가:
   ```ts
   const [sessionPanelOpen, setSessionPanelOpen] = useState(() => readSidebarState().sessionPanelOpen);
   const [sessionScope, setSessionScope] = useState<SessionScope>(() => readSidebarState().sessionScope);
   ```
   `toggleWorkspace`/`toggleShelf`도 `persist`에 새 두 값을 넘기도록 고친다.
4. 폴더 아래 `{expanded && !isGitProject ? (<ul className="session-tree" …>…)}`(923-930) 삭제. worktree 블록 안의 두 `session-tree worktree-sessions` `<ul>`(945-951, 986-992)도 삭제(worktree 행 자체와 `workspace-meta`의 `세션 N` 텍스트는 남긴다).
5. 도구 그룹(1204-1215) 삭제.
6. `</nav>`(1216) 바로 앞에, 트리 `<ul>`과 도구 그룹이 있던 자리 아래에 패널을 둔다 — `collapsed`일 때는 마운트하지 않는다(접힌 레일 분기 밖, `{collapsed ? … : (<nav …>…</nav>)}`의 `<nav>` 안 맨 끝):
   ```tsx
   <SessionPanel
     items={sessionPanelItems}
     scopeTarget={sessionScopeTarget}
     scope={sessionScope}
     onChangeScope={(next) => { setSessionScope(next); persist(expandedWorkspaces, openShelves, sessionPanelOpen, next); }}
     open={sessionPanelOpen}
     onToggleOpen={() => { const next = !sessionPanelOpen; setSessionPanelOpen(next); persist(expandedWorkspaces, openShelves, next, sessionScope); }}
     agents={agents}
     focusedPaneId={focusedPaneId}
     onScreenPaneIds={onScreenPaneIds}
     renamingSessionId={renamingSessionId}
     onSelectSession={onSelectSession}
     onSelectDocument={onSelectDocument}
     onCloseDocument={onCloseDocument}
     onSessionContextMenu={onSessionContextMenu}
     onRenameSession={onRenameSession}
     onCancelRename={onCancelRename}
     paneDragProps={paneDragProps}
   />
   ```
   `persist`의 시그니처를 `(workspaces, shelves, panelOpen, scope)`로 바꾸고 호출부 전부 갱신.

- [ ] **Step 5: `App.tsx` 수정**

1. import: `import { buildSessionPanelItems, type SessionScopeTarget } from "./session-panel";`
2. `shelfPaneRows` useMemo(2528) 앞뒤에 추가:
   ```ts
   /** 세션 패널의 "여기"가 가리키는 곳. 페이지가 있는 선택만 범위가 된다. */
   const sessionScopeTarget = useMemo<SessionScopeTarget>(() => {
     if (activeView === "home") return { kind: "none" };
     if (activeView === "work-project") {
       return selectedWorkProject
         ? { kind: "folders", projectIds: selectedWorkProjectMembers.map(({ project }) => project.id), label: selectedWorkProject.name }
         : { kind: "none" };
     }
     // 셸프는 어느 폴더의 것도 아니다.
     if (activeView === "terminal" && shelfKind !== null) return { kind: "none" };
     if (selectedWorktree) return { kind: "worktree", worktreeId: selectedWorktree.id, label: selectedWorktree.branch };
     if (selectedProject) return { kind: "folders", projectIds: [selectedProject.id], label: projectName(selectedProject) };
     return { kind: "none" };
   }, [activeView, shelfKind, selectedWorktree, selectedProject, selectedWorkProject, selectedWorkProjectMembers]);

   /** 세션 패널이 그리는 줄. shelfPaneRows와 같은 이유로 여기서 만든다. */
   const sessionPanelItems = useMemo(
     () => buildSessionPanelItems({ sessions, documentPanes, projects, worktrees, agents, unread }),
     [sessions, documentPanes, projects, worktrees, agents, unread],
   );
   ```
   `selectedWorkProject`(446), `selectedWorkProjectMembers`(447), `selectedWorktree`(454), `selectedProject`는 이미 있다.
3. `<ProjectSidebar>` props: `documentPanes={documentPanes}` 제거, `sessionPanelItems={sessionPanelItems}`, `sessionScopeTarget={sessionScopeTarget}` 추가.

- [ ] **Step 6: CSS** — `src/renderer/src/index.css`

- `.project-sidebar`(476-485): `grid-template-rows: auto auto minmax(0, 1fr) auto auto auto;`. `.project-navigation`은 3행 그대로. 패널은 `<nav>` 안에 있으므로 별도 grid-row가 필요 없다 — 대신 `.project-navigation`을 `display: flex; flex-direction: column; min-height: 0;`로 두고(이미 그렇다면 유지) 트리 `<ul.project-tree>`가 `flex: 1 1 auto; overflow: auto; min-height: 0;`, 패널이 `flex: 0 0 auto;`가 되게 한다. 트리와 패널이 각각 스크롤한다.
- 신규:
  ```css
  .session-panel { border-top: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  .session-panel-heading { gap: 6px; }
  .session-panel-heading > span:first-of-type { flex: 0 0 auto; }
  .session-panel-wait { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: var(--unread-approval, #f59e0b); color: #111; }
  .session-panel-scope { margin-left: auto; display: inline-flex; gap: 2px; }
  .session-panel-scope button { font: inherit; font-size: 11px; padding: 1px 7px; border: 1px solid var(--line); border-radius: 4px; background: transparent; color: inherit; }
  .session-panel-scope button[aria-pressed="true"] { background: var(--selection, rgba(255,255,255,.08)); }
  .session-panel-scope button:disabled { opacity: .45; }
  .session-panel-list { max-height: min(40vh, 340px); overflow: auto; }
  .session-panel-empty { padding: 6px 12px; font-size: 12px; opacity: .6; }
  .session-row-place { opacity: .6; font-size: 11px; white-space: nowrap; }
  .session-row-place::after { content: "·"; margin: 0 4px; }
  .session-row-branch { display: inline-flex; align-items: center; gap: 2px; opacity: .6; font-size: 11px; white-space: nowrap; }
  .session-row-branch::after { content: "·"; margin: 0 4px; }
  ```
  변수명(`--line`, `--selection`, `--unread-approval`)은 index.css 상단의 실제 정의를 확인해 있는 이름을 쓴다.
- `.tools-group`, `.tools-group .session-tree`(2439-2445) 삭제.
- `.session-tree::before`(2299)가 트리 안 들여쓰기 선을 그린다면 `.session-panel-list::before { display: none; }`로 패널에서는 끈다.

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run src/renderer/src/App.test.tsx` 그리고 `npm test`, `npm run typecheck`
Expected: 전부 PASS. 특히 `getByRole("button", { name: "PowerShell 세션 열기" })` 정확 일치 테스트와 셸프 드래그 테스트가 손대지 않고 통과해야 한다. 기존 테스트 중 트리 안 세션 행을 `within(nav)`로 찾던 것이 있으면 `screen` 범위로 넓힌다(접근성 이름은 같다).

- [ ] **Step 8: 커밋**

```
git add src/renderer/src/SessionPanel.tsx src/renderer/src/ProjectSidebar.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/index.css
git commit -m "feat(sidebar): 세션·문서 행을 트리에서 빼고 하단 세션 패널로 옮김"
```

---

### Task 3: 폴더 상세 페이지의 워크트리 카드

**Files:**
- Modify: `src/renderer/src/ProjectDetailPage.tsx` (props 91-107, "Git 상태" 카드 뒤 ~281)
- Modify: `src/renderer/src/App.tsx` (`<ProjectDetailPage>` 3118-3152)
- Modify: `src/renderer/src/index.css` (신규 `.detail-worktree-*`)
- Test: `src/renderer/src/ProjectDetailPage.test.tsx`, `src/renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: `SharedWorktree`, `GitWorkspaceView`(`@shared/worktree-types`), `ActivePullRequestReview`(`@shared/github-types`), App의 `selectWorktree`, `setWorktreeCreateProject`, `setWorktreeMenu`.
- Produces: `ProjectDetailPage` 새 props —
  ```ts
  worktrees: SharedWorktree[];              // 이 프로젝트의 것만
  workspaceViews: GitWorkspaceView[];
  activeReviews: ActivePullRequestReview[];
  worktreeSessionCounts: Record<string, number>; // worktreeId → 세션 수
  worktreeWarning: string | null;
  onSelectWorktree(worktree: SharedWorktree): void;
  onCreateWorktree(): void;
  onWorktreeContextMenu(worktree: SharedWorktree, event: ReactMouseEvent): void;
  ```

- [ ] **Step 1: 실패하는 테스트 작성** — `src/renderer/src/ProjectDetailPage.test.tsx`

`baseProps()`에 새 props 기본값을 추가한다: `worktrees: [] as SharedWorktree[], workspaceViews: [] as GitWorkspaceView[], activeReviews: [] as ActivePullRequestReview[], worktreeSessionCounts: {} as Record<string, number>, worktreeWarning: null as string | null, onSelectWorktree: vi.fn(), onCreateWorktree: vi.fn(), onWorktreeContextMenu: vi.fn()`. 그리고:

```tsx
const featureWorktree: SharedWorktree = {
  id: "worktree-1", projectId: atlas.id, path: "C:\\work\\atlas-wt\\feature-x", branch: "feature-x",
  createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z",
};
const featureView: GitWorkspaceView = {
  workspaceKey: "worktree:worktree-1", kind: "worktree", projectId: atlas.id, worktreeId: featureWorktree.id,
  path: featureWorktree.path, branch: "feature-x", head: "abc1234", changedFileCount: 2,
  availability: "available", lockedReason: null, prunableReason: null,
};

describe("워크트리 카드", () => {
  it("워크트리를 브랜치·변경 수·세션 수와 함께 세우고, 열기가 onSelectWorktree를 부른다", () => {
    installApi();
    const onSelectWorktree = vi.fn();
    render(
      <ProjectDetailPage
        {...baseProps()}
        worktrees={[featureWorktree]}
        workspaceViews={[featureView]}
        worktreeSessionCounts={{ [featureWorktree.id]: 1 }}
        onSelectWorktree={onSelectWorktree}
      />,
    );
    const card = screen.getByRole("region", { name: "워크트리" });
    const row = within(card).getByRole("button", { name: "feature-x 워크트리 열기" });
    expect(row).toHaveTextContent("변경 2 · 세션 1");
    fireEvent.click(row);
    expect(onSelectWorktree).toHaveBeenCalledWith(featureWorktree);
  });

  it("보고 있는 워크트리는 '보는 중'이고 열기가 비활성이지만, 우클릭 메뉴는 열린다", () => {
    installApi();
    const onWorktreeContextMenu = vi.fn();
    render(
      <ProjectDetailPage
        {...baseProps()}
        worktree={featureWorktree}
        worktrees={[featureWorktree]}
        workspaceViews={[featureView]}
        onWorktreeContextMenu={onWorktreeContextMenu}
      />,
    );
    const card = screen.getByRole("region", { name: "워크트리" });
    const button = within(card).getByRole("button", { name: "feature-x (보는 중)" });
    expect(button).toBeDisabled();
    fireEvent.contextMenu(button);
    expect(onWorktreeContextMenu).toHaveBeenCalledWith(featureWorktree, expect.anything());
  });

  it("locked·missing·PR 리뷰 표시를 달고, PR 리뷰 worktree는 뒤로 간다", () => {
    installApi();
    const review: SharedWorktree = { ...featureWorktree, id: "worktree-pr", branch: "pr-42", path: "C:\\work\\atlas-wt\\pr-42" };
    render(
      <ProjectDetailPage
        {...baseProps()}
        worktrees={[review, featureWorktree]}
        workspaceViews={[featureView, { ...featureView, workspaceKey: "worktree:worktree-pr", worktreeId: review.id, branch: "pr-42", lockedReason: "review", availability: "missing" }]}
        activeReviews={[{ worktreeId: review.id, pullRequestNumber: 42 } as ActivePullRequestReview]}
      />,
    );
    const card = screen.getByRole("region", { name: "워크트리" });
    const names = within(card).getAllByRole("button", { name: /워크트리 열기/ }).map((b) => b.textContent);
    expect(names[0]).toContain("feature-x");
    expect(names[1]).toContain("PR #42 · 임시");
    expect(names[1]).toContain("locked");
    expect(names[1]).toContain("missing");
  });

  it("워크트리가 없으면 안내와 만들기 버튼만 있고, 경고가 있으면 카드에 뜬다", () => {
    installApi();
    const onCreateWorktree = vi.fn();
    render(<ProjectDetailPage {...baseProps()} onCreateWorktree={onCreateWorktree} worktreeWarning="stale worktree 2개" />);
    const card = screen.getByRole("region", { name: "워크트리" });
    expect(within(card).getByText("아직 워크트리가 없습니다")).toBeInTheDocument();
    expect(within(card).getByRole("status")).toHaveTextContent("stale worktree 2개");
    fireEvent.click(within(card).getByRole("button", { name: "워크트리 만들기" }));
    expect(onCreateWorktree).toHaveBeenCalledOnce();
  });
});
```

`ActivePullRequestReview`의 실제 필드는 `src/shared/github-types.ts`를 열어 필수 필드를 채운다(`as` 캐스트 대신 완전한 객체가 낫다). `within` import를 추가한다.

App.test.tsx에는 기존 `blocks removal behind a dirty check and requires the explicit force confirmation`(worktrees describe)을 **복제**해 `…from the folder page's worktree card`라는 이름으로 추가한다. 차이는 진입점뿐이다:

```tsx
fireEvent.click(await screen.findByRole("button", { name: "폴더 상세" }));
const card = await screen.findByRole("region", { name: "워크트리" });
fireEvent.contextMenu(within(card).getByRole("button", { name: "feature-x 워크트리 열기" }));
fireEvent.click(screen.getByRole("menuitem", { name: "Worktree 제거" }));
```
이후 다이얼로그 단언은 원본과 같고, 마지막 소멸 단언은 `within(card).queryByRole("button", { name: "feature-x 워크트리 열기" })`가 null.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/renderer/src/ProjectDetailPage.test.tsx`
Expected: FAIL — region "워크트리" 없음 (typecheck도 새 props 때문에 실패).

- [ ] **Step 3: `ProjectDetailPage.tsx` 구현**

import: `GitBranch`, `Plus`(lucide-react), `MouseEvent as ReactMouseEvent`, `GitWorkspaceView`, `ActivePullRequestReview`. props 인터페이스에 위 8개 추가. "Git 상태" 카드 `</section>` 뒤에:

```tsx
<section className="detail-card" aria-label="워크트리">
  <div className="detail-card-header">
    <h2>워크트리</h2>
    <button className="icon-button" type="button" onClick={onCreateWorktree} aria-label="워크트리 만들기" title="워크트리 만들기">
      <Plus size={14} />
    </button>
  </div>
  {worktreeWarning ? (
    <p className="detail-worktree-warning" role="status">
      <TriangleAlert size={13} />
      {worktreeWarning}
    </p>
  ) : null}
  {worktrees.length === 0 ? (
    <p className="detail-empty">아직 워크트리가 없습니다</p>
  ) : (
    <ul className="detail-worktrees">
      {sortedWorktrees.map((candidate) => {
        const view = workspaceViews.find((item) => item.worktreeId === candidate.id);
        const review = activeReviews.find((item) => item.worktreeId === candidate.id);
        const current = candidate.id === worktree?.id;
        const branchLabel = review ? `PR #${review.pullRequestNumber} · 임시` : (view?.branch ?? (view?.head ? `detached @ ${view.head.slice(0, 7)}` : candidate.branch));
        const flags = [view?.lockedReason ? "locked" : null, view?.availability === "missing" ? "missing" : null, view?.prunableReason ? "prunable" : null].filter(Boolean).join(" · ");
        return (
          <li key={candidate.id}>
            {/* 메뉴는 래퍼에 건다 — 보는 중인 행은 버튼이 disabled라 버튼에 걸면 우클릭이 죽는다. */}
            <div className="detail-worktree-row" onContextMenu={(event) => onWorktreeContextMenu(candidate, event)}>
              <button
                type="button"
                className={`detail-worktree ${current ? "current" : ""}`.trim()}
                disabled={current}
                onClick={() => onSelectWorktree(candidate)}
                aria-label={current ? `${candidate.branch} (보는 중)` : `${candidate.branch} 워크트리 열기`}
                title={candidate.path}
              >
                <GitBranch size={13} aria-hidden="true" />
                <span className="detail-worktree-branch">{branchLabel}{flags ? ` · ${flags}` : ""}</span>
                <span className="detail-worktree-meta">변경 {view?.changedFileCount ?? 0} · 세션 {worktreeSessionCounts[candidate.id] ?? 0}</span>
                {current ? <span className="detail-worktree-note">보는 중</span> : null}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  )}
</section>
```

`sortedWorktrees`는 `ProjectSidebar.tsx:953-959`의 비교 함수 그대로(PR 리뷰 둘이면 번호순, 리뷰 있는 쪽이 뒤, 나머지 브랜치 `localeCompare`)를 `useMemo`로. **`fireEvent.contextMenu(button)`이 disabled 버튼에서도 래퍼로 버블되는지** 테스트가 확인한다 — jsdom에서는 버블된다. `TriangleAlert` import 확인.

- [ ] **Step 4: `App.tsx` 배선**

`<ProjectDetailPage>`(3118-3152)에 추가:
```tsx
worktrees={worktrees.filter((candidate) => candidate.projectId === selectedProject.id)}
workspaceViews={workspaceViews}
activeReviews={activeReviews}
worktreeSessionCounts={Object.fromEntries(
  worktrees.map((candidate) => [candidate.id, sessions.filter((session) => session.worktreeId === candidate.id).length]),
)}
worktreeWarning={worktreeWarnings[selectedProject.id] ?? null}
onSelectWorktree={selectWorktree}
onCreateWorktree={() => setWorktreeCreateProject(selectedProject)}
onWorktreeContextMenu={(worktree, event) => {
  event.preventDefault();
  setWorktreeMenu({ worktree, x: event.clientX, y: event.clientY });
}}
```
(사이드바에 넘기던 `onWorktreeContextMenu` 2868-2871과 같은 본문 — 이 태스크에서는 사이드바 쪽도 그대로 둔다.)

- [ ] **Step 5: CSS**

`.folder-start-worktree*`(4937-4990)를 본떠 `.detail-worktrees`, `.detail-worktree-row`, `.detail-worktree`, `.detail-worktree.current`, `.detail-worktree-branch`, `.detail-worktree-meta`(작고 흐리게, `margin-left: auto`), `.detail-worktree-note`, `.detail-worktree-warning`(`.project-worktree-warning` 2488 부근의 스타일 이동)을 추가한다.

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run src/renderer/src/ProjectDetailPage.test.tsx src/renderer/src/App.test.tsx`, `npm run typecheck`
Expected: PASS. 사이드바 경로 원본 테스트와 상세 페이지 경로 복제본이 둘 다 초록.

- [ ] **Step 7: 커밋**

```
git add src/renderer/src/ProjectDetailPage.tsx src/renderer/src/ProjectDetailPage.test.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/index.css
git commit -m "feat(sidebar): 폴더 상세 페이지에 워크트리 카드 — 열기·우클릭 메뉴·만들기"
```

---

### Task 4: 트리에서 worktree 층 제거

**Files:**
- Modify: `src/renderer/src/ProjectSidebar.tsx` (worktree 블록 — Task 2 이후 줄 번호가 바뀌었으니 `worktree-tree` 클래스로 찾는다; props `worktrees`, `activeReviews`, `workspaceViews`, `worktreeWarnings`, `selectedWorktreeId`, `onSelectWorktree`, `onWorktreeContextMenu` 제거; `GitBranch`·`TriangleAlert`(경고에서만 쓰였으면) import 정리)
- Modify: `src/renderer/src/App.tsx` (사이드바 props 2860-2871 정리)
- Modify: `src/renderer/src/index.css` (`.worktree-tree`, `.worktree-node`, `.main-workspace-node`, `.worktree-sessions`, `.workspace-select`, `.project-worktree-warning` 삭제 — **`.worktree-row`, `.worktree-branch`, `.workspace-copy`, `.workspace-meta`는 남긴다**: `NewSessionLauncher.tsx:114`·`WorkspaceHeader.tsx:143`이 쓴다)
- Test: `src/renderer/src/App.test.tsx`, `e2e/desktop.spec.ts`

**Interfaces:**
- Consumes: Task 2의 세션 패널(worktree 세션 행에 브랜치가 달려 있고 클릭이 `revealSession`으로 worktree 그리드까지 간다), Task 3의 워크트리 카드.
- Produces: `ProjectSidebar` props 축소(위 7개 제거). 폴더 행에는 여전히 체버론이 있다(Task 5).

- [ ] **Step 1: 테스트 개정** — `src/renderer/src/App.test.tsx`

(a) `nests worktree sessions under a third tree level and scopes the grid and detail page to it` → 이름 `reaches a worktree session from the session panel and scopes the grid and detail page to it`. `feature-x worktree 선택` 클릭을 세션 패널 행 클릭으로:
```tsx
const panel = await screen.findByRole("region", { name: "세션 패널" });
const row = within(panel).getByRole("button", { name: "WT 세션 세션 열기" });
expect(within(row).getByText("feature-x")).toBeInTheDocument();
fireEvent.click(row);
```
이후 단언(그리드에 `WT 세션` region만, 상세 페이지에 `WT 세션 세션 보기`만, 새 세션이 `worktreeId`로 생성)은 그대로.

(b) 사이드바 경로의 `blocks removal behind a dirty check…` 원본 삭제(Task 3에서 만든 상세 페이지 경로 복제본이 남는다). 복제본 이름에서 `…from the folder page's worktree card` 접미를 떼도 된다.

(c) 트리에 worktree 행이 없음을 단언하는 테스트 하나 추가(worktrees describe 안):
```tsx
it("draws no worktree rows in the tree — the folder page's card and the session panel carry them", async () => {
  const harness = createApi({ sessions: [worktreeSession], worktrees: [atlasWorktree] });
  window.multiCliWork = harness.api;
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "프로젝트" });
  await screen.findByRole("region", { name: "세션 패널" });
  expect(within(nav).queryByRole("button", { name: /worktree 선택/ })).not.toBeInTheDocument();
  expect(nav.querySelector(".worktree-tree")).toBeNull();
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/renderer/src/App.test.tsx -t "worktree"`
Expected: (c)가 FAIL(worktree 행이 아직 있다), (a)는 PASS일 수 있다(패널 행은 이미 있다).

- [ ] **Step 3: 사이드바에서 worktree 블록·props 제거, App 전달부 정리, CSS 삭제**

`isGitProject`, `projectWorktrees`, `projectWorkspaceViews`, `mainWorkspace` 지역 변수와 `{expanded && isGitProject ? (<ul className="worktree-tree">…)}` 블록 전체 삭제. 폴더 아래에는 이제 `expanded`일 때 그릴 것이 없다 — `expanded && !isGitProject` 분기도 Task 2에서 이미 사라졌으므로 폴더 `<li>`는 행과 `ProjectMetadataEditor`만 남는다(체버론은 Task 5까지 둔다: 접힘 상태가 렌더에 영향을 주지 않아도 된다). `.session-tree.worktree-sessions` 등 CSS 삭제.

- [ ] **Step 4: e2e 개정** — `e2e/desktop.spec.ts`

- 697: `await expect(page.getByRole("button", { name: "feature/e2e worktree 선택" })).toBeVisible();` → 워크트리 생성 후 앱이 그 worktree로 스코프되므로, `await expect(page.getByRole("button", { name: "폴더 상세" })).toBeVisible();` 뒤에 `await page.getByRole("button", { name: "폴더 상세" }).click(); await expect(page.getByRole("region", { name: "워크트리" }).getByRole("button", { name: "feature/e2e (보는 중)" })).toBeVisible();` 그리고 세션을 시작하려면 그리드로 돌아간다: 사이드바의 `Sample Project 폴더 선택`이 아니라(그건 메인 체크아웃) 워크트리 카드… — 가장 단순하게는 상세 페이지의 `새 ${SHELL_LABEL} 세션` 런처(상세 페이지 세션 카드의 `${label} 세션 시작` 버튼)를 쓴다. 이후 `terminal` region 단언은 그대로.
- 740, 748: `feature/e2e worktree 선택` 우클릭 → `await page.getByRole("button", { name: "폴더 상세" }).click();` 후 `page.getByRole("region", { name: "워크트리" }).getByRole("button", { name: /^feature\/e2e/ })`를 우클릭. 메뉴 이름(`feature/e2e worktree 작업`)과 메뉴 항목은 그대로.
- 757: 소멸 단언 → `await expect(page.getByRole("region", { name: "워크트리" }).getByRole("button", { name: /^feature\/e2e/ })).toBeHidden();`
- 773-775, 785, 789: 외부 worktree 발견 → 새로고침 후 `폴더 상세`를 열고 워크트리 카드의 `feature/external 워크트리 열기`를 찾아 클릭(775)·우클릭(785 부근)·소멸(789)에 같은 셀렉터.

e2e는 빌드가 필요해 이 태스크에서는 **타입만** 맞춘다(`npx tsc --noEmit -p tsconfig.json`이 e2e를 포함하는지 확인; 아니면 `npx playwright test --list`로 문법만). 실제 실행은 Task 5 뒤 한 번.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/renderer/src/App.test.tsx`, `npm test`, `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: 커밋**

```
git add src/renderer/src/ProjectSidebar.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/index.css e2e/desktop.spec.ts
git commit -m "feat(sidebar): 트리에서 worktree 층 제거 — 세션 패널과 워크트리 카드가 대신한다"
```

---

### Task 5: 폴더를 잎으로 — 접힘 상태 정리와 채널까지 다루는 트리 컨트롤

**Files:**
- Create: `src/renderer/src/sidebar-tree.ts`, Test: `src/renderer/src/sidebar-tree.test.ts`
- Modify: `src/renderer/src/ProjectSidebar.tsx` (폴더 행 체버론·`aria-expanded`·`expanded`·`showing`; `treeSections`/`treeNodes` useMemo → `sidebar-tree.ts` 호출; 트리 컨트롤 세 버튼; props `gridProjectId`, `expandedProjects`, `onToggleProject` 제거)
- Modify: `src/renderer/src/App.tsx` (`COLLAPSED_PROJECTS_KEY` 175, `expandedProjects` 290과 호출부 706·735·1103·1157·1358·1498·1518·3247, `collapsedProjectIds` 291-296, `toggleProject` 1365-1375, `applyExpansion` 1392-1404, `expandAll`/`collapseAll`/`expandWorking` 1406-1427, `gridProjectId` 2344-2347, 사이드바 props)
- Test: `src/renderer/src/App.test.tsx`, `e2e/desktop.spec.ts`

**Interfaces:**
- Produces (`sidebar-tree.ts`):
  ```ts
  export interface TreeSection { key: string; workProject: WorkProject | null; projects: SharedProject[] }
  export interface ChannelNode { kind: "channel"; key: string; channel: string; letter: string; label: string; sections: TreeSection[] }
  export type TreeNode = ChannelNode | { kind: "section"; key: string; section: TreeSection };
  export function buildTreeSections(workProjects: readonly WorkProject[], projects: readonly SharedProject[], projectMembership: Record<string, { workProjectId: string }>): TreeSection[];
  export function buildTreeNodes(sections: readonly TreeSection[], workspaceShells: Record<string, WorkspaceShellInfo>): TreeNode[];
  export function channelKeys(nodes: readonly TreeNode[]): string[];
  /** "작업중"이 접을 채널 키 — 작업중 폴더를 하나도 갖지 않은 채널. */
  export function collapsedChannelKeysForWorking(nodes: readonly TreeNode[], workingProjectIds: ReadonlySet<string>): Set<string>;
  ```
  `buildTreeSections`/`buildTreeNodes`는 `ProjectSidebar.tsx`의 `treeSections`(410-421)·`treeNodes`(428-453) 본문 그대로다(채널 키는 `channel:${shell.channel}`).

- [ ] **Step 1: 실패하는 단위 테스트** — `src/renderer/src/sidebar-tree.test.ts`

```ts
import type { SharedProject } from "@shared/project-types";
import type { WorkProject } from "@shared/work-project-types";
import type { WorkspaceShellInfo } from "@shared/workspace-types";
import { describe, expect, it } from "vitest";
import { buildTreeNodes, buildTreeSections, channelKeys, collapsedChannelKeysForWorking } from "./sidebar-tree";

const project = (id: string): SharedProject => ({
  id, rootPath: `C:\\dev\\${id}`, displayName: id, sources: ["manual"], providerRefs: { claude: [], codex: [] },
  status: null, memo: "", tracks: [], hidden: false, order: 0, createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z",
});
const workProject = (id: string, name: string): WorkProject => ({
  id, name, category: "기타", status: null, members: [], notionLinks: [], localFolders: [], order: null,
  createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z",
});
const shell = (channel: string, name: string): WorkspaceShellInfo => ({
  root: "C:\\work", ref: `${channel}/${name}`, channel, channelLetter: channel[0], channelLabel: "용역", shell: name,
  title: name, status: "active", path: `C:\\work\\${channel}\\${name}`, repos: [], externalPaths: [], data: [],
});

describe("buildTreeSections / buildTreeNodes", () => {
  it("셸에서 온 업무 프로젝트만 채널 아래로 들어가고, 채널 묶음은 첫 항목의 자리를 차지한다", () => {
    const manual = workProject("wp-manual", "손으로");
    const vsp = workProject("wp-vsp", "VSP");
    const foaa = workProject("wp-foaa", "FOAA");
    const sections = buildTreeSections([manual, vsp, foaa], [project("a"), project("b")], { a: { workProjectId: "wp-vsp" } });
    expect(sections.map((s) => s.key)).toEqual(["wp-manual", "wp-vsp", "wp-foaa", "unassigned"]);
    expect(sections[3].projects.map((p) => p.id)).toEqual(["b"]);

    const nodes = buildTreeNodes(sections, { "wp-vsp": shell("O_SMCH", "24_SMCH_VSP-1"), "wp-foaa": shell("O_SMCH", "25_SMCH_FOAA-1") });
    expect(nodes.map((n) => n.key)).toEqual(["wp-manual", "channel:O_SMCH", "unassigned"]);
    expect(nodes[1]).toMatchObject({ kind: "channel", channel: "O_SMCH", sections: [{ key: "wp-vsp" }, { key: "wp-foaa" }] });
  });

  it("업무 프로젝트가 하나도 없으면 미분류 묶음 하나만 남는다", () => {
    expect(buildTreeSections([], [project("a")], {})).toEqual([{ key: "unassigned", workProject: null, projects: [project("a")] }]);
  });
});

describe("collapsedChannelKeysForWorking", () => {
  it("작업중 폴더를 가진 채널만 열어 두고 나머지 채널 키를 돌려준다", () => {
    const sections = buildTreeSections(
      [workProject("wp-vsp", "VSP"), workProject("wp-career", "진로")],
      [project("a"), project("b")],
      { a: { workProjectId: "wp-vsp" }, b: { workProjectId: "wp-career" } },
    );
    const nodes = buildTreeNodes(sections, { "wp-vsp": shell("O_SMCH", "24_SMCH_VSP-1"), "wp-career": shell("P_Personal", "26_Personal_Career-1") });
    expect(channelKeys(nodes)).toEqual(["channel:O_SMCH", "channel:P_Personal"]);
    expect([...collapsedChannelKeysForWorking(nodes, new Set(["a"]))]).toEqual(["channel:P_Personal"]);
    expect([...collapsedChannelKeysForWorking(nodes, new Set())]).toEqual(["channel:O_SMCH", "channel:P_Personal"]);
  });
});
```

`WorkProject`의 실제 필드는 `src/shared/work-project-types.ts`를 열어 맞춘다.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/renderer/src/sidebar-tree.test.ts` → 모듈 없음.

- [ ] **Step 3: `sidebar-tree.ts` 작성** — 두 useMemo 본문을 옮기고 `channelKeys`, `collapsedChannelKeysForWorking`을 추가:

```ts
export function channelKeys(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((node) => (node.kind === "channel" ? [node.key] : []));
}

export function collapsedChannelKeysForWorking(nodes: readonly TreeNode[], workingProjectIds: ReadonlySet<string>): Set<string> {
  const collapsed = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== "channel") continue;
    const hasWorking = node.sections.some((section) => section.projects.some((project) => workingProjectIds.has(project.id)));
    if (!hasWorking) collapsed.add(node.key);
  }
  return collapsed;
}
```

- [ ] **Step 4: 실패하는 통합 테스트 개정** — `src/renderer/src/App.test.tsx`

(a) `keeps folders with a running agent open and closes the rest, across the group and folder layers alike` → 이름 `…across the group and channel layers`. `folderNode(...)` `aria-expanded` 단언 삭제. ws-root 채널 fixture(`workspaceSnapshot`, `shellInfo` — 1636 describe 안에 있으니 필요하면 describe 밖 상수로 끌어올린다)로 채널 두 개를 만들고, 작업중 폴더가 있는 채널은 `aria-expanded="true"`, 없는 채널은 `"false"`가 되게 단언한다(`.channel-node`의 `aria-expanded`).
(b) `collapses and re-expands both layers at once, and remembers it across a restart` — `folderNode` 단언 삭제; 재시작 단언은 업무 프로젝트 + `.channel-node`.
(c) `folds the row already on screen instead of opening it again, on both layers` → `…on the group layer`. 폴더 절반 삭제.
(d) `folderNode` 헬퍼 삭제. `getByRole("button", { name: "Atlas 펼치기" })`·`"Atlas 접기"` 등 폴더 체버론을 누르는 곳을 `grep -n '펼치기"\|접기"' src/renderer/src/App.test.tsx`로 전부 찾아 삭제(세션 행은 이제 항상 패널에 있으니 펼칠 필요가 없다).
(e) 신규:
```tsx
it("폴더 행은 잎이다 — 체버론이 없고 클릭하면 그리드가 열린다", async () => {
  const harness = createApi({ projects: [atlas, dashboard], sessions: [powershellSession] });
  window.multiCliWork = harness.api;
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "프로젝트" });
  expect(within(nav).queryByRole("button", { name: "Dashboard 펼치기" })).not.toBeInTheDocument();
  const row = within(nav).getByRole("button", { name: "Dashboard 폴더 선택" });
  expect(row.closest(".project-node")).not.toHaveAttribute("aria-expanded");
  fireEvent.click(row);
  expect(await screen.findByRole("heading", { name: /Dashboard/ })).toBeInTheDocument();
});
```
(마지막 단언은 폴더 그리드가 떴을 때 헤더에 폴더명이 보이는 기존 방식에 맞춘다 — `folder workspace` describe의 `opens a folder straight into a grid…`가 무엇을 단언하는지 보고 같은 셀렉터를 쓴다.)

- [ ] **Step 5: 구현**

`ProjectSidebar.tsx`:
- 폴더 행에서 `tree-toggle` 버튼 삭제, `<li className="project-node" … aria-expanded={expanded}>`의 `aria-expanded` 삭제, `expanded`·`showing` 변수 삭제, `project-select`의 onClick을 `() => onSelectProject(project.id)`로, 아이콘 분기의 `expanded ? <FolderOpen/> : <Folder/>`는 `selectedProjectId === project.id ? <FolderOpen/> : <Folder/>`로.
- `treeSections`/`treeNodes` useMemo를 `buildTreeSections`/`buildTreeNodes` 호출로 교체(타입 import는 `sidebar-tree.ts`에서).
- 트리 컨트롤: 
  ```ts
  const persistWorkspaces = (next: Set<string>) => { setExpandedWorkspaces(next); persist(next, openShelves, sessionPanelOpen, sessionScope); };
  const runExpandAll = () => { onExpandAll(); persistWorkspaces(new Set([...expandedWorkspaces].filter((key) => !key.startsWith("channel:")))); };
  const runCollapseAll = () => { onCollapseAll(); persistWorkspaces(new Set([...expandedWorkspaces, ...channelKeys(treeNodes)])); };
  const runExpandWorking = () => {
    onExpandWorking();
    const working = new Set(projects.filter((project) => isFolderActive(sessions.filter((session) => session.projectId === project.id))).map((project) => project.id));
    const keep = [...expandedWorkspaces].filter((key) => !key.startsWith("channel:"));
    persistWorkspaces(new Set([...keep, ...collapsedChannelKeysForWorking(treeNodes, working)]));
  };
  ```
  버튼 onClick을 이 세 함수로. `title`은 "모든 채널과 프로젝트 펼치기/접기", "작업중인 폴더가 있는 채널과 프로젝트만 펼치기"로.
- props에서 `gridProjectId`, `expandedProjects`, `onToggleProject` 제거. 95-96·110-111 주석 갱신.

`App.tsx`: 위 Files의 삭제·축소 목록 전부. `applyExpansion`은 `(expandedWorkProjectIds: Set<string>)`만 받아 `setCollapsedWorkProjectIds`와 `persistCollapsed(COLLAPSED_WORK_PROJECTS_KEY, …)`만 한다. `expandWorking`은 작업중 폴더의 `projectMembership[...]?.workProjectId` 집합만 넘긴다. 175 주석을 "업무 프로젝트 한 층만 저장한다. `multi-cli-work.projects.v1`은 폴더가 접히던 시절의 키로, 읽지도 지우지도 않는다(다운그레이드 안전)"로.

e2e `openFolder()`(83-92): `aria-expanded` 확인과 `${name} 펼치기` 클릭을 없애고 `await row.click(); await expect(page.locator(".workspace-grid")).toBeVisible();`로(`.workspace-grid` 클래스명은 `WorkspaceGrid.tsx`에서 확인). 553-562의 폴더 행 접힘 단언 블록(주석 550-552 포함) 삭제.

- [ ] **Step 6: 통과 확인**

Run: `npm test`, `npm run typecheck`
Expected: PASS. `npm run test:e2e:smoke`도 이 시점에 한 번 돌린다(빌드 포함, 수 분). 워크트리에서 electron 빌드가 안 되면(node-pty) 실패 로그를 보고에 남기고 머지 후 main에서 돌린다고 적는다 — e2e 실패가 코드가 아니라 환경 때문임을 로그로 구분할 것.

- [ ] **Step 7: 커밋**

```
git add src/renderer/src/sidebar-tree.ts src/renderer/src/sidebar-tree.test.ts src/renderer/src/ProjectSidebar.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx e2e/desktop.spec.ts
git commit -m "feat(sidebar): 폴더를 잎으로 — 접힘 상태 정리, 트리 컨트롤이 채널까지 다룬다"
```

---

### Task 6 (선택): `ProjectTree.tsx` 추출

Task 1-5가 전부 초록일 때만. 동작 변경 0 — 클래스·role·aria 한 글자도 바꾸지 않는다.

**Files:**
- Create: `src/renderer/src/ProjectTree.tsx`
- Modify: `src/renderer/src/ProjectSidebar.tsx`

- [ ] **Step 1:** `renderChannel`, `renderSection`, 폴더 드래그 상태(`drag`, `setDrag`, `dropOn`, `endDrag`)와 그것들이 읽는 props를 `ProjectTree` 컴포넌트로 옮긴다. `ProjectSidebar`는 `<ProjectTree …/>`를 `<ul className="project-tree">` 자리에서 부른다. 채널 접힘(`expandedWorkspaces`, `toggleWorkspace`)은 사이드바에 남기고 props로 내린다.
- [ ] **Step 2:** `npm test`, `npm run typecheck` — 하나라도 깨지면 이동 중 무언가를 바꾼 것이다. 고칠 것은 이동이지 테스트가 아니다.
- [ ] **Step 3:** 커밋 `refactor(sidebar): 트리 렌더를 ProjectTree로 분리 (동작 변경 없음)`.

---

## 검증 (전체)

```
npm test            # vitest run — 103+ 파일, 1117+ 테스트 (기준선: 103/1117)
npm run typecheck   # tsc --noEmit × 2
npm run test:e2e:smoke   # Task 5 뒤 1회. 워크트리에서 안 되면 머지 후 main에서
```

`npm run dev` 수동 확인(머지 후 main 체크아웃에서): ① 폴더 클릭→그리드, 재클릭→무반응 ② 승인 대기 세션이 패널 맨 위 + 폴더 배지 동시 ③ 패널 행 드래그→작업공간/그리드 슬롯 ④ worktree 세션 행 클릭→worktree 그리드 ⑤ 폴더 상세 워크트리 카드 우클릭→sync/fetch/제거 ⑥ 사이드바 접기→레일만 ⑦ 재시작→패널 접힘/범위/채널 접힘 유지.
