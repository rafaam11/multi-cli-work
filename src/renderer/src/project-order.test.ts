import { describe, expect, it } from "vitest";
import { reorderIds } from "./project-order";

describe("reorderIds", () => {
  it("moves a folder down, inserting after the drop target", () => {
    expect(reorderIds(["a", "b", "c", "d"], "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a folder up, inserting before the drop target", () => {
    expect(reorderIds(["a", "b", "c", "d"], "d", "b", "before")).toEqual(["a", "d", "b", "c"]);
  });

  it("leaves the order alone when the drop lands where the folder already is", () => {
    expect(reorderIds(["a", "b", "c"], "a", "b", "before")).toEqual(["a", "b", "c"]);
    expect(reorderIds(["a", "b", "c"], "b", "a", "after")).toEqual(["a", "b", "c"]);
  });

  it("ignores a drop onto the dragged folder itself", () => {
    expect(reorderIds(["a", "b", "c"], "b", "b", "before")).toEqual(["a", "b", "c"]);
    expect(reorderIds(["a", "b", "c"], "b", "b", "after")).toEqual(["a", "b", "c"]);
  });

  it("ignores ids that are not in the list", () => {
    expect(reorderIds(["a", "b", "c"], "zz", "b", "after")).toEqual(["a", "b", "c"]);
    expect(reorderIds(["a", "b", "c"], "a", "zz", "after")).toEqual(["a", "b", "c"]);
  });

  it("returns a new array rather than mutating the input", () => {
    const ids = ["a", "b", "c"];
    expect(reorderIds(ids, "c", "a", "before")).toEqual(["c", "a", "b"]);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});
