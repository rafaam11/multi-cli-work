export function quitAndInstallArguments(platform: NodeJS.Platform): [boolean, boolean] {
  return [platform === "win32", true];
}
