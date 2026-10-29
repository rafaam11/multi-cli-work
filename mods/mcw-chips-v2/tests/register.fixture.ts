import {expect,mock,test} from 'claude-code/testing'
import type {On} from 'claude-code'
const START={cwd:'C:/test',surface:'terminal',isInteractive:true} as const
const ENV={MCW_RUNTIME:'v2',MCW_HERDR_BINARY:'C:\\Herdr Dir\\herdr.exe',HERDR_PANE_ID:'w1:p1',MULTI_CLI_WORK_SESSION_ID:'attempt'}
function engine(on:On,runs:readonly string[][]){
  on('session.start',($,e)=>({cwd:e.cwd}))
  on('session.end',($,e)=>({sessionId:e.sessionId}))
  on('command.register',($,e)=>({value:{command:e.name}}))
  on('session.measure',($,e)=>({changed:e.changed}))
  on('agent.list',()=>({value:[]}))
  on('process.run',($,e)=>{
    (runs as string[][]).push([...e.argv])
    return {value:{exitCode:0,stdout:'{}',stderr:'',isStdoutTruncated:false,isStderrTruncated:false}}
  })
  on('tool.call',($,e)=>({result:{oldTodos:[],newTodos:(e as Record<string,unknown>).todos},text:'unchanged'}) as never)
}
test('v1 sessions do not start the v2 transport',async($,on)=>{
  const runs:string[][]=[];const clock=mock.clock(on,{now:1000});mock.env(on,{...ENV,MCW_RUNTIME:'v1'});engine(on,runs)
  await $.session.start(START);await clock.advance(5000);expect(runs).toHaveLength(0)
})
test('real hooks preserve tool results and publish bounded Herdr metadata',async($,on)=>{
  const runs:string[][]=[];const clock=mock.clock(on,{now:1000});mock.env(on,ENV);engine(on,runs)
  await $.session.start(START);await clock.advance(1000);expect(runs).toHaveLength(1)
  expect(runs[0].slice(0,4)).toEqual([ENV.MCW_HERDR_BINARY,'pane','report-metadata','w1:p1'])
  const todos=[{content:'one',status:'completed',activeForm:'one'},{content:'two',status:'pending',activeForm:'two'}]
  const result=await $.tool.call({tool:'TodoWrite',todos});expect(result.text).toBe('unchanged')
  await $.session.measure({context:{window:200000,tokens:172000,percent:86},rateLimits:[],changed:['context']})
  await clock.advance(1000);expect(runs).toHaveLength(2)
  expect(runs[1]).toContain('mcw-progress=normal|50');expect(runs[1]).toContain('mcw-ctx=red|ctx 86%')
  expect(runs[1].filter(value=>value==='--token'||value==='--clear-token')).toHaveLength(7)
  await clock.advance(45000);expect(runs.length>=3).toBe(true)
  await $.session.end({sessionId:'attempt',reason:'exit'});await clock.advance(1000)
  expect(runs.at(-1)?.filter(value=>value==='--clear-token')).toHaveLength(7)
  const count=runs.length;await clock.advance(100000);expect(runs).toHaveLength(count)
})
