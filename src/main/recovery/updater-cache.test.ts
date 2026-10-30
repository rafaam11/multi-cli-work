// @vitest-environment node
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access,realpath} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {afterEach,expect,it,vi} from "vitest";
import {quarantineUpdaterCache} from "./updater-cache";
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
async function fixture(){const root=await realpath(await mkdtemp(path.join(os.tmpdir(),"mcw-cache-")));directories.push(root);return root;}
it("quarantines the entire pending update cache after stopped-instance checks while preserving its bytes",async()=>{
  const cacheRoot=await fixture(),source=path.join(cacheRoot,"multi-cli-work-updater");await mkdir(path.join(source,"pending"),{recursive:true});
  await writeFile(path.join(source,"pending","update-info.json"),'{"version":"2.0.0"}');await writeFile(path.join(source,"pending","setup.exe"),"fixture bytes");
  const assertStopped=vi.fn(async()=>{}),result=await quarantineUpdaterCache({cacheRoot,cacheName:"multi-cli-work-updater",assertStopped});
  expect(result.retained).toBeTruthy();expect(path.dirname(result.retained!)).toBe(cacheRoot);await expect(access(source)).rejects.toThrow();
  expect(await readFile(path.join(result.retained!,"pending","setup.exe"),"utf8")).toBe("fixture bytes");expect(assertStopped.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(await quarantineUpdaterCache({cacheRoot,cacheName:"multi-cli-work-updater",assertStopped})).toEqual({retained:null});
});
it("preserves caches when the app is live and refuses traversal or linked cache directories",async()=>{
  const cacheRoot=await fixture(),source=path.join(cacheRoot,"multi-cli-work-updater");await mkdir(source);await writeFile(path.join(source,"proof"),"keep");
  await expect(quarantineUpdaterCache({cacheRoot,cacheName:"multi-cli-work-updater",assertStopped:async()=>{throw new Error("running");}})).rejects.toThrow("running");
  expect(await readFile(path.join(source,"proof"),"utf8")).toBe("keep");
  await expect(quarantineUpdaterCache({cacheRoot,cacheName:"../outside",assertStopped:async()=>{}})).rejects.toThrow();
  await symlink(source,path.join(cacheRoot,"linked"),process.platform==="win32"?"junction":"dir");
  await expect(quarantineUpdaterCache({cacheRoot,cacheName:"linked",assertStopped:async()=>{}})).rejects.toThrow();expect(await readFile(path.join(source,"proof"),"utf8")).toBe("keep");
});
