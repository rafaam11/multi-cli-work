import { describe, expect, it } from "vitest";
import {
  folderTemplatePathError,
  legacyTemplateIdForCode,
  normalizeFolderTemplatePath,
  parseFolderTemplateLines,
} from "./folder-template";

describe("폴더 템플릿 경로", () => {
  it("\\도 구분자로 받고, 조각마다 공백을 다듬고 NFC로 맞춘다", () => {
    expect(normalizeFolderTemplatePath(" 02_발표자료 \\ 회의록 /")).toBe("02_발표자료/회의록");
    expect(normalizeFolderTemplatePath("01_문서".normalize("NFD"))).toBe("01_문서");
  });

  it("상위 폴더, 드라이브 문자, Windows 금지 문자, 끝 점은 거부한다", () => {
    expect(folderTemplatePathError("02_발표자료/회의록")).toBeNull();
    expect(folderTemplatePathError("../밖")).toMatch(/\.\./);
    expect(folderTemplatePathError("C:/Windows")).toMatch(/절대 경로/);
    expect(folderTemplatePathError("a?b")).toMatch(/문자/);
    expect(folderTemplatePathError("자료.")).toMatch(/끝날 수 없습니다/);
  });

  it("한 줄에 하나씩 읽고, 빈 줄·중복은 버리며 잘못된 줄은 줄 번호로 알린다", () => {
    expect(parseFolderTemplateLines("01_문서\n\n01_문서\r\n02_미디어/사진")).toEqual({
      folders: ["01_문서", "02_미디어/사진"],
      errors: [],
    });
    expect(parseFolderTemplateLines("01_문서\n../x").errors).toEqual(["2번째 줄: 상위 폴더(..)는 쓸 수 없습니다"]);
  });

  it("구버전 구분은 코드로 기본 템플릿을 정한다", () => {
    expect(["G", "O", "R", "Z", "S", "U", undefined].map(legacyTemplateIdForCode)).toEqual([
      "project",
      "project",
      "minimal",
      "minimal",
      undefined,
      undefined,
      undefined,
    ]);
  });
});
