import path from "node:path";
import type { HtmlPreviewBounds, WindowZoomAction } from "../shared/api-types";
import type { FileExplorerTarget } from "../shared/file-explorer-types";
import type { ProjectRegistrySnapshot } from "../shared/project-types";
import type { WorkspaceSnapshot } from "../shared/workspace-types";
import type { IpcRegistrar, MainIpcDependencies } from "./ipc-gateways";
import {
  WINDOW_ZOOM_ACTIONS,
  exactObject,
  nonEmptyString,
  integer,
  slotViewsInput,
  validateCreateInput,
  validateCreateToolInput,
  validateResumeInput,
  validateProjectPatch,
  validateWorkProjectPatch,
  memberRole,
  validateFileExplorerTarget,
  validateWorktreeCreateRequest,
  relativePathString,
  validateOpenEntryOptions,
  validateViewBounds,
  validateGitGraphPageOptions,
  validateGitCommitRequest,
  positiveInteger,
  booleanValue,
  exportFileStem,
  exportTimestamp,
  validateRemoteHostAdd,
  validateSettingsPatch,
  validatePullRequestQuery,
  validateReviewFinishRequest,
  validateReviewAnnotationInput,
  externalUrl,
  selectedProject,
  projectForPath,
} from "./ipc-validation";
import { assertNotReviewSession } from "./terminal/review-guard";

export type { IpcRegistrar } from "./ipc-gateways";

export function registerMainIpc(registrar: IpcRegistrar, dependencies: MainIpcDependencies): void {
  // 원격 창처럼 메인 렌더러가 아닌 곳에서 온 요청은 어떤 채널도 받지 않는다.
  const ipc: IpcRegistrar = {
    handle: (channel, listener) =>
      registrar.handle(channel, (event, ...args) => {
        if (dependencies.isTrustedSender && !dependencies.isTrustedSender(event)) {
          throw new Error(`Untrusted sender for ${channel}`);
        }
        return listener(event, ...args);
      }),
  };
  const annotateMissingRoots = async (snapshot: ProjectRegistrySnapshot) => ({
    ...snapshot,
    missingRootProjectIds: await dependencies.projectService.findMissingProjectRoots(snapshot.registry),
  });
  const workspaceSnapshot = async () => annotateMissingRoots(await dependencies.readRegistry());
  const projectRoot = async (projectId: string) => {
    const { registry } = await dependencies.readRegistry();
    return selectedProject(registry, projectId).rootPath;
  };

  ipc.handle("projects:list", () => workspaceSnapshot());
  ipc.handle("projects:add-folder", async () => {
    const rootPath = await dependencies.chooseDirectory();
    if (!rootPath) return null;
    const current = await dependencies.readRegistry();
    const owner = await dependencies.worktrees.ownerForPath(rootPath, Object.values(current.registry.projects));
    if (owner) {
      return { project: selectedProject(current.registry, owner.projectId), worktreeId: owner.worktreeId };
    }
    const registry = await dependencies.projectService.registerManualFolder(rootPath, path.basename(rootPath));
    return { project: projectForPath(registry, rootPath), worktreeId: null };
  });
  ipc.handle("projects:update", async (_event, projectId: unknown, patch: unknown) => {
    const id = nonEmptyString(projectId, "Project id");
    return selectedProject(await dependencies.projectService.updateProjectMetadata(id, validateProjectPatch(patch)), id);
  });
  // Returns the whole snapshot, not one project: a reorder rewrites `order` across the list.
  ipc.handle("projects:reorder", async (_event, orderedIds: unknown) => {
    if (!Array.isArray(orderedIds)) throw new Error("Project order must be an array of project ids");
    await dependencies.projectService.reorderProjects(
      orderedIds.map((id) => nonEmptyString(id, "Project id")),
    );
    return workspaceSnapshot();
  });
  ipc.handle("projects:remove", async (_event, projectId: unknown) => {
    const id = nonEmptyString(projectId, "Project id");
    // Sessions first: unregistering the folder before its sessions are torn down would strand
    // any surviving PTY with no UI left to reach it.
    await dependencies.coordinator.removeProjectSessions(id);
    await dependencies.projectService.removeProject(id);
    // Work projects last: a dangling member is harmless (ignored on read) while a half-removed
    // project is not, so the ordering favors the registry that owns the folder.
    await dependencies.workProjectService.removeProjectReferences(id);
    return workspaceSnapshot();
  });
  ipc.handle("projects:restore-backup", async () => {
    await dependencies.restoreRegistryBackup();
    return workspaceSnapshot();
  });
  ipc.handle("projects:relink", async (_event, projectId: unknown) => {
    const id = nonEmptyString(projectId, "Project id");
    // A moved folder is usually a sibling of where it was, so the picker starts beside the old
    // root rather than at the OS default. Electron ignores a defaultPath that no longer exists.
    const rootPath = await dependencies.chooseDirectory(path.dirname(await projectRoot(id)));
    if (!rootPath) return null;
    return selectedProject(await dependencies.projectService.relinkProject(id, rootPath), id);
  });
  ipc.handle("projects:reveal", async (_event, projectId: unknown) =>
    dependencies.projectActions.reveal(await projectRoot(nonEmptyString(projectId, "Project id"))),
  );
  ipc.handle("projects:open-editor", async (_event, projectId: unknown) =>
    dependencies.projectActions.openInEditor(await projectRoot(nonEmptyString(projectId, "Project id"))),
  );
  ipc.handle("projects:open-github", async (_event, projectId: unknown) =>
    dependencies.projectActions.openOnGitHub(await projectRoot(nonEmptyString(projectId, "Project id"))),
  );
  ipc.handle("projects:git-status", async (_event, projectId: unknown) =>
    dependencies.projectActions.gitStatus(await projectRoot(nonEmptyString(projectId, "Project id"))),
  );
  ipc.handle("projects:git-diff", async (_event, projectId: unknown) =>
    dependencies.projectActions.gitDiff(await projectRoot(nonEmptyString(projectId, "Project id"))),
  );

  ipc.handle("work-projects:list", () => dependencies.readWorkProjectRegistry());
  ipc.handle("work-projects:create", async (_event, input: unknown) => {
    const parsed = exactObject(input, ["name", "category"], "Work project create input");
    return dependencies.workProjectService.createWorkProject({
      name: nonEmptyString(parsed.name, "Work project name"),
      ...(parsed.category !== undefined ? { category: nonEmptyString(parsed.category, "Work project category") } : {}),
    });
  });
  ipc.handle("work-projects:update", async (_event, workProjectId: unknown, patch: unknown) =>
    dependencies.workProjectService.updateWorkProjectMetadata(
      nonEmptyString(workProjectId, "Work project id"),
      validateWorkProjectPatch(patch),
    ),
  );
  ipc.handle("work-projects:remove", async (_event, workProjectId: unknown) =>
    dependencies.workProjectService.removeWorkProject(nonEmptyString(workProjectId, "Work project id")),
  );
  ipc.handle("work-projects:add-member", async (_event, workProjectId: unknown, projectId: unknown, role: unknown) =>
    dependencies.workProjectService.addMember(
      nonEmptyString(workProjectId, "Work project id"),
      nonEmptyString(projectId, "Project id"),
      memberRole(role),
    ),
  );
  ipc.handle("work-projects:remove-member", async (_event, workProjectId: unknown, projectId: unknown) =>
    dependencies.workProjectService.removeMember(
      nonEmptyString(workProjectId, "Work project id"),
      nonEmptyString(projectId, "Project id"),
    ),
  );
  ipc.handle("work-projects:reorder", async (_event, orderedIds: unknown) => {
    if (!Array.isArray(orderedIds)) throw new Error("Work project order must be an array of ids");
    return dependencies.workProjectService.reorderWorkProjects(
      orderedIds.map((id) => nonEmptyString(id, "Work project id")),
    );
  });
  // One step for "add a repo/Teams folder to this work project": dialog → register → membership.
  // The docs picker starts at the Teams sync root so the user lands in the right OneDrive tree.
  ipc.handle("work-projects:add-member-folder", async (_event, workProjectId: unknown, role: unknown) => {
    const id = nonEmptyString(workProjectId, "Work project id");
    const memberRoleValue = memberRole(role);
    const teamsRoot = (await dependencies.readWorkProjectRegistry()).teamsSyncRoot;
    const rootPath = await dependencies.chooseDirectory(
      memberRoleValue === "docs" && teamsRoot ? teamsRoot : undefined,
    );
    if (!rootPath) return null;
    // Same guard as projects:add-folder — a linked worktree directory belongs to its project and
    // must not be registered as a second folder entry.
    const current = await dependencies.readRegistry();
    const owner = await dependencies.worktrees.ownerForPath(rootPath, Object.values(current.registry.projects));
    const project = owner
      ? selectedProject(current.registry, owner.projectId)
      : projectForPath(
          await dependencies.projectService.registerManualFolder(rootPath, path.basename(rootPath)),
          rootPath,
        );
    const workProjects = await dependencies.workProjectService.addMember(id, project.id, memberRoleValue);
    return { project, workProjects };
  });
  // Picks a reference folder without touching either registry: the renderer drops the path into its
  // row and commits it through work-projects:update, so local folders keep a single write path.
  ipc.handle("work-projects:choose-local-folder", () => dependencies.chooseDirectory());
  // The renderer names a folder the work project already stores; it never hands over a free path.
  // Same reasoning as projects:reveal resolving a project id rather than accepting a root path.
  ipc.handle("work-projects:reveal-local-folder", async (_event, workProjectId: unknown, folderPath: unknown) => {
    const id = nonEmptyString(workProjectId, "Work project id");
    const target = nonEmptyString(folderPath, "Local folder path");
    const workProject = (await dependencies.readWorkProjectRegistry()).workProjects[id];
    if (!workProject) throw new Error(`Work project ${id} was not found`);
    if (!workProject.localFolders.some((folder) => folder.path === target)) {
      throw new Error(`Local folder is not registered on work project ${id}`);
    }
    return dependencies.projectActions.reveal(target);
  });
  ipc.handle("work-projects:choose-teams-root", async () => {
    const rootPath = await dependencies.chooseDirectory();
    if (!rootPath) return null;
    return dependencies.workProjectService.setTeamsSyncRoot(rootPath);
  });
  ipc.handle("work-projects:clear-teams-root", () => dependencies.workProjectService.setTeamsSyncRoot(null));

  ipc.handle("project-tags:list", () => dependencies.projectTags.list());
  ipc.handle("project-tags:set", async (_event, workProjectId: unknown, tags: unknown) => {
    if (!Array.isArray(tags)) throw new Error("Project tags must be an array");
    // 빈 문자열은 여기서 거부하지 않는다 — 지우는 일은 normalizeTags의 몫이고, 칩 편집기가
    // 공백 하나를 흘렸다고 오류 배너가 뜨면 안 된다.
    return dependencies.projectTags.set(
      nonEmptyString(workProjectId, "Work project id"),
      tags.map((tag) => {
        if (typeof tag !== "string") throw new Error("Project tag must be a string");
        return tag;
      }),
    );
  });

  // 워크스페이스 루트를 바꾸면 업무 프로젝트 묶음도 따라 바뀌므로, 두 스냅샷을 함께 돌려준다.
  const workspaceResult = async (workspace: WorkspaceSnapshot) => ({
    workspace,
    workProjects: await dependencies.readWorkProjectRegistry(),
  });
  ipc.handle("workspace:list", () => dependencies.workspace.snapshot());
  ipc.handle("workspace:add", async () => {
    const rootPath = await dependencies.chooseDirectory();
    if (!rootPath) return null;
    await dependencies.workspace.addRoot(rootPath);
    // 새 루트의 셸을 업무 프로젝트로 옮겨 적고 나서 결과를 준다 — 두 번 왕복할 이유가 없다.
    return workspaceResult(await dependencies.workspace.sync());
  });
  // 렌더러는 이미 등록된 루트만 지목한다. 자유 경로를 받지 않는 것은 projects:reveal과 같은 이유다.
  ipc.handle("workspace:remove", async (_event, rootPath: unknown) =>
    workspaceResult(await dependencies.workspace.removeRoot(nonEmptyString(rootPath, "Workspace root path"))),
  );
  ipc.handle("workspace:sync", async () => workspaceResult(await dependencies.workspace.sync()));

  const worktreePath = async (worktreeId: unknown) => {
    const id = nonEmptyString(worktreeId, "Worktree id");
    const worktree = await dependencies.worktrees.get(id);
    if (!worktree) throw new Error(`Unknown worktree: ${id}`);
    return worktree.path;
  };
  ipc.handle("worktrees:list", () => dependencies.worktrees.list());
  ipc.handle("worktrees:sync", async () => {
    const { registry } = await dependencies.readRegistry();
    return dependencies.worktrees.sync(Object.values(registry.projects));
  });
  ipc.handle("worktrees:creation-options", (_event, projectId: unknown) =>
    dependencies.worktrees.creationOptions(nonEmptyString(projectId, "Project id")),
  );
  ipc.handle("worktrees:preview-path", (_event, projectId: unknown, branch: unknown) =>
    dependencies.worktrees.previewPath(
      nonEmptyString(projectId, "Project id"),
      nonEmptyString(branch, "Branch name"),
    ),
  );
  ipc.handle("worktrees:create", (_event, projectId: unknown, request: unknown) =>
    dependencies.worktrees.create(
      nonEmptyString(projectId, "Project id"),
      validateWorktreeCreateRequest(request),
    ),
  );
  ipc.handle("worktrees:unlock", (_event, worktreeId: unknown) =>
    dependencies.worktrees.unlock(nonEmptyString(worktreeId, "Worktree id")),
  );
  ipc.handle("worktrees:cleanup-stale", (_event, projectId: unknown) =>
    dependencies.worktrees.cleanupStale(nonEmptyString(projectId, "Project id")),
  );
  ipc.handle("worktrees:remove", async (_event, worktreeId: unknown, force: unknown) => {
    if (typeof force !== "boolean") throw new Error("Worktree remove force flag must be a boolean");
    const id = nonEmptyString(worktreeId, "Worktree id");
    if ((await dependencies.github.activeReviews()).some((review) => review.worktreeId === id)) {
      throw new Error("진행 중인 PR 리뷰 worktree는 '리뷰 완료' 흐름에서 정리하세요.");
    }
    return dependencies.worktrees.remove(id, force);
  });
  ipc.handle("worktrees:reveal", async (_event, worktreeId: unknown) =>
    dependencies.projectActions.reveal(await worktreePath(worktreeId)),
  );
  ipc.handle("worktrees:open-editor", async (_event, worktreeId: unknown) =>
    dependencies.projectActions.openInEditor(await worktreePath(worktreeId)),
  );
  ipc.handle("worktrees:git-status", async (_event, worktreeId: unknown) =>
    dependencies.projectActions.gitStatus(await worktreePath(worktreeId)),
  );
  ipc.handle("worktrees:git-diff", async (_event, worktreeId: unknown) =>
    dependencies.projectActions.gitDiff(await worktreePath(worktreeId)),
  );

  const rootPathForTarget = (target: FileExplorerTarget) =>
    target.kind === "project" ? projectRoot(target.id) : worktreePath(target.id);
  ipc.handle("workspace-files:list-directory", async (_event, target: unknown, relativePath: unknown) =>
    dependencies.workspaceFiles.listDirectory(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
    ),
  );
  ipc.handle("workspace-files:read-file", async (_event, target: unknown, relativePath: unknown) =>
    dependencies.workspaceFiles.readFile(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
    ),
  );
  ipc.handle("workspace-files:write-file", async (_event, target: unknown, relativePath: unknown, content: unknown) => {
    if (typeof content !== "string") throw new Error("File content must be a string");
    return dependencies.workspaceFiles.writeFile(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
      content,
    );
  });
  // The context menu's own calls. The name is only checked for its type here; what a file system
  // will accept is workspace-files.ts's business, next to the root guard it belongs with.
  ipc.handle("workspace-files:absolute-path", async (_event, target: unknown, relativePath: unknown) =>
    dependencies.workspaceFiles.absolutePath(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
    ),
  );
  ipc.handle("workspace-files:reveal", async (_event, target: unknown, relativePath: unknown) =>
    dependencies.workspaceFiles.reveal(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
    ),
  );
  ipc.handle("workspace-files:open-in-editor", async (_event, target: unknown, relativePath: unknown) =>
    dependencies.workspaceFiles.openInEditor(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
    ),
  );
  ipc.handle(
    "workspace-files:create",
    async (_event, target: unknown, parentRelativePath: unknown, name: unknown, kind: unknown) => {
      if (kind !== "file" && kind !== "directory") throw new Error("Entry kind must be 'file' or 'directory'");
      return dependencies.workspaceFiles.create(
        await rootPathForTarget(validateFileExplorerTarget(target)),
        relativePathString(parentRelativePath),
        nonEmptyString(name, "Entry name"),
        kind,
      );
    },
  );
  ipc.handle("workspace-files:rename", async (_event, target: unknown, relativePath: unknown, name: unknown) =>
    dependencies.workspaceFiles.rename(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
      nonEmptyString(name, "Entry name"),
    ),
  );
  ipc.handle("workspace-files:duplicate", async (_event, target: unknown, relativePath: unknown) =>
    dependencies.workspaceFiles.duplicate(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
    ),
  );
  ipc.handle("workspace-files:trash", async (_event, target: unknown, relativePath: unknown) =>
    dependencies.workspaceFiles.trash(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
    ),
  );
  const targetRoot = (target: unknown) => rootPathForTarget(validateFileExplorerTarget(target));
  ipc.handle("git:panel-data", async (_event, target: unknown) => dependencies.git.panelData(await targetRoot(target)));
  ipc.handle("git:checkout", async (_event, target: unknown, branch: unknown) =>
    dependencies.git.checkout(await targetRoot(target), nonEmptyString(branch, "Branch name")),
  );
  ipc.handle("git:create-branch", async (_event, target: unknown, branch: unknown) =>
    dependencies.git.createBranch(await targetRoot(target), nonEmptyString(branch, "Branch name")),
  );
  ipc.handle("git:commit", async (_event, target: unknown, request: unknown) =>
    dependencies.git.commit(await targetRoot(target), validateGitCommitRequest(request)),
  );
  ipc.handle("git:push", async (_event, target: unknown) => dependencies.git.push(await targetRoot(target)));
  ipc.handle("git:fetch", async (_event, target: unknown) => dependencies.git.fetch(await targetRoot(target)));
  ipc.handle("git:pull", async (_event, target: unknown) => dependencies.git.pull(await targetRoot(target)));
  ipc.handle("git:file-original", async (_event, target: unknown, relativePath: unknown) =>
    dependencies.git.fileOriginal(await targetRoot(target), nonEmptyString(relativePath, "Relative path")),
  );
  ipc.handle("github:remotes", (_event, projectId: unknown) =>
    dependencies.github.remotes(nonEmptyString(projectId, "Project id")));
  ipc.handle("github:status", (_event, projectId: unknown, remoteName: unknown) =>
    dependencies.github.status(nonEmptyString(projectId, "Project id"), nonEmptyString(remoteName, "Remote name")));
  ipc.handle("github:authenticate", (_event, projectId: unknown, remoteName: unknown) =>
    dependencies.github.authenticate(nonEmptyString(projectId, "Project id"), nonEmptyString(remoteName, "Remote name")));
  ipc.handle("github:list", (_event, projectId: unknown, remoteName: unknown, query: unknown) =>
    dependencies.github.list(nonEmptyString(projectId, "Project id"), nonEmptyString(remoteName, "Remote name"), validatePullRequestQuery(query)));
  ipc.handle("github:detail", (_event, projectId: unknown, remoteName: unknown, prNumber: unknown) =>
    dependencies.github.detail(nonEmptyString(projectId, "Project id"), nonEmptyString(remoteName, "Remote name"), positiveInteger(prNumber, "PR number")));
  ipc.handle("github:diff", (_event, projectId: unknown, remoteName: unknown, prNumber: unknown) =>
    dependencies.github.diff(nonEmptyString(projectId, "Project id"), nonEmptyString(remoteName, "Remote name"), positiveInteger(prNumber, "PR number")));
  ipc.handle("github:comment", (_event, projectId: unknown, remoteName: unknown, prNumber: unknown, body: unknown) =>
    dependencies.github.comment(nonEmptyString(projectId, "Project id"), nonEmptyString(remoteName, "Remote name"), positiveInteger(prNumber, "PR number"), nonEmptyString(body, "Comment body")));
  ipc.handle("github:reply", (_event, projectId: unknown, remoteName: unknown, prNumber: unknown, commentId: unknown, body: unknown) =>
    dependencies.github.reply(nonEmptyString(projectId, "Project id"), nonEmptyString(remoteName, "Remote name"), positiveInteger(prNumber, "PR number"), nonEmptyString(commentId, "Comment id"), nonEmptyString(body, "Comment body")));
  ipc.handle("github:active-reviews", () => dependencies.github.activeReviews());
  ipc.handle("github:start-review", (_event, projectId: unknown, remoteName: unknown, prNumber: unknown, agent: unknown) => {
    if (agent !== "claude" && agent !== "codex") throw new Error("Review agent is invalid");
    return dependencies.github.startReview(nonEmptyString(projectId, "Project id"), nonEmptyString(remoteName, "Remote name"), positiveInteger(prNumber, "PR number"), agent);
  });
  ipc.handle("github:refill-review", (_event, reviewId: unknown) =>
    dependencies.github.refillReview(nonEmptyString(reviewId, "Review id")));
  ipc.handle("github:finish-review", (_event, reviewId: unknown, request: unknown) =>
    dependencies.github.finishReview(nonEmptyString(reviewId, "Review id"), validateReviewFinishRequest(request)));
  ipc.handle("github:annotations", (_event, projectId: unknown, remoteName: unknown, prNumber: unknown) =>
    dependencies.github.annotations(nonEmptyString(projectId, "Project id"), nonEmptyString(remoteName, "Remote name"), positiveInteger(prNumber, "PR number")));
  ipc.handle("github:upsert-annotation", (_event, projectId: unknown, remoteName: unknown, prNumber: unknown, input: unknown) =>
    dependencies.github.upsertAnnotation(nonEmptyString(projectId, "Project id"), nonEmptyString(remoteName, "Remote name"), positiveInteger(prNumber, "PR number"), validateReviewAnnotationInput(input)));
  ipc.handle("github:delete-annotation", (_event, projectId: unknown, remoteName: unknown, prNumber: unknown, annotationId: unknown) =>
    dependencies.github.deleteAnnotation(nonEmptyString(projectId, "Project id"), nonEmptyString(remoteName, "Remote name"), positiveInteger(prNumber, "PR number"), nonEmptyString(annotationId, "Annotation id")));
  ipc.handle("github:send-draft-annotations", (_event, projectId: unknown, remoteName: unknown, prNumber: unknown) =>
    dependencies.github.sendDraftAnnotations(nonEmptyString(projectId, "Project id"), nonEmptyString(remoteName, "Remote name"), positiveInteger(prNumber, "PR number")));
  ipc.handle("git-graph:list", async (_event, target: unknown, options: unknown) =>
    dependencies.gitGraph.list(await targetRoot(target), validateGitGraphPageOptions(options)),
  );
  ipc.handle("git-graph:commit-details", async (_event, target: unknown, hash: unknown) =>
    dependencies.gitGraph.commitDetails(await targetRoot(target), nonEmptyString(hash, "Commit hash")),
  );
  ipc.handle("git-graph:file-diff", async (_event, target: unknown, hash: unknown, filePath: unknown) =>
    dependencies.gitGraph.fileDiff(await targetRoot(target), nonEmptyString(hash, "Commit hash"), nonEmptyString(filePath, "Diff path")),
  );
  ipc.handle("git-graph:create-branch", async (_event, target: unknown, hash: unknown, name: unknown, checkout: unknown) => {
    if (typeof checkout !== "boolean") throw new Error("Checkout must be a boolean");
    return dependencies.gitGraph.createBranch(await targetRoot(target), nonEmptyString(hash, "Commit hash"), nonEmptyString(name, "Branch name"), checkout);
  });
  ipc.handle("git-graph:create-tag", async (_event, target: unknown, hash: unknown, name: unknown) =>
    dependencies.gitGraph.createTag(await targetRoot(target), nonEmptyString(hash, "Commit hash"), nonEmptyString(name, "Tag name")),
  );
  ipc.handle("git-graph:cherry-pick", async (_event, target: unknown, hash: unknown) =>
    dependencies.gitGraph.cherryPick(await targetRoot(target), nonEmptyString(hash, "Commit hash")),
  );
  ipc.handle("git-graph:revert", async (_event, target: unknown, hash: unknown) =>
    dependencies.gitGraph.revert(await targetRoot(target), nonEmptyString(hash, "Commit hash")),
  );

  const htmlPreviewRequests = new Map<string, object>();
  const htmlPreviewBounds = new Map<string, HtmlPreviewBounds>();
  ipc.handle("html-preview:open", async (_event, rawViewId: unknown, target: unknown, relativePath: unknown, bounds: unknown) => {
    const viewId = nonEmptyString(rawViewId, "HTML preview view id");
    const validatedPath = nonEmptyString(relativePath, "Relative path");
    const initialBounds = validateViewBounds(bounds);
    const request = {};
    htmlPreviewRequests.set(viewId, request);
    htmlPreviewBounds.set(viewId, initialBounds);
    dependencies.htmlPreview.close(viewId);
    let rootPath: string;
    try {
      rootPath = await targetRoot(target);
    } catch (error) {
      if (htmlPreviewRequests.get(viewId) !== request) return;
      htmlPreviewRequests.delete(viewId);
      htmlPreviewBounds.delete(viewId);
      throw error;
    }
    if (htmlPreviewRequests.get(viewId) !== request) return;
    try {
      await dependencies.htmlPreview.open(
        viewId,
        rootPath,
        validatedPath,
        htmlPreviewBounds.get(viewId)!,
      );
    } catch (error) {
      if (htmlPreviewRequests.get(viewId) === request) {
        htmlPreviewRequests.delete(viewId);
        htmlPreviewBounds.delete(viewId);
      }
      throw error;
    }
  });
  ipc.handle("html-preview:set-bounds", (_event, rawViewId: unknown, bounds: unknown) => {
    const viewId = nonEmptyString(rawViewId, "HTML preview view id");
    if (!htmlPreviewRequests.has(viewId)) return;
    const validated = validateViewBounds(bounds);
    htmlPreviewBounds.set(viewId, validated);
    dependencies.htmlPreview.setBounds(viewId, validated);
  });
  ipc.handle("html-preview:reload", (_event, rawViewId: unknown) =>
    dependencies.htmlPreview.reload(nonEmptyString(rawViewId, "HTML preview view id")));
  ipc.handle("html-preview:close", (_event, rawViewId: unknown) => {
    const viewId = nonEmptyString(rawViewId, "HTML preview view id");
    htmlPreviewRequests.delete(viewId);
    htmlPreviewBounds.delete(viewId);
    dependencies.htmlPreview.close(viewId);
  });

  ipc.handle("shell:open-external", async (_event, url: unknown) => dependencies.shell.openExternal(externalUrl(url)));
  // async so a bad-input throw reaches the renderer as a rejected invoke, matching every other handler.
  ipc.handle("clipboard:read-text", async () => dependencies.clipboard.readText());
  ipc.handle("clipboard:write-text", async (_event, text: unknown) => {
    if (typeof text !== "string") throw new Error("Clipboard text must be a string");
    dependencies.clipboard.writeText(text);
  });
  ipc.handle("workspace-files:open-entry", async (_event, target: unknown, relativePath: unknown, options: unknown) =>
    dependencies.workspaceFiles.openEntry(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
      validateOpenEntryOptions(options),
    ),
  );
  ipc.handle("workspace-files:changed-paths", async (_event, target: unknown) =>
    dependencies.workspaceFiles.changedPaths(await rootPathForTarget(validateFileExplorerTarget(target))),
  );
  ipc.handle("workspace-files:clear-changes", async (_event, target: unknown) =>
    dependencies.workspaceFiles.clearChanges(await rootPathForTarget(validateFileExplorerTarget(target))),
  );

  ipc.handle("providers:availability", () => dependencies.getAvailability());
  ipc.handle("agents:list", () => dependencies.listAgents());
  ipc.handle("agents:edit", () => dependencies.editAgents());
  ipc.handle("attention:state", () => dependencies.attentionState());
  ipc.handle("terminals:list", () => dependencies.coordinator.list());
  ipc.handle("terminals:state", () => dependencies.coordinator.state());
  ipc.handle("terminals:create", async (_event, input: unknown) => {
    // A background start puts a session in a folder's grid without going to it, so it must leave
    // the saved selection — what the next launch reopens — pointing wherever the user actually is.
    const created = validateCreateInput(input);
    return dependencies.coordinator.create(created, { updateSelection: created.background !== true });
  });
  ipc.handle("terminals:create-tool", async (_event, input: unknown) =>
    dependencies.coordinator.createTool(validateCreateToolInput(input)),
  );
  // The size is optional: a renderer that cannot measure its pane yet attaches without one and the
  // coordinator falls back to its default, exactly as before.
  ipc.handle("terminals:attach", (_event, sessionId: unknown, cols: unknown, rows: unknown) =>
    dependencies.coordinator.attachForRenderer(
      nonEmptyString(sessionId, "Session id"),
      cols === undefined || rows === undefined
        ? undefined
        : { cols: integer(cols, "Terminal columns"), rows: integer(rows, "Terminal rows") },
    ),
  );
  ipc.handle("terminals:refresh", (_event, sessionId: unknown) =>
    dependencies.coordinator.attach(nonEmptyString(sessionId, "Session id")),
  );
  ipc.handle("terminals:write", async (_event, sessionId: unknown, data: unknown) => {
    if (typeof data !== "string") throw new Error("Terminal input must be a string");
    const id = nonEmptyString(sessionId, "Session id");
    // 폰이 이 세션의 크기를 가져갔다면 데스크톱이 입력하는 순간 되찾는다. 되찾기가 실패해도 입력은 보낸다.
    await dependencies.sizes.desktopInput(id).catch((error) => console.error("Failed to reclaim terminal size", error));
    return dependencies.coordinator.write(id, data);
  });
  ipc.handle("terminals:resize", (_event, sessionId: unknown, cols: unknown, rows: unknown) =>
    dependencies.sizes.desktopResize(
      nonEmptyString(sessionId, "Session id"),
      integer(cols, "Terminal columns"),
      integer(rows, "Terminal rows"),
    ),
  );
  ipc.handle("terminals:size-owners", () => dependencies.sizes.deviceOwners());
  ipc.handle("terminals:indicators", () => dependencies.indicators.snapshot());
  // 패인 머리줄의 "크기 되찾기". 입력할 때와 같은 길이다 — 기기가 갖고 있지 않으면 아무 일도 없다.
  ipc.handle("terminals:reclaim-size", (_event, sessionId: unknown) =>
    dependencies.sizes.desktopInput(nonEmptyString(sessionId, "Session id")),
  );
  ipc.handle("terminals:stop", (_event, sessionId: unknown) =>
    dependencies.coordinator.stop(nonEmptyString(sessionId, "Session id")),
  );
  ipc.handle("terminals:resume", (_event, input: unknown) => dependencies.coordinator.resume(validateResumeInput(input)));
  ipc.handle("terminals:remove", async (_event, sessionId: unknown) => {
    const id = nonEmptyString(sessionId, "Session id");
    assertNotReviewSession(await dependencies.github.activeReviews(), id);
    return dependencies.coordinator.remove(id);
  });
  ipc.handle("terminals:export-log", async (_event, sessionId: unknown, fileLabel: unknown) => {
    const id = nonEmptyString(sessionId, "Session id");
    const label = typeof fileLabel === "string" && fileLabel.trim() ? fileLabel.trim() : id;
    const text = await dependencies.coordinator.logText(id);
    return dependencies.saveTextFile(`${exportFileStem(label)}-${exportTimestamp(new Date())}.txt`, text);
  });
  ipc.handle("terminals:rename", async (_event, sessionId: unknown, name: unknown) => {
    if (name !== null && typeof name !== "string") throw new Error("Session name must be a string or null");
    if (typeof name === "string" && name.length > 120) throw new Error("Session name is too long");
    return dependencies.coordinator.rename(nonEmptyString(sessionId, "Session id"), name);
  });
  ipc.handle("terminals:select", async (_event, projectId: unknown, sessionId: unknown) => {
    if (projectId !== null && typeof projectId !== "string") throw new Error("Selected project id is invalid");
    if (sessionId !== null && typeof sessionId !== "string") throw new Error("Selected session id is invalid");
    const snapshot = await dependencies.coordinator.select(projectId, sessionId);
    dependencies.onSessionSelected?.(sessionId);
    return snapshot;
  });
  ipc.handle("terminals:set-visible-sessions", async (_event, sessionIds: unknown) => {
    if (!Array.isArray(sessionIds) || sessionIds.some((id) => typeof id !== "string" || id.length === 0)) {
      throw new Error("Visible session ids are invalid");
    }
    const snapshot = await dependencies.coordinator.setVisibleSessions(sessionIds as string[]);
    // Every pane is on screen from this moment, so their unread badges clear like a selection.
    for (const sessionId of sessionIds as string[]) dependencies.onSessionSelected?.(sessionId);
    return snapshot;
  });
  ipc.handle("terminals:set-slot-views", async (_event, input: unknown) => {
    return dependencies.coordinator.setSlotViews(slotViewsInput(input));
  });
  ipc.handle("window:minimize", () => dependencies.windowControls.minimize());
  ipc.handle("window:toggle-maximize", () => dependencies.windowControls.toggleMaximize());
  ipc.handle("window:close", () => dependencies.windowControls.close());
  ipc.handle("window:state", () => dependencies.windowControls.state());
  ipc.handle("window:toggle-full-screen", () => dependencies.windowControls.toggleFullScreen());
  ipc.handle("window:toggle-dev-tools", () => dependencies.windowControls.toggleDevTools());
  ipc.handle("window:reload", () => dependencies.windowControls.reload());
  ipc.handle("window:zoom", (_event, action: unknown) => {
    if (!WINDOW_ZOOM_ACTIONS.includes(action as WindowZoomAction)) throw new Error("Zoom action is invalid");
    dependencies.windowControls.zoom(action as WindowZoomAction);
  });
  ipc.handle("app:quit", () => dependencies.windowControls.quit());
  ipc.handle("app:version", () => dependencies.appVersion());
  ipc.handle("updater:status", () => dependencies.updater.status());
  ipc.handle("updater:check", () => dependencies.updater.check());
  ipc.handle("updater:install", () => dependencies.updater.install());
  ipc.handle("app:open-releases", () => dependencies.updater.openReleases());
  ipc.handle("app:open-repository", () => dependencies.updater.openRepository());

  ipc.handle("remote:status", () => dependencies.remote.status());
  ipc.handle("remote:issue-pairing-code", () => dependencies.remote.issuePairingCode());
  ipc.handle("remote:list-devices", () => dependencies.remote.listDevices());
  ipc.handle("remote:revoke-device", (_event, deviceId: unknown) =>
    dependencies.remote.revokeDevice(nonEmptyString(deviceId, "Device id")),
  );
  ipc.handle("remote-hosts:list", () => dependencies.remoteHosts.list());
  // async라 잘못된 입력의 throw가 rejected invoke로 렌더러에 도달한다.
  ipc.handle("remote-hosts:add", async (_event, input: unknown) =>
    dependencies.remoteHosts.add(validateRemoteHostAdd(input)),
  );
  ipc.handle("remote-hosts:remove", (_event, hostId: unknown) =>
    dependencies.remoteHosts.remove(nonEmptyString(hostId, "Host id")),
  );
  ipc.handle("remote-hosts:open", (_event, hostId: unknown) =>
    dependencies.remoteHosts.open(nonEmptyString(hostId, "Host id")),
  );
  ipc.handle("remote-hosts:set-notify", (_event, hostId: unknown, notify: unknown) =>
    dependencies.remoteHosts.setNotify(nonEmptyString(hostId, "Host id"), booleanValue(notify, "Host notify")),
  );
  ipc.handle("notion:status", () => dependencies.notion.status());
  // async라 잘못된 입력의 throw가 다른 핸들러들처럼 rejected invoke로 렌더러에 도달한다.
  ipc.handle("notion:set-token", async (_event, token: unknown) =>
    // 붙여넣은 토큰의 앞뒤 공백은 흔한 실수라 다듬은 뒤 다시 비었는지 본다.
    dependencies.notion.setToken(nonEmptyString(nonEmptyString(token, "Notion token").trim(), "Notion token")),
  );
  ipc.handle("notion:clear-token", () => dependencies.notion.clearToken());
  ipc.handle("notion:inspect-link", async (_event, url: unknown) =>
    dependencies.notion.inspectLink(externalUrl(url)),
  );

  ipc.handle("settings:get", () => dependencies.settings.get());
  ipc.handle("settings:update", (_event, patch: unknown) => dependencies.settings.update(validateSettingsPatch(patch)));
}
