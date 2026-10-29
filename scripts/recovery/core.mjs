/** Electron-free recovery engine. All mutations require explicit caller supplied paths. */
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

export const ORIGINAL_INSTALLERS = Object.freeze({
  win32: Object.freeze({ filename: 'Multi-CLI-Work-Setup-1.55.1.exe', sha256: '5d34ad8ad328d47dd425b2e4de193cf0ace0777d667578ad4abdddbc19bcc33f' }),
  deb: Object.freeze({ filename: 'Multi-CLI-Work-1.55.1-linux-x64.deb', sha256: 'f3a5c28ea7e853c7e5ae1bd104b2098dd3167f3238e548450e43c4591d8c7e0d' }),
  appimage: Object.freeze({ filename: 'Multi-CLI-Work-1.55.1-linux-x64.AppImage', sha256: '06912be8df57c5c680daaa7406c0eaaaed2795580dbdf0b96848c31f9cea7bdc' }),
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const labels = new Set(['userData', 'registry', 'remote', 'mods']);
const digestPattern = /^[a-f0-9]{64}$/;
const electronSingletonPaths = new Set(['userData/SingletonCookie','userData/SingletonLock','userData/SingletonSocket']);
function contains(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function disjoint(a, b) {
  if (contains(a, b) || contains(b, a)) throw new Error(`Recovery path overlap: ${a} / ${b}`);
}
function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.includes('\0') || value.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid manifest path');
  return value;
}
async function noLinks(candidate, allowMissing = false) {
  let current = path.resolve(candidate);
  for (;;) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symbolic link rejected: ${current}`); }
    catch (error) { if (!(allowMissing && error.code === 'ENOENT')) throw error; }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
async function absent(candidate) {
  try { await lstat(candidate); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Destination already exists: ${candidate}`);
}
async function freshDirectory(destination) {
  await noLinks(destination, true);
  await mkdir(path.dirname(path.resolve(destination)), { recursive: true, mode: 0o700 });
  await mkdir(destination, { mode: 0o700 });
  await writeFile(path.join(destination, '.incomplete'), 'Incomplete recovery operation. Never use as a verified backup.\n', { flag: 'wx', mode: 0o600 });
}
async function stableRead(filename) {
  await noLinks(filename);
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat(); if (!before.isFile()) throw new Error(`Unsupported file: ${filename}`);
    const bytes = await handle.readFile(); const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error(`Source changed during read: ${filename}`);
    return bytes;
  } finally { await handle.close(); }
}
async function writeExclusive(filename, bytes, mode = 0o600) {
  const handle = await open(filename, 'wx', mode);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function scan(root, prefix = '', copyTo, excluded) {
  await noLinks(root); const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) throw new Error(`Source must be a directory: ${root}`);
  const entries = [];
  async function visit(directory, relative) {
    for (const name of (await readdir(directory)).sort()) {
      const rel = relativePath(relative ? `${relative}/${name}` : name); const filename = path.join(directory, name);
      const info = await lstat(filename);
      if (info.isSymbolicLink() && excluded && electronSingletonPaths.has(`${prefix}/${rel}`)) {
        excluded.push({path:`${prefix}/${rel}`,reason:'electron-process-singleton'}); continue;
      }
      if (info.isSymbolicLink()) throw new Error(`Symbolic link rejected: ${filename}`);
      const destination = copyTo && path.join(copyTo, ...rel.split('/'));
      if (info.isDirectory()) {
        entries.push({ path: prefix ? `${prefix}/${rel}` : rel, type: 'directory' });
        if (destination) await mkdir(destination, { mode: 0o700 });
        await visit(filename, rel);
      } else if (info.isFile()) {
        const bytes = await stableRead(filename);
        entries.push({ path: prefix ? `${prefix}/${rel}` : rel, type: 'file', size: bytes.length, sha256: sha(bytes) });
        if (destination) await writeExclusive(destination, bytes);
      } else throw new Error(`Unsupported source entry: ${filename}`);
    }
  }
  await visit(root, ''); return entries;
}
function sourcesList(sources, required = false) {
  if (!sources || (required && (!sources.userData || !sources.registry))) throw new Error('userData and registry sources are required');
  return Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)).map(([label, root]) => {
    if (!labels.has(label) || typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Invalid recovery source');
    return [label, path.resolve(root)];
  });
}
function requireStopped(assertStopped) {
  if (typeof assertStopped !== 'function') throw new Error('Stopped-process verification is required');
}
async function snapshot(sources, destination, excluded = []) {
  const entries = [];
  for (const [label, root] of sources) {
    const target = destination && path.join(destination, label);
    if (target) await mkdir(target, { mode: 0o700 });
    entries.push({ path: label, type: 'directory' }); entries.push(...await scan(root, label, target, excluded));
  }
  return entries;
}
async function publishManifest(destination, manifest) {
  const bytes = Buffer.from(json(manifest));
  await writeExclusive(path.join(destination, 'manifest.json'), bytes, 0o400);
  await writeExclusive(path.join(destination, 'manifest.sha256'), `${sha(bytes)}\n`, 0o400);
  for (const entry of manifest.entries) if (entry.type === 'file') await chmod(path.join(destination, 'data', ...entry.path.split('/')), 0o400);
  await unlink(path.join(destination, '.incomplete'));
}
export function getV2DataLayout({ v1UserData, v1Registry, recoveryRoot }) {
  for (const value of [v1UserData, v1Registry, recoveryRoot]) if (!path.isAbsolute(value)) throw new Error('Absolute data paths required');
  const layout = { userData: `${path.resolve(v1UserData)}-v2`, registry: `${path.resolve(v1Registry)}-v2`, recoveryRoot: path.resolve(recoveryRoot) };
  const paths = [v1UserData, v1Registry, layout.userData, layout.registry, recoveryRoot];
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) disjoint(paths[i], paths[j]);
  return layout;
}
export async function createV1Backup({ destination, sources, assertStopped }) {
  requireStopped(assertStopped); const roots = sourcesList(sources, true);
  for (const [, root] of roots) { disjoint(destination, root); await noLinks(root); }
  await assertStopped();
  await freshDirectory(destination); await mkdir(path.join(destination, 'data'), { mode: 0o700 });
  const excluded = [];
  const entries = await snapshot(roots, path.join(destination, 'data'), excluded);
  await assertStopped();
  if (json(entries) !== json(await snapshot(roots))) throw new Error('Source changed during backup; snapshot is incomplete');
  const manifest = { schema: 1, kind: 'mcw-v1-backup', version: '1.55.1', createdAt: new Date().toISOString(), sources: Object.fromEntries(roots), entries, excluded };
  await publishManifest(destination, manifest); return verifyV1Backup(destination);
}
export async function verifyV1Backup(directory) {
  await noLinks(directory); await absent(path.join(directory, '.incomplete'));
  const bytes = await stableRead(path.join(directory, 'manifest.json'));
  if (sha(bytes) !== (await stableRead(path.join(directory, 'manifest.sha256'))).toString('utf8').trim()) throw new Error('Manifest integrity failure');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schema !== 1 || manifest.kind !== 'mcw-v1-backup' || manifest.version !== '1.55.1' || !Array.isArray(manifest.entries)) throw new Error('Invalid backup manifest');
  if (manifest.excluded !== undefined && (!Array.isArray(manifest.excluded) || manifest.excluded.some(entry=>!electronSingletonPaths.has(entry.path) || entry.reason!=='electron-process-singleton' || manifest.entries.some(file=>file.path===entry.path)) || new Set(manifest.excluded.map(entry=>entry.path)).size!==manifest.excluded.length)) throw new Error('Invalid backup exclusions');
  const roots = sourcesList(manifest.sources, true); const seen = new Set();
  for (const entry of manifest.entries) {
    relativePath(entry.path); if (!labels.has(entry.path.split('/')[0]) || seen.has(entry.path)) throw new Error('Invalid duplicate manifest path'); seen.add(entry.path);
    if (entry.type !== 'directory' && (entry.type !== 'file' || !Number.isSafeInteger(entry.size) || entry.size < 0 || !digestPattern.test(entry.sha256))) throw new Error('Invalid manifest entry');
  }
  const actual = [];
  for (const [label] of roots) { const root = path.join(directory, 'data', label); actual.push({ path: label, type: 'directory' }); actual.push(...await scan(root, label)); }
  const actualLabels = (await readdir(path.join(directory, 'data'))).sort();
  if (json(actualLabels) !== json(roots.map(([label]) => label).sort()) || json(actual) !== json(manifest.entries)) throw new Error('Backup data integrity failure');
  return manifest;
}
export function assertRollbackHosts({ hosts, expectedHostIds, now = Date.now(), maxObservationAgeMs = 30_000 }) {
  if (!Number.isFinite(now) || !Number.isFinite(maxObservationAgeMs) || maxObservationAgeMs <= 0 || maxObservationAgeMs > 30_000) throw new Error('Invalid host observation lifetime');
  if (!Array.isArray(expectedHostIds) || expectedHostIds.length === 0 || new Set(expectedHostIds).size !== expectedHostIds.length || !Array.isArray(hosts) || hosts.length !== expectedHostIds.length) throw new Error('Complete host work inventory required');
  const seen = new Set();
  for (const host of hosts) {
    if (!host || !expectedHostIds.includes(host.hostId) || seen.has(host.hostId) || !['stopped', 'completed'].includes(host.state) || !Number.isFinite(host.observedAt) || host.observedAt > now || now - host.observedAt > maxObservationAgeMs) throw new Error('Host work is running, unknown, missing, or stale; rollback blocked');
    seen.add(host.hostId);
  }
}
export async function prepareRollback(options) {
  const { backupDirectory, destination, preserveV2Sources, assertStopped } = options;
  requireStopped(assertStopped); assertRollbackHosts({ hosts: options.hosts, expectedHostIds: options.expectedHostIds }); await assertStopped();
  await verifyV1Backup(backupDirectory); disjoint(destination, backupDirectory);
  const preservedRoots = sourcesList(preserveV2Sources); for (const [, root] of preservedRoots) disjoint(destination, root);
  await freshDirectory(destination); const v1 = path.join(destination, 'v1'); await mkdir(v1, { mode: 0o700 });
  await scan(path.join(backupDirectory, 'data'), '', v1);
  const preserved = path.join(destination, 'v2-preserved'); await mkdir(preserved, { mode: 0o700 });
  const v2Entries = await snapshot(preservedRoots, preserved); await assertStopped();
  if (json(v2Entries) !== json(await snapshot(preservedRoots))) throw new Error('V2 state changed during preservation');
  // v1's runtime opens userData/settings.json, independently of the registry.
  const settingsPath = path.join(v1, 'userData', 'settings.json');
  let settings = {};
  try { settings = JSON.parse(await readFile(settingsPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid v1 settings');
  settings.general = { ...settings.general, autoCheckUpdates: false, autoResumeSessions: false, repoSyncOnSessionStart: false };
  await writeFile(settingsPath, json(settings), { mode: 0o600 });
  await writeExclusive(path.join(destination, 'v2-preserved-manifest.json'), json({ schema: 1, entries: v2Entries }));
  await verifyV1Backup(backupDirectory); assertRollbackHosts({ hosts: options.hosts, expectedHostIds: options.expectedHostIds });
  const receipt = { schema: 1, kind: 'mcw-prepared-rollback', version: '1.55.1', backupDirectory: path.resolve(backupDirectory), preparedAt: new Date().toISOString(), v1Entries: await scan(v1), v2Entries };
  await writeExclusive(path.join(destination, 'prepared.json'), json(receipt)); await unlink(path.join(destination, '.incomplete'));
  return receipt;
}
async function withConfigLock(configPath, action) {
  await noLinks(configPath, true); const lock = `${configPath}.mcw-recovery-lock`; await mkdir(lock, { mode: 0o700 });
  try { return await action(); } finally { await rm(lock, { recursive: true }); }
}
async function optionalBytes(filename) {
  try { return await stableRead(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const optionalDigest = bytes => bytes === null ? null : sha(bytes);
async function replaceConfig(filename, expectedHash, bytes) {
  if (optionalDigest(await optionalBytes(filename)) !== expectedHash) return false;
  if (bytes === null) { await unlink(filename); return true; }
  const temporary = `${filename}.mcw-${randomUUID()}.tmp`; await writeExclusive(temporary, bytes);
  try {
    if (optionalDigest(await optionalBytes(filename)) !== expectedHash) return false;
    await rename(temporary, filename); return true;
  } finally { await rm(temporary, { force: true }); }
}
export async function journalSharedConfig({ configPath, journalDirectory, nextBytes }) {
  disjoint(journalDirectory, configPath);
  return withConfigLock(configPath, async () => {
    const before = await optionalBytes(configPath); const after = Buffer.from(nextBytes);
    await freshDirectory(journalDirectory);
    if (before !== null) await writeExclusive(path.join(journalDirectory, 'before'), before, 0o400);
    await writeExclusive(path.join(journalDirectory, 'after'), after, 0o400);
    const journal = { schema: 1, configPath: path.resolve(configPath), beforeHash: optionalDigest(before), afterHash: sha(after) };
    await writeExclusive(path.join(journalDirectory, 'journal.json'), json(journal), 0o400);
    await unlink(path.join(journalDirectory, '.incomplete'));
    if (!await replaceConfig(configPath, journal.beforeHash, after)) throw new Error('Shared config changed; journal preserved, no overwrite');
    return journal;
  });
}
export async function restoreSharedConfig(journalDirectory) {
  await noLinks(journalDirectory); await absent(path.join(journalDirectory, '.incomplete'));
  const journal = JSON.parse((await stableRead(path.join(journalDirectory, 'journal.json'))).toString('utf8'));
  if (journal.schema !== 1 || !path.isAbsolute(journal.configPath) || !digestPattern.test(journal.afterHash) || (journal.beforeHash !== null && !digestPattern.test(journal.beforeHash))) throw new Error('Invalid config journal');
  const before = journal.beforeHash === null ? null : await stableRead(path.join(journalDirectory, 'before'));
  if (optionalDigest(before) !== journal.beforeHash || sha(await stableRead(path.join(journalDirectory, 'after'))) !== journal.afterHash) throw new Error('Config journal integrity failure');
  return withConfigLock(journal.configPath, async () => {
    const restored = await replaceConfig(journal.configPath, journal.afterHash, before);
    return { restored, conflict: !restored };
  });
}
export async function stageRecoveryAssets({ destination, installDirectory, installers, runtimeExecutable, runtimeSha256, scriptDirectory = path.dirname(fileURLToPath(import.meta.url)) }) {
  if (!runtimeExecutable) {
    if (process.versions.electron) throw new Error('A pinned standalone Node runtime is required; copying Electron alone is unsafe');
    runtimeExecutable = process.execPath; runtimeSha256 = sha(await stableRead(runtimeExecutable));
  } else if (!digestPattern.test(runtimeSha256 ?? '')) throw new Error('Explicit standalone Node runtime digest is required');
  disjoint(destination, installDirectory); await noLinks(runtimeExecutable);
  await verifyStandaloneNodeRuntime(runtimeExecutable, runtimeSha256);
  const selected = Object.entries(installers ?? {}); if (!selected.length) throw new Error('Original installer assets required');
  for (const [platform, source] of selected) {
    if (!ORIGINAL_INSTALLERS[platform]) throw new Error('Unsupported installer platform');
    disjoint(destination, source);
    if (sha(await stableRead(source)) !== ORIGINAL_INSTALLERS[platform].sha256) throw new Error(`Original ${platform} installer digest mismatch`);
  }
  disjoint(destination, runtimeExecutable); await freshDirectory(destination);
  const assets = [];
  async function copyAsset(source, filename, executable = false, expectedDigest) {
    const bytes = await stableRead(source);
    if (expectedDigest && sha(bytes) !== expectedDigest) throw new Error('Original installer digest changed while staging');
    await writeExclusive(path.join(destination, filename), bytes, executable ? 0o700 : 0o400);
    assets.push({ filename, size: bytes.length, sha256: sha(bytes) });
  }
  for (const [platform, source] of selected) await copyAsset(source, ORIGINAL_INSTALLERS[platform].filename, platform === 'appimage', ORIGINAL_INSTALLERS[platform].sha256);
  await copyAsset(path.join(scriptDirectory, 'core.mjs'), 'core.mjs'); await copyAsset(path.join(scriptDirectory, 'recover.mjs'), 'recover.mjs');
  const runtimeName = process.platform === 'win32' ? 'recovery-node.exe' : 'recovery-node'; await copyAsset(runtimeExecutable, runtimeName, true);
  await verifyStandaloneNodeRuntime(path.join(destination, runtimeName), runtimeSha256);
  await promisify(execFile)(path.join(destination, runtimeName), [path.join(destination, 'recover.mjs'), 'runtime-smoke'], { windowsHide: true, timeout: 15_000 });
  await writeExclusive(path.join(destination, process.platform === 'win32' ? 'recover.cmd' : 'recover.sh'), process.platform === 'win32' ? '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0recovery-node.exe" "%~dp0recover.mjs" %*\r\n' : '#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\ncd -- "$(dirname -- "$0")" || exit 1\nexec ./recovery-node ./recover.mjs "$@"\n', 0o700);
  const manifest = { schema: 1, version: '1.55.1', runtimeName, runtimeSha256, assets, installers: selected.map(([platform]) => platform) };
  await writeExclusive(path.join(destination, 'assets.json'), json(manifest), 0o400); await unlink(path.join(destination, '.incomplete')); return manifest;
}

export async function verifyPreparedRollback(directory) {
  await noLinks(directory); await absent(path.join(directory, '.incomplete'));
  const receipt = JSON.parse((await stableRead(path.join(directory, 'prepared.json'))).toString('utf8'));
  if (receipt.schema !== 1 || receipt.kind !== 'mcw-prepared-rollback' || receipt.version !== '1.55.1') throw new Error('Invalid prepared rollback');
  await verifyV1Backup(receipt.backupDirectory);
  if (json(receipt.v1Entries) !== json(await scan(path.join(directory, 'v1'))) || json(receipt.v2Entries) !== json(await scan(path.join(directory, 'v2-preserved')))) throw new Error('Prepared rollback integrity failure');
  return receipt;
}

/** Replaces stopped v1 directories, retaining every existing target beside itself. Never deletes data. */
export async function activatePreparedRollback({ directory, targets, assertStopped }) {
  requireStopped(assertStopped); const receipt = await verifyPreparedRollback(directory); await assertStopped();
  const roots = sourcesList(targets, true); const sourceLabels = (await readdir(path.join(directory, 'v1'))).sort();
  if (json(sourceLabels) !== json(roots.map(([label]) => label).sort())) throw new Error('Every restored source needs an explicit target');
  for (let i = 0; i < roots.length; i++) {
    const [, target] = roots[i]; disjoint(directory, target); disjoint(receipt.backupDirectory, target); await noLinks(target, true);
    for (let j = i + 1; j < roots.length; j++) disjoint(target, roots[j][1]);
  }
  const operationId = randomUUID(); const retained = {}; const staged = {};
  const log = await open(path.join(directory, 'activation.jsonl'), 'wx', 0o600);
  const record = async value => { await log.writeFile(`${JSON.stringify(value)}\n`); await log.sync(); };
  try {
    await record({ event: 'begin', operationId, targets });
    for (const [label, target] of roots) {
      const sibling = `${target}.mcw-restore-${operationId}`; await noLinks(sibling, true); await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await mkdir(sibling, { mode: 0o700 }); await scan(path.join(directory, 'v1', label), '', sibling); staged[label] = sibling;
      if (json(await scan(sibling)) !== json(await scan(path.join(directory, 'v1', label)))) throw new Error('Staged activation integrity failure');
    }
    await verifyPreparedRollback(directory); await assertStopped();
    for (const [label, target] of roots) {
      await noLinks(target, true); const before = `${target}.mcw-before-rollback-${operationId}`; await absent(before);
      const existing = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (existing && !existing.isDirectory()) throw new Error('Restore target is not a directory');
      await record({ event: 'replace-intent', label, target, retained: existing ? before : null, staged: staged[label] });
      if (existing) { await rename(target, before); retained[label] = before; }
      await rename(staged[label], target); await record({ event: 'replaced', label, target, retained: retained[label] ?? null });
    }
    for (const [label, target] of roots) if (json(await scan(target)) !== json(await scan(path.join(directory, 'v1', label)))) throw new Error('Activated data integrity failure');
    await record({ event: 'complete', operationId }); return { operationId, retained };
  } catch (error) {
    await record({ event: 'interrupted', error: String(error), retained, staged }); throw error;
  } finally { await log.close(); }
}

export async function verifyRecoveryAssets(directory, platform) {
  await noLinks(directory); await absent(path.join(directory, '.incomplete'));
  const manifest = JSON.parse((await stableRead(path.join(directory, 'assets.json'))).toString('utf8'));
  if (manifest.schema !== 1 || manifest.version !== '1.55.1' || !Array.isArray(manifest.assets) || !manifest.installers?.includes(platform) || !ORIGINAL_INSTALLERS[platform]) throw new Error('Invalid offline recovery assets');
  const seen = new Set();
  for (const asset of manifest.assets) {
    relativePath(asset.filename); if (asset.filename.includes('/') || seen.has(asset.filename)) throw new Error('Invalid recovery asset path'); seen.add(asset.filename);
    const bytes = await stableRead(path.join(directory, asset.filename)); if (bytes.length !== asset.size || sha(bytes) !== asset.sha256) throw new Error('Recovery asset integrity failure');
  }
  const original = ORIGINAL_INSTALLERS[platform]; const installer = path.join(directory, original.filename);
  if (!seen.has(original.filename) || sha(await stableRead(installer)) !== original.sha256) throw new Error('Original installer digest mismatch');
  for (const required of ['core.mjs', 'recover.mjs', manifest.runtimeName]) if (!seen.has(required)) throw new Error('Recovery runtime asset missing');
  return { manifest, installer };
}

/** Lifecycle authority is injected by the host; recovery never guesses process/task state. */
export async function coordinateRollback(options) {
  const { adapter } = options;
  if (!adapter || typeof adapter.stopNewWork !== 'function' || typeof adapter.observeHosts !== 'function') throw new Error('Host lifecycle adapter required');
  await adapter.stopNewWork();
  let hosts = await adapter.observeHosts(); assertRollbackHosts({ hosts, expectedHostIds: options.expectedHostIds });
  for (const method of ['gracefulStop', 'assertNoInstances', 'installOriginal', 'verifyInstalledVersion', 'clearPendingUpdaterState', 'launchV1']) if (typeof adapter[method] !== 'function') throw new Error(`Recovery adapter missing ${method}`);
  sourcesList(options.preserveV2Sources, true);
  await adapter.gracefulStop(); await adapter.assertNoInstances();
  hosts = await adapter.observeHosts(); assertRollbackHosts({ hosts, expectedHostIds: options.expectedHostIds });
  const assets = await verifyRecoveryAssets(options.assetsDirectory, options.platform);
  await prepareRollback({ ...options, hosts, assertStopped: () => adapter.assertNoInstances() });
  await verifyPreparedRollback(options.destination);
  const conflicts = [];
  for (const journal of options.sharedConfigJournals ?? []) {
    const result = await restoreSharedConfig(journal); if (result.conflict) conflicts.push(journal);
  }
  if (conflicts.length) throw new Error(`Shared config conflicts require user resolution: ${conflicts.join(', ')}`);
  await adapter.assertNoInstances(); assertRollbackHosts({ expectedHostIds: options.expectedHostIds, hosts: await adapter.observeHosts() });
  await adapter.installOriginal({ installer: assets.installer, platform: options.platform });
  if (await adapter.verifyInstalledVersion() !== '1.55.1') throw new Error('Installed version verification failed; v1 was not launched');
  await adapter.assertNoInstances(); assertRollbackHosts({ expectedHostIds: options.expectedHostIds, hosts: await adapter.observeHosts() });
  const activation = await activatePreparedRollback({ directory: options.destination, targets: options.targets, assertStopped: () => adapter.assertNoInstances() });
  await adapter.clearPendingUpdaterState(); await adapter.assertNoInstances(); assertRollbackHosts({ expectedHostIds: options.expectedHostIds, hosts: await adapter.observeHosts() });
  await adapter.launchV1(); return { version: '1.55.1', activation };
}

/** Execute only after the lifecycle coordinator has checked stopped hosts and residual instances. */
export async function installOriginalV1({ assetsDirectory, platform, installDirectory }) {
  const { installer } = await verifyRecoveryAssets(assetsDirectory, platform);
  disjoint(assetsDirectory, installDirectory); await noLinks(installDirectory, true);
  if (!path.isAbsolute(installDirectory) || /[\r\n"]/.test(installDirectory)) throw new Error('Valid absolute install directory required');
  let command; let args;
  if (platform === 'win32' && process.platform === 'win32') {
    // NSIS requires /D to be last and unquoted in its own argv entry. No shell interpolation.
    command = installer; args = ['/S', `/D=${installDirectory}`];
  } else if (platform === 'deb' && process.platform === 'linux') {
    command = '/usr/bin/dpkg'; args = ['--install', installer];
  } else if (platform === 'appimage' && process.platform === 'linux') {
    await noLinks(path.dirname(installDirectory), true); await mkdir(path.dirname(installDirectory), { recursive: true, mode: 0o700 });
    const staged = `${installDirectory}.mcw-original-${randomUUID()}`; await writeExclusive(staged, await stableRead(installer), 0o700);
    // Existing AppImages are retained; never overwrite them in place.
    const existing = await lstat(installDirectory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing) { if (!existing.isFile()) throw new Error('AppImage install target must be a file'); await rename(installDirectory, `${installDirectory}.mcw-before-rollback-${randomUUID()}`); }
    await rename(staged, installDirectory); return;
  } else throw new Error('Installer platform does not match this operating system');
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, windowsVerbatimArguments: platform === 'win32', stdio: 'inherit' });
    child.once('error', reject); child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Original installer failed: exit ${code}, signal ${signal}`)));
  });
}

/** Read-only comparison for reupgrade; v1 differences are reported and never merged into v2. */
export async function compareV1WithBackup({ backupDirectory, sources }) {
  const backup = await verifyV1Backup(backupDirectory); const current = await snapshot(sourcesList(sources, true));
  const before = new Map(backup.entries.map(entry => [entry.path, entry])); const after = new Map(current.map(entry => [entry.path, entry]));
  const added = []; const removed = []; const changed = [];
  for (const [name, entry] of after) {
    if (!before.has(name)) added.push(name);
    else if (json(entry) !== json(before.get(name))) changed.push(name);
  }
  for (const name of before.keys()) if (!after.has(name)) removed.push(name);
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

/** The copied runtime is executed in isolation, catching Electron's external ICU/DLL dependency. */
export async function verifyStandaloneNodeRuntime(filename, expectedSha256) {
  if (!digestPattern.test(expectedSha256 ?? '') || sha(await stableRead(filename)) !== expectedSha256) throw new Error('Standalone Node runtime digest mismatch');
  const { stdout } = await promisify(execFile)(filename, ['-e', 'process.stdout.write(JSON.stringify({version:process.versions.node,electron:!!process.versions.electron}))'], { windowsHide: true, timeout: 15_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  const proof = JSON.parse(stdout); const [major, minor] = String(proof.version).split('.').map(Number);
  if (proof.electron !== false || !Number.isInteger(major) || major < 22 || (major === 22 && minor < 12)) throw new Error('Standalone Node >=22.12 required; Electron runtime rejected');
  return proof;
}
