import type {TaskIdentity,TaskResultInput,TaskAttempt} from "./host-types";
import type {RegisteredTaskStart} from "./execution-catalog";
/** Retransmittable task data, never an execution command. */
export type RemoteTaskAction = {kind:"message";to:string|null;text:string}|{kind:"question"|"approval";text:string}|{kind:"result";result:TaskResultInput};
export interface RemoteTaskOperation {id:string;ownerHostId:string;source:TaskIdentity;action:RemoteTaskAction}
export interface WorkerTransfer {id:string;ownerHostId:string;identity:TaskIdentity;selection:RegisteredTaskStart;attempt:TaskAttempt;pending:RemoteTaskOperation[]}
export interface RemoteWorkerSelection {participantId:string;selection:RegisteredTaskStart}
