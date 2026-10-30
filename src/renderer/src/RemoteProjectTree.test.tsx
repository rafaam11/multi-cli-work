import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {RemoteProjectTree} from './RemoteProjectTree';
afterEach(cleanup);
it('uses the explicit host catalog mapping and opens only the observed remote session',async()=>{
 const session={id:'view',cwd:'/checkout/worktree',remote:{hostId:'pc',name:'Lab',sessionId:'s',projectId:'repo',connected:true}} as any;
 const api={executionCatalog:vi.fn(async()=>({repositories:[{id:'repo',name:'Code',path:'/checkout',projectId:'rp'}]}))} as any,open=vi.fn();
 render(<RemoteProjectTree links={[{hostId:'pc',projectId:'rp',projectName:'Research'}]} sessions={[session]} api={api} onSelectSession={open}/>);
 expect(await screen.findByText('/checkout/worktree')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'s 터미널 열기'}));expect(open).toHaveBeenCalledWith(session);
});
it('shows only last verified linked-project sessions when mounted offline',async()=>{
 const repo={id:'repo',name:'Code',path:'/checkout',projectId:'rp',projectName:'Research'};
 const session={id:'view',kind:'codex',cwd:'/checkout/wt',remote:{hostId:'pc',name:'Lab',sessionId:'s',projectId:'repo',connected:false,repository:repo}} as any;
 const other={...session,id:'other',remote:{...session.remote,sessionId:'other',projectId:'other',repository:{...repo,id:'other',projectId:'else'}}};
 const api={executionCatalog:vi.fn(async()=>{throw Error('offline');})} as any;
 render(<RemoteProjectTree links={[{hostId:'pc',projectId:'rp',projectName:'Research'}]} sessions={[session,other]} api={api} onSelectSession={vi.fn()}/>);
 expect(await screen.findByText('/checkout/wt')).toBeInTheDocument();expect(screen.getByRole('button',{name:'s 터미널 열기'})).toHaveTextContent('연결 끊김');expect(screen.queryByRole('button',{name:'other 터미널 열기'})).not.toBeInTheDocument();
});
it('renders observed sessions with the shared sidebar row and original identity',async()=>{
 const repo={id:'repo',name:'Code',path:'/checkout',projectId:'rp',projectName:'Research'};
 const session={id:'mcwr-opaque',projectId:null,kind:'codex',cwd:'/checkout/wt',remote:{hostId:'pc',name:'Lab',sessionId:'s',projectId:'repo',connected:false,repository:repo}} as any;
 const renderSession=vi.fn((value:any)=><li key={value.id}><button>Codex 세션 열기</button></li>);
 render(<RemoteProjectTree links={[{hostId:'pc',projectId:'rp',projectName:'Research'}]} sessions={[session]} api={{executionCatalog:async()=>{throw Error('offline');}} as any} onSelectSession={vi.fn()} renderSession={renderSession}/>);
 expect(await screen.findByRole('button',{name:'Codex 세션 열기'})).toBeInTheDocument();
 expect(renderSession).toHaveBeenCalledWith(session,[session]);
 expect(screen.queryByText(/mcwr-opaque/)).not.toBeInTheDocument();
});
