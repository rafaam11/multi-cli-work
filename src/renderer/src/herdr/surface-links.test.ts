import { describe, expect, it } from "vitest";
import type { CellData, FrameData } from "@shared/herdr-surface-types";
import { surfaceLinkAt } from "./surface-links";

const cell=(symbol:string,hyperlink:number|null=null):CellData=>({symbol,fg:0,bg:0,modifier:0,skip:false,hyperlink});
const frame=(rows:string[][]):FrameData=>({width:rows[0].length,height:rows.length,cells:rows.flat().map(value=>cell(value)),cursor:null,hyperlinks:[],graphics:[]});
describe("surface links",()=>{
  it("maps ConPTY blank Korean tails to a path and supports clicking the tail",()=>{
    const f=frame([["s","r","c","/","한"," ","글"," ",".","t","s"]]);
    expect(surfaceLinkAt(f,{x:5,y:0},{x:0,y:0,width:11,height:1})).toMatchObject({type:"path",candidate:{path:"src/한글.ts"}});
    expect(surfaceLinkAt(f,{x:7,y:0},{x:0,y:0,width:11,height:1})).toMatchObject({type:"path",candidate:{path:"src/한글.ts"}});
  });
  it("finds a path split at a fully occupied row boundary",()=>{
    const f=frame([["s","r","c","/","l","o","n","g"],["/","f","i","l","e",".","t","s"]]);
    expect(surfaceLinkAt(f,{x:3,y:1},{x:0,y:0,width:8,height:2})).toMatchObject({type:"path",candidate:{path:"src/long/file.ts"}});
    expect(surfaceLinkAt(f,{x:3,y:0},{x:0,y:0,width:8,height:2})).toMatchObject({type:"path",candidate:{path:"src/long/file.ts"}});
  });
  it("accepts HTTP links and blocks unsafe OSC targets",()=>{
    const f=frame([["a","b","c"]]);f.hyperlinks=["https://example.com/a","javascript:alert(1)","file:///secret"];
    f.cells=[cell("a",0),cell("b",1),cell("c",2)];const rect={x:0,y:0,width:3,height:1};
    expect(surfaceLinkAt(f,{x:0,y:0},rect)).toEqual({type:"url",url:"https://example.com/a"});
    expect(surfaceLinkAt(f,{x:1,y:0},rect)).toEqual({type:"blocked"});expect(surfaceLinkAt(f,{x:2,y:0},rect)).toEqual({type:"blocked"});
    const plain=frame([[..."https://example.com/a"].flat()]);expect(surfaceLinkAt(plain,{x:12,y:0},{x:0,y:0,width:plain.width,height:1})).toEqual({type:"url",url:"https://example.com/a"});
  });
});
