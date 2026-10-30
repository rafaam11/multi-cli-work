import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TerminalSessionView } from "@shared/api-types";
import { DEFAULT_SETTINGS } from "@shared/settings-types";
import { TerminalPane } from "../TerminalPane";

const captured=vi.hoisted(()=>({props:null as any}));
vi.mock("@xterm/xterm",()=>({Terminal:class {}}));
vi.mock("@xterm/addon-search",()=>({SearchAddon:class {}}));
vi.mock("@xterm/addon-fit",()=>({FitAddon:class {}}));
vi.mock("./HostTerminalPane",()=>({HostTerminalPane:(props:unknown)=>{captured.props=props;return null;}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();captured.props=null;});
it("does not offer local file resolution for a remote v2 session",()=>{
  vi.stubGlobal("mcwV2",{version:2});
  const session={id:"remote",pid:0,projectId:"project",remote:{hostId:"other",name:"Other",sessionId:"remote",projectId:"project",connected:true,observedAt:1}} as TerminalSessionView;
  render(<TerminalPane session={session} settings={DEFAULT_SETTINGS.terminal} shiftEnterBytes={null} refreshRequest={0} onAttached={()=>{}} onRefreshComplete={()=>{}} onError={()=>{}}/>);
  expect(captured.props.terminalProps.resolveFileLink).toBeUndefined();
});
