// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hostSessionView, semanticInput } from "./worker-gateway";
describe("host-owned sessions",()=>{
 it("preserves idle as idle and does not call disconnected observations exited",()=>{
  const base={id:"s",kind:"codex",cwd:"/repo",projectId:null,createdAt:"2026-10-30T00:00:00Z",generation:"g",tabId:"w:t",paneId:"w:p",connected:true,status:"idle",observedAt:1};
  expect(hostSessionView(base).status).toBe("idle");
  expect(hostSessionView({...base,connected:false}).status).toBe("error");
  expect(hostSessionView({...base,status:"blocked"}).status).toBe("awaiting-input");
  expect(hostSessionView({...base,status:"unknown"}).status).toBe("unknown");
  expect(hostSessionView({...base,status:"unrecognized-future-state"}).status).toBe("unknown");
  expect(hostSessionView({...base,status:"starting"}).status).toBe("starting");
 });
 it("translates explicit text and Enter without forwarding raw terminal escapes",()=>{
  expect(semanticInput("한글\r")).toEqual([{TextCommit:"한글"},{Key:{code:"Enter",modifiers:0,kind:"Press",repeat_count:1,shifted_codepoint:null,generated_text:null,tracks_release:false,physical_key_id:null,windows_record:null}}]);
  expect(()=>semanticInput("\x1b[2J")).toThrow("Canvas");
 });
});
