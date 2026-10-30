import { describe, expect, it } from "vitest";
import type { CellData, FrameData } from "@shared/herdr-surface-types";
import { drawFrame, DEFAULT_CANVAS_THEME } from "./canvas-renderer";
import { GraphicsCache } from "./graphics-cache";

describe("Herdr Canvas drawing", () => {
  it("paints wide graphemes once, inverse colors, decorations and a bar cursor", () => {
    const text: unknown[][] = [], rects: unknown[][] = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {},
      fillText(...args: unknown[]) { text.push(args); }, fillRect(...args: unknown[]) { rects.push([this.fillStyle, ...args]); },
      fillStyle: "", strokeStyle: "", globalAlpha: 1, font: "", textBaseline: "", lineWidth: 1 };
    const c = (symbol: string): CellData => ({ symbol, fg: 2, bg: 1, modifier: 0, skip: false, hyperlink: null });
    const frame: FrameData = { width: 4, height: 1, cells: [c("한"), { ...c(""), skip: true }, { ...c("é"), modifier: 64 | 8 | 256 }, { ...c("x"), modifier: 128 }], cursor: { x: 2, y: 0, visible: true, shape: 6 }, hyperlinks: [], graphics: [] };
    drawFrame(ctx as unknown as CanvasRenderingContext2D, frame, { cellWidth: 10, cellHeight: 20, fontSize: 16, fontFamily: "monospace" }, DEFAULT_CANVAS_THEME);
    expect(text.map((a) => a[0])).toEqual(["한", "é"]);
    expect(rects).toContainEqual(["#cd3131", 20, 0, 10, 20]);
    expect(rects).toContainEqual([DEFAULT_CANVAS_THEME.cursor, 20, 0, 2, 20]);
  });
  it("uses the real Herdr empty spacer tail for a two-column CJK glyph", () => {
    const clips: number[][] = [], text: string[] = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, clip() {}, fillRect() {}, fillText(s: string) { text.push(s); }, rect(...args: number[]) { clips.push(args); } };
    const c = (symbol: string): CellData => ({ symbol, fg: 0, bg: 0, modifier: 0, skip: false, hyperlink: null });
    drawFrame(ctx as unknown as CanvasRenderingContext2D, { width: 3, height: 1, cells: [c("한"), c(""), c("a")], cursor: null, hyperlinks: [], graphics: [] }, { cellWidth: 10, cellHeight: 20, fontSize: 16, fontFamily: "monospace" }, DEFAULT_CANVAS_THEME);
    expect(clips[0]).toEqual([0, 0, 20, 20]);
    expect(text).toEqual(["한", "a"]);
  });
  it('paints the blank spacer emitted by the native Windows initial resize without clipping Korean glyphs',()=>{
    const clips:number[][]=[];
    const ctx={save(){},restore(){},beginPath(){},clip(){},fillRect(){},fillText(){},rect(...args:number[]){clips.push(args);}};
    const c=(symbol:string):CellData=>({symbol,fg:0,bg:0,modifier:0,skip:false,hyperlink:null});
    drawFrame(ctx as unknown as CanvasRenderingContext2D,{width:5,height:1,cells:[c('한'),c(' '),c('글'),c(' '),c('x')],cursor:null,hyperlinks:[],graphics:[]},{cellWidth:10,cellHeight:20,fontSize:16,fontFamily:'monospace'},DEFAULT_CANVAS_THEME);
    expect(clips[0]).toEqual([0,0,20,20]);
    expect(clips).toContainEqual([20,0,20,20]);
  });
  it("rejects oversized or malformed images without decoding and prunes unused assets", async () => {
    const cache = new GraphicsCache();
    const key = { source: { PaneLayer: { pane_id: "p", layer_id: "l" } }, image_width: 1, image_height: 1, format: "Rgba" as const, data_len: 4, data_fingerprint: "1" };
    await cache.update({ assets: [{ key: { ...key, image_width: 100000 }, data: [0, 0, 0, 0] }, { key, data: [0] }], placements: [], retained_assets: [] });
    expect(cache.byteLength).toBe(0);
    expect(cache.size).toBe(0);
    cache.dispose();
  });
});
