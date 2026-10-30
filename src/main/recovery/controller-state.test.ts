// @vitest-environment node
import {mkdtemp,mkdir,symlink,readFile,readdir,rm,rename} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {afterEach,expect,it,vi} from 'vitest';
import {writeRecoveryState,requirePlainPath,recoveryControllerRunning,acquireRecoveryStart} from './controller-state';
import {assertRecoveryStartupAllowed} from './desktop-recovery';
const roots:string[]=[];
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return {...actual,rename:vi.fn(actual.rename)};});
afterEach(async()=>{vi.mocked(rename).mockReset();vi.mocked(rename).mockImplementation((await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename);for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'mcw-recovery-controller-'));roots.push(root);return root;}
it('retains a complete synced operation journal and rejects linked operation directories',async()=>{
  const root=await fixture(),file=path.join(root,'state.json');
  await writeRecoveryState(file,{phase:'holding'});await writeRecoveryState(file,{phase:'waiting-work'});
  expect(JSON.parse(await readFile(file,'utf8'))).toEqual({phase:'waiting-work'});expect(await readdir(root)).toEqual(['state.json']);
  const target=path.join(root,'target'),link=path.join(root,'linked');await mkdir(target);await symlink(target,link,process.platform==='win32'?'junction':'dir');
  await expect(requirePlainPath(path.join(link,'next'),true)).rejects.toThrow('link');
});
it('retries a busy journal replacement without removing the last committed state or changing the synced replacement',async()=>{
  const root=await fixture(),file=path.join(root,'state.json');
  await writeRecoveryState(file,{phase:'holding'});
  const originalRename=(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename;
  const sources:string[]=[];
  vi.mocked(rename).mockImplementation(async(source,destination)=>{
    sources.push(String(source));
    expect(JSON.parse(await readFile(file,'utf8'))).toEqual({phase:'holding'});
    expect(JSON.parse(await readFile(source,'utf8'))).toEqual({phase:'waiting-work'});
    if(sources.length<3)throw Object.assign(new Error('Journal temporarily held open'),{code:'EPERM'});
    await originalRename(source,destination);
  });
  await writeRecoveryState(file,{phase:'waiting-work'});
  expect(sources).toHaveLength(3);expect(new Set(sources).size).toBe(1);
  expect(JSON.parse(await readFile(file,'utf8'))).toEqual({phase:'waiting-work'});
  expect(await readdir(root)).toEqual(['state.json']);
});
it.each(['EACCES','EIO'])('preserves the committed journal when replacement remains impossible (%s)',async code=>{
  const root=await fixture(),file=path.join(root,'state.json');
  await writeRecoveryState(file,{phase:'holding'});
  vi.mocked(rename).mockClear();vi.mocked(rename).mockRejectedValue(Object.assign(new Error('Replacement unavailable'),{code}));
  await expect(writeRecoveryState(file,{phase:'installing'})).rejects.toMatchObject({code});
  expect(JSON.parse(await readFile(file,'utf8'))).toEqual({phase:'holding'});
  expect(await readdir(root)).toEqual(['state.json']);
  expect(vi.mocked(rename).mock.calls.length).toBe(code==='EACCES'?9:1);
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
