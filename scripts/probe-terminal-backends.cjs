// Windows: node scripts/probe-terminal-backends.cjs [result.json]
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (process.argv[2] === "--fixture") {
  process.stdin.setRawMode(true);
  process.stdout.write("PROBE_READY\r\n");
  process.stdin.once("data", () => {
    const alternate = process.argv[3] === "alternate";
    if (alternate) process.stdout.write("\x1b[?1049h");
    let frame = 0;
    const draw = () => {
      if (!alternate) return;
      let output = "\x1b[H";
      for (let row = 1; row < process.stdout.rows; row++) {
        const label = `ROW_${String(row).padStart(2, "0")}`;
        output += `\x1b[${row};1H${label}${".".repeat(Math.max(0, process.stdout.columns - label.length - 5))}EDGE\x1b[K`;
      }
      process.stdout.write(output + "\x1b[H");
    };
    process.stdout.on("resize", draw);
    const timer = setInterval(() => {
      frame++;
      if (alternate) draw();
      else process.stdout.write(`LINE_${String(frame).padStart(4, "0")}_${"x".repeat(83)}\r\n`);
      if (frame === 240) {
        clearInterval(timer);
        fs.writeFileSync(process.argv[4], "done");
      }
    }, 4);
  });
  return;
}

const pty = require("node-pty");
if (process.platform !== "win32") throw new Error("This probe compares Windows ConPTY backends");
const { JSDOM } = require("jsdom");
const dom = new JSDOM();
global.self = dom.window;
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
const { Terminal } = require("@xterm/xterm");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));

async function probe(bundled, mode, trial) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcw-conpty-probe-"));
  const doneFile = path.join(root, "done");
  const terminal = new Terminal({ cols: 120, rows: 30, scrollback: 5000, allowProposedApi: true });
  const started = performance.now();
  const child = pty.spawn(process.execPath, [__filename, "--fixture", mode, doneFile], {
    cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, cols: 120, rows: 30,
    useConpty: true, useConptyDll: bundled,
  });
  let output = "";
  let queue = Promise.resolve();
  child.onData(data => { output += data; queue = queue.then(() => write(terminal, data)); });
  terminal.onData(data => child.write(data));
  try {
    while (!output.includes("PROBE_READY")) {
      if (performance.now() - started > 15000) throw new Error("PTY startup timed out");
      await delay(10);
    }
    const startupMs = Math.round(performance.now() - started);
    child.write("g");
    for (const cols of [80, 120, 60, 100]) {
      await delay(150);
      terminal.resize(cols, 30);
      child.resize(cols, 30);
    }
    while (!fs.existsSync(doneFile)) {
      if (performance.now() - started > 20000) throw new Error("Fixture timed out");
      await delay(20);
    }
    await delay(120);
    await queue;
    const buffer = () => Array.from({ length: terminal.buffer.active.length }, (_, i) => terminal.buffer.active.getLine(i).translateToString(true)).join("\n");
    const ids = [...buffer().matchAll(/LINE_(\d{4})_/g)].map(m => Number(m[1]));
    const missing = mode === "normal" ? Array.from({ length: 240 }, (_, i) => i + 1).filter(i => !ids.includes(i)).length : null;
    const screen = () => Array.from({ length: 29 }, (_, i) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + i).translateToString(true, 0, terminal.cols));
    const beforeRepaint = screen();
    await write(terminal, "\x1b[2J\x1b[HDELIBERATELY_CORRUPTED\x1b[H");
    const bytesBefore = output.length;
    child.resize(100, 30);
    await delay(150);
    await queue;
    return { backend: bundled ? "bundled" : "inbox", mode, trial, startupMs, missing,
      duplicateLines: mode === "normal" ? ids.length - new Set(ids).size : null,
      syncBlocks: (output.match(/\x1b\[\?2026h/g) || []).length,
      sameSizeBytes: output.length - bytesBefore,
      sameSizeRepairsFrame: mode === "alternate" ? JSON.stringify(screen()) === JSON.stringify(beforeRepaint) : null,
      repaintMismatchedRows: mode === "alternate" ? screen().filter((line, i) => line !== beforeRepaint[i]).length : null,
      firstRowBefore: mode === "alternate" ? beforeRepaint[0] : null,
      firstRowAfter: mode === "alternate" ? screen()[0] : null };
  } finally {
    // Graceful exit avoids node-pty's console-list helper racing a console already closed by kill.
    try { process.kill(child.pid); } catch {}
    terminal.dispose();
    await delay(50);
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("mcw-conpty-probe-")) {
      throw new Error("Refusing to remove an unexpected probe directory");
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

(async () => {
  const results = [];
  for (let trial = 1; trial <= 3; trial++) for (const mode of ["normal", "alternate"]) for (const bundled of [false, true]) {
    const result = await probe(bundled, mode, trial);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const destination = process.argv[2] || ".cache/terminal-backends.json";
  fs.writeFileSync(destination, JSON.stringify({ nodePty: require("node-pty/package.json").version,
    windows: os.release(), results }, null, 2));
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
