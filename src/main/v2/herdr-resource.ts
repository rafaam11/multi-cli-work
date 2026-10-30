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
