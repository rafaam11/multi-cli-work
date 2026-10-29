import type { Task } from "../../shared/host-types";
import type { ManagedSession } from "../herdr/terminal-service";
import { parseHerdrSessionRegistry } from "../herdr/terminal-service";
import { validateTaskSnapshot } from "./task-validation";
import type { JsonStoreSpec } from "../storage/json-store";

export interface CachedHostObservation {
  hostId:string;platform:"win32"|"linux";observedAt:number;tasks:Task[];terminals:ManagedSession[];
}
interface ObservationCache {version:2;observations:CachedHostObservation[]}
class ObservationCacheError extends Error {}
export const observationCacheSpec:JsonStoreSpec<ObservationCache>={
  label:"host observations",displayName:"원격 PC 마지막 관찰",empty:()=>({version:2,observations:[]}),
  error:(message,options)=>new ObservationCacheError(message,options),isContentError:error=>error instanceof ObservationCacheError,
  parse(value){
    try{
      const data=value as ObservationCache;
      if(!data||data.version!==2||Object.keys(data).some(key=>!["version","observations"].includes(key))||!Array.isArray(data.observations)||data.observations.length>32)throw Error();
      const ids=new Set<string>();
      for(const item of data.observations){
        if(!item||Object.keys(item).some(key=>!["hostId","platform","observedAt","tasks","terminals"].includes(key))||typeof item.hostId!=="string"||!/^[\w-]{1,128}$/.test(item.hostId)||ids.has(item.hostId)||!["win32","linux"].includes(item.platform)||!Number.isSafeInteger(item.observedAt)||item.observedAt<0)throw Error();
        ids.add(item.hostId);
        validateTaskSnapshot({schemaVersion:2,hostId:item.hostId,tasks:item.tasks,outbox:[]});
        parseHerdrSessionRegistry({version:2,sessions:item.terminals},item.platform);
      }
      return data;
    }catch{throw new ObservationCacheError("Invalid remote host observations");}
  }
};
