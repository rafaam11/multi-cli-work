import {useEffect,useRef,useState} from 'react';
import type {McwV2Api} from '@shared/v2-api';
import type {RecoveryStatus,RecoveryPhase} from '@shared/recovery-types';
import {errorMessage} from '../ipc-error';
import './recovery-settings.css';
const phaseLabel:Record<RecoveryPhase,string>={starting:'복구 실행기를 시작하는 중입니다.',holding:'새 작업 접수를 멈추고 있습니다.', 'waiting-work':'관련 작업이 마무리되기를 기다립니다.', 'waiting-gui':'작업 확인을 마쳤습니다. 앱을 종료하고 독립 실행기에서 복귀를 계속합니다.', 'stopping-host':'호스트의 정상 종료를 확인합니다.',preserving:'v2 데이터와 결과를 보존하고 v1 복원을 준비합니다.',installing:'원본 v1.55.1을 설치합니다.', 'verifying-install':'설치 버전을 확인하고 v1 데이터를 복원합니다.', 'clearing-updater':'예약된 업데이트를 정리합니다.',launching:'복원한 v1.55.1을 실행합니다.',complete:'v1.55.1 복귀를 마쳤습니다.',cancelled:'복귀를 취소했습니다.',failed:'복귀를 보류했습니다. 기록을 확인하세요.'};
export function RecoverySettings({api}:{api:McwV2Api}){
  const [status,setStatus]=useState<RecoveryStatus|null>(null),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
  const epoch=useRef(0),working=useRef(false);
  useEffect(()=>{let active=true;const read=async()=>{if(working.current)return;const current=++epoch.current;try{const value=await api.recoveryStatus();if(active&&current===epoch.current)setStatus(value);}catch(error){if(active&&current===epoch.current)setError(errorMessage(error));}};void read();const timer=setInterval(()=>void read(),1000);return()=>{active=false;clearInterval(timer);epoch.current++;};},[api]);
  const action=async(operation:()=>Promise<RecoveryStatus>)=>{if(working.current)return;working.current=true;epoch.current++;setBusy(true);setError('');try{setStatus(await operation());setConfirm(false);}catch(error){setError(errorMessage(error));}finally{working.current=false;setBusy(false);}};
  const operation=status?.operation,canStart=status?.available&&(!operation||['complete','cancelled'].includes(operation.phase));
  return <section className="recovery-settings" aria-label="v1.55.1 복귀">
    <h3>v1.55.1로 돌아가기</h3>
    <p>업데이트 전 v1 데이터로 복원합니다. v2 기록·결과, Git 코드와 worktree, Claude·Codex 대화는 보존합니다.</p>
    <p>진행 중인 작업을 마치거나 직접 중지한 뒤 복귀할 수 있습니다. 원격 상태를 확인할 수 없으면 복귀를 보류합니다.</p>
    {status?.reason&&<p>{status.reason}</p>}
    {status&&<p className="settings-hint" style={{overflowWrap:'anywhere'}}>고정 복구본: {status.backupDirectory}</p>}
    {operation&&<div role="status"><p>{phaseLabel[operation.phase]}</p>{operation.observations.length>0&&<ul>{operation.observations.map(host=><li key={host.hostId}>{host.hostId}: {host.state==='unknown'?'상태를 확인할 수 없음':host.state==='running'?'작업 진행 중':host.state==='stopped'?'종료 확인':'작업 정리 확인'}</li>)}</ul>}{operation.error&&<p>{operation.error}</p>}{operation.needsInspection&&<p>설치 또는 데이터 복원이 중단되었습니다. 보존된 기록을 확인하기 전에는 새 복귀를 시작할 수 없습니다.</p>}</div>}
    {error&&<p role="alert">{error}</p>}
    {canStart&&!confirm&&<button type="button" disabled={busy||!api.beginRecovery} onClick={()=>setConfirm(true)}>v1.55.1로 돌아가기</button>}
    {canStart&&confirm&&<div role="group" aria-label="복귀 내용 확인"><p>새 작업 접수를 멈추고, 관련 작업이 모두 정리되면 앱과 호스트를 종료합니다. 원본 설치본으로 복귀한 뒤 자동 업데이트·세션 재개·레포 동기화를 끈 상태로 v1을 엽니다.</p><button type="button" disabled={busy} onClick={()=>void action(()=>api.beginRecovery!())}>새 작업 접수를 멈추고 복귀 준비</button><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>닫기</button></div>}
    {operation?.canCancel&&<button type="button" disabled={busy||!api.cancelRecovery} onClick={()=>void action(()=>api.cancelRecovery!())}>복귀 취소 · 접수 제한 해제</button>}
    {api.openRecovery&&<button type="button" onClick={()=>{void api.openRecovery!().catch(error=>setError(errorMessage(error)));}}>복구 파일·기록 열기</button>}
  </section>;
}
