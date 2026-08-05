import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView, WorkProjectMemberFolderAddResult, WorkProjectMetadataPatch } from "@shared/api-types";
import type { ProjectStatus, SharedProject } from "@shared/project-types";
import type {
  WorkProject,
  WorkProjectLocalFolder,
  WorkProjectNotionLink,
  WorkProjectRegistryV1,
  WorkProjectRole,
} from "@shared/work-project-types";
import { WORK_PROJECT_CATEGORIES } from "@shared/work-project-types";
import { BookOpen, ExternalLink, FolderOpen, FolderPlus, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { GitHubIcon, TeamsIcon } from "./brand-icons";
import { projectName, relativeTime, sessionLabel, statusLabels } from "./session-labels";
import { categoryAccentClass } from "./work-project-accent";

const STATUS_OPTIONS: Array<ProjectStatus | ""> = ["", "진행중", "보류", "완료", "보관"];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface WorkProjectDetailPageProps {
  workProject: WorkProject;
  /** Member folders resolved against the project registry, in sidebar order. */
  members: Array<{ project: SharedProject; role: WorkProjectRole }>;
  teamsSyncRoot: string | null;
  /** Sessions belonging to any member folder. */
  sessions: TerminalSessionView[];
  agents: AgentView[];
  onSelectSession(session: TerminalSessionView): void;
  onSelectProject(projectId: string): void;
  onRegistryChanged(registry: WorkProjectRegistryV1): void;
  onMemberFolderAdded(result: WorkProjectMemberFolderAddResult): void;
  onRemoveWorkProject(): void;
  onOpenNotion(url: string): void;
  onRevealProject(projectId: string): void;
  onRevealLocalFolder(folderPath: string): void;
}

export function WorkProjectDetailPage({
  workProject,
  members,
  teamsSyncRoot,
  sessions,
  agents,
  onSelectSession,
  onSelectProject,
  onRegistryChanged,
  onMemberFolderAdded,
  onRemoveWorkProject,
  onOpenNotion,
  onRevealProject,
  onRevealLocalFolder,
}: WorkProjectDetailPageProps) {
  const [name, setName] = useState(workProject.name);
  const [category, setCategory] = useState(workProject.category);
  const [notionLinks, setNotionLinks] = useState<WorkProjectNotionLink[]>(workProject.notionLinks);
  const [localFolders, setLocalFolders] = useState<WorkProjectLocalFolder[]>(workProject.localFolders);
  const [memo, setMemo] = useState(workProject.memo);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // Only resync on a genuine work project switch (same reasoning as ProjectDetailPage).
    setName(workProject.name);
    setCategory(workProject.category);
    setNotionLinks(workProject.notionLinks);
    setLocalFolders(workProject.localFolders);
    setMemo(workProject.memo);
  }, [workProject.id]);

  const save = async (patch: WorkProjectMetadataPatch) => {
    setSaveError(null);
    try {
      onRegistryChanged(await window.multiCliWork.workProjects.update(workProject.id, patch));
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  };

  /** What the service will actually store — draft rows without a URL do not count as a change. */
  const normalizedLinks = (links: WorkProjectNotionLink[]) =>
    JSON.stringify(
      links
        .map((link) => ({ label: link.label.trim() || "노션", url: link.url.trim() }))
        .filter((link) => link.url.length > 0),
    );

  const commitNotionLinks = (links: WorkProjectNotionLink[]) => {
    setNotionLinks(links);
    if (normalizedLinks(links) !== normalizedLinks(workProject.notionLinks)) void save({ notionLinks: links });
  };

  const updateNotionLink = (index: number, patch: Partial<WorkProjectNotionLink>) => {
    setNotionLinks((current) => current.map((link, at) => (at === index ? { ...link, ...patch } : link)));
  };

  /** Mirrors the service's default label — the folder's own name — so an untouched row reads as unchanged. */
  const folderLabel = (folder: WorkProjectLocalFolder) => {
    const folderPath = folder.path.trim();
    return folder.label.trim() || folderPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folderPath;
  };

  const normalizedFolders = (folders: WorkProjectLocalFolder[]) =>
    JSON.stringify(
      folders
        .filter((folder) => folder.path.trim().length > 0)
        .map((folder) => ({ label: folderLabel(folder), path: folder.path.trim() })),
    );

  const commitLocalFolders = (folders: WorkProjectLocalFolder[]) => {
    setLocalFolders(folders);
    if (normalizedFolders(folders) !== normalizedFolders(workProject.localFolders)) {
      void save({ localFolders: folders });
    }
  };

  const updateLocalFolder = (index: number, patch: Partial<WorkProjectLocalFolder>) => {
    setLocalFolders((current) => current.map((folder, at) => (at === index ? { ...folder, ...patch } : folder)));
  };

  // The dialog steals focus, so the row's blur cannot be relied on to save the picked path.
  const chooseLocalFolder = async (index: number) => {
    setSaveError(null);
    try {
      const picked = await window.multiCliWork.workProjects.chooseLocalFolder();
      if (picked) {
        commitLocalFolders(localFolders.map((folder, at) => (at === index ? { ...folder, path: picked } : folder)));
      }
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  };

  const addMemberFolder = async (role: WorkProjectRole) => {
    setSaveError(null);
    setPending(true);
    try {
      const result = await window.multiCliWork.workProjects.addMemberFolder(workProject.id, role);
      if (result) onMemberFolderAdded(result);
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const removeMember = async (projectId: string) => {
    setSaveError(null);
    try {
      onRegistryChanged(await window.multiCliWork.workProjects.removeMember(workProject.id, projectId));
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  };

  const chooseTeamsRoot = async () => {
    setSaveError(null);
    try {
      const registry = await window.multiCliWork.workProjects.chooseTeamsSyncRoot();
      if (registry) onRegistryChanged(registry);
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  };

  // The suggested categories plus whatever legacy/custom value the project already carries.
  const categoryOptions = WORK_PROJECT_CATEGORIES.includes(category as (typeof WORK_PROJECT_CATEGORIES)[number])
    ? [...WORK_PROJECT_CATEGORIES]
    : [category, ...WORK_PROJECT_CATEGORIES];
  const docsMembers = members.filter((member) => member.role === "docs");

  // The accent tracks the local `category` state, not the saved one, so the chip and the card edge
  // follow the select the moment it changes rather than only after the write lands.
  return (
    <section
      className={`project-detail work-project-detail ${categoryAccentClass(category)}`}
      aria-label="업무 프로젝트 상세"
    >
      <div className="detail-grid">
        <section className="detail-card detail-card-notes" aria-label="프로젝트 개요">
          <h2>프로젝트 개요</h2>
          {saveError ? (
            <p className="detail-save-error" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="work-project-form">
            <label htmlFor={`wp-name-${workProject.id}`}>이름</label>
            <input
              id={`wp-name-${workProject.id}`}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => {
                const trimmed = name.trim();
                if (trimmed && trimmed !== workProject.name) void save({ name: trimmed });
                else setName(workProject.name);
              }}
            />
            <label htmlFor={`wp-category-${workProject.id}`}>구분</label>
            <div className="work-project-category-row">
              <select
                id={`wp-category-${workProject.id}`}
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  void save({ category: event.target.value });
                }}
              >
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <span className="category-chip">{category}</span>
            </div>
            <label htmlFor={`wp-status-${workProject.id}`}>상태</label>
            <select
              id={`wp-status-${workProject.id}`}
              value={workProject.status ?? ""}
              onChange={(event) =>
                void save({ status: event.target.value === "" ? null : (event.target.value as ProjectStatus) })
              }
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === "" ? "상태 없음" : option}
                </option>
              ))}
            </select>
            <label id={`wp-notion-${workProject.id}`}>노션 페이지</label>
            <div className="work-project-notion-list" role="group" aria-labelledby={`wp-notion-${workProject.id}`}>
              {notionLinks.map((link, index) => (
                <div className="work-project-notion-row" key={index}>
                  <input
                    className="notion-label-input"
                    type="text"
                    value={link.label}
                    placeholder={index === 0 ? "채널" : `${index}차년도`}
                    aria-label={`노션 링크 ${index + 1} 라벨`}
                    onChange={(event) => updateNotionLink(index, { label: event.target.value })}
                    onBlur={() => commitNotionLinks(notionLinks)}
                  />
                  <input
                    type="text"
                    value={link.url}
                    placeholder="https://notion.so/…"
                    aria-label={`노션 링크 ${index + 1} URL`}
                    onChange={(event) => updateNotionLink(index, { url: event.target.value })}
                    onBlur={() => commitNotionLinks(notionLinks)}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    disabled={link.url.trim().length === 0}
                    title={link.url.trim() ? "노션에서 열기" : "URL을 먼저 입력하세요"}
                    aria-label={`노션 링크 ${index + 1} 열기`}
                    onClick={() => onOpenNotion(link.url.trim())}
                  >
                    <ExternalLink size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`노션 링크 ${index + 1} 삭제`}
                    title="링크 삭제"
                    onClick={() => commitNotionLinks(notionLinks.filter((_, at) => at !== index))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="work-project-notion-add"
                onClick={() => setNotionLinks((current) => [...current, { label: "", url: "" }])}
              >
                <Plus size={13} />
                <span>링크 추가</span>
              </button>
            </div>
            <label id={`wp-folders-${workProject.id}`}>참고 로컬 폴더</label>
            <div className="work-project-local-list" role="group" aria-labelledby={`wp-folders-${workProject.id}`}>
              {localFolders.map((folder, index) => (
                <div className="work-project-local-row" key={index}>
                  <input
                    className="link-label-input"
                    type="text"
                    value={folder.label}
                    placeholder="자료 폴더"
                    aria-label={`참고 폴더 ${index + 1} 라벨`}
                    onChange={(event) => updateLocalFolder(index, { label: event.target.value })}
                    onBlur={() => commitLocalFolders(localFolders)}
                  />
                  <input
                    type="text"
                    value={folder.path}
                    placeholder="D:\Work\참고자료"
                    aria-label={`참고 폴더 ${index + 1} 경로`}
                    onChange={(event) => updateLocalFolder(index, { path: event.target.value })}
                    onBlur={() => commitLocalFolders(localFolders)}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    title="폴더 선택"
                    aria-label={`참고 폴더 ${index + 1} 선택`}
                    onClick={() => void chooseLocalFolder(index)}
                  >
                    <FolderPlus size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={folder.path.trim().length === 0}
                    title={folder.path.trim() ? "파일 탐색기에서 열기" : "경로를 먼저 입력하세요"}
                    aria-label={`참고 폴더 ${index + 1} 열기`}
                    onClick={() => onRevealLocalFolder(folder.path.trim())}
                  >
                    <FolderOpen size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`참고 폴더 ${index + 1} 삭제`}
                    title="폴더 삭제"
                    onClick={() => commitLocalFolders(localFolders.filter((_, at) => at !== index))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="work-project-local-add"
                onClick={() => setLocalFolders((current) => [...current, { label: "", path: "" }])}
              >
                <Plus size={13} />
                <span>폴더 추가</span>
              </button>
            </div>
            <label htmlFor={`wp-memo-${workProject.id}`}>메모</label>
            <textarea
              id={`wp-memo-${workProject.id}`}
              className="detail-memo"
              value={memo}
              placeholder="이 프로젝트에 대한 메모…"
              onChange={(event) => setMemo(event.target.value)}
              onBlur={() => {
                if (memo !== workProject.memo) void save({ memo });
              }}
            />
          </div>
        </section>

        <section className="detail-card" aria-label="구성 폴더">
          <div className="detail-card-header">
            <h2>구성 폴더</h2>
          </div>
          {members.length === 0 ? (
            <p className="detail-empty">아직 폴더가 없습니다. 레포나 팀즈 문서 폴더를 추가하세요.</p>
          ) : (
            <ul className="work-project-members">
              {members.map(({ project, role }) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className="member-open"
                    onClick={() => onSelectProject(project.id)}
                    aria-label={`${projectName(project)} 폴더 열기`}
                  >
                    {role === "docs" ? (
                      <TeamsIcon size={14} className="brand-icon-teams" />
                    ) : (
                      <GitHubIcon size={14} className="brand-icon-github" />
                    )}
                    <span className="member-copy">
                      <span className="member-name">
                        {projectName(project)}
                        <span className="member-role">{role === "docs" ? "문서" : "레포"}</span>
                      </span>
                      <span className="member-path" title={project.rootPath}>
                        {project.rootPath}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onRevealProject(project.id)}
                    aria-label={`${projectName(project)} 파일 탐색기에서 열기`}
                    title="파일 탐색기에서 열기"
                  >
                    <FolderOpen size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void removeMember(project.id)}
                    aria-label={`${projectName(project)} 프로젝트에서 제외`}
                    title="프로젝트에서 제외 (폴더 목록에는 남음)"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="detail-actions-row">
            <button type="button" disabled={pending} onClick={() => void addMemberFolder("repo")}>
              <FolderPlus size={14} />
              <span>레포 추가</span>
            </button>
            <button
              type="button"
              disabled={pending}
              title={teamsSyncRoot ? `기본 위치: ${teamsSyncRoot}` : "팀즈 동기화 루트가 설정되지 않았습니다"}
              onClick={() => void addMemberFolder("docs")}
            >
              <BookOpen size={14} />
              <span>팀즈 문서 폴더 추가</span>
            </button>
            {docsMembers.length > 0 ? (
              <button type="button" onClick={() => onRevealProject(docsMembers[0].project.id)}>
                <FolderOpen size={14} />
                <span>팀즈 폴더 열기</span>
              </button>
            ) : null}
          </div>
          <p className="work-project-teams-root">
            팀즈 동기화 루트: <span title={teamsSyncRoot ?? undefined}>{teamsSyncRoot ?? "설정 안 됨"}</span>
            <button type="button" onClick={() => void chooseTeamsRoot()}>
              {teamsSyncRoot ? "변경" : "설정"}
            </button>
          </p>
        </section>

        <section className="detail-card detail-card-sessions" aria-label="소속 세션">
          <h2>소속 세션</h2>
          {sessions.length === 0 ? (
            <p className="detail-empty">구성 폴더에서 시작된 세션이 여기에 표시됩니다</p>
          ) : (
            <ul className="session-card-list">
              {sessions.map((session) => {
                const label = sessionLabel(session, sessions, agents);
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={`session-card status-${session.status}`}
                      onClick={() => onSelectSession(session)}
                      aria-label={`${label} 세션 보기`}
                    >
                      <span className={`status-dot status-${session.status}`} aria-hidden="true" />
                      <span className="session-card-name">{label}</span>
                      <span className="session-card-status">{statusLabels[session.status]}</span>
                      <span className="session-card-updated">{relativeTime(session.updatedAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="detail-card" aria-label="프로젝트 관리">
          <h2>관리</h2>
          <div className="detail-actions-row">
            <button type="button" className="danger-button" onClick={onRemoveWorkProject}>
              <Trash2 size={14} />
              <span>프로젝트 삭제</span>
            </button>
          </div>
          <p className="detail-empty">삭제해도 폴더와 세션은 남고, 소속만 해제됩니다.</p>
        </section>
      </div>
    </section>
  );
}
