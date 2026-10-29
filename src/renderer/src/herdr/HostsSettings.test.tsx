import { act,cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import type { McwV2Api,V2HostState } from "@shared/v2-api";
import { HostsSettings } from "./HostsSettings";
const local={hostId:"local",platform:"linux",nodeExecutable:"/opt/node",hostEntrypoint:"/opt/mcw-host.js",dataRoot:"/home/me/mcw"};
function setup(){let listener!:(state:V2HostState)=>void;const api={localConnection:vi.fn(async()=>local),listHosts:vi.fn(async()=>({registrations:[],observations:[]})),configureHost:vi.fn(async()=>{}),removeHost:vi.fn(async()=>{}),onState:(callback:typeof listener)=>{listener=callback;return()=>{};}};return{api:api as unknown as McwV2Api,calls:api,changed:(state:V2HostState)=>act(()=>listener(state))};}
afterEach(cleanup);
it("only reads connections on entry and submits a selected SSH host explicitly",async()=>{
  const {api,calls}=setup();render(<HostsSettings api={api}/>);await screen.findByText("이 PC: local");
  expect(calls.configureHost).not.toHaveBeenCalled();expect(calls.removeHost).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("다른 PC 연결 정보"),{target:{value:JSON.stringify({...local,hostId:"remote"})}});
  fireEvent.change(screen.getByLabelText("SSH 주소"),{target:{value:"lab"}});
  fireEvent.click(screen.getByRole("button",{name:"PC 연결"}));
  await waitFor(()=>expect(calls.configureHost).toHaveBeenCalledWith({name:"lab",enabled:true,ssh:{...local,hostId:"remote",destination:"lab"}}));
});
it("keeps the connection draft and last observation visible when the host disconnects",async()=>{
  const {api,changed,calls}=setup();render(<HostsSettings api={api}/>);await screen.findByText("이 PC: local");
  fireEvent.change(screen.getByLabelText("SSH 주소"),{target:{value:"keep-draft"}});
  changed({tasks:[],terminals:[],connected:false,observedAt:10,hosts:[{hostId:"remote",name:"Lab",enabled:true,connected:false,observedAt:1000,error:null,tasks:[],terminals:[]}]});
  expect(screen.getByLabelText("SSH 주소")).toHaveValue("keep-draft");expect(screen.getByText(/마지막 관찰/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"PC 연결"})).toBeDisabled();expect(calls.configureHost).not.toHaveBeenCalled();
});
it("rejects pasted credential-bearing or extra connection fields before saving",async()=>{
  const {api,calls}=setup();render(<HostsSettings api={api}/>);await screen.findByText("이 PC: local");
  fireEvent.change(screen.getByLabelText("SSH 주소"),{target:{value:"lab"}});
  fireEvent.change(screen.getByLabelText("다른 PC 연결 정보"),{target:{value:JSON.stringify({...local,hostId:"remote",token:"do-not-store"})}});
  fireEvent.click(screen.getByRole("button",{name:"PC 연결"}));await screen.findByText(/연결 정보 형식/);expect(calls.configureHost).not.toHaveBeenCalled();
});
