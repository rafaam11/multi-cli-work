// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {mobileOperation} from './mobile-operations';
import type {HostClient} from './host-client';
const fixture=()=>{
  const request=vi.fn(async()=>({hostId:'local',launchProfiles:[],defaultLaunchProfiles:{}}));
  return {request,client:{request} as unknown as HostClient};
};
describe('paired mobile work operations',()=>{
  it('uses registered profiles/checkouts for local and remote task creation and start',async()=>{
    const {request,client}=fixture();const create={title:'work'},start={repositoryId:'repo',expectedHead:'a'.repeat(40),expectedPath:'/repo'};
    await mobileOperation(client,'local','createTask',[create,'local']);
    expect(request).toHaveBeenLastCalledWith('/tasks/registered','POST',create);
    await mobileOperation(client,'local','startRegisteredTask',['task',start,'local']);
    expect(request).toHaveBeenLastCalledWith('/tasks/task/start-registered','POST',start);
    await mobileOperation(client,'local','startRegisteredTask',['task',start,'remote']);
    expect(request).toHaveBeenLastCalledWith('/hosts/remote/tasks/task/start','POST',start);
  });
  it('cannot select raw execution, credentials, recovery, host registration or a route',async()=>{
    const {client,request}=fixture();
    for(const method of ['createTerminal','startTask','configureHost','localConnection','beginRecovery','request','issueTaskToken','shutdown'])
      await expect(mobileOperation(client,'local',method,['/connection'])).rejects.toThrow(/supported/);
    await expect(mobileOperation(client,'local','taskAction',['task','capabilities',{}])).rejects.toThrow(/action/);
    await expect(mobileOperation(client,'local','startRegisteredTask',['task',{executable:'/bin/sh'},'local'])).rejects.toThrow(/checkout/);
    await expect(mobileOperation(client,'local','executionCatalog',['../remote'])).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('maps the local owner without sending it through a remote registration',async()=>{
    const {client,request}=fixture();
    await mobileOperation(client,'local','executionCatalog',['local']);expect(request).toHaveBeenLastCalledWith('/execution-catalog');
    await mobileOperation(client,'local','workerCatalog',['remote','local']);expect(request).toHaveBeenLastCalledWith('/worker-hosts/remote/execution-catalog');
    await mobileOperation(client,'local','inspectWorkerRepository',['repo','remote','owner']);expect(request).toHaveBeenLastCalledWith('/hosts/owner/worker-hosts/remote/execution-catalog/repositories/repo');
    await mobileOperation(client,'local','taskAction',['task','answer',{eventId:'q',text:'yes'},'local']);expect(request).toHaveBeenLastCalledWith('/tasks/task/answer','POST',{eventId:'q',text:'yes'});
  });
});
