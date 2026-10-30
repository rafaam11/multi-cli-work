// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {HostMobileHub} from './mobile-hub';
import type {HostClient} from './host-client';
import type {V2HostState} from '../../shared/v2-api';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MobileAttentionStore} from '../remote/mobile-attention-store';
const disposals:Array<()=>void>=[];afterEach(()=>disposals.splice(0).forEach(dispose=>dispose()));
const state:V2HostState={connected:true,observedAt:1,tasks:[],hosts:[],terminals:[{id:'session',generation:'1',kind:'codex',cwd:'/repo',projectId:null,status:'idle',connected:true,observedAt:1,tabId:'tab',paneId:'pane',createdAt:new Date(0).toISOString()}]};
function fixture(attention?:MobileAttentionStore){
  const terminal={send:vi.fn(),close:vi.fn()},request=vi.fn(async()=>[]),watch={close:vi.fn()};
  let observed:(event:unknown)=>void=()=>{};let frame:(event:unknown)=>void=()=>{};
  const client={request,watch:vi.fn((callback)=>{observed=callback;return watch;}),terminalSocket:vi.fn((_id,callback)=>{frame=callback;return terminal;})} as unknown as HostClient;
  const device={deviceId:'phone',name:'phone',tokenHash:'a'.repeat(64),createdAt:new Date().toISOString(),lastSeenAt:null};
  const devices={verify:vi.fn(async(token:string)=>token==='secret'?device:null),touch:vi.fn(async()=>{}),hostId:async()=>'legacy-pairing-id'};
  const hub=new HostMobileHub({client,devices,hostId:'local',hostName:'PC',snapshot:async()=>state,attention});disposals.push(()=>hub.dispose());
  const send=vi.fn(),close=vi.fn(),handle=hub.open({send,close});
  const receive=(value:unknown)=>handle.receive(JSON.stringify(value));
  const login=async()=>{receive({type:'hello',token:'secret',protocolVersion:1,mode:'ui'});await vi.waitFor(()=>expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'welcome',hostId:'legacy-pairing-id'})));};
  return {hub,send,close,receive,login,client,devices,terminal,request,handle,observed:(event:unknown)=>observed(event),frame:(event:unknown)=>frame(event)};
}
it('authenticates old pairings and exposes state without granting terminal size ownership',async()=>{
  const f=fixture();await f.login();
  await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith({type:'v2-state',state}));
  f.receive({type:'attach',sessionId:'session'});await vi.waitFor(()=>expect(f.client.terminalSocket).toHaveBeenCalled());
  expect(f.terminal.send).not.toHaveBeenCalled();
  f.frame({type:'snapshot',viewerId:'unique-viewer',snapshot:{}});
  expect(f.send).toHaveBeenCalledWith({type:'v2-terminal',sessionId:'session',event:expect.objectContaining({viewerId:'unique-viewer'})});
  f.receive({type:'v2-terminal',sessionId:'session',command:{type:'takeOwnership'}});
  await vi.waitFor(()=>expect(f.terminal.send).toHaveBeenCalledWith({type:'takeOwnership'}));
});
it('rejects unauthenticated work and closes revoked sockets before further commands',async()=>{
  const unauth=fixture();unauth.receive({type:'v2-request',requestId:'1',operation:'configuration',args:[]});
  await vi.waitFor(()=>expect(unauth.close).toHaveBeenCalledWith(4401,expect.any(String)));expect(unauth.request).not.toHaveBeenCalled();
  const f=fixture();await f.login();f.receive({type:'attach',sessionId:'session'});await vi.waitFor(()=>expect(f.client.terminalSocket).toHaveBeenCalled());
  f.hub.disconnectDevice('phone');f.receive({type:'v2-terminal',sessionId:'session',command:{type:'takeOwnership'}});
  await new Promise(resolve=>setTimeout(resolve,10));expect(f.terminal.close).toHaveBeenCalled();expect(f.terminal.send).not.toHaveBeenCalled();
});
it('forwards bounded terminal requests and rejects invalid request identities',async()=>{
  const f=fixture();await f.login();f.receive({type:'attach',sessionId:'session'});await vi.waitFor(()=>expect(f.client.terminalSocket).toHaveBeenCalled());
  const search={type:'search',requestId:'req-1',params:{query:'word',direction:'forward',cursor:{row:0,col:0},content_revision:2}};
  f.receive({type:'v2-terminal',sessionId:'session',command:search});
  f.receive({type:'v2-terminal',sessionId:'session',command:{type:'selection',requestId:'req-2',params:{content_revision:2}}});
  f.receive({type:'v2-terminal',sessionId:'session',command:{type:'clear',requestId:'x'.repeat(65)}});
  await vi.waitFor(()=>expect(f.terminal.send).toHaveBeenCalledTimes(2));
  expect(f.terminal.send).toHaveBeenCalledWith(search);
  await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith(expect.objectContaining({type:'error'})));
});
it('does not proxy administrative operations, replacement authentication or arbitrary terminal targets',async()=>{
  const f=fixture();await f.login();f.receive({type:'v2-request',requestId:'1',operation:'shutdown',args:[]});
  await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith(expect.objectContaining({type:'v2-reply',requestId:'1',error:expect.any(String)})));
  f.receive({type:'attach',sessionId:'session'});await vi.waitFor(()=>expect(f.client.terminalSocket).toHaveBeenCalled());
  f.receive({type:'v2-terminal',sessionId:'session',command:{type:'subscribe',sessionId:'other'}});
  f.receive({type:'v2-terminal',sessionId:'unknown',command:{type:'takeOwnership'}});
  await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith(expect.objectContaining({type:'error'})));expect(f.terminal.send).not.toHaveBeenCalled();
});
it('does not admit a pairing revoked while asynchronous authentication is pending',async()=>{
  const f=fixture();let finish:(value:any)=>void=()=>{};
  f.devices.verify.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  f.receive({type:'hello',token:'secret',protocolVersion:1,mode:'ui'});
  await vi.waitFor(()=>expect(f.devices.verify).toHaveBeenCalled());f.hub.disconnectDevice('phone');
  finish({deviceId:'phone',name:'phone'});
  await vi.waitFor(()=>expect(f.close).toHaveBeenCalled());
  expect(f.send).not.toHaveBeenCalledWith(expect.objectContaining({type:'welcome'}));
});
it('sends new task waits to the native status channel but only sees an attached generation',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mcw-mobile-waits-')),attention=new MobileAttentionStore(path.join(directory,'attention.json')),f=fixture(attention);
  const observe=vi.spyOn(attention,'observe');
  try{
    await f.login();await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith({type:'v2-state',state}));
    expect(f.send).not.toHaveBeenCalledWith(expect.objectContaining({type:'status'}));
    const task:import('../../shared/host-types').Task={id:'task',ownerHostId:'local',title:'Task',brief:'',workerPool:[],createdAt:0,
      participants:[{id:'lead',role:'lead',provider:'codex',profileId:'profile',hostId:'local',previousAttempts:[],attempt:{id:'session',generation:1,execution:'idle',delivery:'delivered',commandId:'cmd',submittedResultId:null,observedAt:1}}],
      events:[],questions:[{id:'q1',participantId:'lead',kind:'question',text:'First question',acknowledged:false,answer:null}],attention:{status:'waiting',eventId:'q1',kind:'question',acknowledged:false},results:[],review:'none',cancellation:'none'};
    f.observed({type:'state',...state,tasks:[task],observedAt:2});
    await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith(expect.objectContaining({type:'status',status:'awaiting-input',attention:{generation:1,seenThrough:0}})));
    f.receive({type:'seen',sessionId:'session',generation:1});await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith(expect.objectContaining({type:'error'})));
    expect(await attention.current('session')).toEqual({generation:1,seenThrough:0});
    f.receive({type:'attach',sessionId:'session'});await vi.waitFor(()=>expect(f.client.terminalSocket).toHaveBeenCalled());
    f.receive({type:'seen',sessionId:'session',generation:1});await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith({type:'seen',sessionId:'session',attention:{generation:1,seenThrough:1}}));
    f.observed({type:'state',...state,tasks:[{...task,questions:[...task.questions,{...task.questions[0],id:'q2',text:'Second question'}]}],observedAt:3});
    await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith(expect.objectContaining({type:'status',status:'awaiting-input',attention:{generation:2,seenThrough:1}})));
    f.receive({type:'seen',sessionId:'session',generation:1});await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith({type:'seen',sessionId:'session',attention:{generation:2,seenThrough:1}}));
    const written=observe.mock.calls.length;
    f.observed({type:'state',...state,tasks:[{...task,questions:[...task.questions,{...task.questions[0],id:'q2',text:'Second question'}]}],observedAt:4});
    await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith(expect.objectContaining({type:'v2-state',state:expect.objectContaining({observedAt:4})})));
    expect(observe).toHaveBeenCalledTimes(written);
  }finally{f.hub.dispose();await fs.rm(directory,{recursive:true,force:true});}
});
