import {expect,it,vi} from 'vitest';
import {createMobileV2Api} from './v2-client';
import type {RemoteClient} from './remote-client';
it('fails uncertain commands on disconnect and only restores observation subscriptions',async()=>{
  let message:(value:any)=>void=()=>{},state:(value:any)=>void=()=>{};
  const send=vi.fn((_message:unknown)=>true),client={state:()=> 'open',send,onMessage:(listener:any)=>{message=listener;return ()=>{};},onState:(listener:any)=>{state=listener;return ()=>{};}} as unknown as RemoteClient;
  const mobile=createMobileV2Api(client),receive=vi.fn();
  const off=mobile.api.subscribeTerminal('session',receive);
  const pending=mobile.api.taskAction('task','message',{text:'once'});
  const request=send.mock.calls.map(([value])=>value).find((value:any)=>value.type==='v2-request') as any;
  const rejected=expect(pending).rejects.toThrow(/전달 여부/);state('reconnecting');await rejected;
  state('open');expect(send.mock.calls.filter(([value]:any)=>value.type==='v2-request')).toHaveLength(1);
  expect(send.mock.calls.filter(([value]:any)=>value.type==='attach')).toHaveLength(2);
  message({type:'v2-reply',requestId:request.requestId,value:{}});
  message({type:'v2-terminal',sessionId:'session',event:{type:'snapshot',viewerId:'viewer'}});expect(receive).toHaveBeenCalledWith({type:'snapshot',viewerId:'viewer'});
  off();mobile.dispose();
});
