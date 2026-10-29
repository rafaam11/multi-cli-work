import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
await mkdir(path.join(root, 'build/v2/host'), { recursive: true });
await build({ absWorkingDir: root, entryPoints: ['src/main/mcw-host.ts', 'src/main/mcw-task-mcp-client.ts'], outdir: 'build/v2/host', platform: 'node', target: 'node22', format: 'cjs', bundle: true, packages: 'bundle', external: ['bufferutil', 'utf-8-validate'], legalComments: 'eof' });
await copyFile(path.join(root, 'scripts/v2/assets.json'), path.join(root, 'build/v2/assets.json'));
console.log('Standalone mcw-host and task MCP built for pinned Node 22.12.0.');
