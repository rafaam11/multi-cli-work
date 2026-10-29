import type { FrameData, PaneSurfaceFrame } from "@shared/herdr-surface-types";
import { decodeColor, type CellPoint } from "./surface-model";
import type { GraphicsCache } from "./graphics-cache";

export interface CanvasMetrics { cellWidth: number; cellHeight: number; fontSize: number; fontFamily: string }
export interface CanvasTheme { foreground: string; background: string; cursor: string; selection: string }
export const DEFAULT_CANVAS_THEME: CanvasTheme = { foreground: "#e5e5e5", background: "#15171b", cursor: "#a8c7fa", selection: "#7396cf66" };
interface DrawOptions { selection?: { start: CellPoint; end: CellPoint } | null; blinkVisible?: boolean; behindText?(): void; aboveText?(): void }
/** Cell width comes from the server grid, never from JS string length. */
export function drawFrame(context: CanvasRenderingContext2D, frame: FrameData, metrics: CanvasMetrics, theme: CanvasTheme, options: DrawOptions = {}): void {
  const { cellWidth: cw, cellHeight: ch, fontSize, fontFamily } = metrics;
  context.save();
  context.fillStyle = theme.background;
  context.fillRect(0, 0, frame.width * cw, frame.height * ch);
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    const cell = frame.cells[y * frame.width + x];
    context.fillStyle = decodeColor(cell.modifier & 64 ? cell.fg : cell.bg, cell.modifier & 64 ? theme.foreground : theme.background);
    context.fillRect(x * cw, y * ch, cw, ch);
  }
  options.behindText?.();
  context.textBaseline = "alphabetic";
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    const cell = frame.cells[y * frame.width + x], mod = cell.modifier;
    if (cell.skip || cell.symbol === "" || mod & 128 || mod & 48 && options.blinkVisible === false) continue;
    let span = 1;
    while (x + span < frame.width && (frame.cells[y * frame.width + x + span].skip || frame.cells[y * frame.width + x + span].symbol === "")) span++;
    context.save(); context.beginPath(); context.rect(x * cw, y * ch, span * cw, ch); context.clip();
    context.fillStyle = decodeColor(mod & 64 ? cell.bg : cell.fg, mod & 64 ? theme.background : theme.foreground);
    context.strokeStyle = context.fillStyle;
    context.globalAlpha = mod & 2 ? 0.6 : 1;
    context.font = `${mod & 4 ? "italic " : ""}${mod & 1 ? "bold " : ""}${fontSize}px ${fontFamily}`;
    context.fillText(cell.symbol, x * cw, y * ch + (ch - fontSize) / 2 + fontSize * 0.82);
    const underline = mod >>> 12, line = (from: number, to: number, at: number) => { context.beginPath(); context.moveTo(from, at); context.lineTo(to, at); context.stroke(); };
    context.lineWidth = Math.max(1, fontSize / 14);
    if (mod & 8 || underline) {
      const base = (y + 1) * ch - 2;
      if (underline === 3) {
        context.beginPath();
        for (let dx = 0; dx <= span * cw; dx++) {
          const yy = base + Math.sin(dx * Math.PI / 3) * 1.3;
          if (dx === 0) context.moveTo(x * cw, yy); else context.lineTo(x * cw + dx, yy);
        }
        context.stroke();
      } else if (underline === 4 || underline === 5) {
        const dash = underline === 4 ? 1 : 4;
        for (let dx = 0; dx < span * cw; dx += dash * 2) line(x * cw + dx, x * cw + Math.min(span * cw, dx + dash), base);
      } else {
        line(x * cw, (x + span) * cw, base);
        if (underline === 2) line(x * cw, (x + span) * cw, base - 3);
      }
    }
    if (mod & 256) line(x * cw, (x + span) * cw, y * ch + ch * 0.52);
    context.restore();
  }
  options.aboveText?.();
  if (options.selection) {
    const { start, end } = options.selection;
    const a = Math.min(start.y * frame.width + start.x, end.y * frame.width + end.x);
    const b = Math.max(start.y * frame.width + start.x, end.y * frame.width + end.x);
    context.fillStyle = theme.selection;
    for (let y = Math.floor(a / frame.width); y <= Math.floor(b / frame.width); y++) {
      const left = y === Math.floor(a / frame.width) ? a % frame.width : 0;
      const right = y === Math.floor(b / frame.width) ? b % frame.width : frame.width - 1;
      context.fillRect(left * cw, y * ch, (right - left + 1) * cw, ch);
    }
  }
  const cursor = frame.cursor;
  if (cursor?.visible && (cursor.shape !== 0 && !(cursor.shape % 2) || options.blinkVisible !== false)) {
    context.fillStyle = theme.cursor;
    if (cursor.shape === 3 || cursor.shape === 4) context.fillRect(cursor.x * cw, (cursor.y + 1) * ch - 2, cw, 2);
    else if (cursor.shape === 5 || cursor.shape === 6) context.fillRect(cursor.x * cw, cursor.y * ch, 2, ch);
    else { context.globalAlpha = 0.5; context.fillRect(cursor.x * cw, cursor.y * ch, cw, ch); }
  }
  context.restore();
}

export function drawSurface(context: CanvasRenderingContext2D, surface: PaneSurfaceFrame, metrics: CanvasMetrics, theme: CanvasTheme, graphics: GraphicsCache, options: DrawOptions = {}): void {
  drawFrame(context, surface.frame, metrics, theme, { ...options,
    behindText: () => graphics.draw(context, surface.graphics.placements, metrics.cellWidth, metrics.cellHeight, false),
    aboveText: () => graphics.draw(context, surface.graphics.placements, metrics.cellWidth, metrics.cellHeight, true) });
  if (surface.popup) {
    const frame = surface.popup.frame;
    context.save();
    context.translate(Math.max(0, (surface.frame.width - frame.width) / 2) * metrics.cellWidth, Math.max(0, (surface.frame.height - frame.height) / 2) * metrics.cellHeight);
    drawFrame(context, frame, metrics, theme, { blinkVisible: options.blinkVisible,
      behindText: () => graphics.draw(context, surface.graphics.placements, metrics.cellWidth, metrics.cellHeight, false, surface.popup!.terminal_id),
      aboveText: () => graphics.draw(context, surface.graphics.placements, metrics.cellWidth, metrics.cellHeight, true, surface.popup!.terminal_id) }); context.restore();
  }
}
