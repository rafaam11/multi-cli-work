import type { FrameData, SurfaceRect } from "@shared/herdr-surface-types";
import { surfaceCellSpan, type CellPoint } from "./surface-model";
import { findPathCandidates, type PathCandidate } from "../terminal-file-links";

export type SurfaceLink = { type:"url"; url:string } | { type:"path"; candidate:PathCandidate } | { type:"blocked" };
const safeUrl = (value:string) => { try { const parsed=new URL(value);return parsed.protocol==="http:"||parsed.protocol==="https:"; } catch { return false; } };

/** Surface frames omit wrap flags. Join only fully occupied row boundaries, at most eight rows;
 * every file candidate still has to be resolved against the session's own root. */
export function surfaceLinkAt(frame:FrameData, point:CellPoint, rect:SurfaceRect):SurfaceLink|null {
  if(point.x<rect.x||point.x>=rect.x+rect.width||point.y<rect.y||point.y>=rect.y+rect.height)return null;
  const row = (y:number) => {
    const items:Array<{text:string;x:number;width:number;y:number;link:number|null}>=[];
    for(let x=rect.x;x<rect.x+rect.width;) {
      const index=y*frame.width+x,cell=frame.cells[index],span=Math.min(surfaceCellSpan(frame,index),rect.x+rect.width-x);
      items.push({text:cell.symbol || " ",x,width:span,y,link:cell.hyperlink});x+=span;
    }
    return items;
  };
  const rows=Array.from({length:rect.height},(_,i)=>row(rect.y+i)), index=point.y-rect.y;
  const joins=(a:number,b:number)=>{const left=rows[a].at(-1),right=rows[b][0];return !!left&&!!right&&!/\s/u.test(left.text.slice(-1))&&!/\s/u.test(right.text[0]);};
  let first=index,last=index;while(first>0&&index-first<7&&joins(first-1,first))first--;
  while(last+1<rows.length&&last-first<7&&joins(last,last+1))last++;
  const clicked=rows[index].find(cell=>point.x>=cell.x&&point.x<cell.x+cell.width);
  if(clicked?.link!==null&&clicked?.link!==undefined){const url=frame.hyperlinks[clicked.link];return typeof url==="string"&&safeUrl(url)?{type:"url",url}:{type:"blocked"};}
  let text="";const cells:Array<{x:number;y:number;width:number}>=[];
  for(let y=first;y<=last;y++)for(const cell of rows[y]) {text+=cell.text;for(let i=0;i<cell.text.length;i++)cells.push(cell);}
  const contains=(start:number,end:number)=>cells.slice(start,end).some(c=>c.y===point.y&&point.x>=c.x&&point.x<c.x+c.width);
  for(const match of text.matchAll(/(?<![\p{L}\p{N}_:/])https?:\/\/[^\s<>"']+/giu)) {
    const url=match[0].replace(/[),.;!?]+$/u,"");
    if(contains(match.index,match.index+url.length)&&safeUrl(url))return {type:"url",url};
  }
  const candidate=findPathCandidates(text).find(c=>contains(c.start,c.end));
  return candidate?{type:"path",candidate}:null;
}
