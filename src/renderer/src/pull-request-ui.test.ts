import { describe, expect, it } from "vitest";
import { clampDiffSidebarWidth, labelStyle } from "./pull-request-ui";

describe("pull request UI helpers", () => {
  it("clamps the file list to its pixel and 40% limits", () => {
    expect(clampDiffSidebarWidth(100, 1000)).toBe(180);
    expect(clampDiffSidebarWidth(500, 1000)).toBe(360);
    expect(clampDiffSidebarWidth(300, 600)).toBe(240);
  });

  it("uses GitHub label colors only for six digit hex values", () => {
    expect(labelStyle("b60205")).toMatchObject({ color: "#ffffff" });
    expect(labelStyle("fef2c0")).toMatchObject({ color: "#111827" });
    expect(labelStyle("#fff")).toEqual({});
    expect(labelStyle("not-a-color")).toEqual({});
  });
});
