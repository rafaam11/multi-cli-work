// @vitest-environment node
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {Readable,Writable} from "node:stream";
import {afterEach,expect,it,vi} from "vitest";
import {readTaskMcpConnection,runTaskMcpClient} from "./mcw-task-mcp-client";
const directories:string[]=[];
afterEach(async()=>{vi.unstubAllGlobals();await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
it("reads private task authority without command-line credentials and uses it for stdio requests",async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"mcw-task-client-"));directories.push(directory);
  const file=path.join(directory,"connection.json"),connection={endpoint:"http://127.0.0.1:12345/mcp",token:"x".repeat(43)};
  await writeFile(file,JSON.stringify(connection),{mode:0o600});
  const args=["--task-mcp-client","--connection-file",file];
  const resolved=await readTaskMcpConnection(args,{MCW_TASK_TOKEN:"unrelated"});
  expect(resolved).toEqual(connection);expect(args.join(" ")).not.toContain(connection.token);
  const request={jsonrpc:"2.0",id:1,method:"tools/list"},response={jsonrpc:"2.0",id:1,result:{tools:[]}};
  const fetch=vi.fn(async()=>({ok:true,json:async()=>response}));vi.stubGlobal("fetch",fetch);
  let output="";
  await runTaskMcpClient({...resolved,input:Readable.from([JSON.stringify(request)+"\n"]),output:new Writable({write(chunk,_encoding,callback){output+=chunk;callback();}})});
  expect(fetch).toHaveBeenCalledWith(new URL(connection.endpoint),expect.objectContaining({headers:expect.objectContaining({authorization:`Bearer ${connection.token}`}),body:JSON.stringify(request)}));
  expect(JSON.parse(output)).toEqual(response);
  await writeFile(file,JSON.stringify({...connection,command:"must not execute"}));
  await expect(readTaskMcpConnection(args,{})).rejects.toThrow("Invalid");
  await expect(readTaskMcpConnection(["--connection-file"],{MCW_TASK_TOKEN:connection.token})).rejects.toThrow("Invalid");
});
