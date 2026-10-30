import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HerdrTerminalEvent, HerdrTerminalTransport, PaneSurfaceFrame } from "@shared/herdr-surface-types";
import { HerdrTerminal } from "./HerdrTerminal";

let receive: (event: HerdrTerminalEvent) => void;
let resizeCallback: ResizeObserverCallback;
const surface = (): PaneSurfaceFrame => ({ boot_id: "boot", projection_revision: 1, surface_revision: 1,
  frame: { width: 2, height: 1, cells: [{ symbol: "한", fg: 0, bg: 0, modifier: 0, skip: false, hyperlink: null }, { symbol: "", fg: 0, bg: 0, modifier: 0, skip: true, hyperlink: null }], cursor: null, hyperlinks: [], graphics: [] },
  panes: [], splits: [], popup: null, graphics: { assets: [], placements: [], retained_assets: [] } });
const transport = (): HerdrTerminalTransport => ({ subscribe: vi.fn((_id, listener) => { receive = listener; return vi.fn(); }), sendInput: vi.fn(), resize: vi.fn(), scroll: vi.fn(), requestControl: vi.fn(), releaseControl: vi.fn(), requestSnapshot: vi.fn() });
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ measureText: () => ({ width: 9 }), setTransform() {}, save() {}, restore() {}, fillRect() {}, fillText() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {} } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resizeCallback = callback; } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("shared Herdr terminal ownership and input", () => {
  it('positions visible composition at the terminal cursor and discards it when control is lost',()=>{
    const t=transport();render(<HerdrTerminal sessionId="s" viewerId="desktop" ownerId="desktop" transport={t}/>);
    act(()=>receive({type:'surface',surface:{...surface(),frame:{...surface().frame,cursor:{x:1,y:0,shape:1,visible:true}}}}));
    const input=screen.getByLabelText('터미널 입력');
    expect(input).toHaveStyle({left:'9px',top:'0px'});
    fireEvent.compositionStart(input);fireEvent.input(input,{target:{value:'한'},isComposing:true});
    expect(input).toHaveClass('is-composing');expect(t.sendInput).not.toHaveBeenCalled();
    act(()=>receive({type:'ownership',ownerId:'phone',sizeOwnerId:'phone'}));
    expect(input).not.toHaveClass('is-composing');expect(input).toHaveValue('');
    fireEvent.compositionEnd(input,{data:'한'});expect(t.sendInput).not.toHaveBeenCalled();
  });
  it('reports readiness only after a surface is rendered and clears it on disconnect',()=>{
    const ready=vi.fn(),t=transport();render(<HerdrTerminal sessionId="s" viewerId="phone" ownerId={null} transport={t} onReady={ready}/>);
    expect(ready).not.toHaveBeenCalledWith(true);
    act(()=>receive({type:'surface',surface:surface()}));expect(ready).toHaveBeenLastCalledWith(true);
    act(()=>receive({type:'disconnected',observedAt:1000}));expect(ready).toHaveBeenLastCalledWith(false);
  });
  it("accepts a fresh connection's lower surface revision after host restart without taking control",()=>{
    const t=transport();render(<HerdrTerminal sessionId="s" viewerId="viewer" ownerId={null} transport={t}/>);
    act(()=>receive({type:"surface",surface:{...surface(),surface_revision:70}}));
    act(()=>receive({type:"disconnected",observedAt:1000}));
    act(()=>receive({type:"surface",surface:surface()}));
    expect(screen.queryByText(/연결 끊김/)).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"제어 요청"})).toBeEnabled();
    expect(screen.getByLabelText("터미널 입력")).toHaveAttribute("aria-readonly","true");
    expect(t.requestControl).not.toHaveBeenCalled();
  });
  it("subscribes read only, requests a snapshot, and takes control only on explicit click", () => {
    const t = transport();
    render(<HerdrTerminal sessionId="s" viewerId="phone" ownerId="desktop" transport={t} />);
    expect(screen.getByRole("button",{name:"제어 요청"})).toBeDisabled();
    act(() => receive({ type: "surface", surface: surface() }));
    expect(t.requestSnapshot).toHaveBeenCalledWith("s");
    fireEvent.keyDown(screen.getByLabelText("터미널 입력"), { key: "Enter" });
    fireEvent.paste(screen.getByLabelText("터미널 입력"), { clipboardData: { getData: () => "secret" } });
    act(() => resizeCallback([{ contentRect: { width: 800, height: 400 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(t.sendInput).not.toHaveBeenCalled();
    expect(t.resize).not.toHaveBeenCalled();
    expect(t.requestControl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "제어 요청" }));
    expect(t.requestControl).toHaveBeenCalledWith("s", "phone");
  });
  it("sends paste once and Korean IME once while controlled; disconnect immediately blocks input", () => {
    const t = transport();
    render(<HerdrTerminal sessionId="s" viewerId="desktop" ownerId="desktop" transport={t} />);
    act(() => receive({ type: "surface", surface: surface() }));
    const input = screen.getByLabelText("터미널 입력");
    fireEvent.compositionStart(input);
    fireEvent.input(input, { target: { value: "ㅎ" }, isComposing: true });
    fireEvent.compositionEnd(input, { data: "한" });
    fireEvent.input(input, { target: { value: "한" }, isComposing: false });
    fireEvent.paste(input, { clipboardData: { getData: () => "hello\nworld" } });
    expect(t.sendInput).toHaveBeenNthCalledWith(1, "s", { TextCommit: "한" });
    expect(t.sendInput).toHaveBeenNthCalledWith(2, "s", { Paste: "hello\nworld" });
    expect(t.sendInput).toHaveBeenCalledTimes(2);
    act(() => receive({ type: "disconnected", observedAt: 1000 }));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(t.sendInput).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/연결 끊김/)).toBeInTheDocument();
  });
  it("lets the browser dispatch Ctrl+V paste without also forwarding the shortcut", () => {
    const t = transport();
    render(<HerdrTerminal sessionId="s" viewerId="desktop" ownerId="desktop" transport={t} />);
    act(() => receive({ type: "surface", surface: surface() }));
    const input = screen.getByLabelText("터미널 입력");
    fireEvent.keyDown(input, { key: "v", ctrlKey: true });
    fireEvent.paste(input, { clipboardData: { getData: () => "paste" } });
    expect(t.sendInput).toHaveBeenCalledExactlyOnceWith("s", { Paste: "paste" });
  });
  it("requests one replacement snapshot for a patch gap and blocks stale input until synchronized", () => {
    const t = transport();
    render(<HerdrTerminal sessionId="s" viewerId="desktop" ownerId="desktop" transport={t} />);
    act(() => receive({ type: "surface", surface: surface() }));
    const gap = { type: "patch" as const, patch: { boot_id: "boot", projection_revision: 1, base_surface_revision: 3, surface_revision: 4, rows: [], panes: [], cursor: null } };
    act(() => { receive(gap); receive(gap); });
    expect(t.requestSnapshot).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByLabelText("터미널 입력"), { key: "Enter" });
    expect(t.sendInput).not.toHaveBeenCalled();
    act(() => receive({ type: "surface", surface: { ...surface(), surface_revision: 4 } }));
    fireEvent.keyDown(screen.getByLabelText("터미널 입력"), { key: "Enter" });
    expect(t.sendInput).toHaveBeenCalledTimes(1);
  });
});
