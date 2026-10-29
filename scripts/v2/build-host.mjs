import { build, transform } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
await mkdir(path.join(root, 'build/v2/host'), { recursive: true });
await build({ absWorkingDir: root, entryPoints: ['src/main/mcw-host.ts', 'src/main/mcw-task-mcp-client.ts'], outdir: 'build/v2/host', platform: 'node', target: 'node22', format: 'cjs', bundle: true, packages: 'bundle', external: ['bufferutil', 'utf-8-validate'], legalComments: 'eof' });
await copyFile(path.join(root, 'scripts/v2/assets.json'), path.join(root, 'build/v2/assets.json'));
const mod=path.join(root,'build/v2/mods/mcw-chips-v2');
await mkdir(path.join(mod,'.claude-plugin'),{recursive:true});
await mkdir(path.join(mod,'types'),{recursive:true});
await mkdir(path.join(mod,'hooks'),{recursive:true});
// Claude's hook validator requires a top-level register export; a bundled export table is refused.
for(const file of ['.claude-plugin/plugin.json','hooks/hooks.json','types/index.d.ts','README.md','hooks/register.ts','hooks/chips.ts','hooks/model.ts','hooks/parse-tests.ts'])await copyFile(path.join(root,'mods/mcw-chips-v2',file),path.join(mod,file));
await writeFile(path.join(mod,'hooks/metadata.ts'),(await readFile(path.join(root,'mods/mcw-chips-v2/hooks/metadata.ts'),'utf8')).replace("../../../src/shared/herdr-metadata","./contract"));
await writeFile(path.join(mod,'hooks/contract.ts'),(await transform(await readFile(path.join(root,'src/shared/herdr-metadata.ts'),'utf8'),{loader:'ts',target:'es2022'})).code);
console.log('Standalone mcw-host and task MCP built for pinned Node 22.12.0.');
