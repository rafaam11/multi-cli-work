import { spawn as nodeSpawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { CreateTerminalInput } from "../../shared/api-types";
import type { WorktreeScripts } from "../../shared/worktree-types";

const OUTPUT_TAIL_BYTES = 4_096;

export interface ScriptChild extends EventEmitter {
  stdout: Readable | null;
  stderr: Readable | null;
  kill(signal?: NodeJS.Signals): boolean;
}

type SpawnScript = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; windowsHide: boolean; shell: false },
) => ScriptChild;

interface ScriptCoordinator {
  create(input: CreateTerminalInput, options?: { updateSelection?: boolean }): Promise<{ id: string }>;
  rename(sessionId: string, name: string | null): Promise<unknown>;
  attachForRenderer(sessionId: string): Promise<unknown>;
  write(sessionId: string, data: string): Promise<unknown>;
}

export interface WorktreeScriptRunnerOptions {
  platform: NodeJS.Platform;
  /** Where the script files are written before they run. */
  scriptsDir: string;
  readScripts(projectId: string): Promise<WorktreeScripts | null>;
  coordinator: ScriptCoordinator;
  /** The shell a teardown runs in: pwsh or Windows PowerShell on Windows, bash elsewhere. */
  shellExecutable(): Promise<string | null>;
  spawn?: SpawnScript;
}

interface WorktreeRef {
  id: string;
  path: string;
  branch: string;
}

export type TeardownOutcome = { ok: true } | { ok: false; message: string; output: string };

/**
 * The file a script runs from: the worktree's paths as environment variables, then the user's
 * script as they wrote it. Quoted for each shell so a path with a quote in it stays one value.
 */
export function scriptFileContent(platform: NodeJS.Platform, env: Record<string, string>, script: string): string {
  if (platform === "win32") {
    const lines = Object.entries(env).map(([key, value]) => `$env:${key} = '${value.replaceAll("'", "''")}'`);
    return [...lines, script.replace(/\r?\n/g, "\r\n")].join("\r\n") + "\r\n";
  }
  const lines = Object.entries(env).map(([key, value]) => `export ${key}='${value.replaceAll("'", "'\\''")}'`);
  return [...lines, script].join("\n") + "\n";
}

/**
 * Runs a folder's worktree scripts. Setup runs in a visible shell session in the new worktree — an
 * `npm ci` is something to watch, and its failure something to read — while teardown runs hidden
 * with a time limit, because removal waits on it.
 */
export class WorktreeScriptRunner {
  private readonly spawn: SpawnScript;

  constructor(private readonly options: WorktreeScriptRunnerOptions) {
    this.spawn = options.spawn ?? ((command, args, spawnOptions) => nodeSpawn(command, args, spawnOptions));
  }

  /** The setup session's id, or null when the folder has no setup script. */
  async runSetup(worktree: WorktreeRef, project: { id: string; rootPath: string }): Promise<string | null> {
    const scripts = await this.options.readScripts(project.id);
    if (!scripts || scripts.setup.trim() === "") return null;
    const file = await this.writeScript(worktree, project, "setup", scripts.setup);
    const windows = this.options.platform === "win32";
    const session = await this.options.coordinator.create(
      { projectId: project.id, worktreeId: worktree.id, kind: windows ? "powershell" : "bash", cols: 120, rows: 36, background: true },
      { updateSelection: false },
    );
    await this.options.coordinator.rename(session.id, `셋업 · ${worktree.branch}`);
    await this.options.coordinator.attachForRenderer(session.id);
    // The same shell that is running, so a pwsh user's script runs in pwsh. Bypass only applies to
    // this one file the app just wrote — the machine's execution policy is left as it is.
    const command = windows
      ? `& (Get-Process -Id $PID).Path -NoProfile -ExecutionPolicy Bypass -File '${file.replaceAll("'", "''")}'\r`
      : `bash '${file.replaceAll("'", "'\\''")}'\n`;
    await this.options.coordinator.write(session.id, command);
    return session.id;
  }

  async runTeardown(worktree: WorktreeRef, project: { id: string; rootPath: string }): Promise<TeardownOutcome> {
    const scripts = await this.options.readScripts(project.id);
    if (!scripts || scripts.teardown.trim() === "") return { ok: true };
    const file = await this.writeScript(worktree, project, "teardown", scripts.teardown);
    const windows = this.options.platform === "win32";
    const shell = (await this.options.shellExecutable()) ?? (windows ? "powershell.exe" : "bash");
    const args = windows ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file] : [file];
    const timeoutSec = scripts.teardownTimeoutSec;
    return new Promise<TeardownOutcome>((resolve) => {
      let output = "";
      let timedOut = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (outcome: TeardownOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };
      const collect = (chunk: Buffer | string) => {
        output = (output + chunk.toString()).slice(-OUTPUT_TAIL_BYTES);
      };
      let child: ScriptChild;
      try {
        child = this.spawn(shell, args, { cwd: worktree.path, env: { ...process.env, ...this.env(worktree, project) }, windowsHide: true, shell: false });
      } catch (error) {
        settle({ ok: false, message: `정리 스크립트를 시작하지 못했습니다: ${(error as Error).message}`, output: "" });
        return;
      }
      timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutSec * 1_000);
      child.stdout?.on("data", collect);
      child.stderr?.on("data", collect);
      child.once("error", (error: Error) =>
        settle({ ok: false, message: `정리 스크립트를 시작하지 못했습니다: ${error.message}`, output }),
      );
      child.once("close", (code: number | null) => {
        if (timedOut) settle({ ok: false, message: `정리 스크립트가 ${timeoutSec}초 안에 끝나지 않았습니다.`, output });
        else if (code === 0) settle({ ok: true });
        else settle({ ok: false, message: `정리 스크립트가 코드 ${code ?? "없음"}으로 끝났습니다.`, output });
      });
    });
  }

  private env(worktree: WorktreeRef, project: { rootPath: string }): Record<string, string> {
    return { MCW_ROOT_PATH: project.rootPath, MCW_WORKTREE_PATH: worktree.path, MCW_BRANCH: worktree.branch };
  }

  private async writeScript(
    worktree: WorktreeRef,
    project: { rootPath: string },
    stage: "setup" | "teardown",
    script: string,
  ): Promise<string> {
    const windows = this.options.platform === "win32";
    await fs.mkdir(this.options.scriptsDir, { recursive: true });
    const file = path.join(this.options.scriptsDir, `${worktree.id}-${stage}.${windows ? "ps1" : "sh"}`);
    const content = scriptFileContent(this.options.platform, this.env(worktree, project), script);
    // Windows PowerShell 5.1 reads a script without a BOM in the ANSI code page.
    await fs.writeFile(file, windows ? `\ufeff${content}` : content, "utf8");
    return file;
  }
}
