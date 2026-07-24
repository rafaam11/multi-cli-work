import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MultiCliWorkApi } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import { WorktreeCreateDialog } from "./WorktreeCreateDialog";

const project = {
  id: "project-1", rootPath: "C:\\repo", displayName: "Repo", sources: ["manual"],
  providerRefs: { claude: [], codex: [] }, status: null, memo: "", tracks: [], hidden: false,
  order: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies SharedProject;

describe("WorktreeCreateDialog", () => {
  it("offers local and remote refs and creates a tracking branch with an editable local name", async () => {
    const create = vi.fn().mockResolvedValue({ id: "wt-1", projectId: project.id, path: "C:\\repo-wt\\topic", branch: "topic", createdAt: project.createdAt, updatedAt: project.updatedAt });
    window.multiCliWork = {
      worktrees: {
        creationOptions: vi.fn().mockResolvedValue({ localBranches: ["main", "busy"], remoteBranches: ["origin/topic"], checkedOutBranches: ["busy"], defaultStartPoint: "main" }),
        previewPath: vi.fn().mockResolvedValue("C:\\repo-wt\\topic"),
        create,
      },
    } as unknown as MultiCliWorkApi;
    render(<WorktreeCreateDialog project={project} onCreated={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "기존 브랜치" }));
    const select = await screen.findByLabelText("기존 브랜치");
    expect(screen.getByRole("option", { name: /busy.*사용 중/ })).toBeDisabled();
    fireEvent.change(select, { target: { value: "remote:origin/topic" } });
    fireEvent.change(screen.getByLabelText("로컬 브랜치 이름"), { target: { value: "topic-local" } });
    await waitFor(() => expect(screen.getByText(/repo-wt/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "만들기" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(project.id, { kind: "remote", remoteRef: "origin/topic", localBranch: "topic-local" }));
  });
});
