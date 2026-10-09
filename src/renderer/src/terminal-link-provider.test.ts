import type { ILink, Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import { createFileLinkProvider } from "./terminal-link-provider";

/** A buffer of plain one-cell characters, each entry one row; `wrapped` marks rows continuing the previous. */
function fakeTerminal(rows: Array<{ text: string; wrapped?: boolean }>): Terminal {
  const element = document.createElement("div");
  return {
    element,
    buffer: {
      active: {
        getLine(index: number) {
          const row = rows[index];
          if (!row) return undefined;
          return {
            isWrapped: Boolean(row.wrapped),
            length: row.text.length,
            getCell(x: number) {
              const char = row.text[x];
              return char === undefined ? undefined : { getChars: () => char, getWidth: () => 1 };
            },
          };
        },
      },
    },
  } as unknown as Terminal;
}

function provide(terminal: Terminal, provider: ReturnType<typeof createFileLinkProvider>, y: number) {
  return new Promise<ILink[] | undefined>((resolve) => provider.provideLinks(y, resolve));
}

const target = { kind: "project" as const, id: "p1" };

describe("createFileLinkProvider", () => {
  it("links only the candidates main confirms, and opens them on Ctrl+click at their line", async () => {
    const terminal = fakeTerminal([{ text: "edit src/a.ts:12:3 and e.g. b.md" }]);
    const resolve = vi.fn(async (raw: string) => (raw === "src/a.ts" ? { target, relativePath: "src/a.ts" } : null));
    const open = vi.fn();
    const links = await provide(terminal, createFileLinkProvider(terminal, { resolve, open }), 1);

    expect(links?.map((link) => link.text)).toEqual(["src/a.ts:12:3"]);
    expect(links?.[0].range).toEqual({ start: { x: 6, y: 1 }, end: { x: 18, y: 1 } });

    links![0].activate(new MouseEvent("click"), links![0].text);
    expect(open).not.toHaveBeenCalled();
    links![0].activate(new MouseEvent("click", { ctrlKey: true }), links![0].text);
    expect(open).toHaveBeenCalledWith({ target, relativePath: "src/a.ts" }, { line: 12, column: 3 });
  });

  it("asks main once per path while the answer is fresh", async () => {
    const terminal = fakeTerminal([{ text: "a.ts" }, { text: "a.ts again" }]);
    const resolve = vi.fn(async () => ({ target, relativePath: "a.ts" }));
    let time = 0;
    const provider = createFileLinkProvider(terminal, { resolve, open: vi.fn(), now: () => time });
    await provide(terminal, provider, 1);
    await provide(terminal, provider, 2);
    expect(resolve).toHaveBeenCalledTimes(1);
    time = 31_000;
    await provide(terminal, provider, 1);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("finds a path wrapped across rows from either row, and reports nothing when there is none", async () => {
    const terminal = fakeTerminal([{ text: "open src/ve" }, { text: "ry/long.ts now", wrapped: true }, { text: "plain" }]);
    const resolve = vi.fn(async () => ({ target, relativePath: "src/very/long.ts" }));
    const provider = createFileLinkProvider(terminal, { resolve, open: vi.fn() });
    expect((await provide(terminal, provider, 2))?.[0].range).toEqual({ start: { x: 6, y: 1 }, end: { x: 10, y: 2 } });
    expect((await provide(terminal, provider, 1))?.[0].text).toBe("src/very/long.ts");
    expect(await provide(terminal, provider, 3)).toBeUndefined();
  });

  it("names the gesture on hover", async () => {
    const terminal = fakeTerminal([{ text: "a.ts" }]);
    const provider = createFileLinkProvider(terminal, { resolve: async () => ({ target, relativePath: "a.ts" }), open: vi.fn() });
    const [link] = (await provide(terminal, provider, 1))!;
    link.hover?.(new MouseEvent("mousemove"), link.text);
    expect(terminal.element!.title).toBe("Ctrl+클릭으로 열기");
    link.leave?.(new MouseEvent("mouseleave"), link.text);
    expect(terminal.element!.title).toBe("");
  });
});
