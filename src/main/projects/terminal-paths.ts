import fs from "node:fs/promises";
import path from "node:path";
import { isAbsolute, parse } from "node:path/win32";
import { needsRunConfirmation, type FileExplorerTarget } from "../../shared/file-explorer-types";
import type { TerminalPathEntry } from "../../shared/terminal-path-types";
import { isWorkspaceExecutable, resolveTerminalPath } from "./workspace-files";

interface SessionPathContext {
  cwd: string;
  workspace?: { rootPath: string; target: FileExplorerTarget };
}

interface TerminalPathDependencies {
  context(sessionId: string): Promise<SessionPathContext | null>;
  openPath(absolutePath: string): Promise<string>;
  reveal(absolutePath: string): void;
  platform?: NodeJS.Platform;
}

export function createTerminalPathService(deps: TerminalPathDependencies) {
  const platform = deps.platform ?? process.platform;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const locate = async (sessionId: string, raw: string) => {
    if (!raw || raw.length > 1024 || /[\x00-\x1f\x7f]/.test(raw)) return null;
    // URLs, drive-relative paths and device namespaces are not local printed paths.
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw) || /^\\\\[?.]\\/.test(raw)) return null;
    if (platform === "win32" && /^[a-z]:/i.test(raw) && !isAbsolute(raw)) return null;
    const context = await deps.context(sessionId);
    if (!context || !pathApi.isAbsolute(context.cwd)) return null;
    const absolutePath = pathApi.resolve(context.cwd, raw);
    if (platform === "win32" && absolutePath.slice(parse(absolutePath).root.length).includes(":")) return null;
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile() && !stat.isDirectory()) return null;
      return { absolutePath, stat, context };
    } catch {
      return null;
    }
  };

  return {
    async resolve(sessionId: string, raw: string): Promise<TerminalPathEntry | null> {
      const located = await locate(sessionId, raw);
      if (!located) return null;
      const entry: TerminalPathEntry = { raw, kind: located.stat.isFile() ? "file" : "directory" };
      const workspace = located.context.workspace;
      if (workspace && entry.kind === "file") {
        const relativePath = await resolveTerminalPath(workspace.rootPath, located.context.cwd, raw, platform);
        if (relativePath) entry.workspace = { target: workspace.target, relativePath };
      }
      return entry;
    },
    async open(sessionId: string, raw: string): Promise<void> {
      const located = await locate(sessionId, raw);
      if (!located) throw new Error("파일 또는 폴더를 찾을 수 없습니다.");
      const { absolutePath, stat } = located;
      const name = pathApi.basename(absolutePath);
      if (stat.isFile() && needsRunConfirmation(name, platform, isWorkspaceExecutable(name, stat.mode, true, platform))) {
        deps.reveal(absolutePath);
        return;
      }
      try {
        const failure = await deps.openPath(absolutePath);
        if (!failure) return;
      } catch {
        // Missing associations and OS launch errors fall back to selecting the entry.
      }
      deps.reveal(absolutePath);
    },
  };
}
