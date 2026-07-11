import * as pty from "node-pty";
import type {
  TerminalAttachment,
  TerminalSession,
  TerminalWorkerRequest,
  TerminalWorkerResponse,
} from "../shared/terminal-types";
import {
  TerminalSessionManager,
  type ManagedPtyFactory,
} from "./terminal/terminal-session-manager";

const parentPort = process.parentPort;
if (!parentPort) throw new Error("Terminal worker requires an Electron utility-process parent port");

const factory: ManagedPtyFactory = {
  spawn(executable, args, options) {
    return pty.spawn(executable, args, {
      name: "xterm-256color",
      cwd: options.cwd,
      env: options.env,
      cols: options.cols,
      rows: options.rows,
      useConpty: process.platform === "win32",
    });
  },
};

const manager = new TerminalSessionManager(factory, (event) => parentPort.postMessage(event));

function success(requestId: string, result?: TerminalSession | TerminalAttachment): void {
  parentPort.postMessage({ requestId, ok: true, result } satisfies TerminalWorkerResponse);
}

function failure(requestId: string, error: unknown): void {
  parentPort.postMessage({
    requestId,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  } satisfies TerminalWorkerResponse);
}

async function handleRequest(request: TerminalWorkerRequest): Promise<void> {
  try {
    switch (request.type) {
      case "create":
        success(request.requestId, manager.create(request.spec));
        break;
      case "attach":
        success(request.requestId, manager.attach(request.sessionId));
        break;
      case "write":
        manager.write(request.sessionId, request.data);
        success(request.requestId);
        break;
      case "resize":
        manager.resize(request.sessionId, request.cols, request.rows);
        success(request.requestId);
        break;
      case "stop":
        manager.stop(request.sessionId);
        success(request.requestId);
        break;
    }
  } catch (error) {
    failure(request.requestId, error);
  }
}

parentPort.on("message", (event) => {
  void handleRequest(event.data as TerminalWorkerRequest);
});
