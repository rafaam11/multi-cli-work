import type { SessionIndicators, SessionProgress, StatusChipColor } from "./terminal-types";

// Herdr 0.9.5 limits: 16 tokens/request, 32/pane, ASCII keys <=32,
// values <=80 Unicode scalar values. Only these names carry MCW presentation.
const PREFIX="mcw-";
const COLORS:readonly string[]=["green","amber","red","blue","gray"];
const keyValid=(key:string)=>/^[A-Za-z0-9_-]{1,32}$/.test(key);
const valueValid=(value:unknown):value is string=>typeof value==="string"&&[...value].length<=80&&!/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value)&&value.trim()===value;

export function parseMetadataTokens(value:unknown):Record<string,string> {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid Herdr metadata tokens");
  const entries=Object.entries(value);
  if(entries.length>32||entries.some(([key,text])=>!keyValid(key)||!valueValid(text)))throw new Error("Herdr metadata exceeds key, value or count limits");
  return Object.fromEntries(entries) as Record<string,string>;
}

/** A replacement of this producer's owned keys. No title, agent state or completion fields. */
export function encodeChipsMetadata(indicators:SessionIndicators,ownedKeys:readonly string[]):Record<string,string|null> {
  if(ownedKeys.length>15||new Set(ownedKeys).size!==ownedKeys.length||ownedKeys.some(key=>key==="progress"||!keyValid(PREFIX+key)))throw new Error("Invalid metadata key ownership/count");
  if(indicators.chips.length>8||new Set(indicators.chips.map(chip=>chip.key)).size!==indicators.chips.length)throw new Error("Too many or duplicate display chips");
  const tokens:Record<string,string|null>=Object.fromEntries(ownedKeys.map(key=>[PREFIX+key,null]));
  for(const chip of indicators.chips) {
    if(!ownedKeys.includes(chip.key)||!COLORS.includes(chip.color)||!chip.text.trim()||chip.text.trim()!==chip.text)throw new Error("Invalid or unowned display chip");
    tokens[PREFIX+chip.key]=`${chip.color}|${chip.text}`;
  }
  const progress=indicators.progress;
  if(progress&&(!["normal","indeterminate","error","warning"].includes(progress.state)||(progress.value!==null&&(!Number.isInteger(progress.value)||progress.value<0||progress.value>100))))throw new Error("Invalid display progress");
  tokens[`${PREFIX}progress`]=progress?`${progress.state}${progress.value===null?"":`|${progress.value}`}`:null;
  parseMetadataTokens(Object.fromEntries(Object.entries(tokens).filter(([,value])=>value!==null)));
  return tokens;
}

export function indicatorsFromMetadata(value:unknown):SessionIndicators {
  const result:SessionIndicators={chips:[],progress:null};
  let tokens:Record<string,string>;
  try {tokens=parseMetadataTokens(value);} catch {return result;}
  for(const [key,text] of Object.entries(tokens).sort(([a],[b])=>a.localeCompare(b))) {
    if(key===`${PREFIX}progress`) {
      const match=/^(normal|indeterminate|error|warning)(?:\|(0|[1-9]\d?|100))?$/.exec(text);
      if(match)result.progress={state:match[1] as SessionProgress["state"],value:match[2]===undefined?null:Number(match[2])};
    } else if(key.startsWith(PREFIX)&&key.length>PREFIX.length&&result.chips.length<8) {
      const separator=text.indexOf("|"),color=text.slice(0,separator),label=text.slice(separator+1);
      if(separator>0&&COLORS.includes(color)&&label.trim())result.chips.push({key:key.slice(PREFIX.length),color:color as StatusChipColor,text:label});
    }
  }
  result.chips.sort((a,b)=>a.key.localeCompare(b.key));
  return result;
}
