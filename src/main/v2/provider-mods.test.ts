// @vitest-environment node
import path from "node:path";
import { describe,expect,it,vi } from "vitest";
import { configureProviderMods,isolatedHostEnvironment } from "./provider-mods";
import { makeTransport,metadataArgv,Flusher } from "../../../mods/mcw-chips-v2/hooks/metadata";

describe("v2 provider mods",()=>{
  it("does not inherit another session's legacy control, pane or task authority",()=>{
    expect(isolatedHostEnvironment({PATH:"keep",JK_CODING_CLI_TOKEN:"secret",jk_coding_cli_pipe:"old",MULTI_CLI_WORK_CONTROL_PIPE:"old",HERDR_SOCKET_PATH:"other",MCW_HERDR_BINARY:"other",MCW_TASK_TOKEN:"secret",CLAUDECODE:"1",CODEX_THREAD_ID:"other"})).toEqual({PATH:"keep"});
  });
  it("loads the distinct mod for Claude only and stamps host-owned identity",()=>{
    const root=path.resolve("build/v2/mods"),binary=path.resolve("herdr.exe");
    const result=configureProviderMods({kind:"claude",args:["--model","sonnet","prompt"],env:{OTHER:"retained",MCW_RUNTIME:"v1"},sessionId:"attempt",generation:"generation"},binary,root);
    expect(result.args).toEqual(["--plugin-dir",path.join(root,"mcw-chips-v2"),"--model","sonnet","prompt"]);
    expect(result.env).toMatchObject({MCW_RUNTIME:"v2",MCW_HERDR_BINARY:binary,MULTI_CLI_WORK_SESSION_ID:"attempt",MULTI_CLI_WORK_GENERATION:"generation",OTHER:"retained"});
    expect(configureProviderMods({kind:"codex",args:[],env:{},sessionId:"s",generation:"g"},binary,root).args).toEqual([]);
  });
  it("passes metacharacters as a native argument and validates before invoking Herdr",async()=>{
    const run=vi.fn().mockResolvedValue({exitCode:0,stdout:"",stderr:""});const transport=makeTransport(run,{binary:"C:\\Herdr Dir\\herdr.exe",paneId:"w1:p2"});
    await transport.send({chips:{test:{text:'한글 $(touch x); "quote"',color:"green"}},progress:{kind:"value",value:20}});
    const args=run.mock.calls[0][0];expect(args[0]).toBe("C:\\Herdr Dir\\herdr.exe");expect(args).toContain('mcw-test=green|한글 $(touch x); "quote"');expect(args).toContain("mcw-progress=normal|20");expect(args).not.toContain("--state");
    expect(()=>metadataArgv("herdr","w1:p2",{chips:{test:{text:"x".repeat(81),color:"blue"}},progress:null})).toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("serializes shutdown clearing after a pending report without retrying uncertain delivery",async()=>{
    let fail!:(error:Error)=>void;
    const run=vi.fn().mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject})).mockResolvedValue({exitCode:0,stdout:"",stderr:""});
    const transport=makeTransport(run,{binary:"herdr",paneId:"w1:p1"});
    const first=transport.send({chips:{ctx:{text:"ctx 20%",color:"green"}},progress:null});
    const failure=expect(first).rejects.toThrow("unknown");
    const clear=transport.send({chips:{},progress:null});await Promise.resolve();await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);fail(new Error("unknown"));await failure;await clear;
    expect(run).toHaveBeenCalledTimes(2);expect(run.mock.calls[1][0]).toContain("--clear-token");expect(run.mock.calls[1][0]).not.toContain("mcw-ctx=green|ctx 20%");
  });
  it("does not schedule a retry after a metadata delivery failure",async()=>{
    const after=vi.fn();const send=vi.fn().mockRejectedValue(new Error("unknown"));
    const flusher=new Flusher({clock:{now:async()=>1,after},transport:{name:()=>"test",send},debounceMs:10,sent:null,desired:()=>({chips:{},progress:null})});
    await flusher.flush();expect(send).toHaveBeenCalledTimes(1);expect(after).not.toHaveBeenCalled();expect(flusher.health.failures).toBe(1);
  });
});
