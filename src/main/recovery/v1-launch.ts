import path from 'node:path';
import type {ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import type {ProcessIdentity} from '../herdr/process-observation';

const providerKeys=['CLAUDE_CONFIG_DIR','CODEX_HOME','MULTI_CLI_WORK_CLAUDE_CONFIG_DIR','MULTI_CLI_WORK_CODEX_SESSIONS_DIR'];
export function validateV1ProviderEnvironment(value:unknown):asserts value is Record<string,string>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([key,file])=>!providerKeys.includes(key)||typeof file!=='string'||!path.isAbsolute(file)||/[\x00-\x1f]/.test(file)))throw new Error('Invalid original provider environment');
}
export function captureV1ProviderEnvironment(environment:NodeJS.ProcessEnv):Record<string,string>{
  const value=Object.fromEntries(providerKeys.flatMap(key=>environment[key]?[[key,environment[key]!]]:[]));validateV1ProviderEnvironment(value);return value;
}
export function v1LaunchEnvironment(inherited:NodeJS.ProcessEnv,targets:{userData:string;registry:string},providerEnvironment:Record<string,string>={}):NodeJS.ProcessEnv{
  validateV1ProviderEnvironment(providerEnvironment);
  const environment={...inherited};
  for(const key of Object.keys(environment))if(key.startsWith('MCW_')||key.startsWith('MULTI_CLI_WORK_')||['ELECTRON_RUN_AS_NODE','APPIMAGE','APPDIR','OWD'].includes(key))delete environment[key];
  Object.assign(environment,providerEnvironment);
  environment.MULTI_CLI_WORK_USER_DATA=targets.userData;
  for(const [key,file] of Object.entries({MULTI_CLI_WORK_REGISTRY_PATH:'projects.json',MULTI_CLI_WORK_WORK_PROJECTS_PATH:'work-projects.json',MULTI_CLI_WORK_WORKSPACE_PATH:'workspace.json',MULTI_CLI_WORK_PROJECT_TAGS_PATH:'project-tags.json',MULTI_CLI_WORK_AGENTS_PATH:'agents.json',MULTI_CLI_WORK_WORKTREES_PATH:'worktrees.json',MULTI_CLI_WORK_SESSION_PRESETS_PATH:'session-presets.json',MULTI_CLI_WORK_PR_REVIEWS_PATH:'pr-reviews.json',MULTI_CLI_WORK_WORKTREE_SCRIPTS_PATH:'worktree-scripts.json'}))environment[key]=path.join(targets.registry,file);
  return environment;
}
/** Startup evidence, not proof that the user has seen a window or a task completed. */
export async function observeV1Launch(child:Pick<ChildProcess,'pid'|'exitCode'|'signalCode'>,inventory:()=>Promise<ProcessIdentity[]>,wait:()=>Promise<void>=()=>delay(250)):Promise<ProcessIdentity>{
  const assertAlive=()=>{if(!child.pid||child.exitCode!==null||child.signalCode!==null)throw new Error('Original v1 process exited before startup could be observed');};
  assertAlive();const first=(await inventory()).find(item=>item.pid===child.pid);
  if(!first?.startId)throw new Error('Original v1 process could not be observed');
  await wait();assertAlive();const next=(await inventory()).find(item=>item.pid===child.pid);
  if(next?.startId!==first.startId)throw new Error('Original v1 launch identity changed or exited');
  return next;
}
