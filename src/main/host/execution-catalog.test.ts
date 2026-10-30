// @vitest-environment node
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {HostExecutionCatalog} from "./execution-catalog";
import {TaskStore} from "./task-store";
const exec=promisify(execFile),directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
async function fixture(){
  // CI may expose the temp root through an 8.3 alias; inspected checkout paths are canonical.
  const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),"mcw-catalog-")));directories.push(directory);
  const registryRoot=path.join(directory,"registry"),userData=path.join(directory,"userData"),repository=path.join(directory,"repo");
  await Promise.all([registryRoot,userData,repository].map(dir=>mkdir(dir)));
  const git=(...args:string[])=>exec("git",["-C",repository,...args]);
  await git("init");await writeFile(path.join(repository,"source.txt"),"base\n");await git("add",".");
  await git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-m","base");
  const now=new Date().toISOString();
  const project={id:"ee22ee22-2222-4222-8222-222222222222",rootPath:repository,displayName:"Remote repository",sources:["manual"],providerRefs:{claude:[],codex:[]},status:null,memo:"",tracks:[],hidden:false,order:null,createdAt:now,updatedAt:now};
  const workProject={id:"ee11ee11-1111-4111-8111-111111111111",name:"Remote project",category:"work",status:null,memo:"",notionLinks:[],localFolders:[],members:[{projectId:project.id,role:"repo"}],order:null,createdAt:now,updatedAt:now};
  await writeFile(path.join(registryRoot,"projects.json"),JSON.stringify({schemaVersion:1,updatedAt:now,projects:{[project.id]:project}}));
  await writeFile(path.join(registryRoot,"work-projects.json"),JSON.stringify({schemaVersion:1,updatedAt:now,teamsSyncRoot:null,workProjects:{[workProject.id]:workProject}}));
  const profile={id:"remote-profile",agentId:"codex" as const,name:"Remote model",model:"chosen",effort:"high" as const};
  const workbench=path.join(userData,"workbench-state.json"),saved={schemaVersion:1,prompts:[],drafts:{},launchProfiles:[profile]};
  await writeFile(workbench,JSON.stringify(saved));
  const detect=vi.fn(async()=>({agents:{codex:process.execPath,claude:null},vscode:null}));
  const catalog=new HostExecutionCatalog({hostId:"remote",registryRoot,userData,detect});
  const store=new TaskStore({directory:path.join(userData,"host"),hostId:"remote"});
  const task=await store.createTask({title:"Remote task",brief:"Keep changes unintegrated",projectId:workProject.id,lead:{provider:"codex",profileId:profile.id,hostId:"remote"},workers:[]});
  return {directory,registryRoot,userData,repository,git,workbench,saved,catalog,task,detect};
}
it("reads only the selected host's saved catalog and resolves its registered checkout without changing it",async()=>{
  const {catalog,task,repository,git,registryRoot,userData,workbench}=await fixture();
  const before=await readFile(workbench,"utf8"),files=await readdir(userData);
  const value=await catalog.read();
  expect(value).toMatchObject({hostId:"remote",availableProviders:["codex"],repositories:[{id:"ee22ee22-2222-4222-8222-222222222222",path:repository,projectId:"ee11ee11-1111-4111-8111-111111111111",projectName:"Remote project"}]});
  expect(value.launchProfiles.find(profile=>profile.id==="remote-profile")?.model).toBe("chosen");
  expect(JSON.stringify(value)).not.toContain(process.execPath);
  const inspected=await catalog.inspectRepository("ee22ee22-2222-4222-8222-222222222222");
  expect(inspected.expectedHead).toBe((await git("rev-parse","HEAD")).stdout.trim());
  const launch=await catalog.prepare(task,{repositoryId:"ee22ee22-2222-4222-8222-222222222222",expectedHead:inspected.expectedHead,expectedPath:inspected.repository.path});
  expect(launch).toMatchObject({repositoryPath:inspected.repository.path,expectedHead:inspected.expectedHead,projectId:"ee22ee22-2222-4222-8222-222222222222",profiles:[{participantId:task.participants[0].id,executable:process.execPath,profile:{id:"remote-profile"}}]});
  expect(await readFile(workbench,"utf8")).toBe(before);expect(await readdir(userData)).toEqual(files);
  expect(await readdir(registryRoot)).toEqual(["projects.json","work-projects.json"]);
});
it("refuses changed commits, profiles, unregistered paths and mismatched projects before execution",async()=>{
  const {catalog,task,repository,git,workbench,saved}=await fixture();
  const inspected=await catalog.inspectRepository("ee22ee22-2222-4222-8222-222222222222");
  await writeFile(path.join(repository,"source.txt"),"user edit\n");
  await expect(catalog.prepare(task,{repositoryId:"ee22ee22-2222-4222-8222-222222222222",expectedHead:inspected.expectedHead,expectedPath:path.join(repository,"different")})).rejects.toThrow(/경로/);
  await expect(catalog.prepare(task,{repositoryId:"ee22ee22-2222-4222-8222-222222222222",expectedHead:inspected.expectedHead,expectedPath:inspected.repository.path,repositoryPath:repository})).rejects.toThrow();
  await expect(catalog.inspectRepository(repository)).rejects.toThrow();
  await expect(catalog.prepare({...task,projectId:"other"},{repositoryId:"ee22ee22-2222-4222-8222-222222222222",expectedHead:inspected.expectedHead,expectedPath:inspected.repository.path})).rejects.toThrow();
  await writeFile(workbench,JSON.stringify({...saved,launchProfiles:[]}));
  await expect(catalog.prepare(task,{repositoryId:"ee22ee22-2222-4222-8222-222222222222",expectedHead:inspected.expectedHead,expectedPath:inspected.repository.path})).rejects.toThrow();
  await writeFile(workbench,JSON.stringify(saved));
  await git("add",".");await git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-m","advance");
  await expect(catalog.prepare(task,{repositoryId:"ee22ee22-2222-4222-8222-222222222222",expectedHead:inspected.expectedHead,expectedPath:inspected.repository.path})).rejects.toThrow(/commit|커밋/);
  expect(await readFile(path.join(repository,"source.txt"),"utf8")).toBe("user edit\n");
});
it("captures the owner's project brief at task creation without rewriting saved project data",async()=>{
  const {catalog,task,repository,registryRoot}=await fixture();
  const file=path.join(registryRoot,"work-projects.json"),before=await readFile(file,"utf8");
  const input={title:"Fresh lead",brief:"User request",projectId:task.projectId,lead:{hostId:"remote",provider:"codex" as const,profileId:"remote-profile"},workers:[]};
  const selected=await catalog.validateCreate(input);
  expect(selected.brief).toContain("User request");expect(selected.brief).toContain("# 업무 프로젝트: Remote project");
  expect(selected.brief).toContain(repository);expect(input.brief).toBe("User request");
  expect(await readFile(file,"utf8")).toBe(before);
  await expect(catalog.validateCreate({...input,lead:{...input.lead,hostId:"other"}})).rejects.toThrow();
  await expect(catalog.validateCreate({...input,workers:[{hostId:"other",provider:"codex",profileId:"remote-profile"}]})).rejects.toThrow();
});
it("resolves a foreign owner's worker against this host's explicitly selected checkout and profile",async()=>{
  const {directory,catalog}=await fixture();
  const owner=new TaskStore({directory:path.join(directory,"another-owner"),hostId:"another-owner"});
  const task=await owner.createTask({title:"Foreign team",brief:"Owner context",projectId:"owner-project",lead:{hostId:"another-owner",provider:"claude",profileId:"lead"},workers:[{hostId:"remote",provider:"codex",profileId:"remote-profile"}]});
  const member=task.participants[1],identity={taskId:task.id,participantId:member.id,attemptId:member.attempt.id,generation:1,role:member.role,hostId:member.hostId};
  const inspected=await catalog.inspectRepository("ee22ee22-2222-4222-8222-222222222222"),selection={repositoryId:inspected.repository.id,expectedHead:inspected.expectedHead,expectedPath:inspected.repository.path};
  await expect(catalog.prepare(task,selection)).rejects.toThrow();
  expect(await catalog.prepareWorker(task,identity,selection)).toMatchObject({repositoryPath:inspected.repository.path,projectId:inspected.repository.id,profiles:[{participantId:member.id,profile:{id:"remote-profile"}}]});
  await expect(catalog.prepareWorker(task,{...identity,hostId:"another-host"},selection)).rejects.toThrow();
});
it("validates cross-host choices against their own catalog and resolves only owner-local executable profiles",async()=>{
  const f=await fixture(),foreign=await f.catalog.read();foreign.hostId="worker-pc";
  foreign.launchProfiles=[...foreign.launchProfiles.filter(p=>p.id!=="remote-profile"),{id:"worker-only",agentId:"codex",name:"Worker model",model:null,effort:null}];
  const remoteCatalog=vi.fn(async()=>foreign),catalog=new HostExecutionCatalog({...f.catalog.options,remoteCatalog});
  const input={title:"Cross-host",brief:"Collect",lead:{hostId:"remote",provider:"codex" as const,profileId:"remote-profile"},workers:[{hostId:"worker-pc",provider:"codex" as const,profileId:"worker-only"}]};
  const selected=await catalog.validateCreate(input);expect(selected.workers?.[0].profileId).toBe("worker-only");
  const owner=new TaskStore({directory:path.join(f.directory,"cross-host"),hostId:"remote"}),task=await owner.createTask(selected);
  const inspection=await catalog.inspectRepository("ee22ee22-2222-4222-8222-222222222222"),selection={repositoryId:inspection.repository.id,expectedPath:inspection.repository.path,expectedHead:inspection.expectedHead};
  const remoteWorkers=[{participantId:task.participants[1].id,selection}];
  const prepared=await catalog.prepare(task,{...selection,remoteWorkers});
  expect(prepared.profiles.map(p=>p.participantId)).toEqual([task.participants[0].id]);expect(prepared.remoteWorkers).toEqual(remoteWorkers);
  await expect(catalog.validateCreate({...input,workers:[{...input.workers[0],profileId:"remote-profile"}]})).rejects.toThrow();
  remoteCatalog.mockRejectedValueOnce(new Error("offline"));await expect(catalog.validateCreate(input)).rejects.toThrow("offline");
});
