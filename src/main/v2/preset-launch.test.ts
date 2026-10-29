// @vitest-environment node
import {expect,it,vi} from "vitest";
import {launchV2Preset,type V2PresetOptions} from "./preset-launch";
import type {SessionPreset} from "../../shared/preset-types";
function fixture(){
  const preset:SessionPreset={id:"p",name:"검토 팀",members:[{agentId:"claude",name:"대표",launchProfileId:null,prompt:"지시를 기다린다"},{agentId:"codex",name:"검토",launchProfileId:"custom"}]};
  const defaultProfile={id:"mcw-default-claude",name:"default",agentId:"claude" as const,model:null,effort:null},custom={id:"custom",name:"Selected",agentId:"codex" as const,model:"chosen",effort:"high"};
  const client={createTask:vi.fn(async()=>({id:"task",participants:[{id:"lead",attempt:{id:"lead-run"}},{id:"worker",attempt:{id:"worker-run"}}]})),startTask:vi.fn(async()=>({}))};
  const options={presets:async()=>[preset],client,configuration:async()=>({hostId:"host",launchProfiles:[defaultProfile,custom],defaultLaunchProfiles:{claude:"other",codex:"custom"}}),executable:vi.fn(async()=>"/tool/cli"),repository:vi.fn(async()=>({directory:"/repo",head:"a".repeat(40),workProjectId:"work-project",projectBrief:"프로젝트 자료"})),reconcile:vi.fn(async()=>{}),sessions:()=>[{id:"lead-run"},{id:"worker-run"},{id:"unrelated"}]} as unknown as V2PresetOptions;
  return{options,client,preset,defaultProfile,custom};
}
it("starts a fresh host task using selected profiles, project brief and verified checkout",async()=>{
  const f=fixture();const result=await launchV2Preset({presetId:"p",projectId:"repo-project"},f.options);
  expect(f.client.createTask).toHaveBeenCalledWith(expect.objectContaining({projectId:"work-project",brief:expect.stringContaining("프로젝트 자료"),lead:{provider:"claude",profileId:"mcw-default-claude",hostId:"host"},workers:[{provider:"codex",profileId:"custom",hostId:"host"}]}));
  expect(f.client.startTask).toHaveBeenCalledExactlyOnceWith("task",{repositoryPath:"/repo",expectedHead:"a".repeat(40),projectId:"repo-project",profiles:[{participantId:"lead",profile:f.defaultProfile,executable:"/tool/cli"},{participantId:"worker",profile:f.custom,executable:"/tool/cli"}]});
  expect(result.map(session=>session.id)).toEqual(["lead-run","worker-run"]);
});
it("leaves custom jk prompts untouched and refuses execution before creating any task",async()=>{
  const f=fixture();f.preset.members[0].prompt="내 지시: jk send 실행";
  await expect(launchV2Preset({presetId:"p",projectId:"repo"},f.options)).rejects.toThrow(/이관 필요/);
  expect(f.client.createTask).not.toHaveBeenCalled();expect(f.preset.members[0].prompt).toBe("내 지시: jk send 실행");
});
it("retains the task identity on ambiguous delivery and reconciles without replaying launch",async()=>{
  const f=fixture();f.client.startTask.mockRejectedValueOnce(Error("delivery unknown"));
  await expect(launchV2Preset({presetId:"p",projectId:"repo"},f.options)).rejects.toThrow(/작업 task.*delivery unknown/);
  expect(f.client.startTask).toHaveBeenCalledOnce();expect(f.options.reconcile).toHaveBeenCalledOnce();
});
