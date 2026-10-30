import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ProcessObservation} from './process-observation';
import {gitCommonDir,listGitWorktrees,removeGitWorktree} from '../projects/git-worktree';
interface Hold {id:string;cwd:string;owner:{pid:number;startId:string};released?:boolean;git?:{state:'running'|'settled';bootId:string;ok?:boolean}}
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
export async function canonicalCheckout(value:string):Promise<string>{
 if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))throw new Error('Invalid checkout path');
 let resolved:string;
 try{resolved=await fs.realpath(value);}catch(error){if(!missing(error))throw error;const parent=path.dirname(value);if(parent===value)throw error;resolved=path.join(await canonicalCheckout(parent),path.basename(value));}
 return process.platform==='win32'?path.normalize(resolved).toLowerCase():path.normalize(resolved);
}
const contains=(root:string,cwd:string)=>{const relative=path.relative(root,cwd);return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith(`..${path.sep}`);};
/** Durable operation IDs are never reused after release. The host owns Git, so a
 * disappearing GUI cannot leave a deleting child. An unknown host crash requires
 * native proof of a different boot before any explicit retry can release the hold. */
export class CheckoutAdmission {
 private mutation=Promise.resolve();
 private readonly file:string;
 private readonly removing=new Map<string,Promise<void>>();
 constructor(directory:string,private readonly inventory:()=>Promise<ProcessObservation[]>,private readonly bootIdentity?:()=>Promise<string>,private readonly removeGit=removeGitWorktree){this.file=path.join(directory,'checkout-removal-holds.json');}
 private async serialized<T>(operation:()=>Promise<T>):Promise<T>{const result=this.mutation.then(operation);this.mutation=result.then(()=>{},()=>{});return result;}
 private async read():Promise<Hold[]>{
  let value:unknown;try{value=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(error){if(missing(error))return [];throw error;}
  const record=value as {version?:number;holds?:Hold[]};
  if(!record||record.version!==1||!Array.isArray(record.holds)||record.holds.some(h=>!h||typeof h.id!=='string'||!h.id||typeof h.cwd!=='string'||!path.isAbsolute(h.cwd)||!h.owner||!Number.isSafeInteger(h.owner.pid)||h.owner.pid<=0||typeof h.owner.startId!=='string'||!h.owner.startId||(h.released!==undefined&&typeof h.released!=='boolean')||(h.git!==undefined&&(!h.git||!['running','settled'].includes(h.git.state)||typeof h.git.bootId!=='string'||!h.git.bootId||(h.git.ok!==undefined&&typeof h.git.ok!=='boolean'))))||new Set(record.holds.map(h=>h.id)).size!==record.holds.length)throw new Error('Invalid checkout removal holds; admission is blocked');
  return record.holds;
 }
 private async save(holds:Hold[]):Promise<void>{
  await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});const temporary=`${this.file}.${randomUUID()}.tmp`;
  try{await fs.writeFile(temporary,JSON.stringify({version:1,holds}),{flag:'wx',mode:0o600,flush:true});await fs.rename(temporary,this.file);}finally{await fs.rm(temporary,{force:true});}
 }
 private async settleUnknown(held:Hold):Promise<void>{
  if(held.git?.state!=='running')return;
  if(this.removing.has(held.id))throw new Error('Host Git removal is still running; retry after it finishes');
  const boot=await this.bootIdentity?.();
  if(!boot||boot===held.git.bootId)throw new Error('Git removal outcome is unknown after host restart. Restart this PC, then explicitly retry removal; the checkout remains held.');
  held.git={state:'settled',bootId:boot,ok:false};
 }
 launch<T>(cwd:string,operation:()=>Promise<T>):Promise<T>{return this.serialized(async()=>{
  const canonical=await canonicalCheckout(cwd),holds=await this.read();
  if(holds.some(h=>!h.released&&contains(h.cwd,canonical)))throw new Error('Checkout admission is held for worktree removal');
  return operation();
 });}
 acquire(cwd:string,id:string,pid:number):Promise<void>{return this.serialized(async()=>{
  if(typeof id!=='string'||!id||id.length>128||!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid checkout removal lease');
  const canonical=await canonicalCheckout(cwd),holds=await this.read(),inventory=await this.inventory(),owner=inventory.find(p=>p.pid===pid);
  if(!owner?.startId)throw new Error('Cannot verify checkout removal owner identity');
  const exact=holds.find(h=>h.id===id);
  if(exact?.released)throw new Error('Checkout removal operation is already released; settle that operation before starting another');
  if(exact&&exact.cwd!==canonical)throw new Error('Checkout removal lease path differs');
  const overlaps=holds.filter(h=>!h.released&&(contains(h.cwd,canonical)||contains(canonical,h.cwd)));
  for(const held of overlaps){
   await this.settleUnknown(held);
   const sameOwner=held.owner.pid===owner.pid&&held.owner.startId===owner.startId;
   const current=inventory.find(p=>p.pid===held.owner.pid);
   if(!(held.id===id&&sameOwner)&&current&&(current.startId===null||current.startId===held.owner.startId))throw new Error('Checkout removal owner is still running; retry after closing that GUI');
   if(held.id!==id)held.released=true;
  }
  if(exact){exact.owner={pid:owner.pid,startId:owner.startId};}else holds.push({id,cwd:canonical,owner:{pid:owner.pid,startId:owner.startId}});
  await this.save(holds);
 });}
 release(id:string):Promise<void>{return this.serialized(async()=>{
  const holds=await this.read(),held=holds.find(h=>h.id===id);if(!held)throw new Error('Unknown checkout removal lease');
  if(held.released)return;await this.settleUnknown(held);held.released=true;await this.save(holds);
 });}
 async busy():Promise<boolean>{return (await this.read()).some(h=>!h.released&&h.git?.state==='running');}
 async remove(id:string,repo:string,cwd:string,force:boolean):Promise<void>{
  const existing=this.removing.get(id);if(existing)return existing;
  const execution=this.executeRemoval(id,repo,cwd,force);this.removing.set(id,execution);
  try{await execution;}finally{this.removing.delete(id);}
 }
 private async executeRemoval(id:string,repo:string,cwd:string,force:boolean):Promise<void>{
  let skip=false;
  await this.serialized(async()=>{
   const holds=await this.read(),held=holds.find(h=>h.id===id);
   if(!held||held.released||held.cwd!==await canonicalCheckout(cwd))throw new Error('Active checkout removal lease required');
   if(held.git?.state==='running')throw new Error('Unknown prior Git removal must be settled before retry');
   if(held.git?.ok){skip=true;return;}
   const listed=await listGitWorktrees(repo);
   const canonicalPaths=await Promise.all(listed.map(item=>canonicalCheckout(item.path)));
   const index=canonicalPaths.indexOf(held.cwd);
   if(index<=0||await canonicalCheckout(await gitCommonDir(repo))!==await canonicalCheckout(await gitCommonDir(cwd)))throw new Error('Checkout is not a removable worktree of this repository');
   const boot=await this.bootIdentity?.();if(!boot)throw new Error('Native boot identity is required before Git removal');
   held.git={state:'running',bootId:boot};await this.save(holds);
  });
  if(skip)return;
  let failure:unknown;
  try{await this.removeGit(repo,cwd,force);}catch(error){failure=error;}
  await this.serialized(async()=>{const holds=await this.read(),held=holds.find(h=>h.id===id);if(!held||held.git?.state!=='running')throw new Error('Git removal record changed');held.git={...held.git,state:'settled',ok:failure===undefined};await this.save(holds);});
  if(failure!==undefined)throw failure;
 }
}
