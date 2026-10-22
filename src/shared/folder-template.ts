/**
 * 드라이브 업무 프로젝트 폴더 템플릿. 템플릿은 설정(`settings.projects.folderTemplates`)에 있어
 * 프로필로 PC 간에 옮겨지고, 구분마다 기본 템플릿을 하나 고를 수 있다. 항목은 `/`로 나눈 상대 경로라
 * 하위 폴더(`02_발표자료/회의록`)도 만들 수 있다.
 */

export interface ProjectFolderTemplate {
  id: string;
  name: string;
  /** 프로젝트 폴더 기준 상대 경로. 구분자는 항상 `/`. */
  folders: string[];
}

export const FOLDER_TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_FOLDER_TEMPLATES = 20;
export const MAX_FOLDER_TEMPLATE_NAME_LENGTH = 32;
export const MAX_FOLDER_TEMPLATE_ENTRIES = 50;
const MAX_FOLDER_NAME_LENGTH = 120;
const MAX_FOLDER_PATH_LENGTH = 240;

/** 드라이브 루트 README가 정한 기본 두 벌 — 설정에서 고치거나 지울 수 있고, 되돌리기는 이 값으로 간다. */
export const DEFAULT_FOLDER_TEMPLATES: readonly ProjectFolderTemplate[] = [
  { id: "minimal", name: "최소", folders: ["01_문서", "02_미디어", "03_데이터", "tmp"] },
  {
    id: "project",
    name: "과제형",
    folders: ["01_계획서", "02_발표자료", "03_개발", "04_참고자료", "05_산출물", "06_미디어", "07_데이터", "tmp"],
  },
];

/**
 * 템플릿이 생기기 전 설정에서 올라올 때 구분 코드로 정하는 기본 템플릿 — 과제(G 정부, O 외주)는
 * 과제형, 연구개발·기타(R, Z)는 최소, 개인·우리(S, U)는 템플릿을 강제하지 않는다.
 */
export function legacyTemplateIdForCode(code: string | undefined): string | undefined {
  if (code === "G" || code === "O") return "project";
  if (code === "R" || code === "Z") return "minimal";
  return undefined;
}

/** Windows 파일 이름 규칙 — 드라이브는 세 PC 모두 Windows다. 문제가 없으면 null. */
export function folderNameError(name: string): string | null {
  if (name.length === 0) return "이름이 비었습니다";
  if (name.length > MAX_FOLDER_NAME_LENGTH) return "이름이 너무 깁니다";
  if (name === "." || name === "..") return "상위 폴더(..)는 쓸 수 없습니다";
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) return `쓸 수 없는 문자가 있습니다: ${name}`;
  if (/[. ]$/.test(name)) return `점이나 공백으로 끝날 수 없습니다: ${name}`;
  return null;
}

/** 손으로 친 경로를 정리한다 — `\`도 구분자로 받고, 조각마다 NFC·공백 정리를 한다. */
export function normalizeFolderTemplatePath(raw: string): string {
  return raw
    .normalize("NFC")
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("/");
}

/** 정리된 경로(`normalizeFolderTemplatePath` 결과)가 템플릿 항목으로 쓸 수 있는지. 문제가 없으면 null. */
export function folderTemplatePathError(normalized: string): string | null {
  if (normalized.length === 0) return "경로가 비었습니다";
  if (normalized.length > MAX_FOLDER_PATH_LENGTH) return "경로가 너무 깁니다";
  if (/^[A-Za-z]:/.test(normalized)) return "절대 경로는 쓸 수 없습니다";
  for (const segment of normalized.split("/")) {
    const error = folderNameError(segment);
    if (error !== null) return error;
  }
  return null;
}

/**
 * 텍스트 상자 한 줄에 하나씩 적은 목록을 템플릿 항목으로 바꾼다. 빈 줄과 중복은 버리고, 잘못된 줄은
 * 줄 번호와 함께 돌려준다 — 하나라도 있으면 저장하지 않는다.
 */
export function parseFolderTemplateLines(text: string): { folders: string[]; errors: string[] } {
  const folders: string[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const normalized = normalizeFolderTemplatePath(line);
    if (normalized.length === 0) return;
    const error = folderTemplatePathError(normalized);
    if (error !== null) errors.push(`${index + 1}번째 줄: ${error}`);
    else if (!folders.includes(normalized)) folders.push(normalized);
  });
  if (folders.length > MAX_FOLDER_TEMPLATE_ENTRIES) errors.push(`항목은 ${MAX_FOLDER_TEMPLATE_ENTRIES}개까지입니다`);
  return { folders, errors };
}

export function findFolderTemplate(
  templates: readonly ProjectFolderTemplate[],
  id: string | undefined,
): ProjectFolderTemplate | undefined {
  return id === undefined ? undefined : templates.find((template) => template.id === id);
}
