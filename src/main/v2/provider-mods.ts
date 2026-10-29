import path from "node:path";

export function isolatedHostEnvironment(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key])=>!/^(JK_|MULTI_CLI_WORK_CONTROL_|HERDR_|MCW_HERDR_|MCW_TASK_|CLAUDECODE$|CODEX_THREAD_ID$)/i.test(key)));
}

export function configureProviderMods(spec:{kind:string;args:string[];env:Record<string,string>;sessionId:string;generation:string},binaryPath:string,modsDirectory?:string) {
  return {
    args:spec.kind==="claude"&&modsDirectory?["--plugin-dir",path.join(modsDirectory,"mcw-chips-v2"),...spec.args]:spec.args,
    env:{...spec.env,MCW_RUNTIME:"v2",MCW_HERDR_BINARY:binaryPath,MULTI_CLI_WORK_SESSION_ID:spec.sessionId,MULTI_CLI_WORK_GENERATION:spec.generation},
  };
}
