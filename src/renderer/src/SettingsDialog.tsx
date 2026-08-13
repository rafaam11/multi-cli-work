import { useEffect, useState } from "react";
import type { AppSettings, AppSettingsPatch, NotifiableStatus } from "@shared/settings-types";
import {
  TERMINAL_FONT_SIZE_RANGE,
  TERMINAL_LINE_HEIGHT_RANGE,
  TERMINAL_SCROLLBACK_RANGE,
} from "@shared/settings-types";
import {
  KEYMAP_ACTIONS,
  KEYMAP_CATEGORY_ORDER,
  effectiveAccelerator,
  findConflict,
  isBindableAccelerator,
  normalizeKeyEvent,
  type KeymapAction,
} from "./keymap";

type SettingsTab = "general" | "terminal" | "notifications" | "keybindings";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "일반" },
  { id: "terminal", label: "터미널" },
  { id: "notifications", label: "알림" },
  { id: "keybindings", label: "단축키" },
];

const STATUS_LABELS: Array<{ status: NotifiableStatus; label: string }> = [
  { status: "awaiting-input", label: "입력 대기" },
  { status: "awaiting-approval", label: "승인 대기" },
  { status: "exited", label: "종료" },
  { status: "error", label: "오류" },
];

interface SettingsDialogProps {
  settings: AppSettings;
  onClose(): void;
}

/**
 * 저장 버튼이 없는 즉시 적용 폼. 컨트롤 변경 → settings:update → settings:changed 브로드캐스트로
 * App의 사본이 갱신되어 되돌아온다 — 이 다이얼로그 자신도 그 사본을 props로 받는다.
 */
export function SettingsDialog({ settings, onClose }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [error, setError] = useState<string | null>(null);
  const [capturingActionId, setCapturingActionId] = useState<string | null>(null);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ actionId: string; accelerator: string; existing: KeymapAction } | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const update = (patch: AppSettingsPatch) => {
    setError(null);
    window.multiCliWork.settings.update(patch).catch(() => setError("설정 저장에 실패했습니다"));
  };

  /** 기본값과 같은 값은 오버라이드가 아니다 — 지워서 미래의 기본 키맵 변경을 따라가게 한다. */
  const withBinding = (
    overrides: Record<string, string | null>,
    actionId: string,
    accelerator: string | null,
  ): Record<string, string | null> => {
    const catalog = KEYMAP_ACTIONS.find((candidate) => candidate.id === actionId);
    const next = { ...overrides };
    if (!catalog || accelerator === catalog.defaultAccelerator) delete next[actionId];
    else next[actionId] = accelerator;
    return next;
  };

  const applyBinding = (actionId: string, accelerator: string | null) => {
    update({ keybindings: withBinding(settings.keybindings, actionId, accelerator) });
  };

  useEffect(() => {
    if (!capturingActionId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturingActionId(null);
        setCaptureNotice(null);
        return;
      }
      const accelerator = normalizeKeyEvent(event);
      if (!accelerator) return; // 수식어 단독 — 계속 기다린다
      if (!isBindableAccelerator(accelerator)) {
        setCaptureNotice("수식어 없는 단독 키는 터미널 입력과 충돌합니다 (F1~F12 제외)");
        return; // 계속 캡처
      }
      const existing = findConflict(accelerator, settings.keybindings, capturingActionId);
      if (existing?.fixed) {
        setCaptureNotice(`${accelerator}는 ${existing.label}의 고정 키입니다`);
        return;
      }
      setCapturingActionId(null);
      setCaptureNotice(null);
      if (existing) {
        setConflict({ actionId: capturingActionId, accelerator, existing });
        return;
      }
      applyBinding(capturingActionId, accelerator);
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [capturingActionId, settings.keybindings]);

  const numberField = (
    label: string,
    id: string,
    value: number,
    range: { min: number; max: number },
    step: number,
    apply: (next: number) => AppSettingsPatch,
  ) => (
    <div className="settings-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={range.min}
        max={range.max}
        step={step}
        defaultValue={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next) && next >= range.min && next <= range.max) update(apply(next));
        }}
      />
    </div>
  );

  const checkboxRow = (label: string, id: string, checked: boolean, apply: (next: boolean) => AppSettingsPatch) => (
    <div className="settings-row">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => update(apply(event.target.checked))} />
    </div>
  );

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="confirm-dialog settings-dialog" role="dialog" aria-modal="true" aria-label="설정">
        <nav className="settings-nav" aria-label="설정 분류">
          {TABS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={tab === candidate.id ? "active" : ""}
              onClick={() => setTab(candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {tab === "general" ? (
            <>
              <h2>일반</h2>
              <div className="settings-row">
                <label htmlFor="settings-language">언어</label>
                <select
                  id="settings-language"
                  value={settings.language}
                  onChange={(event) => update({ language: event.target.value as AppSettings["language"] })}
                >
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                </select>
              </div>
              <p className="settings-hint">언어 선택은 다음 버전에서 적용됩니다.</p>
              {checkboxRow("창을 닫으면 트레이에 남기기", "settings-close-to-tray", settings.general.closeToTray, (next) => ({
                general: { closeToTray: next },
              }))}
              {checkboxRow(
                "시작 시 이전 세션 자동 재개",
                "settings-auto-resume",
                settings.general.autoResumeSessions,
                (next) => ({ general: { autoResumeSessions: next } }),
              )}
              {checkboxRow(
                "시작 시 업데이트 자동 확인",
                "settings-auto-updates",
                settings.general.autoCheckUpdates,
                (next) => ({ general: { autoCheckUpdates: next } }),
              )}
            </>
          ) : null}
          {tab === "terminal" ? (
            <>
              <h2>터미널</h2>
              <p className="settings-hint">살아있는 모든 세션에 즉시 반영됩니다.</p>
              <div className="settings-row">
                <label htmlFor="settings-font-family">글꼴</label>
                <input
                  id="settings-font-family"
                  type="text"
                  defaultValue={settings.terminal.fontFamily}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next.length > 0 && next !== settings.terminal.fontFamily) update({ terminal: { fontFamily: next } });
                  }}
                />
              </div>
              {numberField("글꼴 크기", "settings-font-size", settings.terminal.fontSize, TERMINAL_FONT_SIZE_RANGE, 1, (next) => ({
                terminal: { fontSize: next },
              }))}
              {numberField("행간", "settings-line-height", settings.terminal.lineHeight, TERMINAL_LINE_HEIGHT_RANGE, 0.05, (next) => ({
                terminal: { lineHeight: next },
              }))}
              {numberField(
                "스크롤백(줄)",
                "settings-scrollback",
                settings.terminal.scrollback,
                TERMINAL_SCROLLBACK_RANGE,
                1_000,
                (next) => ({ terminal: { scrollback: Math.floor(next) } }),
              )}
              <div className="settings-row">
                <label htmlFor="settings-cursor-style">커서 스타일</label>
                <select
                  id="settings-cursor-style"
                  value={settings.terminal.cursorStyle}
                  onChange={(event) =>
                    update({ terminal: { cursorStyle: event.target.value as AppSettings["terminal"]["cursorStyle"] } })
                  }
                >
                  <option value="bar">bar</option>
                  <option value="block">block</option>
                  <option value="underline">underline</option>
                </select>
              </div>
              {checkboxRow("커서 깜빡임", "settings-cursor-blink", settings.terminal.cursorBlink, (next) => ({
                terminal: { cursorBlink: next },
              }))}
            </>
          ) : null}
          {tab === "notifications" ? (
            <>
              <h2>알림</h2>
              <p className="settings-hint">배지와 트레이 표시는 이 설정과 무관하게 동작합니다.</p>
              {checkboxRow("데스크톱 알림", "settings-desktop-notifications", settings.notifications.desktop, (next) => ({
                notifications: { desktop: next },
              }))}
              {STATUS_LABELS.map(({ status, label }) => (
                <div key={status}>
                  {checkboxRow(label, `settings-notify-${status}`, settings.notifications.statuses[status], (next) => ({
                    notifications: { statuses: { [status]: next } },
                  }))}
                </div>
              ))}
            </>
          ) : null}
          {tab === "keybindings" ? (
            <>
              <h2>단축키</h2>
              <p className="settings-hint">키를 클릭해 새 조합을 누르세요. 수식어 없는 단독 키는 쓸 수 없습니다.</p>
              {KEYMAP_CATEGORY_ORDER.map((category) => (
                <section key={category}>
                  <h3 className="settings-key-category">{category}</h3>
                  {KEYMAP_ACTIONS.filter((candidate) => candidate.category === category).map((candidate) => {
                    const accelerator = effectiveAccelerator(candidate.id, settings.keybindings);
                    const capturing = capturingActionId === candidate.id;
                    return (
                      <div className="settings-row settings-key-row" key={candidate.id}>
                        <span className="settings-key-label">{candidate.label}</span>
                        <span className="settings-key-controls">
                          <span
                            className={`settings-key ${capturing ? "capturing" : ""}`}
                            {...(capturing ? { "data-key-capture": "true" } : {})}
                          >
                            {capturing ? "키를 누르세요…" : accelerator ?? "없음"}
                          </span>
                          {candidate.fixed ? (
                            <span className="settings-key-fixed">고정</span>
                          ) : (
                            <>
                              <button type="button" onClick={() => { setCapturingActionId(candidate.id); setCaptureNotice(null); }}>
                                키 변경
                              </button>
                              <button
                                type="button"
                                disabled={settings.keybindings[candidate.id] === undefined}
                                onClick={() => applyBinding(candidate.id, candidate.defaultAccelerator)}
                              >
                                기본값으로
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </section>
              ))}
              {captureNotice ? <p className="settings-error" role="alert">{captureNotice}</p> : null}
              {conflict ? (
                <div className="settings-conflict" role="alertdialog" aria-label="단축키 충돌">
                  <p>
                    {conflict.accelerator}는 이미 &quot;{conflict.existing.label}&quot;이 사용합니다. 기존 바인딩을 해제할까요?
                  </p>
                  <div className="confirm-dialog-actions">
                    <button type="button" onClick={() => setConflict(null)}>취소</button>
                    <button
                      type="button"
                      onClick={() => {
                        const cleared = withBinding(settings.keybindings, conflict.existing.id, null);
                        update({ keybindings: withBinding(cleared, conflict.actionId, conflict.accelerator) });
                        setConflict(null);
                      }}
                    >
                      기존 바인딩 해제
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="settings-row">
                <span />
                <button type="button" onClick={() => update({ keybindings: {} })}>모두 초기화</button>
              </div>
            </>
          ) : null}
          {error ? <p className="settings-error" role="alert">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
