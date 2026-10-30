import {extractFile,listPackage} from '@electron/asar';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

/** Check the bytes shipped in the ASAR, not the source output directory. An
 * entry point excluded by packaging can still be imported by a shared chunk. */
export async function checkPackagedMain(archive){
  const entries=listPackage(archive),files=new Map(entries.map(file=>[file.replaceAll('\\','/').replace(/^\//,''),file.replace(/^[/\\]/,'')]));
  const metadata=JSON.parse(extractFile(archive,'package.json').toString('utf8'));
  if(typeof metadata.main!=='string'||!metadata.main.startsWith('out/main/')||!files.has(metadata.main))throw new Error('Packaged desktop entry is missing');
  const modules=[...files.keys()].filter(file=>file.startsWith('out/main/')&&file.endsWith('.js'));
  for(const filename of modules){
    const source=extractFile(archive,files.get(filename)).toString('utf8');
    for(const match of source.matchAll(/\brequire\(\s*(['"])(\.{1,2}\/[^'"\\]+)\1\s*\)/g)){
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(filename),match[2]));
      if(![target,`${target}.js`,`${target}.json`,`${target}/index.js`].some(candidate=>files.has(candidate)))throw new Error(`Packaged ${filename} requires missing ${match[2]}`);
    }
  }
  return {main:metadata.main,checkedModules:modules.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(!process.argv[2])throw new Error('Usage: check-packaged-main.mjs <app.asar>');
  console.log(JSON.stringify(await checkPackagedMain(path.resolve(process.argv[2]))));
}
