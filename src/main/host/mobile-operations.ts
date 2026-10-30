import {HostClient,ownerTaskRoute} from './host-client';
import type {ExecutionCatalog} from '../../shared/execution-catalog';

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown)=>{if(typeof value!=='string'||!value||value==='.'||value==='..'||value.length>200||/[\x00-\x1f]/.test(value))throw new Error('Invalid identifier');return value;};
/** Paired phones get work operations, never raw host administration, executable
 * selection, capability credentials or recovery. All launches use host catalogs. */
export async function mobileOperation(client:Pick<HostClient,'request'>,localHostId:string,operation:string,args:unknown[]):Promise<unknown>{
  if(!Array.isArray(args)||args.length>4)throw new Error('Invalid mobile request');
  const owner=(value:unknown)=>{
    if(value===undefined||value===null||value===localHostId)return undefined;
    const host=id(value);ownerTaskRoute(undefined,host);return host;
  };
  const prefix=(host:unknown)=>ownerTaskRoute(undefined,owner(host)).replace(/\/tasks$/,'');
  const tasks=(task:unknown,host:unknown)=>ownerTaskRoute(task===undefined?undefined:id(task),owner(host));
  const catalog=(host:unknown)=>`${prefix(host)}/execution-catalog`;
  const workers=(worker:unknown,host:unknown)=>{
    if(worker!==undefined)ownerTaskRoute(undefined,id(worker));
    return `${prefix(host)}/worker-hosts${worker===undefined?'':`/${encodeURIComponent(id(worker))}/execution-catalog`}`;
  };
  switch(operation){
    case 'configuration':{
      const value=await client.request<ExecutionCatalog>('/execution-catalog');
      return {hostId:localHostId,launchProfiles:value.launchProfiles,defaultLaunchProfiles:value.defaultLaunchProfiles};
    }
    case 'listTasks':return client.request(tasks(undefined,args[0]));
    case 'inspectTask':return client.request(tasks(args[0],args[1]));
    case 'createTask':return client.request(`${tasks(undefined,args[1])}${owner(args[1])?'':'/registered'}`,'POST',args[0]);
    case 'executionCatalog':return client.request(catalog(args[0]));
    case 'inspectHostRepository':return client.request(`${catalog(args[1])}/repositories/${encodeURIComponent(id(args[0]))}`);
    case 'executionHosts':return client.request(workers(undefined,args[0]));
    case 'workerCatalog':return client.request(workers(id(args[0]),args[1]));
    case 'inspectWorkerRepository':return client.request(`${workers(id(args[1]),args[2])}/repositories/${encodeURIComponent(id(args[0]))}`);
    case 'startRegisteredTask':{
      const input=args[1];
      if(!object(input)||Object.keys(input).some(key=>!['repositoryId','expectedHead','expectedPath','remoteWorkers'].includes(key))||['repositoryId','expectedHead','expectedPath'].some(key=>typeof input[key]!=='string')||(input.remoteWorkers!==undefined&&!Array.isArray(input.remoteWorkers)))throw new Error('Registered checkout selection required');
      return client.request(`${tasks(args[0],args[2])}/${owner(args[2])?'start':'start-registered'}`,'POST',input);
    }
    case 'taskAction':{
      if(typeof args[1]!=='string'||!['acknowledge','answer','acknowledge-result','message','cancel'].includes(args[1])||!object(args[2]))throw new Error('Unsupported task action');
      return client.request(`${tasks(args[0],args[3])}/${args[1]}`,'POST',args[2]);
    }
    case 'stopTerminal':return client.request(`/terminals/${encodeURIComponent(id(args[0]))}`,'DELETE');
    default:throw new Error('Mobile operation is not supported');
  }
}
