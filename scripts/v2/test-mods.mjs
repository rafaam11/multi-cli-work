import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const directory=await fs.mkdtemp(path.join(root,'.cache/mod-engine-'));
await fs.cp(path.join(root,'build/v2/mods/mcw-chips-v2'),directory,{recursive:true});
await fs.copyFile(path.join(root,'mods/mcw-chips-v2/tests/register.fixture.ts'),path.join(directory,'hooks/register.test.ts'));
execFileSync(process.platform==='win32'?'claude.exe':'claude',['plugin','test',directory],{stdio:'inherit',windowsHide:true,timeout:60000});
