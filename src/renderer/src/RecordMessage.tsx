import type { BoardMessage, BoardRecipient } from "@shared/board-types";
import type { DeliveryRecord } from "@shared/delivery-types";
import type { TerminalSessionView } from "@shared/api-types";
import { boardTextParts, holdReasonLabel } from "./board-model";

export function RecordMessage({ message, sessions, deliveries, onFocusSession }: {
  message: BoardMessage; sessions: TerminalSessionView[]; deliveries: DeliveryRecord[] | null;
  onFocusSession(session: TerminalSessionView): void;
}) {
  const author = message.author;
  const sessionLink = (id: string, label: string) => {
    const session = sessions.find(item => item.id === id);
    return <button type="button" className="record-session-link" disabled={!session} onClick={() => session && onFocusSession(session)}>{label}</button>;
  };
  const recipientState = (recipient: BoardRecipient) => {
    const current = deliveries?.find(record => record.id === recipient.deliveryId);
    const state = current?.state ?? recipient.delivery;
    const reason = current?.reason ?? recipient.reason;
    if (state === "held") return current ? `전달 대기 · ${holdReasonLabel(reason ?? null)}` : "현재 전달 상태 확인 불가";
    if (state === "delivered") return "터미널 전달됨";
    if (state === "failed") return `전달 실패${reason ? ` · ${reason}` : ""}`;
    if (state === "dropped") return "취소됨";
    return null;
  };
  return <article className={`record-message record-${message.kind}`}>
    <header>
      {author.kind === "session" ? sessionLink(author.sessionId, author.name) : <strong>{author.kind === "user" ? "나" : "앱"}</strong>}
      <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
    </header>
    <div className="record-message-text">{boardTextParts(message.text).map((part, index) => part.code
      ? <pre key={index}><code>{part.text}</code></pre> : <p key={index}>{part.text.trim()}</p>)}</div>
    {message.to.length > 0 ? <ul className="record-recipients" aria-label="받은 세션">{message.to.map(recipient => {
      const current = deliveries?.find(record => record.id === recipient.deliveryId);
      const text = current?.text ?? recipient.deliveryText;
      return <li key={recipient.sessionId}>
        <div>{sessionLink(recipient.sessionId, recipient.name)}<span>{recipientState(recipient)}</span></div>
        {text !== undefined && text !== message.text ? <details><summary>전달 내용</summary><pre>{text}</pre></details> : null}
      </li>;
    })}</ul> : null}
  </article>;
}
