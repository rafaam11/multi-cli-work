// @vitest-environment node
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadAsset, verifyAsset, extractPinnedZip, extractPinnedTarGz } from './assets.mjs';

const cleanups = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function fixture(body, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcw-assets-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const server = createServer((_req, res) => { res.writeHead(200, options.headers ?? { 'Content-Length': body.length }); res.end(body); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise(resolve => server.close(resolve)));
  return { dir, dest: path.join(dir, 'asset.bin'), asset: { id: 'test', url: `http://127.0.0.1:${server.address().port}/asset`, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') } };
}
describe('verified asset acquisition', () => {
  it('streams a verified resource to an atomic final file and rechecks cached content', async () => {
    const f = await fixture(Buffer.from('official installer fixture'));
    await downloadAsset(f.asset, f.dest);
    expect(await readFile(f.dest, 'utf8')).toBe('official installer fixture');
    await verifyAsset(f.asset, f.dest);
    await writeFile(f.dest, 'tampered');
    await expect(verifyAsset(f.asset, f.dest)).rejects.toThrow(/length|SHA-256/);
  });
  it('does not replace an existing asset or leave temp files after a hash failure', async () => {
    const f = await fixture(Buffer.from('corrupted download'));
    await writeFile(f.dest, 'previous resource');
    await expect(downloadAsset({ ...f.asset, sha256: '0'.repeat(64) }, f.dest)).rejects.toThrow(/SHA-256/);
    expect(await readFile(f.dest, 'utf8')).toBe('previous resource');
    expect(await readdir(f.dir)).toEqual(['asset.bin']);
  });
  it('rejects wrong advertised or streamed length without promoting content', async () => {
    const f = await fixture(Buffer.from('12345'));
    await expect(downloadAsset({ ...f.asset, bytes: 4 }, f.dest)).rejects.toThrow(/length/);
    expect(await readdir(f.dir)).toEqual([]);
    const streamed = await fixture(Buffer.from('12345'), { headers: {} });
    await expect(downloadAsset({ ...streamed.asset, bytes: 4 }, streamed.dest)).rejects.toThrow(/length/);
    expect(await readdir(streamed.dir)).toEqual([]);
  });
  it('rejects symlink final paths without touching their target', async () => {
    const f = await fixture(Buffer.from('safe'));
    const { symlink } = await import('node:fs/promises');
    const target = path.join(f.dir, 'target');
    await writeFile(target, 'preserved');
    try { await symlink(target, f.dest); } catch (e) { if (e.code === 'EPERM') return; throw e; }
    await expect(downloadAsset(f.asset, f.dest)).rejects.toThrow(/symlink/);
    expect(await readFile(target, 'utf8')).toBe('preserved');
  });
  it('does not write through a symlink staging directory', async () => {
    const f = await fixture(Buffer.from('safe'));
    const { symlink, mkdir } = await import('node:fs/promises');
    const target = path.join(f.dir, 'outside'), link = path.join(f.dir, 'linked');
    await mkdir(target);
    try { await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir'); } catch (e) { if (e.code === 'EPERM') return; throw e; }
    await expect(downloadAsset(f.asset, path.join(link, 'asset.bin'))).rejects.toThrow(/symlink/);
    expect(await readdir(target)).toEqual([]);
    await writeFile(path.join(target, 'asset.bin'), 'safe');
    await expect(verifyAsset(f.asset, path.join(link, 'asset.bin'))).rejects.toThrow(/symlink/);
  });
  it('extracts only pinned archive members and refuses traversal or changed extracted content', async () => {
    const f = await fixture(Buffer.from('unused'));
    // Minimal single stored ZIP, generated in the fixture rather than a production download.
    const name = Buffer.from('herdr.exe'), body = Buffer.from('fixture binary');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + body.length, 16);
    const zip = Buffer.concat([local, name, body, central, name, end]);
    const members = [{ file: 'herdr.exe', bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }];
    await extractPinnedZip(zip, members, f.dir);
    expect(await readFile(path.join(f.dir, 'herdr.exe'), 'utf8')).toBe('fixture binary');
    await expect(extractPinnedZip(zip, [{ ...members[0], sha256: '0'.repeat(64) }], f.dir)).rejects.toThrow(/SHA-256/);
    await expect(extractPinnedZip(zip, [{ ...members[0], file: '../outside' }], f.dir)).rejects.toThrow(/path/);
  });
  it('extracts pinned regular tar members without accepting symlink or oversized entries', async () => {
    const f = await fixture(Buffer.from('unused')), body = Buffer.from('standalone node fixture');
    const header = Buffer.alloc(512); header.write('node-v22.12.0-linux-x64/bin/node'); header.write(body.length.toString(8).padStart(11, '0') + '\0', 124); header[156] = 48;
    const member = { file: 'node-v22.12.0-linux-x64/bin/node', bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
    const tar = Buffer.concat([header, body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)]);
    await extractPinnedTarGz(gzipSync(tar), [member], f.dir);
    expect(await readFile(path.join(f.dir, member.file), 'utf8')).toBe('standalone node fixture');
    await expect(extractPinnedTarGz(gzipSync(tar), [{ ...member, bytes: 1 }], f.dir)).rejects.toThrow(/length/);
    tar[156] = 50;
    await expect(extractPinnedTarGz(gzipSync(tar), [member], f.dir)).rejects.toThrow(/regular/);
  });
});
