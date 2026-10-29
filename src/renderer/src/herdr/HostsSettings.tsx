import { useEffect,useRef,useState } from "react";
import type { McwV2Api } from "@shared/v2-api";
import type { HostRegistration,RemoteHostObservation,LocalHostConnection } from "@shared/host-connection-types";
import { errorMessage } from "../ipc-error";

function parseConnection(text:string):LocalHostConnection {
  const value=JSON.parse(text) as LocalHostConnection;
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!["hostId","platform","nodeExecutable","hostEntrypoint","dataRoot"].includes(key))||!["linux","win32"].includes(value.platform)||[value.hostId,value.nodeExecutable,value.hostEntrypoint,value.dataRoot].some(field=>typeof field!=="string"||!field))throw new Error("연결 정보 형식을 확인하세요. 다른 PC의 ‘이 PC 연결 정보 복사’를 사용하세요.");
  return value;
}
export function HostsSettings({api=window.mcwV2}:{api?:McwV2Api}) {
  const [local,setLocal]=useState<LocalHostConnection|null>(null),[registrations,setRegistrations]=useState<HostRegistration[]>([]),[observations,setObservations]=useState<RemoteHostObservation[]>([]);
  const [connectionText,setConnectionText]=useState(""),[destination,setDestination]=useState(""),[name,setName]=useState(""),[username,setUsername]=useState(""),[port,setPort]=useState(""),[identityFile,setIdentityFile]=useState("");
  const [busy,setBusy]=useState(false),[online,setOnline]=useState(true),[error,setError]=useState<string|null>(null),[copied,setCopied]=useState(false);
  const revision=useRef(0),alive=useRef(true);
  const supported=!!api?.listHosts&&!!api.localConnection&&!!api.configureHost&&!!api.removeHost;
  const refresh=async()=>{
    const before=revision.current,result=await api!.listHosts!();
    if(alive.current){setRegistrations(result.registrations);if(before===revision.current)setObservations(result.observations);}
  };
  useEffect(()=>{
    alive.current=true;if(!supported)return;
    const off=api!.onState?.(state=>{revision.current++;setOnline(state.connected);setObservations(state.hosts??[]);});
    void refresh().catch(cause=>{if(alive.current)setError(errorMessage(cause));});
    void api!.localConnection!().then(info=>{if(alive.current)setLocal(info);}).catch(cause=>{if(alive.current)setError(errorMessage(cause));});
    return()=>{alive.current=false;off?.();};
  },[api,supported]);
  const run=(action:()=>Promise<unknown>)=>{
    setBusy(true);setError(null);void action().catch(cause=>{if(alive.current)setError(errorMessage(cause));}).finally(()=>{if(alive.current)setBusy(false);});
  };
  const connect=()=>run(async()=>{
    let info:LocalHostConnection;try{info=parseConnection(connectionText);}catch{throw new Error("연결 정보 형식을 확인하세요. 다른 PC의 ‘이 PC 연결 정보 복사’를 사용하세요.");}
    if(info.hostId===local?.hostId)throw new Error("다른 PC의 연결 정보를 넣어 주세요.");
    const selectedPort=port.trim()?Number(port):undefined;if(selectedPort!==undefined&&(!Number.isInteger(selectedPort)||selectedPort<1||selectedPort>65535))throw new Error("SSH 포트는 1~65535 사이여야 합니다.");
    await api!.configureHost!({name:name.trim()||destination.trim(),enabled:true,ssh:{...info,destination:destination.trim(),...(username.trim()?{username:username.trim()}:{}),...(selectedPort?{port:selectedPort}:{}),...(identityFile.trim()?{identityFile:identityFile.trim()}: {})}});
    await refresh();setConnectionText("");setDestination("");setName("");setUsername("");setPort("");setIdentityFile("");
  });
  if(!supported)return <p className="settings-hint">호스트 연결 기능을 준비 중입니다.</p>;
  return <section aria-label="v2 PC 연결">
    <h3>다른 PC에 SSH로 접속</h3>
    <p className="settings-hint">연결할 PC에서 아래 연결 정보를 복사해 넣으세요. SSH 계정과 확인된 호스트 키를 사용합니다.</p>
    {local&&<div className="settings-row"><span>이 PC: {local.hostId}</span><button type="button" disabled={busy} onClick={()=>run(async()=>{await window.multiCliWork.clipboard.writeText(JSON.stringify(local,null,2));setCopied(true);})}>이 PC 연결 정보 복사</button></div>}
    {copied&&<p className="settings-hint" role="status">연결 정보를 복사했습니다.</p>}
    <form className="v2-host-form" onSubmit={event=>{event.preventDefault();if(!busy&&online)connect();}}>
      <label className="v2-host-connection">다른 PC 연결 정보<textarea aria-label="다른 PC 연결 정보" rows={3} value={connectionText} onChange={event=>setConnectionText(event.target.value)}/></label>
      <label>SSH 주소<input aria-label="SSH 주소" placeholder="lab-pc 또는 100.x.y.z" value={destination} onChange={event=>setDestination(event.target.value)}/></label>
      <label>PC 이름<input aria-label="PC 이름" placeholder="선택 사항" value={name} onChange={event=>setName(event.target.value)}/></label>
      <label>SSH 사용자<input aria-label="SSH 사용자" placeholder="SSH 설정 사용" value={username} onChange={event=>setUsername(event.target.value)}/></label>
      <label>SSH 포트<input aria-label="SSH 포트" type="number" min={1} max={65535} placeholder="SSH 설정 사용" value={port} onChange={event=>setPort(event.target.value)}/></label>
      <label className="v2-host-connection">개인 키 경로<input aria-label="개인 키 경로" placeholder="선택 사항 · 기존 SSH 키 또는 에이전트 사용" value={identityFile} onChange={event=>setIdentityFile(event.target.value)}/></label>
      <button type="submit" disabled={busy||!online||!connectionText.trim()||!destination.trim()}>PC 연결</button>
    </form>
    {!online&&<p className="settings-error" role="status">이 PC의 호스트와 연결이 끊겼습니다.</p>}
    {observations.map(host=>{
      const registration=registrations.find(item=>item.ssh.hostId===host.hostId);
      return <div className="settings-row" key={host.hostId}><span>{host.name}<small className="settings-hint"> · {!host.enabled?"관찰 꺼짐":host.connected?"연결됨":"연결 끊김"} · 마지막 관찰 {host.observedAt===null?"없음":new Date(host.observedAt).toLocaleString("ko-KR")}{host.error?` · ${host.error}`:""}</small></span>
        <span className="settings-remote-host-actions"><button type="button" disabled={busy||!online||!registration} onClick={()=>run(async()=>{await api!.configureHost!({...registration!,enabled:!host.enabled});await refresh();})}>{host.enabled?"관찰 끄기":"다시 연결"}</button>
          <button type="button" aria-label={`${host.name} 연결 삭제`} disabled={busy||!online} onClick={()=>run(async()=>{await api!.removeHost!(host.hostId);await refresh();})}>삭제</button></span>
      </div>;
    })}
    <p className="settings-hint">관찰을 끄거나 연결을 삭제해도 해당 PC의 작업은 계속 실행됩니다.</p>
    {error&&<p className="settings-error" role="alert">{error}</p>}
  </section>;
}
