import { describe, expect, it } from "vitest";
import { parseRemoteClientMessage, REMOTE_PROTOCOL_VERSION } from "./remote-types";

describe("parseRemoteClientMessage", () => {
  it("accepts every well-formed client message", () => {
    const hello = { type: "hello", token: "t", protocolVersion: REMOTE_PROTOCOL_VERSION, mode: "ui" };
    expect(parseRemoteClientMessage(JSON.stringify(hello))).toEqual(hello);
    expect(parseRemoteClientMessage('{"type":"list"}')).toEqual({ type: "list" });
    expect(parseRemoteClientMessage('{"type":"attach","sessionId":"s"}')).toEqual({ type: "attach", sessionId: "s" });
    expect(parseRemoteClientMessage('{"type":"detach","sessionId":"s"}')).toEqual({ type: "detach", sessionId: "s" });
    expect(parseRemoteClientMessage('{"type":"write","sessionId":"s","data":"x"}')).toEqual({
      type: "write",
      sessionId: "s",
      data: "x",
    });
    expect(parseRemoteClientMessage('{"type":"resize","sessionId":"s","cols":40,"rows":20}')).toEqual({
      type: "resize",
      sessionId: "s",
      cols: 40,
      rows: 20,
    });
    expect(parseRemoteClientMessage('{"type":"releaseSize","sessionId":"s"}')).toEqual({
      type: "releaseSize",
      sessionId: "s",
    });
  });

  it("rejects malformed input instead of throwing", () => {
    for (const raw of [
      "not json",
      "null",
      "[]",
      '{"type":"nope"}',
      '{"type":"attach"}',
      '{"type":"attach","sessionId":""}',
      '{"type":"write","sessionId":"s","data":5}',
      '{"type":"resize","sessionId":"s","cols":1.5,"rows":20}',
      '{"type":"hello","token":"t","protocolVersion":1,"mode":"status"}',
      '{"type":"hello","token":"","protocolVersion":1,"mode":"ui"}',
    ]) {
      expect(parseRemoteClientMessage(raw), raw).toBeNull();
    }
  });

  it("drops unknown extra fields", () => {
    expect(parseRemoteClientMessage('{"type":"list","extra":1}')).toEqual({ type: "list" });
  });

  it("accepts the session management messages", () => {
    expect(parseRemoteClientMessage('{"type":"catalog"}')).toEqual({ type: "catalog" });
    expect(parseRemoteClientMessage('{"type":"create","projectId":"p1","kind":"claude"}')).toEqual({
      type: "create",
      projectId: "p1",
      kind: "claude",
    });
    expect(parseRemoteClientMessage('{"type":"create","projectId":"p1","kind":"claude","cols":120,"rows":40}')).toEqual({
      type: "create",
      projectId: "p1",
      kind: "claude",
      cols: 120,
      rows: 40,
    });
    expect(parseRemoteClientMessage('{"type":"create","projectId":"p1","kind":"claude","worktreeId":"w1"}')).toEqual({
      type: "create",
      projectId: "p1",
      kind: "claude",
      worktreeId: "w1",
    });
    // 크기는 둘 다 맞을 때만 싣는다. 한쪽만 오거나 정수가 아니면 크기 없이 받는다 — 호스트 기본 크기로.
    for (const raw of [
      '{"type":"create","projectId":"p1","kind":"claude","cols":200}',
      '{"type":"create","projectId":"p1","kind":"claude","cols":0,"rows":40}',
      '{"type":"create","projectId":"p1","kind":"claude","cols":80.5,"rows":40}',
    ]) {
      expect(parseRemoteClientMessage(raw), raw).toEqual({ type: "create", projectId: "p1", kind: "claude" });
    }
    expect(parseRemoteClientMessage('{"type":"stop","sessionId":"s"}')).toEqual({ type: "stop", sessionId: "s" });
    expect(parseRemoteClientMessage('{"type":"resume","sessionId":"s","rows":9}')).toEqual({ type: "resume", sessionId: "s" });
    expect(parseRemoteClientMessage('{"type":"remove","sessionId":"s"}')).toEqual({ type: "remove", sessionId: "s" });
    expect(parseRemoteClientMessage('{"type":"shelf","sessionId":"s","shelf":"hidden"}')).toEqual({
      type: "shelf",
      sessionId: "s",
      shelf: "hidden",
    });
    expect(parseRemoteClientMessage('{"type":"shelf","sessionId":"s","shelf":"active"}')).toEqual({
      type: "shelf",
      sessionId: "s",
      shelf: "active",
    });
  });

  it("rejects session management messages it cannot act on", () => {
    for (const raw of [
      '{"type":"create","kind":"claude"}',
      '{"type":"create","projectId":"","kind":"claude"}',
      '{"type":"create","projectId":"p1"}',
      '{"type":"create","projectId":"p1","kind":"Claude"}',
      '{"type":"create","projectId":"p1","kind":"../x"}',
      `{"type":"create","projectId":"p1","kind":"${"a".repeat(33)}"}`,
      '{"type":"create","projectId":"p1","kind":"claude","worktreeId":""}',
      '{"type":"create","projectId":"p1","kind":"claude","worktreeId":7}',
      '{"type":"stop"}',
      '{"type":"resume","sessionId":""}',
      '{"type":"remove","sessionId":7}',
      '{"type":"shelf","sessionId":"s"}',
      '{"type":"shelf","sessionId":"s","shelf":"workspace"}',
      '{"type":"shelf","sessionId":"","shelf":"hidden"}',
    ]) {
      expect(parseRemoteClientMessage(raw), raw).toBeNull();
    }
  });

  it("accepts every view action and the rename message", () => {
    for (const action of [
      { action: "select-folder", projectId: "p1", worktreeId: null },
      { action: "select-folder", projectId: "p1", worktreeId: "w1" },
      { action: "select-shelf", shelf: "hidden" },
      { action: "layout", layoutId: "auto" },
      { action: "layout", layoutId: "cols:1-1-1-1-1-1" },
      { action: "split", slot: 0 },
      { action: "merge", slot: 11 },
      { action: "close", slot: 3 },
      { action: "close", slot: 3, paneId: "s1" },
      { action: "page", page: 2 },
      { action: "focus", paneId: "s1" },
      { action: "move", paneId: "s1", slot: 1 },
      { action: "open", sessionId: "s1" },
      { action: "zoom", paneId: "s1" },
      { action: "zoom", paneId: null },
    ]) {
      expect(parseRemoteClientMessage(JSON.stringify({ type: "view", ...action, extra: 1 }))).toEqual({ type: "view", ...action });
    }
    expect(parseRemoteClientMessage('{"type":"rename","sessionId":"s","name":""}')).toEqual({
      type: "rename",
      sessionId: "s",
      name: "",
    });
  });

  it("rejects view actions and renames it cannot act on", () => {
    for (const raw of [
      '{"type":"view"}',
      '{"type":"view","action":"zoom"}',
      '{"type":"view","action":"zoom","paneId":""}',
      '{"type":"view","action":"select-folder","projectId":"p1"}',
      '{"type":"view","action":"select-folder","projectId":"","worktreeId":null}',
      '{"type":"view","action":"select-shelf","shelf":"workspace"}',
      // Split columns are made from a pane, not chosen whole; and seven columns do not exist.
      '{"type":"view","action":"layout","layoutId":"cols:2-1"}',
      '{"type":"view","action":"layout","layoutId":"cols:1-1-1-1-1-1-1"}',
      '{"type":"view","action":"split","slot":12}',
      '{"type":"view","action":"close","slot":-1}',
      '{"type":"view","action":"close","slot":0,"paneId":""}',
      '{"type":"view","action":"merge","slot":1.5}',
      '{"type":"view","action":"page","page":-1}',
      '{"type":"view","action":"focus","paneId":""}',
      '{"type":"view","action":"move","paneId":"s1"}',
      '{"type":"view","action":"open"}',
      '{"type":"rename","sessionId":"s"}',
      `{"type":"rename","sessionId":"s","name":"${"a".repeat(121)}"}`,
    ]) {
      expect(parseRemoteClientMessage(raw), raw).toBeNull();
    }
  });
});
