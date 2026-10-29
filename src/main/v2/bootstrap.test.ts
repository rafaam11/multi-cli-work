// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect,it } from "vitest";
import { prepareV2Data } from "./bootstrap";
import { createSettingsService } from "../settings/settings-store";
it.each([true,false])("backs up stopped v1 and disables automatic work even with missing settings (existing=%s)",async(existing)=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),"mcw-bootstrap-"));
 try{
  const userData=path.join(root,"v1"),registry=path.join(root,"registry"),recoveryRoot=path.join(root,"recovery");
  await fs.mkdir(path.join(userData,"Local Storage"),{recursive:true});await fs.mkdir(registry);
  await fs.writeFile(path.join(userData,"Local Storage","notes"),"즐겨찾기 메모");await fs.writeFile(path.join(registry,"projects.json"),"[]");
  if(existing)await fs.writeFile(path.join(userData,"settings.json"),JSON.stringify({general:{autoCheckUpdates:true,autoResumeSessions:true,repoSyncOnSessionStart:true,jkMcp:true}}));
  let stopped=false;
  await expect(prepareV2Data({v1UserData:userData,v1Registry:registry,recoveryRoot,assertStopped:async()=>{if(!stopped)throw new Error("v1 running");}})).rejects.toThrow("v1 running");
  stopped=true;
  const prepared=await prepareV2Data({v1UserData:userData,v1Registry:registry,recoveryRoot,assertStopped:async()=>{}});
  expect(await fs.readFile(path.join(prepared.userData,"Local Storage","notes"),"utf8")).toBe("즐겨찾기 메모");
  expect((await createSettingsService(path.join(prepared.userData,"settings.json"))).current().general).toMatchObject({autoCheckUpdates:false,autoResumeSessions:false,repoSyncOnSessionStart:false,jkMcp:false});
  await fs.writeFile(path.join(prepared.userData,"v2-only"),"keep");await fs.writeFile(path.join(userData,"v1-new"),"changed after rollback");
  const resumed=await prepareV2Data({v1UserData:userData,v1Registry:registry,recoveryRoot,assertStopped:async()=>{}});
  expect(await fs.readFile(path.join(resumed.userData,"v2-only"),"utf8")).toBe("keep");
  await expect(fs.access(path.join(resumed.userData,"v1-new"))).rejects.toThrow();
  expect(await fs.readFile(path.join(recoveryRoot,"v1-differences.json"),"utf8")).toContain("v1-new");
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
