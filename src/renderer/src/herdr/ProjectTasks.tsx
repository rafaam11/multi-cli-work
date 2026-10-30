import {useEffect,useState} from 'react';
import type {WorkProject,WorkProjectHostProject} from '@shared/work-project-types';
import type {McwV2Api} from '@shared/v2-api';
import type {ExecutionHost} from '@shared/execution-catalog';
import {TaskPanel} from './TaskPanel';
import {errorMessage} from '../ipc-error';

interface Props {project:WorkProject;defaultCwd:string;api?:McwV2Api;onLinksChange(links:WorkProjectHostProject[]):Promise<void>;onOpenTerminal?(id:string):void}
/** Association changes are explicit metadata edits. They neither launch agents
 * nor change the remote project, its repository or its existing task ownership. */
export function ProjectTasks({project,defaultCwd,api=window.mcwV2,onLinksChange,onOpenTerminal}:Props){
  const [hostId,setHostId]=useState(''),[hosts,setHosts]=useState<ExecutionHost[]>([]);
  const [projects,setProjects]=useState<{id:string;name:string}[]>([]),[selected,setSelected]=useState('');
  const [pending,setPending]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
  const links=project.hostProjects??[],link=links.find(item=>item.hostId===hostId);
  const host=hosts.find(item=>item.hostId===hostId),connected=host?.connected===true;
  useEffect(()=>{
    let live=true,revision=0;const off=api?.onState?.(state=>{if(live&&state.hosts){revision++;setHosts(state.hosts.map(item=>({hostId:item.hostId,name:item.name,connected:state.connected&&item.enabled&&item.connected})));}});
    void api?.executionHosts?.().then(value=>{if(live&&revision===0)setHosts(value);}).catch(cause=>{if(live)setError(errorMessage(cause));});
    return()=>{live=false;off?.();};
  },[api]);
  useEffect(()=>{
    let live=true;setProjects([]);setSelected('');setError(null);setLoading(!!hostId&&connected);
    if(hostId&&connected&&api?.executionCatalog)void api.executionCatalog(hostId).then(catalog=>{
      if(!live)return;
      const values=new Map<string,string>();for(const repo of catalog.repositories)if(repo.projectId)values.set(repo.projectId,repo.projectName??repo.projectId);
      setProjects([...values].map(([id,name])=>({id,name})));
    }).catch(cause=>{if(live)setError(errorMessage(cause));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[api,hostId,connected]);
  const save=async(remove=false)=>{
    const remote=projects.find(item=>item.id===selected);
    if(pending||(!remove&&(!connected||!remote)))return;
    setPending(true);setError(null);
    try{await onLinksChange([...links.filter(item=>item.hostId!==hostId),...remove?[]:[{hostId,projectId:remote!.id,projectName:remote!.name}]]);}
    catch(cause){setError(errorMessage(cause));}finally{setPending(false);}
  };
  const options=[...hosts,...links.filter(item=>!hosts.some(host=>host.hostId===item.hostId)).map(item=>({hostId:item.hostId,name:item.hostId,connected:false}))];
  return <section aria-label="프로젝트 작업 PC">
    <div className="herdr-task-owner">
      <label>대표 실행 PC <select aria-label="대표 실행 PC" value={hostId} disabled={pending} onChange={event=>setHostId(event.target.value)}>
        <option value="">이 PC</option>{options.map(item=><option key={item.hostId} value={item.hostId}>{item.name}{item.connected?'':' · 연결 끊김'}</option>)}
      </select></label>
      {hostId&&<span>{link?`연결된 프로젝트: ${projects.find(item=>item.id===link.projectId)?.name??link.projectName}`:'이 PC에서 함께 관리할 원격 프로젝트를 선택하세요.'}</span>}
    </div>
    {error&&<p role="alert" className="herdr-task-error">{error}</p>}
    {hostId&&<details key={hostId} className="herdr-task-association" open={!link}>
      <summary>원격 프로젝트 연결</summary>
      <div className="herdr-task-owner">
        <label>연결할 원격 프로젝트 <select aria-label="연결할 원격 프로젝트" value={selected} disabled={!connected||loading||pending} onChange={event=>setSelected(event.target.value)}>
          <option value="">{loading?'불러오는 중…':'프로젝트 선택'}</option>{projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <button type="button" disabled={pending||!connected||!selected} onClick={()=>void save()}>프로젝트 연결</button>
        {link&&<button type="button" disabled={pending} onClick={()=>void save(true)}>연결 해제</button>}
      </div>
      <p className="herdr-task-hint">연결과 해제는 이 PC의 분류만 변경합니다. 원격 작업과 변경·결과는 보존됩니다.</p>
    </details>}
    {(!hostId||link)&&<TaskPanel key={`${hostId}:${link?.projectId??project.id}`} api={api} projectId={hostId?link!.projectId:project.id} hostId={hostId||undefined} hostName={host?.name??hostId} defaultCwd={hostId?'':defaultCwd} onOpenTerminal={onOpenTerminal}/>}
  </section>;
}
