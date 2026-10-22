import type { WorkProjectMemberFolderAddResult } from "@shared/api-types";
import { driveKindLabel } from "@shared/drive-kind";
import type { DriveProjectStatus } from "@shared/drive-types";
import type { ProjectFolderTemplate } from "@shared/folder-template";
import type { SharedProject } from "@shared/project-types";
import type { ProjectCategorySetting } from "@shared/settings-types";
import type { WorkProject } from "@shared/work-project-types";
import { ArrowRight, FolderOpen, FolderPlus, Link2, RefreshCw, Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DocsFolderIcon } from "./docs-folder-icon";
import { DriveKindIcon } from "./drive-kind-icon";
import { useDriveRoot } from "./drive-root-context";
import { FolderTemplatePicker } from "./FolderTemplatePicker";
import { errorMessage } from "./ipc-error";

interface WorkProjectDriveCardProps {
  workProject: WorkProject;
  categories: readonly ProjectCategorySetting[];
  folderTemplates: readonly ProjectFolderTemplate[];
  onMemberFolderAdded(result: WorkProjectMemberFolderAddResult): void;
  onProjectRelinked(project: SharedProject): void;
  onOpenPcSettings(): void;
}

/**
 * 업무 프로젝트 하나 ↔ 드라이브 최상위 폴더 하나. 이름이 같으면 같은 프로젝트다 — 그래서 이 카드는
 * 저장된 링크가 아니라 매번 드라이브를 보고 상태를 정한다(다른 PC에서 만든 폴더도 곧바로 보인다).
 */
export function WorkProjectDriveCard({
  workProject,
  categories,
  folderTemplates,
  onMemberFolderAdded,
  onProjectRelinked,
  onOpenPcSettings,
}: WorkProjectDriveCardProps) {
  const drive = useDriveRoot();
  const driveLabel = driveKindLabel(drive.kind);
  const [status, setStatus] = useState<DriveProjectStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // 템플릿은 프로젝트 구분의 기본값에서 시작하고, 구분이 바뀌면 따라간다.
  const categoryTemplateId = categories.find((category) => category.name === workProject.category)?.templateId ?? null;
  const [templateId, setTemplateId] = useState<string | null>(categoryTemplateId);
  useEffect(() => setTemplateId(categoryTemplateId), [categoryTemplateId]);

  // 이름·멤버가 바뀌면 다시 본다 — 이름이 곧 연결 규칙이고, 연결은 멤버로 남는다.
  const memberSignature = workProject.members.map((member) => `${member.projectId}:${member.role}`).join(",");
  const refresh = useCallback(async () => {
    try {
      setStatus(await window.multiCliWork.drive.status(workProject.id));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [workProject.id]);

  useEffect(() => {
    void refresh();
  }, [refresh, workProject.name, memberSignature]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setPending(true);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const createFolder = () =>
    run(async () => onMemberFolderAdded(await window.multiCliWork.drive.createFolder(workProject.id, { templateId })));
  const linkFolder = () => run(async () => onMemberFolderAdded(await window.multiCliWork.drive.link(workProject.id)));
  const migrate = (projectId: string) =>
    run(async () => onProjectRelinked(await window.multiCliWork.drive.migrateDocs(workProject.id, projectId)));
  const reveal = (subfolder?: string) =>
    run(() => window.multiCliWork.drive.reveal(workProject.id, subfolder));

  return (
    <section className="detail-card work-project-drive-card" aria-label={`문서 · ${driveLabel}`}>
      <div className="detail-card-header">
        <h2>
          <DriveKindIcon kind={drive.kind} size={15} />
          <span>문서 · {driveLabel}</span>
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="드라이브 상태 새로고침"
          title="새로고침"
          disabled={pending}
          onClick={() => void run(async () => undefined)}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {error ? (
        <p className="detail-save-error" role="alert">
          {error}
        </p>
      ) : null}
      {status === null ? (
        <p className="detail-empty">드라이브를 확인하는 중…</p>
      ) : status.root === null ? (
        <div className="drive-card-state">
          <p className="detail-empty">이 PC의 {driveLabel} 폴더를 찾지 못했습니다. 설정에서 위치를 지정하세요.</p>
          <div className="detail-actions-row">
            <button type="button" onClick={onOpenPcSettings}>
              <Settings size={14} />
              <span>PC 루트 설정</span>
            </button>
          </div>
        </div>
      ) : !status.exists ? (
        <div className="drive-card-state">
          <p className="detail-empty">드라이브에 이 프로젝트의 폴더가 아직 없습니다.</p>
          <p className="drive-card-path" title={status.folderPath ?? undefined}>
            <code>{status.folderPath}</code>
          </p>
          <FolderTemplatePicker templates={folderTemplates} value={templateId} onChange={setTemplateId} />
          <div className="detail-actions-row">
            <button type="button" disabled={pending} onClick={() => void createFolder()}>
              <FolderPlus size={14} />
              <span>드라이브 폴더 만들기</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="drive-card-state">
          <p className="drive-card-path" title={status.folderPath ?? undefined}>
            <span className={`drive-link-badge ${status.linkedProjectId ? "linked" : "unlinked"}`}>
              {status.linkedProjectId ? "연결됨" : "미연결"}
            </span>
            <code>{status.folderPath}</code>
          </p>
          {status.linkedProjectId === null ? (
            <p className="detail-empty">문서 폴더로 연결하면 이 폴더에서 세션을 열 수 있고, 세션 브리프에 경로가 들어갑니다.</p>
          ) : null}
          <div className="detail-actions-row">
            {status.linkedProjectId === null ? (
              <button type="button" disabled={pending} onClick={() => void linkFolder()}>
                <Link2 size={14} />
                <span>문서 폴더로 연결</span>
              </button>
            ) : null}
            <button type="button" disabled={pending} onClick={() => void reveal()}>
              <FolderOpen size={14} />
              <span>탐색기에서 열기</span>
            </button>
          </div>
          {status.subfolders.length > 0 ? (
            <div className="drive-subfolders" role="group" aria-label="드라이브 하위 폴더">
              {status.subfolders.map((folder) => (
                <button
                  type="button"
                  key={folder.name}
                  className="drive-subfolder-chip"
                  title={folder.path}
                  disabled={pending}
                  onClick={() => void reveal(folder.name)}
                >
                  {folder.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {status && status.legacyDocs.length > 0 ? (
        <div className="drive-legacy" role="group" aria-label="드라이브 밖 문서 폴더">
          <p className="drive-legacy-title">드라이브 밖에 있는 문서 폴더</p>
          <ul>
            {status.legacyDocs.map((entry) => (
              <li key={entry.projectId}>
                <span className="drive-legacy-from" title={entry.rootPath}>
                  <DocsFolderIcon rootPath={entry.rootPath} />
                  <span className={entry.exists ? undefined : "drive-legacy-missing"}>{entry.rootPath}</span>
                </span>
                {entry.suggestedPath ? (
                  <button
                    type="button"
                    disabled={pending}
                    title={`${entry.rootPath} → ${entry.suggestedPath}`}
                    aria-label={`${entry.rootPath} 드라이브로 전환`}
                    onClick={() => void migrate(entry.projectId)}
                  >
                    <ArrowRight size={13} />
                    <span>드라이브로 전환</span>
                  </button>
                ) : (
                  <span className="detail-empty">드라이브에 옮겨 갈 폴더가 없습니다</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
