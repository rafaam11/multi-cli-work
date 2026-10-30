const base = require('./package.json').build;
const preview = require('./electron-builder.v2-preview.cjs');
// Same installed identity and artifact names preserve the v1 updater path.
// Resources/exclusions match the tested preview; only stable emits latest*.yml.
module.exports = {
  ...preview,
  appId: base.appId,
  productName: base.productName,
  extraMetadata: {},
  directories: base.directories,
  extraResources: [...preview.extraResources.filter(resource => resource.to !== 'mobile'), ...base.extraResources],
  win: base.win,
  linux: base.linux,
  nsis: base.nsis,
  publish: base.publish,
  beforePack: async () => {
    const {verifyDistributionShell} = await import('./scripts/v2/distribution.mjs');
    await verifyDistributionShell(__dirname);
  },
};
