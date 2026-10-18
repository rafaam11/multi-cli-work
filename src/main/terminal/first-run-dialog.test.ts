// @vitest-environment node

import { describe, expect, it } from "vitest";
import { FirstRunDialogWatcher } from "./first-run-dialog";

describe("FirstRunDialogWatcher", () => {
  it("spots Claude's folder trust prompt drawn in pieces with cursor moves", () => {
    const watcher = new FirstRunDialogWatcher();
    watcher.observe("s", "Quick safety check: Is this a project you created or one you trust?\r\n❯ 1. Yes, I\u001b[1Ctrust");
    expect(watcher.isUp("s")).toBe(false);
    watcher.observe("s", " this folder\r\n  2. No, exit");
    expect(watcher.isUp("s")).toBe(true);
  });

  it("closes once the prompt box is drawn after the dialog, and on an answer", () => {
    const watcher = new FirstRunDialogWatcher();
    watcher.observe("s", "› 1. Review hooks  2. Trust all and continue");
    watcher.observe("s", ">_ OpenAI Codex\r\n› Ask Codex to do anything\r\n  ? for shortcuts");
    expect(watcher.isUp("s")).toBe(false);

    watcher.observe("s", "Allow Codex to work in this folder?");
    expect(watcher.isUp("s")).toBe(true);
    watcher.answered("s");
    expect(watcher.isUp("s")).toBe(false);
  });

  it("keeps sessions apart and ignores ordinary output", () => {
    const watcher = new FirstRunDialogWatcher();
    watcher.observe("a", "Trust all and continue");
    watcher.observe("b", "I trust this folder's tests. Do you want me to continue?");
    expect(watcher.isUp("a")).toBe(true);
    expect(watcher.isUp("b")).toBe(false);
    watcher.forget("a");
    expect(watcher.isUp("a")).toBe(false);
  });
});
