// @vitest-environment node
import {expect,it} from 'vitest';
import {RecoveryWorkSession,type RecoveryScope} from './work-session';
function fixture(){
  const holds=new Map<string,any>(),calls:string[]=[],journal:RecoveryScope[][]=[];
  let lostReply=false,offline=false,ready=false,instance='instance-a';
  const clients=(hostId:string)=>({request:async(route:string,method='GET',input?:any)=>{
    calls.push(`${hostId} ${method} ${route}`);
    if(offline&&hostId==='remote')throw new Error('offline');
    if(route==='/health')return {schemaVersion:2,hostId,instanceId:instance,accepting:true};
    if(route==='/recovery-plan')return {hostId,instanceId:instance,related:[{hostId:'remote',taskIds:['task']}],checkedAt:Date.now()};
    if(route==='/recovery/holds'&&method==='POST'){holds.set(hostId,input);if(lostReply){lostReply=false;throw new Error('reply lost');}return {...input,releasedAt:null};}
    if(route.endsWith('/readiness'))return {hostId,instanceId:instance,holdActive:holds.has(hostId),ready,checkedAt:Date.now()};
    if(route.endsWith('/release')){holds.delete(hostId);return {released:true};}
    return holds.has(hostId)?{...holds.get(hostId),releasedAt:null}:null;
  }});
  const session=new RecoveryWorkSession({operationId:'operation',localHostId:'local',expectedHostIds:['local','remote'],client:async id=>clients(id),save:async scopes=>{journal.push(structuredClone(scopes));}});
  return {session,holds,calls,journal,setReady:()=>{ready=true;},loseReply:()=>{lostReply=true;},disconnect:()=>{offline=true;},restart:()=>{instance='instance-b';}};
}
it('journals every scope before dispatch and reconciles an unknown hold reply without replay',async()=>{
  const f=fixture();f.loseReply();await f.session.stopNewWork();
  expect(f.calls.filter(call=>call==='local POST /recovery/holds')).toHaveLength(1);
  expect(f.journal[0]).toEqual([{hostId:'local',instanceId:'instance-a',holdId:'operation',taskIds:null}]);
  expect(f.holds.get('remote').taskIds).toEqual(['task']);
  expect((await f.session.observeHosts()).every(host=>host.state==='running')).toBe(true);
  f.setReady();expect((await f.session.observeHosts()).every(host=>host.state==='completed')).toBe(true);
});
it('fails closed on a disconnected or replaced remote instance and retains holds for explicit cancellation',async()=>{
  const f=fixture();await f.session.stopNewWork();f.setReady();f.disconnect();
  expect((await f.session.observeHosts()).find(host=>host.hostId==='remote')?.state).toBe('unknown');
  await expect(f.session.release()).rejects.toThrow();expect(f.holds.has('local')).toBe(true);
  const g=fixture();await g.session.stopNewWork();g.restart();
  expect((await g.session.observeHosts()).every(host=>host.state==='unknown')).toBe(true);
});
it('releases remote scopes before admitting local work and never accepts a larger host set silently',async()=>{
  const f=fixture();await f.session.stopNewWork();await f.session.release();
  expect(f.calls.filter(call=>call.endsWith('/release')).map(call=>call.split(' ')[0])).toEqual(['remote','local']);
  const incomplete=new RecoveryWorkSession({operationId:'operation',localHostId:'local',expectedHostIds:['local'],client:async()=>({request:async(route:string)=>route==='/health'?{hostId:'local',instanceId:'a',schemaVersion:2}:route==='/recovery-plan'?{hostId:'local',instanceId:'a',related:[{hostId:'new-pc',taskIds:['task']}]}:{id:'operation',requesterHostId:'local',taskIds:null,releasedAt:null}}),save:async()=>{}});
  await expect(incomplete.stopNewWork()).rejects.toThrow(/inventory changed/i);
});
