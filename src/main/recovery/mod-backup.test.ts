// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {afterEach,expect,it} from "vitest";
import {createModBackup,verifyModBackup,compareModBackup} from "../../../scripts/recovery/core.mjs";
import {discoverV1ModSources} from "./mod-sources";
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),"mcw-mod-backup-"));roots.push(root);return root;}
it("preserves exact external mod versions/configuration and reports later differences without restoring them",async()=>{
  const root=await fixture(),mod=path.join(root,"original-mod"),settings=path.join(root,"settings.json"),missing=path.join(root,"not-created"),destination=path.join(root,"backup");
  await fs.mkdir(mod);await fs.writeFile(path.join(mod,"register.ts"),"v1 source\r\n");await fs.writeFile(settings,'{"private":"original"}\r\n');
  const sources={plugin:mod,settings,optional:missing};let checks=0;
  const manifest=await createModBackup({destination,sources,assertStopped:async()=>{checks++}});
  expect(checks).toBeGreaterThanOrEqual(2);expect(manifest.sources).toEqual(sources);
  expect(await fs.readFile(path.join(destination,"data/plugin/register.ts"),"utf8")).toBe("v1 source\r\n");
  expect(await compareModBackup(destination)).toEqual({added:[],removed:[],changed:[]});
  await fs.writeFile(settings,"new user changes");await fs.mkdir(missing);await fs.writeFile(path.join(missing,"new"),"new state");
  expect(await compareModBackup(destination)).toMatchObject({changed:expect.arrayContaining(["settings","optional"]),added:["optional/new"]});
  await verifyModBackup(destination);expect(await fs.readFile(settings,"utf8")).toBe("new user changes");
  await expect(createModBackup({destination,sources,assertStopped:async()=>{}})).rejects.toThrow();
});
it("refuses mod links, inconsistent input and tampered restoration copies",async()=>{
  const root=await fixture(),source=path.join(root,"source"),destination=path.join(root,"backup");await fs.mkdir(source);await fs.writeFile(path.join(source,"mod"),"before");
  let count=0;await expect(createModBackup({destination,sources:{source},assertStopped:async()=>{if(++count===2)await fs.writeFile(path.join(source,"mod"),"during")}})).rejects.toThrow(/changed/);
  await expect(verifyModBackup(destination)).rejects.toThrow();
  const second=path.join(root,"second");await createModBackup({destination:second,sources:{source},assertStopped:async()=>{}});
  const copy=path.join(second,"data/source/mod");await fs.chmod(copy,0o600);await fs.writeFile(copy,"tamper");await expect(verifyModBackup(second)).rejects.toThrow(/integrity/);
  await fs.symlink(source,path.join(root,"link"),process.platform==="win32"?"junction":"dir");await expect(createModBackup({destination:path.join(root,"third"),sources:{linked:path.join(root,"link")},assertStopped:async()=>{}})).rejects.toThrow(/link/i);
});
it("discovers only related installed mods and their local marketplace versions",async()=>{
  const root=await fixture(),config=path.join(root,"claude"),installed=path.join(root,"cache/mcw-chips/0.1.0"),market=path.join(root,"market"),source=path.join(market,"mods/mcw-chips");
  for(const folder of [installed,source]){await fs.mkdir(path.join(folder,".claude-plugin"),{recursive:true});await fs.writeFile(path.join(folder,".claude-plugin/plugin.json"),'{"name":"mcw-chips","version":"0.1.0"}');}
  await fs.mkdir(path.join(config,"plugins"),{recursive:true});
  await fs.mkdir(path.join(market,".claude-plugin"));await fs.writeFile(path.join(market,".claude-plugin/marketplace.json"),JSON.stringify({plugins:[{name:"mcw-chips",source:"./mods/mcw-chips"},{name:"unrelated",source:"../../outside"}]}));
  await fs.writeFile(path.join(config,"plugins/installed_plugins.json"),JSON.stringify({plugins:{"mcw-chips@jinmin":[{installPath:installed}],"unrelated@other":[{installPath:path.join(root,"private")}]}}));
  await fs.writeFile(path.join(config,"plugins/known_marketplaces.json"),JSON.stringify({jinmin:{source:{source:"directory",path:market}}}));
  const found=Object.values(await discoverV1ModSources(config));expect(found).toContain(installed);expect(found).toContain(source);expect(found).not.toContain(path.join(root,"private"));expect(found).not.toContain(path.join(config,"projects"));
  await fs.writeFile(path.join(market,".claude-plugin/marketplace.json"),JSON.stringify({plugins:[{name:"mcw-chips",source:"../../outside"}]}));
  await expect(discoverV1ModSources(config)).rejects.toThrow("escapes marketplace");
});
