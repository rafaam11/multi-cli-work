import { describe, expect, it } from "vitest";
import { encodeChipsMetadata, indicatorsFromMetadata, parseMetadataTokens } from "./herdr-metadata";

describe("Herdr display metadata", () => {
  it("round trips Korean labels, colors and progress without an execution state", () => {
    const indicators = {chips:[{key:"test",text:"테스트 완료 ✓",color:"green" as const}],progress:{state:"normal" as const,value:40}};
    const tokens=encodeChipsMetadata(indicators,["test","todo"]);
    expect(tokens).toEqual({"mcw-test":"green|테스트 완료 ✓","mcw-todo":null,"mcw-progress":"normal|40"});
    expect(indicatorsFromMetadata(Object.fromEntries(Object.entries(tokens).filter(([,v])=>v!==null)))).toEqual(indicators);
    expect(indicatorsFromMetadata({state:"done",title:"완료","mcw-test":"green|테스트 완료 ✓"})).toEqual({...indicators,progress:null});
  });
  it("checks count, key and Unicode value limits before submitting, without truncation", () => {
    expect(parseMetadataTokens({label:"한".repeat(80)})).toEqual({label:"한".repeat(80)});
    expect(parseMetadataTokens({label:"😀".repeat(80)})).toEqual({label:"😀".repeat(80)});
    for(const tokens of [{label:"한".repeat(81)},{["a".repeat(33)]:"x"},{label:"line\nnext"},Object.fromEntries(Array.from({length:33},(_,i)=>[`key${i}`,"x"]))]) {
      expect(()=>parseMetadataTokens(tokens)).toThrow();
    }
    expect(()=>encodeChipsMetadata({chips:[],progress:null},Array.from({length:16},(_,i)=>`key${i}`))).toThrow();
    expect(()=>encodeChipsMetadata({chips:[{key:"ctx",color:"blue",text:"한".repeat(76)}],progress:null},["ctx"])).toThrow();
    expect(()=>encodeChipsMetadata({chips:[{key:"unowned",color:"blue",text:"x"}],progress:null},["ctx"])).toThrow();
  });
  it("ignores unknown/invalid display formats and keeps a bounded display", () => {
    expect(indicatorsFromMetadata({"mcw-test":"injected|x","mcw-progress":"normal|101",other:"test"})).toEqual({chips:[],progress:null});
    expect(indicatorsFromMetadata({"mcw-progress":"indeterminate"})).toEqual({chips:[],progress:{state:"indeterminate",value:null}});
    expect(indicatorsFromMetadata(Object.fromEntries(Array.from({length:32},(_,i)=>[`mcw-k${i}`,"blue|x"])) ).chips).toHaveLength(8);
  });
});
