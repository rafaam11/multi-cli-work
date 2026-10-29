import { useEffect, useRef, useState, type ReactNode } from "react";
import { isCategoryCode, sortCategoriesByCode } from "@shared/category-code";
import { DRIVE_KINDS, driveKindLabel, inferDriveKind } from "@shared/drive-kind";
import type { PcRootsInfo } from "@shared/pc-roots-types";
import type { ProfileFolderAction, ProfileImportPreview } from "@shared/profile-types";
import type { NotionTokenStatus } from "@shared/notion-types";
import type {
  AppSettings,
  AppSettingsPatch,
  FileOpenTarget,
  NotifiableStatus,
  PcRootKey,
  ProjectCategorySetting,
  ProjectSettings,
} from "@shared/settings-types";
import {
  MAX_CATEGORY_NAME_LENGTH,
  TERMINAL_FONT_SIZE_RANGE,
  TERMINAL_LINE_HEIGHT_RANGE,
  TERMINAL_SCROLLBACK_RANGE,
  defaultFolderTemplates,
} from "@shared/settings-types";
import {
  MAX_FOLDER_TEMPLATE_NAME_LENGTH,
  MAX_FOLDER_TEMPLATES,
  parseFolderTemplateLines,
  type ProjectFolderTemplate,
} from "@shared/folder-template";
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
import { DriveKindIcon } from "./drive-kind-icon";
import type { WorkspaceSnapshot } from "@shared/workspace-types";
import { RemoteSettings } from "./RemoteSettings";
import { PresetSettings } from "./PresetSettings";
import { LaunchProfileSettings } from "./LaunchProfileSettings";
import { SettingsSearch } from "./SettingsSearch";
import { errorMessage } from "./ipc-error";

export type SettingsTab =
  | "general"
  | "terminal"
  | "notifications"
  | "projects"
  | "workspace"
  | "files"
  | "notion"
  | "mobile"
  | "keybindings"
  | "presets"
  | "launch-profiles"
  | "pc";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "일반" },
  { id: "terminal", label: "터미널" },
  { id: "notifications", label: "알림" },
  { id: "projects", label: "프로젝트" },
  { id: "workspace", label: "워크스페이스" },
  { id: "files", label: "파일" },
  { id: "presets", label: "팀 프리셋" },
  { id: "launch-profiles", label: "시작 프로필" },
  { id: "notion", label: "노션" },
  { id: "mobile", label: "원격" },
  { id: "keybindings", label: "단축키" },
  { id: "pc", label: "PC · 프로필" },
];

const STATUS_LABELS: Array<{ status: NotifiableStatus; label: string }> = [
  { status: "awaiting-input", label: "입력 대기" },
  { status: "awaiting-approval", label: "승인 대기" },
  { status: "exited", label: "종료" },
  { status: "error", label: "오류" },
];

const FILE_OPEN_TARGET_LABELS: Record<FileOpenTarget, string> = {
  "in-app": "인앱",
  os: "연결 프로그램",
  vscode: "VS Code",
};

// UI 힌트용 사본 — settings-types.ts의 FILE_OPEN_WITH_EXTENSION_PATTERN과 같은 규칙이다.
// 실제 검증은 메인 프로세스의 parseSettings가 맡으므로, 여기서 놓쳐도 저장 단계에서 걸러진다.
const FILE_EXTENSION_INPUT_PATTERN = /^[a-z0-9]{1,16}$/;

interface SettingsDialogProps {
  settings: AppSettings;
  onClose(): void;
  /** 사이드바의 "다시 페어링 필요"처럼 특정 탭으로 바로 열 때. */
  initialTab?: SettingsTab;
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
        if (alive) setError(errorMessage(cause));
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
      .catch((cause: unknown) => setError(errorMessage(cause)))
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
 *
 * 2026-09-05부터 루트의 단위는 `projects/PRJ-####-slug` 평면 구조다 — 옛 `<채널>/<셸>` 배치는
 * `workspace-index.ts`의 폴백이 계속 읽는다.
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
        if (alive) setError(errorMessage(cause));
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
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  const roots = snapshot?.registry.roots ?? [];
  const projectsOf = (work: string) => (snapshot?.shells ?? []).filter((shell) => shell.root === work).length;

  return (
    <>
      <h2>워크스페이스 루트</h2>
      <p className="settings-hint">
        Project 폴더(<code>projects/PRJ-####-slug</code>)와 <code>dev/</code> 레포가 사는 폴더입니다.
        등록하면 사이드바가 레포를 소속 프로젝트 아래로 묶고, 세션 브리프에 형제 레포·데이터셋
        경로가 붙습니다. 워크스페이스의 파일은 읽기만 합니다.
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
                  dev {root.dev} · data {root.data} · 프로젝트 {projectsOf(root.work)}개
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
              run(async () => (await window.multiCliWork.workspace.sync()).workspace, "프로젝트를 다시 읽었습니다")
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

  const [codeError, setCodeError] = useState<string | null>(null);
  const changeCode = (index: number, raw: string) => {
    const code = raw.trim().toUpperCase();
    setCodeError(null);
    if (code.length > 0 && !isCategoryCode(code)) {
      setCodeError("구분 코드는 영문 대문자 한 글자입니다");
      return;
    }
    if (code.length > 0 && categories.some((category, at) => at !== index && category.code === code)) {
      setCodeError(`코드 ${code}는 이미 다른 구분이 쓰고 있습니다`);
      return;
    }
    applyCategories(
      categories.map((category, at) => {
        if (at !== index) return category;
        const { code: _previous, ...rest } = category;
        return code.length > 0 ? { ...rest, code } : rest;
      }),
    );
  };

  const sortByCode = () => applyCategories(sortCategoriesByCode(categories));

  const changeDefault = (name: string) => {
    setDefaultCategory(name);
    onChange({ defaultCategory: name });
  };

  const changeCategoryTemplate = (index: number, templateId: string) => {
    applyCategories(
      categories.map((category, at) => {
        if (at !== index) return category;
        const { templateId: _previous, ...rest } = category;
        return templateId.length > 0 ? { ...rest, templateId } : rest;
      }),
    );
  };

  const [templates, setTemplates] = useState<ProjectFolderTemplate[]>(projects.folderTemplates);
  // 되돌리기는 같은 id로 내용만 바꾸므로, 편집기의 드래프트를 버리게 key를 함께 바꾼다.
  const [templateGeneration, setTemplateGeneration] = useState(0);

  /** 템플릿이 사라지면 그 템플릿을 기본으로 쓰던 구분도 같은 패치에서 "없음"으로 돌린다. */
  const applyTemplates = (next: ProjectFolderTemplate[]) => {
    setTemplates(next);
    const ids = new Set(next.map((template) => template.id));
    if (!categories.some((category) => category.templateId !== undefined && !ids.has(category.templateId))) {
      onChange({ folderTemplates: next });
      return;
    }
    const nextCategories = categories.map((category) => {
      if (category.templateId === undefined || ids.has(category.templateId)) return category;
      const { templateId: _orphaned, ...rest } = category;
      return rest;
    });
    setCategories(nextCategories);
    onChange({ folderTemplates: next, categories: nextCategories });
  };

  const addTemplate = () => {
    const takenNames = new Set(templates.map((template) => template.name));
    let name = "새 템플릿";
    for (let suffix = 2; takenNames.has(name); suffix += 1) name = `새 템플릿 ${suffix}`;
    const takenIds = new Set(templates.map((template) => template.id));
    let id = `custom-${Date.now().toString(36)}`;
    for (let suffix = 2; takenIds.has(id); suffix += 1) id = `custom-${Date.now().toString(36)}-${suffix}`;
    applyTemplates([...templates, { id, name, folders: [] }]);
  };

  const resetTemplates = () => {
    applyTemplates(defaultFolderTemplates());
    setTemplateGeneration((current) => current + 1);
  };

  return (
    <>
      <h2>프로젝트 구분</h2>
      <p className="settings-hint">
        업무 프로젝트의 구분입니다. 사이드바 레일, 홈 카드, 상세 페이지 칩의 색을 정합니다.
      </p>
      <p className="settings-hint">
        코드(영문 대문자 한 글자)는 업무 프로젝트·드라이브 폴더 이름의 접두어입니다(<code>R_DOTORI</code>). 구분 순서대로
        알파벳을 고르면 드라이브에서도 같은 순서로 정렬됩니다.
      </p>
      <ul className="settings-list" aria-label="구분 목록">
        {categories.map((category, index) => (
          <li key={index} className="settings-row settings-category-row">
            <input
              type="text"
              className="settings-category-code"
              aria-label={`구분 ${index + 1} 코드`}
              placeholder="-"
              maxLength={1}
              value={category.code ?? ""}
              onChange={(event) => changeCode(index, event.target.value)}
            />
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
            <select
              className="settings-category-template"
              aria-label={`${category.name} 폴더 템플릿`}
              title="드라이브 폴더를 만들 때 기본으로 고를 템플릿"
              value={category.templateId ?? ""}
              onChange={(event) => changeCategoryTemplate(index, event.target.value)}
            >
              <option value="">템플릿 없음</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
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
          <button type="button" onClick={sortByCode} disabled={!categories.some((category) => category.code)}>
            코드순 정렬
          </button>
          <button type="button" onClick={addCategory}>
            구분 추가
          </button>
        </span>
      </div>
      {codeError ? (
        <p className="settings-error" role="alert">
          {codeError}
        </p>
      ) : null}
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
      <h2>드라이브 폴더 템플릿</h2>
      <p className="settings-hint">
        드라이브 폴더를 만들 때 함께 만들 하위 폴더입니다. 한 줄에 하나씩 적고, <code>/</code>로 하위 폴더를 만들 수
        있습니다(<code>02_발표자료/회의록</code>). 템플릿으로 만들면 <code>CLAUDE.md</code>도 함께 생깁니다. 구분마다
        기본 템플릿을 위 목록에서 고릅니다.
      </p>
      <ul className="settings-list" aria-label="폴더 템플릿 목록">
        {templates.map((template, index) => (
          <FolderTemplateEditor
            key={`${templateGeneration}:${template.id}`}
            template={template}
            onChange={(next) => applyTemplates(templates.map((current, at) => (at === index ? next : current)))}
            onRemove={() => applyTemplates(templates.filter((_, at) => at !== index))}
          />
        ))}
      </ul>
      <div className="settings-row">
        <span />
        <span className="settings-key-controls">
          <button type="button" onClick={resetTemplates}>
            기본값으로 되돌리기
          </button>
          <button type="button" onClick={addTemplate} disabled={templates.length >= MAX_FOLDER_TEMPLATES}>
            템플릿 추가
          </button>
        </span>
      </div>
    </>
  );
}

/**
 * 템플릿 하나. 이름과 폴더 목록은 blur에서 저장한다 — 타이핑 중 값과 저장된 값을 나눠 두는 것은 구분
 * 이름 입력과 같다. 잘못된 줄이 하나라도 있으면 저장하지 않고 줄 번호를 보여 준다.
 */
function FolderTemplateEditor({
  template,
  onChange,
  onRemove,
}: {
  template: ProjectFolderTemplate;
  onChange(next: ProjectFolderTemplate): void;
  onRemove(): void;
}) {
  const [name, setName] = useState(template.name);
  const [text, setText] = useState(template.folders.join("\n"));
  const [errors, setErrors] = useState<string[]>([]);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed === template.name) {
      setName(template.name);
      return;
    }
    onChange({ ...template, name: trimmed });
  };

  const commitFolders = () => {
    const parsed = parseFolderTemplateLines(text);
    setErrors(parsed.errors);
    if (parsed.errors.length > 0) return;
    setText(parsed.folders.join("\n"));
    if (parsed.folders.join("\n") === template.folders.join("\n")) return;
    onChange({ ...template, folders: parsed.folders });
  };

  return (
    <li className="settings-folder-template">
      <div className="settings-row">
        <input
          type="text"
          aria-label={`${template.name} 템플릿 이름`}
          maxLength={MAX_FOLDER_TEMPLATE_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur();
          }}
        />
        <button type="button" onClick={onRemove}>
          {`${template.name} 템플릿 삭제`}
        </button>
      </div>
      <textarea
        aria-label={`${template.name} 폴더 목록`}
        rows={Math.max(3, text.split("\n").length)}
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commitFolders}
      />
      {errors.length > 0 ? (
        <p className="settings-error" role="alert">
          {errors.join(" · ")}
        </p>
      ) : null}
    </li>
  );
}

const PROFILE_SETTING_LABELS: Record<string, string> = {
  language: "언어",
  general: "일반",
  terminal: "터미널",
  notifications: "알림",
  keybindings: "단축키",
  projects: "프로젝트 구분·폴더 템플릿",
  files: "파일",
  fanOut: "팬아웃 템플릿",
  appearance: "테마",
  usage: "사용량",
};

const FOLDER_ACTION_LABELS: Record<ProfileFolderAction, string> = {
  add: "등록",
  exists: "이미 있음",
  missing: "이 PC에 없음",
};

/**
 * 설정 프로필 — 지금 PC의 설정·업무 프로젝트·폴더를 드라이브에 내보내고, 다른 PC에서 미리 본 뒤
 * 병합해 불러온다. 계속 동기화하지 않는다. 불러오기는 지우지 않고, 직전 파일을 백업한다.
 */
function ProfileSection() {
  const [defaultPath, setDefaultPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProfileImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.multiCliWork.profile
      .defaultPath()
      .then((next) => {
        if (alive) setDefaultPath(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const exportProfile = () =>
    run(async () => {
      const result = await window.multiCliWork.profile.export();
      if (result) {
        setNotice(`내보냈습니다: ${result.path} (업무 프로젝트 ${result.workProjectCount}개, 폴더 ${result.folderCount}개)`);
      }
    });
  const previewImport = () =>
    run(async () => {
      setPreview(await window.multiCliWork.profile.preview());
    });
  const applyImport = () =>
    run(async () => {
      const result = await window.multiCliWork.profile.apply();
      setPreview(null);
      setNotice(
        [
          `불러왔습니다 — 업무 프로젝트 추가 ${result.addedWorkProjects}개·갱신 ${result.updatedWorkProjects}개, 폴더 등록 ${result.addedFolders}개.`,
          result.missingFolders.length > 0 ? `이 PC에 없어 건너뛴 폴더 ${result.missingFolders.length}개.` : "",
          `이전 파일 백업: ${result.backupDir}`,
        ]
          .filter(Boolean)
          .join(" "),
      );
    });

  const missing = preview?.folders.filter((folder) => folder.action === "missing") ?? [];

  return (
    <>
      <h2>설정 프로필</h2>
      <p className="settings-hint">
        설정·프로젝트 구분·업무 프로젝트·폴더 목록·태그를 파일 하나로 내보내고 다른 PC에서 불러옵니다. 경로는 위 루트
        기준으로 바꿔 옮기고, 원격 설정·이 PC의 루트·노션 토큰은 옮기지 않습니다.
      </p>
      <p className="settings-hint">
        기본 위치: <code>{defaultPath ?? "드라이브 루트가 없어 직접 고릅니다"}</code>
      </p>
      <div className="settings-row">
        <span />
        <span className="settings-key-controls">
          <button type="button" disabled={busy} onClick={() => void exportProfile()}>
            내보내기
          </button>
          <button type="button" disabled={busy} onClick={() => void previewImport()}>
            불러오기…
          </button>
        </span>
      </div>
      {preview ? (
        <div className="profile-preview" role="region" aria-label="불러오기 미리보기">
          <p>
            <strong>{preview.exportedFrom || "알 수 없는 PC"}</strong>에서 {preview.exportedAt.slice(0, 16).replace("T", " ")}에 내보낸
            프로필
          </p>
          <ul className="settings-list">
            <li className="settings-hint">
              설정: {preview.settingsChanged.length > 0 ? preview.settingsChanged.map((key) => PROFILE_SETTING_LABELS[key] ?? key).join(", ") : "바뀌는 것 없음"}
            </li>
            <li className="settings-hint">
              업무 프로젝트: 추가 {preview.workProjects.filter((entry) => entry.action === "add").length}개 · 갱신{" "}
              {preview.workProjects.filter((entry) => entry.action === "update").length}개
            </li>
            <li className="settings-hint">
              폴더: 등록 {preview.folders.filter((entry) => entry.action === "add").length}개 · 이미 있음{" "}
              {preview.folders.filter((entry) => entry.action === "exists").length}개 · 이 PC에 없음 {missing.length}개
            </li>
          </ul>
          {preview.folders.length > 0 ? (
            <details>
              <summary>폴더 자세히</summary>
              <ul className="settings-list profile-folder-list">
                {preview.folders.map((entry) => (
                  <li key={entry.path} className={`profile-folder-${entry.action}`}>
                    <span title={entry.resolvedPath ?? undefined}>{entry.path}</span>
                    <span>{FOLDER_ACTION_LABELS[entry.action]}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="settings-row">
            <span className="settings-hint">지우는 것은 없습니다. 적용 직전 파일을 백업합니다.</span>
            <span className="settings-key-controls">
              <button type="button" disabled={busy} onClick={() => setPreview(null)}>
                취소
              </button>
              <button type="button" disabled={busy} onClick={() => void applyImport()}>
                적용
              </button>
            </span>
          </div>
        </div>
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

const PC_ROOT_LABELS: Array<{ key: PcRootKey; label: string; hint: string }> = [
  { key: "drive", label: "문서", hint: "업무 프로젝트 문서 폴더의 기준 — Google Drive·OneDrive·NAS·로컬 폴더 어디든" },
  { key: "dev", label: "dev", hint: "개발 레포 — 레포 추가 대화상자가 여기서 시작" },
  { key: "data", label: "data", hint: "대용량 데이터 — 참고 폴더 대화상자가 여기서 시작" },
  { key: "work", label: "work", hint: "작업 셸·문서(선택)" },
];

/**
 * 이 PC의 루트. 3대 PC가 `C:`·`D:`처럼 서로 달라 프로필로 옮기지 않는다 — 지정하지 않으면 관례
 * 위치를 찾아 쓴다. 아래의 설정 프로필은 이 루트를 기준으로 경로를 바꿔 옮긴다.
 */
function PcSettings({ profileSection }: { profileSection?: ReactNode }) {
  const [info, setInfo] = useState<PcRootsInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.multiCliWork.pcRoots
      .get()
      .then((next) => {
        if (alive) setInfo(next);
      })
      .catch((cause: unknown) => {
        if (alive) setError(errorMessage(cause));
      });
    return () => {
      alive = false;
    };
  }, []);

  const run = (action: () => Promise<PcRootsInfo | null>) => {
    setBusy(true);
    setError(null);
    action()
      .then((next) => {
        if (next) setInfo(next);
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <h2>이 PC의 루트</h2>
      <p className="settings-hint">
        PC마다 다른 위치(<code>C:\dev</code>·<code>D:\dev</code> 등)입니다. 비워 두면 관례 위치를 자동으로 찾습니다.
      </p>
      {info === null ? (
        <p className="settings-hint">확인 중…</p>
      ) : (
        <ul className="settings-list" aria-label="PC 루트">
          {PC_ROOT_LABELS.map(({ key, label, hint }) => {
            const configured = info.configured[key];
            const effective = info.effective[key];
            return (
              <li key={key} className="settings-row pc-root-row">
                <span className="settings-list-copy">
                  <strong>{label}</strong>
                  <span title={effective ?? undefined}>
                    {effective ?? "찾지 못함"}
                    <span className="pc-root-source">{configured ? " · 지정" : effective ? " · 자동" : ""}</span>
                  </span>
                  <span className="settings-hint">{hint}</span>
                </span>
                <span className="settings-key-controls">
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`${label} 루트 지정`}
                    onClick={() => run(() => window.multiCliWork.pcRoots.choose(key))}
                  >
                    지정
                  </button>
                  <button
                    type="button"
                    disabled={busy || configured === null}
                    aria-label={`${label} 루트 자동으로`}
                    onClick={() => run(() => window.multiCliWork.pcRoots.clear(key))}
                  >
                    자동
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {info === null ? null : (
        <div className="drive-kind-picker">
          <span className="settings-hint">문서 루트 종류 — 아이콘과 화면 문구의 이름</span>
          <div className="drive-kind-options" role="radiogroup" aria-label="문서 루트 종류">
            <button
              type="button"
              role="radio"
              aria-checked={info.driveKind.configured === null}
              className="drive-kind-option"
              disabled={busy}
              onClick={() => run(() => window.multiCliWork.pcRoots.setDriveKind(null))}
            >
              <DriveKindIcon kind={inferDriveKind(info.effective.drive)} size={18} />
              <span>자동 ({driveKindLabel(inferDriveKind(info.effective.drive))})</span>
            </button>
            {DRIVE_KINDS.map((kind) => (
              <button
                key={kind.id}
                type="button"
                role="radio"
                aria-checked={info.driveKind.configured === kind.id}
                className="drive-kind-option"
                disabled={busy}
                onClick={() => run(() => window.multiCliWork.pcRoots.setDriveKind(kind.id))}
              >
                <DriveKindIcon kind={kind.id} size={18} />
                <span>{kind.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="settings-row">
        <span />
        <span className="settings-key-controls">
          <button type="button" disabled={busy} onClick={() => run(() => window.multiCliWork.pcRoots.redetect())}>
            다시 찾기
          </button>
        </span>
      </div>
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      {profileSection}
    </>
  );
}

/**
 * 저장 버튼이 없는 즉시 적용 폼. 컨트롤 변경 → settings:update → settings:changed 브로드캐스트로
 * App의 사본이 갱신되어 되돌아온다 — 이 다이얼로그 자신도 그 사본을 props로 받는다.
 */
export function SettingsDialog({ settings, onClose, initialTab }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? "general");
  const [error, setError] = useState<string | null>(null);
  const [capturingActionId, setCapturingActionId] = useState<string | null>(null);
  const [capturingSummon, setCapturingSummon] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ actionId: string; accelerator: string; existing: KeymapAction } | null>(null);
  const [newExtension, setNewExtension] = useState("");
  const [newOpenTarget, setNewOpenTarget] = useState<FileOpenTarget>("os");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const update = (patch: AppSettingsPatch) => {
    setError(null);
    // main's own reason (a shortcut another program holds, a rejected value) says more than a generic line.
    window.multiCliWork.settings
      .update(patch)
      .catch((cause: unknown) => setError(`설정 저장에 실패했습니다 — ${errorMessage(cause)}`));
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

  // The summon key is system-wide, so it needs Ctrl or Alt — a bare key would be stolen from every app.
  useEffect(() => {
    if (!capturingSummon) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturingSummon(false);
        setCaptureNotice(null);
        return;
      }
      const accelerator = normalizeKeyEvent(event);
      if (!accelerator) return;
      if (!/(?:^|\+)(?:Ctrl|Alt)\+/.test(accelerator)) {
        setCaptureNotice("전역 단축키에는 Ctrl이나 Alt가 필요합니다");
        return;
      }
      setCapturingSummon(false);
      setCaptureNotice(null);
      update({ general: { summonShortcut: accelerator } });
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [capturingSummon]);

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
          <SettingsSearch onSelect={setTab} />
          {tab === "general" ? (
            <>
              <h2>일반</h2>
              <div className="settings-row"><label htmlFor="settings-effects">시각 효과 · 즉시 적용</label><select id="settings-effects" value={settings.appearance.effects} onChange={event => update({ appearance: { effects: event.target.value as AppSettings["appearance"]["effects"] } })}><option value="rich">풍부하게</option><option value="balanced">기본</option><option value="minimal">최소</option></select></div>
              <div className="settings-row"><label htmlFor="settings-density">화면 밀도 · 즉시 적용</label><select id="settings-density" value={settings.appearance.density} onChange={event => update({ appearance: { density: event.target.value as AppSettings["appearance"]["density"] } })}><option value="comfortable">여유 있게</option><option value="compact">촘촘하게</option></select></div>
              {/* 언어 선택은 i18n이 붙을 때 돌아온다. 값(`language`)은 설정 파일에 그대로 남겨 두어
                  다운그레이드해도 잃지 않는다 — 적용되지 않는 선택지를 보여 주지 않을 뿐이다. */}
              <div className="settings-row">
                <label htmlFor="settings-theme">테마</label>
                <select
                  id="settings-theme"
                  value={settings.appearance.theme}
                  onChange={(event) =>
                    update({ appearance: { theme: event.target.value as AppSettings["appearance"]["theme"] } })
                  }
                >
                  <option value="dark">다크</option>
                  <option value="light">라이트</option>
                  <option value="system">시스템 설정 따르기</option>
                </select>
              </div>
              {checkboxRow("창을 닫으면 트레이에 남기기", "settings-close-to-tray", settings.general.closeToTray, (next) => ({
                general: { closeToTray: next },
              }))}
              {window.mcwV2?.version!==2&&checkboxRow(
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
              {checkboxRow(
                "작업표시줄 아이콘에 세션 진행률 표시",
                "settings-taskbar-progress",
                settings.general.taskbarProgress,
                (next) => ({ general: { taskbarProgress: next } }),
              )}
              {window.mcwV2?.version!==2&&checkboxRow(
                "Claude·Codex 세션에 jk 도구(MCP) 제공 — 새로 시작하는 세션부터",
                "settings-jk-mcp",
                settings.general.jkMcp,
                (next) => ({ general: { jkMcp: next } }),
              )}
              {window.mcwV2?.version!==2&&checkboxRow(
                "업무 프로젝트의 Claude·Codex 세션을 시작할 때 레포 최신화 (fast-forward만)",
                "settings-repo-sync-on-start",
                settings.general.repoSyncOnSessionStart,
                (next) => ({ general: { repoSyncOnSessionStart: next } }),
              )}
              <div className="settings-row">
                <span>창 불러오기 단축키</span>
                <span className="settings-key-controls">
                  <span className="settings-key" aria-label="창 불러오기 단축키 값">
                    {capturingSummon ? "키를 누르세요…" : (settings.general.summonShortcut ?? "없음")}
                  </span>
                  <button type="button" onClick={() => setCapturingSummon(true)} disabled={capturingSummon}>
                    키 지정
                  </button>
                  <button
                    type="button"
                    disabled={settings.general.summonShortcut === null}
                    onClick={() => update({ general: { summonShortcut: null } })}
                  >
                    해제
                  </button>
                </span>
              </div>
              <p className="settings-hint">
                트레이에 숨어 있을 때도 이 키로 창을 불러옵니다. 다른 프로그램에서도 먹는 전역 키라 Ctrl이나 Alt가
                필요합니다.
              </p>
              {tab === "general" && captureNotice && capturingSummon ? (
                <p className="settings-error" role="alert">
                  {captureNotice}
                </p>
              ) : null}
              {checkboxRow("애니메이션 줄이기", "settings-reduce-motion", settings.general.reduceMotion, (next) => ({
                general: { reduceMotion: next },
              }))}
              <p className="settings-hint">Windows의 애니메이션 효과가 꺼져 있으면 이 설정과 무관하게 줄입니다.</p>
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
              <h3>방해 금지</h3>
              <p className="settings-hint">이 동안에는 데스크톱 알림만 멈춥니다. 트레이의 알림 메뉴로도 끄고 켤 수 있습니다.</p>
              {checkboxRow("방해 금지 시간", "settings-quiet-hours", settings.notifications.quietHours.enabled, (next) => ({
                notifications: { quietHours: { enabled: next } },
              }))}
              <div className="settings-row">
                <span>매일</span>
                <span className="settings-key-controls">
                  <input
                    type="time"
                    aria-label="방해 금지 시작"
                    value={settings.notifications.quietHours.start}
                    disabled={!settings.notifications.quietHours.enabled}
                    onChange={(event) => {
                      if (event.target.value) update({ notifications: { quietHours: { start: event.target.value } } });
                    }}
                  />
                  <span>부터</span>
                  <input
                    type="time"
                    aria-label="방해 금지 끝"
                    value={settings.notifications.quietHours.end}
                    disabled={!settings.notifications.quietHours.enabled}
                    onChange={(event) => {
                      if (event.target.value) update({ notifications: { quietHours: { end: event.target.value } } });
                    }}
                  />
                  <span>까지</span>
                </span>
              </div>
              {(() => {
                const until = settings.notifications.snoozedUntil;
                const snoozed = until !== null && Date.parse(until) > Date.now();
                return (
                  <div className="settings-row">
                    <span>
                      {snoozed
                        ? `${new Date(until).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}까지 알림을 끕니다`
                        : "지금 잠깐 조용히"}
                    </span>
                    {snoozed ? (
                      <button type="button" onClick={() => update({ notifications: { snoozedUntil: null } })}>
                        다시 켜기
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          update({ notifications: { snoozedUntil: new Date(Date.now() + 60 * 60_000).toISOString() } })
                        }
                      >
                        1시간 끄기
                      </button>
                    )}
                  </div>
                );
              })()}
              <h3>구독 사용량</h3>
              <p className="settings-hint">
                타이틀바에 Claude·Codex의 5시간·주간 한도를 링으로 보입니다. Claude는 로그인 토큰으로 Anthropic 사용량
                API를(Claude 세션이 있는 동안 5분마다), Codex는 이 PC의 세션 기록을 읽습니다.
              </p>
              {checkboxRow("타이틀바에 사용량 게이지 표시", "settings-usage-enabled", settings.usage.enabled, (next) => ({
                usage: { enabled: next },
              }))}
              {checkboxRow("한도 90%를 넘으면 알림", "settings-usage-notify", settings.usage.notifyAt90, (next) => ({
                usage: { notifyAt90: next },
              }))}
            </>
          ) : null}
          {tab === "projects" ? (
            <ProjectsSettings projects={settings.projects} onChange={(next) => update({ projects: next })} />
          ) : null}
          {tab === "workspace" ? <WorkspaceSettings /> : null}
          {tab === "presets" ? <PresetSettings /> : null}
          {tab === "launch-profiles" ? <LaunchProfileSettings /> : null}
          {tab === "files" ? (
            <>
              <h2>파일</h2>
              <p className="settings-hint">
                우측 사이드바에서 파일을 더블클릭하거나 터미널의 경로를 Ctrl+클릭할 때 여는 방법입니다. 확장자별 지정이 우선합니다.
              </p>
              <div className="settings-row">
                <label htmlFor="settings-default-open-with">기본 열기</label>
                <select
                  id="settings-default-open-with"
                  value={settings.files.defaultOpenWith}
                  onChange={(event) => update({ files: { defaultOpenWith: event.target.value as FileOpenTarget } })}
                >
                  {(Object.keys(FILE_OPEN_TARGET_LABELS) as FileOpenTarget[]).map((option) => (
                    <option key={option} value={option}>
                      {FILE_OPEN_TARGET_LABELS[option]}
                    </option>
                  ))}
                </select>
              </div>
              {checkboxRow(
                "인앱으로 열 때 미리보기를 지원하지 않는 파일은 연결 프로그램으로 열기",
                "settings-unsupported-opens-with-os",
                settings.files.unsupportedOpensWithOs,
                (next) => ({ files: { unsupportedOpensWithOs: next } }),
              )}
              <h3 className="settings-key-category">확장자별 열기</h3>
              {Object.entries(settings.files.openWith).length === 0 ? (
                <p className="settings-hint">지정된 확장자가 없습니다.</p>
              ) : (
                Object.entries(settings.files.openWith).map(([extension, openTarget]) => (
                  <div className="settings-row" key={extension}>
                    <span>.{extension}</span>
                    <span className="settings-key-controls">
                      <select
                        aria-label={`.${extension} 여는 방법`}
                        value={openTarget}
                        onChange={(event) => {
                          const next = { ...settings.files.openWith, [extension]: event.target.value as FileOpenTarget };
                          update({ files: { openWith: next } });
                        }}
                      >
                        {(Object.keys(FILE_OPEN_TARGET_LABELS) as FileOpenTarget[]).map((option) => (
                          <option key={option} value={option}>
                            {FILE_OPEN_TARGET_LABELS[option]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const next = { ...settings.files.openWith };
                          delete next[extension];
                          update({ files: { openWith: next } });
                        }}
                      >
                        삭제
                      </button>
                    </span>
                  </div>
                ))
              )}
              <div className="settings-row">
                <label htmlFor="settings-new-extension">확장자 추가</label>
                <span className="settings-key-controls">
                  <input
                    id="settings-new-extension"
                    type="text"
                    placeholder="예: pdf"
                    value={newExtension}
                    onChange={(event) => setNewExtension(event.target.value)}
                  />
                  <select value={newOpenTarget} onChange={(event) => setNewOpenTarget(event.target.value as FileOpenTarget)}>
                    {(Object.keys(FILE_OPEN_TARGET_LABELS) as FileOpenTarget[]).map((option) => (
                      <option key={option} value={option}>
                        {FILE_OPEN_TARGET_LABELS[option]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!FILE_EXTENSION_INPUT_PATTERN.test(newExtension.trim().toLowerCase().replace(/^\./, ""))}
                    onClick={() => {
                      const extension = newExtension.trim().toLowerCase().replace(/^\./, "");
                      update({ files: { openWith: { ...settings.files.openWith, [extension]: newOpenTarget } } });
                      setNewExtension("");
                    }}
                  >
                    추가
                  </button>
                </span>
              </div>
            </>
          ) : null}
          {tab === "notion" ? <NotionSettings /> : null}
          {tab === "pc" ? <PcSettings profileSection={<ProfileSection />} /> : null}
          {tab === "mobile" ? <RemoteSettings settings={settings} /> : null}
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
