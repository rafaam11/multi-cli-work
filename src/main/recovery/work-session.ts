import type {RecoveryHostObservation} from '../../shared/recovery-types';
import type {RecoveryHold} from './work-holds';

export interface RecoveryScope {hostId:string;instanceId:string;holdId:string;taskIds:string[]|null}
export interface RecoveryClient {request(route:string,method?:string,input?:unknown,timeoutMs?:number):Promise<any>}
interface Options {
  operationId:string;localHostId:string;expectedHostIds:string[];
  client(hostId:string):Promise<RecoveryClient>;
  /** Persist outside the data roots before any hold is dispatched. */
  save(scopes:RecoveryScope[]):Promise<void>;
  scopes?:RecoveryScope[];
  checkCancelled?():Promise<void>;
}
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[\w-]{1,200}$/.test(value);
export function validateRecoveryScopes(scopes:RecoveryScope[]):void{
  if(!Array.isArray(scopes)||scopes.length>33||new Set(scopes.map(scope=>scope.hostId)).size!==scopes.length||scopes.some(scope=>!scope||!validId(scope.hostId)||!validId(scope.instanceId)||!validId(scope.holdId)||(scope.taskIds!==null&&(!Array.isArray(scope.taskIds)||!scope.taskIds.length||scope.taskIds.some(id=>!validId(id))||new Set(scope.taskIds).size!==scope.taskIds.length))))throw new Error('Invalid recovery scopes');
}
/** Holds admit no new work. They neither cancel work nor transfer its ownership. */
export class RecoveryWorkSession {
  readonly scopes:RecoveryScope[];
  constructor(private readonly options:Options){
    if(!validId(options.operationId)||!validId(options.localHostId)||!options.expectedHostIds.includes(options.localHostId)||new Set(options.expectedHostIds).size!==options.expectedHostIds.length||options.expectedHostIds.some(id=>!validId(id)))throw new Error('Invalid recovery host inventory');
    this.scopes=structuredClone(options.scopes??[]);validateRecoveryScopes(this.scopes);
    if(this.scopes.some(scope=>scope.holdId!==options.operationId||!options.expectedHostIds.includes(scope.hostId)))throw new Error('Recovery scope differs from operation');
  }
  private async health(hostId:string){
    const client=await this.options.client(hostId),health=await client.request('/health','GET',undefined,5000);
    if(health?.schemaVersion!==2||health.hostId!==hostId||!validId(health.instanceId))throw new Error('Recovery host identity differs');
    return {client,instanceId:health.instanceId};
  }
  private matches(hold:RecoveryHold|null,scope:RecoveryScope):boolean{
    return !!hold&&hold.id===scope.holdId&&hold.requesterHostId===this.options.localHostId&&hold.releasedAt===null&&JSON.stringify(hold.taskIds)===JSON.stringify(scope.taskIds);
  }
  private async hold(hostId:string,taskIds:string[]|null):Promise<void>{
    await this.options.checkCancelled?.();
    const {client,instanceId}=await this.health(hostId);
    if(this.scopes.some(scope=>scope.hostId===hostId))throw new Error('Recovery hold was already dispatched; inspect or cancel this operation');
    const scope={hostId,instanceId,holdId:this.options.operationId,taskIds:taskIds?[...taskIds].sort():null};
    this.scopes.push(scope);await this.options.save(structuredClone(this.scopes));
    let result:RecoveryHold|null;
    try{result=await client.request('/recovery/holds','POST',{id:scope.holdId,requesterHostId:this.options.localHostId,taskIds:scope.taskIds},5000);}
    catch{result=await client.request(`/recovery/holds/${scope.holdId}`,'GET',undefined,5000);}
    if(!this.matches(result,scope))throw new Error('Recovery hold was not confirmed; no command was replayed');
  }
  async stopNewWork():Promise<void>{
    if(this.scopes.length)throw new Error('Recovery already started; inspect or cancel it before another attempt');
    await this.hold(this.options.localHostId,null);
    const {client,instanceId}=await this.health(this.options.localHostId),plan=await client.request('/recovery-plan','GET',undefined,15000);
    if(instanceId!==this.scopes[0].instanceId||plan?.hostId!==this.options.localHostId||plan.instanceId!==instanceId||!Array.isArray(plan.related)||plan.related.some((item:any)=>!item||!validId(item.hostId)||!Array.isArray(item.taskIds)||!item.taskIds.length||item.taskIds.some((id:unknown)=>!validId(id)))||plan.related.some((item:any)=>!this.options.expectedHostIds.includes(item.hostId)))throw new Error('Recovery host inventory changed; inspect and cancel before retrying');
    for(const host of plan.related)await this.hold(host.hostId,host.taskIds);
    // A finished task may no longer need its old PC. The caller still observes
    // every original scope: unexplained missing observations never count as ready.
  }
  async observeHosts(localStopped?:()=>Promise<void>):Promise<RecoveryHostObservation[]>{
    const result:RecoveryHostObservation[]=[];
    for(const hostId of this.options.expectedHostIds){
      let state:RecoveryHostObservation['state']='unknown';
      try{
        const scope=this.scopes.find(item=>item.hostId===hostId);if(!scope)throw new Error('Missing recovery scope');
        if(hostId===this.options.localHostId&&localStopped){await localStopped();state='stopped';}
        else{
          const {client,instanceId}=await this.health(hostId);if(instanceId!==scope.instanceId)throw new Error('Host restarted during recovery');
          const check=await client.request(`/recovery/holds/${scope.holdId}/readiness`,'GET',undefined,15000);
          if(check?.hostId!==hostId||check.instanceId!==instanceId||check.holdActive!==true||!Number.isFinite(check.checkedAt)||check.checkedAt>Date.now()||Date.now()-check.checkedAt>30000)throw new Error('Recovery observation unavailable');
          state=check.ready===true?'completed':'running';
        }
      }catch{state='unknown';}
      result.push({hostId,state,observedAt:Date.now()});
    }
    return result;
  }
  async release(localRelease?:()=>Promise<void>):Promise<void>{
    const ordered=[...this.scopes.filter(scope=>scope.hostId!==this.options.localHostId),...this.scopes.filter(scope=>scope.hostId===this.options.localHostId)];
    for(const scope of ordered){
      if(scope.hostId===this.options.localHostId&&localRelease){await localRelease();continue;}
      const {client}=await this.health(scope.hostId);
      const current=await client.request(`/recovery/holds/${scope.holdId}`,'GET',undefined,5000) as RecoveryHold|null;
      if(!current)continue; // A journaled intent may never have reached this host.
      if(current.id!==scope.holdId||current.requesterHostId!==this.options.localHostId||JSON.stringify(current.taskIds)!==JSON.stringify(scope.taskIds))throw new Error('Recovery hold changed; release blocked');
      if(current.releasedAt===null)await client.request(`/recovery/holds/${scope.holdId}/release`,'POST',{requesterHostId:this.options.localHostId},5000);
    }
  }
}
