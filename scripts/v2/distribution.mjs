import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseVersionProperties} from '../prepare-mobile-shell.mjs';

/** CI verifies the signing certificate before preparing this artifact. This check
 * binds the bundled bytes to that manifest; it is not an Android functional test. */
export async function verifyDistributionShell(root){
  const files=['build/mobile/shell.apk','build/mobile/shell.json','android/version.properties'];
  for(const file of files){const info=await lstat(path.join(root,file));if(!info.isFile()||info.isSymbolicLink())throw new Error('Distribution shell must be a regular file');}
  const [apk,json,properties]=await Promise.all(files.map(file=>readFile(path.join(root,file))));
  const manifest=JSON.parse(json.toString('utf8')),version=parseVersionProperties(properties.toString('utf8'));
  if(!manifest||Object.keys(manifest).sort().join(',')!=='sha256,versionCode,versionName'||manifest.versionCode!==version.versionCode||manifest.versionName!==version.versionName)throw new Error('Distribution shell version does not match the source');
  if(!/^[a-f0-9]{64}$/.test(manifest.sha256)||createHash('sha256').update(apk).digest('hex')!==manifest.sha256)throw new Error('Distribution shell digest changed');
  return manifest;
}
