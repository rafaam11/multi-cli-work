// @vitest-environment node

import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LogicalRoots } from "../../shared/logical-path";
import type { ProjectRegistryV1, SharedProject } from "../../shared/project-types";
import type { ProjectTagsV1 } from "../../shared/project-tags-types";
import { DEFAULT_SETTINGS, mergeSettingsPatch, parseSettings, type AppSettings } from "../../shared/settings-types";
import type { WorkProject, WorkProjectRegistryV1 } from "../../shared/work-project-types";
import {
  applyProfileImport,
  buildProfile,
  parseProfile,
  previewProfileImport,
  resolveProfilePath,
  type ProfileDependencies,
} from "./profile-service";

const STAMP = "2026-10-15T00:00:00.000Z";

function folder(id: string, rootPath: string, patch: Partial<SharedProject> = {}): SharedProject {
  return {
    id,
    rootPath,
    displayName: null,
    sources: ["manual"],
    providerRefs: { claude: [], codex: [] },
    status: null,
    memo: "",
    tracks: [],
    hidden: false,
    order: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...patch,
  };
}

function workProject(id: string, name: string, patch: Partial<WorkProject> = {}): WorkProject {
  return {
    id,
    name,
    category: "기타",
    status: null,
    memo: "",
    notionLinks: [],
    localFolders: [],
    members: [],
    order: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...patch,
  };
}

/** 한 PC의 상태를 메모리에 들고 ProfileDependencies처럼 행동한다 — 서비스의 실제 규칙(멤버 이동 등)은 흉내 내지 않는다. */
function fakePc(name: string, roots: LogicalRoots, base: string) {
  let settings: AppSettings = parseSettings({});
  const projects: ProjectRegistryV1 = { schemaVersion: 1, updatedAt: STAMP, projects: {} };
  const workProjects: WorkProjectRegistryV1 = { schemaVersion: 1, updatedAt: STAMP, teamsSyncRoot: null, workProjects: {} };
  const tags: ProjectTagsV1 = { schemaVersion: 1, updatedAt: STAMP, tags: {} };
  let nextId = 1;
  const deps: ProfileDependencies = {
    roots: () => roots,
    machineName: () => name,
    now: () => new Date(STAMP),
    platform: "win32",
    settings: {
      get: () => settings,
      update: async (patch) => {
        settings = parseSettings(mergeSettingsPatch(settings, patch));
      },
    },
    readProjects: async () => structuredClone(projects),
    projects: {
      registerManualFolder: async (rootPath, displayName) => {
        const id = `${name}-p${nextId++}`;
        projects.projects[id] = folder(id, rootPath, { displayName: displayName ?? null });
        return projects;
      },
      updateProjectMetadata: async (projectId, update) => {
        projects.projects[projectId] = { ...projects.projects[projectId]!, ...update } as SharedProject;
        return projects;
      },
    },
    readWorkProjects: async () => structuredClone(workProjects),
    workProjects: {
      createWorkProject: async (input) => {
        const id = `${name}-wp${nextId++}`;
        workProjects.workProjects[id] = workProject(id, input.name, { category: input.category ?? "기타" });
        return structuredClone(workProjects);
      },
      updateWorkProjectMetadata: async (id, update) => {
        workProjects.workProjects[id] = { ...workProjects.workProjects[id]!, ...update } as WorkProject;
        return structuredClone(workProjects);
      },
      addMember: async (id, projectId, role) => {
        workProjects.workProjects[id]!.members.push({ projectId, role });
        return structuredClone(workProjects);
      },
    },
    readTags: async () => structuredClone(tags),
    setTags: async (id, next) => {
      tags.tags[id] = [...next];
    },
    backup: { files: [path.join(base, `${name}-settings.json`)], dir: path.join(base, `${name}-backups`) },
  };
  return { deps, projects, workProjects, tags, getSettings: () => settings, setSettings: (next: AppSettings) => (settings = next) };
}

let base: string;
let home: ReturnType<typeof fakePc>;
let lab: ReturnType<typeof fakePc>;
let homeRoots: LogicalRoots;
let labRoots: LogicalRoots;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "mcw-profile-"));
  homeRoots = {
    dev: path.join(base, "C", "dev"),
    data: path.join(base, "C", "data"),
    work: null,
    drive: path.join(base, "G", "내 드라이브"),
    home: path.join(base, "C", "Users", "me"),
  };
  labRoots = {
    dev: path.join(base, "D", "dev"),
    data: path.join(base, "D", "data"),
    work: null,
    drive: path.join(base, "G", "내 드라이브"),
    home: path.join(base, "C", "Users", "lab"),
  };
  // 실험실 PC에는 multi-cli-work 레포와 드라이브 폴더만 있다 — dotori 레포는 아직 받지 않았다.
  for (const dir of [
    path.join(homeRoots.dev!, "multi-cli-work"),
    path.join(homeRoots.dev!, "dotori_rcs"),
    path.join(homeRoots.drive!, "R_DOTORI"),
    path.join(labRoots.dev!, "multi-cli-work"),
  ]) {
    await mkdir(dir, { recursive: true });
  }
  home = fakePc("home", homeRoots, base);
  lab = fakePc("lab", labRoots, base);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function seedHome() {
  home.setSettings(
    parseSettings({
      ...DEFAULT_SETTINGS,
      projects: {
        categories: [
          { name: "연구개발", color: 3, code: "R", templateId: "lab" },
          { name: "기타", color: 6, code: "Z" },
        ],
        defaultCategory: "기타",
        folderTemplates: [{ id: "lab", name: "실험", folders: ["01_문서", "02_실험/원본"] }],
      },
      appearance: { theme: "light" },
      remote: { enabled: true, port: 50000 },
      pcRoots: { dev: homeRoots.dev, data: null, work: null, drive: null },
      notifications: { ...DEFAULT_SETTINGS.notifications, snoozedUntil: "2026-10-15T01:00:00.000Z" },
    }),
  );
  const repo = folder("h-repo", path.join(homeRoots.dev!, "multi-cli-work"), { displayName: "MCW", status: "진행중", memo: "메모" });
  const dotori = folder("h-dotori", path.join(homeRoots.dev!, "dotori_rcs"));
  const docs = folder("h-docs", path.join(homeRoots.drive!, "R_DOTORI"));
  const outside = folder("h-np", path.join(base, "NeuroPilot", "neuropilot_develop"));
  Object.assign(home.projects.projects, { [repo.id]: repo, [dotori.id]: dotori, [docs.id]: docs, [outside.id]: outside });
  home.workProjects.workProjects["wp-dotori"] = workProject("wp-dotori", "R_DOTORI", {
    category: "연구개발",
    status: "진행중",
    notionLinks: [{ label: "채널", url: "https://notion.so/a" }],
    localFolders: [{ label: "원본 데이터", path: path.join(homeRoots.data!, "R_DOTORI") }],
    members: [
      { projectId: "h-dotori", role: "repo" },
      { projectId: "h-docs", role: "docs" },
    ],
  });
  home.workProjects.workProjects["wp-vibe"] = workProject("wp-vibe", "R_바이브코딩", {
    category: "연구개발",
    members: [{ projectId: "h-repo", role: "repo" }],
  });
  home.tags.tags["wp-dotori"] = ["로봇"];
}

describe("설정 프로필", () => {
  it("경로는 논리 경로로, 루트 밖은 절대경로로 적고 PC 전용 설정·일시 중지는 빼고 내보낸다", async () => {
    seedHome();
    const profile = await buildProfile(home.deps);

    expect(profile).toMatchObject({ format: "mcw-profile", version: 1, exportedFrom: "home" });
    expect(profile.settings).not.toHaveProperty("remote");
    expect(profile.settings).not.toHaveProperty("pcRoots");
    expect((profile.settings.notifications as { snoozedUntil: unknown }).snoozedUntil).toBeNull();
    expect(profile.folderProjects.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["dev/multi-cli-work", "dev/dotori_rcs", "drive/R_DOTORI", path.join(base, "NeuroPilot", "neuropilot_develop")]),
    );
    const dotori = profile.workProjects.find((entry) => entry.name === "R_DOTORI")!;
    expect(dotori.members).toEqual([
      { path: "dev/dotori_rcs", role: "repo" },
      { path: "drive/R_DOTORI", role: "docs" },
    ]);
    expect(dotori.localFolders).toEqual([{ label: "원본 데이터", path: "data/R_DOTORI" }]);
    expect(dotori.tags).toEqual(["로봇"]);
  });

  it("다른 PC의 루트로 풀어 미리 보고, 병합하며, 없는 폴더는 건너뛰고 알린다", async () => {
    seedHome();
    const profile = parseProfile(JSON.parse(JSON.stringify(await buildProfile(home.deps))));
    await mkdir(path.join(labRoots.drive!, "R_DOTORI"), { recursive: true });
    lab.workProjects.workProjects["lab-only"] = workProject("lab-only", "Z_실험실메모");

    const preview = await previewProfileImport("profile.json", profile, lab.deps);
    expect(preview.settingsChanged).toEqual(expect.arrayContaining(["projects", "appearance"]));
    expect(preview.settingsChanged).not.toContain("remote");
    expect(preview.workProjects).toEqual([
      { name: "R_DOTORI", action: "add" },
      { name: "R_바이브코딩", action: "add" },
    ]);
    expect(preview.folders).toEqual(
      expect.arrayContaining([
        { path: "dev/multi-cli-work", resolvedPath: path.join(labRoots.dev!, "multi-cli-work"), action: "add" },
        { path: "dev/dotori_rcs", resolvedPath: path.join(labRoots.dev!, "dotori_rcs"), action: "missing" },
      ]),
    );

    const result = await applyProfileImport(profile, lab.deps);
    expect(result).toMatchObject({ addedWorkProjects: 2, updatedWorkProjects: 0, addedFolders: 2 });
    expect(result.missingFolders).toEqual(expect.arrayContaining(["dev/dotori_rcs"]));

    // 설정은 병합되지만 이 PC의 원격 설정은 그대로다.
    expect(lab.getSettings().appearance.theme).toBe("light");
    expect(lab.getSettings().projects.categories.map((category) => category.code)).toEqual(["R", "Z"]);
    // 폴더 템플릿과 구분의 기본 템플릿도 같이 옮겨진다.
    expect(lab.getSettings().projects.folderTemplates).toEqual([{ id: "lab", name: "실험", folders: ["01_문서", "02_실험/원본"] }]);
    expect(lab.getSettings().projects.categories[0]?.templateId).toBe("lab");
    expect(lab.getSettings().remote).toEqual(DEFAULT_SETTINGS.remote);

    const labWork = Object.values(lab.workProjects.workProjects);
    expect(labWork.map((entry) => entry.name).sort()).toEqual(["R_DOTORI", "R_바이브코딩", "Z_실험실메모"]);
    const dotori = labWork.find((entry) => entry.name === "R_DOTORI")!;
    const memberPaths = dotori.members.map((member) => lab.projects.projects[member.projectId]!.rootPath);
    expect(memberPaths).toEqual([path.join(labRoots.drive!, "R_DOTORI")]);
    expect(dotori.localFolders).toEqual([{ label: "원본 데이터", path: path.join(labRoots.data!, "R_DOTORI") }]);
    expect(lab.tags.tags[dotori.id]).toEqual(["로봇"]);
    const mcw = Object.values(lab.projects.projects).find((project) => project.rootPath.endsWith("multi-cli-work"))!;
    expect(mcw).toMatchObject({ displayName: "MCW", status: "진행중", memo: "메모" });

    // 불러오기 직전 파일을 백업해 둔다(없는 파일은 건너뛴다).
    expect(await readdir(result.backupDir)).toEqual([]);
  });

  it("다시 불러오면 이름으로 같은 업무 프로젝트를 찾아 갱신하고 멤버를 겹쳐 붙이지 않는다", async () => {
    seedHome();
    const profile = await buildProfile(home.deps);
    await applyProfileImport(profile, lab.deps);
    const again = await applyProfileImport(profile, lab.deps);
    expect(again).toMatchObject({ addedWorkProjects: 0, updatedWorkProjects: 2, addedFolders: 0 });
    const vibe = Object.values(lab.workProjects.workProjects).find((entry) => entry.name === "R_바이브코딩")!;
    expect(vibe.members).toHaveLength(1);
  });

  it("백업은 있는 파일을 복사한다", async () => {
    await writeFile(path.join(base, "lab-settings.json"), "{}", "utf8");
    const result = await applyProfileImport(parseProfile({ format: "mcw-profile", version: 1 }), lab.deps);
    expect(await readdir(result.backupDir)).toEqual(["lab-settings.json"]);
  });

  it("형식이 다른 파일은 거부하고, 모양이 틀린 항목은 버린다", () => {
    expect(() => parseProfile({ format: "other" })).toThrow(/프로필 파일이 아닙니다/);
    expect(() => parseProfile({ format: "mcw-profile", version: 2 })).toThrow(/버전/);
    const parsed = parseProfile({
      format: "mcw-profile",
      version: 1,
      folderProjects: [{ path: "dev/a" }, { path: 3 }, "x"],
      workProjects: [{ name: " R_a ", members: [{ path: "dev/a", role: "repo" }, { path: "dev/b", role: "owner" }] }, { name: "" }],
    });
    expect(parsed.folderProjects.map((entry) => entry.path)).toEqual(["dev/a"]);
    expect(parsed.workProjects).toHaveLength(1);
    expect(parsed.workProjects[0]).toMatchObject({ name: "R_a", members: [{ path: "dev/a", role: "repo" }] });
  });

  it("절대경로는 그대로, 논리 경로는 루트로 푼다", () => {
    expect(resolveProfilePath("C:\\NeuroPilot\\x", labRoots)).toBe("C:\\NeuroPilot\\x");
    expect(resolveProfilePath("/opt/x", labRoots)).toBe("/opt/x");
    expect(resolveProfilePath("dev/multi-cli-work", labRoots)).toBe(path.join(labRoots.dev!, "multi-cli-work"));
    expect(resolveProfilePath("work/x", labRoots)).toBeNull();
  });
});
