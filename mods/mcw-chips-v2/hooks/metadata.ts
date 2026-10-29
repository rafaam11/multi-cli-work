import type { ChipsHealth, ChipsWire } from '../types'
import { CHIP_KEYS } from './chips'
import { encodeChipsMetadata } from '../../../src/shared/herdr-metadata'

export type Run = (argv: readonly string[], init?: { timeoutMs?: number }) => Promise<{exitCode:number;stdout:string;stderr:string}>
export type Transport = { name():string; send(wire:ChipsWire):Promise<void> }

/** Uses Herdr's native command directly. Never invokes a shell or a general MCW control CLI. */
export function metadataArgv(binary:string,paneId:string,wire:ChipsWire):string[] {
  if(!binary||binary.includes('\0')||!/^w\d+:p\d+$/.test(paneId))throw new Error('Invalid Herdr metadata destination')
  const tokens=encodeChipsMetadata({chips:Object.entries(wire.chips).map(([key,chip])=>({key,...chip})),progress:wire.progress?.kind==='value'?{state:'normal',value:wire.progress.value}:wire.progress?{state:'indeterminate',value:null}:null},CHIP_KEYS)
  return [binary,'pane','report-metadata',paneId,'--source','mcw-chips-v2','--ttl-ms','90000',...Object.entries(tokens).flatMap(([key,value])=>value===null?['--clear-token',key]:['--token',`${key}=${value}`])]
}
export function makeTransport(run:Run,env:{binary:string;paneId:string}):Transport {
  let pending=Promise.resolve()
  return {name:()=> 'Herdr metadata',send(wire){
    const argv=metadataArgv(env.binary,env.paneId,wire)
    const sending=pending.catch(()=>{}).then(async()=>{
      const result=await run(argv,{timeoutMs:4000})
      if(result.exitCode!==0)throw new Error(`Herdr metadata failed (${result.exitCode}): ${result.stderr.slice(0,256)}`)
    })
    pending=sending;return sending
  }}
}
export function emptyHealth(transport:string):ChipsHealth {return {transport,flushes:0,failures:0,consecutive:0,backoffUntil:0,disabled:null,blocked:[],latencies:[],lastError:null}}
export function latencySummary(values:readonly number[]) {if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return {avg:Math.round(values.reduce((a,b)=>a+b,0)/values.length),p95:sorted[Math.ceil(values.length*.95)-1]}}
type Deps={clock:{now():Promise<number>;after(ms:number,fn:()=>void):{cancel():void}};transport:Transport;debounceMs:number;sent:ChipsWire|null;desired(now:number):ChipsWire;onSent?(value:ChipsWire|null):void;onHealth?(value:ChipsHealth):void;log?(text:string):void}
export class Flusher {
  sent:ChipsWire|null
  readonly health:ChipsHealth
  private timer:{cancel():void}|null=null
  private busy=false
  private dirty=false
  private stopped=false
  constructor(private deps:Deps){this.sent=deps.sent;this.health=emptyHealth(deps.transport.name())}
  request(){if(this.stopped)return;if(this.busy){this.dirty=true;return;}if(!this.timer)this.timer=this.deps.clock.after(this.deps.debounceMs,()=>{this.timer=null;void this.flush()})}
  flushNow(){this.timer?.cancel();this.timer=null;void this.flush()}
  stop(){this.stopped=true;this.timer?.cancel();this.timer=null}
  async flush(){
    if(this.stopped)return;if(this.busy){this.dirty=true;return;}this.busy=true;this.dirty=false
    try {
      const now=await this.deps.clock.now(),desired=this.deps.desired(now)
      if(JSON.stringify(desired)===JSON.stringify(this.sent))return
      await this.deps.transport.send(desired)
      this.sent=desired;this.health.flushes++;this.health.consecutive=0;this.health.lastError=null
      this.health.latencies=[...this.health.latencies,(await this.deps.clock.now())-now].slice(-20)
      this.deps.onSent?.(desired)
    }catch(error){
      this.health.failures++;this.health.consecutive++;this.health.lastError=String(error);this.sent=null
      // No retry timer. A later observation/heartbeat publishes the then-current display.
    }finally{
      this.busy=false;this.deps.onHealth?.({...this.health})
      if(this.dirty&&!this.stopped)this.request()
    }
  }
}
