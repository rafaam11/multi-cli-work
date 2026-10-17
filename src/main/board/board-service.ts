import type { TerminalSessionView } from "../../shared/api-types";
import {
  BOARD_MESSAGE_MAX,
  type BoardAuthor,
  type BoardMessage,
  type BoardMessageKind,
  type BoardRecipient,
} from "../../shared/board-types";
import { sessionLabel, type DeliveryQueue, type DeliveryRecord } from "../control/delivery-queue";
import type { BoardStore } from "./board-store";

/**
 * The board's rules: who said what, in which folder's feed, and how far each typed copy got. It owns
 * no delivery of its own — a post that names sessions goes through the same queue as `jk send`, and
 * the queue's progress is written back onto the message as it happens.
 */

export interface BoardServiceOptions {
  store: Pick<BoardStore, "list" | "append" | "patch">;
  delivery: Pick<DeliveryQueue, "enqueue" | "onChange">;
  sessions(): TerminalSessionView[];
  idFactory(): string;
  now(): string;
  publish(message: BoardMessage): void;
}

export interface BoardPostRequest {
  projectId: string;
  text: string;
  mentions: string[];
  /** The posting session; null when the user posts from the board itself. */
  from: string | null;
}

const MAX_ORPHANS = 200;

export class BoardError extends Error {}

export class BoardService {
  /** Which board messages carry each delivery — a direct send may sit on two folders' boards. */
  private readonly byDelivery = new Map<string, Array<{ projectId: string; messageId: string }>>();
  /** Progress that arrived before its message was written. */
  private readonly orphans = new Map<string, DeliveryRecord>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: BoardServiceOptions) {
    options.delivery.onChange((record) => {
      if (!this.byDelivery.has(record.id)) {
        this.orphans.set(record.id, record);
        if (this.orphans.size > MAX_ORPHANS) this.orphans.delete(this.orphans.keys().next().value as string);
        return;
      }
      void this.serial(() => this.applyDelivery(record)).catch((error) =>
        console.error("Failed to record a board delivery", error),
      );
    });
  }

  async list(projectId: string, options: { sinceId?: string; limit?: number } = {}): Promise<BoardMessage[]> {
    let messages = await this.options.store.list(projectId);
    if (options.sinceId) {
      const index = messages.findIndex((message) => message.id === options.sinceId);
      if (index >= 0) messages = messages.slice(index + 1);
    }
    return options.limit ? messages.slice(-options.limit) : messages;
  }

  async post(request: BoardPostRequest): Promise<BoardMessage> {
    const text = request.text.trim();
    if (!text) throw new BoardError("내용이 비어 있습니다.");
    if (text.length > BOARD_MESSAGE_MAX) throw new BoardError(`게시글은 ${BOARD_MESSAGE_MAX}자까지입니다.`);
    const sessions = this.options.sessions();
    const author = this.authorFor(request.from, sessions);
    const recipients: BoardRecipient[] = [];
    for (const sessionId of new Set(request.mentions)) {
      if (sessionId === request.from) continue;
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (!session) throw new BoardError(`알 수 없는 세션: ${sessionId}`);
      recipients.push(recipientFor(session));
    }
    const message = await this.serial(() => this.write(request.projectId, author, "post", text, recipients));
    const label = `board: ${author.kind === "session" ? author.name : "나"}`;
    for (const recipient of recipients) {
      const record = await this.options.delivery.enqueue({ to: recipient.sessionId, text, from: request.from, label });
      await this.serial(() => this.track(record, [{ projectId: request.projectId, messageId: message.id }]));
    }
    return (await this.find(request.projectId, message.id)) ?? message;
  }

  /** Puts a `jk send` on the board of the folders it crossed. */
  async recordDirect(record: DeliveryRecord, note?: string): Promise<void> {
    const sessions = this.options.sessions();
    const target = sessions.find((session) => session.id === record.to);
    if (!target) return;
    const sender = record.from ? sessions.find((session) => session.id === record.from) : undefined;
    const projectIds = [...new Set([sender?.projectId, target.projectId].filter((id): id is string => Boolean(id)))];
    if (projectIds.length === 0) return;
    const author = this.authorFor(record.from, sessions, true);
    const text = note ? `${note}\n${record.text}` : record.text;
    const recipient: BoardRecipient = { ...recipientFor(target), delivery: record.state, reason: record.reason, deliveryId: record.id };
    const placed: Array<{ projectId: string; messageId: string }> = [];
    for (const projectId of projectIds) {
      const message = await this.serial(() => this.write(projectId, author, "direct", text, [recipient]));
      placed.push({ projectId, messageId: message.id });
    }
    await this.serial(() => this.track(record, placed));
  }

  async event(projectId: string, text: string): Promise<BoardMessage> {
    return this.serial(() => this.write(projectId, { kind: "system" }, "event", text, []));
  }

  private authorFor(from: string | null, sessions: TerminalSessionView[], systemWhenNone = false): BoardAuthor {
    if (from) {
      const session = sessions.find((candidate) => candidate.id === from);
      if (session) return { kind: "session", sessionId: session.id, name: sessionLabel(session), agent: session.kind };
    }
    return systemWhenNone ? { kind: "system" } : { kind: "user" };
  }

  private async write(
    projectId: string,
    author: BoardAuthor,
    kind: BoardMessageKind,
    text: string,
    to: BoardRecipient[],
  ): Promise<BoardMessage> {
    const message: BoardMessage = { id: this.options.idFactory(), projectId, author, kind, text, to, createdAt: this.options.now() };
    await this.options.store.append(message);
    this.options.publish(message);
    return message;
  }

  private async track(record: DeliveryRecord, placed: Array<{ projectId: string; messageId: string }>): Promise<void> {
    this.byDelivery.set(record.id, [...(this.byDelivery.get(record.id) ?? []), ...placed]);
    const latest = this.orphans.get(record.id);
    this.orphans.delete(record.id);
    await this.applyDelivery(latest ?? record);
  }

  private async applyDelivery(record: DeliveryRecord): Promise<void> {
    for (const { projectId, messageId } of this.byDelivery.get(record.id) ?? []) {
      const message = await this.find(projectId, messageId);
      if (!message) continue;
      let changed = false;
      const to = message.to.map((recipient) => {
        if (recipient.sessionId !== record.to) return recipient;
        if (recipient.delivery === record.state && recipient.reason === record.reason && recipient.deliveryId === record.id) {
          return recipient;
        }
        changed = true;
        return { ...recipient, delivery: record.state, reason: record.reason, deliveryId: record.id };
      });
      if (!changed) continue;
      const patched = await this.options.store.patch(projectId, messageId, to);
      if (patched) this.options.publish(patched);
    }
    if (record.state !== "held") this.byDelivery.delete(record.id);
  }

  private async find(projectId: string, messageId: string): Promise<BoardMessage | null> {
    return (await this.options.store.list(projectId)).find((message) => message.id === messageId) ?? null;
  }

  /** Board writes run one at a time, so a delivery update never races the message it updates. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.catch(() => undefined).then(task);
    this.chain = next;
    return next;
  }
}

function recipientFor(session: TerminalSessionView): BoardRecipient {
  return { sessionId: session.id, name: sessionLabel(session), agent: session.kind };
}
