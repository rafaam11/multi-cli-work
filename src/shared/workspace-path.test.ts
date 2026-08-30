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
  parseShell,
  relativeSegments,
  resolveShellRefForPath,
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

describe("classifyWorkspacePath — 3루트 분류", () => {
  it("work 루트: 채널·셸·wiki·어휘 폴더", () => {
    expect(classifyWorkspacePath(ROOT, ROOTS, win).kind).toBe("root");
    expect(classify("O_SMCH").kind).toBe("channel");
    expect(classify("O_SMCH\\24_SMCH_VSP-1").kind).toBe("shell");
    expect(classify("O_SMCH\\24_SMCH_VSP-1\\wiki\\permanent").kind).toBe("shell-sub");
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
    expect(classifyWorkspacePath(`${ROOT}\\O_SMCH\\24_SMCH_VSP-1`, nested, win).kind).toBe("shell");
  });

  it("채널 슬러그가 어긋난 셸은 other + 경고다", () => {
    const mismatched = classify("O_SMCH\\24_ATNC_VSP-1");
    expect(mismatched.kind).toBe("other");
    expect(mismatched.warning).toContain("셸 이름 규약 위반");
  });

  it("Z_Archive 안 원래 슬러그도 classify에서는 other다", () => {
    // ws-index가 channel_origin으로 따로 처리하는 영역 — 분류기는 규칙을 느슨하게 하지 않는다.
    expect(classify("Z_Archive\\23_SMCH_DtNavi").kind).toBe("other");
  });

  it("세 루트 어디에도 없으면 outside다", () => {
    expect(classifyWorkspacePath("C:\\Users\\uiop3\\Desktop", ROOTS, win).kind).toBe("outside");
    expect(classifyWorkspacePath("C:\\", ROOTS, win).kind).toBe("outside");
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
