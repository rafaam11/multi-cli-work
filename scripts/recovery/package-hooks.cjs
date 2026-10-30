const fs=require('node:fs/promises');
const path=require('node:path');

async function preparePackagedRescue({appOutDir,platform,executableName,buildResourcesDir}){
 if(!/^[\w.-]+$/.test(executableName))throw new Error('Unsafe packaged executable name');
 if(platform==='linux'){
  const executable=path.join(appOutDir,executableName),payload=`${executable}.electron`;
  await fs.access(payload).then(()=>{throw new Error('Electron rescue wrapper already exists');},error=>{if(error.code!=='ENOENT')throw error;});
  await fs.rename(executable,payload);
  // Both /usr/bin symlinks and AppImage AppRun enter this wrapper. Keep APPIMAGE
  // so the rescue target is the real image, never its temporary mount.
  const wrapper=`#!/bin/sh\nset -eu\napp=$(dirname -- "$(readlink -f -- "$0")")\n"$app/resources/v2/node/linux/node" "$app/resources/v2/host/startup-rescue.cjs" stage "$app/resources" "$app/${executableName}.electron" || exit $?\nexec "$app/${executableName}.electron" "$@"\n`;
  await fs.writeFile(executable,wrapper,{flag:'wx',mode:0o755});
 }else if(platform==='win32'){
  // Embedded separately in NSIS, available BEFORE uninstallOldVersion. Runtime
  // verification copies this kit outside INSTDIR before any replacement.
  const destination=path.join(buildResourcesDir,'v2-preinstall');
  await fs.mkdir(destination,{recursive:true});
  for(const file of ['v2/assets.json','v2/node/windows/node.exe','v2/host/recovery-controller.cjs','v2/host/startup-rescue.cjs','v2/recovery/Multi-CLI-Work-Setup-1.55.1.exe','herdr-bridge/bridge.json','herdr-bridge/mcw-herdr-bridge.exe','recovery-scripts/core.mjs','recovery-scripts/recover.mjs']){
   const target=path.join(destination,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(appOutDir,'resources',file),target);
  }
 }
}
module.exports=async context=>preparePackagedRescue({appOutDir:context.appOutDir,platform:context.electronPlatformName,executableName:context.electronPlatformName==='linux'?context.packager.executableName:'Multi-CLI-Work',buildResourcesDir:context.packager.buildResourcesDir});
module.exports.preparePackagedRescue=preparePackagedRescue;
