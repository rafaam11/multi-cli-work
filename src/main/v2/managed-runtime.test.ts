// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,expect,it} from 'vitest';
import {stageManagedHostRuntime} from './managed-runtime';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function fixture(platform:'win32'|'linux'='linux'){
  const root=await fs.mkdtemp(path.join(tmpdir(),'mcw-managed-runtime-'));roots.push(root);
  const resourcesDirectory=path.join(root,'package/v2'),bridgeDirectory=path.join(root,'package/bridge'),recoveryRoot=path.join(root,'recovery');
  const files=['assets.json','host/mcw-host.js','host/mcw-task-mcp-client.js','mods/mcw-chips-v2/hooks/register.ts',platform==='win32'?'node/windows/node.exe':'node/linux/node',platform==='win32'?'herdr/windows-mcw/herdr.exe':'herdr/herdr-linux-x86_64'];
  for(const filename of files){const file=path.join(resourcesDirectory,filename);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,filename);await fs.chmod(file,0o700);}
  await fs.mkdir(bridgeDirectory,{recursive:true});await fs.writeFile(path.join(bridgeDirectory,'bridge.json'),'fixture receipt');await fs.writeFile(path.join(bridgeDirectory,platform==='win32'?'mcw-herdr-bridge.exe':'mcw-herdr-bridge'),'native fixture');
  await fs.mkdir(recoveryRoot);return {root,resourcesDirectory,bridgeDirectory,recoveryRoot,platform};
}
it.each(['win32','linux'] as const)('retains an independent %s host runtime after its package/mount disappears',async platform=>{
  const input=await fixture(platform),staged=await stageManagedHostRuntime(input);
  expect(staged.directory.startsWith(await fs.realpath(input.recoveryRoot)+path.sep)).toBe(true);
  expect(await fs.readFile(staged.entryPath,'utf8')).toBe('host/mcw-host.js');
  expect(staged.runtimePaths).toContain(path.join(staged.bridgeDirectory,platform==='win32'?'mcw-herdr-bridge.exe':'mcw-herdr-bridge'));
  expect((await stageManagedHostRuntime(input)).directory).toBe(staged.directory);
  expect(path.dirname(input.resourcesDirectory)).toBe(path.join(input.root,'package'));await fs.rm(path.join(input.root,'package'),{recursive:true});
  for(const file of [staged.entryPath,...staged.runtimePaths])await expect(fs.readFile(file)).resolves.toBeInstanceOf(Buffer);
});
it('keeps earlier revisions and refuses to overwrite a modified staged executable',async()=>{
  const input=await fixture(),first=await stageManagedHostRuntime(input);
  await fs.writeFile(path.join(input.resourcesDirectory,'host/mcw-host.js'),'new host');const next=await stageManagedHostRuntime(input);
  expect(next.directory).not.toBe(first.directory);expect(await fs.readFile(first.entryPath,'utf8')).toBe('host/mcw-host.js');
  await fs.writeFile(next.runtimePaths[0],'changed after verification');
  await expect(stageManagedHostRuntime(input)).rejects.toThrow(/runtime.*changed/i);
  expect(await fs.readFile(next.runtimePaths[0],'utf8')).toBe('changed after verification');
  expect(JSON.parse(await fs.readFile(path.join(input.recoveryRoot,'active-host-runtime.json'),'utf8')).directory).toBe(next.directory);
});
it('rejects linked source trees and unrecorded files in an existing runtime',async()=>{
  const input=await fixture(),staged=await stageManagedHostRuntime(input);
  await fs.writeFile(path.join(staged.resourcesDirectory,'unexpected.js'),'must not load');await expect(stageManagedHostRuntime(input)).rejects.toThrow(/runtime.*changed/i);
  const link=path.join(input.resourcesDirectory,'host/redirect');await fs.symlink(input.bridgeDirectory,link,process.platform==='win32'?'junction':'dir');
  await expect(stageManagedHostRuntime(input)).rejects.toThrow(/link/i);
});
