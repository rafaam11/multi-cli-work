// @vitest-environment node
import {expect,it} from 'vitest';
import {originalInstallTarget} from './install-target';
it('uses the fixed payload directory in the original deb even from a preview installation',()=>{
  expect(originalInstallTarget('linux','/opt/Multi CLI Work Preview/multi-cli-work')).toEqual({platform:'deb',installDirectory:'/opt/Multi CLI Work',executablePath:'/opt/Multi CLI Work/multi-cli-work'});
});
it('retains the selected Windows install folder and original executable name',()=>{
  expect(originalInstallTarget('win32','C:\\MCW\\Multi CLI Work Preview.exe')).toEqual({platform:'win32',installDirectory:'C:\\MCW',executablePath:'C:\\MCW\\Multi CLI Work.exe'});
});
it('replaces the selected AppImage file rather than its temporary mount',()=>{
  expect(originalInstallTarget('linux','/tmp/.mount-XYZ/multi-cli-work','/home/user/apps/MCW.AppImage')).toEqual({platform:'appimage',installDirectory:'/home/user/apps/MCW.AppImage',executablePath:'/home/user/apps/MCW.AppImage'});
  expect(()=>originalInstallTarget('linux','/tmp/mount/app','relative.AppImage')).toThrow();
});
