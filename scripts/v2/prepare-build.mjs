import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const args of [ ['scripts/v2/assets.mjs', '--verify', '--platform', process.platform], ['scripts/build-herdr-bridge.mjs'], ['scripts/v2/build-host.mjs'] ]) {
  execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
}
