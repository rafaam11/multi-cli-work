/** Herdr 0.9.5 wire.rs serde JSON. Keep field/enum names identical to upstream. */
export interface CellData { symbol: string; fg: number; bg: number; modifier: number; skip: boolean; hyperlink: number | null }
export interface CursorState { x: number; y: number; visible: boolean; shape: number }
export interface FrameData { cells: CellData[]; width: number; height: number; cursor: CursorState | null; hyperlinks: string[]; graphics: number[] }
export interface SurfaceRect { x: number; y: number; width: number; height: number }
export interface PaneSurfaceScrollMetrics { offset_from_bottom: number; max_offset_from_bottom: number; viewport_rows: number }
export interface PaneSurfacePane {
  pane_id: string; content_revision: number; rect: SurfaceRect; inner_rect: SurfaceRect; scrollbar_rect: SurfaceRect | null;
  scroll: PaneSurfaceScrollMetrics | null; focused: boolean; mouse_reporting: boolean; sgr_pixel_mouse: boolean;
  alternate_screen_active: boolean; pixel_width: number; pixel_height: number;
}
export interface PaneSurfaceSplit { direction: "Horizontal" | "Vertical"; pos: number; area: SurfaceRect; hit_rect: SurfaceRect; path: boolean[] }
export type SurfaceGraphicsTarget = { Pane: { pane_id: string } } | { Popup: { terminal_id: string } };
export type SurfaceGraphicsSource = { Terminal: { target: SurfaceGraphicsTarget; image_id: number } } | { PaneLayer: { pane_id: string; layer_id: string } };
export interface SurfaceGraphicsAssetKey {
  source: SurfaceGraphicsSource; image_width: number; image_height: number; format: "Rgb" | "Rgba" | "Png";
  data_len: number; data_fingerprint: number | string;
}
export interface SurfaceGraphicsAsset { key: SurfaceGraphicsAssetKey; data: number[] }
export interface SurfaceGraphicsPlacement {
  asset: SurfaceGraphicsAssetKey; logical_placement_id: number; x: number; y: number; cols: number; rows: number;
  source_x: number; source_y: number; source_width: number; source_height: number; x_offset: number; y_offset: number;
  z: number; scrollback_offset: number;
}
export interface SurfaceGraphicsScene { assets: SurfaceGraphicsAsset[]; placements: SurfaceGraphicsPlacement[]; retained_assets: SurfaceGraphicsAssetKey[] }
export type ClientShellPopupSize = { Cells: number } | { Percent: number };
export interface ClientShellPopupSurface {
  terminal_id: string; title: string; width: ClientShellPopupSize | null; height: ClientShellPopupSize | null;
  frame: FrameData; mouse_reporting: boolean; sgr_pixel_mouse: boolean; pixel_width: number; pixel_height: number;
}
export interface PaneSurfaceFrame {
  boot_id: string; projection_revision: number; surface_revision: number; frame: FrameData; panes: PaneSurfacePane[];
  splits: PaneSurfaceSplit[]; popup: ClientShellPopupSurface | null; graphics: SurfaceGraphicsScene;
}
export interface PaneSurfacePatchRow { x: number; y: number; cells: CellData[] }
export interface PaneSurfacePatch {
  boot_id: string; projection_revision: number; base_surface_revision: number; surface_revision: number;
  rows: PaneSurfacePatchRow[]; panes: PaneSurfacePane[]; cursor: CursorState | null;
}
export type ClientKeyCode = "Backspace" | "Enter" | "Left" | "Right" | "Up" | "Down" | "Home" | "End" | "PageUp" | "PageDown" | "Tab" | "BackTab" | "Delete" | "Insert" | "Esc" | "Null" | { Char: string } | { F: number };
export type ClientMouseButton = "Left" | "Middle" | "Right";
export type ClientMouseKind = { Down: ClientMouseButton } | { Up: ClientMouseButton } | { Drag: ClientMouseButton } | "Moved" | "ScrollUp" | "ScrollDown" | "ScrollLeft" | "ScrollRight";
export type ClientMousePosition = { Cell: { column: number; row: number } } | { Pixels: { x: number; y: number; column: number; row: number } };
export type ClientPaneInputEvent =
  | { Key: { code: ClientKeyCode; modifiers: number; kind: "Press" | "Repeat" | "Release"; repeat_count: number;
      shifted_codepoint: number | null; generated_text: string | null; tracks_release: boolean; physical_key_id: number | null; windows_record: null } }
  | { TextCommit: string } | { Paste: string }
  | { Mouse: { kind: ClientMouseKind; position: ClientMousePosition; geometry: { cols: number; rows: number; width_px: number; height_px: number } | null; modifiers: number; lines: number } };

export type HerdrSurfaceEvent = { type: "surface" | "frame"; surface: PaneSurfaceFrame } | { type: "patch"; patch: PaneSurfacePatch };
export type HerdrTerminalEvent = HerdrSurfaceEvent
  | { type: "ownership"; ownerId: string | null; sizeOwnerId: string | null }
  | { type: "disconnected"; observedAt?: number | null; reason?: string };
export interface HerdrTerminalSize { cols: number; rows: number; cell_width_px: number; cell_height_px: number }
export interface HerdrTerminalTransport {
  subscribe(sessionId: string, onEvent: (event: HerdrTerminalEvent) => void, onError?: (error: string) => void): () => void;
  sendInput(sessionId: string, event: ClientPaneInputEvent): void | Promise<unknown>;
  resize(sessionId: string, size: HerdrTerminalSize): void | Promise<unknown>;
  scroll(sessionId: string, scroll: { direction: "Up" | "Down"; lines: number }): void | Promise<unknown>;
  requestControl(sessionId: string, viewerId: string): void | Promise<unknown>;
  releaseControl(sessionId: string, viewerId: string): void | Promise<unknown>;
  requestSnapshot(sessionId: string): void | Promise<unknown>;
}
