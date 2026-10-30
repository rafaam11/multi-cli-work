// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';
import {CheckoutAdmission} from './checkout-admission';
let roots:string[]=[];
afterEach(async()=>{for(const root of roots)await fs.rm(root,{recursive:true,force:true});roots=[];});
const owner={pid:10,parentPid:1,startId:'boot:10',name:'gui',executable:'/gui'};
async function fixture(){const root=await fs.mkdtemp(path.join(tmpdir(),'mcw-admission-'));roots.push(root);const cwd=path.join(root,'checkout');await fs.mkdir(cwd);const inventory=vi.fn(async()=>[owner]);return {root,cwd,inventory,guard:new CheckoutAdmission(root,inventory)};}
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
it('drains an in-flight launch and rejects overlapping launches through delayed stop and deletion, then reopens',async()=>{
 const {guard,cwd}=await fixture(), started=gate(), launch=gate(), stop=gate(), deletion=gate();let removed=false;
 const running=guard.launch(cwd,async()=>{started.resolve();await launch.promise;});await started.promise;
 const holding=guard.acquire(cwd,'lease',10);let acquired=false;void holding.then(()=>acquired=true);await Promise.resolve();expect(acquired).toBe(false);
 launch.resolve();await running;await holding;
 const removal=(async()=>{await stop.promise;await deletion.promise;removed=true;await guard.release('lease');})();
 await expect(guard.launch(path.join(cwd,'subdir'),async()=>{})).rejects.toThrow(/removal/);
 stop.resolve();await Promise.resolve();expect(removed).toBe(false);
 await expect(guard.launch(cwd,async()=>{})).rejects.toThrow(/removal/);
 deletion.resolve();await removal;await expect(guard.launch(cwd,async()=>42)).resolves.toBe(42);
});
it('keeps durable holds after restart and allows explicit retry only when the prior GUI birth identity is gone',async()=>{
 const {guard,cwd,root,inventory}=await fixture();await guard.acquire(cwd,'old',10);
 const restarted=new CheckoutAdmission(root,inventory);
 await expect(restarted.launch(cwd,async()=>{})).rejects.toThrow(/removal/);
 await expect(restarted.acquire(cwd,'new',10)).rejects.toThrow(/owner/);
 inventory.mockResolvedValue([{...owner,startId:'boot:11'}]);
 await restarted.acquire(cwd,'new',10);
 await restarted.release('old'); // Superseded operation release cannot release the new hold.
 await expect(restarted.launch(cwd,async()=>{})).rejects.toThrow(/removal/);
 await restarted.release('new');await expect(restarted.launch(cwd,async()=>true)).resolves.toBe(true);
});
it('fails closed on unavailable process identity or corrupt persisted state',async()=>{
 const {guard,cwd,root,inventory}=await fixture();await guard.acquire(cwd,'old',10);
 inventory.mockRejectedValue(new Error('unavailable'));await expect(guard.acquire(cwd,'new',10)).rejects.toThrow('unavailable');
 await expect(guard.launch(cwd,async()=>{})).rejects.toThrow(/removal/);
 await fs.writeFile(path.join(root,'checkout-removal-holds.json'),'{');
 await expect(new CheckoutAdmission(root,inventory).launch(cwd,async()=>{})).rejects.toThrow();
});

it('canonicalizes checkout aliases and keeps unrelated checkouts admitted',async()=>{
 const {guard,cwd,root}=await fixture();const alias=path.join(root,'alias');
 await fs.symlink(cwd,alias,process.platform==='win32'?'junction':'dir');
 await guard.acquire(alias,'alias-lease',10);
 await expect(guard.launch(cwd,async()=>{})).rejects.toThrow(/removal/);
 await expect(guard.launch(path.join(alias,'nested'),async()=>{})).rejects.toThrow(/removal/);
 await expect(guard.launch(path.join(root,'unrelated'),async()=>true)).resolves.toBe(true);
 await guard.release('alias-lease');
});

it('requires native boot change to settle a host crash during Git deletion, even after the GUI exited',async()=>{
 const {guard,cwd,root,inventory}=await fixture();await guard.acquire(cwd,'operation',10);
 const file=path.join(root,'checkout-removal-holds.json'),state=JSON.parse(await fs.readFile(file,'utf8'));
 state.holds[0].git={state:'running',bootId:'old-boot'};await fs.writeFile(file,JSON.stringify(state));
 inventory.mockResolvedValue([{...owner,pid:20,startId:'boot:20'},{...owner,pid:30,parentPid:1,startId:'boot:30',name:'orphaned-git'}]);
 const boot=vi.fn(async()=> 'old-boot'),restarted=new CheckoutAdmission(root,inventory,boot);
 await expect(restarted.acquire(cwd,'operation',20)).rejects.toThrow(/Restart this PC/);
 await expect(restarted.release('operation')).rejects.toThrow(/Restart this PC/);
 await expect(restarted.launch(cwd,async()=>{})).rejects.toThrow(/removal/);
 // Even a missing GUI and a reparented child cannot count as safe exit proof.
 boot.mockResolvedValue('new-boot');inventory.mockResolvedValue([{...owner,pid:20,startId:'newboot:20'}]);
 await restarted.acquire(cwd,'operation',20);await restarted.release('operation');
 await expect(restarted.launch(cwd,async()=>true)).resolves.toBe(true);
});
it('release is idempotent and never clears a newer operation at the same path',async()=>{
 const {guard,cwd}=await fixture();await guard.acquire(cwd,'first',10);await guard.release('first');
 await guard.acquire(cwd,'next',10);await guard.release('first');
 await expect(guard.launch(cwd,async()=>{})).rejects.toThrow(/removal/);
 await expect(guard.acquire(cwd,'first',10)).rejects.toThrow(/already released/);
 await guard.release('next');
});
