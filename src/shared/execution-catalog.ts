import {parseLaunchProfile,type LaunchProfile} from "./launch-profile";
import type {TaskProvider} from "./host-types";
export interface HostRepository {id:string;name:string;path:string;projectId:string|null;projectName:string|null}
export interface ExecutionCatalog {version:1;hostId:string;platform:"win32"|"linux";launchProfiles:LaunchProfile[];defaultLaunchProfiles:Partial<Record<TaskProvider,string>>;availableProviders:TaskProvider[];repositories:HostRepository[]}
export interface RepositoryInspection {repository:HostRepository;expectedHead:string}
export interface RegisteredTaskStart {repositoryId:string;expectedHead:string;expectedPath:string}
export interface ExecutionHost {hostId:string;name:string;connected:boolean}
export function parseExecutionHosts(value:unknown):ExecutionHost[]{
  if(!Array.isArray(value)||value.length>32)throw new Error("Invalid worker host list");
  const result=value.map(item=>{
    if(!object(item)||typeof item.hostId!=="string"||!/^[\w-]{1,128}$/.test(item.hostId)||!text(item.name,100)||typeof item.connected!=="boolean")throw new Error("Invalid worker host");
    return {hostId:item.hostId,name:item.name,connected:item.connected};
  });
  if(new Set(result.map(item=>item.hostId)).size!==result.length)throw new Error("Duplicate worker host");return result;
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const text=(value:unknown,max=512):value is string=>typeof value==="string"&&value.length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value);
/** Validate cross-host metadata before it becomes selectable. Paths stay on their owning host. */
export function parseExecutionCatalog(value:unknown,hostId:string):ExecutionCatalog {
  if(!object(value)||value.version!==1||value.hostId!==hostId||!["win32","linux"].includes(String(value.platform))||!Array.isArray(value.launchProfiles)||value.launchProfiles.length>52||!Array.isArray(value.availableProviders)||value.availableProviders.some(provider=>!["claude","codex"].includes(provider))||!object(value.defaultLaunchProfiles)||!Array.isArray(value.repositories)||value.repositories.length>10000)throw new Error("Invalid host execution catalog");
  const profiles=value.launchProfiles.map(parseLaunchProfile);
  if(new Set(profiles.map(profile=>profile.id)).size!==profiles.length)throw new Error("Duplicate host profile");
  for(const [provider,id] of Object.entries(value.defaultLaunchProfiles))if(!["claude","codex"].includes(provider)||!profiles.some(profile=>profile.id===id&&profile.agentId===provider))throw new Error("Invalid default host profile");
  const repositories=value.repositories.map(item=>{
    if(!object(item)||!text(item.id,200)||!text(item.name)||!text(item.path,32768)||(item.projectId!==null&&!text(item.projectId,200))||(item.projectName!==null&&!text(item.projectName)))throw new Error("Invalid host repository");
    return {id:item.id,name:item.name,path:item.path,projectId:item.projectId as string|null,projectName:item.projectName as string|null};
  });
  if(new Set(repositories.map(repo=>repo.id)).size!==repositories.length)throw new Error("Duplicate host repository");
  return {version:1,hostId,platform:value.platform as ExecutionCatalog["platform"],launchProfiles:profiles,defaultLaunchProfiles:value.defaultLaunchProfiles,availableProviders:[...new Set(value.availableProviders)] as TaskProvider[],repositories};
}
export const defaultTaskProfiles=():LaunchProfile[]=>["codex","claude"].map(agentId=>({id:`mcw-default-${agentId}`,name:agentId==="codex"?"Codex 기본":"Claude Code 기본",agentId:agentId as TaskProvider,model:null,effort:null}));
