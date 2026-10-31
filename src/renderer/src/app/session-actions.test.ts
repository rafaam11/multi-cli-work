import {expect,it,vi} from 'vitest';
import {createSessionActions,type SessionContext} from './session-actions';
import type {TerminalSessionView} from '@shared/api-types';
import type {SlotViewState} from '@shared/app-state-types';

it('places a resumed legacy successor in the original pane without deleting its record',async()=>{
  const original={id:'old',projectId:'p'} as TerminalSessionView;
  const successor={...original,id:'continued'};
  let sessions=[original],view:SlotViewState={layoutId:'2x2',slots:['other','old',null,'continued']};
  const context={selectedSession:original,isProjectMissing:()=>false,setPendingAction:vi.fn(),setActionError:vi.fn(),
    setSessions:(update:any)=>{sessions=update(sessions);},persistSelection:vi.fn(),focusPane:vi.fn(),
    placePaneOnCurrentView:(_id:string,update:(view:SlotViewState)=>SlotViewState)=>{view=update(view);}} as unknown as SessionContext;
  vi.stubGlobal('multiCliWork',{terminals:{resume:vi.fn(async()=>successor)}});
  try{
    await createSessionActions(context).resumeSession();
    expect(view.slots).toEqual(['other','continued',null,null]);
    expect(sessions).toEqual([original,successor]);
    expect(context.focusPane).toHaveBeenCalledWith('continued');
    expect(context.persistSelection).toHaveBeenCalledWith('p','continued');
    expect(context.setActionError).toHaveBeenCalledTimes(1);
  }finally{vi.unstubAllGlobals();}
});
