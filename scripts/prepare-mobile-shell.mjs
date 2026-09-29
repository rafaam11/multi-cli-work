// 빌드된 셸 APK를 데스크톱 설치본이 동봉할 자리(build/mobile/)에 놓고 shell.json을 쓴다.
// 릴리스 CI가 이 스크립트를 거친다. 로컬 dist 전에는 직접 `npm run mobile:prepare`를 실행한다. 사용: node scripts/prepare-mobile-shell.mjs [--apk <path>]
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parseVersionProperties(text) {
  const values = Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
  );
  const versionCode = Number(values.shellVersionCode);
  if (!Number.isInteger(versionCode) || versionCode < 1) throw new Error("version.properties: shellVersionCode가 없거나 잘못됐습니다");
  if (!values.shellVersionName) throw new Error("version.properties: shellVersionName이 없습니다");
  return { versionCode, versionName: values.shellVersionName };
}

export function shellManifest(version, apk) {
  return { ...version, sha256: createHash("sha256").update(apk).digest("hex") };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const apkFlag = process.argv.indexOf("--apk");
  const apkPath = apkFlag > 0 ? path.resolve(process.argv[apkFlag + 1]) : path.join(root, "android/app/build/outputs/apk/release/app-release.apk");
  const version = parseVersionProperties(await readFile(path.join(root, "android/version.properties"), "utf8"));
  const apk = await readFile(apkPath);
  const outDir = path.join(root, "build/mobile");
  await mkdir(outDir, { recursive: true });
  await copyFile(apkPath, path.join(outDir, "shell.apk"));
  await writeFile(path.join(outDir, "shell.json"), `${JSON.stringify(shellManifest(version, apk), null, 2)}\n`);
  await mkdir(path.join(root, "release"), { recursive: true });
  await copyFile(apkPath, path.join(root, "release", `Multi-CLI-Work-Mobile-${version.versionName}.apk`));
  console.log(`mobile shell ${version.versionName} (${version.versionCode}) → build/mobile`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
