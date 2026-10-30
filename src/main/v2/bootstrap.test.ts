// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect,it } from "vitest";
import { prepareV2Data } from "./bootstrap";
import { createSettingsService } from "../settings/settings-store";
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
