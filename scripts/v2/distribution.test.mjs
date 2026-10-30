// @vitest-environment node
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {shellManifest} from '../prepare-mobile-shell.mjs';
import {verifyDistributionShell} from './distribution.mjs';
import stable from '../../electron-builder.v2.cjs';
import preview from '../../electron-builder.v2-preview.cjs';
it('keeps independent pre-replacement recovery in the stable installed identity',()=>{
  expect(stable.nsis.include).toBe('build/v2-installer.nsh');
  expect(stable.afterPack).toBe(preview.afterPack);
  expect(stable.productName).toBe('Multi CLI Work');
});
const roots=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('refuses a missing, changed or stale shell before producing a stable desktop package',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mcw-dist-'));roots.push(root);
  await mkdir(path.join(root,'android'));await mkdir(path.join(root,'build/mobile'),{recursive:true});
  await writeFile(path.join(root,'android/version.properties'),'shellVersionCode=4\nshellVersionName=0.3.0\n');
  await expect(verifyDistributionShell(root)).rejects.toThrow();
  const bytes=Buffer.from('signed APK supplied by CI'),manifest=shellManifest({versionCode:4,versionName:'0.3.0'},bytes);
  await writeFile(path.join(root,'build/mobile/shell.apk'),bytes);
  await writeFile(path.join(root,'build/mobile/shell.json'),JSON.stringify(manifest));
  expect(await verifyDistributionShell(root)).toEqual(manifest);
  await writeFile(path.join(root,'build/mobile/shell.apk'),'changed');
  await expect(verifyDistributionShell(root)).rejects.toThrow(/digest/);
  await writeFile(path.join(root,'build/mobile/shell.apk'),bytes);
  await writeFile(path.join(root,'android/version.properties'),'shellVersionCode=5\nshellVersionName=0.4.0\n');
  await expect(verifyDistributionShell(root)).rejects.toThrow(/version/);
});
