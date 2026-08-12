import type { AgentView } from "@shared/agent-types";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree } from "@shared/worktree-types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewSessionLauncher } from "./NewSessionLauncher";

afterEach(cleanup);

function agentFixture(id: string, label: string, available: boolean): AgentView {
  return {
    id,
    label,
    commands: [id],
    args: [],
    newSessionArgs: [],
    resumeArgs: [],
    conversationId: "none",
    statusAdapter: "signals",
    titleSource: "none",
    shiftEnter: "enter",
    icon: id,
    accentColor: null,
    builtin: true,
    available,
  };
}

const agents: AgentView[] = [
  agentFixture("powershell", "PowerShell", true),
  agentFixture("claude", "Claude Code", true),
  agentFixture("codex", "Codex", false),
];

const atlas: SharedProject = {
  id: "project-atlas",
  rootPath: "C:\\work\\atlas",
  displayName: "Atlas",
  sources: ["manual"],
  providerRefs: { claude: [], codex: [] },
  status: null,
  memo: "",
  tracks: [],
  hidden: false,
  order: 0,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

const dashboard: SharedProject = { ...atlas, id: "project-dashboard", displayName: "Dashboard", order: 1 };

const worktree: SharedWorktree = {
  id: "worktree-login",
  projectId: atlas.id,
  path: "C:\\work\\atlas-login",
  branch: "feature/login",
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

function renderLauncher(overrides: Partial<Parameters<typeof NewSessionLauncher>[0]> = {}) {
  const props: Parameters<typeof NewSessionLauncher>[0] = {
    x: 100,
    y: 200,
    projects: [atlas, dashboard],
    worktrees: [worktree],
    agents,
    disabledReasonFor: () => null,
    onStart: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<NewSessionLauncher {...props} />), props };
}

describe("NewSessionLauncher", () => {
  it("lists each folder with its worktrees under it, in the order it was given them", () => {
    const { container } = renderLauncher();

    expect([...container.querySelectorAll(".new-session-row-name")].map((row) => row.textContent)).toEqual([
      "Atlas",
      "feature/login",
      "Dashboard",
    ]);
    // A worktree belongs to its folder's group, not to whichever row happens to follow it.
    expect(container.querySelectorAll(".new-session-group")[0]!.querySelectorAll(".worktree-row")).toHaveLength(1);
    expect(container.querySelectorAll(".new-session-group")[1]!.querySelectorAll(".worktree-row")).toHaveLength(0);
  });

  it("starts the agent in the folder its row names, and closes on the way", () => {
    const { props } = renderLauncher();

    fireEvent.click(screen.getByRole("menuitem", { name: "Dashboard에서 Claude Code 시작" }));
    expect(props.onStart).toHaveBeenCalledWith(dashboard, "claude", null);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("carries the worktree id when the branch row is the one pressed", () => {
    const { props } = renderLauncher();

    fireEvent.click(screen.getByRole("menuitem", { name: "Atlas · feature/login에서 PowerShell 시작" }));
    expect(props.onStart).toHaveBeenCalledWith(atlas, "powershell", "worktree-login");
  });

  it("keeps an agent that is not installed visible, and says why it cannot run", () => {
    renderLauncher();
    const button = screen.getByRole("menuitem", { name: "Atlas에서 Codex 시작" }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Codex 실행 파일을 찾을 수 없습니다");
  });

  it("disables a whole folder's row — worktrees included — when it cannot start anything", () => {
    renderLauncher({ disabledReasonFor: (projectId) => (projectId === atlas.id ? "폴더를 찾을 수 없습니다" : null) });

    for (const name of ["Atlas에서 PowerShell 시작", "Atlas · feature/login에서 PowerShell 시작"]) {
      const button = screen.getByRole("menuitem", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.title).toBe("폴더를 찾을 수 없습니다");
    }
    expect((screen.getByRole("menuitem", { name: "Dashboard에서 PowerShell 시작" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("says where folders come from rather than showing an empty box", () => {
    renderLauncher({ projects: [] });
    expect(screen.getByText("폴더를 열면 여기에 표시됩니다")).toBeTruthy();
  });

  it("closes on Escape and on a press outside itself, but not on one inside", () => {
    const { props, container } = renderLauncher();

    fireEvent.mouseDown(container.querySelector(".new-session-launcher")!);
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
