import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** The Windows source fix is part of MCW's packaged runtime, never the user's Herdr install. */
export async function resolveHerdrResource(directory:string,platform:NodeJS.Platform=process.platform):Promise<{binaryPath:string;binarySha256:string}>{
  const manifest=JSON.parse(await fs.readFile(path.join(directory,"assets.json"),"utf8"));
  if(manifest.herdrVersion!=="0.9.5"||manifest.herdrSourceCommit!=="2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01"||!["win32","linux"].includes(platform))throw new Error("Unsupported managed Herdr runtime");
  let binarySha256:string;
  if(platform==="win32"){
    const proof=JSON.parse(await fs.readFile(path.join(directory,"herdr/windows-mcw/herdr-build.json"),"utf8"));
    if(proof.schemaVersion!==1||proof.version!=="0.9.5"||proof.revision!=="mcw.1"||proof.sourceCommit!==manifest.herdrSourceCommit||proof.sourcePath!=="src/platform/windows.rs"||proof.sourceSha256!=="09add751d6eb3e8768cfffe83507bb4959900377a7e4d4c3be5aca572d264d6e"||proof.patchedSourceSha256!=="9f123b8721bdef2d37b34d3958fc4c0f4c8c4a6718d94a8a0fb3d3dc1f27bd56")throw new Error("Unrecognized managed Herdr Windows build provenance");
    binarySha256=proof.sha256;
  }else binarySha256=manifest.assets.find((asset:{id:string})=>asset.id==="herdr-linux")?.sha256;
  if(typeof binarySha256!=="string"||!/^[a-f0-9]{64}$/.test(binarySha256))throw new Error("Missing managed Herdr digest");
  return {binaryPath:path.join(directory,platform==="win32"?"herdr/windows-mcw/herdr.exe":"herdr/herdr-linux-x86_64"),binarySha256};
}
export const herdrReinstallHint="최신 설치 파일로 다시 설치하세요: https://github.com/rafaam11/multi-cli-work/releases/latest";
/** Herdr checks every file its ConPTY manifest names only when the first pane opens,
 * and then panics; the host would stay up and reject every session. Check it first. */
export async function verifyHerdrConptyBundle(directory:string):Promise<void>{
  const bundle=path.join(directory,"herdr/windows-mcw");
  const manifest=JSON.parse(await fs.readFile(path.join(directory,"assets.json"),"utf8"));
  const pinned=manifest.windowsMembers?.find((member:{file:string})=>member.file==="conpty/herdr-conpty.json")?.sha256;
  const digest=async(file:string)=>createHash("sha256").update(await fs.readFile(file)).digest("hex");
  const problems:string[]=[];
  let files:Record<string,unknown>={};
  try{
    const raw=await fs.readFile(path.join(bundle,"conpty/herdr-conpty.json"));
    if(createHash("sha256").update(raw).digest("hex")!==pinned)problems.push("conpty/herdr-conpty.json 변경됨");
    files=JSON.parse(raw.toString("utf8")).files??{};
  }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;problems.push("conpty/herdr-conpty.json 없음");}
  for(const [file,sha256] of Object.entries(files)){
    if(path.isAbsolute(file)||file.split(/[\\/]/).includes(".."))throw new Error("Invalid Herdr ConPTY manifest path");
    const actual=await digest(path.join(bundle,file)).catch(error=>{if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;});
    if(actual===null)problems.push(`${file} 없음`);else if(actual!==sha256)problems.push(`${file} 변경됨`);
  }
  if(problems.length)throw new Error(`Herdr 터미널 구성 파일이 손상되어 세션을 열 수 없습니다(${problems.join(", ")}). 백신이 파일을 격리했는지 확인한 뒤 ${herdrReinstallHint}`);
}
