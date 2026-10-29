import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
const related=new Set(["mcw-chips","mcw-companion","jinmin-hud"]);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
async function json(file:string):Promise<Record<string,unknown>|null>{
  try {
    const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw new Error("Mod registry must be a bounded regular file");
    const data:unknown=JSON.parse(await fs.readFile(file,"utf8"));if(!record(data))throw new Error("Invalid mod registry");return data;
  }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
}
/** Discover explicit installed/local-marketplace paths, not conversations or unrelated plugins. */
export async function discoverV1ModSources(configDirectory:string):Promise<Record<string,string>> {
  if(!path.isAbsolute(configDirectory))throw new Error("Claude config path must be absolute");
  const registry=path.join(configDirectory,"plugins");
  const sources:Record<string,string>={settings:path.join(configDirectory,"settings.json"),installed:path.join(registry,"installed_plugins.json"),marketplaces:path.join(registry,"known_marketplaces.json")};
  const add=(prefix:string,source:string)=>{sources[`${prefix}-${createHash("sha256").update(source).digest("hex").slice(0,24)}`]=source;};
  const plugin=async(name:string,source:unknown)=>{
    if(typeof source!=="string"||!path.isAbsolute(source))throw new Error("Related mod has an invalid installation path");
    const manifest=await json(path.join(source,".claude-plugin/plugin.json"));
    if(!manifest||manifest.name!==name)throw new Error(`Related mod source cannot be verified: ${name}`);
    add(name,path.resolve(source));
  };
  const installed=await json(sources.installed);
  if(installed&&(!record(installed.plugins)))throw new Error("Invalid installed mod registry");
  const marketplaces=new Set<string>();
  for(const [key,entries] of Object.entries((installed?.plugins??{}) as Record<string,unknown>)) {
    const [name,market]=key.split("@");if(!related.has(name))continue;
    if(!Array.isArray(entries)||entries.length>16)throw new Error("Invalid related mod versions");
    if(market)marketplaces.add(market);
    for(const entry of entries){if(!record(entry))throw new Error("Invalid related mod entry");await plugin(name,entry.installPath);}
  }
  const known=await json(sources.marketplaces);
  for(const market of marketplaces){
    const entry=known?.[market];if(!record(entry)||!record(entry.source)||entry.source.source!=="directory")continue;
    const root=entry.source.path;if(typeof root!=="string"||!path.isAbsolute(root))throw new Error("Invalid local mod marketplace path");
    const catalog=await json(path.join(root,".claude-plugin/marketplace.json"));if(!catalog||!Array.isArray(catalog.plugins))throw new Error("Invalid local mod marketplace catalog");
    for(const item of catalog.plugins){
      if(!record(item)||typeof item.name!=="string"||!related.has(item.name))continue;
      if(typeof item.source!=="string")throw new Error("Unsupported related local mod source");
      const resolved=path.resolve(root,item.source),relative=path.relative(root,resolved);
      if(!relative||relative===".."||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error("Local mod source escapes marketplace");
      await plugin(item.name,resolved);
    }
  }
  const stateRoot=path.join(registry,"data");
  const states=await fs.readdir(stateRoot).catch(error=>{if(error.code==="ENOENT")return [];throw error;});
  for(const name of states)if([...related].some(prefix=>name===prefix||name.startsWith(`${prefix}-`)))add("state",path.join(stateRoot,name));
  if(Object.keys(sources).length>64)throw new Error("Too many related mod sources");
  return sources;
}
