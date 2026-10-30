import {describe,it,expect} from 'vitest';
import {patchWindowsSignals} from './herdr-windows.mjs';
describe('certified Herdr Windows patch',()=>{
  const code='before\npub fn signal_processes(pids: &[u32], signal: Signal) {\n    for &pid in pids {\n        let Some(process) = ProcessHandle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION) else {\n            continue;\n        };\n        unsafe { TerminateProcess(process.0, 1); }\n    }\n}\n\npub fn process_exists(pid: u32) -> bool {\n    let Some(process) = ProcessHandle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION) else { return false; };\n}\n';
  it('grants termination rights only in the explicit signal path',()=>{
    const fixed=patchWindowsSignals(code);
    expect(fixed).toContain('PROCESS_QUERY_LIMITED_INFORMATION | windows_sys::Win32::System::Threading::PROCESS_TERMINATE');
    expect(fixed.split('pub fn process_exists')[1]).toBe(code.split('pub fn process_exists')[1]);
  });
  it('refuses drift and duplicate patch application',()=>{
    expect(()=>patchWindowsSignals('other')).toThrow();
    expect(()=>patchWindowsSignals(patchWindowsSignals(code))).toThrow();
  });
});
