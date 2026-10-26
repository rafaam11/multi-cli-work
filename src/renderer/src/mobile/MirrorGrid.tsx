import type { DragEvent, ReactNode } from "react";
import { Columns2, FileText, Rows2 } from "lucide-react";
import type { RemoteMirrorView, RemoteSessionSummary, RemoteViewAction } from "@shared/remote-types";
import { AUTO_LAYOUT_ID, buildLayout, canSplitColumn, columnOfSlot, GRID_LAYOUTS } from "../grid-layouts";

/** 머리줄을 끌어 다른 칸에 놓을 때 싣는 패인 id. */
export const MIRROR_PANE_DRAG_TYPE = "application/x-mcw-pane";

/** 칸 하나를 그리는 데 필요한 것. 세션 칸은 MobileApp이 SessionScreen으로 그린다. */
export interface MirrorPaneProps {
  session: RemoteSessionSummary;
  slot: number;
  focused: boolean;
  /** 열 나누기·합치기 버튼. 머리줄 ✕ 앞에 놓는다. */
  actions: ReactNode;
  onFocus(): void;
  onClose(): void;
  onDragStart(event: DragEvent<HTMLElement>): void;
}

interface MirrorGridProps {
  view: RemoteMirrorView;
  /** 호스트가 지금 보는 곳의 이름 — 폴더·worktree·선반. */
  placeLabel: string;
  sessions: readonly RemoteSessionSummary[];
  disabled: boolean;
  onView(action: RemoteViewAction): void;
  renderPane(props: MirrorPaneProps): ReactNode;
}

const LAYOUT_CHOICES = [
  { id: AUTO_LAYOUT_ID, label: "자동" },
  ...GRID_LAYOUTS.map((layout) => ({ id: layout.id, label: layout.label })),
];

/**
 * 호스트 메인 창의 그리드를 그대로 그린다: 같은 레이아웃·칸·페이지·포커스. 바꾸는 조작은 모두 호스트에
 * 요청으로 보내고, 결과는 다음 mirror로 돌아온다 — 이 화면은 자기 배치를 갖지 않는다.
 */
export function MirrorGrid({ view, placeLabel, sessions, disabled, onView, renderPane }: MirrorGridProps) {
  const layout = buildLayout(view.columnRows.length > 0 ? view.columnRows : [1]);
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const custom = !LAYOUT_CHOICES.some((choice) => choice.id === view.layoutId);

  const dropTarget = (slot: number) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (event.dataTransfer.types.includes(MIRROR_PANE_DRAG_TYPE)) event.preventDefault();
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const paneId = event.dataTransfer.getData(MIRROR_PANE_DRAG_TYPE);
      if (!paneId) return;
      event.preventDefault();
      onView({ action: "move", paneId, slot });
    },
  });

  const columnActions = (slot: number) => {
    const column = columnOfSlot(layout.columnRows, slot);
    if (!column) return null;
    return column.rows > 1 ? (
      <button
        type="button"
        className="m-pane-close"
        aria-label="열 합치기"
        title="열 합치기"
        disabled={disabled}
        onClick={() => onView({ action: "merge", slot })}
      >
        <Rows2 size={13} />
      </button>
    ) : canSplitColumn(layout, slot) ? (
      <button
        type="button"
        className="m-pane-close"
        aria-label="열 나누기"
        title="열 나누기"
        disabled={disabled}
        onClick={() => onView({ action: "split", slot })}
      >
        <Columns2 size={13} style={{ transform: "rotate(90deg)" }} />
      </button>
    ) : null;
  };

  return (
    <section className="m-mirror" aria-label="호스트 화면">
      <div className="m-mirror-bar">
        <span className="m-mirror-place" title={placeLabel}>
          {placeLabel}
        </span>
        {view.pages > 1 ? (
          <span className="m-mirror-pages" role="group" aria-label="페이지">
            <button
              type="button"
              aria-label="이전 페이지"
              disabled={disabled || view.page === 0}
              onClick={() => onView({ action: "page", page: view.page - 1 })}
            >
              ‹
            </button>
            <span>
              {view.page + 1} / {view.pages}
            </span>
            <button
              type="button"
              aria-label="다음 페이지"
              disabled={disabled || view.page >= view.pages - 1}
              onClick={() => onView({ action: "page", page: view.page + 1 })}
            >
              ›
            </button>
          </span>
        ) : null}
        <label className="m-mirror-layout">
          <span>레이아웃</span>
          <select
            value={view.layoutId}
            disabled={disabled}
            onChange={(event) => onView({ action: "layout", layoutId: event.target.value })}
          >
            {custom ? <option value={view.layoutId}>{layout.label}</option> : null}
            {LAYOUT_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {view.place.kind === "other" ? (
        <p className="m-empty m-wide-placeholder">호스트가 그리드가 아닌 화면을 보고 있습니다. 왼쪽에서 폴더를 고르세요</p>
      ) : view.slots.length === 0 ? (
        <p className="m-empty m-wide-placeholder">이 곳에 열린 세션이 없습니다</p>
      ) : (
        <div
          className="m-grid m-mirror-grid"
          style={{ gridTemplateColumns: layout.columns, gridTemplateRows: layout.rows, gridTemplateAreas: layout.areas }}
        >
          {view.slots.map((slot, index) => {
            const area = `s${index + 1}`;
            const focused = slot !== null && slot.id === view.focusedPaneId;
            const session = slot?.kind === "session" ? byId.get(slot.id) : undefined;
            if (slot && session) {
              return (
                <div key={slot.id} className="m-mirror-slot" style={{ gridArea: area }} {...dropTarget(index)}>
                  {renderPane({
                    session,
                    slot: index,
                    focused,
                    actions: columnActions(index),
                    onFocus: () => onView({ action: "focus", paneId: slot.id }),
                    onClose: () => onView({ action: "close", slot: index }),
                    onDragStart: (event) => {
                      event.dataTransfer.setData(MIRROR_PANE_DRAG_TYPE, slot.id);
                      event.dataTransfer.effectAllowed = "move";
                    },
                  })}
                </div>
              );
            }
            const label =
              slot === null
                ? "빈 칸"
                : slot.kind === "document"
                  ? `호스트에서 열린 문서: ${slot.label}`
                  : "세션을 불러오는 중…";
            return (
              <div
                key={slot?.id ?? `empty-${index}`}
                className={["m-mirror-slot", "m-mirror-placeholder", focused ? "m-pane-focused" : ""].filter(Boolean).join(" ")}
                style={{ gridArea: area }}
                {...dropTarget(index)}
              >
                <header
                  className="m-bar"
                  draggable={slot !== null ? true : undefined}
                  onDragStart={(event) => {
                    if (!slot) return;
                    event.dataTransfer.setData(MIRROR_PANE_DRAG_TYPE, slot.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                >
                  {slot?.kind === "document" ? <FileText size={13} aria-hidden="true" /> : null}
                  <h1>{label}</h1>
                  {columnActions(index)}
                  {slot !== null ? (
                    <button
                      type="button"
                      className="m-pane-close"
                      aria-label={`${label} 칸 닫기`}
                      title="칸 닫기"
                      disabled={disabled}
                      onClick={() => onView({ action: "close", slot: index })}
                    >
                      ✕
                    </button>
                  ) : null}
                </header>
                <p className="m-empty">{slot === null ? "왼쪽에서 세션을 고르거나 칸 머리줄을 끌어다 놓으세요" : null}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
