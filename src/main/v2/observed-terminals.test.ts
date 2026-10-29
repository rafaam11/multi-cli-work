// @vitest-environment node
import { expect,it } from "vitest";
import { observedTerminals,remoteSessionId,resolveRemoteSession } from "./observed-terminals";
import type { RemoteHostObservation } from "../../shared/host-connection-types";
const terminal={id:"same",kind:"codex",cwd:"/repo",projectId:"same-project",status:"blocked",connected:true,observedAt:12,tabId:"tab",paneId:"pane",generation:"g",createdAt:"2026-10-30T00:00:00Z"};
it("keeps identical session and repository IDs on different PCs distinct without inventing fresh observations",()=>{
  const host:RemoteHostObservation={hostId:"pc",name:"Lab",enabled:true,connected:false,observedAt:13,error:null,tasks:[],terminals:[terminal]};
  const result=observedTerminals({tasks:[],terminals:[terminal],hosts:[host,{...host,hostId:"other"}]});
  expect(new Set(result.map(session=>session.id)).size).toBe(3);
  expect(result[1]).toMatchObject({id:remoteSessionId("pc","same"),projectId:null,connected:false,observedAt:12,remote:{name:"Lab",projectId:"same-project",sessionId:"same"}});
  expect(result[1].id).toMatch(/^mcwr-[a-f0-9]{64}$/);
  expect(resolveRemoteSession([host],result[1].id)).toEqual({host,terminal});
  expect(()=>resolveRemoteSession([host],result[2].id)).toThrow(/registered/);
});
