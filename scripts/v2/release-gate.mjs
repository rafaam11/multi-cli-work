// A read-only release decision. This script cannot publish, write updater metadata, or pass a manual test.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const terminalChecks = ['ime', 'mouse', 'images', 'reconnect', 'size-owner'];
const cooperationChecks = ['gui-survival', 'ssh', 'disconnect-delivery', 'event-loss', 'no-duplicate-rerun'];
export const requiredChecks = [
  ...['windows', 'linux'].flatMap(platform => [
    ...terminalChecks.map(check => `${platform}.terminal.${check}`),
    ...cooperationChecks.map(check => `${platform}.cooperation.${check}`),
  ]),
  'recovery.windows.offline-v1-v2-v1-v2',
  'recovery.deb.offline-v1-v2-v1-v2',
  'recovery.appimage.offline-v1-v2-v1-v2',
  ...terminalChecks.map(check => `android.physical.terminal.${check}`),
  'android.physical.cooperation',
  'android.physical.dual-host',
  'android.physical.newest-version-pairing',
];
const commitPattern = /^[a-f0-9]{40}$/;
const shaPattern = /^[a-f0-9]{64}$/;
function fields(object, expected, label) {
  if (!object || Array.isArray(object) || typeof object !== 'object' || Object.keys(object).sort().join(',') !== [...expected].sort().join(',')) throw new Error(`${label}: invalid or unknown fields`);
}
async function rejectStableMetadata(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (/^latest.*\.ya?ml$/i.test(entry.name)) throw new Error(`Preview contains stable updater metadata: ${entry.name}`);
    if (entry.isSymbolicLink()) throw new Error(`Preview artifact symlink is not allowed: ${entry.name}`);
    if (entry.isDirectory()) await rejectStableMetadata(path.join(directory, entry.name));
  }
}
async function verifyEvidence(evidence, root) {
  fields(evidence, ['path', 'sha256'], 'evidence');
  if (typeof evidence.path !== 'string' || !evidence.path || path.isAbsolute(evidence.path) || evidence.path.includes('\\') || evidence.path.split('/').includes('..') || !shaPattern.test(evidence.sha256)) throw new Error('Invalid evidence path or digest');
  const actualRoot = await realpath(root);
  const candidate = path.resolve(root, evidence.path);
  const info = await lstat(candidate);
  const real = await realpath(candidate);
  const relative = path.relative(actualRoot, real);
  if (info.isSymbolicLink() || !info.isFile() || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Evidence must be a regular file inside the workspace');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(candidate)) hash.update(chunk);
  if (hash.digest('hex') !== evidence.sha256) throw new Error(`Changed evidence: ${evidence.path}`);
}
export async function checkRelease(channel, manifest, { root = repositoryRoot, expectedCommit, artifactDir } = {}) {
  if (!['preview', 'stable'].includes(channel)) throw new Error('Release channel must be stable or preview');
  fields(manifest, ['schemaVersion', 'candidateVersion', 'sourceCommit', 'checks'], 'validation manifest');
  if (manifest.schemaVersion !== 1 || manifest.candidateVersion !== '2.0.0' || !(manifest.sourceCommit === null || commitPattern.test(manifest.sourceCommit))) throw new Error('Invalid validation manifest schema or candidate');
  if (!Array.isArray(manifest.checks) || manifest.checks.length !== requiredChecks.length || new Set(manifest.checks.map(c => c.id)).size !== requiredChecks.length || requiredChecks.some(id => !manifest.checks.some(c => c.id === id))) throw new Error('Missing, duplicated or unexpected validation checks');
  const timestamps = new Map();
  for (const check of manifest.checks) {
    fields(check, ['id', 'status', 'sourceCommit', 'completedAt', 'tester', 'evidence'], `check ${check.id}`);
    if (!['pending', 'passed', 'failed'].includes(check.status) || !Array.isArray(check.evidence)) throw new Error(`Invalid check status/evidence: ${check.id}`);
    if (check.status === 'pending') {
      if (check.sourceCommit !== null || check.completedAt !== null || check.tester !== null || check.evidence.length) throw new Error(`Pending check has fabricated completion fields: ${check.id}`);
    } else {
      const timestamp = Date.parse(check.completedAt);
      if (!commitPattern.test(check.sourceCommit) || check.sourceCommit !== manifest.sourceCommit || typeof check.completedAt !== 'string' || !Number.isFinite(timestamp) || timestamp > Date.now() || typeof check.tester !== 'string' || !check.tester.trim() || !check.evidence.length) throw new Error(`Missing/stale completion evidence: ${check.id}`);
      timestamps.set(check.id, timestamp);
      for (const evidence of check.evidence) await verifyEvidence(evidence, root);
    }
    if (channel === 'stable' && check.status !== 'passed') throw new Error(`Stable release blocked: ${check.id} is ${check.status}`);
  }
  if (channel === 'stable') {
    if (!commitPattern.test(expectedCommit ?? '') || manifest.sourceCommit !== expectedCommit) throw new Error('Stable evidence is not bound to the current candidate commit');
    const latestOther = Math.max(...requiredChecks.filter(id => !id.startsWith('android.')).map(id => timestamps.get(id)));
    if (requiredChecks.filter(id => id.startsWith('android.')).some(id => timestamps.get(id) <= latestOther)) throw new Error('Physical Android validation must run LAST, after every desktop and offline roundtrip check');
  }
  if (channel === 'preview' && artifactDir) await rejectStableMetadata(artifactDir);
  return { channel, candidateVersion: manifest.candidateVersion, passed: manifest.checks.filter(c => c.status === 'passed').length, required: requiredChecks.length };
}
async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== '--check-release' || !['stable', 'preview'].includes(args[1]) || args.slice(2).some((arg, i, tail) => arg !== '--artifact-dir' && tail[i - 1] !== '--artifact-dir')) throw new Error('Usage: release-gate.mjs --check-release stable|preview [--artifact-dir <path>]');
  const index = args.indexOf('--artifact-dir');
  if (index >= 0 && !args[index + 1]) throw new Error('--artifact-dir requires a path');
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'docs/release/v2-validation.json'), 'utf8'));
  let expectedCommit;
  if (args[1] === 'stable' && execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()) throw new Error('Stable release requires a clean committed candidate');
  if (args[1] === 'stable') {
    if (!commitPattern.test(manifest.sourceCommit ?? '')) throw new Error('Stable release requires a tested source commit');
    // Evidence may be committed after the tested candidate. Only the evidence ledger and its
    // hashed attachments may differ, avoiding a self-referential commit hash in the ledger.
    execFileSync('git', ['merge-base', '--is-ancestor', manifest.sourceCommit, 'HEAD'], { cwd: repositoryRoot });
    execFileSync('git', ['diff', '--exit-code', manifest.sourceCommit, 'HEAD', '--', '.', ':!docs/release/v2-validation.json', ':!docs/release/evidence/v2/**'], { cwd: repositoryRoot, stdio: 'pipe' });
    expectedCommit = manifest.sourceCommit;
  }
  const result = await checkRelease(args[1], manifest, { expectedCommit, artifactDir: index >= 0 ? path.resolve(args[index + 1]) : path.join(repositoryRoot, 'release') });
  console.log(`${result.channel} gate accepted (${result.passed}/${result.required} manual checks recorded). No publication performed.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
