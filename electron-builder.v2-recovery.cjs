// Isolated original-installation roundtrip candidate. Never published or used
// as latest; matching the production identity is essential to test an upgrade.
const preview = require('./electron-builder.v2-preview.cjs');
const original = require('./package.json').build;
module.exports = {
  ...preview,
  appId: original.appId,
  productName: original.productName,
  directories: { output: 'release-v2-recovery' },
  win: { ...preview.win, artifactName: 'MCW-Recovery-Candidate-${version}-${arch}.${ext}' },
  linux: { ...preview.linux, artifactName: 'MCW-Recovery-Candidate-${version}-${arch}.${ext}', desktop: original.linux.desktop },
  nsis: { ...original.nsis, shortcutName: original.productName },
  publish: null,
};
