// @vitest-environment node
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { bridgeArtifact, bridgeBuildArgs } from './build-herdr-bridge.mjs';

test('bridge build uses the checked lockfile and release profile', () => {
  assert.deepEqual(bridgeBuildArgs(), ['build', '--locked', '--release']);
  assert.deepEqual(bridgeBuildArgs({ target: 'x86_64-unknown-linux-gnu', debug: true }), ['build', '--locked', '--target', 'x86_64-unknown-linux-gnu']);
});

test('bridge artifacts identify the actual target rather than the build host', () => {
  assert.deepEqual(bridgeArtifact('x86_64-pc-windows-msvc'), { platform: 'win32', arch: 'x64', executable: 'mcw-herdr-bridge.exe' });
  assert.deepEqual(bridgeArtifact('aarch64-unknown-linux-gnu'), { platform: 'linux', arch: 'arm64', executable: 'mcw-herdr-bridge' });
  assert.throws(() => bridgeArtifact('../../outside'), /unsupported/);
});
