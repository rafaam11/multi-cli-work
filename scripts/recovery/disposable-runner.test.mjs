// @vitest-environment node
import {it,expect} from 'vitest';
import {assertDisposableRunner} from './disposable-runner.mjs';
it('never allows installer tests on a developer or self-hosted machine',()=>{
  const env={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_REPOSITORY:'rafaam11/multi-cli-work',RUNNER_OS:'Windows',RUNNER_TEMP:'C:/fixture'};
  expect(()=>assertDisposableRunner(env,'win32')).not.toThrow();
  for(const patch of [{GITHUB_ACTIONS:'false'},{RUNNER_ENVIRONMENT:'self-hosted'},{RUNNER_TEMP:''},{GITHUB_REPOSITORY:'other/repo'},{RUNNER_OS:'Linux'}])expect(()=>assertDisposableRunner({...env,...patch},'win32')).toThrow();
  expect(()=>assertDisposableRunner({},process.platform)).toThrow();
});
