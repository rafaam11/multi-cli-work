import { describe, expect, it } from "vitest";
import { CompositionInput, keyInput } from "./terminal-input";

describe("Herdr semantic input", () => {
  it("sends semantic control/function keys with upstream modifier bits", () => {
    const key = keyInput({ key: "ArrowLeft", ctrlKey: true, shiftKey: true });
    expect(key).toMatchObject({ Key: { code: "Left", modifiers: 3, kind: "Press", tracks_release: false } });
    expect(keyInput({ key: "F12", altKey: true, repeat: true })).toMatchObject({ Key: { code: { F: 12 }, modifiers: 4, kind: "Repeat" } });
    expect(keyInput({ key: "Tab", shiftKey: true })).toMatchObject({ Key: { code: "BackTab" } });
  });
  it("leaves printable text and composition to the text input path", () => {
    expect(keyInput({ key: "한" })).toBeNull();
    expect(keyInput({ key: "a" })).toBeNull();
    expect(keyInput({ key: "Enter", isComposing: true })).toBeNull();
    expect(keyInput({ key: "Process", keyCode: 229 })).toBeNull();
    expect(keyInput({ key: "c", ctrlKey: true })).toMatchObject({ Key: { code: { Char: "c" }, modifiers: 2 } });
  });
  it("commits Korean composition exactly once across browser event ordering", () => {
    const ime = new CompositionInput();
    ime.start();
    expect(ime.input("ㅎ", true)).toBeNull();
    expect(ime.end("한", 100)).toEqual({ TextCommit: "한" });
    expect(ime.input("한", false, 101)).toBeNull();
    expect(ime.input("한", false, 500)).toEqual({ TextCommit: "한" });
    ime.start();
    expect(ime.input("국", false, 600)).toBeNull();
    expect(ime.end("국", 601)).toEqual({ TextCommit: "국" });
    expect(ime.input("a", false, 602)).toEqual({ TextCommit: "a" });
  });
});
