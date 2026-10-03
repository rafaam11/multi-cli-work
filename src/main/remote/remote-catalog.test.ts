// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildRemoteCatalog } from "./remote-catalog";

const project = (id: string, overrides: Partial<{ displayName: string | null; rootPath: string; hidden: boolean; order: number | null }> = {}) => ({
  id,
  displayName: id,
  rootPath: `C:\\dev\\${id}`,
  hidden: false,
  order: null,
  ...overrides,
});

const agent = (id: string, label: string, available = true) => ({ id, label, available });

describe("buildRemoteCatalog", () => {
  it("lists visible folders in their saved order, then by name", () => {
    const catalog = buildRemoteCatalog(
      [
        project("p-zeta", { displayName: "제타" }),
        project("p-second", { displayName: "둘째", order: 1 }),
        project("p-hidden", { displayName: "숨김", hidden: true, order: 0 }),
        project("p-alpha", { displayName: "가나" }),
        project("p-first", { displayName: "첫째", order: 0 }),
      ],
      [],
    );
    expect(catalog.projects).toEqual([
      { id: "p-first", name: "첫째" },
      { id: "p-second", name: "둘째" },
      { id: "p-alpha", name: "가나" },
      { id: "p-zeta", name: "제타" },
    ]);
  });

  it("names a folder without a display name after its directory", () => {
    const catalog = buildRemoteCatalog(
      [
        project("win", { displayName: null, rootPath: "C:\\dev\\multi-cli-work\\" }),
        project("posix", { displayName: null, rootPath: "/home/u/atlas" }),
      ],
      [],
    );
    expect(catalog.projects.map((entry) => entry.name).sort()).toEqual(["atlas", "multi-cli-work"]);
  });

  it("offers only the agents this host can actually run", () => {
    const catalog = buildRemoteCatalog([], [agent("claude", "Claude"), agent("codex", "Codex", false), agent("powershell", "PowerShell")]);
    expect(catalog.agents).toEqual([
      { id: "claude", label: "Claude" },
      { id: "powershell", label: "PowerShell" },
    ]);
  });
});
