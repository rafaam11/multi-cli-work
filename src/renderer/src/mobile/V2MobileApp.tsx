import {useEffect,useMemo,useState} from 'react';
import type {McwV2Api} from '@shared/v2-api';
import type {RemoteSessionSummary} from '@shared/remote-types';
import {RemoteClient,remoteSocketUrl,loadPairing,savePairing,clearPairing,type RemoteClientState,type StoredPairing} from './remote-client';
import {createMobileV2Api} from './v2-client';
import {readShellBridge} from './shell-bridge';
import {PairScreen} from './PairScreen';
import {SessionList} from './SessionList';
import {SessionDrawer} from './SessionDrawer';
import {TaskPanel} from '../herdr/TaskPanel';
import {HerdrTerminal} from '../herdr/HerdrTerminal';
import {createHostTransport} from '../herdr/host-transport';
import {sessionHash,sessionIdFromHash} from './wide-layout';
import {useSessionViewing} from './use-session-viewing';
import './v2-mobile.css';
const storage=()=>{try{return window.localStorage;}catch{return null;}};
function CanvasPane({api,sessionId,onReady}:{api:McwV2Api;sessionId:string;onReady:(ready:boolean)=>void}){
  const [viewer,setViewer]=useState(''),[fontSize,setFontSize]=useState(14);
  const transport=useMemo(()=>createHostTransport(api,{onIdentity:setViewer}),[api]);
  return <div className="m-v2-canvas"><div className="m-v2-font"><button onClick={()=>setFontSize(value=>Math.max(8,value-1))} aria-label="터미널 글자 작게">A−</button><button onClick={()=>setFontSize(value=>Math.min(28,value+1))} aria-label="터미널 글자 크게">A＋</button></div><HerdrTerminal sessionId={sessionId} transport={transport} viewerId={viewer} ownerId={null} fontSize={fontSize} onReady={onReady}/></div>;
}
/** Served by each host, so the latest Android shell also uses an original v1
 * host's own mobile.html after rollback. Pairing storage and origin stay stable. */
export function V2MobileApp(){
  useEffect(()=>{(window as unknown as {__mcwSessionViewingV2:boolean}).__mcwSessionViewingV2=true;},[]);
  const [bridge]=useState(()=>readShellBridge(window as unknown as {McwShell?:unknown}));
  const [pairing,setPairing]=useState<StoredPairing|null>(()=>bridge?.pairing??loadPairing(storage()));
  const [notice,setNotice]=useState<string|null>(null),[connection,setConnection]=useState<RemoteClientState>('connecting');
  const [mobile,setMobile]=useState<ReturnType<typeof createMobileV2Api>|null>(null),[sessions,setSessions]=useState<RemoteSessionSummary[]>([]);
  const [localHostId,setLocalHostId]=useState(''),[selected,setSelected]=useState<string|null>(()=>sessionIdFromHash(window.location.hash));
  const [mode,setMode]=useState<'sessions'|'terminal'|'tasks'>(()=>selected?'terminal':'sessions'),[drawer,setDrawer]=useState(false);
  const [owners,setOwners]=useState<Array<{hostId:string;name:string;connected:boolean}>>([]),[taskOwner,setTaskOwner]=useState('');
  const [client,setClient]=useState<RemoteClient|null>(null),[ready,setReady]=useState(false),[seenCapable,setSeenCapable]=useState(false);
  useSessionViewing(client,bridge,sessions.find(session=>session.id===selected)??null,ready&&mode==='terminal'&&connection==='open',drawer,seenCapable);
  const open=(id:string)=>{setSelected(id);setMode('terminal');setDrawer(false);window.history.pushState({mcw:'session'},'',sessionHash(id));};
  useEffect(()=>{const pop=()=>{const id=sessionIdFromHash(window.location.hash);setSelected(id);setMode(id?'terminal':'sessions');setDrawer(false);};window.addEventListener('popstate',pop);return ()=>window.removeEventListener('popstate',pop);},[]);
  useEffect(()=>{
    if(!pairing)return;
    const client=new RemoteClient({url:remoteSocketUrl(window.location),token:pairing.token});const next=createMobileV2Api(client);let active=true;
    const offMessage=client.onMessage(message=>{
      if(message.type==='sessions')setSessions(message.sessions);
      if(message.type==='welcome'){
        setSeenCapable(message.capabilities?.includes('session-seen-v1')??false);
        if(!message.capabilities?.includes('herdr-v2')){setNotice('호스트 버전이 바뀌었습니다. 화면을 새로 열어 주세요.');return;}
        void next.api.configuration().then(config=>{if(active){setLocalHostId(config.hostId);setTaskOwner(config.hostId);}}).catch(error=>setNotice(String(error)));
      }
      if(message.type==='v2-state')setOwners((message.state.hosts??[]).map(host=>({hostId:host.hostId,name:host.name,connected:message.state.connected&&host.enabled&&host.connected})));
      if(message.type==='error')setNotice(message.message);
      if(message.type==='seen')setSessions(current=>current.map(session=>session.id===message.sessionId?{...session,attention:message.attention}:session));
    });
    const offState=client.onState(state=>{
      setConnection(state);
      if(state==='unauthorized'){if(bridge)bridge.unpaired();else{clearPairing(storage());setPairing(null);setNotice('연결이 해제되었습니다. 다시 페어링하세요.');}}
    });
    setMobile(next);setClient(client);client.connect();
    return ()=>{active=false;offMessage();offState();next.dispose();client.close();setMobile(null);setClient(null);};
  },[pairing,bridge]);
  if(bridge&&!pairing)return <p className="m-banner">PC 목록에서 이 PC를 다시 연결하세요.</p>;
  if(!pairing)return <PairScreen notice={notice} onPaired={value=>{savePairing(storage(),value);setPairing(value);}}/>;
  const leave=()=>{if(bridge){bridge.backToHosts();return;}clearPairing(storage());setPairing(null);};
  const showTasks=()=>{setDrawer(false);setMode('tasks');};
  const list=<SessionList hostName={pairing.hostName} connection={connection} sessions={sessions} activeSessionId={selected} onOpen={open} onUnpair={leave} leaveLabel={bridge?'PC 목록':'연결 해제'} onNewSession={showTasks} newSessionLabel="작업·결과"/>;
  return <div className="m-v2-app">
    {notice&&<div className="m-banner" role="status">{notice}<button onClick={()=>setNotice(null)} aria-label="안내 닫기">×</button></div>}
    {mode==='sessions'?list:<>
      <header className="m-bar"><button onClick={()=>setDrawer(true)}>프로젝트·세션</button><h1>{pairing.hostName}</h1><button onClick={showTasks}>작업</button><button onClick={()=>setMode('sessions')} aria-label="세션 목록으로">목록</button></header>
      {connection!=='open'&&<p className="m-banner" role="status">PC 연결 끊김 · 마지막으로 받은 상태를 표시합니다.</p>}
      {mode==='terminal'&&selected&&mobile?<CanvasPane key={selected} api={mobile.api} sessionId={selected} onReady={setReady}/>:null}
      {mode==='tasks'&&mobile&&localHostId&&<div className="m-v2-tasks"><label className="m-v2-owner">대표 실행 PC<select value={taskOwner} onChange={event=>setTaskOwner(event.target.value)}><option value={localHostId}>{pairing.hostName}</option>{owners.map(owner=><option key={owner.hostId} value={owner.hostId} disabled={!owner.connected}>{owner.name}{owner.connected?'':' · 연결 끊김'}</option>)}</select></label>
        <TaskPanel key={taskOwner} api={mobile.api} hostId={taskOwner} hostName={taskOwner===localHostId?pairing.hostName:owners.find(owner=>owner.hostId===taskOwner)?.name} onOpenTerminal={open}/></div>}
    </>}
    {drawer&&<SessionDrawer hostId={localHostId} hostName={pairing.hostName} sessions={sessions} activeId={selected} onClose={()=>setDrawer(false)} onSelect={open}/>}
  </div>;
}
