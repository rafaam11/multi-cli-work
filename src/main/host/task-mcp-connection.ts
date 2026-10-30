import { lstat, open } from "node:fs/promises";
import path from "node:path";

export async function readTaskMcpConnection(args: string[], env: NodeJS.ProcessEnv): Promise<{endpoint:string;token:string}> {
  const index=args.indexOf("--connection-file");
  // Existing running previews can keep their per-client environment until exit.
  if(index===-1)return {endpoint:env.MCW_TASK_URL??"",token:env.MCW_TASK_TOKEN??""};
  const file=args[index+1];
  if(!file||!path.isAbsolute(file)||args.lastIndexOf("--connection-file")!==index)throw new Error("Invalid task MCP connection file");
  const before=await lstat(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size>16384)throw new Error("Invalid task MCP connection file");
  const handle=await open(file,"r");
  try{
    const stat=await handle.stat();
    // Windows path stats may report dev=0 while handle stats report the volume.
    if(!stat.isFile()||(before.dev!==0&&stat.dev!==before.dev)||stat.ino!==before.ino||stat.size>16384)throw new Error("Task MCP connection file changed");
    const value:unknown=JSON.parse(await handle.readFile("utf8"));
    if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!["endpoint","token"].includes(key)))throw new Error("Invalid task MCP connection file");
    const record=value as Record<string,unknown>;
    if(typeof record.endpoint!=="string"||typeof record.token!=="string")throw new Error("Invalid task MCP connection file");
    return {endpoint:record.endpoint,token:record.token};
  }finally{await handle.close();}
}
