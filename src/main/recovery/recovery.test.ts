// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod, symlink, stat, open, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RecoveryHostObservation } from '../../shared/recovery-types';
import { createV1Backup, verifyV1Backup, getV2DataLayout, prepareRollback, journalSharedConfig, restoreSharedConfig, stageRecoveryAssets, assertRollbackHosts, verifyPreparedRollback, activatePreparedRollback, coordinateRollback, installOriginalV1, compareV1WithBackup, verifyStandaloneNodeRuntime } from '../../../scripts/recovery/core.mjs';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mcw-recovery-')); roots.push(root);
  const userData = join(root, 'v1-user'); const registry = join(root, 'v1-registry');
  await mkdir(join(userData, 'Local Storage'), { recursive: true }); await mkdir(registry);
  await writeFile(join(userData, 'Local Storage', 'db'), 'original-browser-state');
  await writeFile(join(registry, 'settings.json'), JSON.stringify({ general: { autoResumeSessions: true, autoCheckUpdates: true, repoSyncOnSessionStart: true }, keep: 'yes' }));
  return { root, userData, registry, destination: join(root, 'backup') };
}
const stopped = async () => undefined;
describe('offline recovery', () => {
  it('records only root Electron singleton symlinks as ephemeral and still rejects other links', async () => {
    const f=await fixture();
    await symlink(f.registry,join(f.userData,'SingletonCookie'),process.platform==='win32'?'junction':'dir');
    const manifest=await createV1Backup({...f,sources:{userData:f.userData,registry:f.registry},assertStopped:stopped});
    expect(manifest.excluded).toEqual([{path:'userData/SingletonCookie',reason:'electron-process-singleton'}]);
    await expect(stat(join(f.destination,'data/userData/SingletonCookie'))).rejects.toThrow();
    expect((await verifyV1Backup(f.destination)).entries.some(entry=>entry.path==='userData/Local Storage/db')).toBe(true);
    expect(await compareV1WithBackup({backupDirectory:f.destination,sources:{userData:f.userData,registry:f.registry}})).toEqual({added:[],removed:[],changed:[]});
    await symlink(f.registry,join(f.userData,'Local Storage','SingletonCookie'),process.platform==='win32'?'junction':'dir');
    await expect(createV1Backup({...f,destination:join(f.root,'second-backup'),sources:{userData:f.userData,registry:f.registry},assertStopped:stopped})).rejects.toThrow(/symbolic/i);
  });
  it('copies a consistent write-once v1 snapshot including Local Storage and detects tampering', async () => {
    const f = await fixture(); const manifest = await createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped });
    expect(manifest.version).toBe('1.55.1');
    expect(await readFile(join(f.destination, 'data/userData/Local Storage/db'), 'utf8')).toBe('original-browser-state');
    expect((await verifyV1Backup(f.destination)).entries.some((e: { path: string }) => e.path === 'userData/Local Storage/db')).toBe(true);
    await expect(createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped })).rejects.toThrow();
    const db = join(f.destination, 'data/userData/Local Storage/db'); await chmod(db, 0o600); await writeFile(db, 'corrupt');
    await expect(verifyV1Backup(f.destination)).rejects.toThrow(/integrity/i);
  });
  it('does not publish a backup when stopped-state validation or source consistency fails', async () => {
    const f = await fixture(); let checks = 0;
    await expect(createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: async () => { if (++checks === 2) await writeFile(join(f.registry, 'new'), 'raced'); } })).rejects.toThrow(/changed/i);
    await expect(verifyV1Backup(f.destination)).rejects.toThrow();
  });
  it('rejects overlapping paths and symlinked sources rather than following outside the snapshot', async () => {
    const f = await fixture();
    await expect(createV1Backup({ ...f, destination: join(f.userData, 'backup'), sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped })).rejects.toThrow(/overlap/i);
    const link = join(f.root, 'linked'); await symlink(f.registry, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(createV1Backup({ ...f, sources: { userData: f.userData, registry: link }, assertStopped: stopped })).rejects.toThrow(/symbolic|symlink/i);
  });
  it('keeps v2 userData and registry separate from v1 and recovery files', async () => {
    const f = await fixture(); const layout = getV2DataLayout({ v1UserData: f.userData, v1Registry: f.registry, recoveryRoot: join(f.root, 'recovery') });
    expect(layout.userData).toBe(join(f.root, 'v1-user-v2')); expect(layout.registry).toBe(join(f.root, 'v1-registry-v2'));
    expect(() => getV2DataLayout({ v1UserData: f.userData, v1Registry: f.registry, recoveryRoot: f.userData })).toThrow(/overlap/i);
  });
  it('fails closed on missing, stale, running, or unknown host observations before restore copies', async () => {
    const f = await fixture(); await createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped });
    const cases: RecoveryHostObservation[][] = [[], [{ hostId: 'local', state: 'unknown', observedAt: Date.now() }], [{ hostId: 'local', state: 'running', observedAt: Date.now() }], [{ hostId: 'local', state: 'stopped', observedAt: 1 }]];
    for (const hosts of cases) {
      await expect(prepareRollback({ backupDirectory: f.destination, destination: join(f.root, 'restore'), expectedHostIds: ['local'], hosts, preserveV2Sources: {}, assertStopped: stopped })).rejects.toThrow(/host|work/i);
    }
    await expect(stat(join(f.root, 'restore'))).rejects.toThrow();
  });
  it('prepares safe v1 defaults and preserves v2 state without changing either original', async () => {
    const f = await fixture(); await createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped });
    const v2 = join(f.root, 'v2'); await mkdir(v2); await writeFile(join(v2, 'results.json'), '{"result":"keep"}');
    const destination = join(f.root, 'restore');
    await prepareRollback({ backupDirectory: f.destination, destination, expectedHostIds: ['local'], hosts: [{ hostId: 'local', state: 'stopped', observedAt: Date.now() }], preserveV2Sources: { registry: v2 }, assertStopped: stopped });
    const settings = JSON.parse(await readFile(join(destination, 'v1/registry/settings.json'), 'utf8'));
    expect(settings.general).toEqual({ autoResumeSessions: false, autoCheckUpdates: false, repoSyncOnSessionStart: false }); expect(settings.keep).toBe('yes');
    expect(await readFile(join(destination, 'v2-preserved/registry/results.json'), 'utf8')).toBe('{"result":"keep"}');
    expect(JSON.parse(await readFile(join(f.registry, 'settings.json'), 'utf8')).general.autoResumeSessions).toBe(true);
  });
  it('journals before and after config bytes and refuses to overwrite later edits', async () => {
    const f = await fixture(); const config = join(f.root, 'shared.json'); await writeFile(config, 'before');
    const journal = join(f.root, 'journal'); await journalSharedConfig({ configPath: config, journalDirectory: journal, nextBytes: Buffer.from('after') });
    expect(await readFile(config, 'utf8')).toBe('after'); await writeFile(config, 'later-user-edit');
    expect(await restoreSharedConfig(journal)).toEqual({ restored: false, conflict: true }); expect(await readFile(config, 'utf8')).toBe('later-user-edit');
    await writeFile(config, 'after'); expect(await restoreSharedConfig(journal)).toEqual({ restored: true, conflict: false }); expect(await readFile(config, 'utf8')).toBe('before');
  });
  it('rejects invalid installer bytes before publishing offline recovery assets', async () => {
    const f = await fixture(); const installer = join(f.root, 'invalid.exe'); await writeFile(installer, 'not-the-original');
    await expect(stageRecoveryAssets({ destination: join(f.root, 'assets'), installDirectory: join(f.root, 'app'), installers: { win32: installer } })).rejects.toThrow(/digest/i);
    await expect(stat(join(f.root, 'assets', 'assets.json'))).rejects.toThrow();
  });
  it('rejects manifest traversal even if its companion digest is recomputed', async () => {
    const { createHash } = await import('node:crypto'); const f = await fixture();
    await createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped });
    const filename = join(f.destination, 'manifest.json'); await chmod(filename, 0o600); const manifest = JSON.parse(await readFile(filename, 'utf8'));
    manifest.entries[0].path = '../outside'; const bytes = JSON.stringify(manifest); await writeFile(filename, bytes);
    const hashFile = join(f.destination, 'manifest.sha256'); await chmod(hashFile, 0o600); await writeFile(hashFile, createHash('sha256').update(bytes).digest('hex'));
    await expect(verifyV1Backup(f.destination)).rejects.toThrow(/manifest path/i);
  });
  it('does not accept incomplete, missing or extra-file backups', async () => {
    const f = await fixture(); await expect(verifyV1Backup(f.destination)).rejects.toThrow();
    await createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped });
    await writeFile(join(f.destination, '.incomplete'), 'interrupted'); await expect(verifyV1Backup(f.destination)).rejects.toThrow();
    await rm(join(f.destination, '.incomplete')); await writeFile(join(f.destination, 'data', 'unexpected'), 'extra'); await expect(verifyV1Backup(f.destination)).rejects.toThrow(/integrity/i);
  });
  it('fails safely on destination filesystem errors without modifying source files', async () => {
    const f = await fixture(); const blocker = join(f.root, 'not-a-directory'); await writeFile(blocker, 'block');
    await expect(createV1Backup({ ...f, destination: join(blocker, 'backup'), sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped })).rejects.toThrow();
    expect(await readFile(join(f.userData, 'Local Storage/db'), 'utf8')).toBe('original-browser-state');
  });
  it('never treats future, duplicate, or omitted remote observations as stopped work', () => {
    const cases: RecoveryHostObservation[][] = [[{ hostId: 'local', state: 'stopped', observedAt: 101 }], [{ hostId: 'local', state: 'stopped', observedAt: 100 }, { hostId: 'local', state: 'stopped', observedAt: 100 }]];
    for (const hosts of cases) {
      expect(() => assertRollbackHosts({ hosts, expectedHostIds: ['local', 'remote'], now: 100 })).toThrow();
    }
  });
  it('verifies restore copy integrity before activating and preserves existing v1 data', async () => {
    const f = await fixture(); await createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped });
    const destination = join(f.root, 'restore');
    await prepareRollback({ backupDirectory: f.destination, destination, expectedHostIds: ['local'], hosts: [{ hostId: 'local', state: 'stopped', observedAt: Date.now() }], preserveV2Sources: {}, assertStopped: stopped });
    await verifyPreparedRollback(destination);
    const targets = { userData: join(f.root, 'target-user'), registry: join(f.root, 'target-registry') };
    await mkdir(targets.userData); await writeFile(join(targets.userData, 'older'), 'keep-me');
    const result = await activatePreparedRollback({ directory: destination, targets, assertStopped: stopped });
    expect(await readFile(join(targets.userData, 'Local Storage/db'), 'utf8')).toBe('original-browser-state');
    expect(await readFile(join(result.retained.userData!, 'older'), 'utf8')).toBe('keep-me');
    expect(JSON.parse(await readFile(join(targets.registry, 'settings.json'), 'utf8')).general.autoCheckUpdates).toBe(false);
  });
  it('blocks activation of a corrupt prepared copy before touching existing targets', async () => {
    const f = await fixture(); await createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped }); const destination = join(f.root, 'restore');
    await prepareRollback({ backupDirectory: f.destination, destination, expectedHostIds: ['local'], hosts: [{ hostId: 'local', state: 'stopped', observedAt: Date.now() }], preserveV2Sources: {}, assertStopped: stopped });
    await writeFile(join(destination, 'v1/userData/Local Storage/db'), 'tampered');
    await expect(activatePreparedRollback({ directory: destination, targets: { userData: f.userData, registry: f.registry }, assertStopped: stopped })).rejects.toThrow(/integrity/i);
    expect(await readFile(join(f.userData, 'Local Storage/db'), 'utf8')).toBe('original-browser-state');
  });
  it('coordinator stops new work and refuses unknown remote state before shutting down or installing', async () => {
    const events: string[] = [];
    const f = await fixture(); const unexpected = async () => { throw new Error('Unsafe lifecycle action called'); };
    await expect(coordinateRollback({ expectedHostIds: ['local', 'remote'], backupDirectory: f.destination, destination: join(f.root, 'restore'), preserveV2Sources: { userData: f.userData, registry: f.registry }, targets: { userData: f.userData, registry: f.registry }, assetsDirectory: join(f.root, 'assets'), platform: 'win32', adapter: {
      stopNewWork: async () => { events.push('blocked-new-work'); },
      observeHosts: async () => [{ hostId: 'local', state: 'stopped', observedAt: Date.now() }],
      gracefulStop: async () => { events.push('shutdown'); },
      assertNoInstances: unexpected, installOriginal: unexpected, verifyInstalledVersion: async () => { throw new Error('Unsafe version probe called'); }, clearPendingUpdaterState: unexpected, launchV1: unexpected,
    } })).rejects.toThrow(/host/i);
    expect(events).toEqual(['blocked-new-work']);
  });
  it('runs backup verification in standalone Node without loading Electron', async () => {
    const f = await fixture(); await createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped });
    const { stdout } = await promisify(execFile)(process.execPath, [join(process.cwd(), 'scripts/recovery/recover.mjs'), 'verify', f.destination]);
    expect(JSON.parse(stdout).version).toBe('1.55.1');
  });
  it('standalone mutation fails closed without a live lifecycle controller', async () => {
    const f = await fixture(); const request = join(f.root, 'request.json'); await writeFile(request, JSON.stringify({ destination: join(f.root, 'restore') }));
    await expect(promisify(execFile)(process.execPath, [join(process.cwd(), 'scripts/recovery/recover.mjs'), 'prepare', request])).rejects.toThrow(/controller/i);
    await expect(stat(join(f.root, 'restore'))).rejects.toThrow();
  });
  it('original installer execution rejects unsupported platform or unverified assets', async () => {
    const f = await fixture();
    await expect(installOriginalV1({ assetsDirectory: f.root, platform: 'deb', installDirectory: join(f.root, 'install') })).rejects.toThrow();
    await expect(stat(join(f.root, 'install'))).rejects.toThrow();
  });
  it.each(['ENOSPC', 'EACCES'])('preserves an incomplete marker after an injected OS %s write failure', async code => {
    const f = await fixture(); const handle = await open(join(f.root, 'handle-probe'), 'wx'); const prototype = Object.getPrototypeOf(handle); await handle.close();
    const realSync = prototype.sync;
    const fault = vi.spyOn(prototype, 'sync').mockImplementationOnce(async () => { throw Object.assign(new Error(`Injected ${code}`), { code }); });
    await expect(createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped })).rejects.toMatchObject({ code });
    fault.mockRestore(); expect(prototype.sync).toBe(realSync);
    expect(await readFile(join(f.destination, '.incomplete'), 'utf8')).toContain('Incomplete');
    await expect(verifyV1Backup(f.destination)).rejects.toThrow();
    expect(await readFile(join(f.registry, 'settings.json'), 'utf8')).toContain('"autoResumeSessions":true');
  });
  it('reports v1 changes for reupgrade without modifying or merging either version', async () => {
    const f = await fixture(); await createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped });
    await writeFile(join(f.registry, 'new-note'), 'new v1 record'); await writeFile(join(f.userData, 'Local Storage/db'), 'new-browser-state');
    const differences = await compareV1WithBackup({ backupDirectory: f.destination, sources: { userData: f.userData, registry: f.registry } });
    expect(differences).toEqual({ added: ['registry/new-note'], removed: [], changed: ['userData/Local Storage/db'] });
    expect(await readFile(join(f.destination, 'data/userData/Local Storage/db'), 'utf8')).toBe('original-browser-state');
    expect(await readFile(join(f.registry, 'new-note'), 'utf8')).toBe('new v1 record');
  });
  it('executes the copied standalone Node runtime and recovery runner outside the install directory', async () => {
    const { createHash } = await import('node:crypto'); const f = await fixture(); const offline = join(f.root, 'offline'); await mkdir(offline);
    const runtime = join(offline, process.platform === 'win32' ? 'recovery-node.exe' : 'recovery-node'); await copyFile(process.execPath, runtime); await chmod(runtime, 0o700);
    for (const filename of ['core.mjs', 'recover.mjs']) await copyFile(join(process.cwd(), 'scripts/recovery', filename), join(offline, filename));
    const hash = createHash('sha256').update(await readFile(runtime)).digest('hex');
    const proof = await verifyStandaloneNodeRuntime(runtime, hash); expect(proof.electron).toBe(false);
    await createV1Backup({ ...f, sources: { userData: f.userData, registry: f.registry }, assertStopped: stopped });
    const { stdout } = await promisify(execFile)(runtime, [join(offline, 'recover.mjs'), 'verify', f.destination]); expect(JSON.parse(stdout).version).toBe('1.55.1');
    await expect(verifyStandaloneNodeRuntime(runtime, '0'.repeat(64))).rejects.toThrow(/digest/i);
  }, 30000);
});
