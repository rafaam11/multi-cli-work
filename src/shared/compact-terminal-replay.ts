const SGR = /\u001b\[[\d;:]*m/g;
const RESET = /\u001b\[(?:0)?m/g;
// Only complete, bounded line replacements are eligible. Other control sequences and line feeds
// are barriers; in particular this never discards scrolling output or a full-screen frame.
const FRAME = /((?:\r|\u001b\[\d{1,4};1H)\u001b\[(?:2)?K)((?:[\x20-\x7e\u00a0-\uffff]|\u001b\[[\d;:]*m)*)/y;
const CONTROL = /\r|\u001b(?:\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|[\s\S])/g;

/**
 * Repeated progress/spinner lines can evict an entire conversation from a byte-bounded replay.
 * Keep the last of adjacent full replacements of the same row, retaining all SGR effects. A size
 * record must establish a width first, and a conservative width bound prevents compacting a line
 * that could have wrapped into scrollback. Live PTY delivery is never compacted.
 */
export function compactTerminalReplay(data: string, initialCols?: number): string {
  const scanner = new RegExp(CONTROL.source, "g");
  const frame = new RegExp(FRAME.source, "y");
  let cols = initialCols;
  let standardWidth = true;
  let previous: { start: number; end: number; anchor: string; payload: string; carry: string } | undefined;
  let emitted = 0;
  let changed = false;
  const output: string[] = [];
  const flush = () => {
    if (!previous) return;
    output.push(data.slice(emitted, previous.start), previous.carry, previous.anchor, previous.payload);
    emitted = previous.end;
  };
  for (let token = scanner.exec(data); token; token = scanner.exec(data)) {
    if (token[0] === "\u001b#" || /^\u001b\[\?[^hl]*\b69(?:;|h)/.test(token[0])) standardWidth = false;
    if (token[0] === "\u001bc") standardWidth = true;
    if (token[0][0] === "\u001b" && "]PX^_".includes(token[0][1])) {
      const bel = token[0][1] === "]" ? data.indexOf("\u0007", scanner.lastIndex) : -1;
      // Bound the ST search by an earlier BEL: scanning the whole remaining log for every small
      // OSC would otherwise turn many size records into quadratic work.
      const relativeSt = data.slice(scanner.lastIndex, bel < 0 ? undefined : bel).indexOf("\u001b\\");
      const end = relativeSt >= 0 ? scanner.lastIndex + relativeSt + 2 : bel >= 0 ? bel + 1 : data.length;
      const size = /^\u001b\]7719;(\d{1,5});\d{1,5}\u0007$/.exec(data.slice(token.index, end));
      if (size) cols = Number(size[1]);
      scanner.lastIndex = end;
      continue;
    }
    if (!standardWidth || !cols || cols < 2 || cols > 2000) continue;
    frame.lastIndex = token.index;
    const match = frame.exec(data);
    if (!match) continue;
    scanner.lastIndex = frame.lastIndex;
    const plain = match[2].replace(SGR, "");
    // Two cells per non-ASCII code point is an upper bound (including combining/ZWJ sequences).
    let width = 0;
    for (const character of plain) width += character.codePointAt(0)! < 128 ? 1 : 2;
    if (width >= cols) continue;
    if (previous && previous.end === token.index && previous.anchor === match[1]) {
      let carry = previous.carry + (previous.payload.match(SGR) ?? []).join("");
      let lastReset = 0;
      for (const reset of carry.matchAll(RESET)) lastReset = reset.index;
      carry = carry.slice(lastReset);
      if (carry.length <= 4096) {
        previous.end = frame.lastIndex;
        previous.payload = match[2];
        previous.carry = carry;
        changed = true;
        continue;
      }
    }
    flush();
    previous = { start: token.index, end: frame.lastIndex, anchor: match[1], payload: match[2], carry: "" };
  }
  if (!changed) return data;
  flush();
  output.push(data.slice(emitted));
  return output.join("");
}
