// @vitest-environment node
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {finished} from 'node:stream/promises';
import {createPackage} from '@electron/asar';
import {afterEach,expect,it} from 'vitest';
import {checkPackagedMain} from './check-packaged-main.mjs';
const roots=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('rejects a required desktop module excluded from the actual ASAR, before GUI startup',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mcw-packaged-main-'));roots.push(root);
  const app=path.join(root,'app');await mkdir(path.join(app,'out/main'),{recursive:true});
  await writeFile(path.join(app,'package.json'),JSON.stringify({main:'out/main/index.js'}));
  await writeFile(path.join(app,'out/main/index.js'),'require("./common.js");');
  await writeFile(path.join(app,'out/main/common.js'),'require("node:fs"); require("./mcw-task-mcp-client.js");');
  // asar 3 resolves with an ended WriteStream before its writes have flushed.
  // Reading then can return zero-filled file bodies on the Windows runner.
  const broken=path.join(root,'broken.asar');await finished(await createPackage(app,broken));
  await expect(checkPackagedMain(broken)).rejects.toThrow(/mcw-task-mcp-client/);
  await writeFile(path.join(app,'out/main/common.js'),'require("node:fs");');
  const fixed=path.join(root,'fixed.asar');await finished(await createPackage(app,fixed));
  expect(await checkPackagedMain(fixed)).toEqual({main:'out/main/index.js',checkedModules:2});
});
