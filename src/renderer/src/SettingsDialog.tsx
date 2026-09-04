import { useEffect, useRef, useState } from "react";
import type { NotionTokenStatus } from "@shared/notion-types";
import type {
  AppSettings,
  AppSettingsPatch,
  NotifiableStatus,
  ProjectCategorySetting,
  ProjectSettings,
} from "@shared/settings-types";
import {
  MAX_CATEGORY_NAME_LENGTH,
  TERMINAL_FONT_SIZE_RANGE,
  TERMINAL_LINE_HEIGHT_RANGE,
  TERMINAL_SCROLLBACK_RANGE,
} from "@shared/settings-types";
import { ACCENT_COLOR_COUNT, ACCENT_INDEXES, accentClass } from "@shared/accent-palette";
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
import type { WorkspaceSnapshot } from "@shared/workspace-types";

type SettingsTab = "general" | "terminal" | "notifications" | "projects" | "workspace" | "notion" | "keybindings";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "일반" },
  { id: "terminal", label: "터미널" },
  { id: "notifications", label: "알림" },
  { id: "projects", label: "프로젝트" },
  { id: "workspace", label: "워크스페이스" },
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
 * ws-root 워크스페이스 루트. 노션 탭과 마찬가지로 AppSettings를 쓰지 않는다 — 루트 목록은
 * `~/.multi-cli-work/workspace.json`에 따로 살고(레지스트리 계약 §8), 여기서는 그 파일을 다루는
 * IPC만 부른다. 루트를 하나도 등록하지 않으면 사이드바는 이 기능이 없던 때와 똑같이 그려진다.
 */
function WorkspaceSettings() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.multiCliWork.workspace
      .list()
      .then((next) => {
        if (alive) setSnapshot(next);
      })
      .catch((cause: unknown) => {
        if (alive) setError(ipcReason(cause));
      });
    return () => {
      alive = false;
    };
  }, []);

  const run = (action: () => Promise<WorkspaceSnapshot | null>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    action()
      .then((next) => {
        // null은 사용자가 폴더 대화상자를 닫은 것 — 알릴 일이 아니다.
        if (!next) return;
        setSnapshot(next);
        setNotice(done);
      })
      .catch((cause: unknown) => setError(ipcReason(cause)))
      .finally(() => setBusy(false));
  };

  const roots = snapshot?.registry.roots ?? [];
  const shellsOf = (work: string) => (snapshot?.shells ?? []).filter((shell) => shell.root === work).length;

  return (
    <>
      <h2>워크스페이스 루트</h2>
      <p className="settings-hint">
        채널·프로젝트 셸·<code>dev/</code> 레포가 사는 폴더입니다. 등록하면 사이드바가 레포를 소속
        셸 아래로 묶고, 세션 브리프에 형제 레포·데이터셋 경로가 붙습니다. 워크스페이스의 파일은
        읽기만 합니다.
      </p>
      {snapshot === null ? (
        <p className="settings-hint">확인 중…</p>
      ) : roots.length === 0 ? (
        <p className="settings-hint">등록된 루트가 없습니다 — 사이드바는 지금까지와 똑같이 동작합니다.</p>
      ) : (
        <ul className="settings-list">
          {roots.map((root) => (
            <li key={root.work} className="settings-row">
              <span className="settings-list-copy">
                <strong>{root.label}</strong>
                <span title={root.work}>{root.work}</span>
                {/* 세 루트를 다 보여 준다 — 어디가 dev·data로 잡혔는지가 이 화면의 요점이다. */}
                <span className="settings-hint">
                  dev {root.dev} · data {root.data} · 셸 {shellsOf(root.work)}개
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    async () => (await window.multiCliWork.workspace.remove(root.work)).workspace,
                    `${root.label}을(를) 목록에서 뺐습니다`,
                  )
                }
              >
                제거
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="settings-row">
        <span />
        <span className="settings-key-controls">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => (await window.multiCliWork.workspace.add())?.workspace ?? null, "루트를 등록했습니다")
            }
          >
            루트 추가
          </button>
          <button
            type="button"
            disabled={busy || roots.length === 0}
            onClick={() =>
              run(async () => (await window.multiCliWork.workspace.sync()).workspace, "셸을 다시 읽었습니다")
            }
          >
            다시 읽기
          </button>
        </span>
      </div>
      <p className="settings-hint">
        제거는 목록에서만 뺍니다 — 디스크의 폴더도, 이미 만들어진 업무 프로젝트도 그대로 남습니다.
      </p>
      {snapshot && snapshot.warnings.length > 0 ? (
        <ul className="settings-list" aria-label="워크스페이스 경고">
          {snapshot.warnings.map((warning) => (
            <li key={warning} className="settings-hint">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
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
 * 구분 목록·기본 구분 편집. 다른 즉시 저장 탭과 달리 목록 자체(순서·존재 여부)가 편집 대상이라
 * `settings.projects`를 그대로 렌더하지 않고 로컬 사본을 든다 — 이 다이얼로그는 저장 왕복 후에도
 * 같은 `settings` prop을 받을 수 있어(테스트가 그렇듯), 화면이 자기 손으로 만든 값을 스스로
 * 신뢰해야 다음 조작(순서 변경 뒤 삭제 등)이 최신 목록을 대상으로 한다. `onChange`가 실제 저장을
 * 맡고, 이 컴포넌트는 "지금 화면이 뭘 보여줄지"만 안다.
 */
function ProjectsSettings({
  projects,
  onChange,
}: {
  projects: ProjectSettings;
  onChange(next: AppSettingsPatch["projects"]): void;
}) {
  const [categories, setCategories] = useState<ProjectCategorySetting[]>(projects.categories);
  // 이름 입력의 타이핑 중 값 — blur까지는 categories(=이미 저장된 값)와 분리해 둔다.
  const [drafts, setDrafts] = useState<string[]>(() => projects.categories.map((category) => category.name));
  const [defaultCategory, setDefaultCategory] = useState(projects.defaultCategory);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (pendingFocusIndex === null) return;
    inputRefs.current[pendingFocusIndex]?.focus();
    setPendingFocusIndex(null);
  }, [pendingFocusIndex]);

  /**
   * 목록을 바꾸는 모든 동작(색·순서·추가·삭제·이름 커밋)이 지나는 한 곳 — 로컬 사본과 드래프트를
   * 함께 새 목록에 맞추고서야 저장을 보낸다.
   *
   * 기본 구분이 살아남으면 목록만 보낸다. 기본 구분이 사라졌는데 `renamedTo`가 있으면(이름 바꾸기가
   * 하필 기본 구분 행이었던 경우) 파서가 조용히 첫 항목으로 되돌리는 놀라움을 피하려고 같은 패치에
   * 새 이름을 함께 보낸다. `renamedTo`가 없으면(삭제) 브리핑 계약대로 목록만 보내고 — 화면과 select만
   * 파서가 낼 결과(첫 항목)에 미리 맞춰 둔다.
   */
  const applyCategories = (next: ProjectCategorySetting[], renamedTo?: string) => {
    setCategories(next);
    setDrafts(next.map((category) => category.name));

    if (next.some((category) => category.name === defaultCategory)) {
      onChange({ categories: next });
      return;
    }
    if (renamedTo !== undefined) {
      setDefaultCategory(renamedTo);
      onChange({ categories: next, defaultCategory: renamedTo });
      return;
    }
    setDefaultCategory(next[0]!.name);
    onChange({ categories: next });
  };

  const changeColor = (index: number, color: number) => {
    applyCategories(categories.map((category, at) => (at === index ? { ...category, color } : category)));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...categories];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    applyCategories(next);
  };

  const moveDown = (index: number) => {
    if (index === categories.length - 1) return;
    const next = [...categories];
    [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
    applyCategories(next);
  };

  const removeCategory = (index: number) => {
    if (categories.length <= 1) return;
    applyCategories(categories.filter((_, at) => at !== index));
  };

  const addCategory = () => {
    const taken = new Set(categories.map((category) => category.name));
    let candidate = "새 구분";
    for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `새 구분 ${suffix}`;
    const color = (categories.length % ACCENT_COLOR_COUNT) + 1;
    const next = [...categories, { name: candidate, color }];
    applyCategories(next);
    setPendingFocusIndex(next.length - 1);
  };

  const commitName = (index: number) => {
    const original = categories[index]!.name;
    const trimmed = (drafts[index] ?? "").trim();
    if (trimmed.length === 0 || trimmed === original) {
      setDrafts((current) => current.map((draft, at) => (at === index ? original : draft)));
      return;
    }
    applyCategories(
      categories.map((category, at) => (at === index ? { ...category, name: trimmed } : category)),
      trimmed,
    );
  };

  const changeDefault = (name: string) => {
    setDefaultCategory(name);
    onChange({ defaultCategory: name });
  };

  return (
    <>
      <h2>프로젝트 구분</h2>
      <p className="settings-hint">
        업무 프로젝트의 구분입니다. 사이드바 레일, 홈 카드, 상세 페이지 칩의 색을 정합니다.
      </p>
      <ul className="settings-list" aria-label="구분 목록">
        {categories.map((category, index) => (
          <li key={index} className="settings-row settings-category-row">
            <input
              type="text"
              aria-label={`구분 ${index + 1} 이름`}
              maxLength={MAX_CATEGORY_NAME_LENGTH}
              value={drafts[index] ?? category.name}
              ref={(element) => {
                inputRefs.current[index] = element;
              }}
              onChange={(event) => {
                const value = event.target.value;
                setDrafts((current) => current.map((draft, at) => (at === index ? value : draft)));
              }}
              onBlur={() => commitName(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur();
              }}
            />
            <span role="radiogroup" aria-label={`${category.name} 색`} className="settings-swatches">
              {ACCENT_INDEXES.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={category.color === n}
                  aria-label={`색 ${n}`}
                  className={`settings-swatch ${accentClass(n)}${category.color === n ? " selected" : ""}`}
                  onClick={() => changeColor(index, n)}
                />
              ))}
            </span>
            <span className="settings-key-controls">
              <button type="button" disabled={index === 0} onClick={() => moveUp(index)}>
                {`${category.name} 위로`}
              </button>
              <button type="button" disabled={index === categories.length - 1} onClick={() => moveDown(index)}>
                {`${category.name} 아래로`}
              </button>
              <button type="button" disabled={categories.length === 1} onClick={() => removeCategory(index)}>
                {`${category.name} 삭제`}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="settings-row">
        <span />
        <span className="settings-key-controls">
          <button type="button" onClick={addCategory}>
            구분 추가
          </button>
        </span>
      </div>
      <div className="settings-row">
        <label htmlFor="settings-default-category">기본 구분</label>
        <select
          id="settings-default-category"
          value={defaultCategory}
          onChange={(event) => changeDefault(event.target.value)}
        >
          {categories.map((category) => (
            <option key={category.name} value={category.name}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-hint">
        새로 만들어지는 업무 프로젝트가 받는 구분입니다. 이미 있는 프로젝트의 구분은 바뀌지 않습니다. 이름을
        바꿔도 마찬가지입니다 — 목록에서 빠진 구분은 회색으로 보이고, 상세 페이지에서 다시 고를 수 있습니다.
      </p>
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
          {tab === "projects" ? (
            <ProjectsSettings projects={settings.projects} onChange={(next) => update({ projects: next })} />
          ) : null}
          {tab === "workspace" ? <WorkspaceSettings /> : null}
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
