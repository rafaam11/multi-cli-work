import type { SharedProject } from "@shared/project-types";
import type { WorkProject } from "@shared/work-project-types";
import type { WorkspaceShellInfo } from "@shared/workspace-types";
import { describe, expect, it } from "vitest";
import { buildTreeNodes, buildTreeSections, channelKeys, collapsedChannelKeysForWorking } from "./sidebar-tree";

const project = (id: string): SharedProject => ({
  id, rootPath: `C:\\dev\\${id}`, displayName: id, sources: ["manual"], providerRefs: { claude: [], codex: [] },
  status: null, memo: "", tracks: [], hidden: false, order: 0, createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z",
});
const workProject = (id: string, name: string): WorkProject => ({
  id, name, category: "기타", status: null, memo: "", members: [], notionLinks: [], localFolders: [], order: null,
  createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z",
});
const shell = (channel: string, name: string): WorkspaceShellInfo => ({
  root: "C:\\work", ref: `${channel}/${name}`, channel, channelLetter: channel[0], channelLabel: "용역", shell: name,
  title: name, status: "active", path: `C:\\work\\${channel}\\${name}`, repos: [], externalPaths: [], data: [],
});

describe("buildTreeSections / buildTreeNodes", () => {
  it("셸에서 온 업무 프로젝트만 채널 아래로 들어가고, 채널 묶음은 첫 항목의 자리를 차지한다", () => {
    const manual = workProject("wp-manual", "손으로");
    const vsp = workProject("wp-vsp", "VSP");
    const foaa = workProject("wp-foaa", "FOAA");
    const sections = buildTreeSections([manual, vsp, foaa], [project("a"), project("b")], { a: { workProjectId: "wp-vsp" } });
    expect(sections.map((s) => s.key)).toEqual(["wp-manual", "wp-vsp", "wp-foaa", "unassigned"]);
    expect(sections[3].projects.map((p) => p.id)).toEqual(["b"]);

    const nodes = buildTreeNodes(sections, { "wp-vsp": shell("O_SMCH", "24_SMCH_VSP-1"), "wp-foaa": shell("O_SMCH", "25_SMCH_FOAA-1") });
    expect(nodes.map((n) => n.key)).toEqual(["wp-manual", "channel:O_SMCH", "unassigned"]);
    expect(nodes[1]).toMatchObject({ kind: "channel", channel: "O_SMCH", sections: [{ key: "wp-vsp" }, { key: "wp-foaa" }] });
  });

  it("업무 프로젝트가 하나도 없으면 미분류 묶음 하나만 남는다", () => {
    expect(buildTreeSections([], [project("a")], {})).toEqual([{ key: "unassigned", workProject: null, projects: [project("a")] }]);
  });
});

describe("collapsedChannelKeysForWorking", () => {
  it("작업중 폴더를 가진 채널만 열어 두고 나머지 채널 키를 돌려준다", () => {
    const sections = buildTreeSections(
      [workProject("wp-vsp", "VSP"), workProject("wp-career", "진로")],
      [project("a"), project("b")],
      { a: { workProjectId: "wp-vsp" }, b: { workProjectId: "wp-career" } },
    );
    const nodes = buildTreeNodes(sections, { "wp-vsp": shell("O_SMCH", "24_SMCH_VSP-1"), "wp-career": shell("P_Personal", "26_Personal_Career-1") });
    expect(channelKeys(nodes)).toEqual(["channel:O_SMCH", "channel:P_Personal"]);
    expect([...collapsedChannelKeysForWorking(nodes, new Set(["a"]))]).toEqual(["channel:P_Personal"]);
    expect([...collapsedChannelKeysForWorking(nodes, new Set())]).toEqual(["channel:O_SMCH", "channel:P_Personal"]);
  });
});
