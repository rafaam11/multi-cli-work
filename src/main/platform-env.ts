import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

type ExecFile = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; windowsHide: boolean },
) => Promise<{ stdout: string }>;

const execFileAsync = promisify(execFile) as ExecFile;

function pathKey(env: Readonly<Record<string, string>>, platform: NodeJS.Platform): string {
  if (platform !== "win32") return "PATH";
  return Object.keys(env).find((candidate) => candidate.toUpperCase() === "PATH") ?? "Path";
}

export function prependPath(
  env: Record<string, string>,
  dir: string,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const key = pathKey(env, platform);
  const delimiter = platform === "win32" ? ";" : ":";
  return { ...env, [key]: env[key] ? `${dir}${delimiter}${env[key]}` : dir };
}

function fallbackLinuxPath(inherited: string | undefined): string {
  const values = [inherited, path.join(os.homedir(), ".local", "bin"), "/usr/local/bin", "/usr/bin", "/bin"];
  return [...new Set(values.filter((value): value is string => Boolean(value)))].join(":");
}

/**
 * A stray `"` in a Windows PATH entry (an installer leaving `C:\Program Files\WSL"`) makes cmd.exe and
 * Rust's `split_paths` treat everything after it as one quoted entry, so tools listed later vanish:
 * `codex update` cannot find `npm`, and the codex cmd shim cannot find `node`. Quotes are never part
 * of a Windows path, so drop them, along with empty entries.
 */
function sanitizeWindowsPath(env: Record<string, string>): Record<string, string> {
  const key = pathKey(env, "win32");
  const value = env[key];
  if (!value) return { ...env };
  const entries = value
    .split(";")
    .map((entry) => entry.replaceAll('"', "").trim())
    .filter(Boolean);
  return { ...env, [key]: entries.join(";") };
}

/**
 * What an agent's session puts in the environment of the commands it runs. The app inherits
 * whatever launched it, so when an agent starts it from its tool shell (`Start-Process` on the app),
 * every terminal would carry that agent's session: Claude then believes it is a nested child and
 * stops saving transcripts. None of these mean anything to a session the app starts itself.
 */
const AGENT_SESSION_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
  "AI_AGENT",
  "CODEX_COMPANION_SESSION_ID",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
];

/**
 * The same tool shell also makes its commands non-interactive and colourless (Claude renders in
 * grey under NO_COLOR, `git commit` never opens an editor). A user may set these on purpose, so
 * they are dropped only together with a marker that proves an agent's shell supplied them.
 */
const AGENT_TOOL_SHELL_SETTINGS = [
  "NO_COLOR",
  "GIT_EDITOR",
  "GIT_ASKPASS",
  "GIT_TERMINAL_PROMPT",
  "GCM_INTERACTIVE",
  "PSExecutionPolicyPreference",
  "NoDefaultCurrentDirectoryInExePath",
  "COREPACK_ENABLE_AUTO_PIN",
  "PYTHONIOENCODING",
];

function withoutAgentSession(env: Record<string, string>, platform: NodeJS.Platform): Record<string, string> {
  // Windows variable names are case-insensitive.
  const normalize = (name: string) => (platform === "win32" ? name.toUpperCase() : name);
  const markers = new Set(AGENT_SESSION_MARKERS.map(normalize));
  if (!Object.keys(env).some((name) => markers.has(normalize(name)))) return { ...env };
  const dropped = new Set([...markers, ...AGENT_TOOL_SHELL_SETTINGS.map(normalize)]);
  return Object.fromEntries(Object.entries(env).filter(([name]) => !dropped.has(normalize(name))));
}

export async function discoverSessionEnvironment(
  launchEnvironment: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
  execute: ExecFile = execFileAsync,
): Promise<Record<string, string>> {
  const inherited = withoutAgentSession(launchEnvironment, platform);
  if (platform === "win32") return sanitizeWindowsPath(inherited);
  let discovered = "";
  try {
    const result = await execute("/bin/bash", ["--login", "-c", `printf '%s' "$PATH"`], {
      env: inherited,
      timeout: 3_000,
      windowsHide: true,
    });
    discovered = result.stdout.trim();
  } catch {
    // A minimal deterministic PATH keeps GUI launches usable when shell startup files hang/fail.
  }
  return { ...inherited, PATH: discovered || fallbackLinuxPath(inherited.PATH) };
}
