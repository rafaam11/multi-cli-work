import type {V2HostState} from './v2-api';
export type MobileHostClientMessage =
  | {type:'v2-request';requestId:string;operation:string;args:unknown[]}
  | {type:'v2-terminal';sessionId:string;command:Record<string,unknown>};
export type MobileHostServerMessage =
  | {type:'v2-reply';requestId:string;value?:unknown;error?:string}
  | {type:'v2-state';state:V2HostState}
  | {type:'v2-terminal';sessionId:string;event:unknown};
