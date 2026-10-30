import type {RemoteClient} from './remote-client';
import type {McwV2Api,V2HostState} from '@shared/v2-api';

/** RPC IDs are connection-local. No work command is replayed after timeout/loss. */
export function createMobileV2Api(client:RemoteClient){
  let sequence=0,disposed=false;
  const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const terminals=new Map<string,Set<(event:unknown)=>void>>(),listeners=new Set<(state:V2HostState)=>void>();
  let latest:V2HostState={tasks:[],terminals:[],hosts:[],connected:false,observedAt:null};
  const fail=(message:string)=>{for(const operation of pending.values()){clearTimeout(operation.timer);operation.reject(new Error(message));}pending.clear();};
  const request=<T>(operation:string,args:unknown[]=[]):Promise<T>=>{
    if(disposed||client.state()!=='open')return Promise.reject(new Error('PC에 연결된 뒤 다시 시도하세요.'));
    const requestId=`mobile-${++sequence}`;
    return new Promise<T>((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('응답이 늦습니다. 작업의 전달 여부를 확인하세요. 자동 재전송하지 않습니다.'));},65000);
      pending.set(requestId,{resolve,reject,timer});
      if(!client.send({type:'v2-request',requestId,operation,args})){clearTimeout(timer);pending.delete(requestId);reject(new Error('연결이 끊겨 전달 여부를 확인할 수 없습니다.'));}
    });
  };
  const offMessage=client.onMessage(message=>{
    if(message.type==='v2-reply'){
      const operation=pending.get(message.requestId);if(!operation)return;
      clearTimeout(operation.timer);pending.delete(message.requestId);if(message.error)operation.reject(new Error(message.error));else operation.resolve(message.value);
    }else if(message.type==='v2-state'){
      latest=message.state;for(const listener of listeners)listener(latest);
    }else if(message.type==='v2-terminal')for(const listener of terminals.get(message.sessionId)??[])listener(message.event);
  });
  const offState=client.onState(state=>{
    if(state==='open'){for(const sessionId of terminals.keys())client.send({type:'attach',sessionId});return;}
    fail('PC 연결이 끊겼습니다. 작업의 전달 여부를 확인하세요. 자동 재전송하지 않습니다.');
    latest={...latest,connected:false};for(const listener of listeners)listener(latest);
    for(const subscription of terminals.values())for(const listener of subscription)listener({type:'disconnected',observedAt:latest.observedAt});
  });
  const unavailable=async()=>{throw new Error('등록된 프로필과 저장소를 선택해 작업을 시작하세요.');};
  const api:McwV2Api={version:2,enabled:async()=>true,
    configuration:()=>request('configuration'),listTasks:(...args)=>request('listTasks',args),createTask:(...args)=>request('createTask',args),
    inspectTask:(...args)=>request('inspectTask',args),taskAction:(...args)=>request('taskAction',args),executionCatalog:(...args)=>request('executionCatalog',args),
    executionHosts:(...args)=>request('executionHosts',args),workerCatalog:(...args)=>request('workerCatalog',args),inspectHostRepository:(...args)=>request('inspectHostRepository',args),
    inspectWorkerRepository:(...args)=>request('inspectWorkerRepository',args),startRegisteredTask:(...args)=>request('startRegisteredTask',args),terminalViewId:(...args)=>request('terminalViewId',args),
    hostState:()=>request('hostState'),listTerminals:()=>request('listTerminals'),onState:listener=>{listeners.add(listener);return ()=>{listeners.delete(listener);};},
    startTask:unavailable,repositoryHead:unavailable,createTerminal:unavailable,recoveryStatus:async()=>{throw new Error('복귀는 PC에서 진행하세요.');},
    subscribeTerminal:(sessionId,listener)=>{
      let subscription=terminals.get(sessionId);if(!subscription){subscription=new Set();terminals.set(sessionId,subscription);if(client.state()==='open')client.send({type:'attach',sessionId});}
      subscription.add(listener);return ()=>{subscription!.delete(listener);if(!subscription!.size){terminals.delete(sessionId);client.send({type:'detach',sessionId});}};
    },
    terminalCommand:async(sessionId,command)=>{if(disposed||!client.send({type:'v2-terminal',sessionId,command}))throw new Error('터미널 연결이 끊겼습니다. 입력을 자동 재전송하지 않습니다.');},
  };
  return {api,stopTerminal:(id:string)=>request<void>('stopTerminal',[id]),dispose:()=>{disposed=true;offMessage();offState();fail('화면을 닫았습니다. 전달 여부가 불명확한 작업을 자동 재전송하지 않습니다.');for(const sessionId of terminals.keys())client.send({type:'detach',sessionId});terminals.clear();listeners.clear();}};
}
