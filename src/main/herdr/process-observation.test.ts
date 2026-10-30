// @vitest-environment node
import {describe,expect,it} from "vitest";
import {captureProcessTree,observeProcessTree,parseProcessInventory} from "./process-observation";

const item=<T extends string|null=string>(pid:number,parentPid:number,startId:T="boot:10" as T)=>({pid,parentPid,startId,name:"shell",executable:"/bin/sh"});
describe("pane process observations",()=>{
  it("retains descendants after their root exits and does not attach reused PIDs",()=>{
    const captured=captureProcessTree(10,[item(10,1),item(11,10),item(12,11),item(90,1)]);
    expect(captured.map(p=>p.pid)).toEqual([10,11,12]);
    expect(observeProcessTree(captured,[item(11,1),item(12,11)]).status).toBe("running");
    expect(observeProcessTree(captured,[item(10,1,"boot:99"),item(20,10,"boot:100")]).status).toBe("exited");
  });
  it("fails closed on unavailable identity or an uncaptured process tree",()=>{
    expect(()=>captureProcessTree(10,[item(10,1,null)])).toThrow(/identity/i);
    expect(()=>captureProcessTree(10,[])).toThrow(/observe/i);
    expect(observeProcessTree(undefined,[]).status).toBe("unknown");
    expect(observeProcessTree([item(10,1)],[item(10,1,null)]).status).toBe("unknown");
  });
  it("observes newly spawned descendants without losing previously captured orphans",()=>{
    const observation=observeProcessTree([item(10,1),item(11,10)],[item(10,1),item(11,1),item(12,10)]);
    expect(observation.processes!.map(p=>p.pid)).toEqual([10,11,12]);
    expect(observation.status).toBe("running");
  });
  it("excludes older orphan processes whose historical parent PID has been reused",()=>{
    const inventory=[item(10,1,"windows:100"),item(11,10,"windows:200"),item(90,11,"windows:001"),item(91,90,"windows:002")];
    expect(captureProcessTree(10,inventory).map(p=>p.pid)).toEqual([10,11]);
    expect(observeProcessTree([inventory[0]],inventory).processes!.map(p=>p.pid)).toEqual([10,11]);
  });
  it("keeps an unreadable child uncertain after its parent exits",()=>{
    const captured=captureProcessTree(10,[item(10,1),item(11,10,null)]);
    expect(observeProcessTree(captured,[item(11,1,null)]).status).toBe("unknown");
    expect(observeProcessTree(captured,[item(11,1,"boot:11")]).status).toBe("unknown");
    const gone=observeProcessTree(captured,[]);
    expect(gone.status).toBe("exited");
    expect(observeProcessTree(gone.processes,[item(11,1,"boot:99")]).status).toBe("exited");
  });
  it("rejects malformed, duplicate or excessively large process inventories",()=>{
    expect(()=>parseProcessInventory([item(10,1),item(10,1)])).toThrow();
    expect(()=>parseProcessInventory([{...item(10,1),pid:-1}])).toThrow();
    expect(()=>parseProcessInventory([{...item(10,1),startId:7}])).toThrow();
  });
});
