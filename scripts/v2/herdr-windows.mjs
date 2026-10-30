// MCW's narrowly patched Herdr build. The official downloaded archive stays intact.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,copyFile,cp,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {downloadAsset} from './assets.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const sourceCommit='2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01';
const sourcePath='src/platform/windows.rs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function patchWindowsSignals(source){
  const start=source.indexOf('pub fn signal_processes('),end=source.indexOf('\npub fn process_exists(',start);
  if(start<0||end<=start)throw new Error('Pinned Windows signal implementation changed');
  const body=source.slice(start,end),before='ProcessHandle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION)';
  if(body.split(before).length!==2)throw new Error('Windows signal handle differs from pinned source');
  return source.slice(0,start)+body.replace(before,'ProcessHandle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION | windows_sys::Win32::System::Threading::PROCESS_TERMINATE)')+source.slice(end);
}
export function patchWindowsProcessTree(source){
  const start=source.indexOf('fn session_processes_from_snapshot('),end=source.indexOf('\npub fn signal_processes(',start);
  if(start<0||end<=start||source.slice(start,end).includes('verified_births'))throw new Error('Pinned Windows shutdown tree differs');
  return source.slice(0,start)+`fn session_processes_from_snapshot(child_pid: u32, snapshot: &ProcessSnapshot) -> Vec<u32> {
    let Some(root_birth) = process_start_token(child_pid) else { return Vec::new(); };
    if snapshot.entry(child_pid).is_none() { return Vec::new(); }
    // MCW: historical parent PIDs can name a newer, unrelated process on Windows.
    // Do not signal a descendant whose creation predates its claimed parent.
    let mut verified_births = HashMap::from([(child_pid, root_birth)]);
    let mut queue = VecDeque::from([child_pid]);
    let mut pids = vec![child_pid];
    while let Some(parent_pid) = queue.pop_front() {
        let Some(&parent_birth) = verified_births.get(&parent_pid) else { continue; };
        if let Some(children) = snapshot.children_by_parent.get(&parent_pid) {
            for &index in children {
                let entry = &snapshot.entries[index];
                if verified_births.contains_key(&entry.pid) { continue; }
                let Some(birth) = process_start_token(entry.pid) else { continue; };
                if birth < parent_birth { continue; }
                verified_births.insert(entry.pid, birth);
                queue.push_back(entry.pid);
                pids.push(entry.pid);
            }
        }
    }
    pids
}
`+source.slice(end);
}
const run=(exe,args,cwd=root,env=process.env)=>execFileSync(exe,args,{cwd,env,windowsHide:true,stdio:'inherit'});
const capture=(exe,args,cwd)=>execFileSync(exe,args,{cwd,windowsHide:true,encoding:'utf8'}).trim();
const exists=async file=>{try{await access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
export async function buildWindowsHerdr(){
  if(process.platform!=='win32')return;
  const cache=path.join(root,'.cache'),source=path.join(cache,'herdr-windows-source');
  await mkdir(cache,{recursive:true});
  if(!await exists(path.join(source,'.git'))){
    const seed=path.join(cache,'herdr');
    if(await exists(path.join(seed,'.git'))&&capture('git',['rev-parse','HEAD'],seed)===sourceCommit)run('git',['clone','--no-hardlinks','--no-checkout',seed,source]);
    else {await mkdir(source,{recursive:true});run('git',['init'],source);run('git',['remote','add','origin','https://github.com/herdrdev/herdr.git'],source);run('git',['fetch','--depth','1','origin',sourceCommit],source);}
    run('git',['checkout','--detach',sourceCommit],source);
  }
  if(capture('git',['rev-parse','HEAD'],source)!==sourceCommit)throw new Error('Managed Herdr checkout is not the pinned revision');
  const original=execFileSync('git',['show',`${sourceCommit}:${sourcePath}`],{cwd:source,encoding:'utf8'});
  const patched=patchWindowsSignals(patchWindowsProcessTree(original));
  const current=await readFile(path.join(source,sourcePath),'utf8');
  if(![original,patched,patchWindowsSignals(original)].includes(current.replaceAll('\r\n','\n')))throw new Error('Managed Herdr source contains unrecognized changes');
  const changes=capture('git',['diff','--name-only','HEAD'],source).split(/\r?\n/).filter(Boolean);
  if(changes.some(file=>file!==sourcePath))throw new Error('Managed Herdr checkout has unrelated tracked changes');
  if(current!==patched)await writeFile(path.join(source,sourcePath),patched);
  const zigAsset={id:'zig-0.16.0-windows',bytes:97217739,sha256:'68659eb5f1e4eb1437a722f1dd889c5a322c9954607f5edcf337bc3684a75a7e',url:'https://ziglang.org/download/0.16.0/zig-x86_64-windows-0.16.0.zip'};
  const archive=path.join(cache,'zig-x86_64-windows-0.16.0.zip'),zig=path.join(cache,'zig-x86_64-windows-0.16.0','zig.exe');
  await downloadAsset(zigAsset,archive);
  if(!await exists(zig))run('tar',['-xf',archive,'-C',cache]);
  if(capture(zig,['version'],root)!=='0.16.0')throw new Error('Incorrect Zig compiler');
  const env={...process.env,ZIG:zig,HERDR_BUILD_CHANNEL:'mcw',HERDR_BUILD_ID:'1',HERDR_BUILD_COMMIT:sourceCommit};
  run('cargo',['build','--release','--locked','--target','x86_64-pc-windows-msvc'],source,env);
  const output=path.join(root,'build/v2/herdr/windows-mcw');await mkdir(output,{recursive:true});
  // Retain the original pinned ConPTY runtime and its required notices.
  for(const directory of ['conpty','THIRD-PARTY-NOTICES'])await cp(path.join(root,'build/v2/herdr/windows',directory),path.join(output,directory),{recursive:true});
  const executable=path.join(output,'herdr.exe');
  await copyFile(path.join(source,'target/x86_64-pc-windows-msvc/release/herdr.exe'),executable);
  await copyFile(path.join(source,'LICENSE'),path.join(output,'LICENSE-HERDR'));
  await writeFile(path.join(output,'NOTICE-MCW.txt'),'Herdr 0.9.5, Apache-2.0, https://github.com/herdrdev/herdr\nMCW modifications: Windows explicit shutdown requests PROCESS_TERMINATE access and excludes historical parent-PID matches by creation time. No protocol change.\n');
  const bytes=await readFile(executable);
  const receipt={schemaVersion:1,version:'0.9.5',revision:'mcw.1',sourceCommit,sourcePath,sourceSha256:sha(original),patchedSourceSha256:sha(patched),recipeSha256:sha(await readFile(fileURLToPath(import.meta.url))),zigVersion:'0.16.0',zigArchiveSha256:zigAsset.sha256,rustc:capture('rustc',['--version'],source),bytes:bytes.length,sha256:sha(bytes)};
  await writeFile(path.join(output,'herdr-build.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log('Certified MCW Herdr Windows build:',receipt.revision,receipt.sha256);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))buildWindowsHerdr().catch(error=>{console.error(error.message);process.exitCode=1;});
