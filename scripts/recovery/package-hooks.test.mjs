// @vitest-environment node
import {it as test} from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import hooks from './package-hooks.cjs';

test('Linux keeps the Electron payload and stages rescue before launching it',async()=>{
 assert.equal(typeof hooks.preparePackagedRescue,'function');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mcw-rescue-package-'));
 try{
  await fs.writeFile(path.join(root,'multi-cli-work'),'original-electron-bytes');
  await hooks.preparePackagedRescue({appOutDir:root,platform:'linux',executableName:'multi-cli-work'});
  assert.equal(await fs.readFile(path.join(root,'multi-cli-work.electron'),'utf8'),'original-electron-bytes');
  const wrapper=await fs.readFile(path.join(root,'multi-cli-work'),'utf8');
  assert.ok(wrapper.indexOf('startup-rescue.cjs')<wrapper.indexOf('exec "$app/multi-cli-work.electron"'));
  assert.match(wrapper,/stage .*\|\| exit/);
  assert.match(wrapper,/"\$@"/);
  assert.doesNotMatch(wrapper,/unset APPIMAGE/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
