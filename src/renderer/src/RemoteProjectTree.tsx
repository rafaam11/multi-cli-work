import {useEffect,useState,type ReactNode} from 'react';
import type {TerminalSessionView} from '@shared/api-types';
import type {ExecutionCatalog} from '@shared/execution-catalog';
import type {WorkProjectHostProject} from '@shared/work-project-types';
import type {McwV2Api} from '@shared/v2-api';

/** Remote identities remain scoped to their host; paths are display-only. */
export function RemoteProjectTree({links,sessions,onSelectSession,renderSession,api=window.mcwV2}:{links:WorkProjectHostProject[];sessions:TerminalSessionView[];onSelectSession(session:TerminalSessionView):void;renderSession?(session:TerminalSessionView,peers:TerminalSessionView[]):ReactNode;api?:McwV2Api}){
 const [catalogs,setCatalogs]=useState<Record<string,ExecutionCatalog>>({});
 const [errors,setErrors]=useState<Record<string,boolean>>({});
 const key=JSON.stringify(links.map(link=>link.hostId));
 const connectionKey=JSON.stringify(links.map(link=>sessions.some(session=>session.remote?.hostId===link.hostId&&session.remote.connected)));
 useEffect(()=>{let live=true;const hosts=JSON.parse(key) as string[];
  for(const hostId of hosts)if(api?.executionCatalog)void api.executionCatalog(hostId).then(catalog=>{if(live){setCatalogs(current=>({...current,[hostId]:catalog}));setErrors(current=>({...current,[hostId]:false}));}}).catch(()=>{if(live)setErrors(current=>({...current,[hostId]:true}));});
  return()=>{live=false;};
 },[api,key,connectionKey]);
 if(!links.length)return null;
 return <ul className="project-group remote-project-tree" aria-label="원격 프로젝트 세션">{links.map(link=>{
  const remote=sessions.filter(session=>session.remote?.hostId===link.hostId),catalog=catalogs[link.hostId];
  const cached=[...new Map(remote.flatMap(session=>{const repo=session.remote?.repository;return repo&&repo.id===session.remote?.projectId?[[repo.id,repo] as const]:[];})).values()];
  const repositories=catalog?.repositories??cached;
  return <li key={link.hostId}><details open><summary>{remote[0]?.remote?.name??link.hostId} · {link.projectName}</summary>
   {errors[link.hostId]&&<span>원격 저장소 연결 끊김 · 마지막 확인 내용</span>}
   <ul>{repositories.filter(repo=>repo.projectId===link.projectId).map(repo=>{
    const matched=remote.filter(session=>session.remote?.projectId===repo.id),paths=[...new Set(matched.map(session=>session.cwd))];
    return <li key={repo.id}><details open><summary title={repo.path}>{repo.name}</summary><ul>{paths.map(cwd=><li key={cwd}><details open><summary title={cwd}>{cwd}</summary><ul>{matched.filter(session=>session.cwd===cwd).map(session=>renderSession?renderSession(session,matched):<li key={session.id}><button className="session-select" type="button" aria-label={`${session.remote!.sessionId} 터미널 열기`} onClick={()=>onSelectSession(session)}>{session.kind} · {session.remote!.sessionId}{session.remote!.connected?'':' · 연결 끊김'}</button></li>)}</ul></details></li>)}</ul></details></li>;
   })}</ul></details></li>;
 })}</ul>;
}
