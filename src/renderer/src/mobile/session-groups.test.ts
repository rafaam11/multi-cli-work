import { describe, expect, it } from "vitest";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { groupSessionsByPath } from "./session-groups";

const session = (id: string, projectId: string | null, cwd?: string): RemoteSessionSummary => ({
  id, projectId, projectName: "Same", cwd, kind: "codex", label: id, status: "working", updatedAt: "",
});

describe("path session groups", () => {
  it("keeps identical project names and path basenames distinct and preserves session order", () => {
    const groups = groupSessionsByPath([session("a", "one", "C:\\a\\repo"), session("b", "two", "C:\\b\\repo"), session("c", "one", "C:\\a\\repo")]);
    expect(groups).toHaveLength(2);
    expect(groups[0].paths[0].sessions.map(s => s.id)).toEqual(["a", "c"]);
    expect(groups[1].paths[0].sessions.map(s => s.id)).toEqual(["b"]);
  });
  it("normalizes Windows paths but preserves POSIX case", () => {
    const groups = groupSessionsByPath([session("a", "one", "C:\\Repo\\"), session("b", "one", "c:/repo"), session("c", "one", "/Repo"), session("d", "one", "/repo")]);
    expect(groups[0].paths).toHaveLength(3);
    expect(groups[0].paths[0].sessions.map(s => s.id)).toEqual(["a", "b"]);
  });
  it("retains waiting sessions under their path and names missing legacy context", () => {
    const groups = groupSessionsByPath([{ ...session("a", null), projectName: null, status: "awaiting-approval" }]);
    expect(groups[0].label).toBe("프로젝트 없음");
    expect(groups[0].paths[0].label).toBe("경로 정보 없음");
    expect(groups[0].paths[0].sessions[0].status).toBe("awaiting-approval");
  });
});
