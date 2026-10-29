// Explicit integration test against an installed pinned Herdr. Every server and
// shell belongs to a fresh private temp directory; never connects to user state.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const herdr = process.env.MCW_TEST_HERDR ?? 'herdr';
const bridgePath = process.env.MCW_TEST_BRIDGE ?? path.join(root, 'build/herdr-bridge', `${process.platform}-${process.arch}`, `mcw-herdr-bridge${process.platform === 'win32' ? '.exe' : ''}`);
const temp = await mkdtemp(path.join(os.tmpdir(), 'mcw-herdr-bridge-e2e-'));
const env = { ...process.env, XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') };
for (const name of ['HERDR_SOCKET_PATH', 'HERDR_CLIENT_SOCKET_PATH', 'HERDR_CONFIG_PATH', 'HERDR_SESSION']) delete env[name];
await mkdir(path.join(env.XDG_CONFIG_HOME, 'herdr'), { recursive: true });
await writeFile(path.join(env.XDG_CONFIG_HOME, 'herdr/config.toml'), `[update]\nversion_check = false\nmanifest_check = false\n[session]\nresume_agents_on_restore = false\n[terminal]\ndefault_shell = ${JSON.stringify(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh')}\nshell_mode = "non_login"\n`);
const server = spawn(herdr, ['--session', 'mcw-v2', 'server'], { env, cwd: temp, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => { if (serverLog.length < 1000000) serverLog += chunk; });
const ownedBridges = [];
const deadline = async (predicate, description, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = predicate();
    if (result) return result;
    await delay(25);
  }
  throw new Error(`timeout: ${description}\n${serverLog.slice(-2000)}`);
};

function attach() {
  const socket = path.join(env.XDG_CONFIG_HOME, 'herdr/sessions/mcw-v2/herdr-client.sock');
  const process = spawn(bridgePath, ['--socket', socket], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const events = [];
  let stderr = '';
  process.stderr.on('data', (bytes) => { stderr += bytes; });
  createInterface({ input: process.stdout }).on('line', (line) => {
    const event = JSON.parse(line);
    if (events.length >= 10000) throw new Error('excessive bridge events');
    events.push(event);
  });
  const send = (command) => process.stdin.write(`${JSON.stringify(command)}\n`);
  const wait = (predicate, description) => deadline(() => {
    const fatal = events.find((event) => event.type === 'error' && event.fatal);
    if (fatal) throw new Error(`bridge fatal: ${fatal.message} ${stderr}`);
    return events.find(predicate);
  }, description);
  const client = { process, events, send, wait };
  ownedBridges.push(client);
  send({ type: 'hello', cols: 40, rows: 8, sizeOwner: true });
  return client;
}

async function request(client, bootId, id, method, params) {
  client.send({ type: 'request', bootId, request: { id, method, params } });
  const final = await client.wait((event) => event.type === 'response' && event.requestId === id && event.finalChunk, method);
  assert.equal(final.bootId, bootId);
  const chunks = client.events.filter((event) => event.type === 'response' && event.requestId === id);
  const response = JSON.parse(Buffer.concat(chunks.map((event) => Buffer.from(event.dataBytes))).toString('utf8'));
  assert.equal(response.error, undefined, JSON.stringify(response));
  return response.result;
}

try {
  const socket = path.join(env.XDG_CONFIG_HOME, 'herdr/sessions/mcw-v2/herdr-client.sock');
  await deadline(() => server.exitCode === null, 'server launch', 1000);
  for (let attempt = 0; ; attempt += 1) {
    try { await access(socket); break; } catch { if (attempt > 200) throw new Error(`server socket unavailable: ${serverLog}`); await delay(25); }
  }
  const first = attach();
  await first.wait((event) => event.type === 'control' && event.kind === 'endpoint.welcome.v1', 'generation 1 welcome');
  const snapshot = (await first.wait((event) => event.type === 'control' && event.kind === 'shell.snapshot.v1', 'shell snapshot')).data;
  const bootId = snapshot.boot_id;
  let pane = snapshot.panes.find((pane) => pane.focused) ?? snapshot.panes[0];
  if (!pane) {
    await request(first, bootId, 'create-workspace', 'workspace.create', { cwd: temp, label: 'MCW bridge private test', focus: true });
    const created = await first.wait((event) => event.type === 'control' && event.kind === 'shell.snapshot.v1' && event.data.panes.length > 0, 'new workspace pane');
    pane = created.data.panes[0];
  }
  const initialSurface = await first.wait((event) => event.type === 'surface' && event.surface.panes.some((item) => item.pane_id === pane.pane_id), 'full semantic surface');
  const tabA = first.events.filter((event) => event.kind === 'shell.snapshot.v1').at(-1).data.focused_tab_id;
  const tabBResult = await request(first, bootId, 'create-tab', 'tab.create', { cwd: temp, focus: false, label: 'MCW independent tab B' });
  const second = attach();
  const secondSnapshot = (await second.wait((event) => event.kind === 'shell.snapshot.v1', 'second shell snapshot')).data;
  const allTabs = (await first.wait((event) => event.kind === 'shell.snapshot.v1' && event.data.tabs.length > 1, 'two tabs')).data.tabs;
  const tabB = allTabs.find((tab) => tab.tab_id !== tabA).tab_id;
  await request(second, secondSnapshot.boot_id, 'focus-second', 'tab.focus', { tab_id: tabB });
  await second.wait((event) => event.kind === 'shell.snapshot.v1' && event.data.focused_tab_id === tabB, 'second connection selected B');
  await delay(200);
  assert.equal(first.events.filter((event) => event.kind === 'shell.snapshot.v1').at(-1).data.focused_tab_id, tabA, 'second connection must not navigate first');
  first.send({ type: 'input', paneId: pane.pane_id, events: [{ TextCommit: process.platform === 'win32' ? 'cd /d C:\\ & cls & echo MCW_REAL_%OS%' : "printf '\\033[2J\\033[HMCW_REAL_%s\\n' SURFACE" }, { Key: { code: 'Enter', modifiers: 0, kind: 'Press', repeat_count: 1, shifted_codepoint: null, generated_text: null, tracks_release: false, physical_key_id: null, windows_record: null } }] });
  await first.wait((event) => event.type === 'patch' && event.patch.surface_revision > initialSurface.surface.surface_revision, 'semantic input incremental patch');
  first.send({ type: 'resize', cols: 41, rows: 9, cellWidthPx: 8, cellHeightPx: 16 });
  const resized = await first.wait((event) => event.type === 'surface' && event.surface.frame.width === 41 && event.surface.frame.height === 9, 'size owner resize');
  first.send({ type: 'surfaceInterest', active: false });
  await first.wait((event) => event.type === 'response' && event.requestId === 'mcw-surface-off' && event.finalChunk, 'surface deactivation');
  first.send({ type: 'surfaceInterest', active: true });
  await first.wait((event) => event.type === 'response' && event.requestId === 'mcw-surface-on' && event.finalChunk, 'surface activation');
  const fixtureDir = path.join(root, '.cache/herdr-bridge-e2e');
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(path.join(fixtureDir, 'surface.json'), JSON.stringify(resized));
  await writeFile(path.join(fixtureDir, 'patch.json'), JSON.stringify(first.events.find((event) => event.type === 'patch')));
  console.log(JSON.stringify({ ok: true, endpointGeneration: 1, herdrVersion: '0.9.5', isolatedTemp: temp, fullFrames: first.events.filter((event) => event.type === 'surface').length, patches: first.events.filter((event) => event.type === 'patch').length, independentTabSelection: true, resize: [41, 9], surfaceInterest: true, fixtureDir, tabBResult }));
} finally {
  for (const client of ownedBridges) {
    if (client.process.exitCode === null) {
      client.send({ type: 'detach' });
      client.process.stdin.end();
    }
  }
  // This CLI addresses only our fresh XDG directory and named mcw-v2 test session.
  const stop = spawn(herdr, ['--session', 'mcw-v2', 'server', 'stop'], { env, cwd: temp, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve) => { stop.once('exit', resolve); stop.once('error', resolve); });
  await deadline(() => server.exitCode !== null, 'owned private server stop').catch(() => {});
}
