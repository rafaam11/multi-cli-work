// @vitest-environment node
import {expect,it} from "vitest";
import {findRecoveryProcesses,readRecoveryProcesses} from "./residual-processes";
it("blocks every executable name the original Windows installer could close, including another installation",()=>{
  const processes=[{pid:1,name:"Multi CLI Work",executable:"C:/MCW/app.exe"},{pid:2,name:"Multi CLI Work",executable:"D:/Other/Multi CLI Work.exe"},{pid:3,name:"node",executable:"C:/other/node.exe"}];
  expect(findRecoveryProcesses(processes,{applicationNames:["Multi CLI Work.exe"],runtimePaths:[],trackedPids:[]},"win32").map(p=>p.pid)).toEqual([1,2]);
});
it("includes tracked or unobservable runtime instances and never mistakes an unrelated known path for the runtime",()=>{
  const processes=[{pid:10,name:"node",executable:"C:/MCW/resources/v2/node/node.exe"},{pid:11,name:"node",executable:"C:/user/node.exe"},{pid:12,name:"node",executable:null},{pid:13,name:"other",executable:"C:/other.exe"}];
  const result=findRecoveryProcesses(processes,{applicationNames:["Multi CLI Work.exe"],runtimePaths:["c:/mcw/resources/v2/node/node.exe"],trackedPids:[13]},"win32");
  expect(result.map(p=>p.pid)).toEqual([10,12,13]);expect(result.find(p=>p.pid===12)?.executable).toBeNull();
});
it("matches Linux paths with case sensitivity and rejects malformed inventories",()=>{
  expect(findRecoveryProcesses([{pid:1,name:"node",executable:"/MCW/node"},{pid:2,name:"node",executable:"/mcw/node"}],{applicationNames:[],runtimePaths:["/mcw/node"],trackedPids:[]},"linux").map(p=>p.pid)).toEqual([2]);
  expect(()=>findRecoveryProcesses([{pid:-1,name:"app",executable:null}],{applicationNames:[],runtimePaths:[],trackedPids:[]},"linux")).toThrow();
});
it('still recognizes a replaced Linux runtime whose executable is marked deleted',()=>{
  expect(findRecoveryProcesses([{pid:8,name:'node',executable:'/opt/mcw/node (deleted)'}],{applicationNames:[],runtimePaths:['/opt/mcw/node'],trackedPids:[]},'linux').map(p=>p.pid)).toEqual([8]);
});
it("reads a real process inventory and finds this fixture process without stopping anything",async()=>{
  const processes=await readRecoveryProcesses();
  expect(findRecoveryProcesses(processes,{applicationNames:[],runtimePaths:[],trackedPids:[process.pid]},process.platform).some(p=>p.pid===process.pid)).toBe(true);
},15000);
