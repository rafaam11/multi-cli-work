// @vitest-environment node
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {recordHostProcessIdentity} from './runtime-identity';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('retains host birth identity and refuses to overwrite a live previous host',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mcw-host-identity-'));roots.push(root);
  const self={pid:process.pid,parentPid:1,startId:'windows:20',name:'node',executable:process.execPath};
  await recordHostProcessIdentity(root,'host','unused',async()=>[self]);
  const filename=path.join(root,'host-process-identity.json'),before=await readFile(filename,'utf8');
  await expect(recordHostProcessIdentity(root,'host','unused',async()=>[self])).rejects.toThrow('Previous host');expect(await readFile(filename,'utf8')).toBe(before);
  await recordHostProcessIdentity(root,'host','unused',async()=>[{...self,startId:'windows:21'}]);
  expect(JSON.parse(await readFile(filename,'utf8')).process.startId).toBe('windows:21');
  await writeFile(filename,JSON.stringify({schemaVersion:1,hostId:'other',process:self}));
  await expect(recordHostProcessIdentity(root,'host','unused',async()=>[self])).rejects.toThrow('identity differs');
});
