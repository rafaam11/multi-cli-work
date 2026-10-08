export function quitAndInstallArguments(platform: NodeJS.Platform): [boolean, boolean] {
  return [platform === "win32", true];
}

export interface ConfigurableUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  disableWebInstaller: boolean;
}

export function configureAutoUpdater(updater: ConfigurableUpdater): void {
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  // We ship the full NSIS installer only. Left false, the NSIS updater logs a warning on every run.
  updater.disableWebInstaller = true;
}
