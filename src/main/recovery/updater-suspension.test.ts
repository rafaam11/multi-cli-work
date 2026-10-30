// @vitest-environment node
import {expect,it,vi} from 'vitest';
const updater=vi.hoisted(()=>({autoDownload:true,autoInstallOnAppQuit:true,checkForUpdates:vi.fn(),quitAndInstall:vi.fn()}));
vi.mock('electron-updater',()=>({default:{autoUpdater:updater}}));
vi.mock('electron',()=>({app:{isPackaged:true},shell:{}}));
import {suspendUpdaterForRecovery,checkForUpdates,quitAndInstall} from '../updater';
it('suppresses the updater quit hook and explicit installs throughout recovery',async()=>{
  const resume=suspendUpdaterForRecovery();
  expect(updater.autoDownload).toBe(false);expect(updater.autoInstallOnAppQuit).toBe(false);
  await expect(checkForUpdates()).rejects.toThrow('복귀');expect(()=>quitAndInstall()).toThrow('복귀');
  expect(updater.checkForUpdates).not.toHaveBeenCalled();expect(updater.quitAndInstall).not.toHaveBeenCalled();
  resume();expect(updater.autoDownload).toBe(true);expect(updater.autoInstallOnAppQuit).toBe(true);
});
