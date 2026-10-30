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
  it("publishes commands, honors shift-enter bytes and completes refresh after a snapshot",async()=>{
    const t=transport(), clear=vi.fn(async()=>{});t.clear=clear;t.selection=vi.fn(async()=>({text:"scrollback and visible"}));
    let commands:import("../TerminalPane").TerminalCommands|null=null;
    const complete=vi.fn(),register=vi.fn((value:import("../TerminalPane").TerminalCommands|null)=>{commands=value;});
    const view=render(<HerdrTerminal sessionId="s" viewerId="desktop" ownerId="desktop" transport={t} onRegisterCommands={register} onRefreshComplete={complete} shiftEnterBytes={"\x1b\r"}/>);
    const base=surface();act(()=>receive({type:"surface",surface:{...base,panes:[{pane_id:"p",content_revision:2,rect:{x:0,y:0,width:2,height:1},inner_rect:{x:0,y:0,width:2,height:1},scrollbar_rect:null,scroll:{offset_from_bottom:0,max_offset_from_bottom:5,viewport_rows:1},focused:true,mouse_reporting:false,sgr_pixel_mouse:false,alternate_screen_active:false,pixel_width:18,pixel_height:20}]}}));
    fireEvent.keyDown(screen.getByLabelText("터미널 입력"),{key:"Enter",shiftKey:true});
    expect(t.sendInput).toHaveBeenCalledWith("s",{TextCommit:"\x1b\r"});
    await act(async()=>{commands!.selectAll();await Promise.resolve();});expect(commands!.selectionText!()).toBe("scrollback and visible");
    act(()=>commands!.clear());expect(clear).toHaveBeenCalledWith("s");
    view.rerender(<HerdrTerminal sessionId="s" viewerId="desktop" ownerId="desktop" transport={t} onRegisterCommands={register} refreshRequest={1} onRefreshComplete={complete}/>);
    expect(complete).not.toHaveBeenCalled();
    act(()=>receive({type:"surface",surface:surface()}));expect(complete).toHaveBeenCalledOnce();
    view.unmount();expect(register).toHaveBeenLastCalledWith(null);
  });
  it("ignores an obsolete search reply when content changes and preserves a later manual selection",async()=>{
    const t=transport();let finish!:(value:unknown)=>void;t.search=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
    const base=surface(),pane={pane_id:"p",content_revision:2,rect:{x:0,y:0,width:2,height:1},inner_rect:{x:0,y:0,width:2,height:1},scrollbar_rect:null,scroll:{offset_from_bottom:0,max_offset_from_bottom:5,viewport_rows:1},focused:true,mouse_reporting:false,sgr_pixel_mouse:false,alternate_screen_active:false,pixel_width:18,pixel_height:20};
    render(<HerdrTerminal sessionId="s" viewerId="desktop" ownerId="desktop" transport={t}/>);
    act(()=>receive({type:"surface",surface:{...base,panes:[pane]}}));
    fireEvent.keyDown(screen.getByLabelText("터미널 입력"),{key:"f",ctrlKey:true});
    fireEvent.change(screen.getByLabelText("찾을 텍스트"),{target:{value:"word"}});
    fireEvent.keyDown(screen.getByLabelText("찾을 텍스트"),{key:"Enter"});
    expect(t.search).toHaveBeenCalledOnce();
    act(()=>receive({type:"surface",surface:{...base,surface_revision:2,panes:[{...pane,content_revision:4}]}}));
    await act(async()=>finish({pane_id:"p",content_revision:2,matches:[{start:{row:0,col:0},end:{row:0,col:1}}],current:0,total:1}));
    expect(t.scroll).not.toHaveBeenCalled();expect(screen.queryByText("1개 결과")).not.toBeInTheDocument();
  });
  it("does not restore a search highlight after a manual selection or use its previous match",async()=>{
    vi.stubGlobal("PointerEvent",MouseEvent);
    const t=transport();t.search=vi.fn(async()=>({pane_id:"p",content_revision:2,matches:[{start:{row:5,col:0},end:{row:5,col:1}}],current:0,total:1}));
    const base=surface(),pane={pane_id:"p",content_revision:2,rect:{x:0,y:0,width:2,height:1},inner_rect:{x:0,y:0,width:2,height:1},scrollbar_rect:null,scroll:{offset_from_bottom:0,max_offset_from_bottom:5,viewport_rows:1},focused:true,mouse_reporting:false,sgr_pixel_mouse:false,alternate_screen_active:false,pixel_width:18,pixel_height:20};
    let commands:import("../TerminalPane").TerminalCommands|null=null;
    render(<HerdrTerminal sessionId="s" viewerId="desktop" ownerId="desktop" transport={t} onRegisterCommands={value=>{commands=value;}}/>);
    act(()=>receive({type:"surface",surface:{...base,panes:[pane]}}));
    fireEvent.keyDown(screen.getByLabelText("터미널 입력"),{key:"f",ctrlKey:true});
    fireEvent.change(screen.getByLabelText("찾을 텍스트"),{target:{value:"word"}});
    await act(async()=>{fireEvent.keyDown(screen.getByLabelText("찾을 텍스트"),{key:"Enter"});await Promise.resolve();});
    fireEvent.pointerDown(screen.getByLabelText("터미널 화면"),{button:0,pointerId:1,clientX:0,clientY:0});
    expect(commands!.selectionText!()).toBe("한");
    act(()=>receive({type:"surface",surface:{...base,surface_revision:2,panes:[pane]}}));
    expect(commands!.selectionText!()).toBe("한");
    await act(async()=>{fireEvent.keyDown(screen.getByLabelText("찾을 텍스트"),{key:"Enter"});await Promise.resolve();});
    expect(vi.mocked(t.search!).mock.calls[1][1]).not.toHaveProperty("previous");
  });
  it("waits for full scrollback selection before copying",async()=>{
    const t=transport();let finish!:(value:unknown)=>void;t.selection=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
    const write=vi.fn(async()=>{});vi.stubGlobal("multiCliWork",{clipboard:{writeText:write}});
    let commands:import("../TerminalPane").TerminalCommands|null=null;
    const base=surface(),pane={pane_id:"p",content_revision:2,rect:{x:0,y:0,width:2,height:1},inner_rect:{x:0,y:0,width:2,height:1},scrollbar_rect:null,scroll:{offset_from_bottom:0,max_offset_from_bottom:5,viewport_rows:1},focused:true,mouse_reporting:false,sgr_pixel_mouse:false,alternate_screen_active:false,pixel_width:18,pixel_height:20};
    render(<HerdrTerminal sessionId="s" viewerId="desktop" ownerId="desktop" transport={t} onRegisterCommands={value=>{commands=value;}}/>);
    act(()=>receive({type:"surface",surface:{...base,panes:[pane]}}));
    act(()=>{commands!.selectAll();commands!.copySelection();});expect(write).not.toHaveBeenCalled();
    await act(async()=>{finish({text:"older output\nvisible"});await Promise.resolve();await Promise.resolve();});
    expect(write).toHaveBeenCalledWith("older output\nvisible");
  });
  it("opens safe OSC links through the supplied gateway and ignores unsafe schemes",async()=>{
    vi.stubGlobal("PointerEvent",MouseEvent);
    const t=transport(),open=vi.fn(async()=>{}),base=surface();
    base.frame.cells=[{...base.frame.cells[0],symbol:"a",hyperlink:0},{...base.frame.cells[0],symbol:"b",hyperlink:1}];
    base.frame.hyperlinks=["https://example.com","javascript:alert(1)"];
    render(<HerdrTerminal sessionId="s" viewerId="desktop" ownerId="desktop" transport={t} onOpenExternal={open}/>);
    act(()=>receive({type:"surface",surface:base}));
    const canvas=screen.getByLabelText("터미널 화면");
    fireEvent.pointerDown(canvas,{button:0,ctrlKey:true,clientX:0,clientY:0});
    fireEvent.pointerDown(canvas,{button:0,ctrlKey:true,clientX:10,clientY:0});
    expect(open).toHaveBeenCalledExactlyOnceWith("https://example.com");
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
