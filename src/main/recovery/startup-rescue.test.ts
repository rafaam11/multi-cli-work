// @vitest-environment node
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';
import * as rescue from './startup-rescue';
import {verifyV1Backup} from './index';

const roots:string[]=[];
it('blocks every native MCW GUI the legacy uninstaller could force-close, including other installation paths',()=>{
 expect(typeof rescue.assertReplacementStopped).toBe('function');
 const item={pid:123,parentPid:1,startId:'windows:123',name:'Multi CLI Work.exe',executable:'C:\\other\\Multi CLI Work.exe'};
 expect(()=>rescue.assertReplacementStopped([item],'C:\\target','win32')).toThrow(/other/);
 expect(()=>rescue.assertReplacementStopped([{...item,name:'node.exe',executable:'C:\\other\\node.exe'}],'C:\\target','win32')).not.toThrow();
 expect(()=>rescue.assertReplacementStopped([{...item,executable:'C:\\target\\Multi CLI Work.exe'}],'C:\\target','win32')).toThrow(/running/i);
 expect(()=>rescue.assertReplacementStopped([{...item,executable:null}],'C:\\target','win32')).toThrow(/unobserved/i);
});
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),'mcw-pre-electron-'));roots.push(root);
 const v1UserData=path.join(root,'custom-v1'),v1Registry=path.join(root,'custom-registry'),recoveryRoot=path.join(root,'rescue');
 await mkdir(path.join(v1UserData,'Local Storage'),{recursive:true});await mkdir(v1Registry);await mkdir(recoveryRoot);
 await writeFile(path.join(v1UserData,'Local Storage/db'),'original-local-storage');await writeFile(path.join(v1Registry,'projects.json'),'[]');
 return {v1UserData,v1Registry,recoveryRoot};
}
it('prepares recovery after a failure before Electron loads, preserving the actual v1 paths without migrating data',async()=>{
 expect(typeof rescue.prepareInitialRescueData).toBe('function');
 const f=await fixture(),data=await rescue.prepareInitialRescueData({...f,assertStopped:async()=>{}});
 const backup=await verifyV1Backup(data.backupDirectory);
 expect(backup.sources).toEqual({userData:f.v1UserData,registry:f.v1Registry});
 expect(await readFile(path.join(data.backupDirectory,'data/userData/Local Storage/db'),'utf8')).toBe('original-local-storage');
 expect(await readFile(path.join(f.v1UserData,'Local Storage/db'),'utf8')).toBe('original-local-storage');
 await expect(stat(path.join(data.userData,'Local Storage'))).rejects.toThrow();
 await expect(stat(path.join(data.userData,'v2-initialized.json'))).rejects.toThrow();
 expect(JSON.parse(await readFile(path.join(data.userData,'host/identity.json'),'utf8')).hostId).toBe(data.hostId);
});
it('does not snapshot or create a v2 identity when running work cannot be excluded',async()=>{
 const f=await fixture();
 await expect(rescue.prepareInitialRescueData({...f,assertStopped:async()=>{throw new Error('running work');}})).rejects.toThrow('running work');
 await expect(stat(path.join(f.recoveryRoot,'v1-before-v2'))).rejects.toThrow();
 await expect(stat(`${f.v1UserData}-v2`)).rejects.toThrow();
});
it('blocks unknown v1 remote work instead of treating an unstarted v2 host as proof of exit',async()=>{
 const f=await fixture();await writeFile(path.join(f.v1UserData,'remote-hosts.json'),JSON.stringify({version:1,hosts:[{hostId:'other-pc'}]}));
 await expect(rescue.prepareInitialRescueData({...f,assertStopped:async()=>{}})).rejects.toThrow(/remote/i);
 await expect(stat(path.join(f.recoveryRoot,'v1-before-v2'))).rejects.toThrow();
});
it('refuses pre-existing v2 state with no installation record or verified original backup',async()=>{
 const f=await fixture();await mkdir(`${f.v1UserData}-v2`);await writeFile(path.join(`${f.v1UserData}-v2`,'tasks.json'),'preserve');
 await expect(rescue.prepareInitialRescueData({...f,assertStopped:async()=>{}})).rejects.toThrow(/existing v2/i);
 expect(await readFile(path.join(`${f.v1UserData}-v2`,'tasks.json'),'utf8')).toBe('preserve');
});
it.each(['registry-created','identity-written'])('resumes its receipt-owned empty recovery host after interruption at %s without changing the immutable backup',async(boundary)=>{
 const f=await fixture(),registry=`${f.v1Registry}-v2`,identity=path.join(`${f.v1UserData}-v2`,'host/identity.json');
 if(boundary==='registry-created'){
  const original=fs.mkdir;
  vi.spyOn(fs,'mkdir').mockImplementation(async(...args:any[])=>{const result=await (original as any)(...args);if(args[0]===registry)throw new Error('injected preparation interruption');return result;});
 }else{
  const original=fs.writeFile;
  vi.spyOn(fs,'writeFile').mockImplementation(async(...args:any[])=>{await (original as any)(...args);if(args[0]===identity)throw new Error('injected preparation interruption');});
 }
 await expect(rescue.prepareInitialRescueData({...f,assertStopped:async()=>{}})).rejects.toThrow('injected preparation interruption');vi.restoreAllMocks();
 const manifestPath=path.join(f.recoveryRoot,'v1-before-v2/manifest.json'),before=await readFile(manifestPath,'utf8');
 const prepared=await rescue.prepareInitialRescueData({...f,assertStopped:async()=>{}});
 expect(await readFile(manifestPath,'utf8')).toBe(before);
 expect(JSON.parse(await readFile(identity,'utf8')).hostId).toBe(prepared.hostId);
 await verifyV1Backup(prepared.backupDirectory);
});
it.each(['new-registry-data','changed-identity'])('preserves and refuses unexplained %s even when an initial rescue receipt exists',async(change)=>{
 const f=await fixture(),prepared=await rescue.prepareInitialRescueData({...f,assertStopped:async()=>{}});
 const file=change==='new-registry-data'?path.join(prepared.registry,'tasks.json'):path.join(prepared.userData,'host/identity.json');
 const bytes=change==='new-registry-data'?'foreign work':JSON.stringify({hostId:'another-host'});await writeFile(file,bytes);
 await expect(rescue.prepareInitialRescueData({...f,assertStopped:async()=>{}})).rejects.toThrow(/Unexplained/);
 expect(await readFile(file,'utf8')).toBe(bytes);await verifyV1Backup(prepared.backupDirectory);
});
