import fs from "node:fs/promises";
import path from "node:path";
import { createV1Backup, verifyV1Backup, getV2DataLayout, compareV1WithBackup } from "../recovery";

export interface V2BootstrapOptions {v1UserData:string;v1Registry:string;recoveryRoot:string;assertStopped:()=>Promise<void>}
const exists=async(file:string)=>{try{await fs.lstat(file);return true;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}};
async function writableTree(directory:string):Promise<void>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await writableTree(file);else if(entry.isFile())await fs.chmod(file,0o600);}}
/** Called while the v1 userData single-instance lock is held and before registry modules load. */
export async function prepareV2Data(options:V2BootstrapOptions){
 const layout=getV2DataLayout(options),backupDirectory=path.join(layout.recoveryRoot,"v1-before-v2");
 await options.assertStopped();
 await fs.mkdir(layout.recoveryRoot,{recursive:true,mode:0o700});
 const sources={userData:options.v1UserData,registry:options.v1Registry};
 if(await exists(backupDirectory)) await verifyV1Backup(backupDirectory);
 else {await fs.mkdir(options.v1UserData,{recursive:true});await fs.mkdir(options.v1Registry,{recursive:true});await createV1Backup({destination:backupDirectory,sources,assertStopped:options.assertStopped});}
 const marker=path.join(layout.userData,"v2-initialized.json");
 if(await exists(marker)) {
  await fs.writeFile(path.join(layout.recoveryRoot,"v1-differences.json"),JSON.stringify(await compareV1WithBackup({backupDirectory,sources}),null,2),{mode:0o600});
  return {...layout,backupDirectory};
 }
 if(await exists(layout.userData)||await exists(layout.registry))throw new Error("v2 초기 복사본이 불완전합니다. 보존된 폴더를 확인한 후 복구해야 합니다.");
 await options.assertStopped();
 await fs.cp(path.join(backupDirectory,"data","userData"),layout.userData,{recursive:true,errorOnExist:true,force:false});
 await fs.cp(path.join(backupDirectory,"data","registry"),layout.registry,{recursive:true,errorOnExist:true,force:false});
 await writableTree(layout.userData);await writableTree(layout.registry);
 const settingsPath=path.join(layout.userData,"settings.json");
 if(await exists(settingsPath)){
  const settings=JSON.parse(await fs.readFile(settingsPath,"utf8"));
  settings.general={...settings.general,autoResumeSessions:false,repoSyncOnSessionStart:false,autoCheckUpdates:false,jkMcp:false};
  await fs.writeFile(settingsPath,JSON.stringify(settings,null,2),{mode:0o600});
 }
 await fs.writeFile(marker,JSON.stringify({schemaVersion:2,backupDirectory,createdAt:new Date().toISOString()}),{flag:"wx",mode:0o600});
 return {...layout,backupDirectory};
}
export function v2RegistryEnvironment(registry:string):Record<string,string>{
 return {MCW_REGISTRY_ROOT:registry,...Object.fromEntries(Object.entries({
  MULTI_CLI_WORK_REGISTRY_PATH:"projects.json",MULTI_CLI_WORK_WORK_PROJECTS_PATH:"work-projects.json",MULTI_CLI_WORK_WORKSPACE_PATH:"workspace.json",MULTI_CLI_WORK_PROJECT_TAGS_PATH:"project-tags.json",MULTI_CLI_WORK_AGENTS_PATH:"agents.json",MULTI_CLI_WORK_WORKTREES_PATH:"worktrees.json",MULTI_CLI_WORK_SESSION_PRESETS_PATH:"session-presets.json",MULTI_CLI_WORK_PR_REVIEWS_PATH:"pr-reviews.json",MULTI_CLI_WORK_WORKTREE_SCRIPTS_PATH:"worktree-scripts.json",
 }).map(([key,file])=>[key,path.join(registry,file)]))};
}
