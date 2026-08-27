import { useEffect, useState } from "react";
import type { NotionTokenStatus } from "@shared/notion-types";
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
import { publishNotionTokenStatus } from "./notion-token-status";

type SettingsTab = "general" | "terminal" | "notifications" | "notion" | "keybindings";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "일반" },
  { id: "terminal", label: "터미널" },
  { id: "notifications", label: "알림" },
  { id: "notion", label: "노션" },
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

/** Electron이 invoke 실패에 덧붙이는 접두어를 걷어내 메인 프로세스가 낸 사유만 보인다. */
function ipcReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const match = /Error invoking remote method '[^']+': (?:Error: )?([\s\S]*)$/.exec(raw);
  return match ? match[1] : raw;
}

/**
 * 노션 탭만 AppSettings를 쓰지 않는다 — 통합 토큰은 시크릿이라 평문 settings.json이 아니라
 * 메인 프로세스의 암호화 저장소에 있고, 렌더러는 설정 여부만 알 수 있다.
 */
function NotionSettings() {
  const [status, setStatus] = useState<NotionTokenStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.multiCliWork.notion
      .status()
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch((cause: unknown) => {
        if (alive) setError(ipcReason(cause));
      });
    return () => {
      alive = false;
    };
  }, []);

  const run = (action: () => Promise<NotionTokenStatus>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    action()
      .then((next) => {
        setStatus(next);
        setToken("");
        setNotice(done);
        // 열려 있는 업무 프로젝트 상세 페이지가 곧바로 조회를 시작할 수 있게 알린다.
        publishNotionTokenStatus(next);
      })
      .catch((cause: unknown) => setError(ipcReason(cause)))
      .finally(() => setBusy(false));
  };

  const trimmed = token.trim();
  const encryptionAvailable = status?.encryptionAvailable !== false;

  return (
    <>
      <h2>노션</h2>
      <p className="settings-hint">
        통합 토큰이 있으면 업무 프로젝트의 노션 링크에서 제목을 자동으로 가져오고, 그 링크를 노션 MCP가
        읽을 수 있는지도 함께 확인합니다.
      </p>
      <div className="settings-row">
        <span>상태</span>
        <span>{status === null ? "확인 중…" : status.configured ? "연결됨" : "설정되지 않음"}</span>
      </div>
      <div className="settings-row">
        <label htmlFor="settings-notion-token">통합 토큰</label>
        <input
          id="settings-notion-token"
          type="password"
          autoComplete="off"
          placeholder={status?.configured ? "저장됨 — 바꾸려면 새 토큰을 붙여넣으세요" : "ntn_…"}
          value={token}
          disabled={busy || !encryptionAvailable}
          onChange={(event) => setToken(event.target.value)}
        />
      </div>
      <div className="settings-row">
        <span />
        <span className="settings-key-controls">
          <button
            type="button"
            disabled={busy || trimmed.length === 0 || !encryptionAvailable}
            onClick={() => run(() => window.multiCliWork.notion.setToken(trimmed), "토큰을 저장했습니다")}
          >
            저장
          </button>
          <button
            type="button"
            disabled={busy || status?.configured !== true}
            onClick={() => run(() => window.multiCliWork.notion.clearToken(), "토큰을 제거했습니다")}
          >
            제거
          </button>
        </span>
      </div>
      {encryptionAvailable ? null : (
        <p className="settings-error" role="alert">
          이 환경에서는 토큰을 안전하게 저장할 수 없어 입력을 막았습니다 (OS 키체인 사용 불가).
        </p>
      )}
      <p className="settings-hint">
        토큰은 notion.so/my-integrations에서 내부 통합을 만들면 발급됩니다. 토큰만으로는 부족하고,
        조회할 페이지마다 노션에서 &quot;연결&quot;에 그 통합을 추가해야 제목이 읽힙니다.
      </p>
      {notice ? (
        <p className="settings-hint" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
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
          {tab === "notion" ? <NotionSettings /> : null}
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
