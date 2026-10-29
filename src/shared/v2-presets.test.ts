import {expect,it} from "vitest";
import {BUILTIN_PRESETS} from "../main/presets/preset-registry";
import {presetV2Issues,projectV2Presets} from "./v2-presets";
it("projects shipped prompts to task tools without mutating original or custom prompts",()=>{
  const custom={...BUILTIN_PRESETS[0],id:"custom",members:[{...BUILTIN_PRESETS[0].members[0],prompt:"내 지시: jk post 사용"}]};
  const before=JSON.stringify(BUILTIN_PRESETS),result=projectV2Presets([...BUILTIN_PRESETS,custom],BUILTIN_PRESETS);
  expect(JSON.stringify(result[0])).not.toMatch(/\bjk\b/);expect(result[0].members[0].prompt).toContain("task_wait");
  expect(result[1]).toEqual(custom);expect(presetV2Issues(result[1])).toEqual([expect.stringContaining("이관 필요")]);
  expect(JSON.stringify(BUILTIN_PRESETS)).toBe(before);
});
