import { describe, expect, it } from "vitest";
import {
  ancestorPaths,
  classifyWorkspacePath,
  cleanWorkspacePath,
  deriveWorkspaceLocation,
  detectPathStyle,
  frontmatterStrings,
  parseChannel,
  parseDataset,
  parseProjectKey,
  parseShell,
  relativeSegments,
  resolveShellRefForPath,
  shellLinkKey,
  splitFrontmatter,
  workspacePathKey,
} from "./workspace-path";

/**
 * 벡터는 `<ROOT>/_scripts/lib/ws-path.test.mjs`에서 옮겨 왔다. 두 구현이 갈라지면 여기서 먼저
 * 깨져야 하므로 기대값을 손대지 말고 구현을 고친다. 경로 스타일은 명시한다 — 이 규칙은 Windows
 * 워크스페이스의 것이고, 테스트가 도는 OS와는 무관해야 한다.
 */
const ROOT = "C:\\work";
const DEV = "C:\\dev";
const DATA = "C:\\data";
const win = "win32" as const;
const ROOTS = { work: ROOT, dev: DEV, data: DATA };
const classify = (relative: string) => classifyWorkspacePath(`${ROOT}\\${relative}`, ROOTS, win);
const classifyIn = (base: string, relative = "") =>
  classifyWorkspacePath(relative ? `${base}\\${relative}` : base, ROOTS, win);

describe("채널 이름", () => {
  it("접두 글자와 슬러그로 쪼갠다", () => {
    expect(parseChannel("O_SMCH")).toEqual({ letter: "O", slug: "SMCH", name: "O_SMCH" });
    expect(parseChannel("P_Personal")?.slug).toBe("Personal");
  });

  it("규약 밖 이름은 거부한다", () => {
    expect(parseChannel("X_Foo")).toBeNull();
    expect(parseChannel("O_")).toBeNull();
    expect(parseChannel("O_삼성")).toBeNull();
  });
});

describe("셸 이름 — 채널 슬러그 반복·주제 생략·차수", () => {
  it("연도·슬러그·주제·차수를 쪼갠다", () => {
    expect(parseShell("24_SMCH_VirtualHospital-1", "SMCH")).toEqual({
      yy: "24",
      channelSlug: "SMCH",
      topic: "VirtualHospital",
      n: 1,
      name: "24_SMCH_VirtualHospital-1",
    });
    expect(parseShell("26_StartupGrowth-1", "StartupGrowth")?.topic).toBeNull();
    expect(parseShell("26_Personal_Career-1", "Personal")?.n).toBe(1);
    expect(parseShell("26_Coursework_MedicalImaging", "Coursework")?.n).toBeNull();
  });

  it("채널 슬러그 불일치와 형식 위반을 거부한다", () => {
    expect(parseShell("24_SMCH_VSP-1", "ATNC")).toBeNull();
    expect(parseShell("2024_SMCH_VSP", "SMCH")).toBeNull();
    expect(parseShell("24-SMCH-VSP", "SMCH")).toBeNull();
  });
});

describe("데이터셋 이름", () => {
  it("연도·출처·이름·차수를 쪼갠다", () => {
    expect(parseDataset("24_SMCH_HeadCT-1")).toEqual({
      yy: "24",
      source: "SMCH",
      dataset: "HeadCT",
      n: 1,
      name: "24_SMCH_HeadCT-1",
    });
    expect(parseDataset("25_Public_KITTI")?.n).toBeNull();
    expect(parseDataset("HeadCT")).toBeNull();
  });
});

describe("PRJ 프로젝트 키", () => {
  it("일련번호와 슬러그로 쪼갠다", () => {
    expect(parseProjectKey("PRJ-0017-secondbrain")).toEqual({
      seq: 17,
      slug: "secondbrain",
      key: "PRJ-0017-secondbrain",
    });
    expect(parseProjectKey("PRJ-0014-coursework-selfstudy")?.slug).toBe("coursework-selfstudy");
    expect(parseProjectKey("PRJ-0001-a")?.seq).toBe(1);
  });

  it("규약 밖 이름은 거부한다", () => {
    expect(parseProjectKey("PRJ-17-x")).toBeNull();        // 4자리가 아니다
    expect(parseProjectKey("PRJ-0017-Second")).toBeNull(); // 슬러그는 소문자·숫자·하이픈만
    expect(parseProjectKey("PRJ-0017-")).toBeNull();
    expect(parseProjectKey("PRJ-0017")).toBeNull();
    expect(parseProjectKey("prj-0017-x")).toBeNull();
    expect(parseProjectKey("PRJ-0017--x")).toBeNull();     // 하이픈 연속 금지
  });
});

describe("classifyWorkspacePath — 3루트 분류", () => {
  it("work 루트: 채널·셸·wiki·어휘 폴더", () => {
    expect(classifyWorkspacePath(ROOT, ROOTS, win).kind).toBe("root");
    expect(classify("O_SMCH").kind).toBe("legacy-channel");
    expect(classify("O_SMCH\\24_SMCH_VSP-1").kind).toBe("legacy-shell");
    expect(classify("O_SMCH\\24_SMCH_VSP-1\\wiki\\permanent").kind).toBe("legacy-shell-sub");
    expect(classify("wiki\\entities").kind).toBe("wiki");
    expect(classify("_templates\\shell").kind).toBe("other");
  });

  it("dev 루트는 work의 형제다 — 레포와 휴면 레포", () => {
    expect(classifyIn(DEV).kind).toBe("dev-dir");
    expect(classifyIn(DEV, "VSP_FastAPI")).toMatchObject({
      kind: "repo",
      repo: "VSP_FastAPI",
      archive: false,
      rel: "VSP_FastAPI",
    });
    expect(classifyIn(DEV, "VSP_FastAPI\\src").kind).toBe("repo-sub");
    expect(classifyIn(DEV, "_archive\\PIPER-FMS").kind).toBe("repo-archive");
    expect(classifyIn(DEV, "_archive\\PIPER-FMS\\src").kind).toBe("repo-sub");
  });

  it("data 루트도 형제다 — 목적·데이터셋", () => {
    expect(classifyIn(DATA).kind).toBe("data-root");
    expect(classifyIn(DATA, "patient").kind).toBe("data-purpose");
    expect(classifyIn(DATA, "patient\\24_SMCH_HeadCT-1").kind).toBe("dataset");
    expect(classifyIn(DATA, "patient\\24_SMCH_HeadCT-1\\dicom").kind).toBe("dataset-sub");
  });

  it("dev·data가 work 안에 있던 예전 배치도 같은 답을 낸다", () => {
    const nested = { work: ROOT, dev: `${ROOT}\\dev`, data: `${ROOT}\\data` };
    expect(classifyWorkspacePath(`${ROOT}\\dev\\VSP_FastAPI`, nested, win).kind).toBe("repo");
    expect(classifyWorkspacePath(`${ROOT}\\data\\patient`, nested, win).kind).toBe("data-purpose");
    expect(classifyWorkspacePath(`${ROOT}\\O_SMCH\\24_SMCH_VSP-1`, nested, win).kind).toBe("legacy-shell");
  });

  it("채널 슬러그가 어긋난 셸은 other + 경고다", () => {
    const mismatched = classify("O_SMCH\\24_ATNC_VSP-1");
    expect(mismatched.kind).toBe("other");
    expect(mismatched.warning).toContain("셸 이름 규약 위반");
  });

  it("Z_Archive 안 원래 슬러그는 슬러그 검증을 면제한다", () => {
    // ws-path.mjs 판단 A: Z_Archive는 이관 전 원래 채널 슬러그를 그대로 남긴 휴면 셸이 많아 검증을 면제한다.
    expect(classify("Z_Archive\\23_SMCH_DtNavi").kind).toBe("legacy-shell");
  });

  it("세 루트 어디에도 없으면 outside다", () => {
    expect(classifyWorkspacePath("C:\\Users\\uiop3\\Desktop", ROOTS, win).kind).toBe("outside");
    expect(classifyWorkspacePath("C:\\", ROOTS, win).kind).toBe("outside");
  });
});

/**
 * 벡터 정본은 `<ROOT>/_scripts/lib/ws-path.vectors.json`이다(읽기 전용 · 교차 저장소 계약).
 * 아래 케이스는 그 파일의 `cases` 배열을 그대로 옮긴 것이다 — 기대값을 손대지 말고 구현을 고친다.
 */
describe("classifyWorkspacePath — v2 PRJ 평면 구조", () => {
  it("projects 루트와 Project 폴더·하위를 쪼갠다", () => {
    expect(classify("projects")).toMatchObject({ kind: "projects-root", archived: false });
    expect(classify("projects\\PRJ-0005-neuropilot")).toMatchObject({
      kind: "project",
      project: "PRJ-0005-neuropilot",
      channel: "projects",
      shell: "PRJ-0005-neuropilot",
      archived: false,
    });
    expect(classify("projects\\PRJ-0005-neuropilot\\wiki\\permanent")).toMatchObject({
      kind: "project-sub",
      project: "PRJ-0005-neuropilot",
      channel: "projects",
      shell: "PRJ-0005-neuropilot",
    });
    expect(classify("projects\\PRJ-0005-neuropilot").parsedProject).toEqual({
      seq: 5,
      slug: "neuropilot",
      key: "PRJ-0005-neuropilot",
    });
  });

  it("휴면 Project는 projects/_archive 아래다", () => {
    expect(classify("projects\\_archive")).toMatchObject({ kind: "projects-root", archived: true });
    expect(classify("projects\\_archive\\PRJ-0001-kitu-undergraduate")).toMatchObject({
      kind: "project-archive",
      project: "PRJ-0001-kitu-undergraduate",
      channel: "projects/_archive",
      shell: "PRJ-0001-kitu-undergraduate",
      archived: true,
    });
    expect(classify("projects\\_archive\\PRJ-0001-kitu-undergraduate\\wiki")).toMatchObject({
      kind: "project-archive-sub",
      archived: true,
    });
  });

  it("키 규약을 어긴 폴더는 other + 경고다", () => {
    const bad = classify("projects\\not-a-key");
    expect(bad.kind).toBe("other");
    expect(bad.warning).toContain("프로젝트 키 규약 위반");
    const badArchived = classify("projects\\_archive\\nope");
    expect(badArchived.kind).toBe("other");
    expect(badArchived.warning).toContain("프로젝트 키 규약 위반");
  });

  it("점·밑줄로 시작하는 폴더는 경고 없이 other다", () => {
    const dotGit = classify("projects\\.git");
    expect(dotGit.kind).toBe("other");
    expect(dotGit.warning).toBeUndefined();
    expect("warning" in dotGit).toBe(false);

    const underscoreLocal = classify("projects\\_local");
    expect(underscoreLocal.kind).toBe("other");
    expect(underscoreLocal.warning).toBeUndefined();
    expect("warning" in underscoreLocal).toBe(false);

    const archivedDotfile = classify("projects\\_archive\\.obsidian");
    expect(archivedDotfile.kind).toBe("other");
    expect(archivedDotfile.warning).toBeUndefined();
    expect("warning" in archivedDotfile).toBe(false);
  });

  it("legacy 채널·셸은 같은 루트에서 계속 분류된다", () => {
    expect(classify("O_SMCH").kind).toBe("legacy-channel");
    expect(classify("O_SMCH\\24_SMCH_VSP-1").kind).toBe("legacy-shell");
    expect(classify("O_SMCH\\24_SMCH_VSP-1\\wiki").kind).toBe("legacy-shell-sub");
    expect(classify("Z_Archive\\15_KITU_Undergraduate-1").kind).toBe("legacy-shell");
    expect(classify("wiki").kind).toBe("wiki");
    expect(classify("_templates").kind).toBe("other");
  });
});

describe("resolveShellRefForPath — v2 PRJ", () => {
  const lookup = {
    roots: [{ work: ROOT, dev: DEV, data: DATA }],
    repoOwners: {
      [workspacePathKey(`${DEV}\\multi-cli-work`, win)]: "projects/PRJ-0017-secondbrain",
    },
  };

  it("Project 폴더·그 하위·등록된 레포·레포 하위가 모두 같은 ref를 답한다", () => {
    expect(resolveShellRefForPath(`${ROOT}\\projects\\PRJ-0017-secondbrain`, lookup, win)).toBe(
      "projects/PRJ-0017-secondbrain",
    );
    expect(resolveShellRefForPath(`${ROOT}\\projects\\PRJ-0017-secondbrain\\wiki`, lookup, win)).toBe(
      "projects/PRJ-0017-secondbrain",
    );
    expect(resolveShellRefForPath(`${DEV}\\multi-cli-work`, lookup, win)).toBe("projects/PRJ-0017-secondbrain");
    expect(resolveShellRefForPath(`${DEV}\\multi-cli-work\\src\\main`, lookup, win)).toBe(
      "projects/PRJ-0017-secondbrain",
    );
  });

  it("휴면 Project의 ref는 _archive를 담는다", () => {
    expect(resolveShellRefForPath(`${ROOT}\\projects\\_archive\\PRJ-0001-kitu-undergraduate`, lookup, win)).toBe(
      "projects/_archive/PRJ-0001-kitu-undergraduate",
    );
  });

  it("projects 루트 자체는 어느 Project의 것도 아니다", () => {
    expect(resolveShellRefForPath(`${ROOT}\\projects`, lookup, win)).toBeNull();
  });
});

describe("shellLinkKey — 링크와 셸 맞추기", () => {
  it("같은 루트·같은 ref면 같은 키다 (루트는 대소문자·끝 구분자 무시)", () => {
    expect(shellLinkKey("C:\\work", "O_SMCH", "24_SMCH_VSP-1", win)).toBe(
      shellLinkKey("c:\\WORK\\", "O_SMCH", "24_SMCH_VSP-1", win),
    );
  });

  it("v2 Project는 projects ↔ projects/_archive를 오가도 PRJ-key가 같으면 같은 키다", () => {
    expect(shellLinkKey(ROOT, "projects", "PRJ-0017-secondbrain", win)).toBe(
      shellLinkKey(ROOT, "projects/_archive", "PRJ-0017-secondbrain", win),
    );
  });

  it("키·루트·채널이 다르면 다른 키다", () => {
    const base = shellLinkKey(ROOT, "projects", "PRJ-0017-secondbrain", win);
    expect(shellLinkKey(ROOT, "projects/_archive", "PRJ-0016-finance", win)).not.toBe(base);
    expect(shellLinkKey("D:\\work","projects", "PRJ-0017-secondbrain", win)).not.toBe(base);
    expect(shellLinkKey(ROOT, "O_SMCH", "PRJ-0017-secondbrain", win)).not.toBe(base);
  });
});

describe("프론트매터 — 파싱·본문 보존", () => {
  it("스칼라·인라인 배열·빈 배열을 읽고 본문을 남긴다", () => {
    const text =
      '---\ntitle: "가상병원: 1차"\nchannel: O_SMCH\nrepos: [VSP_FastAPI, VSP_MQ_v2]\nstatus: active\ndata: []\n---\n# 본문\n';
    const { fm, body } = splitFrontmatter(text);
    expect(fm?.title).toBe("가상병원: 1차");
    expect(fm?.repos).toEqual(["VSP_FastAPI", "VSP_MQ_v2"]);
    expect(fm?.data).toEqual([]);
    expect(body).toBe("# 본문\n");
  });

  it("프론트매터가 없으면 본문만 돌려준다", () => {
    expect(splitFrontmatter("# 제목\n").fm).toBeNull();
  });

  it("frontmatterStrings는 스칼라도 배열도 같은 모양으로 준다", () => {
    expect(frontmatterStrings(["a", "b"])).toEqual(["a", "b"]);
    expect(frontmatterStrings("a")).toEqual(["a"]);
    expect(frontmatterStrings(null)).toEqual([]);
    expect(frontmatterStrings(undefined)).toEqual([]);
  });
});

describe("경로 정규화", () => {
  it("구분자를 통일하고 후행 구분자를 뗀다", () => {
    expect(cleanWorkspacePath("C:/work/O_SMCH/", win)).toBe("C:\\work\\O_SMCH");
    expect(cleanWorkspacePath("C:\\work\\", win)).toBe("C:\\work");
    expect(cleanWorkspacePath("/home/me/ws/", "posix")).toBe("/home/me/ws");
  });

  it("이스케이프가 안 풀린 프론트매터 경로의 겹백슬래시를 접는다", () => {
    // 셸 external_paths의 "C:\\NeuroPilot\\x"는 ws-path.mjs 파서가 그대로 읽어 백슬래시가 둘이다.
    expect(cleanWorkspacePath("C:\\\\NeuroPilot\\\\neuropilot_develop", win)).toBe(
      "C:\\NeuroPilot\\neuropilot_develop",
    );
  });

  it("UNC 접두는 남긴다", () => {
    expect(cleanWorkspacePath("\\\\server\\share\\ws\\", win)).toBe("\\\\server\\share\\ws");
  });

  it("Windows 키는 대소문자를 무시하고 posix는 구분한다", () => {
    expect(workspacePathKey("C:\\WORK\\O_SMCH", win)).toBe(workspacePathKey("c:/work/o_smch", win));
    expect(workspacePathKey("/home/WS", "posix")).not.toBe(workspacePathKey("/home/ws", "posix"));
  });

  it("relativeSegments는 하위 경로만 받는다", () => {
    expect(relativeSegments(ROOT, `${ROOT}\\O_SMCH\\24_SMCH_VSP-1`, win)).toEqual(["O_SMCH", "24_SMCH_VSP-1"]);
    expect(relativeSegments(ROOT, ROOT, win)).toEqual([]);
    expect(relativeSegments(ROOT, "C:\\workx\\dev", win)).toBeNull();
    expect(relativeSegments(ROOT, "C:\\Users", win)).toBeNull();
  });

  it("스타일 추정은 드라이브 문자와 백슬래시를 본다", () => {
    expect(detectPathStyle("C:\\work")).toBe("win32");
    expect(detectPathStyle("C:/work")).toBe("win32");
    expect(detectPathStyle("/home/me/ws")).toBe("posix");
  });
});

describe("deriveWorkspaceLocation", () => {
  const roots = [{ work: ROOT, dev: DEV, data: DATA }];

  it("레포·셸·데이터셋·채널을 좁힌 kind로 준다", () => {
    expect(deriveWorkspaceLocation(`${DEV}\\VSP_FastAPI`, roots, win)).toEqual({
      root: ROOT,
      kind: "repo",
      repoName: "VSP_FastAPI",
    });
    expect(deriveWorkspaceLocation(`${ROOT}\\O_SMCH\\24_SMCH_VSP-1`, roots, win)).toEqual({
      root: ROOT,
      kind: "shell",
      channel: "O_SMCH",
      shell: "24_SMCH_VSP-1",
    });
    expect(deriveWorkspaceLocation(`${ROOT}\\O_SMCH\\24_SMCH_VSP-1\\wiki`, roots, win)?.kind).toBe("shell-sub");
    expect(deriveWorkspaceLocation(`${ROOT}\\O_SMCH`, roots, win)?.kind).toBe("channel");
    expect(deriveWorkspaceLocation(`${DEV}\\_archive\\PIPER-FMS`, roots, win)).toEqual({
      root: ROOT,
      kind: "repo-archive",
      repoName: "PIPER-FMS",
    });
    expect(deriveWorkspaceLocation(`${DEV}\\VSP_FastAPI\\src`, roots, win)?.kind).toBe("repo-sub");
  });

  it("데이터셋 하위도 그 데이터셋으로 접는다", () => {
    expect(deriveWorkspaceLocation(`${DATA}\\patient\\24_SMCH_HeadCT-1\\dicom`, roots, win)).toEqual({
      root: ROOT,
      kind: "dataset",
      purpose: "patient",
      dataset: "24_SMCH_HeadCT-1",
    });
  });

  it("루트 자체와 어휘 폴더는 other다", () => {
    expect(deriveWorkspaceLocation(ROOT, roots, win)?.kind).toBe("other");
    expect(deriveWorkspaceLocation(DEV, roots, win)?.kind).toBe("other");
    expect(deriveWorkspaceLocation(`${ROOT}\\wiki\\entities`, roots, win)?.kind).toBe("other");
  });

  it("어느 루트에도 없으면 null이다", () => {
    expect(deriveWorkspaceLocation("D:\\other\\repo", roots, win)).toBeNull();
    expect(deriveWorkspaceLocation(`${DEV}\\VSP_FastAPI`, [], win)).toBeNull();
  });

  it("루트가 중첩되면 더 깊은 쪽이 이긴다", () => {
    const nested = [
      { work: "C:\\", dev: "C:\\nowhere-dev", data: "C:\\nowhere-data" },
      { work: ROOT, dev: DEV, data: DATA },
    ];
    expect(deriveWorkspaceLocation(`${DEV}\\VSP_FastAPI`, nested, win)?.root).toBe(ROOT);
  });
});

describe("resolveShellRefForPath", () => {
  const lookup = {
    roots: [{ work: ROOT, dev: DEV, data: DATA }],
    repoOwners: {
      [workspacePathKey(`${DEV}\\VSP_FastAPI`, win)]: "O_SMCH/24_SMCH_VSP-1",
      [workspacePathKey("C:\\NeuroPilot\\neuropilot_develop", win)]: "O_ATNC/24_ATNC_NeuroPilot-1",
    },
  };

  it("셸 폴더와 그 하위는 자기 셸을 답한다", () => {
    expect(resolveShellRefForPath(`${ROOT}\\O_SMCH\\24_SMCH_VSP-1`, lookup, win)).toBe("O_SMCH/24_SMCH_VSP-1");
    expect(resolveShellRefForPath(`${ROOT}\\O_SMCH\\24_SMCH_VSP-1\\wiki\\permanent`, lookup, win)).toBe(
      "O_SMCH/24_SMCH_VSP-1",
    );
  });

  it("등록된 레포와 그 하위 폴더는 소속 셸을 답한다", () => {
    expect(resolveShellRefForPath(`${DEV}\\VSP_FastAPI`, lookup, win)).toBe("O_SMCH/24_SMCH_VSP-1");
    expect(resolveShellRefForPath(`${DEV}\\VSP_FastAPI\\src\\api`, lookup, win)).toBe("O_SMCH/24_SMCH_VSP-1");
  });

  it("루트 밖 external_paths 레포도 답을 받는다", () => {
    expect(resolveShellRefForPath("C:\\NeuroPilot\\neuropilot_develop\\src", lookup, win)).toBe(
      "O_ATNC/24_ATNC_NeuroPilot-1",
    );
  });

  it("어느 셸의 것도 아니면 null이다", () => {
    expect(resolveShellRefForPath(`${DEV}\\Unlinked`, lookup, win)).toBeNull();
    expect(resolveShellRefForPath("D:\\somewhere\\else", lookup, win)).toBeNull();
  });

  it("ancestorPaths는 자기 자신부터 루트까지 올라간다", () => {
    expect(ancestorPaths(`${DEV}\\VSP_FastAPI`, win)).toEqual([`${DEV}\\VSP_FastAPI`, DEV, "C:\\"]);
    expect(ancestorPaths("/home/me/ws", "posix")).toEqual(["/home/me/ws", "/home/me", "/home", "/"]);
  });
});
