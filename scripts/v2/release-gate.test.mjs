// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRelease, requiredChecks } from './release-gate.mjs';
const dirs = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcw-gate-')); dirs.push(root);
  await writeFile(path.join(root, 'evidence.txt'), 'recorded human evidence');
  const evidence = [{ path: 'evidence.txt', sha256: createHash('sha256').update('recorded human evidence').digest('hex') }];
  const commit = 'a'.repeat(40);
  const manifest = { schemaVersion: 1, candidateVersion: '2.0.0', sourceCommit: commit, checks: requiredChecks.map((id, i) => ({ id, status: 'passed', sourceCommit: commit, completedAt: new Date(Date.UTC(2025, 9, 30, 0, i)).toISOString(), tester: 'human tester', evidence })) };
  return { root, manifest, commit };
}
describe('v2 release gate', () => {
  it('permits only explicitly documented Android deferral, without treating it as a passed test',async()=>{
    const f=await fixture(),relative='docs/release/evidence/v2/android-validation-deferral.md',authorization='User explicitly excluded Android validation from this release.';
    await mkdir(path.dirname(path.join(f.root,relative)),{recursive:true});await writeFile(path.join(f.root,relative),authorization);
    const deferred={status:'deferred',sourceCommit:null,completedAt:null,tester:null,evidence:[{path:relative,sha256:createHash('sha256').update(authorization).digest('hex')}]};
    f.manifest.checks=f.manifest.checks.map(check=>check.id.startsWith('android.')?{id:check.id,...deferred}:check);
    await expect(checkRelease('stable',f.manifest,{root:f.root,expectedCommit:f.commit})).resolves.toMatchObject({passed:23,deferred:8,required:31});
    f.manifest.checks[0]={id:requiredChecks[0],...deferred};
    await expect(checkRelease('stable',f.manifest,{root:f.root,expectedCommit:f.commit})).rejects.toThrow(/Android/);
  });
  it('refuses stable release while any required manual check is pending', async () => {
    const f = await fixture(); f.manifest.checks[0] = { id: requiredChecks[0], status: 'pending', sourceCommit: null, completedAt: null, tester: null, evidence: [] };
    await expect(checkRelease('stable', f.manifest, { root: f.root, expectedCommit: f.commit })).rejects.toThrow(/pending/);
  });
  it('validates complete human evidence and binds it to the candidate commit', async () => {
    const f = await fixture();
    await expect(checkRelease('stable', f.manifest, { root: f.root, expectedCommit: f.commit })).resolves.toMatchObject({ channel: 'stable' });
    await writeFile(path.join(f.root, 'evidence.txt'), 'changed');
    await expect(checkRelease('stable', f.manifest, { root: f.root, expectedCommit: f.commit })).rejects.toThrow(/evidence/);
  });
  it('rejects missing checks, duplicate checks, stale commits and Android performed too early', async () => {
    for (const mutate of [m => m.checks.pop(), m => m.checks.push(m.checks[0]), m => { m.checks[0].sourceCommit = 'b'.repeat(40); }, m => { m.checks.find(c => c.id.startsWith('android.')).completedAt = '2020-01-01T00:00:00.000Z'; }]) {
      const f = await fixture(); mutate(f.manifest);
      await expect(checkRelease('stable', f.manifest, { root: f.root, expectedCommit: f.commit })).rejects.toThrow();
    }
  });
  it('does not allow evidence outside the workspace or unknown schema fields', async () => {
    const f = await fixture(); f.manifest.checks[0].evidence = [{ path: '../private', sha256: '0'.repeat(64) }];
    await expect(checkRelease('stable', f.manifest, { root: f.root, expectedCommit: f.commit })).rejects.toThrow(/evidence/);
    f.manifest.override = true;
    await expect(checkRelease('preview', f.manifest, { root: f.root })).rejects.toThrow(/field/);
  });
  it('allows incomplete preview evidence but rejects every stable updater manifest without changing it', async () => {
    const f = await fixture(); f.manifest.sourceCommit = null;
    f.manifest.checks = requiredChecks.map(id => ({ id, status: 'pending', sourceCommit: null, completedAt: null, tester: null, evidence: [] }));
    await expect(checkRelease('preview', f.manifest, { root: f.root, artifactDir: f.root })).resolves.toMatchObject({ channel: 'preview' });
    await writeFile(path.join(f.root, 'latest-linux.yml'), 'stable metadata');
    await expect(checkRelease('preview', f.manifest, { root: f.root, artifactDir: f.root })).rejects.toThrow(/latest/);
    expect(await readFile(path.join(f.root, 'latest-linux.yml'), 'utf8')).toBe('stable metadata');
  });
});
