import {useEffect,useRef,useState} from "react";
import type {McwV2Api} from "@shared/v2-api";
import type {ExecutionCatalog,RegisteredTaskStart} from "@shared/execution-catalog";
import {errorMessage} from "../ipc-error";

/** A foreign path is selectable metadata, never a local filesystem operation. */
export function WorkerCheckout({api,ownerHostId,workerHostId,label,base,selected,disabled,onChange}:{
  api:McwV2Api;ownerHostId?:string;workerHostId:string;label:string;base:string|null;
  selected?:RegisteredTaskStart;disabled:boolean;onChange(value:RegisteredTaskStart|null):void;
}){
  const [catalog,setCatalog]=useState<ExecutionCatalog|null>(null),[repositoryId,setRepositoryId]=useState(""),[error,setError]=useState<string|null>(null),[checking,setChecking]=useState(false);
  const [reload,setReload]=useState(0);
  const request=useRef(0);
  useEffect(()=>{
    const epoch=++request.current;setCatalog(null);setRepositoryId("");setError(null);setChecking(false);
    if(!api.workerCatalog||!api.inspectWorkerRepository){setError("원격 저장소 확인 기능이 준비되지 않았습니다.");return;}
    void api.workerCatalog(workerHostId,ownerHostId).then(value=>{if(request.current===epoch)setCatalog(value);}).catch(cause=>{if(request.current===epoch)setError(errorMessage(cause));});
    return()=>{request.current++;};
  },[api,ownerHostId,workerHostId,reload]);
  const inspect=async()=>{
    const epoch=++request.current;setChecking(true);setError(null);onChange(null);
    try{const value=await api.inspectWorkerRepository!(repositoryId,workerHostId,ownerHostId);if(epoch===request.current)onChange({repositoryId:value.repository.id,expectedPath:value.repository.path,expectedHead:value.expectedHead});}
    catch(cause){if(epoch===request.current)setError(errorMessage(cause));}
    finally{if(epoch===request.current)setChecking(false);}
  };
  return <fieldset className="herdr-task-start" disabled={disabled||checking}>
    <legend>{label} · {workerHostId}</legend>
    <label><span>저장소</span><select aria-label={`${label} 저장소`} value={repositoryId} onChange={event=>{request.current++;setChecking(false);setRepositoryId(event.target.value);onChange(null);}}>
      <option value="">원격 저장소 선택</option>{catalog?.repositories.map(repo=><option key={repo.id} value={repo.id}>{repo.projectName?`${repo.projectName} / `:""}{repo.name} · {repo.path}</option>)}
    </select></label>
    <button type="button" aria-label={`${label} 기준 커밋 확인`} disabled={!repositoryId||!catalog} onClick={()=>{void inspect();}}>기준 커밋 확인</button>
    <button type="button" onClick={()=>{onChange(null);setReload(value=>value+1);}}>저장소 목록 새로고침</button>
    {selected&&<><span>{selected.expectedPath}</span><code>{selected.expectedHead.slice(0,12)}</code></>}
    {selected&&base&&selected.expectedHead!==base&&<p role="status">대표 저장소와 기준 커밋이 다릅니다. 저장소를 직접 준비한 뒤 다시 확인하세요.</p>}
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}
