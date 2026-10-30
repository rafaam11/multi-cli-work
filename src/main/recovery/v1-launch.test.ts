// @vitest-environment node
import path from 'node:path';
import {expect,it} from 'vitest';
import {v1LaunchEnvironment,observeV1Launch} from './v1-launch';
const root=path.resolve('fixture-v1');
it('restores original data/provider locations without inherited v2 control or AppImage mount state',()=>{
  const env=v1LaunchEnvironment({MCW_RUNTIME:'v2-preview',MCW_TASK_TOKEN:'private',MULTI_CLI_WORK_REGISTRY_PATH:path.join(root,'v2/projects.json'),ELECTRON_RUN_AS_NODE:'1',APPDIR:'/tmp/old-mount',APPIMAGE:'/apps/v2.AppImage',PATH:'retained',CLAUDE_CONFIG_DIR:'/wrong'},{userData:path.join(root,'data'),registry:path.join(root,'registry')},{CLAUDE_CONFIG_DIR:path.join(root,'claude'),CODEX_HOME:path.join(root,'codex')});
  expect(env.MCW_RUNTIME).toBeUndefined();expect(env.MCW_TASK_TOKEN).toBeUndefined();expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();expect(env.APPDIR).toBeUndefined();expect(env.APPIMAGE).toBeUndefined();
  expect(env.PATH).toBe('retained');expect(env.CLAUDE_CONFIG_DIR).toBe(path.join(root,'claude'));expect(env.CODEX_HOME).toBe(path.join(root,'codex'));
  expect(env.MULTI_CLI_WORK_USER_DATA).toBe(path.join(root,'data'));expect(env.MULTI_CLI_WORK_REGISTRY_PATH).toBe(path.join(root,'registry/projects.json'));
});
it('rejects unrelated or relative environment overrides in a recovery request',()=>{
  expect(()=>v1LaunchEnvironment({},{userData:root,registry:root},{NODE_OPTIONS:'--require anything'})).toThrow();
  expect(()=>v1LaunchEnvironment({},{userData:root,registry:root},{CODEX_HOME:'relative'})).toThrow();
});
it('records a fresh surviving native launch identity but refuses a reused PID or early exit',async()=>{
  const child={pid:41,exitCode:null,signalCode:null},identity={pid:41,parentPid:1,startId:'windows:10',name:'app',executable:path.join(root,'app')};
  expect(await observeV1Launch(child,async()=>[identity],async()=>{})).toEqual(identity);
  let count=0;await expect(observeV1Launch(child,async()=>[{...identity,startId:++count===1?'windows:10':'windows:11'}],async()=>{})).rejects.toThrow(/identity/i);
  await expect(observeV1Launch({...child,exitCode:1},async()=>[identity],async()=>{})).rejects.toThrow(/exited/i);
  await expect(observeV1Launch(child,async()=>[],async()=>{})).rejects.toThrow(/observed/i);
});
