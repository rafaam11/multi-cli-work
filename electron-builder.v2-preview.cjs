const base = require('./package.json').build;
const windows = process.platform === 'win32';
module.exports = {
  ...base,
  appId: 'com.rafaam11.multicliwork.preview',
  productName: 'Multi CLI Work Preview',
  extraMetadata: { version: '2.0.0-preview.0' },
  directories: { output: 'release-v2-preview' },
  files: ['out/**', '!out/main/jk-mcp.js', '!out/main/terminal-worker.js', '!out/main/mcw-host.js', '!out/main/mcw-task-mcp-client.js', '!node_modules/node-pty/**'],
  extraResources: [
    { from: 'build/v2', to: 'v2', filter: ['assets.json', 'host/**', 'mods/**', ...(windows ? ['herdr/windows-mcw/**', 'node/windows/**', 'recovery/*.exe'] : ['herdr/herdr-linux-x86_64', 'node/linux/**', 'recovery/*.deb', 'recovery/*.AppImage'])] },
    { from: `build/herdr-bridge/${process.platform}-${process.arch}`, to: 'herdr-bridge' },
    { from: 'scripts/recovery', to: 'recovery-scripts', filter: ['core.mjs', 'recover.mjs'] },
  ],
  win: { ...base.win, signExecutable: false, artifactName: 'Multi-CLI-Work-Preview-${version}-${arch}.${ext}' },
  linux: { ...base.linux, artifactName: 'Multi-CLI-Work-Preview-${version}-${arch}.${ext}', desktop: {entry:{...base.linux.desktop.entry,Name:'Multi CLI Work Preview'}} },
  nsis: { ...base.nsis, shortcutName: 'Multi CLI Work Preview' },
  publish: null,
};
