import {randomUUID} from 'node:crypto';
import type {SharedWorktree} from '../../shared/worktree-types';
import {readJsonStore,updateJsonStore,type JsonStoreSpec} from '../storage/json-store';
import {parseWorktreeRegistry,WORKTREE_REGISTRY_PATH,WorktreeRegistryError} from './worktree-registry';
export interface PendingRemoval {id:string;worktree:SharedWorktree;phase:'active'|'release';removed:boolean}
class PendingRemovalError extends Error {}
interface Pending {version:1;operations:Record<string,PendingRemoval>}
const spec:JsonStoreSpec<Pending>={label:'worktree removals',displayName:'워크트리 삭제 작업',empty:()=>({version:1,operations:{}}),error:(message,options)=>new Error(message,options),isContentError:error=>error instanceof PendingRemovalError||error instanceof WorktreeRegistryError,parse(value:unknown){
 const data=value as Pending;if(!data||data.version!==1||!data.operations||typeof data.operations!=='object'||Array.isArray(data.operations))throw new PendingRemovalError('Invalid pending worktree removals');
 for(const [id,op] of Object.entries(data.operations)){if(!op||typeof op.id!=='string'||!op.id||!['active','release'].includes(op.phase)||typeof op.removed!=='boolean'||op.worktree?.id!==id)throw new PendingRemovalError('Invalid pending worktree removal');parseWorktreeRegistry({schemaVersion:1,updatedAt:op.worktree.updatedAt,worktrees:{[id]:op.worktree}});}
 return data;
}};
export class PendingWorktreeRemovals {
 private readonly file:string;
 constructor(registryPath=WORKTREE_REGISTRY_PATH){this.file=`${registryPath}.removals.json`;}
 async list():Promise<Record<string,PendingRemoval>>{const current=await readJsonStore(spec,this.file);if(!current.writable)throw new Error(current.warning);return current.value.operations;}
 async begin(worktree:SharedWorktree):Promise<PendingRemoval>{const state=await updateJsonStore(spec,this.file,current=>({...current,operations:{...current.operations,[worktree.id]:current.operations[worktree.id]??{id:randomUUID(),worktree,phase:'active',removed:false}}}));return state.operations[worktree.id];}
 async releasing(worktreeId:string,removed:boolean):Promise<void>{await updateJsonStore(spec,this.file,current=>{const op=current.operations[worktreeId];if(!op)throw new Error('Missing removal operation');return {...current,operations:{...current.operations,[worktreeId]:{...op,phase:'release' as const,removed}}};});}
 async finish(worktreeId:string):Promise<void>{await updateJsonStore(spec,this.file,current=>{const operations={...current.operations};delete operations[worktreeId];return {...current,operations};});}
}
