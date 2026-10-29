// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), spawn: vi.fn() }));
vi.mock("./runtime", () => ({ startHerdrRuntime: mocks.start }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { createHerdrTerminalService } from "./terminal-service";

class Child extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough();
  exitCode: number | null = null; killed = false; commands: Record<string, any>[] = [];
  kill = vi.fn(() => { this.killed = true; this.exitCode = 0; this.emit("exit", 0); return true; });
  constructor() { super(); this.stdin.on("data", bytes => { for (const line of String(bytes).trim().split("\n")) this.commands.push(JSON.parse(line)); }); }
  event(value: unknown) { this.stdout.write(JSON.stringify(value) + "\n"); }
}
const geometry = { cols: 90, rows: 30, cellWidthPx: 8, cellHeightPx: 16 };
const stored = () => ({ id: "s", kind: "shell", cwd: path.resolve("."), projectId: null, createdAt: "2026-10-30T00:00:00Z", generation: "g", tabId: "t", paneId: "p", delivery: "delivered", status: "working", observedAt: 100, connected: true, geometry });
const frame = { boot_id: "b", projection_revision: 1, surface_revision: 1, frame: {width:90,height:30,cells:Array.from({length:2700},()=>({symbol:" ",fg:0,bg:0,modifier:0,skip:false,hyperlink:null})),cursor:null,hyperlinks:[],graphics:[]}, panes:[{pane_id:"p",content_revision:1,rect:{x:0,y:0,width:90,height:30},inner_rect:{x:0,y:0,width:90,height:30},scrollbar_rect:null,scroll:{offset_from_bottom:0,max_offset_from_bottom:100,viewport_rows:30}}], splits:[],popup:null,graphics:{assets:[],placements:[],retained_assets:[]} };
let roots: string[] = [], services: Array<{close(stop?:boolean):Promise<void>}> = [];
let snapshot: any, callback: (event: unknown) => void, request: ReturnType<typeof vi.fn>, children: Child[];

beforeEach(() => {
  children = [];
  snapshot = { panes:[{pane_id:"p",agent_status:"working"}], workspaces:[{workspace_id:"w",label:"MCW managed sessions"}], focused_tab_id:"t", layouts:[{tab_id:"t",area:{width:90,height:30}}] };
  request = vi.fn(async (method: string) => method === "session.snapshot" ? {snapshot} : method === "layout.apply" ? {layout:{tab_id:"t",root:{pane_id:"p"}}} : {});
  mocks.start.mockResolvedValue({api:{request,subscribe:vi.fn(async (_types, event) => {callback=event; return ()=>{};})},paths:{clientPath:path.resolve("fake.sock")},stop:vi.fn()});
  mocks.spawn.mockImplementation(() => {const child = new Child(); children.push(child); return child;});
});
afterEach(async () => { for(const service of services) await service.close(); services=[];vi.useRealTimers();for(const root of roots) await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:10});roots=[];vi.clearAllMocks(); });
async function make(records = [stored()]) {
  const root=await fs.mkdtemp(path.join(tmpdir(),"mcw-bridge-unit-"));roots.push(root);
  await fs.writeFile(path.join(root,"terminal-sessions.json"),JSON.stringify({version:2,sessions:records}));
  const service=await createHerdrTerminalService({root,binaryPath:"fake",binarySha256:"0".repeat(64),bridgePath:"fake-bridge"});services.push(service);return {service,root};
}
async function ready(child:Child) {
  child.event({type:"control",kind:"shell.snapshot.v1",data:{boot_id:"b"}});
  const focus=child.commands.find(command=>command.type==="request")!;
  child.event({type:"response",bootId:"b",requestId:focus.request.id,finalChunk:true,dataBytes:[...Buffer.from(JSON.stringify({id:focus.request.id,result:{}}))]});
  await Promise.resolve();child.event({type:"surface",surface:frame});
}

describe("host bridge lifecycle", () => {
  it("preopens recovered sessions at recorded geometry; observer reads never launch a bridge", async () => {
    const {service}=await make();
    expect(children).toHaveLength(1);
    expect(children[0].commands[0]).toMatchObject({type:"hello",cols:90,rows:30});
    await ready(children[0]);
    await service.snapshot("s");const unsubscribe=service.subscribeFrames("s",()=>{});unsubscribe();
    expect(children).toHaveLength(1);
  });
  it("rejects malformed final response without leaving its promise pending", async () => {
    const {service}=await make();await ready(children[0]);await service.takeOwnership("s","owner");
    const pending=service.scroll("s","owner",1);const outcome=expect(pending).rejects.toThrow(/unknown|JSON|response/i);
    const sent=children[0].commands.filter(command=>command.type==="request").at(-1)!;
    children[0].event({type:"response",bootId:"b",requestId:sent.request.id,finalChunk:true,dataBytes:[123]});
    await outcome;
  });
  it("handles EPIPE and stops parsing buffered frames after a fatal event", async () => {
    const {service}=await make();await ready(children[0]);
    expect(()=>children[0].stdin.emit("error",new Error("EPIPE"))).not.toThrow();
    children[0].event({type:"surface",surface:frame});
    expect((await service.list())[0].connected).toBe(false);
  });
  it("isolates listener failures and keeps nonfatal native errors from disconnecting peers", async () => {
    const {service}=await make();await ready(children[0]);
    service.subscribeFrames("s",()=>{throw new Error("viewer failed");});const received=vi.fn();service.subscribeFrames("s",received);
    children[0].event({type:"error",message:"invalid key"});children[0].event({type:"surface",surface:frame});
    expect(received).toHaveBeenCalled();expect((await service.list())[0].connected).toBe(true);
  });
  it("preserves delivered state when refresh fails after an acknowledged layout", async () => {
    const {service}=await make([]);let snapshots=0;
    request.mockImplementation(async(method:string)=>{
      if(method==="session.snapshot") {if(++snapshots>1) throw new Error("read failed after delivery");return {snapshot};}
      return {layout:{tab_id:"t",root:{pane_id:"p"}}};
    });
    await expect(service.create({sessionId:"new",kind:"shell",cwd:roots[0],executable:"shell",args:[],env:{},projectId:null,createdAt:new Date().toISOString()})).rejects.toThrow();
    expect((await service.list())[0].delivery).toBe("delivered");
  });
  it("marks an interrupted pending launch unknown on startup", async () => {
    const item={...stored(),delivery:"pending",tabId:null,paneId:null};const {service}=await make([item as any]);
    expect((await service.list())[0].delivery).toBe("unknown");expect(children).toHaveLength(0);
  });
  it("invalidates a snapshot again when an event arrives during the read", async () => {
    const {service}=await make();let resolveRead!:(value:unknown)=>void;
    request.mockImplementationOnce(()=>new Promise(resolve=>{resolveRead=resolve;}));
    callback({});callback({});
    const before=request.mock.calls.length;resolveRead({snapshot});
    await vi.waitFor(()=>expect(request.mock.calls.length).toBeGreaterThan(before));
  });
  it("fails startup waiters and terminates only its own hung bridge", async () => {
    vi.useFakeTimers();const {service}=await make();
    const pending=service.snapshot("s");const outcome=expect(pending).rejects.toThrow(/timed out|startup/i);
    await vi.advanceTimersByTimeAsync(16000);await outcome;
    expect(children[0].kill).toHaveBeenCalled();
  });
});
