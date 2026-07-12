import type { ProviderAvailability, TerminalSessionView, UpdaterStatus } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalKind, TerminalStatus, ToolCommand } from "@shared/terminal-types";
import { Clock, Info, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { GitHubIcon } from "./brand-icons";
import {
  projectName,
  providerAccentClass,
  providerDetails,
  relativeTime,
  sessionLabel,
  statusLabels,
  toolDetails,
  updaterStatusLabel,
} from "./session-labels";

export interface ActivityEntry {
  id: string;
  timestamp: string;
  projectId: string | null;
  sessionId: string;
  sessionLabel: string;
  fromStatus: TerminalStatus;
  toStatus: TerminalStatus;
}

const STATUS_PRIORITY: Record<TerminalStatus, number> = {
  "awaiting-approval": 0,
  "awaiting-input": 1,
  working: 2,
  starting: 3,
  idle: 4,
  exited: 5,
  error: 5,
};

const TERMINAL_KINDS: TerminalKind[] = ["powershell", "claude", "codex"];
const TOOL_COMMANDS: ToolCommand[] = ["claude-update", "codex-update"];
const TOOL_PROVIDER: Record<ToolCommand, TerminalKind> = {
  "claude-update": "claude",
  "codex-update": "codex",
};
const QUICK_LAUNCH_LIMIT = 5;

function sortedSessionMonitor(sessions: TerminalSessionView[]): TerminalSessionView[] {
  return [...sessions].sort(
    (left, right) => STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status] || right.updatedAt.localeCompare(left.updatedAt),
  );
}

function projectActivityTimestamp(project: SharedProject, sessions: TerminalSessionView[]): string {
  const projectSessions = sessions.filter((session) => session.projectId === project.id);
  if (projectSessions.length === 0) return project.createdAt;
  return projectSessions.reduce(
    (latest, session) => (session.updatedAt > latest ? session.updatedAt : latest),
    projectSessions[0].updatedAt,
  );
}

function quickLaunchProjects(projects: SharedProject[], sessions: TerminalSessionView[]): SharedProject[] {
  return [...projects]
    .sort((left, right) =>
      projectActivityTimestamp(right, sessions).localeCompare(projectActivityTimestamp(left, sessions)),
    )
    .slice(0, QUICK_LAUNCH_LIMIT);
}

interface HomeDashboardProps {
  projects: SharedProject[];
  sessions: TerminalSessionView[];
  availability: ProviderAvailability;
  activityLog: ActivityEntry[];
  pendingAction: boolean;
  onSelectSession(session: TerminalSessionView): void;
  onStartSession(project: SharedProject, kind: TerminalKind): void;
  onStartTool(tool: ToolCommand): void;
}

export function HomeDashboard({
  projects,
  sessions,
  availability,
  activityLog,
  pendingAction,
  onSelectSession,
  onStartSession,
  onStartTool,
}: HomeDashboardProps) {
  const [appVersion, setAppVersion] = useState("");
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus>({ state: "idle" });

  useEffect(() => {
    // The first update check starts before this component mounts, so read the current state
    // instead of waiting for an event that may already have fired (same as UpdateBadge).
    void window.multiCliWork.updates.appVersion().then(setAppVersion).catch(() => undefined);
    void window.multiCliWork.updates.status().then(setUpdaterStatus).catch(() => undefined);
    return window.multiCliWork.updates.onEvent(setUpdaterStatus);
  }, []);

  const monitored = sortedSessionMonitor(sessions);
  const launchTargets = quickLaunchProjects(projects, sessions);
  const updaterBusy = updaterStatus.state === "checking" || updaterStatus.state === "downloading";
  const updaterDownloaded = updaterStatus.state === "downloaded";

  return (
    <section className="home-dashboard" aria-label="홈 대시보드">
      <div className="home-grid">
        <section className="home-card home-card-monitor" aria-label="세션 모니터">
          <h2>세션 모니터</h2>
          {monitored.length === 0 ? (
            <p className="home-empty">아직 세션이 없습니다</p>
          ) : (
            <ul className="monitor-list">
              {monitored.map((session) => {
                const peers = sessions.filter((candidate) => candidate.projectId === session.projectId);
                const label = sessionLabel(session, peers);
                const project = projects.find((candidate) => candidate.id === session.projectId) ?? null;
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={`monitor-row status-${session.status}`}
                      onClick={() => onSelectSession(session)}
                      aria-label={`${label} 세션으로 이동`}
                    >
                      <span className={`status-dot status-${session.status}`} aria-hidden="true" />
                      <span className="monitor-copy">
                        <span className="monitor-name">{label}</span>
                        <span className="monitor-project">{project ? projectName(project) : "도구"}</span>
                      </span>
                      <span className="monitor-status">{statusLabels[session.status]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="home-card" aria-label="CLI 및 업데이트 상태">
          <h2>CLI &amp; 업데이트</h2>
          <ul className="cli-status-list">
            {TERMINAL_KINDS.map((kind) => {
              const details = providerDetails[kind];
              const Icon = details.icon;
              return (
                <li key={kind} className={availability[kind] ? "installed" : "missing"}>
                  <Icon size={14} className={providerAccentClass[kind]} />
                  <span>{details.label}</span>
                  <span className="cli-status-value">{availability[kind] ? "설치됨" : "찾을 수 없음"}</span>
                </li>
              );
            })}
          </ul>
          <div className="tool-update-row">
            {TOOL_COMMANDS.map((tool) => {
              const installed = availability[TOOL_PROVIDER[tool]];
              return (
                <button key={tool} type="button" disabled={!installed || pendingAction} onClick={() => onStartTool(tool)}>
                  <Wrench size={13} />
                  <span>{toolDetails[tool].menuLabel}</span>
                </button>
              );
            })}
          </div>
          <div className="app-update-row">
            <span className={`update-status ${updaterStatus.state}`}>{updaterStatusLabel(updaterStatus)}</span>
            <button
              type="button"
              disabled={updaterBusy}
              onClick={() =>
                void (updaterDownloaded ? window.multiCliWork.updates.install() : window.multiCliWork.updates.check())
              }
            >
              {updaterDownloaded ? "재시작" : "확인"}
            </button>
          </div>
        </section>

        <section className="home-card" aria-label="빠른 실행">
          <h2>빠른 실행</h2>
          {launchTargets.length === 0 ? (
            <p className="home-empty">폴더를 열면 여기에 표시됩니다</p>
          ) : (
            <ul className="quick-launch-list">
              {launchTargets.map((project) => (
                <li key={project.id}>
                  <span className="quick-launch-name" title={project.rootPath}>
                    {projectName(project)}
                  </span>
                  <span className="quick-launch-actions">
                    {TERMINAL_KINDS.map((kind) => {
                      const details = providerDetails[kind];
                      const Icon = details.icon;
                      return (
                        <button
                          key={kind}
                          type="button"
                          disabled={!availability[kind] || pendingAction}
                          title={details.menuLabel}
                          aria-label={`${projectName(project)}에서 ${details.label} 시작`}
                          onClick={() => onStartSession(project, kind)}
                        >
                          <Icon size={13} className={providerAccentClass[kind]} />
                        </button>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="home-card" aria-label="최근 활동">
          <h2>최근 활동</h2>
          {activityLog.length === 0 ? (
            <p className="home-empty">아직 이 세션에 활동이 없습니다</p>
          ) : (
            <ul className="activity-feed">
              {activityLog.map((entry) => {
                const session = sessions.find((candidate) => candidate.id === entry.sessionId);
                const label = session
                  ? sessionLabel(session, sessions.filter((candidate) => candidate.projectId === session.projectId))
                  : entry.sessionLabel;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={`activity-row status-${entry.toStatus}`}
                      onClick={() => {
                        if (session) onSelectSession(session);
                      }}
                    >
                      <Clock size={12} aria-hidden="true" />
                      <span className="activity-copy">
                        <span className="activity-name">{label}</span>
                        <span className="activity-transition">
                          {statusLabels[entry.fromStatus]} &rarr; {statusLabels[entry.toStatus]}
                        </span>
                      </span>
                      <span className="activity-time">{relativeTime(entry.timestamp)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="home-card home-card-app" aria-label="앱 및 시스템 바로가기">
          <h2>멀티 터미널 작업기</h2>
          <p className="app-version-line">
            <Info size={13} aria-hidden="true" />
            <span>v{appVersion}</span>
          </p>
          <div className="app-shortcut-row">
            <button type="button" onClick={() => void window.multiCliWork.updates.openReleases()}>
              <GitHubIcon size={13} />
              <span>릴리스 노트</span>
            </button>
            <button type="button" onClick={() => void window.multiCliWork.updates.openRepository()}>
              <GitHubIcon size={13} />
              <span>GitHub 저장소</span>
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
