import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pinnedHerdrCommit = '2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01';

export function bridgeBuildArgs({ target, debug = false } = {}) {
  return ['build', '--locked', ...(!debug ? ['--release'] : []), ...(target ? ['--target', target] : [])];
}

export function bridgeArtifact(target) {
  const match = /^(x86_64|aarch64)-(pc-windows-msvc|unknown-linux-(?:gnu|musl))$/.exec(target);
  if (!match) throw new Error(`unsupported bridge target: ${target}`);
  const platform = match[2] === 'pc-windows-msvc' ? 'win32' : 'linux';
  return { platform, arch: match[1] === 'x86_64' ? 'x64' : 'arm64', executable: `mcw-herdr-bridge${platform === 'win32' ? '.exe' : ''}` };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: path.join(root, 'native/herdr-bridge'), stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)));
  });
}

async function main() {
  const args = process.argv.slice(2);
  let target;
  let debug = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--debug') debug = true;
    else if (args[index] === '--target' && args[index + 1]) target = args[++index];
    else throw new Error(`unknown or missing argument: ${args[index]}`);
  }
  target ??= `${process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch}-${process.platform === 'win32' ? 'pc-windows-msvc' : process.platform === 'linux' ? 'unknown-linux-gnu' : process.platform}`;
  const artifact = bridgeArtifact(target);
  await run('cargo', bridgeBuildArgs({ target, debug }));
  const bytes = await readFile(path.join(root, 'native/herdr-bridge/target', target, debug ? 'debug' : 'release', artifact.executable));
  const outDir = path.join(root, 'build/herdr-bridge', `${artifact.platform}-${artifact.arch}`);
  await mkdir(outDir, { recursive: true });
  const output = path.join(outDir, artifact.executable);
  await copyFile(path.join(root, 'native/herdr-bridge/target', target, debug ? 'debug' : 'release', artifact.executable), output);
  await copyFile(path.join(root, 'native/herdr-bridge/LICENSE-HERDR'), path.join(outDir, 'LICENSE-HERDR'));
  await copyFile(path.join(root, 'native/herdr-bridge/NOTICE'), path.join(outDir, 'NOTICE'));
  await writeFile(path.join(outDir, 'bridge.json'), `${JSON.stringify({
    executable: artifact.executable, platform: artifact.platform, arch: artifact.arch, target,
    endpointGeneration: 1, herdrVersion: '0.9.5', herdrCommit: pinnedHerdrCommit,
    sha256: createHash('sha256').update(bytes).digest('hex'), profile: debug ? 'debug' : 'release',
  }, null, 2)}\n`);
  console.log(`Herdr endpoint bridge → ${output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
