import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import type {McwV2Api} from "@shared/v2-api";
import type {RepositoryInspection} from "@shared/execution-catalog";
import {WorkerCheckout} from "./WorkerCheckout";
afterEach(cleanup);
it("can reload an unavailable catalog and clears an earlier checkout confirmation",async()=>{
  const catalog={version:1,hostId:"worker",platform:"linux",launchProfiles:[],defaultLaunchProfiles:{},availableProviders:[],repositories:[]};
  const api={workerCatalog:vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(catalog),inspectWorkerRepository:vi.fn()} as unknown as McwV2Api,onChange=vi.fn();
  render(<WorkerCheckout api={api} workerHostId="worker" label="작업자" base={null} disabled={false} onChange={onChange}/>);
  await screen.findByText("offline");fireEvent.click(screen.getByRole("button",{name:"저장소 목록 새로고침"}));
  await waitFor(()=>expect(api.workerCatalog).toHaveBeenCalledTimes(2));expect(onChange).toHaveBeenCalledWith(null);
  await waitFor(()=>expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});
it("ignores an old host inspection and releases its busy state when switching hosts",async()=>{
  const repository={id:"repo",name:"repo",path:"/repo",projectId:null,projectName:null};
  let resolve!:(value:RepositoryInspection)=>void;
  const api={workerCatalog:vi.fn(async(hostId:string)=>({version:1,hostId,platform:"linux",launchProfiles:[],defaultLaunchProfiles:{},availableProviders:[],repositories:[repository]})),inspectWorkerRepository:vi.fn(()=>new Promise<RepositoryInspection>(done=>resolve=done))} as unknown as McwV2Api,onChange=vi.fn();
  const props={api,label:"작업자",base:null,disabled:false,onChange};
  const view=render(<WorkerCheckout {...props} workerHostId="old"/>);await screen.findByRole("option",{name:/repo ·/});
  fireEvent.change(screen.getByLabelText("작업자 저장소"),{target:{value:"repo"}});fireEvent.click(screen.getByRole("button",{name:"작업자 기준 커밋 확인"}));
  await waitFor(()=>expect(api.inspectWorkerRepository).toHaveBeenCalled());onChange.mockClear();
  view.rerender(<WorkerCheckout {...props} workerHostId="new"/>);await waitFor(()=>expect(screen.getByLabelText("작업자 저장소")).toBeEnabled());
  resolve({repository,expectedHead:"a".repeat(40)});await Promise.resolve();expect(onChange).not.toHaveBeenCalled();
});
