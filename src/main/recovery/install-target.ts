import path from 'node:path';
import type {RecoveryInstallerPlatform} from '../../shared/recovery-types';

export function originalInstallTarget(platform:NodeJS.Platform,executable:string,appImage?:string):{platform:RecoveryInstallerPlatform;installDirectory:string;executablePath:string}{
  if(platform==='win32'){
    if(!path.win32.isAbsolute(executable))throw new Error('Absolute installation path required');
    const installDirectory=path.win32.dirname(executable);return {platform:'win32',installDirectory,executablePath:path.win32.join(installDirectory,'Multi CLI Work.exe')};
  }
  if(platform!=='linux')throw new Error('Unsupported recovery platform');
  if(appImage){if(!path.posix.isAbsolute(appImage))throw new Error('Absolute AppImage path required');return {platform:'appimage',installDirectory:appImage,executablePath:appImage};}
  // The digest-pinned v1.55.1 deb installs here, independently of v2's location.
  return {platform:'deb',installDirectory:'/opt/Multi CLI Work',executablePath:'/opt/Multi CLI Work/multi-cli-work'};
}
