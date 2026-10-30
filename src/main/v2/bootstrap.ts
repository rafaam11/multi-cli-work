import fs from "node:fs/promises";
import path from "node:path";
import { createV1Backup, verifyV1Backup, getV2DataLayout, compareV1WithBackup, createModBackup,verifyModBackup,compareModBackup } from "../recovery";
import {discoverV1ModSources} from "../recovery/mod-sources";

export interface V2BootstrapOptions {v1UserData:string;v1Registry:string;v1ClaudeConfig?:string;recoveryRoot:string;assertStopped:()=>Promise<void>}
const exists=async(file:string)=>{try{await fs.lstat(file);return true;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}};
async function writableTree(directory:string):Promise<void>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await writableTree(file);else if(entry.isFile())await fs.chmod(file,0o600);}}
/** Called while the v1 userData single-instance lock is held and before registry modules load. */
export async function prepareV2Data(options:V2BootstrapOptions){
 const layout=getV2DataLayout(options),backupDirectory=path.join(layout.recoveryRoot,"v1-before-v2");
 await options.assertStopped();
 const samePath=(a:string,b:string)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
 const marker=path.join(layout.userData,"v2-initialized.json"),initialized=await exists(marker);
 if(initialized){
  if((await fs.lstat(marker)).isSymbolicLink())throw new Error('원본 복구 기록이 링크로 바뀌었습니다.');
  const prior=JSON.parse(await fs.readFile(marker,'utf8'));
  if(prior.schemaVersion!==2||typeof prior.backupDirectory!=='string'||!path.isAbsolute(prior.backupDirectory)||!samePath(prior.backupDirectory,backupDirectory))throw new Error('v2가 참조하는 원본 복구 위치가 다릅니다. 기존 고정 복구본을 사용하세요.');
 }
 const backedUp=await exists(backupDirectory);
 if(!backedUp&&(initialized||await exists(layout.userData)||await exists(layout.registry)))throw new Error('기존 v2의 원본 복구본이 없습니다. 현재 v1 데이터를 새 원본으로 저장하지 않습니다.');
 await fs.mkdir(layout.recoveryRoot,{recursive:true,mode:0o700});
 const sources={userData:options.v1UserData,registry:options.v1Registry};
 if(backedUp){
  const backup=await verifyV1Backup(backupDirectory);
  if(!samePath(backup.sources.userData,options.v1UserData)||!samePath(backup.sources.registry,options.v1Registry))throw new Error('원본 v1 데이터 경로가 고정 복구본과 다릅니다.');
 }
 else {await fs.mkdir(options.v1UserData,{recursive:true});await fs.mkdir(options.v1Registry,{recursive:true});await createV1Backup({destination:backupDirectory,sources,assertStopped:options.assertStopped});}
 const modBackupDirectory=options.v1ClaudeConfig?path.join(layout.recoveryRoot,"v1-mods-before-v2"):null;
 if(modBackupDirectory&&options.v1ClaudeConfig) {
  const modSources=await discoverV1ModSources(options.v1ClaudeConfig);
  if(await exists(modBackupDirectory))await verifyModBackup(modBackupDirectory);
  else {
   if(await exists(marker))throw new Error("업데이트 전 v1 mod 백업이 없습니다. 현재 상태를 원본으로 간주하지 않고 보존합니다.");
   const sameSources=(a:Record<string,string>,b:Record<string,string>)=>JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());
   await createModBackup({destination:modBackupDirectory,sources:modSources,assertStopped:async()=>{
    await options.assertStopped();
    if(!sameSources(modSources,await discoverV1ModSources(options.v1ClaudeConfig!)))throw new Error("Mod registry changed during backup; migration stopped");
   }});
  }
  await fs.writeFile(path.join(layout.recoveryRoot,"v1-mod-differences.json"),JSON.stringify(await compareModBackup(modBackupDirectory,modSources),null,2),{mode:0o600});
 }
 if(await exists(marker)) {
  await fs.writeFile(path.join(layout.recoveryRoot,"v1-differences.json"),JSON.stringify(await compareV1WithBackup({backupDirectory,sources}),null,2),{mode:0o600});
  return {...layout,backupDirectory,modBackupDirectory};
 }
 if(await exists(layout.userData)||await exists(layout.registry))throw new Error("v2 초기 복사본이 불완전합니다. 보존된 폴더를 확인한 후 복구해야 합니다.");
 await options.assertStopped();
 await fs.cp(path.join(backupDirectory,"data","userData"),layout.userData,{recursive:true,errorOnExist:true,force:false});
 await fs.cp(path.join(backupDirectory,"data","registry"),layout.registry,{recursive:true,errorOnExist:true,force:false});
 await writableTree(layout.userData);await writableTree(layout.registry);
 const settingsPath=path.join(layout.userData,"settings.json");
 const settings=await exists(settingsPath)?JSON.parse(await fs.readFile(settingsPath,"utf8")):{};
 if(!settings||typeof settings!=="object"||Array.isArray(settings))throw new Error("v1 설정 파일을 확인해야 합니다.");
 settings.general={...settings.general,autoResumeSessions:false,repoSyncOnSessionStart:false,jkMcp:false};
 await fs.writeFile(settingsPath,JSON.stringify(settings,null,2),{mode:0o600});
 await fs.writeFile(marker,JSON.stringify({schemaVersion:2,backupDirectory,createdAt:new Date().toISOString()}),{flag:"wx",mode:0o600});
 return {...layout,backupDirectory,modBackupDirectory};
}
export function v2RegistryEnvironment(registry:string):Record<string,string>{
 return {MCW_REGISTRY_ROOT:registry,...Object.fromEntries(Object.entries({
  MULTI_CLI_WORK_REGISTRY_PATH:"projects.json",MULTI_CLI_WORK_WORK_PROJECTS_PATH:"work-projects.json",MULTI_CLI_WORK_WORKSPACE_PATH:"workspace.json",MULTI_CLI_WORK_PROJECT_TAGS_PATH:"project-tags.json",MULTI_CLI_WORK_AGENTS_PATH:"agents.json",MULTI_CLI_WORK_WORKTREES_PATH:"worktrees.json",MULTI_CLI_WORK_SESSION_PRESETS_PATH:"session-presets.json",MULTI_CLI_WORK_PR_REVIEWS_PATH:"pr-reviews.json",MULTI_CLI_WORK_WORKTREE_SCRIPTS_PATH:"worktree-scripts.json",
 }).map(([key,file])=>[key,path.join(registry,file)]))};
}
