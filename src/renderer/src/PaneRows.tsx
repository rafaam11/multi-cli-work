import type { AgentView } from "@shared/agent-types";
import type { SessionAttention, TerminalSessionView } from "@shared/api-types";
import { GitBranch, Wrench } from "lucide-react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { SessionNameInput } from "./SessionNameInput";
import { AgentIcon } from "./brand-icons";
import { DocumentPaneIcon, paneRowClassOf, type DocumentPane } from "./pane-items";
import { statusLabels } from "./session-labels";

/**
 * 패인 한 줄 — 세션이거나 문서다. 트리(폴더·worktree 아래)와 상단 세션 패널이 같은 줄을 그리므로
 * 마크업과 클래스는 여기 한 곳에만 있다. 두 곳의 차이는 세 가지뿐이다: 접근성 이름의 **동사**,
 * 소속(폴더·브랜치) 칸을 보이는지, 행 오른쪽 끝에 무엇이 붙는지(`trailing`).
 *
 * 동사가 갈리는 이유는 판정 R8이다 — 한 화면에 `X 세션 열기` 버튼이 트리와 패널에 각각 서면
 * `getByRole` 정확 일치가 전부 깨진다. 트리는 v1.26의 `세션 열기`/`문서 열기`, 패널은 셸프와
 * 같은 `패인 열기`를 쓴다.
 */
export interface PaneDragProps {
  draggable: boolean;
  onDragStart(event: ReactDragEvent<HTMLElement>): void;
  onDragEnd(): void;
}

export interface PaneDropProps {
  onDragOver(event: ReactDragEvent<HTMLElement>): void;
  onDragLeave(event: ReactDragEvent<HTMLElement>): void;
  onDrop(event: ReactDragEvent<HTMLElement>): void;
}

interface PaneRowCommonProps {
  label: string;
  /** 폴더명(또는 "도구"). 여러 폴더가 섞이는 패널만 보인다 — 트리는 이미 그 자리가 말한다. */
  place?: string | null;
  /** worktree 패인이면 브랜치. `place`와 같은 이유로 패널에서만 쓴다. */
  branch?: string | null;
  current: boolean;
  onScreen: boolean;
  dragProps: PaneDragProps;
  /** 행 사이에 끼워 넣는 드래그 피드백 클래스. 재정렬을 받는 곳(패널)만 넘긴다. */
  dropClass?: string;
  dropProps?: PaneDropProps;
  /** 행 오른쪽 끝 — 패널은 숨김(눈) 버튼, 트리는 문서의 ✕ 또는 없음. */
  trailing?: ReactNode;
}

/** 소속은 눈에 보이는 span과 `title`에만 넣는다 — 접근성 이름에 새면 행을 찾는 테스트가 깨진다. */
function PlaceMarks({ place, branch }: { place?: string | null; branch?: string | null }) {
  return (
    <>
      {place ? <span className="session-row-place">{place}</span> : null}
      {branch ? (
        <span className="session-row-branch">
          <GitBranch size={11} aria-hidden="true" />
          {branch}
        </span>
      ) : null}
    </>
  );
}

function rowTitle(label: string, place?: string | null, branch?: string | null): string {
  return [place, branch ? `⎇ ${branch}` : null, label].filter(Boolean).join(" · ");
}

export interface SessionRowProps extends PaneRowCommonProps {
  session: TerminalSessionView;
  agent: AgentView | undefined;
  tool: boolean;
  attention: SessionAttention | null;
  /** 접근성 이름의 동사 — 트리는 "세션 열기", 패널은 "패인 열기"(R8). */
  verb: "세션 열기" | "패인 열기";
  onSelect(): void;
  onContextMenu(event: ReactMouseEvent): void;
  renaming: boolean;
  initialName: string;
  onRename(name: string | null): void;
  onCancelRename(): void;
}

export function SessionRow({
  session,
  label,
  place,
  branch,
  agent,
  tool,
  attention,
  current,
  onScreen,
  verb,
  onSelect,
  onContextMenu,
  renaming,
  initialName,
  onRename,
  onCancelRename,
  dragProps,
  dropClass,
  dropProps,
  trailing,
}: SessionRowProps) {
  // 이름을 고치는 동안에는 행 자체가 입력칸이 된다 — 열기 버튼이 남아 있으면 첫 글자를 누르다
  // 세션이 열린다.
  if (renaming) {
    return (
      <li>
        <SessionNameInput initialName={initialName} onSubmit={onRename} onCancel={onCancelRename} />
      </li>
    );
  }
  return (
    <li>
      <div
        className={paneRowClassOf(current, onScreen, "file-tab-row", `status-${session.status}`, dropClass ?? "")}
        {...dragProps}
        {...dropProps}
      >
        <button
          className="file-tab-open"
          type="button"
          onClick={onSelect}
          onContextMenu={onContextMenu}
          aria-label={`${label} ${verb}${attention ? " (읽지 않음)" : ""}`}
          title={rowTitle(label, place, branch)}
        >
          <span className={`status-dot status-${session.status}`} aria-hidden="true" />
          {tool ? <Wrench size={14} /> : <AgentIcon agent={agent} size={14} />}
          <PlaceMarks place={place} branch={branch} />
          <span className="session-name">{label}</span>
          {attention ? (
            <span className={`unread-dot unread-${attention}`} title="응답 대기" aria-hidden="true" />
          ) : null}
          <span className="session-status">{statusLabels[session.status]}</span>
        </button>
        {trailing}
      </div>
    </li>
  );
}

export interface DocumentRowProps extends PaneRowCommonProps {
  pane: DocumentPane;
  verb: "문서 열기" | "패인 열기";
  onOpen(): void;
}

/**
 * A file, diff, commit graph or pull request. A sibling pair of buttons inside the row, not a
 * button nesting a button (invalid HTML — the trap `.brand-block`'s toggle hit before), so 닫기
 * can sit on the same line as 열기.
 */
export function DocumentRow({
  pane,
  label,
  place,
  branch,
  current,
  onScreen,
  verb,
  onOpen,
  dragProps,
  dropClass,
  dropProps,
  trailing,
}: DocumentRowProps) {
  return (
    <li>
      <div
        className={paneRowClassOf(current, onScreen, "file-tab-row", dropClass ?? "")}
        {...dragProps}
        {...dropProps}
      >
        <button
          type="button"
          className="file-tab-open"
          onClick={onOpen}
          aria-label={`${label} ${verb}${pane.dirty ? " (저장 안 됨)" : ""}`}
          title={rowTitle(label, place, branch)}
        >
          <span className={`file-tab-dot ${pane.dirty ? "dirty" : ""}`} aria-hidden="true" />
          <DocumentPaneIcon kind={pane.kind} size={13} />
          <PlaceMarks place={place} branch={branch} />
          <span className="session-name">{label}</span>
        </button>
        {trailing}
      </div>
    </li>
  );
}
