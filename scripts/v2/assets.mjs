// Acquires immutable official resources only. Never executes an asset or changes an installation.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, gunzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const manifestPath = path.join(root, 'scripts/v2/assets.json');
const shaPattern = /^[a-f0-9]{64}$/;
async function safeDirectory(directory, create = true) {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep)) {
    current = path.join(current, segment);
    if (create) try { await mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Refusing symlink directory: ${current}`);
  }
}
function validateAsset(asset) {
  if (!asset || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || !shaPattern.test(asset.sha256)) throw new Error('Invalid asset length or SHA-256');
}
async function regularFile(file, optional = false) {
  let info;
  try { info = await lstat(file); } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Refusing symlink or non-file: ${file}`);
  return info;
}
async function writeAtomic(destination, data) {
  await safeDirectory(path.dirname(destination));
  await regularFile(destination, true);
  const temporary = `${destination}.${randomUUID()}.partial`;
  try { await writeFile(temporary, data, { flag: 'wx', mode: 0o644 }); await rename(temporary, destination); }
  finally { await rm(temporary, { force: true }); }
}
export async function verifyAsset(asset, file) {
  validateAsset(asset);
  await safeDirectory(path.dirname(file), false);
  const info = await regularFile(file);
  if (info.size !== asset.bytes) throw new Error(`${asset.id}: length mismatch`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== asset.sha256) throw new Error(`${asset.id}: SHA-256 mismatch`);
  return { id: asset.id, bytes: info.size, sha256: asset.sha256 };
}
export async function downloadAsset(asset, destination) {
  validateAsset(asset);
  await regularFile(destination, true);
  try { return await verifyAsset(asset, destination); } catch (error) { if (!['ENOENT'].includes(error.code) && !/length mismatch|SHA-256 mismatch/.test(error.message)) throw error; }
  const url = new URL(asset.url);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Asset download requires HTTPS');
  await safeDirectory(path.dirname(destination));
  const temp = `${destination}.${randomUUID()}.partial`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000), headers: { 'Accept-Encoding': 'identity' } });
    if (!response.ok || !response.body) throw new Error(`${asset.id}: HTTP ${response.status}`);
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== 'https:' && !(url.protocol === 'http:' && finalUrl.origin === url.origin)) { await response.body.cancel(); throw new Error('Refusing insecure asset redirect'); }
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) !== asset.bytes) { await response.body.cancel(); throw new Error(`${asset.id}: advertised length mismatch`); }
    let bytes = 0;
    const hash = createHash('sha256');
    const verifyStream = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > asset.bytes) return callback(new Error(`${asset.id}: streamed length mismatch`));
      hash.update(chunk); callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), verifyStream, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
    if (bytes !== asset.bytes) throw new Error(`${asset.id}: streamed length mismatch`);
    if (hash.digest('hex') !== asset.sha256) throw new Error(`${asset.id}: SHA-256 mismatch`);
    await regularFile(destination, true);
    await rename(temp, destination);
    return { id: asset.id, bytes, sha256: asset.sha256 };
  } finally { await rm(temp, { force: true }); }
}
export async function extractPinnedZip(zip, members, directory) {
  validateMembers(members);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) { end = i; break; }
  if (end < 0 || zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6)) throw new Error('Unsupported ZIP archive');
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  const selected = new Map();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP central directory');
    const nameLength = zip.readUInt16LE(cursor + 28), extraLength = zip.readUInt16LE(cursor + 30), commentLength = zip.readUInt16LE(cursor + 32);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const member = members.find(m => m.file === name);
    if (member) {
      if (selected.has(name) || zip.readUInt16LE(cursor + 8) & 1) throw new Error('Duplicate or encrypted ZIP member');
      const local = zip.readUInt32LE(cursor + 42), compressed = zip.readUInt32LE(cursor + 20), bytes = zip.readUInt32LE(cursor + 24), method = zip.readUInt16LE(cursor + 10);
      if (local + 30 > cursor || zip.readUInt32LE(local) !== 0x04034b50 || bytes !== member.bytes || ![0, 8].includes(method)) throw new Error('Invalid ZIP member length/method');
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      if (start + compressed > cursor) throw new Error('Invalid ZIP member bounds');
      const data = method === 0 ? zip.subarray(start, start + compressed) : inflateRawSync(zip.subarray(start, start + compressed), { maxOutputLength: member.bytes });
      if (data.length !== member.bytes || createHash('sha256').update(data).digest('hex') !== member.sha256) throw new Error(`Archive member SHA-256/length mismatch: ${name}`);
      selected.set(name, data);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  await publishMembers(members, selected, directory);
}
function validateMembers(members) {
  for (const member of members) {
    validateAsset(member);
    for (const file of [member.file, member.output ?? member.file]) if (typeof file !== 'string' || !file || path.posix.normalize(file) !== file || file.includes('..') || file.includes('\\') || file.startsWith('/') || file.includes(':')) throw new Error('Invalid archive member path');
  }
  if (new Set(members.map(m => m.file)).size !== members.length || new Set(members.map(m => m.output ?? m.file)).size !== members.length) throw new Error('Duplicate archive member path');
}
export async function extractPinnedTarGz(archive, members, directory) {
  validateMembers(members);
  const tar = gunzipSync(archive, { maxOutputLength: 512 * 1024 * 1024 });
  const selected = new Map();
  for (let cursor = 0; cursor + 512 <= tar.length;) {
    const header = tar.subarray(cursor, cursor + 512);
    if (header.every(byte => byte === 0)) break;
    const text = (start, length) => header.subarray(start, start + length).toString('utf8').split('\0')[0];
    const sizeText = text(124, 12).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Invalid tar entry length');
    const bytes = Number.parseInt(sizeText, 8), prefix = text(345, 155), base = text(0, 100), name = prefix ? `${prefix}/${base}` : base;
    const start = cursor + 512;
    if (!Number.isSafeInteger(bytes) || start + bytes > tar.length) throw new Error('Invalid tar entry bounds');
    const member = members.find(m => m.file === name);
    if (member) {
      if (![0, 48].includes(header[156])) throw new Error('Pinned tar member must be a regular file');
      if (selected.has(name)) throw new Error('Duplicate tar member');
      const data = tar.subarray(start, start + bytes);
      if (bytes !== member.bytes || createHash('sha256').update(data).digest('hex') !== member.sha256) throw new Error(`Archive member SHA-256/length mismatch: ${name}`);
      selected.set(name, data);
    }
    cursor += 512 + Math.ceil(bytes / 512) * 512;
  }
  await publishMembers(members, selected, directory);
}
async function publishMembers(members, selected, directory) {
  if (selected.size !== members.length) throw new Error('Missing pinned archive members');
  // All members pass before any executable is promoted.
  for (const member of members) {
    await writeAtomic(path.join(directory, member.output ?? member.file), selected.get(member.file));
  }
}
export async function loadManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.herdrVersion !== '0.9.5' || manifest.herdrSourceCommit !== '2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01' || manifest.recoveryVersion !== '1.55.1') throw new Error('Unrecognized pinned v2 resource manifest');
  for (const asset of manifest.assets) {
    validateAsset(asset);
    const url = new URL(asset.url);
    const node = asset.role === 'recovery-runtime-archive';
    const expectedRepo = node ? 'nodejs/node' : asset.role === 'original-v1-installer' ? 'rafaam11/multi-cli-work' : 'herdrdev/herdr';
    const expectedTag = node ? 'v22.12.0' : asset.role === 'original-v1-installer' ? 'v1.55.1' : 'v0.9.5';
    const expectedUrl = node ? `https://nodejs.org/dist/${expectedTag}/${path.posix.basename(asset.file)}` : `https://github.com/${expectedRepo}/releases/download/${expectedTag}/${path.posix.basename(asset.file)}`;
    if (url.href !== expectedUrl || asset.repository !== expectedRepo || asset.tag !== expectedTag || path.posix.normalize(asset.file) !== asset.file || asset.file.startsWith('/') || asset.file.includes('..') || asset.file.includes('\\')) throw new Error(`Invalid official asset provenance: ${asset.id}`);
  }
  if (manifest.assets.length !== 7 || new Set(manifest.assets.map(a => a.id)).size !== 7) throw new Error('Missing or duplicated required pinned assets');
  if (!Array.isArray(manifest.windowsMembers) || manifest.windowsMembers.length !== 7 || new Set(manifest.windowsMembers.map(m => m.file)).size !== 7) throw new Error('Missing pinned Windows resource members');
  for (const member of manifest.windowsMembers) validateAsset(member);
  if (manifest.nodeVersion !== '22.12.0' || manifest.nodeChecksumsUrl !== 'https://nodejs.org/dist/v22.12.0/SHASUMS256.txt' || manifest.nodeChecksumsSha256 !== '4d4dc7ec5755c7b034127c9f13ba83efe9869d2aa11c173d901a551da0f4649f') throw new Error('Invalid pinned Node provenance');
  const checksums = await readFile(path.join(root, 'scripts/v2/node-v22.12.0-SHASUMS256.txt'));
  if (createHash('sha256').update(checksums).digest('hex') !== manifest.nodeChecksumsSha256) throw new Error('Official Node checksums file changed');
  for (const asset of manifest.assets.filter(a => a.role === 'recovery-runtime-archive')) if (!checksums.toString('utf8').split('\n').includes(`${asset.sha256}  ${path.posix.basename(asset.file)}`)) throw new Error('Node archive is not in official SHASUMS256');
  if (manifest.nodeRuntimes.length !== 2) throw new Error('Both standalone Node runtimes are required');
  for (const runtime of manifest.nodeRuntimes) {
    if (runtime.directory !== (runtime.platform === 'win32' ? 'node/windows' : 'node/linux') || !manifest.assets.some(a => a.id === runtime.archiveId && a.platform === runtime.platform && a.role === 'recovery-runtime-archive')) throw new Error('Invalid Node runtime mapping');
    validateMembers(runtime.members);
  }
  return manifest;
}
export async function stageAssets({ download = false, platform = 'all', directory = path.join(root, 'build/v2') } = {}) {
  if (!['all', 'win32', 'linux'].includes(platform)) throw new Error('Supported platforms: all, win32, linux');
  const manifest = await loadManifest();
  const assets = manifest.assets.filter(a => platform === 'all' || a.platform === platform);
  for (const asset of assets) {
    const file = path.join(directory, asset.file);
    await (download ? downloadAsset(asset, file) : verifyAsset(asset, file));
    console.log(`Verified ${asset.id} (${asset.bytes} bytes)`);
  }
  if (platform === 'all' || platform === 'win32') {
    const windowsDir = path.join(directory, 'herdr/windows');
    if (download) await extractPinnedZip(await readFile(path.join(directory, 'herdr/herdr-windows-x86_64.zip')), manifest.windowsMembers, windowsDir);
    for (const member of manifest.windowsMembers) await verifyAsset({ ...member, id: member.file }, path.join(windowsDir, member.file));
  }
  for (const runtime of manifest.nodeRuntimes.filter(r => platform === 'all' || r.platform === platform)) {
    const runtimeDir = path.join(directory, runtime.directory);
    if (download) {
      const archive = manifest.assets.find(a => a.id === runtime.archiveId);
      await (runtime.platform === 'win32' ? extractPinnedZip : extractPinnedTarGz)(await readFile(path.join(directory, archive.file)), runtime.members, runtimeDir);
    }
    for (const member of runtime.members) await verifyAsset({ ...member, id: member.file }, path.join(runtimeDir, member.output));
    if (download && runtime.platform === 'linux' && process.platform !== 'win32') await chmod(path.join(runtimeDir, 'node'), 0o755);
  }
  if (download && process.platform !== 'win32' && (platform === 'all' || platform === 'linux')) await chmod(path.join(directory, 'herdr/herdr-linux-x86_64'), 0o755);
  if (download) {
    // Copy the pinned manifest, never a mutable "verified=true" receipt. Every build rehashes.
    await writeAtomic(path.join(directory, 'assets.json'), await readFile(manifestPath));
  }
  const pinnedManifest = await readFile(manifestPath);
  await verifyAsset({ id: 'staged-resource-manifest', bytes: pinnedManifest.length, sha256: createHash('sha256').update(pinnedManifest).digest('hex') }, path.join(directory, 'assets.json'));
  return assets;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg, i) => !['--download', '--verify', '--platform'].includes(arg) && args[i - 1] !== '--platform')) throw new Error('Usage: assets.mjs --download|--verify [--platform win32|linux|all]');
  const index = args.indexOf('--platform');
  await stageAssets({ download: args.includes('--download'), platform: index >= 0 ? args[index + 1] : 'all' });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
