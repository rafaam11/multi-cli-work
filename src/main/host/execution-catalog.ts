import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFile,realpath} from "node:fs/promises";
import path from "node:path";
import type {Task,TaskCreateInput,TaskIdentity} from "../../shared/host-types";
import {defaultTaskProfiles,parseExecutionCatalog,type ExecutionCatalog,type RepositoryInspection} from "../../shared/execution-catalog";
import {parseWorkbench} from "../workbench/workbench-store";
import {emptyProjectRegistry,parseProjectRegistry} from "../projects/project-registry";
import {emptyWorkProjectRegistry,parseWorkProjectRegistry} from "../projects/work-project-registry";
import {renderWorkProjectBrief} from "../projects/work-project-brief";
import {BUILTIN_AGENTS} from "../agents/builtin-agents";
import {detectProviderExecutables} from "../providers/provider-launch";
import {validateTaskCreate,validateTaskIdentity,validateTaskSnapshot} from "./task-validation";
import type {TaskStartInput} from "./task-executor";
import type {RemoteWorkerSelection} from "../../shared/remote-task-types";
const exec=promisify(execFile);
async function json(file:string,missing:unknown):Promise<unknown>{try{return JSON.parse(await readFile(file,"utf8"));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return missing;throw error;}}
export interface HostCatalogPaths {userData:string;registryRoot:string}
export class HostExecutionCatalog {
  constructor(readonly options:HostCatalogPaths&{hostId:string;detect?:typeof detectProviderExecutables;remoteCatalog?:(hostId:string)=>Promise<ExecutionCatalog>}){
    if(!path.isAbsolute(options.userData)||!path.isAbsolute(options.registryRoot))throw new Error("Catalog paths must be absolute");
  }
  private async snapshot(){
    const {userData,registryRoot,hostId}=this.options;
    const [workbench,projects,workProjects,executables]=await Promise.all([
      json(path.join(userData,"workbench-state.json"),{schemaVersion:1,prompts:[],drafts:{}}).then(parseWorkbench),
      json(path.join(registryRoot,"projects.json"),emptyProjectRegistry()).then(parseProjectRegistry),
      json(path.join(registryRoot,"work-projects.json"),emptyWorkProjectRegistry()).then(parseWorkProjectRegistry),
      (this.options.detect??detectProviderExecutables)([BUILTIN_AGENTS.codex,BUILTIN_AGENTS.claude]),
    ]);
    const catalog=parseExecutionCatalog({version:1,hostId,platform:process.platform,launchProfiles:[...defaultTaskProfiles(),...(workbench.launchProfiles??[])],defaultLaunchProfiles:{codex:"mcw-default-codex",claude:"mcw-default-claude",...workbench.defaultLaunchProfiles},availableProviders:["codex","claude"].filter(provider=>!!executables.agents[provider]),repositories:Object.values(projects.projects).filter(repo=>!repo.hidden).map(repo=>{
      const project=Object.values(workProjects.workProjects).find(project=>project.members.some(member=>member.projectId===repo.id&&member.role==="repo"));
      return {id:repo.id,name:repo.displayName||path.basename(repo.rootPath),path:repo.rootPath,projectId:project?.id??null,projectName:project?.name??null};
    })},hostId);
    return {catalog,executables,projects,workProjects};
  }
  async read():Promise<ExecutionCatalog>{return (await this.snapshot()).catalog;}
  private async inspect(catalog:ExecutionCatalog,id:string):Promise<RepositoryInspection>{
    const repository=catalog.repositories.find(repo=>repo.id===id);if(!repository)throw new Error("이 PC에 등록된 저장소를 선택하세요.");
    const directory=await realpath(repository.path);
    const git=async(...args:string[])=>(await exec("git",["-C",directory,...args],{windowsHide:true,timeout:10000,maxBuffer:32768})).stdout.trim();
    const root=await realpath(await git("rev-parse","--show-toplevel"));
    if(process.platform==="win32"?root.toLowerCase()!==directory.toLowerCase():root!==directory)throw new Error("저장소 루트 경로를 확인하세요.");
    const expectedHead=await git("rev-parse","--verify","HEAD^{commit}");
    if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expectedHead))throw new Error("기준 커밋을 확인할 수 없습니다.");
    return {repository:{...repository,path:directory},expectedHead};
  }
  async inspectRepository(id:string):Promise<RepositoryInspection>{return this.inspect(await this.read(),id);}
  async validateCreate(value:unknown):Promise<TaskCreateInput>{
    const input=validateTaskCreate(value),{catalog,projects,workProjects}=await this.snapshot();
    if(input.lead.hostId!==catalog.hostId||(input.projectId!==undefined&&!catalog.repositories.some(repo=>repo.projectId===input.projectId)))throw new Error("작업 소유 PC와 프로젝트를 확인하세요.");
    const catalogs=new Map<string,ExecutionCatalog>([[catalog.hostId,catalog]]);
    for(const choice of [input.lead,...input.workers??[],...input.workerPool??[]]){
      const hostId=choice.hostId??catalog.hostId;
      if(!catalogs.has(hostId)){
        if(!this.options.remoteCatalog)throw new Error("원격 PC의 프로필을 확인할 수 없습니다.");
        catalogs.set(hostId,parseExecutionCatalog(await this.options.remoteCatalog(hostId),hostId));
      }
      const selected=catalogs.get(hostId)!;
      if(!selected.availableProviders.includes(choice.provider)||!selected.launchProfiles.some(profile=>profile.id===choice.profileId&&profile.agentId===choice.provider))throw new Error("선택한 PC에서 사용할 프로필을 다시 선택하세요.");
    }
    if(!input.projectId)return input;
    const project=workProjects.workProjects[input.projectId];
    if(!project)throw new Error("작업 프로젝트를 확인하세요.");
    const members=project.members.flatMap(member=>projects.projects[member.projectId]?[{project:projects.projects[member.projectId],role:member.role}]:[]);
    const brief=`${input.brief}\n\n---\n${renderWorkProjectBrief(project,members,[],{teamsSyncRoot:workProjects.teamsSyncRoot})}\n프로젝트 경로는 참고용입니다. 코드 변경은 배정된 MCW 소유 작업 사본에서만 수행하세요.\n`;
    return validateTaskCreate({...input,brief});
  }
  async prepare(task:Task,value:unknown):Promise<TaskStartInput>{return this.resolve(task,value);}
  async prepareWorker(task:Task,identity:TaskIdentity,value:unknown):Promise<TaskStartInput>{validateTaskIdentity(identity);validateTaskSnapshot({schemaVersion:2,hostId:task.ownerHostId,tasks:[task],outbox:[]});return this.resolve(task,value,identity);}
  private async resolve(task:Task,value:unknown,worker?:TaskIdentity):Promise<TaskStartInput>{
    const input=value as Record<string,unknown>;
    if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(key=>!["repositoryId","expectedHead","expectedPath",...worker?[]:["remoteWorkers"]].includes(key))||typeof input.repositoryId!=="string"||typeof input.expectedHead!=="string"||typeof input.expectedPath!=="string"||(input.remoteWorkers!==undefined&&!Array.isArray(input.remoteWorkers)))throw new Error("저장소와 기준 커밋을 확인하세요.");
    const {catalog,executables}=await this.snapshot();
    const participants=worker?task.participants.filter(member=>member.id===worker.participantId&&member.attempt.id===worker.attemptId&&member.attempt.generation===worker.generation&&member.role===worker.role&&member.hostId===worker.hostId):task.participants.filter(member=>member.hostId===catalog.hostId);
    if(worker?(worker.taskId!==task.id||worker.role!=="worker"||worker.hostId!==catalog.hostId||task.ownerHostId===catalog.hostId||participants.length!==1):(task.ownerHostId!==catalog.hostId||participants.some(member=>member.hostId!==catalog.hostId)))throw new Error("작업 실행 PC가 다릅니다.");
    const inspected=await this.inspect(catalog,input.repositoryId);
    if(process.platform==="win32"?input.expectedPath.toLowerCase()!==inspected.repository.path.toLowerCase():input.expectedPath!==inspected.repository.path)throw new Error("저장소 경로가 바뀌었습니다. 다시 확인하세요.");
    if(inspected.expectedHead!==input.expectedHead)throw new Error("기준 커밋이 바뀌었습니다. 다시 확인하세요.");
    if(!worker&&task.projectId!==undefined&&task.projectId!==inspected.repository.projectId)throw new Error("작업 프로젝트에 속한 저장소를 선택하세요.");
    const profiles=participants.map(member=>{
      const profile=catalog.launchProfiles.find(profile=>profile.id===member.profileId&&profile.agentId===member.provider),executable=executables.agents[member.provider];
      if(!profile||!executable)throw new Error("선택했던 프로필 또는 실행 파일을 찾을 수 없습니다.");
      return {participantId:member.id,profile,executable};
    });
    return {repositoryPath:inspected.repository.path,expectedHead:inspected.expectedHead,projectId:inspected.repository.id,profiles,...input.remoteWorkers===undefined?{}:{remoteWorkers:input.remoteWorkers as RemoteWorkerSelection[]}};
  }
}
