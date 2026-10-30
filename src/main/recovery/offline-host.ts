import path from 'node:path';
import {randomUUID} from 'node:crypto';
import lockfile from 'proper-lockfile';
import {TaskStore} from '../host/task-store';
import {WorkerReplicas} from '../host/worker-replicas';
import {RecoveryWorkHolds,validateRecoveryHold} from './work-holds';
import {recoveryWorkInventory,attemptNeedsObservation} from './work-inventory';
import {proveLocalProcessesStopped,type LocalProcessProofOptions} from './local-process-proof';
import {requirePlainPath} from './controller-state';
import type {RecoveryClient} from './work-session';

/** Offline authority is confined to recovery. The daemon's own runtime lock
 * excludes startup; every operation rechecks kernel exits. No task is replayed,
 * reconciled, completed or cancelled, and no remote state is inferred locally. */
export async function openOfflineRecoveryHost(options:LocalProcessProofOptions):Promise<RecoveryClient&{close():Promise<void>}>{
  await requirePlainPath(options.directory);
  let compromised=false,closed=false;
  const release=await lockfile.lock(path.join(options.directory,'mcw-host-runtime'),{realpath:false,retries:0,stale:10000,onCompromised:()=>{compromised=true;}});
  const proof=async()=>{if(compromised||closed)throw new Error('Offline recovery authority was lost');return proveLocalProcessesStopped({...options,includeGui:false});};
  try{await proof();}catch(error){await release();throw error;}
  const instanceId=`offline-${randomUUID()}`,holds=new RecoveryWorkHolds(options.directory);
  const store=new TaskStore({directory:options.directory,hostId:options.hostId}),replicas=new WorkerReplicas({directory:options.directory,hostId:options.hostId});
  const plan=async()=>{
    const sessions=await proof(),tasks=await store.listForRecovery(),workers=(await replicas.listForRecovery()).map(replica=>({...replica,pendingOperations:replica.operations.filter(operation=>!operation.acknowledged).length}));
    const attempts=tasks.flatMap(task=>task.participants.filter(member=>member.hostId===options.hostId).flatMap(member=>[member.attempt,...member.previousAttempts])).concat(workers.map(worker=>worker.attempt));
    const localReady=attempts.every(attempt=>{
      if(!attemptNeedsObservation(attempt)&&attempt.delivery!=='delivered')return true;
      const terminal=sessions.find(session=>session.id===attempt.id&&session.generation===`${attempt.id}-${attempt.generation}`);
      return !!terminal?.processes?.length;
    })&&workers.every(worker=>worker.pendingOperations===0);
    await proof();
    return {schemaVersion:1,hostId:options.hostId,instanceId,accepting:false,canShutdown:localReady,checkedAt:Date.now(),...recoveryWorkInventory(options.hostId,tasks,workers)};
  };
  return {
    close:async()=>{if(!closed){closed=true;await release();}},
    request:async(route,method='GET',input)=>{
      await proof();
      if(route==='/health'&&method==='GET')return {schemaVersion:2,hostId:options.hostId,instanceId,accepting:false};
      if(route==='/recovery-plan'&&method==='GET')return plan();
      if(route==='/recovery/holds'&&method==='POST'){
        validateRecoveryHold(input);if(input.requesterHostId!==options.hostId||input.taskIds!==null)throw new Error('Offline recovery accepts only this host admission hold');
        return holds.hold(input);
      }
      const match=/^\/recovery\/holds\/([\w-]{1,200})(\/readiness|\/release)?$/.exec(route);
      if(!match)throw new Error('Offline recovery does not execute host commands');
      const hold=await holds.get(match[1]);
      if(!match[2]&&method==='GET')return hold;
      if(match[2]==='/readiness'&&method==='GET'){
        const current=await plan();return {hostId:options.hostId,instanceId,holdActive:!!hold&&hold.releasedAt===null,ready:current.canShutdown,checkedAt:Date.now(),missingTaskIds:[]};
      }
      if(match[2]==='/release'&&method==='POST'){
        if(!input||typeof input!=='object'||Object.keys(input).join(',')!=='requesterHostId'||(input as {requesterHostId:unknown}).requesterHostId!==options.hostId)throw new Error('Offline recovery hold owner differs');
        await holds.release(match[1],options.hostId);return {released:true};
      }
      throw new Error('Offline recovery route is unavailable');
    },
  };
}
