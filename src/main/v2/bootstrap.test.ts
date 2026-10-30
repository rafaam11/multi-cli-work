// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect,it,vi } from "vitest";
import { prepareV2Data } from "./bootstrap";
import { createSettingsService } from "../settings/settings-store";
import {verifyV1Backup} from '../recovery';
import {ensureDesktopHostIdentity} from './desktop-host';
import {openOfflineRecoveryHost} from '../recovery/offline-host';

it.each([false,true])('preserves recovery before cloning v2 data, including a failed copy (failure=%s)',async(failure)=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),'mcw-before-copy-'));
 try{
  const input={v1UserData:path.join(root,'v1'),v1Registry:path.join(root,'registry'),recoveryRoot:path.join(root,'recovery'),assertStopped:async()=>{}};
  await fs.mkdir(input.v1UserData);await fs.mkdir(input.v1Registry);
  const settings='{"general":{"autoCheckUpdates":true}}';await fs.writeFile(path.join(input.v1UserData,'settings.json'),settings);
  let hostId='';
  const beforeInitialize=vi.fn(async(prepared:{userData:string;registry:string;backupDirectory:string})=>{
    await verifyV1Backup(prepared.backupDirectory);
    await expect(fs.access(path.join(prepared.userData,'settings.json'))).rejects.toThrow();
    hostId=(await ensureDesktopHostIdentity(prepared.userData)).hostId;
    await fs.mkdir(prepared.registry);
    await fs.writeFile(path.join(input.recoveryRoot,'launcher-ready'),'independent recovery can use the verified backup');
    if(failure)await fs.writeFile(path.join(prepared.userData,'settings.json'),'conflicting partial copy');
  });
  const result=prepareV2Data({...input,beforeInitialize});
  if(failure)await expect(result).rejects.toThrow();else await result;
  expect(beforeInitialize).toHaveBeenCalledOnce();
  expect(await fs.readFile(path.join(input.recoveryRoot,'launcher-ready'),'utf8')).toContain('verified backup');
  expect(await fs.readFile(path.join(input.v1UserData,'settings.json'),'utf8')).toBe(settings);
  const userData=`${input.v1UserData}-v2`;
  expect(JSON.parse(await fs.readFile(path.join(userData,'host/identity.json'),'utf8')).hostId).toBe(hostId);
  const authority=await openOfflineRecoveryHost({directory:path.join(userData,'host'),hostId,bridgePath:path.join(root,'bridge'),runtimePaths:[],inventory:async()=>[]});
  try{expect(await authority.request('/recovery-plan')).toMatchObject({canShutdown:true,accepting:false});}finally{await authority.close();}
  if(failure){
    expect(await fs.readFile(path.join(userData,'settings.json'),'utf8')).toBe('conflicting partial copy');
    await expect(fs.access(path.join(userData,'v2-initialized.json'))).rejects.toThrow();
    await expect(prepareV2Data({...input,beforeInitialize})).rejects.toThrow(/불완전/);expect(beforeInitialize).toHaveBeenCalledOnce();
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
it('does not replace the original recovery source when a later launch changes roots',async()=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),'mcw-bootstrap-origin-'));
 try{
  const input={v1UserData:path.join(root,'v1'),v1Registry:path.join(root,'registry'),recoveryRoot:path.join(root,'recovery'),assertStopped:async()=>{}};
  const first=await prepareV2Data(input);await fs.writeFile(path.join(input.v1UserData,'after-rollback'),'later v1 change');
  const replacement=path.join(root,'different-recovery');
  await expect(prepareV2Data({...input,recoveryRoot:replacement})).rejects.toThrow(/원본|original/i);
  await expect(fs.access(replacement)).rejects.toThrow();
  await expect(prepareV2Data({...input,v1Registry:path.join(root,'different-registry')})).rejects.toThrow(/원본|original/i);
  expect(JSON.parse(await fs.readFile(path.join(first.userData,'v2-initialized.json'),'utf8')).backupDirectory).toBe(first.backupDirectory);
  expect(path.dirname(first.backupDirectory)).toBe(input.recoveryRoot);
  await fs.rm(first.backupDirectory,{recursive:true});
  await expect(prepareV2Data(input)).rejects.toThrow(/원본|original/i);
  await expect(fs.access(first.backupDirectory)).rejects.toThrow();
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
it.each([true,false,undefined])("backs up stopped v1, disables automatic work and preserves update preferences (%s)",async(autoCheckUpdates)=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),"mcw-bootstrap-"));
 try{
  const userData=path.join(root,"v1"),registry=path.join(root,"registry"),recoveryRoot=path.join(root,"recovery"),v1ClaudeConfig=path.join(root,"claude");
  await fs.mkdir(v1ClaudeConfig);await fs.writeFile(path.join(v1ClaudeConfig,"settings.json"),'{"pluginConfig":"v1 original"}\r\n');
  await fs.mkdir(path.join(userData,"Local Storage"),{recursive:true});await fs.mkdir(registry);
  await fs.writeFile(path.join(userData,"Local Storage","notes"),"즐겨찾기 메모");await fs.writeFile(path.join(registry,"projects.json"),"[]");
  if(autoCheckUpdates!==undefined)await fs.writeFile(path.join(userData,"settings.json"),JSON.stringify({general:{autoCheckUpdates,autoResumeSessions:true,repoSyncOnSessionStart:true,jkMcp:true}}));
  let stopped=false;
  await expect(prepareV2Data({v1UserData:userData,v1Registry:registry,recoveryRoot,assertStopped:async()=>{if(!stopped)throw new Error("v1 running");}})).rejects.toThrow("v1 running");
  stopped=true;
  const prepared=await prepareV2Data({v1UserData:userData,v1Registry:registry,v1ClaudeConfig,recoveryRoot,assertStopped:async()=>{}});
  expect(await fs.readFile(path.join(prepared.modBackupDirectory!,"data/settings"),"utf8")).toBe('{"pluginConfig":"v1 original"}\r\n');
  expect(await fs.readFile(path.join(prepared.userData,"Local Storage","notes"),"utf8")).toBe("즐겨찾기 메모");
  expect((await createSettingsService(path.join(prepared.userData,"settings.json"))).current().general).toMatchObject({autoCheckUpdates:autoCheckUpdates??true,autoResumeSessions:false,repoSyncOnSessionStart:false,jkMcp:false});
  await fs.writeFile(path.join(prepared.userData,"v2-only"),"keep");await fs.writeFile(path.join(userData,"v1-new"),"changed after rollback");
  await fs.writeFile(path.join(v1ClaudeConfig,"settings.json"),'{"pluginConfig":"user changed"}');
  const resumed=await prepareV2Data({v1UserData:userData,v1Registry:registry,v1ClaudeConfig,recoveryRoot,assertStopped:async()=>{}});
  expect(await fs.readFile(path.join(v1ClaudeConfig,"settings.json"),"utf8")).toContain("user changed");
  expect(await fs.readFile(path.join(recoveryRoot,"v1-mod-differences.json"),"utf8")).toContain('"settings"');
  expect(await fs.readFile(path.join(resumed.userData,"v2-only"),"utf8")).toBe("keep");
  await expect(fs.access(path.join(resumed.userData,"v1-new"))).rejects.toThrow();
  expect(await fs.readFile(path.join(recoveryRoot,"v1-differences.json"),"utf8")).toContain("v1-new");
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
