// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseCodexWorkspace } from "./session-workspace";

const line = (type: string, payload: unknown) => JSON.stringify({ type, payload }) + "\n";
describe("Codex workspace observations", () => {
  it("follows explicit execution cwd, not the path of a newly created worktree or quoted output", () => {
    const chunk = line("turn_context", { cwd: "C:\\repo" }) +
      line("response_item", { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "git worktree add ../feature", workdir: "C:\\repo" }) }) +
      line("response_item", { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "npm test", workdir: "C:\\feature" }) }) +
      line("response_item", { type: "function_call_output", output: "cwd: C:\\other" });
    expect(parseCodexWorkspace(chunk, null)).toEqual({ contextCwd: "C:\\repo", cwd: "C:\\feature" });
    // The next turn repeats the launch directory; that is not evidence of moving back.
    expect(parseCodexWorkspace(line("turn_context", { cwd: "C:\\repo" }), "C:\\repo").cwd).toBeNull();
  });
  it("reads actual execution events and ignores malformed or relative locations", () => {
    expect(parseCodexWorkspace(line("event_msg", { type: "exec_command_begin", cwd: "C:\\feature\\src" }), null).cwd).toBe("C:\\feature\\src");
    expect(parseCodexWorkspace('{broken}\n' + line("turn_context", { cwd: "relative" }), null).cwd).toBeNull();
  });
  it("does not replay a resumed conversation's old worktree into the new shell", () => {
    const old = JSON.stringify({ timestamp: "2026-09-20T00:00:00.000Z", type: "event_msg", payload: { type: "exec_command_begin", cwd: "C:\\old-tree" } }) + "\n";
    expect(parseCodexWorkspace(old, null, "2026-09-21T00:00:00.000Z").cwd).toBeNull();
  });
  it("returns to the context directory when a shell call uses its default cwd", () => {
    const call = line("response_item", { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "git status" }) });
    expect(parseCodexWorkspace(call, "C:\\repo").cwd).toBe("C:\\repo");
  });
});
