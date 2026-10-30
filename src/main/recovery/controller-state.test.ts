// @vitest-environment node
import {mkdtemp,mkdir,symlink,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {afterEach,expect,it} from 'vitest';
import {writeRecoveryState,requirePlainPath,recoveryControllerRunning,acquireRecoveryStart} from './controller-state';
import {assertRecoveryStartupAllowed} from './desktop-recovery';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'mcw-recovery-controller-'));roots.push(root);return root;}
it('retains a complete synced operation journal and rejects linked operation directories',async()=>{
  const root=await fixture(),file=path.join(root,'state.json');
  await writeRecoveryState(file,{phase:'holding'});await writeRecoveryState(file,{phase:'waiting-work'});
  expect(JSON.parse(await readFile(file,'utf8'))).toEqual({phase:'waiting-work'});expect(await readdir(root)).toEqual(['state.json']);
  const target=path.join(root,'target'),link=path.join(root,'linked');await mkdir(target);await symlink(target,link,process.platform==='win32'?'junction':'dir');
  await expect(requirePlainPath(path.join(link,'next'),true)).rejects.toThrow('link');
});
it('does not launch v2 over an applying or interrupted installation, even after holds are cancelled',async()=>{
  const root=await fixture(),directory=path.join(root,'operations/op');await mkdir(directory,{recursive:true});
  await writeRecoveryState(path.join(root,'active-operation.json'),{operationId:'op'});
  const state={schemaVersion:1,operationId:'op',phase:'installing',scopes:[],observations:[],updatedAt:Date.now()};
  await writeRecoveryState(path.join(directory,'state.json'),state);await expect(assertRecoveryStartupAllowed(root)).rejects.toThrow('진행 중');
  await writeRecoveryState(path.join(directory,'state.json'),{...state,phase:'cancelled',failedAtPhase:'installing'});await expect(assertRecoveryStartupAllowed(root)).rejects.toThrow('중단');
  await writeRecoveryState(path.join(directory,'state.json'),{...state,phase:'complete'});await expect(assertRecoveryStartupAllowed(root)).resolves.toBeUndefined();
});
it('treats a starting controller as live before it publishes its identity, but excludes the cancel process',()=>{
  const executable=process.platform==='win32'?'C:/recovery/recovery-node.exe':'/recovery/recovery-node';
  const processInfo={pid:41,parentPid:1,startId:'fixture:100',name:path.basename(executable),executable};
  expect(recoveryControllerRunning({},[processInfo,{...processInfo,pid:42}],executable,42)).toBe(true);
  expect(recoveryControllerRunning({},[{...processInfo,pid:42}],executable,42)).toBe(false);
  expect(recoveryControllerRunning({controllerProcess:processInfo},[{...processInfo,startId:'fixture:101'}],executable,42)).toBe(false);
});
it('serializes desktop and independent recovery creation before the active-operation check',async()=>{
  const root=await fixture(),release=await acquireRecoveryStart(root);
  try{await expect(acquireRecoveryStart(root)).rejects.toThrow();}finally{await release();}
  await (await acquireRecoveryStart(root))();
});
it.skipIf(process.platform!=='win32')('accepts an NTFS short path to the same file while still checking every ancestor',async()=>{
  const root=await fixture();
  const result=await promisify(execFile)('cmd.exe',['/d','/c','for %I in ("%MCW_ALIAS_FIXTURE%") do @echo %~sI'],{windowsHide:true,windowsVerbatimArguments:true,env:{...process.env,MCW_ALIAS_FIXTURE:root}});
  const alias=result.stdout.trim();expect(path.isAbsolute(alias)).toBe(true);
  await expect(requirePlainPath(alias)).resolves.toBeUndefined();
});
