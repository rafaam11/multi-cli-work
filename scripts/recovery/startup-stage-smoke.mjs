// Focused real-resource test. Never executes Electron or any installer.
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),windows=process.platform==='win32';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'mcw-pre-electron-stage-'));
try{
 const resources=path.join(root,'installation/resources'),v2=path.join(resources,'v2'),bridge=path.join(resources,'herdr-bridge');
 for(const directory of [path.join(v2,'host'),bridge,path.join(resources,'recovery-scripts'),path.join(root,'v1/Local Storage'),path.join(root,'registry')])await fs.mkdir(directory,{recursive:true});
 const manifest=JSON.parse(await fs.readFile('build/v2/assets.json','utf8'));
 const files=['assets.json','host/recovery-controller.cjs',...manifest.assets.filter(item=>item.platform===process.platform&&item.role==='original-v1-installer').map(item=>item.file),`${windows?'node/windows':'node/linux'}/${windows?'node.exe':'node'}`];
 for(const file of files){const destination=path.join(v2,file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.resolve('build/v2',file),destination);}
 const observer=windows?'mcw-herdr-bridge.exe':'mcw-herdr-bridge';
 for(const file of [observer,'bridge.json'])await fs.copyFile(path.resolve(`build/herdr-bridge/${process.platform}-${process.arch}`,file),path.join(bridge,file));
 for(const file of ['core.mjs','recover.mjs'])await fs.copyFile(path.resolve('scripts/recovery',file),path.join(resources,'recovery-scripts',file));
 const entry=path.join(v2,'host/startup-rescue.cjs');
 await build({entryPoints:['src/main/recovery/startup-rescue-entry.ts'],outfile:entry,platform:'node',target:'node22',format:'cjs',bundle:true,packages:'bundle',external:['bufferutil','utf-8-validate','original-fs'],banner:{js:'const __mcwModuleUrl = require("node:url").pathToFileURL(__filename).href;'},define:{'import.meta.url':'__mcwModuleUrl'},legalComments:'eof'});
 const runtime=path.join(v2,windows?'node/windows/node.exe':'node/linux/node');await fs.chmod(runtime,0o700);
 const recoveryRoot=path.join(root,'outside-install-rescue'),v1=path.join(root,'v1');
 await fs.writeFile(path.join(v1,'Local Storage/db'),'actual-user-data');
 const env={...process.env,MULTI_CLI_WORK_USER_DATA:v1,MCW_V1_REGISTRY:path.join(root,'registry'),MCW_RECOVERY_ROOT:recoveryRoot};
 await run(runtime,[entry,'stage',resources,path.join(root,'installation',windows?'Multi CLI Work.exe':'multi-cli-work')],{env,windowsHide:true,timeout:60000});
 const descriptor=JSON.parse(await fs.readFile(path.join(recoveryRoot,'startup-rescue.json'),'utf8'));
 assert.equal(descriptor.v1UserData,v1);assert.equal(descriptor.v1Registry,env.MCW_V1_REGISTRY);
 assert.ok(descriptor.runtimePaths.includes(path.join(root,'installation',windows?'Multi CLI Work.exe':'multi-cli-work')));
 assert.equal(await fs.readFile(path.join(v1,'Local Storage/db'),'utf8'),'actual-user-data');
 assert.equal(await fs.stat(`${v1}-v2`).catch(()=>null),null);
 assert.equal(await fs.stat(path.join(recoveryRoot,'v1-before-v2')).catch(()=>null),null);
 assert.match(await fs.readFile(path.join(recoveryRoot,`return-to-v1.${windows?'cmd':'sh'}`),'utf8'),/startup-rescue/);
 await fs.rename(path.join(root,'installation'),path.join(root,'removed-installation'));
 const independentRuntime=path.join(descriptor.assetsDirectory,windows?'recovery-node.exe':'recovery-node');
 const smoke=JSON.parse((await run(independentRuntime,[path.join(descriptor.assetsDirectory,'recover.mjs'),'runtime-smoke'],{windowsHide:true,timeout:15000})).stdout);
 assert.equal(smoke.electron,false);assert.equal(smoke.recovery,'ready');
 await run(independentRuntime,[path.join(descriptor.assetsDirectory,'recover.mjs'),'verify-assets',descriptor.assetsDirectory,windows?'win32':'deb'],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
 console.log('Independent rescue survives complete installation removal; actual data unchanged; no Electron or installer executed.');
}finally{await fs.rm(root,{recursive:true,force:true,maxRetries:3});}
