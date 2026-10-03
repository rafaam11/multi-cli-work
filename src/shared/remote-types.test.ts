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
    expect(parseRemoteClientMessage('{"type":"create","projectId":"p1","kind":"claude","cols":200}')).toEqual({
      type: "create",
      projectId: "p1",
      kind: "claude",
    });
    expect(parseRemoteClientMessage('{"type":"stop","sessionId":"s"}')).toEqual({ type: "stop", sessionId: "s" });
    expect(parseRemoteClientMessage('{"type":"resume","sessionId":"s","rows":9}')).toEqual({ type: "resume", sessionId: "s" });
    expect(parseRemoteClientMessage('{"type":"remove","sessionId":"s"}')).toEqual({ type: "remove", sessionId: "s" });
  });

  it("rejects session management messages it cannot act on", () => {
    for (const raw of [
      '{"type":"create","kind":"claude"}',
      '{"type":"create","projectId":"","kind":"claude"}',
      '{"type":"create","projectId":"p1"}',
      '{"type":"create","projectId":"p1","kind":"Claude"}',
      '{"type":"create","projectId":"p1","kind":"../x"}',
      `{"type":"create","projectId":"p1","kind":"${"a".repeat(33)}"}`,
      '{"type":"stop"}',
      '{"type":"resume","sessionId":""}',
      '{"type":"remove","sessionId":7}',
    ]) {
      expect(parseRemoteClientMessage(raw), raw).toBeNull();
    }
  });
});
