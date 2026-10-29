// @vitest-environment node
import { createServer, type Server, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HerdrApiClient, HerdrCommandError, HerdrDeliveryUnknownError } from "./api-client";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
async function server(handler: (socket: Socket) => void) {
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\mcw-test-${randomUUID()}` : path.join(tmpdir(), `mcw-${randomUUID()}.sock`);
  const sockets = new Set<Socket>();
  const server: Server = createServer(socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); handler(socket); });
  await new Promise<void>(resolve => server.listen(endpoint, resolve));
  cleanup.push(() => { sockets.forEach(socket => socket.destroy()); server.close(); });
  return endpoint;
}
describe("Herdr API transport", () => {
  it("reassembles fragmented UTF-8 responses and matches request identity", async () => {
    const endpoint = await server(socket => socket.once("data", data => {
      const req = JSON.parse(data.toString());
      const reply = Buffer.from(JSON.stringify({id:req.id,result:{type:"ok",text:"한글"}})+"\n");
      const offset = reply.indexOf(Buffer.from("한")) + 1;
      socket.write(reply.subarray(0, offset));
      setTimeout(() => socket.end(reply.subarray(offset)), 5);
    }));
    expect(await new HerdrApiClient(endpoint).request("ping", {})).toEqual({type:"ok",text:"한글"});
  });
  it("reports an ambiguous disconnected mutation once and never retries", async () => {
    let accepted = 0;
    const endpoint = await server(socket => socket.once("data", () => { accepted++; socket.destroy(); }));
    await expect(new HerdrApiClient(endpoint).request("tab.create", {})).rejects.toBeInstanceOf(HerdrDeliveryUnknownError);
    expect(accepted).toBe(1);
  });
  it("separates explicit rejection from unknown delivery and rejects mismatched replies", async () => {
    let wrong = false;
    const endpoint = await server(socket => socket.once("data", data => {
      const req = JSON.parse(data.toString());
      socket.end(JSON.stringify({id:wrong?"other":req.id,error:{code:"not_found",message:"gone"}})+"\n");
    }));
    const api = new HerdrApiClient(endpoint);
    await expect(api.request("pane.get", {})).rejects.toBeInstanceOf(HerdrCommandError);
    wrong = true;
    await expect(api.request("pane.close", {})).rejects.toBeInstanceOf(HerdrDeliveryUnknownError);
  });
  it("subscribes before snapshot recovery and surfaces event loss as stale", async () => {
    let subscribed!: () => void;
    let eventSocket!: Socket;
    const connected = new Promise<void>(resolve => subscribed = resolve);
    const endpoint = await server(socket => socket.once("data", data => {
      const req = JSON.parse(data.toString());
      expect(req.method).toBe("events.subscribe");
      socket.write(JSON.stringify({id:req.id,result:{type:"subscription_started"}})+"\n");
      eventSocket = socket; subscribed();
    }));
    const events: unknown[] = [];
    let lost!: (error: Error) => void;
    const failure = new Promise<Error>(resolve => lost = resolve);
    const close = await new HerdrApiClient(endpoint).subscribe(["pane.created"], event => events.push(event), lost);
    cleanup.push(close);
    await connected;
    eventSocket.write('{"event":"pane.created","pane_id":"w1:p1"}\n');
    eventSocket.end('{"id":"","error":{"code":"events_lost","message":"resubscribe"}}\n');
    expect((await failure).message).toContain("events_lost");
    expect(events).toEqual([{event:"pane.created",pane_id:"w1:p1"}]);
  });
  it("bounds frames and times out without replay", async () => {
    const endpoint = await server(socket => socket.once("data", () => socket.write("x".repeat(300))));
    await expect(new HerdrApiClient(endpoint, {maxBytes:128,timeoutMs:50}).request("ping", {})).rejects.toThrow("limit");
    const silent = await server(() => {});
    await expect(new HerdrApiClient(silent, {timeoutMs:20}).request("tab.create", {})).rejects.toBeInstanceOf(HerdrDeliveryUnknownError);
  });
});
