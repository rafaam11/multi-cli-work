import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {crc32} from 'node:zlib';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
// Coders the NSIS installer's 7z plugin can decode. Anything newer (ARM64, RISCV,
// ...) is skipped without an installer error, leaving a file missing on disk.
export const nsisDecodableMethods=new Set(['Copy','LZMA','LZMA2','BCJ','BCJ2']);
const signature=Buffer.from([0x37,0x7a,0xbc,0xaf,0x27,0x1c]);

/** Locate the app archive electron-builder embeds in its NSIS installer. */
export function embeddedArchive(installer){
  for(let offset=installer.indexOf(signature);offset>=0;offset=installer.indexOf(signature,offset+1)){
    if(offset+32>installer.length||installer.readUInt32LE(offset+8)!==crc32(installer.subarray(offset+12,offset+32)))continue;
    const end=offset+32+Number(installer.readBigUInt64LE(offset+12))+Number(installer.readBigUInt64LE(offset+20));
    if(end<=installer.length)return installer.subarray(offset,end);
  }
  throw new Error('Installer does not contain an embedded 7z application archive');
}
/** Parse `7za l -slt` output into archive entries. */
export function parseListing(listing){
  const entries=[];let current=null,started=false;
  for(const line of listing.split(/\r?\n/)){
    // Archive-level properties precede the separator; entries follow it.
    if(line==='----------'){started=true;continue;}
    const match=started&&/^(Path|Method|Attributes) = (.*)$/.exec(line);if(!match)continue;
    if(match[1]==='Path'){current={path:match[2].replaceAll('\\','/'),method:'',directory:false};entries.push(current);}
    else if(current&&match[1]==='Method')current.method=match[2];
    else if(current)current.directory=match[2].startsWith('D');
  }
  return entries;
}
export function payloadProblems(entries,required){
  const problems=[];const files=new Set(entries.filter(entry=>!entry.directory).map(entry=>entry.path));
  for(const entry of entries){
    const unsupported=entry.method.split(' ').filter(Boolean).map(coder=>coder.split(':')[0]).filter(coder=>!nsisDecodableMethods.has(coder));
    if(unsupported.length)problems.push(`${entry.path}: ${unsupported.join(', ')} cannot be extracted by the NSIS installer`);
  }
  for(const file of required)if(!files.has(file))problems.push(`${file}: missing from the installer`);
  return problems;
}
export async function checkNsisPayload(installerPath,{sevenZip}={}){
  const manifest=JSON.parse(await readFile(path.join(root,'scripts/v2/assets.json'),'utf8'));
  const required=manifest.windowsMembers.map(member=>`resources/v2/herdr/windows-mcw/${member.file}`);
  const scratch=await mkdtemp(path.join(tmpdir(),'mcw-nsis-payload-'));
  try{
    const archive=path.join(scratch,'app.7z');await writeFile(archive,embeddedArchive(await readFile(installerPath)));
    const executable=sevenZip??await createRequire(import.meta.url)('app-builder-lib/out/toolsets/7zip').getPath7za();
    const entries=parseListing(execFileSync(executable,['l','-slt',archive],{encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true}));
    const problems=payloadProblems(entries,required);
    if(problems.length)throw new Error(`Installer payload would install incompletely:\n${problems.join('\n')}`);
    return {entries:entries.length,required:required.length};
  }finally{await rm(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(!process.argv[2])throw new Error('Usage: check-nsis-payload.mjs <installer.exe>');
  console.log(JSON.stringify(await checkNsisPayload(path.resolve(process.argv[2]))));
}
