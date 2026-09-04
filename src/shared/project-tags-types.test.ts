import { describe, expect, it } from "vitest";
import { MAX_TAG_LENGTH, knownTags, normalizeTags, tagsByWorkProject, tagsOf, type ProjectTagsV1 } from "./project-tags-types";

const registry: ProjectTagsV1 = {
  schemaVersion: 1,
  updatedAt: "2026-09-03T00:00:00.000Z",
  tags: { "wp-a": ["개인", "AI"], "wp-b": ["AI"], "wp-gone": ["연구"], "wp-empty": [] },
};

describe("normalizeTags", () => {
  it("앞뒤 공백을 지우고 빈 값과 문자열 아닌 값을 버린다", () => {
    expect(normalizeTags([" 연구 ", "", "   ", 3, null, undefined, "AI"])).toEqual(["연구", "AI"]);
  });
  it("공백만 다른 값은 하나로 합치되 대소문자는 구분한다", () => {
    expect(normalizeTags(["연구", "연구 ", "Research", "research"])).toEqual(["연구", "Research", "research"]);
  });
  it("32자에서 자른 뒤 중복을 제거하고 첫 등장 순서를 지킨다", () => {
    const long = "a".repeat(MAX_TAG_LENGTH + 1);
    expect(normalizeTags([long, "b", "a".repeat(MAX_TAG_LENGTH)])).toEqual(["a".repeat(MAX_TAG_LENGTH), "b"]);
  });
});

describe("tagsOf / tagsByWorkProject", () => {
  it("행이 없거나 레지스트리가 없으면 빈 배열이다", () => {
    expect(tagsOf(registry, "missing")).toEqual([]);
    expect(tagsOf(null, "wp-a")).toEqual([]);
    expect(tagsOf(registry, "wp-a")).toEqual(["개인", "AI"]);
  });
  it("아는 업무 프로젝트의 행만 남기고 빈 행은 빈 배열로 남긴다", () => {
    expect(tagsByWorkProject(registry, ["wp-a", "wp-b", "wp-empty", "wp-new"])).toEqual({
      "wp-a": ["개인", "AI"], "wp-b": ["AI"], "wp-empty": [],
    });
  });
});

describe("knownTags", () => {
  it("많이 쓰인 태그가 앞, 동률이면 이름순이다", () => {
    expect(knownTags({ a: ["개인", "AI"], b: ["AI"], c: ["연구", "AI"], d: ["가나"] })).toEqual(["AI", "가나", "개인", "연구"]);
  });
});
