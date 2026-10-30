import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {assertDisposableRunner} from '../scripts/recovery/disposable-runner.mjs';
import {run,ORIGINAL_INSTALLERS,type InstallPlatform} from './recovery-install-fixture';

/** Deliberately confined to disposable CI; the runner agent is never blocked. */
export async function requireOfflineRecovery(options:{platform:InstallPlatform;assetsDirectory:string;executable:string;candidate:string}){
  assertDisposableRunner();const rules:string[]=[];
  const powershell=(command:string,env:NodeJS.ProcessEnv={})=>run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{env:{...process.env,...env},windowsHide:true,timeout:30000});
  const restore=async()=>{for(const name of rules.splice(0))await powershell('Remove-NetFirewallRule -Name $env:MCW_RECOVERY_RULE -ErrorAction Stop',{MCW_RECOVERY_RULE:name});};
  try{
    if(options.platform==='win32'){
      for(const program of [path.join(options.assetsDirectory,'recovery-node.exe'),path.join(options.assetsDirectory,ORIGINAL_INSTALLERS.win32.filename),options.executable,options.candidate]){
        const name=`mcw-recovery-fixture-${randomUUID()}`;
        await powershell('New-NetFirewallRule -Name $env:MCW_RECOVERY_RULE -DisplayName $env:MCW_RECOVERY_RULE -Program $env:MCW_RECOVERY_PROGRAM -Direction Outbound -Action Block -Profile Any -Enabled True -ErrorAction Stop | Out-Null',{MCW_RECOVERY_RULE:name,MCW_RECOVERY_PROGRAM:program});rules.push(name);
      }
    }else if(process.env.MCW_NETWORK_ISOLATED!=='1')throw new Error('Linux original-installer roundtrip must run inside its isolated network namespace');
    const runtime=path.join(options.assetsDirectory,options.platform==='win32'?'recovery-node.exe':'recovery-node');
    const result=await run(runtime,['-e',"fetch('https://github.com',{signal:AbortSignal.timeout(2500)}).then(()=>{console.error('Unexpected internet access');process.exitCode=1}).catch(()=>process.stdout.write('offline'))"],{windowsHide:true,timeout:10000});
    expect(result.stdout).toBe('offline');
    return {restore,evidence:options.platform==='win32'?'Outbound firewall block on recovery Node, original installer, installed application and candidate installer; network probe failed as required.':'Isolated Linux network namespace with loopback only; network probe failed as required.'};
  }catch(error){await restore();throw error;}
}
