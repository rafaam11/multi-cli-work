import type { SharedProject } from "@shared/project-types";
import type { WorkProject } from "@shared/work-project-types";
import { describe, expect, it } from "vitest";
import {
  buildTreeNodes,
  buildTreeSections,
  collapsedGroupKeysForWorking,
  defaultGroupingTags,
  groupKeys,
  OTHER_GROUP_KEY,
} from "./sidebar-tree";

const project = (id: string): SharedProject => ({
  id, rootPath: `C:\\dev\\${id}`, displayName: id, sources: ["manual"], providerRefs: { claude: [], codex: [] },
  status: null, memo: "", tracks: [], hidden: false, order: 0, createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z",
});
const workProject = (id: string, name: string): WorkProject => ({
  id, name, category: "기타", status: null, memo: "", members: [], notionLinks: [], localFolders: [], order: null,
  createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z",
});

describe("buildTreeSections", () => {
  it("업무 프로젝트마다 한 묶음, 남는 폴더는 미분류 묶음으로 간다", () => {
    const sections = buildTreeSections(
      [workProject("wp-a", "알파"), workProject("wp-b", "베타")],
      [project("a"), project("b")],
      { a: { workProjectId: "wp-a" } },
    );
    expect(sections.map((section) => section.key)).toEqual(["wp-a", "wp-b", "unassigned"]);
    expect(sections[2].projects.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("업무 프로젝트가 하나도 없으면 미분류 묶음 하나만 남는다", () => {
    expect(buildTreeSections([], [project("a")], {})).toEqual([
      { key: "unassigned", workProject: null, projects: [project("a")] },
    ]);
  });
});

describe("buildTreeNodes", () => {
  const sections = (...ids: string[]) =>
    buildTreeSections(ids.map((id) => workProject(id, id)), [], {});

  it("묶기가 비어 있으면 모든 줄이 최상위 섹션으로 선다", () => {
    const built = sections("wp-a", "wp-b");
    const nodes = buildTreeNodes(built, { tags: [], tagsByWorkProject: { "wp-a": ["연구"], "wp-b": ["연구"] } });
    expect(nodes.map((node) => node.kind)).toEqual(["section", "section"]);
    expect(nodes.map((node) => node.key)).toEqual(["wp-a", "wp-b"]);
  });

  it("고른 순서대로 묶이고, 묶음은 그 묶음 첫 구성원의 자리를 차지한다", () => {
    // 순서는 wp-연구 · wp-용역 · wp-연구2 — 연구 묶음이 첫 자리를, 용역 묶음이 둘째 자리를 갖는다.
    const built = sections("wp-r1", "wp-s1", "wp-r2");
    const nodes = buildTreeNodes(built, {
      tags: ["용역", "연구"],
      tagsByWorkProject: { "wp-r1": ["연구"], "wp-s1": ["용역"], "wp-r2": ["연구"] },
    });
    expect(nodes.map((node) => node.key)).toEqual(["tag:연구", "tag:용역"]);
    expect(nodes[0]).toMatchObject({
      kind: "group",
      tag: "연구",
      label: "연구",
      sections: [{ key: "wp-r1" }, { key: "wp-r2" }],
    });
    expect(nodes[1]).toMatchObject({ kind: "group", tag: "용역", sections: [{ key: "wp-s1" }] });
  });

  it("태그를 둘 가진 업무 프로젝트는 먼저 고른 태그의 묶음에만 선다", () => {
    const built = sections("wp-both");
    const byFirst = buildTreeNodes(built, {
      tags: ["개인", "용역"],
      tagsByWorkProject: { "wp-both": ["용역", "개인"] },
    });
    expect(byFirst.map((node) => node.key)).toEqual(["tag:개인"]);

    const byOther = buildTreeNodes(built, {
      tags: ["용역", "개인"],
      tagsByWorkProject: { "wp-both": ["용역", "개인"] },
    });
    expect(byOther.map((node) => node.key)).toEqual(["tag:용역"]);
  });

  it("고른 태그에 하나도 걸리지 않으면 기타 묶음이고, 기타는 항상 마지막이다", () => {
    // 태그 없는 wp-none이 먼저 서 있어도 기타는 뒤로 간다.
    const built = sections("wp-none", "wp-s1");
    const nodes = buildTreeNodes(built, {
      tags: ["용역"],
      tagsByWorkProject: { "wp-s1": ["용역"] },
    });
    expect(nodes.map((node) => node.key)).toEqual(["tag:용역", OTHER_GROUP_KEY]);
    expect(nodes[1]).toMatchObject({ kind: "group", tag: null, label: "기타", sections: [{ key: "wp-none" }] });
  });

  it("미분류는 묶음 밖 최상위에, 기타보다도 뒤에 선다", () => {
    const built = buildTreeSections(
      [workProject("wp-s1", "용역 것"), workProject("wp-none", "태그 없음")],
      [project("a")],
      {},
    );
    expect(built.map((section) => section.key)).toEqual(["wp-s1", "wp-none", "unassigned"]);

    const nodes = buildTreeNodes(built, { tags: ["용역"], tagsByWorkProject: { "wp-s1": ["용역"] } });
    expect(nodes.map((node) => node.key)).toEqual(["tag:용역", OTHER_GROUP_KEY, "unassigned"]);
    expect(nodes[2]).toMatchObject({ kind: "section", section: { workProject: null } });
  });
});

describe("groupKeys / collapsedGroupKeysForWorking", () => {
  const built = buildTreeSections(
    [workProject("wp-s1", "용역 것"), workProject("wp-p1", "개인 것")],
    [project("a"), project("b")],
    { a: { workProjectId: "wp-s1" }, b: { workProjectId: "wp-p1" } },
  );
  const nodes = buildTreeNodes(built, {
    tags: ["용역", "개인"],
    tagsByWorkProject: { "wp-s1": ["용역"], "wp-p1": ["개인"] },
  });

  it("트리에 서 있는 묶음의 키만 돌려준다", () => {
    expect(groupKeys(nodes)).toEqual(["tag:용역", "tag:개인"]);
  });

  it("작업중 폴더를 가진 묶음만 열어 두고 나머지 묶음 키를 돌려준다", () => {
    expect([...collapsedGroupKeysForWorking(nodes, new Set(["a"]))]).toEqual(["tag:개인"]);
    expect([...collapsedGroupKeysForWorking(nodes, new Set())]).toEqual(["tag:용역", "tag:개인"]);
  });
});

describe("defaultGroupingTags", () => {
  it("워크스페이스 셸이 하나도 없으면 묶지 않는다 — 이 기능이 없던 때와 같은 평면 트리다", () => {
    expect(defaultGroupingTags({ "wp-a": ["용역", "개인"] }, false)).toEqual([]);
  });

  it("셸이 있으면 실제로 붙어 있는 채널 라벨만 고정 순서로 고른다", () => {
    expect(defaultGroupingTags({ "wp-a": ["개인"], "wp-b": ["용역"], "wp-c": ["과제"] }, true)).toEqual([
      "과제",
      "용역",
      "개인",
    ]);
  });

  it("채널 라벨이 아닌 태그는 기본값에 끼지 않는다", () => {
    expect(defaultGroupingTags({ "wp-a": ["AI", "연구"] }, true)).toEqual(["연구"]);
    expect(defaultGroupingTags({ "wp-a": ["AI"] }, true)).toEqual([]);
  });
});
