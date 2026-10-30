import {readFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createAdapter,runRecovery} from './controller';
import {readRecoveryState,writeRecoveryState,requirePlainPath,validateRecoveryRequest,recoveryControllerRunning,acquireRecoveryStart,type RecoveryRequest,type RecoveryInstallation} from './controller-state';
import {readProcessInventory} from '../herdr/process-observation';
import {openLocalRecoveryAuthority} from './local-authority';
import {verifyRecoveryAssets} from './index';
export {createAdapter};

async function main(){
  let [command,filename]=process.argv.slice(2);
  if(!['begin','rollback','cancel','status'].includes(command)||!filename||!path.isAbsolute(filename))throw new Error('Usage: recovery-controller.cjs begin|cancel|status <installation.json> | rollback|cancel|status <request.json>');
  await requirePlainPath(filename);
  if(path.basename(filename)==='installation.json'){
    const installation=JSON.parse(await readFile(filename,'utf8')) as RecoveryInstallation;
    if(installation.packaged!==true||path.dirname(filename)!==installation.recoveryRoot)throw new Error('Invalid independent recovery installation');
    await verifyRecoveryAssets(installation.assetsDirectory,installation.platform);
    let previous:{operationId:string}|null=null;try{previous=JSON.parse(await readFile(path.join(installation.recoveryRoot,'active-operation.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(previous&&!/^[-\w]{1,128}$/.test(previous.operationId))throw new Error('Invalid active recovery operation');
    if(command==='begin'){
      const release=await acquireRecoveryStart(installation.recoveryRoot);
      try{
      previous=null;try{previous=JSON.parse(await readFile(path.join(installation.recoveryRoot,'active-operation.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(previous&&!/^[-\w]{1,128}$/.test(previous.operationId))throw new Error('Invalid active recovery operation');
      if(previous){const state=await readRecoveryState(path.join(installation.recoveryRoot,'operations',previous.operationId));if(!state||!['complete','cancelled'].includes(state.phase)||state.failedAtPhase&&['installing','verifying-install','clearing-updater','launching'].includes(state.failedAtPhase))throw new Error('Inspect or cancel the existing recovery before starting another operation');}
      const authority=await openLocalRecoveryAuthority({directory:installation.hostDirectory,hostId:installation.localHostId,bridgePath:installation.bridgePath,runtimePaths:installation.runtimePaths});
      let plan:{hostId:string;related:{hostId:string}[]};try{plan=await authority.client.request('/recovery-plan');}finally{await authority.close();}
      if(plan.hostId!==installation.localHostId||!Array.isArray(plan.related))throw new Error('Recovery work inventory unavailable');
      const operationId=randomUUID(),operationDirectory=path.join(installation.recoveryRoot,'operations',operationId);await requirePlainPath(operationDirectory,true);await mkdir(operationDirectory,{recursive:true,mode:0o700});
      const request:RecoveryRequest={...installation,operationId,operationDirectory,destination:path.join(operationDirectory,'prepared'),expectedHostIds:[installation.localHostId,...plan.related.map(item=>item.hostId)],guiProcess:null};validateRecoveryRequest(request);
      filename=path.join(operationDirectory,'request.json');await writeRecoveryState(filename,request);await writeRecoveryState(path.join(operationDirectory,'state.json'),{schemaVersion:1,operationId,phase:'starting',scopes:[],observations:[],updatedAt:Date.now()});await writeRecoveryState(path.join(installation.recoveryRoot,'active-operation.json'),{operationId});
      process.stdout.write('v1.55.1 복귀를 준비합니다. 관련 작업을 마친 뒤 열려 있는 MCW 앱을 종료하세요. 상태를 확인할 수 없는 작업은 중지하지 않습니다.\n');command='rollback';
      }finally{await release();}
    }else{if(!previous)return {active:false};filename=path.join(installation.recoveryRoot,'operations',previous.operationId,'request.json');await requirePlainPath(filename);}
  }
  const request=JSON.parse(await readFile(filename,'utf8'));validateRecoveryRequest(request);
  if(path.resolve(filename)!==path.join(request.operationDirectory,'request.json'))throw new Error('Recovery request location differs');
  await verifyRecoveryAssets(request.assetsDirectory,request.platform);
  if(command==='rollback'){await runRecovery(request);return {completed:true};}
  const state=await readRecoveryState(request.operationDirectory);
  if(command==='status')return state;
  if(!state||['complete','cancelled'].includes(state.phase))throw new Error('No active recovery operation to cancel');
  const alive=recoveryControllerRunning(state,await readProcessInventory(request.bridgePath),process.execPath,process.pid);
  if(alive){
    if(!['starting','holding','waiting-work','waiting-gui'].includes(state.phase))throw new Error('Recovery is applying preserved files or installation; wait for its recorded result before cancelling holds');
    await writeRecoveryState(path.join(request.operationDirectory,'cancel.json'),{operationId:request.operationId,requestedAt:Date.now()});return {cancellationRequested:true};
  }
  const adapter=await createAdapter(request,true);try{await adapter.cancel();return {cancelled:true};}finally{await adapter.close();}
}
if(require.main===module)void main().then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')).catch(error=>{process.stderr.write(`Recovery blocked: ${error.message}\n`);process.exitCode=1;});
