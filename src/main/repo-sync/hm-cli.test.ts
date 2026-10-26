// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findHmCli, runHmRepoSync, type HmCli } from "./hm-cli";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-hm-cli-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function report(pathsJson: string, pending = "[]") {
  return `{schemaVersion:1,label:input.label,startedAt:"2026-10-26T00:00:00.000Z",finishedAt:"2026-10-26T00:00:03.000Z",results:${pathsJson},pending:${pending},summary:"요약",extra:"모르는 키"}`;
}

/** 가짜 hm-cli: stdin JSON을 받아 본문(`body`)을 실행한다. 받은 인자와 입력은 파일로 남긴다. */
async function fakeCli(body: string): Promise<HmCli> {
  const script = path.join(dir, "fake-hm.js");
  await fs.writeFile(
    script,
    `const fs = require("fs");
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const input = JSON.parse(raw);
  fs.writeFileSync(${JSON.stringify(path.join(dir, "seen.json"))}, JSON.stringify({ argv: process.argv.slice(2), input, env: process.env.FAKE_FLAG }));
  ${body}
});`,
    "utf8",
  );
  return { command: process.execPath, args: [script], env: { FAKE_FLAG: "on" } };
}

const RESULT =
  '[{path:input.paths[0],status:"updated",commits:2,finishedAt:"2026-10-26T00:00:01.000Z",cached:false,unknownField:1}]';

describe("runHmRepoSync", () => {
  it("stdin JSON으로 부르고 stdout 첫 줄 보고서를 읽는다", async () => {
    const cli = await fakeCli(`process.stdout.write(JSON.stringify(${report(RESULT)}) + "\\n");`);
    const result = await runHmRepoSync(cli, { paths: ["D:\\dev\\a"], label: "VSP", waitMs: 3000 }, 10_000);
    expect(result).toMatchObject({
      label: "VSP",
      results: [{ path: "D:\\dev\\a", status: "updated", commits: 2, cached: false }],
      pending: [],
      summary: "요약",
    });
    expect(result?.results[0]).not.toHaveProperty("unknownField");
    const seen = JSON.parse(await fs.readFile(path.join(dir, "seen.json"), "utf8"));
    expect(seen.argv).toEqual(["repos", "sync", "--stdin", "--json"]);
    expect(seen.input).toEqual({ paths: ["D:\\dev\\a"], label: "VSP", waitMs: 3000 });
    expect(seen.env).toBe("on");
  });

  it("첫 줄을 쓴 뒤에도 남은 일을 하는 프로세스를 기다리지 않는다", async () => {
    const cli = await fakeCli(
      `process.stdout.write(JSON.stringify(${report("[]", "input.paths")}) + "\\n");
       setTimeout(() => fs.writeFileSync(${JSON.stringify(path.join(dir, "late.txt"))}, "done"), 1500);`,
    );
    const started = Date.now();
    const result = await runHmRepoSync(cli, { paths: ["D:\\dev\\slow"], waitMs: 100 }, 10_000);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result?.pending).toEqual(["D:\\dev\\slow"]);
    // detached로 떠서 호출자가 놓아 준 뒤에도 끝까지 일한다.
    await expect.poll(() => fs.readFile(path.join(dir, "late.txt"), "utf8").catch(() => ""), { timeout: 5000 }).toBe("done");
  });

  it("첫 줄이 제한 시간 안에 오지 않으면 null이다", async () => {
    const cli = await fakeCli(`setTimeout(() => {}, 5000);`);
    expect(await runHmRepoSync(cli, { paths: ["D:\\dev\\a"] }, 300)).toBeNull();
  });

  it("사용법 오류(종료 코드 2)나 깨진 출력은 null이다", async () => {
    const usage = await fakeCli(`process.exit(2);`);
    expect(await runHmRepoSync(usage, { paths: [] }, 10_000)).toBeNull();
    const garbage = await fakeCli(`process.stdout.write("not json\\n");`);
    expect(await runHmRepoSync(garbage, { paths: ["x"] }, 10_000)).toBeNull();
  });

  it("실행 파일을 띄울 수 없으면 throw하지 않고 null이다", async () => {
    const cli: HmCli = { command: path.join(dir, "nope.exe"), args: [], env: {} };
    expect(await runHmRepoSync(cli, { paths: ["x"] }, 5_000)).toBeNull();
  });
});

describe("findHmCli", () => {
  const write = async (value: unknown) => {
    await fs.mkdir(path.join(dir, "bin"), { recursive: true });
    await fs.writeFile(path.join(dir, "bin", "hm-cli.json"), typeof value === "string" ? value : JSON.stringify(value));
  };

  it("hm-cli.json의 command·args·env를 읽고 모르는 키는 무시한다", async () => {
    await write({ schemaVersion: 1, command: process.execPath, args: ["cli.js"], env: { ELECTRON_RUN_AS_NODE: "1" }, extra: 1 });
    expect(await findHmCli(dir)).toEqual({ command: process.execPath, args: ["cli.js"], env: { ELECTRON_RUN_AS_NODE: "1" } });
  });

  it("파일이 없거나, 깨졌거나, 실행 파일이 사라졌으면 null이다", async () => {
    expect(await findHmCli(dir)).toBeNull();
    await write("{ broken");
    expect(await findHmCli(dir)).toBeNull();
    await write({ schemaVersion: 1, command: path.join(dir, "gone.exe"), args: [] });
    expect(await findHmCli(dir)).toBeNull();
  });
});
