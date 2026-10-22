import type { DriveOverview } from "@shared/drive-types";
import type { ProjectFolderTemplate } from "@shared/folder-template";
import type { ProjectCategorySetting } from "@shared/settings-types";
import type { WorkProjectRegistryV1 } from "@shared/work-project-types";
import { categoryForCode, parsePrefixedName, withCategoryPrefix } from "@shared/category-code";
import { driveKindLabel } from "@shared/drive-kind";
import { useEffect, useMemo, useState } from "react";
import { useDriveRoot } from "./drive-root-context";
import { FolderTemplatePicker } from "./FolderTemplatePicker";
import { errorMessage } from "./ipc-error";

interface WorkProjectCreateDialogProps {
  categories: readonly ProjectCategorySetting[];
  defaultCategory: string;
  folderTemplates: readonly ProjectFolderTemplate[];
  /** 만든(또는 가져온) 뒤의 레지스트리와, 하나만 만들었으면 그 id. */
  onDone(registry: WorkProjectRegistryV1, createdId: string | null): void;
  onClose(): void;
}

type Mode = "new" | "drive";

/**
 * 새 업무 프로젝트. 이름은 `<구분 코드>_<이름>` — 드라이브 최상위 폴더와 같은 규칙이라, 만들면서
 * 드라이브 폴더도 함께 만들 수 있다. 다른 PC에서 이미 만든 드라이브 폴더는 "드라이브에서 가져오기"로
 * 한 번에 업무 프로젝트가 된다.
 */
export function WorkProjectCreateDialog({
  categories,
  defaultCategory,
  folderTemplates,
  onDone,
  onClose,
}: WorkProjectCreateDialogProps) {
  const driveLabel = driveKindLabel(useDriveRoot().kind);
  const templateOf = (name: string) => categories.find((candidate) => candidate.name === name)?.templateId ?? null;
  const [mode, setMode] = useState<Mode>("new");
  const [category, setCategory] = useState(defaultCategory);
  const [baseName, setBaseName] = useState("");
  const [withDriveFolder, setWithDriveFolder] = useState(true);
  const [templateId, setTemplateId] = useState<string | null>(() => templateOf(defaultCategory));
  const [overview, setOverview] = useState<DriveOverview | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.multiCliWork.drive
      .overview()
      .then((next) => {
        if (!alive) return;
        setOverview(next);
        setPicked(new Set(next.folders.filter((folder) => folder.workProjectId === null).map((folder) => folder.name)));
      })
      .catch(() => {
        if (alive) setOverview({ root: null, available: false, folders: [] });
      });
    return () => {
      alive = false;
    };
  }, []);

  const categorySetting = categories.find((candidate) => candidate.name === category);
  const finalName = useMemo(() => {
    const trimmed = baseName.trim();
    if (trimmed.length === 0) return "";
    return withCategoryPrefix(trimmed, categorySetting);
  }, [baseName, categorySetting]);
  const unlinked = overview?.folders.filter((folder) => folder.workProjectId === null) ?? [];
  const driveReady = overview?.available === true;

  // 템플릿은 구분을 따라간다 — 구분을 바꾼 뒤 직접 고르면 그 값이 남는다.
  const changeCategory = (name: string) => {
    if (name === category) return;
    setCategory(name);
    setTemplateId(templateOf(name));
  };

  // 사용자가 접두어까지 쳤다면(`R_새과제`) 그 코드의 구분으로 맞춘다 — 코드와 구분이 어긋날 수 없게.
  const changeName = (value: string) => {
    setBaseName(value);
    const parsed = parsePrefixedName(value);
    const matched = parsed ? categoryForCode(categories, parsed.code) : undefined;
    if (matched) changeCategory(matched.name);
  };

  const createNew = async () => {
    if (finalName.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const before = new Set(Object.keys((await window.multiCliWork.workProjects.list()).workProjects));
      let registry = await window.multiCliWork.workProjects.create({ name: finalName, category });
      const createdId = Object.keys(registry.workProjects).find((id) => !before.has(id)) ?? null;
      if (createdId && withDriveFolder && driveReady) {
        registry = (await window.multiCliWork.drive.createFolder(createdId, { templateId })).workProjects;
      }
      onDone(registry, createdId);
    } catch (cause) {
      setError(errorMessage(cause));
      setPending(false);
    }
  };

  const importFolders = async () => {
    if (picked.size === 0) return;
    setPending(true);
    setError(null);
    try {
      onDone(await window.multiCliWork.drive.importFolders([...picked]), null);
    } catch (cause) {
      setError(errorMessage(cause));
      setPending(false);
    }
  };

  const togglePicked = (name: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="confirm-dialog work-project-create-dialog" role="dialog" aria-modal="true" aria-label="업무 프로젝트 만들기">
        <h2>업무 프로젝트 만들기</h2>
        <div className="worktree-mode-tabs" role="tablist" aria-label="만드는 방식">
          <button type="button" role="tab" aria-selected={mode === "new"} onClick={() => setMode("new")}>
            새로 만들기
          </button>
          <button type="button" role="tab" aria-selected={mode === "drive"} onClick={() => setMode("drive")}>
            드라이브에서 가져오기{unlinked.length > 0 ? ` (${unlinked.length})` : ""}
          </button>
        </div>
        {mode === "new" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createNew();
            }}
          >
            <label>
              구분
              <select aria-label="구분" value={category} onChange={(event) => changeCategory(event.target.value)}>
                {categories.map((option) => (
                  <option key={option.name} value={option.name}>
                    {option.code ? `${option.code} · ${option.name}` : option.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              이름
              <input
                aria-label="이름"
                autoFocus
                placeholder="예: 보건의료과제"
                value={baseName}
                onChange={(event) => changeName(event.target.value)}
              />
            </label>
            {finalName ? <p className="worktree-path-preview">프로젝트 이름: {finalName}</p> : null}
            <label className="work-project-create-check">
              <input
                type="checkbox"
                checked={withDriveFolder && driveReady}
                disabled={!driveReady}
                onChange={(event) => setWithDriveFolder(event.target.checked)}
              />
              <span>
                {driveLabel}에 폴더 만들기
                {driveReady ? null : " (이 PC의 드라이브 폴더를 찾지 못함)"}
              </span>
            </label>
            {withDriveFolder && driveReady ? (
              <FolderTemplatePicker
                className="work-project-create-sub"
                templates={folderTemplates}
                value={templateId}
                onChange={setTemplateId}
              />
            ) : null}
            {error ? (
              <p className="detail-save-error" role="alert">
                {error}
              </p>
            ) : null}
            <footer className="confirm-dialog-actions">
              <button type="button" onClick={onClose}>
                취소
              </button>
              <button type="submit" disabled={finalName.length === 0 || pending}>
                {pending ? "만드는 중…" : "만들기"}
              </button>
            </footer>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void importFolders();
            }}
          >
            {overview === null ? (
              <p className="detail-empty">드라이브를 읽는 중…</p>
            ) : !overview.available ? (
              <p className="detail-empty">이 PC의 {driveLabel} 폴더를 찾지 못했습니다. 설정 › PC · 프로필에서 지정하세요.</p>
            ) : unlinked.length === 0 ? (
              <p className="detail-empty">드라이브의 모든 프로젝트 폴더가 이미 업무 프로젝트입니다.</p>
            ) : (
              <ul className="work-project-import-list" aria-label="가져올 드라이브 폴더">
                {unlinked.map((folder) => (
                  <li key={folder.name}>
                    <label className="work-project-create-check">
                      <input type="checkbox" checked={picked.has(folder.name)} onChange={() => togglePicked(folder.name)} />
                      <span>{folder.name}</span>
                      <span className="category-chip">{folder.category ?? "구분 없음"}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {error ? (
              <p className="detail-save-error" role="alert">
                {error}
              </p>
            ) : null}
            <footer className="confirm-dialog-actions">
              <button type="button" onClick={onClose}>
                취소
              </button>
              <button type="submit" disabled={picked.size === 0 || pending || unlinked.length === 0}>
                {pending ? "가져오는 중…" : `${picked.size}개 가져오기`}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
