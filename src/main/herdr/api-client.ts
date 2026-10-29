import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import { TextDecoder } from "node:util";

type RecordValue = Record<string, unknown>;
export class HerdrCommandError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); }
}
/** The peer may have admitted a mutation before the connection failed. Never retry it implicitly. */
export class HerdrDeliveryUnknownError extends Error {
  constructor(readonly requestId: string, message: string) { super(`Delivery unknown (${requestId}): ${message}`); }
}
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class HerdrApiClient {
  constructor(readonly endpoint: string, private readonly options: {maxBytes?: number; timeoutMs?: number} = {}) {}

  request<T = RecordValue>(method: string, params: RecordValue): Promise<T> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      let sent = false;
      let settled = false;
      const socket = connect(this.endpoint);
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error); else resolve(value as T);
      };
      const failed = (error: Error) => finish(sent && !(error instanceof HerdrCommandError)
        ? new HerdrDeliveryUnknownError(id, error.message) : error);
      const timer = setTimeout(() => failed(new Error("Herdr request timed out")), this.options.timeoutMs ?? 10_000);
      socket.once("connect", () => {
        sent = true;
        socket.write(JSON.stringify({id,method,params}) + "\n");
      });
      this.readLines(socket, value => {
        if (!record(value) || value.id !== id) return failed(new Error("Mismatched Herdr response"));
        if (record(value.error)) return finish(new HerdrCommandError(String(value.error.code), String(value.error.message)));
        if (!("result" in value)) return failed(new Error("Invalid Herdr response"));
        finish(undefined, value.result);
      }, failed);
      socket.once("error", failed);
      socket.once("close", () => failed(new Error("Herdr disconnected before acknowledgement")));
    });
  }

  /** Resolves only after the server acknowledges the subscription; bootstrap snapshots come next. */
  subscribe(types: (string | RecordValue)[], onEvent: (event: RecordValue) => void, onStale: (error: Error) => void): Promise<() => void> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      let ready = false;
      let closed = false;
      const socket = connect(this.endpoint);
      const close = () => { closed = true; clearTimeout(timer); socket.destroy(); };
      const failed = (error: Error) => {
        if (closed) return;
        close();
        if (ready) onStale(error); else reject(error);
      };
      const timer = setTimeout(() => failed(new Error("Herdr subscription timed out")), this.options.timeoutMs ?? 10_000);
      socket.once("connect", () => socket.write(JSON.stringify({id,method:"events.subscribe",params:{subscriptions:types.map(type => typeof type === "string" ? {type} : type)}})+"\n"));
      this.readLines(socket, value => {
        if (!record(value)) return failed(new Error("Invalid Herdr event"));
        if (record(value.error)) return failed(new HerdrCommandError(String(value.error.code), String(value.error.message)));
        if (!ready) {
          if (value.id !== id || !record(value.result) || value.result.type !== "subscription_started") return failed(new Error("Invalid subscription acknowledgement"));
          ready = true;
          clearTimeout(timer);
          resolve(close);
        } else onEvent(value);
      }, failed);
      socket.once("error", failed);
      socket.once("close", () => failed(new Error("Herdr event stream disconnected")));
    });
  }

  private readLines(socket: Socket, onLine: (value: unknown) => void, onError: (error: Error) => void): void {
    let buffer = Buffer.alloc(0);
    const max = this.options.maxBytes ?? 8 * 1024 * 1024;
    socket.on("data", (data: Buffer) => {
      buffer = Buffer.concat([buffer,data]);
      for (;;) {
        const newline = buffer.indexOf(10);
        if (newline < 0) break;
        if (newline > max) { onError(new Error("Herdr response exceeds byte limit")); return; }
        const line = buffer.subarray(0,newline);
        buffer = buffer.subarray(newline+1);
        try { onLine(JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(line))); }
        catch (error) { onError(error instanceof Error ? error : new Error(String(error))); return; }
        if (socket.destroyed) return;
      }
      if (buffer.length > max) onError(new Error("Herdr response exceeds byte limit"));
    });
  }
}
