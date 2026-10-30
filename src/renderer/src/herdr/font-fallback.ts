/** Keep the configured faces first, but put our offline Korean face before a generic family. */
export function withKoreanFallback(preferred:string):string {
  const parts=preferred.match(/(?:[^,"']|"[^"]*"|'[^']*')+/g)?.map(part=>part.trim()).filter(Boolean) ?? [];
  if(parts.some(part=>part.replace(/^['"]|['"]$/g,"").toLowerCase()==="mcw noto sans kr"))return parts.join(", ");
  const generic=parts.findIndex(part=>/^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-monospace|ui-sans-serif|ui-serif|ui-rounded)$/i.test(part));
  parts.splice(generic<0?parts.length:generic,0,'"MCW Noto Sans KR"');
  return parts.join(", ");
}
