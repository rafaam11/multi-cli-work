#!/usr/bin/env node
/** Offline entry point. Mutating stopped data requires a trusted, live lifecycle controller. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertRollbackHosts, createV1Backup, verifyV1Backup, verifyModBackup, prepareRollback, activatePreparedRollback, stageRecoveryAssets, verifyRecoveryAssets, verifyPreparedRollback, coordinateRollback } from './core.mjs';

async function main() {
  const [command, target, platform] = process.argv.slice(2);
  if (command === 'runtime-smoke') {
    if (process.versions.electron) throw new Error('Standalone Node runtime required');
    return { version: process.versions.node, electron: false, recovery: 'ready' };
  }
  if (command === 'verify') return verifyV1Backup(target);
  if (command === 'verify-mods') return verifyModBackup(target);
  if (command === 'verify-prepared') return verifyPreparedRollback(target);
  if (command === 'verify-assets') return verifyRecoveryAssets(target, platform);
  if (!['backup', 'prepare', 'activate', 'rollback', 'stage-assets'].includes(command) || !target) throw new Error('Usage: recover.mjs verify <backup> | verify-mods <mod-backup> | verify-prepared <directory> | verify-assets <assets> <win32|deb|appimage> | backup|prepare|activate|rollback|stage-assets <request.json>');
  const options = JSON.parse(await readFile(target, 'utf8'));
  if (command === 'stage-assets') return stageRecoveryAssets(options);
  if (typeof options.controllerModule !== 'string' || !path.isAbsolute(options.controllerModule)) throw new Error('A trusted absolute controllerModule with live host/process checks is required; static stopped-state claims are insufficient');
  const controller = await import(pathToFileURL(options.controllerModule).href);
  if (typeof controller.createAdapter !== 'function') throw new Error('Lifecycle controller must export createAdapter(options)');
  const adapter = await controller.createAdapter(options);
  if (command === 'rollback') return coordinateRollback({ ...options, adapter });
  if (typeof adapter?.assertNoInstances !== 'function') throw new Error('Lifecycle controller must verify residual instances');
  if (command === 'backup') return createV1Backup({ ...options, assertStopped: () => adapter.assertNoInstances() });
  if (command === 'activate') return activatePreparedRollback({ ...options, assertStopped: () => adapter.assertNoInstances() });
  if (typeof adapter.stopNewWork !== 'function' || typeof adapter.observeHosts !== 'function' || typeof adapter.gracefulStop !== 'function') throw new Error('Lifecycle controller must stop new work, observe every host, and gracefully stop processes');
  await adapter.stopNewWork(); const hosts = await adapter.observeHosts(); assertRollbackHosts({ hosts, expectedHostIds: options.expectedHostIds });
  await adapter.gracefulStop(); await adapter.assertNoInstances();
  return prepareRollback({ ...options, hosts, assertStopped: () => adapter.assertNoInstances() });
}
main().then(result => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); }).catch(error => { process.stderr.write(`Recovery blocked: ${error.message}\n`); process.exitCode = 1; });
