import {randomUUID} from "node:crypto";
import {lstat,realpath,rename} from "node:fs/promises";
import path from "node:path";

/** Remove an updater's pending installation from its active path without deleting any bytes. */
export async function quarantineUpdaterCache(options:{cacheRoot:string;cacheName:string;assertStopped():Promise<void>}):Promise<{retained:string|null}>{
  const {cacheRoot,cacheName,assertStopped}=options;
  if(!path.isAbsolute(cacheRoot)||cacheRoot.includes("\0")||!/^[\w.-]{1,120}$/.test(cacheName)||[".",".."].includes(cacheName)||typeof assertStopped!=="function")throw new Error("Invalid updater cache target");
  await assertStopped();
  const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==="ENOENT";
  const rootStat=await lstat(cacheRoot).catch(error=>{if(missing(error))return null;throw error;});
  if(!rootStat)return {retained:null};
  const canonical=await realpath(cacheRoot),same=(a:string,b:string)=>process.platform==="win32"?a.toLowerCase()===b.toLowerCase():a===b;
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||!same(canonical,path.resolve(cacheRoot)))throw new Error("Updater cache root is linked or replaced");
  const source=path.join(canonical,cacheName),retained=path.join(canonical,`${cacheName}.mcw-rollback-${randomUUID()}`);
  if(path.dirname(source)!==canonical||path.dirname(retained)!==canonical)throw new Error("Updater cache escapes its root");
  const before=await lstat(source).catch(error=>{if(missing(error))return null;throw error;});
  if(!before)return {retained:null};
  if(!before.isDirectory()||before.isSymbolicLink()||!same(await realpath(source),source))throw new Error("Updater cache is linked or not a directory");
  await assertStopped();
  const current=await lstat(source);
  if(!current.isDirectory()||current.isSymbolicLink()||current.ino!==before.ino||!same(await realpath(source),source)||!same(await realpath(cacheRoot),canonical))throw new Error("Updater cache changed before quarantine");
  await rename(source,retained);
  // Failure here still retains the cache, and the lifecycle controller must
  // report it and withhold launch. It must never silently restore pending v2.
  await assertStopped();return {retained};
}
