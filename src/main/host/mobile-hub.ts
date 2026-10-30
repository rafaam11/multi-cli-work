import type {HostClient,HostTerminalSocket} from './host-client';
import {mobileOperation} from './mobile-operations';
import type {RemoteDeviceStore,RemoteDevice} from '../remote/device-store';
import type {RemoteConnection,RemoteClientHandle} from '../remote/remote-session-hub';
import type {RemoteServerMessage,RemoteSessionSummary,ShellRelease} from '../../shared/remote-types';
import {REMOTE_CLOSE,parseRemoteClientMessage} from '../../shared/remote-types';
import type {V2HostState} from '../../shared/v2-api';
import {observedTerminals,remoteSessionId,resolveRemoteSession} from '../v2/observed-terminals';
import {hostSessionView} from '../v2/worker-gateway';
import type {MobileAttentionStore} from '../remote/mobile-attention-store';
import type {ExecutionCatalog} from '../../shared/execution-catalog';

interface Options {
  client:HostClient;devices:Pick<RemoteDeviceStore,'verify'|'touch'|'hostId'>;
  hostId:string;hostName:string;snapshot():Promise<V2HostState>;shellLatest?:()=>ShellRelease|null;
  attention?:MobileAttentionStore;catalog?:()=>Promise<ExecutionCatalog>;
}
interface Viewer {connection:RemoteConnection;device:RemoteDevice|null;ready:boolean;closed:boolean;timer:ReturnType<typeof setTimeout>;terminals:Map<string,HostTerminalSocket>;requests:Set<string>;queued:number}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[\w-]{1,128}$/.test(value);
const terminalFields:Record<string,string[]>={snapshot:[],takeOwnership:[],releaseOwnership:[],input:['data'],resize:['cols','rows','cellWidthPx','cellHeightPx'],scroll:['delta']};

/** A phone connects directly to this PC. Owner credentials stay in this process;
 * each viewed pane has its own authenticated socket and explicit control owner. */
export class HostMobileHub {
  private viewers=new Set<Viewer>();
  private state:V2HostState={tasks:[],terminals:[],hosts:[],observedAt:null,connected:false};
  private watch!:HostTerminalSocket;
  private reconnect?:ReturnType<typeof setTimeout>;
  private disposed=false;
  private authenticationEpoch=0;
  private stateQueue:Promise<unknown>=Promise.resolve();
  private sessions:RemoteSessionSummary[]=[];
  private projects=new Map<string,ExecutionCatalog['repositories'][number]>();
  private observationKeys=new Map<string,string>();
  constructor(private readonly options:Options){this.observe();}
  private observe(){
    if(this.disposed)return;
    this.watch=this.options.client.watch(event=>{
      if(!object(event))return;
      if(event.type==='state'&&Array.isArray(event.tasks)&&Array.isArray(event.terminals)){
        void this.acceptState({tasks:event.tasks,terminals:event.terminals,hosts:Array.isArray(event.hosts)?event.hosts:[],observedAt:typeof event.observedAt==='number'?event.observedAt:Date.now(),connected:true}).catch(()=>{for(const viewer of this.viewers)this.drop(viewer,REMOTE_CLOSE.retry,'Attention state unavailable');});
      }else if(event.type==='disconnected'){
        for(const viewer of this.viewers)this.drop(viewer,REMOTE_CLOSE.retry,'Host observation unavailable');
        this.watch.close();clearTimeout(this.reconnect);
        this.reconnect=setTimeout(()=>this.observe(),1000);this.reconnect.unref?.();
      }
    });
  }
  private send(viewer:Viewer,message:RemoteServerMessage){
    if(viewer.closed)return;
    if((viewer.connection.bufferedAmount?.()??0)>4*1024*1024){this.drop(viewer,REMOTE_CLOSE.retry,'Viewer too slow');return;}
    viewer.connection.send(message);
  }
  private async summaries(state:V2HostState):Promise<RemoteSessionSummary[]>{
    return Promise.all(observedTerminals(state).map(async terminal=>{
      const session=hostSessionView(terminal),notice=terminal.taskNotice;
      const status=notice?(notice.kind==='approval'?'awaiting-approval':'awaiting-input'):session.status;
      const previous=this.sessions.find(item=>item.id===session.id);
      const signature=JSON.stringify([terminal.connected,terminal.status,notice]);
      const attention=previous&&this.observationKeys.get(session.id)===signature?previous.attention:await this.options.attention?.observe(session.id,status,notice?.unread===false,notice?JSON.stringify([notice.questionIds,notice.resultIds]):undefined);
      const repository=session.projectId?this.projects.get(session.projectId):undefined;
      return {id:session.id,kind:session.kind,projectId:repository?.projectId??session.projectId,projectName:repository?.projectName??repository?.name??session.remote?.name??session.projectId,label:session.kind,cwd:session.cwd,
        ...(repository?{projectRootPath:repository.path}:{}),status,updatedAt:session.updatedAt,...(attention?{attention}:{})};
    }));
  }
  private publish(viewer:Viewer){this.send(viewer,{type:'v2-state',state:this.state});this.send(viewer,{type:'sessions',sessions:this.sessions});}
  private acceptState(state:V2HostState):Promise<void>{
    const next=this.stateQueue.then(async()=>{
      if(this.disposed||(state.observedAt??0)<(this.state.observedAt??0))return;
      const prior=new Map(this.sessions.map(session=>[session.id,session]));
      this.sessions=await this.summaries(state);this.state=state;
      this.observationKeys=new Map(observedTerminals(state).map(terminal=>[terminal.id,JSON.stringify([terminal.connected,terminal.status,terminal.taskNotice])]));
      for(const viewer of this.viewers)if(viewer.ready){
        this.publish(viewer);
        for(const session of this.sessions){const old=prior.get(session.id);
          if(!old||old.status!==session.status||old.attention?.generation!==session.attention?.generation)this.send(viewer,{type:'status',sessionId:session.id,status:session.status,attention:session.attention,presence:'away'});
          else if(session.attention&&old?.attention?.seenThrough!==session.attention.seenThrough)this.send(viewer,{type:'seen',sessionId:session.id,attention:session.attention});
        }
      }
    });this.stateQueue=next.catch(()=>{});return next;
  }
  open(connection:RemoteConnection):RemoteClientHandle{
    const viewer:Viewer={connection,device:null,ready:false,closed:false,timer:setTimeout(()=>this.drop(viewer,REMOTE_CLOSE.retry,'Hello timeout'),10000),terminals:new Map(),requests:new Set(),queued:0};
    viewer.timer.unref?.();this.viewers.add(viewer);let queue=Promise.resolve();
    return {receive:raw=>{
      if(viewer.closed)return;
      if(Buffer.byteLength(raw)>65536||++viewer.queued>128){this.drop(viewer,REMOTE_CLOSE.retry,'Request limit');return;}
      queue=queue.then(()=>this.handle(viewer,raw)).catch(()=>{if(!viewer.ready)this.drop(viewer,REMOTE_CLOSE.retry,'Host initialization unavailable');else this.send(viewer,{type:'error',code:'failed',message:'요청을 처리할 수 없습니다. 연결과 선택한 작업을 확인하세요.'});}).finally(()=>{viewer.queued--;});
    },closed:()=>this.drop(viewer)};
  }
  private async handle(viewer:Viewer,raw:string){
    if(viewer.closed)return;
    let message:unknown;try{message=JSON.parse(raw);}catch{return this.send(viewer,{type:'error',code:'bad-message',message:'잘못된 메시지입니다.'});}
    if(!object(message))return;
    if(!viewer.device){
      const hello=parseRemoteClientMessage(raw);
      if(hello?.type!=='hello'){this.drop(viewer,REMOTE_CLOSE.unauthorized,'Pairing required');return;}
      if(hello.protocolVersion!==1){this.drop(viewer,REMOTE_CLOSE.protocol,'Unsupported protocol');return;}
      const epoch=this.authenticationEpoch;
      const device=await this.options.devices.verify(hello.token);if(viewer.closed)return;
      if(epoch!==this.authenticationEpoch){this.drop(viewer,REMOTE_CLOSE.retry,'Pairing changed during authentication');return;}
      if(!device){this.drop(viewer,REMOTE_CLOSE.unauthorized,'Invalid pairing');return;}
      viewer.device=device;clearTimeout(viewer.timer);await this.options.devices.touch(device.deviceId);
      const hostId=await this.options.devices.hostId();if(viewer.closed)return;
      const catalog=await this.options.catalog?.();if(catalog)this.projects=new Map(catalog.repositories.map(repo=>[repo.id,repo]));
      this.send(viewer,{type:'welcome',hostId,hostName:this.options.hostName,deviceId:device.deviceId,protocolVersion:1,shellLatest:this.options.shellLatest?.()??null,capabilities:['herdr-v2',...(this.options.attention?['session-seen-v1']:[])]});
      await this.acceptState(await this.options.snapshot());if(!viewer.closed){this.publish(viewer);viewer.ready=true;}return;
    }
    if(message.type==='list'){this.publish(viewer);return;}
    if(message.type==='attach'){
      if(!identifier(message.sessionId)||!observedTerminals(this.state).some(session=>session.id===message.sessionId))throw new Error('Unknown session');
      const sessionId=message.sessionId;if(viewer.terminals.has(sessionId))return;
      if(viewer.terminals.size>=15)throw new Error('Too many viewed sessions');
      const terminal=this.options.client.terminalSocket(sessionId,event=>{
        // Native image content already travels inside bounded JSON surface frames.
        if(event instanceof Uint8Array)return;
        this.send(viewer,{type:'v2-terminal',sessionId,event});
      },error=>this.send(viewer,{type:'v2-terminal',sessionId,event:{type:'error',message:error}}));
      viewer.terminals.set(sessionId,terminal);return;
    }
    if(message.type==='detach'){
      if(!identifier(message.sessionId))return;viewer.terminals.get(message.sessionId)?.close();viewer.terminals.delete(message.sessionId);return;
    }
    if(message.type==='seen'){
      if(!identifier(message.sessionId)||!viewer.terminals.has(message.sessionId)||!this.options.attention||!Number.isSafeInteger(message.generation)||Number(message.generation)<0)throw new Error('Seen requires an attached terminal');
      const sessionId=message.sessionId,generation=Number(message.generation);
      const next=this.stateQueue.then(async()=>{
        if(viewer.closed||!viewer.terminals.has(sessionId))return;
        const attention=await this.options.attention!.seen(sessionId,generation);
        this.sessions=this.sessions.map(session=>session.id===sessionId?{...session,attention}:session);
        for(const connected of this.viewers)if(connected.ready)this.send(connected,{type:'seen',sessionId,attention});
      });this.stateQueue=next.catch(()=>{});await next;return;
    }
    if(message.type==='v2-terminal'){
      const command=message.command;
      if(!identifier(message.sessionId)||!object(command)||typeof command.type!=='string'||!Object.hasOwn(terminalFields,command.type)||Object.keys(command).some(key=>key!=='type'&&!terminalFields[command.type as string].includes(key)))throw new Error('Invalid terminal command');
      const terminal=viewer.terminals.get(message.sessionId);if(!terminal)throw new Error('Terminal is not attached');terminal.send(command);return;
    }
    if(message.type==='v2-request'){
      if(!identifier(message.requestId)||typeof message.operation!=='string'||!Array.isArray(message.args))throw new Error('Invalid request');
      const requestId=message.requestId;
      // Never execute a repeated request ID. Disconnect makes delivery unknown;
      // the client fails pending commands instead of replaying them.
      if(viewer.requests.has(requestId)||viewer.requests.size>=10000){this.drop(viewer,REMOTE_CLOSE.retry,'Duplicate or exhausted request identity');return;}
      viewer.requests.add(requestId);
      try{
        let value:unknown;
        if(message.operation==='hostState')value=this.state;
        else if(message.operation==='listTerminals')value=observedTerminals(this.state);
        else if(message.operation==='terminalViewId'){
          const [sessionId,hostId]=message.args;if(!identifier(sessionId)||!identifier(hostId))throw new Error('Invalid terminal identity');
          if(hostId===this.options.hostId)value=sessionId;
          else{value=remoteSessionId(hostId,sessionId);resolveRemoteSession(this.state.hosts??[],value as string);}
        }else value=await mobileOperation(this.options.client,this.options.hostId,message.operation,message.args);
        this.send(viewer,{type:'v2-reply',requestId,value});
      }catch(error){this.send(viewer,{type:'v2-reply',requestId,error:error instanceof Error?error.message:'작업 요청에 실패했습니다.'});}
      return;
    }
    this.send(viewer,{type:'error',code:'bad-message',message:'이 호스트에서 지원하지 않는 요청입니다.'});
  }
  private drop(viewer:Viewer,code?:number,reason=''){
    if(viewer.closed)return;viewer.closed=true;clearTimeout(viewer.timer);
    for(const terminal of viewer.terminals.values())terminal.close();viewer.terminals.clear();this.viewers.delete(viewer);
    if(code)viewer.connection.close(code,reason);
  }
  disconnectDevice(id:string){this.authenticationEpoch++;for(const viewer of this.viewers)if(viewer.device?.deviceId===id)this.drop(viewer,REMOTE_CLOSE.revoked,'Pairing revoked');}
  dispose(){this.disposed=true;clearTimeout(this.reconnect);this.watch.close();for(const viewer of this.viewers)this.drop(viewer,1001,'Host shutting down');}
}
