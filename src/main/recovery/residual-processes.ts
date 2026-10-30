import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readdir,readFile,readlink} from "node:fs/promises";
import path from "node:path";

export interface RecoveryProcess {pid:number;name:string;executable:string|null}
export interface RecoveryProcessTargets {applicationNames:string[];runtimePaths:string[];trackedPids:number[]}
const exec=promisify(execFile);
function validate(values:unknown):RecoveryProcess[]{
  if(!Array.isArray(values)||values.length>100000)throw new Error("Process inventory unavailable");
  const pids=new Set<number>();
  for(const value of values){
    if(!value||typeof value!=="object"||!Number.isSafeInteger(value.pid)||value.pid<=0||pids.has(value.pid)||typeof value.name!=="string"||!value.name||(value.executable!==null&&typeof value.executable!=="string"))throw new Error("Invalid process inventory");pids.add(value.pid);
  }
  return values;
}
/** Read-only native inventory: no command-line credentials and no termination signals. */
export async function readRecoveryProcesses():Promise<RecoveryProcess[]>{
  if(process.platform==="win32"){
    // Get-Process uses the native process API. Avoid WMI/tasklist, which the
    // original installer replaced because a wedged WMI service can hang them.
    const script="$ErrorActionPreference='Stop'; @(Get-Process | Where-Object { $_.Id -gt 0 } | ForEach-Object { [pscustomobject]@{pid=$_.Id;name=$_.ProcessName;executable=$_.Path} }) | ConvertTo-Json -Compress";
    const result=await exec("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,timeout:10000,maxBuffer:4*1024*1024});
    return validate(JSON.parse(result.stdout.replace(/^\uFEFF/,"")));
  }
  if(process.platform!=="linux")throw new Error("Recovery process inventory does not support this platform");
  const result:RecoveryProcess[]=[];
  for(const entry of await readdir("/proc")){
    if(!/^[1-9]\d*$/.test(entry))continue;
    let name:string;
    try{name=(await readFile(`/proc/${entry}/comm`,"utf8")).trim();}
    catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")continue;throw new Error("A process could not be identified; recovery is blocked",{cause:error});}
    let executable:string|null;
    try{executable=await readlink(`/proc/${entry}/exe`);}
    catch(error){const code=(error as NodeJS.ErrnoException).code;if(!["ENOENT","EACCES","EPERM"].includes(code??""))throw error;executable=null;}
    result.push({pid:Number(entry),name,executable});
  }
  return validate(result);
}
export function findRecoveryProcesses(inventory:RecoveryProcess[],targets:RecoveryProcessTargets,platform:NodeJS.Platform):RecoveryProcess[]{
  validate(inventory);
  if(!["win32","linux"].includes(platform)||!Array.isArray(targets.applicationNames)||!Array.isArray(targets.runtimePaths)||!Array.isArray(targets.trackedPids)||targets.applicationNames.some(name=>typeof name!=="string"||!name)||targets.runtimePaths.some(file=>typeof file!=="string"||!(platform==="win32"?path.win32:path.posix).isAbsolute(file))||targets.trackedPids.some(pid=>!Number.isSafeInteger(pid)||pid<=0))throw new Error("Invalid recovery process targets");
  const systemPath=platform==="win32"?path.win32:path.posix;
  const normalize=(file:string)=>platform==="win32"?path.win32.normalize(file).toLowerCase():file.replace(/ \(deleted\)$/,'');
  const processName=(file:string)=>platform==="win32"?path.win32.basename(file).replace(/\.exe$/i,"").toLowerCase():path.posix.basename(file);
  const names=new Set(targets.applicationNames.map(processName)),runtimes=new Set(targets.runtimePaths.map(normalize)),runtimeNames=new Set(targets.runtimePaths.map(file=>processName(systemPath.basename(file))));
  return inventory.filter(item=>names.has(processName(item.name))||targets.trackedPids.includes(item.pid)||(item.executable!==null?runtimes.has(normalize(item.executable)):runtimeNames.has(processName(item.name))));
}
