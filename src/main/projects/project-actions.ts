import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { shell } from "electron";
import type { GitStatusResult } from "../../shared/api-types";
import { readGitHubUrl } from "../providers/git-remote";
import { buildEditorSpawn, vsCodeExecutableCandidate, type ProviderExecutables } from "../providers/provider-launch";
import { readGitStatus } from "./git-status";

export interface ProjectActionsOptions {
  getExecutables(): Promise<ProviderExecutables>;
}

export interface ProjectActions {
  reveal(rootPath: string): Promise<void>;
  openInEditor(rootPath: string): Promise<void>;
  openOnGitHub(rootPath: string): Promise<void>;
  gitStatus(rootPath: string): Promise<GitStatusResult>;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function createProjectActions(options: ProjectActionsOptions): ProjectActions {
  return {
    async reveal(rootPath) {
      // shell.openPath resolves with an error message instead of rejecting, so a bare await
      // would swallow the failure.
      const failure = await shell.openPath(rootPath);
      if (failure) throw new Error(failure);
    },

    async openInEditor(rootPath) {
      const { vscode } = await options.getExecutables();
      if (!vscode) throw new Error("VS Code was not found on PATH");
      const candidate = vsCodeExecutableCandidate(vscode);
      const resolved = candidate && (await fileExists(candidate)) ? candidate : null;
      const editor = buildEditorSpawn(vscode, rootPath, resolved);
      // spawn reports failure through an `error` event, not a throw. Without this the editor
      // failing to start is completely silent.
      await new Promise<void>((resolve, reject) => {
        const child = spawn(editor.command, editor.args, {
          detached: true,
          stdio: "ignore",
          shell: editor.shell,
          windowsHide: editor.windowsHide,
        });
        child.once("error", (error) => reject(new Error(`Could not start VS Code: ${error.message}`)));
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });
    },

    async openOnGitHub(rootPath) {
      // readGitHubUrl only ever returns an https://github.com/... URL, so nothing arbitrary
      // from .git/config can reach the browser.
      await shell.openExternal(await readGitHubUrl(rootPath));
    },

    gitStatus(rootPath) {
      return readGitStatus(rootPath);
    },
  };
}
