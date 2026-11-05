import { useState } from "react";
import { CircleStop, Copy, Monitor, Pencil, RotateCcw, Trash2, Type } from "lucide-react";
import { REMOTE_SESSION_NAME_MAX, type RemoteSessionSummary } from "@shared/remote-types";
import { statusLabels } from "../session-labels";
import type { AutoFitState } from "./auto-fit";
import { BottomSheet } from "./BottomSheet";

interface SessionMenuProps {
  session: RemoteSessionSummary;
  /** 터미널 크기 맞춤 상태 — host면 "PC 크기 유지"가 켜져 있다. */
  fitState: AutoFitState;
  onKeepHost(on: boolean): void;
  fontSize: number;
  onFont(step: -1 | 1): void;
  canShrink: boolean;
  canGrow: boolean;
  /** 있으면 이름을 바꿀 수 있다. 빈 이름은 붙인 이름을 지운다. */
  onRename?(name: string): void;
  onStop(): void;
  onResume(): void;
  onRemove(): void;
  onClose(): void;
}

/** http 출처(LAN)에는 navigator.clipboard가 없어서 고른 글을 복사하는 옛 방법도 쓴다. */
function copyText(text: string): boolean {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => undefined);
    return true;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

/**
 * 폰 세션 화면의 ⋯ 메뉴. 자주 쓰지 않는 조작을 화면 줄에서 빼 이 시트에 모은다 — 세로 공간은 터미널 몫이다.
 */
export function SessionMenu({
  session,
  fitState,
  onKeepHost,
  fontSize,
  onFont,
  canShrink,
  canGrow,
  onRename,
  onStop,
  onResume,
  onRemove,
  onClose,
}: SessionMenuProps) {
  const running = session.status !== "exited" && session.status !== "error";
  const keepHost = fitState === "host";
  const [renaming, setRenaming] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  return (
    <BottomSheet label="세션 메뉴" onClose={onClose}>
      <header className="m-sheet-head">
        <span className={`m-dot m-dot-${session.status}`} aria-hidden="true" />
        <div className="m-sheet-head-text">
          <h2 className="m-sheet-title">{session.label}</h2>
          <p className="m-sheet-sub">
            <span className={`m-status-${session.status}`}>{statusLabels[session.status]}</span> · {session.kind}
            {session.cwd ? <span className="m-sheet-path"> · {session.cwd}</span> : null}
          </p>
        </div>
      </header>

      <section className="m-sheet-section" aria-label="보기">
        <h3 className="m-sheet-label">보기</h3>
        <button
          type="button"
          className="m-sheet-item"
          role="switch"
          aria-checked={keepHost}
          onClick={() => onKeepHost(!keepHost)}
        >
          <Monitor size={20} aria-hidden="true" />
          <span className="m-sheet-item-text">
            PC 크기 유지
            <small>켜면 PC 열 수 그대로 그리고 옆으로 밀어 봅니다 · 끄면 이 화면에 맞춥니다</small>
          </span>
          <span className={keepHost ? "m-switch on" : "m-switch"} aria-hidden="true" />
        </button>
        <div className="m-sheet-item">
          <Type size={20} aria-hidden="true" />
          <span className="m-sheet-item-text">글자 크기</span>
          <span className="m-stepper">
            <button type="button" aria-label="글자 작게" disabled={!canShrink} onClick={() => onFont(-1)}>
              −
            </button>
            <output aria-live="polite">{fontSize}px</output>
            <button type="button" aria-label="글자 크게" disabled={!canGrow} onClick={() => onFont(1)}>
              +
            </button>
          </span>
        </div>
      </section>

      <section className="m-sheet-section" aria-label="세션">
        <h3 className="m-sheet-label">세션</h3>
        {onRename ? (
          renaming === null ? (
            <button type="button" className="m-sheet-item" onClick={() => setRenaming(session.label)}>
              <Pencil size={20} aria-hidden="true" />
              <span className="m-sheet-item-text">이름 바꾸기</span>
            </button>
          ) : (
            <form
              className="m-sheet-rename"
              onSubmit={(event) => {
                event.preventDefault();
                // 그대로 두고 저장하면 바꾸지 않는다 — 자동 제목을 붙인 이름으로 굳히지 않게.
                if (renaming.trim() !== session.label) onRename(renaming.trim());
                setRenaming(null);
              }}
            >
              <input
                aria-label="세션 이름"
                autoFocus
                maxLength={REMOTE_SESSION_NAME_MAX}
                value={renaming}
                onChange={(event) => setRenaming(event.target.value)}
              />
              <button type="button" onClick={() => setRenaming(null)}>
                취소
              </button>
              <button type="submit" className="m-primary-button">
                저장
              </button>
            </form>
          )
        ) : null}
        {session.cwd ? (
          <button type="button" className="m-sheet-item" onClick={() => setCopied(copyText(session.cwd!))}>
            <Copy size={20} aria-hidden="true" />
            <span className="m-sheet-item-text">
              경로 복사
              {copied === null ? null : <small role="status">{copied ? "복사했습니다" : "복사하지 못했습니다"}</small>}
            </span>
          </button>
        ) : null}
        {running ? (
          <button type="button" className="m-sheet-item" onClick={onStop}>
            <CircleStop size={20} aria-hidden="true" />
            <span className="m-sheet-item-text">중지</span>
          </button>
        ) : (
          <button type="button" className="m-sheet-item" onClick={onResume}>
            <RotateCcw size={20} aria-hidden="true" />
            <span className="m-sheet-item-text">재시작</span>
          </button>
        )}
      </section>

      <section className="m-sheet-section" aria-label="삭제">
        <button
          type="button"
          className="m-sheet-item m-sheet-danger"
          aria-expanded={confirmingRemove}
          onClick={() => setConfirmingRemove(true)}
        >
          <Trash2 size={20} aria-hidden="true" />
          <span className="m-sheet-item-text">
            삭제
            <small>스크롤백까지 지웁니다</small>
          </span>
        </button>
        {confirmingRemove ? (
          <div className="m-sheet-confirm">
            <button type="button" onClick={() => setConfirmingRemove(false)}>
              취소
            </button>
            <button type="button" className="m-danger-button" onClick={onRemove}>
              정말 삭제
            </button>
          </div>
        ) : null}
      </section>
    </BottomSheet>
  );
}
