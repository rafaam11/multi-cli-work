import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import lockfile from 'proper-lockfile';
import {requirePlainPath,writeRecoveryState} from '../recovery/controller-state';

interface Options {resourcesDirectory:string;bridgeDirectory:string;recoveryRoot:string;platform?:'win32'|'linux'}
interface Entry {path:string;bytes:number;sha256:string;mode:number}
export interface ManagedHostRuntime {schemaVersion:1;directory:string;resourcesDirectory:string;bridgeDirectory:string;entryPath:string;runtimePaths:string[]}
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
async function stableRead(filename:string){
  await requirePlainPath(filename);
  const file=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await file.stat();if(!before.isFile())throw new Error('Managed runtime source is not a regular file');
    const bytes=await file.readFile(),after=await file.stat();
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error('Managed runtime source changed during reading');
    return {bytes,mode:before.mode&0o777};
  }finally{await file.close();}
}
async function collect(filename:string,prefix:string,result:Entry[],sources?:Map<string,string>):Promise<void>{
  await requirePlainPath(filename);const info=await fs.lstat(filename);
  if(info.isDirectory()){
    for(const name of (await fs.readdir(filename)).sort()){
      if(/[\\:\x00-\x1f]/.test(name))throw new Error('Unsupported managed resource filename');
      await collect(path.join(filename,name),prefix?`${prefix}/${name}`:name,result,sources);
    }
  }else if(info.isFile()){
    const {bytes,mode}=await stableRead(filename);result.push({path:prefix,bytes:bytes.length,sha256:sha(bytes),mode});sources?.set(prefix,filename);
    if(result.length>10000)throw new Error('Too many managed runtime resources');
  }else throw new Error('Unsupported managed runtime source');
}
/** Immutable host dependencies live outside an AppImage mount or replaceable
 * installation. Old revisions stay available to already-running hosts. */
export async function stageManagedHostRuntime(options:Options):Promise<ManagedHostRuntime>{
  const platform=options.platform??process.platform;if(platform!=='win32'&&platform!=='linux')throw new Error('Unsupported host platform');
  for(const directory of [options.resourcesDirectory,options.bridgeDirectory,options.recoveryRoot])await requirePlainPath(directory);
  const root=await fs.realpath(options.recoveryRoot);
  for(const source of [options.resourcesDirectory,options.bridgeDirectory]){
    const canonical=await fs.realpath(source),a=path.relative(root,canonical),b=path.relative(canonical,root);
    if(!a||!b||(!a.startsWith('..')&&!path.isAbsolute(a))||(!b.startsWith('..')&&!path.isAbsolute(b)))throw new Error('Managed runtime storage must be outside its package sources');
  }
  const release=await lockfile.lock(path.join(root,'host-runtime-stage'),{realpath:false,retries:0,stale:30000});
  try{
    const sources=new Map<string,string>();
    const snapshot=async()=>{
      const entries:Entry[]=[];
      for(const relative of ['assets.json','host','mods',platform==='win32'?'node/windows':'node/linux',platform==='win32'?'herdr/windows-mcw':'herdr/herdr-linux-x86_64'])await collect(path.join(options.resourcesDirectory,relative),`v2/${relative}`,entries,sources);
      await collect(options.bridgeDirectory,'bridge',entries,sources);
      return entries.sort((a,b)=>a.path.localeCompare(b.path,'en'));
    };
    const entries=await snapshot();
    const required=['v2/assets.json','v2/host/mcw-host.js','v2/host/mcw-task-mcp-client.js','v2/mods/mcw-chips-v2/hooks/register.ts','bridge/bridge.json',platform==='win32'?'v2/node/windows/node.exe':'v2/node/linux/node',platform==='win32'?'v2/herdr/windows-mcw/herdr.exe':'v2/herdr/herdr-linux-x86_64',platform==='win32'?'bridge/mcw-herdr-bridge.exe':'bridge/mcw-herdr-bridge'];
    if(required.some(file=>!entries.some(entry=>entry.path===file)))throw new Error('Missing managed host resource');
    const serialized=JSON.stringify({schemaVersion:1,platform,entries}),revision=sha(serialized),directory=path.join(root,`host-runtime-${revision.slice(0,24)}`);
    const result:ManagedHostRuntime={schemaVersion:1,directory,resourcesDirectory:path.join(directory,'v2'),bridgeDirectory:path.join(directory,'bridge'),entryPath:path.join(directory,'v2/host/mcw-host.js'),runtimePaths:[path.join(directory,platform==='win32'?'v2/node/windows/node.exe':'v2/node/linux/node'),path.join(directory,platform==='win32'?'v2/herdr/windows-mcw/herdr.exe':'v2/herdr/herdr-linux-x86_64'),path.join(directory,platform==='win32'?'bridge/mcw-herdr-bridge.exe':'bridge/mcw-herdr-bridge')]};
    const verify=async(target:string)=>{
      await requirePlainPath(target);const actual:Entry[]=[];
      for(const name of (await fs.readdir(target)).sort())if(!['host-runtime.json','.incomplete'].includes(name))await collect(path.join(target,name),name,actual);
      actual.sort((a,b)=>a.path.localeCompare(b.path,'en'));
      if(JSON.stringify(actual)!==JSON.stringify(entries))throw new Error('Managed runtime files changed; the existing revision was not overwritten');
    };
    const exists=await fs.lstat(directory).catch(error=>{if(missing(error))return null;throw error;});
    if(exists){
      if(await fs.lstat(path.join(directory,'.incomplete')).catch(error=>{if(missing(error))return null;throw error;}))throw new Error('Managed runtime is incomplete');
      const receipt=await stableRead(path.join(directory,'host-runtime.json'));
      if(receipt.bytes.toString('utf8')!==serialized+'\n')throw new Error('Managed runtime receipt changed');
      await verify(directory);
    }else{
      const temporary=path.join(root,`.host-runtime-${randomUUID()}`);await fs.mkdir(temporary,{mode:0o700});
      await fs.writeFile(path.join(temporary,'.incomplete'),'Runtime staging has not completed.\n',{flag:'wx',mode:0o600});
      for(const entry of entries){
        const content=await stableRead(sources.get(entry.path)!);
        if(content.bytes.length!==entry.bytes||sha(content.bytes)!==entry.sha256||content.mode!==entry.mode)throw new Error('Managed runtime source changed before copying');
        const target=path.join(temporary,...entry.path.split('/'));await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
        const file=await fs.open(target,'wx',entry.mode);try{await file.writeFile(content.bytes);await file.sync();}finally{await file.close();}await fs.chmod(target,entry.mode);
      }
      await verify(temporary);
      if(JSON.stringify(await snapshot())!==JSON.stringify(entries))throw new Error('Managed runtime package changed during staging');
      const receipt=await fs.open(path.join(temporary,'host-runtime.json'),'wx',0o600);try{await receipt.writeFile(serialized+'\n');await receipt.sync();}finally{await receipt.close();}
      await fs.rm(path.join(temporary,'.incomplete'));await fs.rename(temporary,directory);
    }
    await writeRecoveryState(path.join(root,'active-host-runtime.json'),result);return result;
  }finally{await release();}
}
