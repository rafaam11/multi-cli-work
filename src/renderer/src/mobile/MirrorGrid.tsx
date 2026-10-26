import type { DragEvent, ReactNode } from "react";
import { ChevronLeft, ChevronRight, FileText, Plus, Square, SquareSplitVertical, X } from "lucide-react";
import type { RemoteMirrorView, RemoteSessionSummary, RemoteViewAction } from "@shared/remote-types";
import { buildLayout, canSplitColumn, columnOfSlot } from "../grid-layouts";
import { LayoutPicker } from "../LayoutPicker";

/** 머리줄을 끌어 다른 칸에 놓을 때 싣는 패인 id. */
export const MIRROR_PANE_DRAG_TYPE = "application/x-mcw-pane";

/** 칸 하나를 그리는 데 필요한 것. 세션 칸은 MobileApp이 SessionScreen으로 그린다. */
export interface MirrorPaneProps {
  session: RemoteSessionSummary;
  slot: number;
  focused: boolean;
  /** 호스트가 이 칸을 확대해 보이는 중인지. */
  zoomed: boolean;
  /** 열 나누기·합치기 버튼. 머리줄 ✕ 앞에 놓는다. */
  actions: ReactNode;
  onFocus(): void;
  onClose(): void;
  onToggleZoom(): void;
  onDragStart(event: DragEvent<HTMLElement>): void;
}

interface MirrorGridProps {
  view: RemoteMirrorView;
  /** 호스트가 지금 보는 곳의 이름 — 폴더·worktree·선반. */
  placeLabel: string;
  sessions: readonly RemoteSessionSummary[];
  disabled: boolean;
  onView(action: RemoteViewAction): void;
  /** 빈 칸의 "새 세션". 호스트가 보는 곳을 골라 둔 새 세션 폼을 연다. */
  onNewSession?(): void;
  renderPane(props: MirrorPaneProps): ReactNode;
}

/** 호스트 메인 창의 시작 화면과 같은 모양의 안내. */
function MirrorEmpty({ text }: { text: string }) {
  return (
    <div className="m-terminal-empty">
      <span className="m-empty-glyph" aria-hidden="true">
        <span>&gt;_</span>
      </span>
      <p>{text}</p>
    </div>
  );
}

/**
 * 호스트 메인 창의 그리드를 그대로 그린다: 같은 레이아웃·칸·페이지·포커스·확대. 바꾸는 조작은 모두
 * 호스트에 요청으로 보내고, 결과는 다음 mirror로 돌아온다 — 이 화면은 자기 배치를 갖지 않는다.
 */
export function MirrorGrid({ view, placeLabel, sessions, disabled, onView, onNewSession, renderPane }: MirrorGridProps) {
  const layout = buildLayout(view.columnRows.length > 0 ? view.columnRows : [1]);
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const onGrid = view.place.kind !== "other";
  const filled = view.slots.filter((slot) => slot !== null).length;
  // 확대는 그 칸이 이 페이지에 있을 때만 — 호스트도 같다.
  const zoomedId = view.slots.some((slot) => slot !== null && slot.id === view.zoomedPaneId) ? view.zoomedPaneId : null;

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

  // 빈 칸에는 두지 않는다 — 호스트도 패인 머리줄에만 둔다.
  const columnActions = (slot: number) => {
    const column = columnOfSlot(layout.columnRows, slot);
    if (!column || zoomedId !== null) return null;
    return column.rows > 1 ? (
      <button
        type="button"
        className="m-icon-button"
        aria-label="열 합치기"
        title="열 합치기"
        disabled={disabled}
        onClick={() => onView({ action: "merge", slot })}
      >
        <Square size={13} />
      </button>
    ) : canSplitColumn(layout, slot) ? (
      <button
        type="button"
        className="m-icon-button"
        aria-label="열 나누기"
        title="열 나누기"
        disabled={disabled}
        onClick={() => onView({ action: "split", slot })}
      >
        <SquareSplitVertical size={13} />
      </button>
    ) : null;
  };

  const startDrag = (paneId: string) => (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.setData(MIRROR_PANE_DRAG_TYPE, paneId);
    event.dataTransfer.effectAllowed = "move";
  };

  /** 확대 중이면 그 칸이 그리드 전체를 쓰고, 나머지는 붙은 채로 숨는다 — 터미널을 다시 붙이지 않게. */
  const slotStyle = (index: number, id: string | null) =>
    zoomedId === null ? { gridArea: `s${index + 1}` } : id === zoomedId ? { gridArea: "1 / 1 / -1 / -1" } : undefined;
  const slotClass = (id: string | null, ...extra: string[]) =>
    ["m-mirror-slot", zoomedId !== null && id !== zoomedId ? "m-parked" : "", ...extra].filter(Boolean).join(" ");

  return (
    <section className="m-mirror" aria-label="호스트 화면">
      <div className="m-mirror-bar">
        <span className="m-mirror-place" title={placeLabel}>
          {placeLabel}
        </span>
        {onGrid && view.pages > 1 ? (
          <span className="m-mirror-pages" role="group" aria-label="페이지">
            <button
              type="button"
              className="m-icon-button"
              aria-label="이전 페이지"
              disabled={disabled || view.page === 0}
              onClick={() => onView({ action: "page", page: view.page - 1 })}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              {view.page + 1} / {view.pages}
            </span>
            <button
              type="button"
              className="m-icon-button"
              aria-label="다음 페이지"
              disabled={disabled || view.page >= view.pages - 1}
              onClick={() => onView({ action: "page", page: view.page + 1 })}
            >
              <ChevronRight size={15} />
            </button>
          </span>
        ) : null}
        {onGrid ? (
          <LayoutPicker
            layoutId={view.layoutId}
            paneCount={filled}
            onSelect={(layoutId) => {
              if (!disabled) onView({ action: "layout", layoutId });
            }}
          />
        ) : null}
      </div>
      {!onGrid ? (
        <MirrorEmpty text="호스트가 그리드가 아닌 화면을 보고 있습니다. 왼쪽에서 폴더를 고르세요" />
      ) : view.slots.length === 0 ? (
        <MirrorEmpty text="이 곳에 열린 세션이 없습니다" />
      ) : (
        <div
          className="m-grid m-mirror-grid"
          data-zoomed={zoomedId !== null ? "true" : undefined}
          data-slots={view.slots.length}
          style={
            zoomedId === null
              ? // minmax(0, …) — 터미널 내용 폭이 칸을 밀어 창이 가로로 넘치지 않게.
                {
                  gridTemplateColumns: layout.columns.replaceAll("1fr", "minmax(0, 1fr)"),
                  gridTemplateRows: layout.rows.replaceAll("1fr", "minmax(0, 1fr)"),
                  gridTemplateAreas: layout.areas,
                }
              : { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr)" }
          }
        >
          {view.slots.map((slot, index) => {
            const focused = slot !== null && slot.id === view.focusedPaneId;
            const session = slot?.kind === "session" ? byId.get(slot.id) : undefined;
            if (slot && session) {
              return (
                <div key={slot.id} className={slotClass(slot.id)} style={slotStyle(index, slot.id)} {...dropTarget(index)}>
                  {renderPane({
                    session,
                    slot: index,
                    focused,
                    zoomed: slot.id === zoomedId,
                    actions: columnActions(index),
                    onFocus: () => onView({ action: "focus", paneId: slot.id }),
                    onClose: () => onView({ action: "close", slot: index, paneId: slot.id }),
                    onToggleZoom: () => onView({ action: "zoom", paneId: slot.id === zoomedId ? null : slot.id }),
                    onDragStart: startDrag(slot.id),
                  })}
                </div>
              );
            }
            if (slot === null) {
              return (
                <div
                  key={`empty-${index}`}
                  className={slotClass(null, "m-slot-empty")}
                  style={slotStyle(index, null)}
                  aria-label="빈 칸"
                  {...dropTarget(index)}
                >
                  <span className="m-slot-number">{index + 1}</span>
                  {onNewSession ? (
                    <button type="button" className="m-slot-new" disabled={disabled} onClick={onNewSession}>
                      <Plus size={14} aria-hidden="true" /> 새 세션
                    </button>
                  ) : null}
                  <span>세션을 끌어다 놓기</span>
                </div>
              );
            }
            const label = slot.kind === "document" ? slot.label : "세션을 불러오는 중…";
            return (
              <div
                key={slot.id}
                className={slotClass(slot.id, "m-pane", "m-mirror-placeholder", focused ? "m-pane-focused" : "")}
                style={slotStyle(index, slot.id)}
                {...dropTarget(index)}
              >
                <header className="m-bar" draggable onDragStart={startDrag(slot.id)}>
                  {slot.kind === "document" ? <FileText size={14} aria-hidden="true" /> : null}
                  <h1 title={label}>{label}</h1>
                  <span className="m-pane-actions">
                    {columnActions(index)}
                    <button
                      type="button"
                      className="m-icon-button"
                      aria-label={`${slot.kind === "document" ? `호스트에서 열린 문서: ${label}` : label} 칸 닫기`}
                      title="칸 닫기"
                      disabled={disabled}
                      onClick={() => onView({ action: "close", slot: index, paneId: slot.id })}
                    >
                      <X size={13} />
                    </button>
                  </span>
                </header>
                <MirrorEmpty text={slot.kind === "document" ? "호스트에서 열린 문서는 여기서 보이지 않습니다" : label} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
