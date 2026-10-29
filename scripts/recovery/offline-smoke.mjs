#!/usr/bin/env node
// Real original-asset + isolated-runner smoke. Never installs software or accesses live app data.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createV1Backup, prepareRollback, stageRecoveryAssets, verifyRecoveryAssets, ORIGINAL_INSTALLERS } from './core.mjs';

const [resourcesRoot, runtimeExecutable, runtimeSha256] = process.argv.slice(2);
if (!resourcesRoot || !runtimeExecutable || !runtimeSha256) throw new Error('Usage: offline-smoke.mjs <build/v2> <standalone-node-executable> <pinned-node-sha256>');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'mcw-offline-smoke-'));
try {
  const userData = path.join(temporary, 'source-user'); const registry = path.join(temporary, 'source-registry');
  await mkdir(path.join(userData, 'Local Storage'), { recursive: true }); await mkdir(registry);
  await writeFile(path.join(userData, 'Local Storage', 'proof'), 'offline-original-v1');
  await writeFile(path.join(registry, 'settings.json'), '{"general":{"autoCheckUpdates":true,"autoResumeSessions":true,"repoSyncOnSessionStart":true}}');
  const backup = path.join(temporary, 'backup'); await createV1Backup({ destination: backup, sources: { userData, registry }, assertStopped: async () => {} });
  const offline = path.join(temporary, 'outside-install-recovery');
  const installers = Object.fromEntries(Object.entries(ORIGINAL_INSTALLERS).map(([platform, asset]) => [platform, path.resolve(resourcesRoot, 'recovery', asset.filename)]));
  const staged = await stageRecoveryAssets({ destination: offline, installDirectory: path.join(temporary, 'replaceable-install'), installers, runtimeExecutable: path.resolve(runtimeExecutable), runtimeSha256, scriptDirectory: path.dirname(fileURLToPath(import.meta.url)) });
  const platform = process.platform === 'win32' ? 'win32' : 'appimage'; await verifyRecoveryAssets(offline, platform);
  const node = path.join(offline, staged.runtimeName); const runner = path.join(offline, 'recover.mjs');
  const run = async (...args) => JSON.parse((await promisify(execFile)(node, [runner, ...args], { windowsHide: true, timeout: 30_000 })).stdout);
  assert.equal((await run('verify', backup)).version, '1.55.1');
  const prepared = path.join(temporary, 'prepared');
  await prepareRollback({ backupDirectory: backup, destination: prepared, preserveV2Sources: {}, expectedHostIds: ['temp-fixture'], hosts: [{ hostId: 'temp-fixture', state: 'stopped', observedAt: Date.now() }], assertStopped: async () => {} });
  assert.equal((await run('verify-prepared', prepared)).version, '1.55.1');
  console.log(JSON.stringify({ platform: process.platform, originalInstallersVerified: staged.installers, isolatedRuntime: await run('runtime-smoke'), backupVerified: true, preparedCopyVerified: true, installerExecuted: false, installedRoundtripVerified: false }, null, 2));
} finally {
  const resolved = await realpath(temporary); const temporaryBase = await realpath(os.tmpdir());
  assert.equal(path.dirname(resolved).toLowerCase(), temporaryBase.toLowerCase()); assert.match(path.basename(resolved), /^mcw-offline-smoke-/);
  await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
}
