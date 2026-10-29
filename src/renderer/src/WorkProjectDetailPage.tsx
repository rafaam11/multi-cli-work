import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView, WorkProjectMemberFolderAddResult, WorkProjectMetadataPatch } from "@shared/api-types";
import type { NotionLinkCheck } from "@shared/notion-types";
import type { ProjectTagsV1 } from "@shared/project-tags-types";
import type { ProjectStatus, SharedProject } from "@shared/project-types";
import type {
  WorkProject,
  WorkProjectLocalFolder,
  WorkProjectNotionLink,
  WorkProjectRegistryV1,
  WorkProjectRole,
} from "@shared/work-project-types";
import type { ProjectFolderTemplate } from "@shared/folder-template";
import type { ProjectCategorySetting } from "@shared/settings-types";
import { AlertTriangle, BookOpen, Check, ExternalLink, FolderOpen, FolderPlus, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { withCategoryPrefix, prefixMismatch } from "@shared/category-code";
import { GitHubIcon, TeamsIcon } from "./brand-icons";
import { DocsFolderIcon } from "./docs-folder-icon";
import { WorkProjectDriveCard } from "./WorkProjectDriveCard";
import { WorkProjectRepoSyncCard } from "./WorkProjectRepoSyncCard";
import { subscribeNotionTokenStatus } from "./notion-token-status";
import { projectName, relativeTime, sessionLabel, statusLabels } from "./session-labels";
import { TagEditor } from "./TagEditor";
import { categoryAccentClass } from "./work-project-accent";
import { errorMessage } from "./ipc-error";
import { TaskPanel } from "./herdr/TaskPanel";
import { HostTerminalPane } from "./herdr/HostTerminalPane";

const STATUS_OPTIONS: Array<ProjectStatus | ""> = ["", "진행중", "보류", "완료", "보관"];

const AUTOSAVE_DELAY_MS = 400;

/** 저장 디바운스보다 길다 — URL을 타이핑하는 동안 조회와 저장이 매 글자마다 연쇄되지 않게 한다. */
const NOTION_CHECK_DELAY_MS = 800;

/** 자동 조회가 덮어써도 되는 라벨. 그 밖의 라벨은 사람이 지은 것으로 보고 건드리지 않는다. */
const AUTO_FILLABLE_LABELS = new Set(["", "노션"]);

/**
 * URL별 마지막 검증 결과. 사이드바를 오가면 이 페이지는 통째로 언마운트되므로(App의 `key={id}`)
 * 모듈 스코프에 둬야 같은 링크를 매번 다시 묻지 않는다. 앱을 껐다 켜면 비워진다 — 노션 쪽 공유
 * 설정은 언제든 바뀔 수 있어서 오래 들고 있을 값이 아니다.
 */
const notionCheckCache = new Map<string, NotionLinkCheck>();

/**
 * Saves an edited value a moment after it stops changing, and immediately when the row loses focus
 * or the page goes away. Returns that immediate save.
 *
 * The trigger is the value itself, not the blur: a Korean IME whose composition is still open when
 * focus leaves commits the finished text *after* the blur, so a handler reading the row at blur time
 * sees the pre-edit value, decides nothing changed, and drops the edit — which is exactly how a
 * renamed Notion label came back as "노션" on the next launch.
 */
function useAutosave(signature: string, savedSignature: string, save: () => void): () => void {
  const saveRef = useRef(save);
  const pendingRef = useRef<string | null>(null);
  const sentRef = useRef<string | null>(null);
  // Kept on the latest render so a flush always writes what is on screen now, late input included.
  saveRef.current = save;
  pendingRef.current = signature === savedSignature ? null : signature;

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (pending === null || pending === sentRef.current) return;
    sentRef.current = pending;
    saveRef.current();
  }, []);

  useEffect(() => {
    if (signature === savedSignature) return;
    const timer = setTimeout(flush, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [signature, savedSignature, flush]);

  // Picking another sidebar entry replaces this page outright, without ever blurring the row.
  useEffect(() => () => flush(), [flush]);

  return flush;
}

interface WorkProjectDetailPageProps {
  workProject: WorkProject;
  /** Member folders resolved against the project registry, in sidebar order. */
  members: Array<{ project: SharedProject; role: WorkProjectRole }>;
  teamsSyncRoot: string | null;
  /** Sessions belonging to any member folder. */
  sessions: TerminalSessionView[];
  agents: AgentView[];
  /** 이 업무 프로젝트에 붙은 자유 태그. App이 레지스트리에서 내려준다. */
  tags: readonly string[];
  /** 다른 업무 프로젝트가 이미 쓰고 있는 태그 — 자동완성 후보. App이 내려준다. */
  tagSuggestions: readonly string[];
  /** 설정의 구분 목록 — select의 선택지이자 색의 근거. 목록에 없는 현재 값도 선택지에 남는다. */
  categories: readonly ProjectCategorySetting[];
  /** 설정의 폴더 템플릿 — 드라이브 폴더를 만들 때 고른다. */
  folderTemplates: readonly ProjectFolderTemplate[];
  onSelectSession(session: TerminalSessionView): void;
  onSelectProject(projectId: string): void;
  onRegistryChanged(registry: WorkProjectRegistryV1): void;
  onMemberFolderAdded(result: WorkProjectMemberFolderAddResult): void;
  /** 문서 폴더를 드라이브로 옮겨 단 뒤 바뀐 폴더 항목을 위로 올린다. */
  onProjectRelinked(project: SharedProject): void;
  /** 드라이브 루트를 찾지 못했을 때 설정의 PC 루트 탭을 연다. */
  onOpenPcSettings(): void;
  onRemoveWorkProject(): void;
  onOpenNotion(url: string): void;
  onRevealProject(projectId: string): void;
  onRevealLocalFolder(folderPath: string): void;
  /** 태그 저장이 돌려준 레지스트리를 위로 올린다. App이 배선한다. */
  onTagsChanged(registry: ProjectTagsV1): void;
}

export function WorkProjectDetailPage({
  workProject,
  members,
  teamsSyncRoot,
  sessions,
  agents,
  tags: savedTags,
  tagSuggestions,
  categories,
  folderTemplates,
  onSelectSession,
  onSelectProject,
  onRegistryChanged,
  onMemberFolderAdded,
  onProjectRelinked,
  onOpenPcSettings,
  onRemoveWorkProject,
  onOpenNotion,
  onRevealProject,
  onRevealLocalFolder,
  onTagsChanged,
}: WorkProjectDetailPageProps) {
  const [name, setName] = useState(workProject.name);
  const [taskTerminal, setTaskTerminal] = useState<string | null>(null);
  const [category, setCategory] = useState(workProject.category);
  const [notionLinks, setNotionLinks] = useState<WorkProjectNotionLink[]>(workProject.notionLinks);
  const [localFolders, setLocalFolders] = useState<WorkProjectLocalFolder[]>(workProject.localFolders);
  const [memo, setMemo] = useState(workProject.memo);
  const [tags, setTags] = useState<string[]>([...savedTags]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notionTokenReady, setNotionTokenReady] = useState<boolean | null>(null);
  const [notionChecks, setNotionChecks] = useState<Record<string, NotionLinkCheck>>({});
  const [notionInFlight, setNotionInFlight] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [notionError, setNotionError] = useState<string | null>(null);

  useEffect(() => {
    // Only resync on a genuine work project switch (same reasoning as ProjectDetailPage).
    setName(workProject.name);
    setCategory(workProject.category);
    setNotionLinks(workProject.notionLinks);
    setLocalFolders(workProject.localFolders);
    setMemo(workProject.memo);
  }, [workProject.id]);

  // 태그는 업무 프로젝트가 아니라 별도 레지스트리에 살아서, 프로젝트를 바꾸지 않아도 위에서
  // 새 목록이 내려온다(저장 응답, 다른 화면의 편집). 그때마다 화면을 그 값에 맞춘다.
  const savedTagsSignature = JSON.stringify(savedTags);
  useEffect(() => {
    setTags([...savedTags]);
  }, [savedTagsSignature]);

  const save = async (patch: WorkProjectMetadataPatch) => {
    setSaveError(null);
    try {
      onRegistryChanged(await window.multiCliWork.workProjects.update(workProject.id, patch));
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  };

  // 칩은 누른 즉시 보여야 해서 화면을 먼저 바꾸고 저장한다. 저장이 실패하면 붙지도 않은 칩이
  // 남지 않도록 되돌린다.
  const saveTags = async (next: string[]) => {
    const previous = tags;
    setTags(next);
    setSaveError(null);
    try {
      onTagsChanged(await window.multiCliWork.projectTags.set(workProject.id, next));
    } catch (error) {
      setTags(previous);
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

  const updateNotionLink = (index: number, patch: Partial<WorkProjectNotionLink>) => {
    setNotionLinks((current) => current.map((link, at) => (at === index ? { ...link, ...patch } : link)));
  };

  const notionLinksRef = useRef(notionLinks);
  notionLinksRef.current = notionLinks;

  useEffect(() => {
    let alive = true;
    window.multiCliWork.notion
      .status()
      .then((status) => {
        if (alive) setNotionTokenReady(status.configured);
      })
      .catch(() => {
        if (alive) setNotionTokenReady(false);
      });
    // 설정 다이얼로그는 이 페이지 위에 열린다 — 토큰을 넣자마자 조회가 살아나야 한다.
    const unsubscribe = subscribeNotionTokenStatus((status) => setNotionTokenReady(status.configured));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  /**
   * 제목 조회가 곧 접근성 검증이다 — 통합이 읽지 못하는 페이지는 노션 MCP도 쓰지 못한다.
   * 자동 조회(force=false)는 비어 있거나 기본값인 라벨만 채우고, 버튼(force=true)은 항상 덮어쓴다.
   */
  const inspectNotionLink = useCallback(async (index: number, url: string, force: boolean) => {
    if (url.length === 0) return;
    setNotionInFlight((current) => new Set(current).add(url));
    try {
      const check = await window.multiCliWork.notion.inspectLink(url);
      notionCheckCache.set(url, check);
      setNotionChecks((current) => ({ ...current, [url]: check }));
      setNotionError(check.state === "ok" ? null : check.message);
      if (check.state !== "ok" || !check.title) return;
      const title = check.title;
      setNotionLinks((current) =>
        current.map((link, at) => {
          if (link.url.trim() !== url) return link;
          const fillable = force ? at === index : AUTO_FILLABLE_LABELS.has(link.label.trim());
          return fillable ? { ...link, label: title } : link;
        }),
      );
    } catch (error) {
      setNotionError(errorMessage(error));
    } finally {
      setNotionInFlight((current) => {
        const next = new Set(current);
        next.delete(url);
        return next;
      });
    }
  }, []);

  // 진입 직후와 URL 입력이 멎은 뒤, 아직 물어보지 않은 링크만 훑는다. 노션 API 한도가 초당 3회
  // 수준이라 병렬로 돌리지 않고 한 줄씩 기다린다.
  const notionUrlSignature = notionLinks.map((link) => link.url.trim()).join("\n");
  useEffect(() => {
    if (notionTokenReady !== true) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        for (const [index, link] of notionLinksRef.current.entries()) {
          if (cancelled) return;
          const url = link.url.trim();
          if (url.length === 0 || notionCheckCache.has(url)) continue;
          await inspectNotionLink(index, url, false);
        }
      })();
    }, NOTION_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [notionUrlSignature, notionTokenReady, inspectNotionLink]);

  // 캐시에 이미 있는 결과는 다시 물어보지 않고 화면에만 되살린다.
  useEffect(() => {
    const cached: Record<string, NotionLinkCheck> = {};
    for (const link of workProject.notionLinks) {
      const url = link.url.trim();
      const hit = notionCheckCache.get(url);
      if (hit) cached[url] = hit;
    }
    setNotionChecks(cached);
    setNotionError(null);
  }, [workProject.id]);

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

  const updateLocalFolder = (index: number, patch: Partial<WorkProjectLocalFolder>) => {
    setLocalFolders((current) => current.map((folder, at) => (at === index ? { ...folder, ...patch } : folder)));
  };

  const flushNotionLinks = useAutosave(
    normalizedLinks(notionLinks),
    normalizedLinks(workProject.notionLinks),
    () => void save({ notionLinks }),
  );
  const flushLocalFolders = useAutosave(
    normalizedFolders(localFolders),
    normalizedFolders(workProject.localFolders),
    () => void save({ localFolders }),
  );

  // The dialog steals focus, so the row never blurs — the autosave stores the picked path anyway.
  const chooseLocalFolder = async (index: number) => {
    setSaveError(null);
    try {
      const picked = await window.multiCliWork.workProjects.chooseLocalFolder();
      if (picked) {
        setLocalFolders((current) =>
          current.map((folder, at) => (at === index ? { ...folder, path: picked } : folder)),
        );
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

  // 팀즈는 이전 설정으로만 남는다 — 문서는 드라이브로 옮겨 왔으니 새로 고르는 길은 두지 않는다.
  const clearTeamsRoot = async () => {
    setSaveError(null);
    try {
      onRegistryChanged(await window.multiCliWork.workProjects.clearTeamsSyncRoot());
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  };

  // 설정 목록에 현재 값을 더한다 — 목록에서 빠진 옛 구분도 선택지에서 사라지지 않는다. 화면에 없는
  // 값을 담은 select는 다음 저장 때 조용히 값을 바꿔 버린다.
  const categoryNames = categories.map((candidate) => candidate.name);
  const categoryOptions = categoryNames.includes(category) ? categoryNames : [category, ...categoryNames];
  const categorySetting = categories.find((candidate) => candidate.name === category);
  const suggestedName = withCategoryPrefix(workProject.name, categorySetting);
  const showPrefixHint = prefixMismatch(workProject.name, categorySetting) && suggestedName !== workProject.name;
  const repoMembers = members.filter((member) => member.role === "repo");
  const docsMembers = members.filter((member) => member.role === "docs");

  const renderMember = ({ project, role }: { project: SharedProject; role: WorkProjectRole }) => (
    <li key={project.id}>
      <button
        type="button"
        className="member-open"
        onClick={() => onSelectProject(project.id)}
        aria-label={`${projectName(project)} 폴더 열기`}
      >
        {role === "docs" ? (
          <DocsFolderIcon rootPath={project.rootPath} />
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
  );

  // The accent tracks the local `category` state, not the saved one, so the chip and the card edge
  // follow the select the moment it changes rather than only after the write lands.
  return (
    <section
      className={`project-detail work-project-detail ${categoryAccentClass(category, categories)}`}
      aria-label="업무 프로젝트 상세"
    >
      <header className="work-project-hero">
        {categorySetting?.code ? (
          <span className="work-project-code" aria-label={`구분 코드 ${categorySetting.code}`}>
            {categorySetting.code}
          </span>
        ) : null}
        <div className="work-project-hero-copy">
          <h1>{workProject.name}</h1>
          <p>
            <span className="category-chip">{category}</span>
            {workProject.status ? <span className="work-project-hero-status">{workProject.status}</span> : null}
          </p>
        </div>
      </header>
      {saveError ? (
        <p className="detail-save-error" role="alert">
          {saveError}
        </p>
      ) : null}
      {window.mcwV2?.version === 2 && <>
        <TaskPanel projectId={workProject.id} defaultCwd={members[0]?.project.rootPath ?? ""} onOpenTerminal={setTaskTerminal} />
        {taskTerminal && <section style={{height:480,position:"relative"}} aria-label="작업 터미널"><button type="button" onClick={() => setTaskTerminal(null)}>터미널 접기</button><HostTerminalPane sessionId={taskTerminal} /></section>}
      </>}
      <div className="detail-grid work-project-grid">
        <section className="detail-card" aria-label="프로젝트 개요">
          <h2>기본 정보</h2>
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
                {categoryOptions.map((option) => {
                  const code = categories.find((candidate) => candidate.name === option)?.code;
                  return (
                    <option key={option} value={option}>
                      {code ? `${code} · ${option}` : option}
                    </option>
                  );
                })}
              </select>
            </div>
            {showPrefixHint ? (
              <p className="work-project-prefix-hint" role="note">
                <span>
                  이름 접두어가 구분 코드 <strong>{categorySetting?.code}</strong>와 다릅니다. 드라이브 폴더는 이름으로 찾습니다.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setName(suggestedName);
                    void save({ name: suggestedName });
                  }}
                >
                  {suggestedName}(으)로 바꾸기
                </button>
              </p>
            ) : null}
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
            <label id={`wp-tags-${workProject.id}`}>태그</label>
            <div role="group" aria-labelledby={`wp-tags-${workProject.id}`}>
              <TagEditor tags={tags} suggestions={tagSuggestions} onChange={(next) => void saveTags(next)} />
            </div>
          </div>
        </section>

        <WorkProjectDriveCard
          workProject={workProject}
          categories={categories}
          folderTemplates={folderTemplates}
          onMemberFolderAdded={onMemberFolderAdded}
          onProjectRelinked={onProjectRelinked}
          onOpenPcSettings={onOpenPcSettings}
        />

        <section className="detail-card" aria-label="구성 폴더">
          <div className="detail-card-header">
            <h2>
              <GitHubIcon size={14} className="brand-icon-github" />
              <span>코드 · 구성 폴더</span>
            </h2>
          </div>
          {members.length === 0 ? (
            <p className="detail-empty">아직 폴더가 없습니다. 레포를 추가하거나 위에서 드라이브 폴더를 연결하세요.</p>
          ) : (
            <ul className="work-project-members">
              {repoMembers.map(renderMember)}
              {docsMembers.map(renderMember)}
            </ul>
          )}
          <div className="detail-actions-row">
            <button type="button" disabled={pending} onClick={() => void addMemberFolder("repo")}>
              <FolderPlus size={14} />
              <span>레포 추가</span>
            </button>
            <button type="button" disabled={pending} onClick={() => void addMemberFolder("docs")}>
              <BookOpen size={14} />
              <span>다른 문서 폴더 추가</span>
            </button>
          </div>
          {teamsSyncRoot ? (
            <p className="work-project-teams-root">
              <TeamsIcon size={13} className="brand-icon-teams" />
              팀즈 동기화 루트(이전 설정): <span title={teamsSyncRoot}>{teamsSyncRoot}</span>
              <button type="button" onClick={() => void clearTeamsRoot()}>
                해제
              </button>
            </p>
          ) : null}
        </section>

        <WorkProjectRepoSyncCard workProjectId={workProject.id} />

        <section className="detail-card" aria-label="노션">
          <h2 id={`wp-notion-${workProject.id}`}>노션 페이지</h2>
          <div className="work-project-notion-list" role="group" aria-labelledby={`wp-notion-${workProject.id}`}>
            {notionLinks.map((link, index) => {
              const url = link.url.trim();
              const check = url.length > 0 ? notionChecks[url] : undefined;
              const checking = url.length > 0 && notionInFlight.has(url);
              return (
                <div className="work-project-notion-row" key={index}>
                  <input
                    className="notion-label-input"
                    type="text"
                    value={link.label}
                    placeholder={index === 0 ? "채널" : `${index}차년도`}
                    aria-label={`노션 링크 ${index + 1} 라벨`}
                    onChange={(event) => updateNotionLink(index, { label: event.target.value })}
                    onBlur={flushNotionLinks}
                  />
                  <input
                    type="text"
                    value={link.url}
                    placeholder="https://notion.so/…"
                    aria-label={`노션 링크 ${index + 1} URL`}
                    onChange={(event) => updateNotionLink(index, { url: event.target.value })}
                    onBlur={flushNotionLinks}
                  />
                  {check ? (
                    <span
                      className={`notion-link-status ${check.state === "ok" ? "ok" : "warn"}`}
                      role="img"
                      aria-label={
                        check.state === "ok"
                          ? `노션 링크 ${index + 1} 접근 가능`
                          : `노션 링크 ${index + 1} 접근 불가: ${check.message ?? ""}`
                      }
                      title={check.state === "ok" ? check.title ?? "통합이 이 페이지를 읽을 수 있습니다" : check.message ?? ""}
                    >
                      {check.state === "ok" ? <Check size={14} /> : <AlertTriangle size={14} />}
                    </span>
                  ) : (
                    <span className="notion-link-status" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    disabled={url.length === 0 || checking || notionTokenReady !== true}
                    title={
                      notionTokenReady === true
                        ? url.length === 0
                          ? "URL을 먼저 입력하세요"
                          : "제목 다시 가져오기"
                        : "설정 → 노션에서 통합 토큰을 먼저 입력하세요"
                    }
                    aria-label={`노션 링크 ${index + 1} 제목 조회`}
                    onClick={() => void inspectNotionLink(index, url, true)}
                  >
                    <RefreshCw size={14} className={checking ? "spin" : undefined} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={url.length === 0}
                    title={url.length > 0 ? "노션에서 열기" : "URL을 먼저 입력하세요"}
                    aria-label={`노션 링크 ${index + 1} 열기`}
                    onClick={() => onOpenNotion(url)}
                  >
                    <ExternalLink size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`노션 링크 ${index + 1} 삭제`}
                    title="링크 삭제"
                    onClick={() => setNotionLinks((current) => current.filter((_, at) => at !== index))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="work-project-notion-add"
              onClick={() => setNotionLinks((current) => [...current, { label: "", url: "" }])}
            >
              <Plus size={13} />
              <span>링크 추가</span>
            </button>
          </div>
          {notionError ? (
            <p className="detail-save-error" role="alert">
              {notionError}
            </p>
          ) : null}
        </section>

        <section className="detail-card" aria-label="데이터 · 참고 폴더">
          <h2 id={`wp-folders-${workProject.id}`}>데이터 · 참고 폴더</h2>
          <p className="detail-empty">이 PC의 data 루트 등, 프로젝트가 읽기만 하는 로컬 폴더입니다.</p>
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
                  onBlur={flushLocalFolders}
                />
                <input
                  type="text"
                  value={folder.path}
                  placeholder="D:\data\프로젝트"
                  aria-label={`참고 폴더 ${index + 1} 경로`}
                  onChange={(event) => updateLocalFolder(index, { path: event.target.value })}
                  onBlur={flushLocalFolders}
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
                  onClick={() => setLocalFolders((current) => current.filter((_, at) => at !== index))}
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
        </section>

        <section className="detail-card detail-card-notes" aria-label="메모">
          <h2>
            <label htmlFor={`wp-memo-${workProject.id}`}>메모</label>
          </h2>
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
          <p className="detail-empty">삭제해도 폴더·드라이브 파일·세션은 남고, 소속만 해제됩니다.</p>
        </section>
      </div>
    </section>
  );
}
