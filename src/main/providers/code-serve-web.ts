import { execFile, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";

export interface ServeWebEndpoint {
  port: number;
  token: string;
}

export interface CodeServeWebOptions {
  /** Resolves the `code` CLI path (the Windows `code.cmd` shim), or null when VS Code is absent. */
  resolveCodeCli(): Promise<string | null>;
  /** Overridable so a test can substitute a fake launcher. */
  spawnProcess?: typeof spawn;
}

/** First-run downloads the server binary, so readiness can take a while. */
const READY_TIMEOUT_MS = 90_000;
// serve-web prints "Web UI available at http://127.0.0.1:<port>?tkn=<token>" — note there is no
// slash before the query string, so the slash is optional here.
const READY_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?\?tkn=/i;

export class CodeServeWebError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodeServeWebError";
  }
}

/**
 * `code serve-web` on Windows is `code.cmd` → node (CLI) → node (server): killing the cmd.exe wrapper
 * strands the server node process. taskkill /T tears down the whole tree so no server outlives the app.
 */
function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
  } else {
    child.kill();
  }
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new CodeServeWebError("Could not allocate a local port")));
      }
    });
  });
}

/**
 * Owns a single `code serve-web` process for the app's lifetime. The server is folder-agnostic —
 * the workbench opens whatever folder the URL names — so one instance backs every Git Graph open,
 * and it is reused rather than respawned per target.
 */
export class CodeServeWebManager {
  private child: ChildProcess | null = null;
  private starting: Promise<ServeWebEndpoint> | null = null;
  private endpoint: ServeWebEndpoint | null = null;
  private readonly spawnProcess: typeof spawn;

  constructor(private readonly options: CodeServeWebOptions) {
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  /** Starts the server on first call and returns the same endpoint on every later call. */
  async ensure(): Promise<ServeWebEndpoint> {
    if (this.endpoint && this.child && !this.child.killed) return this.endpoint;
    this.starting ??= this.start();
    try {
      return await this.starting;
    } catch (error) {
      this.starting = null;
      throw error;
    }
  }

  private async start(): Promise<ServeWebEndpoint> {
    const codeCli = await this.options.resolveCodeCli();
    if (!codeCli) {
      throw new CodeServeWebError("VS Code was not found on PATH");
    }
    const port = await findFreePort();
    const token = crypto.randomBytes(24).toString("hex");
    const args = [
      "serve-web",
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--connection-token",
      token,
      "--accept-server-license-terms",
    ];
    // The CLI ships as `code.cmd` on Windows, and Node will not spawn a `.cmd` without a shell.
    // No argument here contains a shell metacharacter (port is a number, token is hex), and the
    // executable path is passed as the command, so quoting the path guards only against spaces.
    const child = this.spawnProcess(`"${codeCli}"`, args, {
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    const endpoint = await new Promise<ServeWebEndpoint>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        killProcessTree(child);
        reject(new CodeServeWebError("serve-web did not become ready in time"));
      }, READY_TIMEOUT_MS);

      const onData = (chunk: Buffer) => {
        if (settled) return;
        // The readiness line prints the URL with the real port; matching it confirms the server is
        // actually listening rather than merely spawned.
        if (READY_PATTERN.test(chunk.toString())) {
          settled = true;
          clearTimeout(timer);
          resolve({ port, token });
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new CodeServeWebError(`serve-web failed to start: ${error.message}`, { cause: error }));
      });
      child.on("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new CodeServeWebError(`serve-web exited before becoming ready (code ${code ?? "unknown"})`));
      });
    });

    child.on("exit", () => {
      // A crash after readiness invalidates the cached endpoint so the next open respawns.
      if (this.child === child) {
        this.child = null;
        this.endpoint = null;
        this.starting = null;
      }
    });
    this.endpoint = endpoint;
    return endpoint;
  }

  /** Builds the workbench URL that opens `folderPath` in the running server. */
  folderUrl(endpoint: ServeWebEndpoint, folderPath: string): string {
    // VS Code for the Web wants a POSIX-style folder path: `d:\a\b` → `/d:/a/b`.
    const posix = folderPath.replaceAll("\\", "/");
    const folder = posix.startsWith("/") ? posix : `/${posix}`;
    const params = new URLSearchParams({ tkn: endpoint.token, folder });
    return `http://127.0.0.1:${endpoint.port}/?${params.toString()}`;
  }

  dispose(): void {
    if (this.child) killProcessTree(this.child);
    this.child = null;
    this.endpoint = null;
    this.starting = null;
  }
}
