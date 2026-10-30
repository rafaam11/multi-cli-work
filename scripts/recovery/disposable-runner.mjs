import path from 'node:path';
/** Deliberate installation tests are confined to disposable hosted CI. */
export function assertDisposableRunner(env=process.env,platform=process.platform){
  const paths=platform==='win32'?path.win32:path.posix;
  if(env.GITHUB_ACTIONS!=='true'||env.RUNNER_ENVIRONMENT!=='github-hosted'||env.GITHUB_REPOSITORY!=='rafaam11/multi-cli-work'||env.RUNNER_OS!==(platform==='win32'?'Windows':'Linux')||!['win32','linux'].includes(platform)||!env.RUNNER_TEMP||!paths.isAbsolute(env.RUNNER_TEMP))throw new Error('Original installation tests require a disposable GitHub-hosted MCW runner; no installer was executed');
}
