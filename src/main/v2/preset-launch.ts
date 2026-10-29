import type {PresetLaunchInput,SessionPreset} from "../../shared/preset-types";
import type {TaskProvider} from "../../shared/host-types";
import type {TerminalSessionView} from "../../shared/api-types";
import type {McwV2Api} from "../../shared/v2-api";
import type {HostClient} from "../host/host-client";
import {presetV2Issues} from "../../shared/v2-presets";

export interface V2PresetOptions {
  presets():Promise<SessionPreset[]>;client:HostClient;
  configuration():ReturnType<McwV2Api["configuration"]>;
  executable(provider:TaskProvider):Promise<string|null>;
  repository(request:PresetLaunchInput):Promise<{directory:string;head:string;workProjectId?:string;projectBrief?:string}>;
  reconcile():Promise<void>;sessions():TerminalSessionView[];
}
/** A preset creates a fresh task with selected profiles; legacy terminal typing is never used. */
export async function launchV2Preset(request:PresetLaunchInput,options:V2PresetOptions):Promise<TerminalSessionView[]> {
  const preset=(await options.presets()).find(preset=>preset.id===request.presetId);
  if(!preset)throw Error("프리셋을 찾을 수 없습니다.");
  const issues=presetV2Issues(preset);if(issues.length)throw Error(issues.join(" "));
  const configuration=await options.configuration();
  const selections=await Promise.all(preset.members.map(async member=>{
    const provider=member.agentId as TaskProvider;
    const profileId=member.launchProfileId===null?`mcw-default-${provider}`:member.launchProfileId??configuration.defaultLaunchProfiles[provider]??`mcw-default-${provider}`;
    const profile=configuration.launchProfiles.find(profile=>profile.id===profileId&&profile.agentId===provider),executable=await options.executable(provider);
    if(!profile||!executable)throw Error(`${member.name}의 선택한 프로필 또는 실행 파일을 찾을 수 없습니다.`);
    return{provider,profileId,profile,executable};
  }));
  const repository=await options.repository(request);
  const brief=[repository.projectBrief??"",`저장소: ${repository.directory}\n기준 커밋: ${repository.head}`,`팀 프리셋: ${preset.name}`,preset.description??"","대표는 아래 선택된 구성 안에서 역할을 배분한다.",
    ...preset.members.map((member,index)=>`${index===0?"대표":`작업자 ${index}`} · ${member.name} · ${member.agentId}\n${member.prompt??"대표의 지시를 기다린다."}`)].join("\n\n");
  const choice=(index:number)=>({provider:selections[index].provider,profileId:selections[index].profileId,hostId:configuration.hostId});
  const task=await options.client.createTask({title:preset.name,brief,...(repository.workProjectId?{projectId:repository.workProjectId}:{}),lead:choice(0),workers:selections.slice(1).map((_,index)=>choice(index+1))});
  let failure:unknown;
  try{
    await options.client.startTask(task.id,{repositoryPath:repository.directory,expectedHead:repository.head,projectId:request.projectId,
      profiles:task.participants.map((participant,index)=>({participantId:participant.id,profile:selections[index].profile,executable:selections[index].executable}))});
  }catch(error){failure=error;}
  try{await options.reconcile();}catch(error){failure??=error;}
  if(failure)throw Error(`작업 ${task.id}의 전달 상태를 확인하세요. 자동 재전송하지 않았습니다. ${failure instanceof Error?failure.message:String(failure)}`);
  const ids=new Set(task.participants.map(participant=>participant.attempt.id));
  return options.sessions().filter(session=>ids.has(session.id));
}
