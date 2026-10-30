import {execFile} from "node:child_process";
import {promisify} from "node:util";

export interface ProcessObservation {pid:number;parentPid:number;startId:string|null;name:string;executable:string|null}
export type ProcessIdentity=ProcessObservation;
const exec=promisify(execFile);
export function parseProcessInventory(value:unknown):ProcessObservation[]{
  if(!Array.isArray(value)||value.length>100000)throw new Error("Invalid process inventory");
  const ids=new Set<number>();
  for(const p of value){
    if(!p||typeof p!=="object"||!Number.isSafeInteger(p.pid)||p.pid<=0||ids.has(p.pid)||!Number.isSafeInteger(p.parentPid)||p.parentPid<0||(p.startId!==null&&(typeof p.startId!=="string"||!p.startId||p.startId.length>160))||typeof p.name!=="string"||!p.name||(p.executable!==null&&typeof p.executable!=="string"))throw new Error("Invalid process inventory record");
    ids.add(p.pid);
  }
  return value;
}
export async function readProcessInventory(bridgePath:string):Promise<ProcessObservation[]>{
  const result=await exec(bridgePath,["--process-snapshot"],{windowsHide:true,timeout:10000,maxBuffer:16*1024*1024});
  return parseProcessInventory(JSON.parse(result.stdout));
}
function descendants(roots:ProcessObservation[],inventory:ProcessObservation[]):ProcessObservation[]{
  const found=new Map(roots.map(p=>[p.pid,p]));
  const olderThanParent=(child:ProcessObservation,parent:ProcessObservation)=>{
    if(child.startId===null||parent.startId===null)return false;
    const [childBoot,childStart]=child.startId.split(":"),[parentBoot,parentStart]=parent.startId.split(":");
    if(childBoot!==parentBoot)return true;
    try {const prefix=childBoot==="windows"?"0x":"";return BigInt(prefix+childStart)<BigInt(prefix+parentStart);}catch {throw new Error("Cannot compare process creation identities");}
  };
  for(let changed=true;changed;){changed=false;for(const p of inventory){const parent=found.get(p.parentPid);if(!found.has(p.pid)&&parent&&!olderThanParent(p,parent)){found.set(p.pid,p);changed=true;}}}
  return [...found.values()];
}
export function captureProcessTree(pid:number,inventory:ProcessObservation[]):ProcessIdentity[]{
  const root=inventory.find(p=>p.pid===pid);if(!root)throw new Error("Cannot observe the pane process");
  const records=descendants([root],inventory);
  if(root.startId===null)throw new Error("Pane process identity is unavailable");
  return records;
}
/** A closed pane is not proof of process exit. Identity is PID plus kernel creation token. */
export function observeProcessTree(known:ProcessIdentity[]|undefined,inventory:ProcessObservation[]):{status:"running"|"exited"|"unknown";processes:ProcessIdentity[]|undefined}{
  if(!known?.length)return {status:"unknown",processes:known};
  const byId=new Map(inventory.map(p=>[p.pid,p]));
  const uncertain=known.some(p=>byId.has(p.pid)&&(p.startId===null||byId.get(p.pid)?.startId===null));
  const live=known.flatMap(p=>{const current=byId.get(p.pid);return p.startId!==null&&current?.startId===p.startId?[current]:[];});
  const tree=descendants(live,inventory),next=new Map(known.filter(p=>p.startId!==null||byId.has(p.pid)).map(p=>[p.pid,p]));
  for(const p of tree)next.set(p.pid,p);
  return {status:uncertain||tree.some(p=>p.startId===null)?"unknown":live.length?"running":"exited",processes:[...next.values()]};
}
