import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { BoardAuthor, BoardMessage, BoardRecipient } from "@shared/board-types";
import type { SessionPreset } from "@shared/preset-types";
import { AnimatePresence, motion } from "motion/react";
import { Check, CornerDownLeft, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AgentIcon, agentAccentClass } from "./brand-icons";
import {
  activeMentions,
  boardMembers,
  boardRelativeTime,
  boardTextParts,
  continuesTurn,
  deliveryLabel,
  holdReasonLabel,
  memberName,
  mentionQueryAt,
  mergeBoardMessage,
} from "./board-model";
import { motionDuration, motionEase } from "./motion-tokens";

export interface TeamBoardProps {
  hidden: boolean;
  projectId: string | null;
  projectLabel: string | null;
  sessions: TerminalSessionView[];
  agents: AgentView[];
  onFocusSession(session: TerminalSessionView): void;
  /** Messages that arrived while the board was out of sight. */
  onUnreadChange(count: number): void;
  /** Offered in place of the roster while the folder has no running session. */
  presets?: readonly SessionPreset[];
  onStartPreset?(presetId: string): void;
}

const STICK_TO_BOTTOM_PX = 48;

/**
 * The folder's team board. Posts read like a chat; a session-to-session send is drawn as a wire from
 * sender to recipient, and the wire carries the message's progress: a pulse travels it while the
 * message waits for its target, it closes when the text went in, and it breaks when it could not.
 */
export function TeamBoard({
  hidden,
  projectId,
  projectLabel,
  sessions,
  agents,
  onFocusSession,
  onUnreadChange,
  presets = [],
  onStartPreset,
}: TeamBoardProps) {
  const [messages, setMessages] = useState<BoardMessage[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [seenCount, setSeenCount] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;

  useEffect(() => {
    setMessages([]);
    setSeenCount(0);
    stuckRef.current = true;
    if (projectId === null) return;
    let cancelled = false;
    void window.multiCliWork.board.list(projectId).then((loaded) => {
      if (cancelled) return;
      setMessages(loaded);
      setSeenCount(loaded.length);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(
    () =>
      window.multiCliWork.board.onChange((message) => {
        if (message.projectId !== projectRef.current) return;
        setMessages((current) => mergeBoardMessage(current, message));
      }),
    [],
  );

  // Relative times are re-read once a minute; nothing else on the board ticks.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!hidden) setSeenCount(messages.length);
  }, [hidden, messages.length]);

  useEffect(() => {
    onUnreadChange(hidden ? Math.max(0, messages.length - seenCount) : 0);
  }, [hidden, messages.length, seenCount, onUnreadChange]);

  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (feed && stuckRef.current) feed.scrollTop = feed.scrollHeight;
  }, [messages, hidden]);

  const members = useMemo(() => boardMembers(sessions, projectId), [sessions, projectId]);
  const sessionsById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  // Hidden, not unmounted: a half-written post survives a switch to the file tab.
  if (projectId === null) {
    return (
      <div className="team-board" hidden={hidden}>
        <p className="board-empty">폴더를 고르면 그 폴더의 팀 보드가 열립니다.</p>
      </div>
    );
  }

  return (
    <div className="team-board" hidden={hidden}>
      <header className="board-roster" aria-label={`${projectLabel ?? "이 폴더"}의 세션`}>
        {members.length === 0 ? (
          presets.length > 0 && onStartPreset ? (
            <>
              <span className="board-roster-empty">팀 시작:</span>
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="board-roster-member board-roster-preset"
                  onClick={() => onStartPreset(preset.id)}
                  title={preset.description ?? preset.members.map((member) => member.name).join(", ")}
                >
                  <span className="preset-menu-icons" aria-hidden="true">
                    {preset.members.map((member, index) => (
                      <AgentIcon key={index} agent={agentsById.get(member.agentId)} size={13} />
                    ))}
                  </span>
                  <span>{preset.name}</span>
                </button>
              ))}
            </>
          ) : (
            <span className="board-roster-empty">실행 중인 세션이 없습니다</span>
          )
        ) : (
          members.map((member) => (
            <button
              key={member.id}
              type="button"
              className={`board-roster-member status-${member.status}`}
              onClick={() => onFocusSession(member)}
              title={`${memberName(member)} — ${statusLabel(member.status)}`}
            >
              <Avatar agent={agentsById.get(member.kind)} status={member.status} size={24} />
              <span>{memberName(member)}</span>
            </button>
          ))
        )}
      </header>

      <div
        className="board-feed"
        ref={feedRef}
        onScroll={(event) => {
          const feed = event.currentTarget;
          stuckRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < STICK_TO_BOTTOM_PX;
        }}
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="board-empty">
            <p>아직 조용합니다.</p>
            <p>
              세션이 <code>jk post</code>로 글을 올리거나 서로 <code>jk send</code>하면 여기에 모입니다. 아래 입력창에서
              <code>@</code>로 세션을 불러 일을 맡길 수 있습니다.
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((message, index) => (
              <motion.div
                key={message.id}
                layout="position"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: motionDuration.base, ease: motionEase.out }}
              >
                <BoardItem
                  message={message}
                  continues={continuesTurn(messages[index - 1], message)}
                  now={now}
                  sessionsById={sessionsById}
                  agentsById={agentsById}
                  onFocusSession={onFocusSession}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      <Composer projectId={projectId} members={members} agentsById={agentsById} />
    </div>
  );
}

interface ItemProps {
  message: BoardMessage;
  continues: boolean;
  now: number;
  sessionsById: Map<string, TerminalSessionView>;
  agentsById: Map<string, AgentView>;
  onFocusSession(session: TerminalSessionView): void;
}

function BoardItem({ message, continues, now, sessionsById, agentsById, onFocusSession }: ItemProps) {
  if (message.kind === "event") {
    return (
      <div className="board-event">
        <span>{message.text}</span>
        <time dateTime={message.createdAt}>{boardRelativeTime(message.createdAt, now)}</time>
      </div>
    );
  }

  const authorSession = message.author.kind === "session" ? sessionsById.get(message.author.sessionId) : undefined;
  const authorAgent = message.author.kind === "session" ? agentsById.get(message.author.agent) : undefined;
  const focus = (sessionId: string) => {
    const session = sessionsById.get(sessionId);
    if (session) onFocusSession(session);
  };

  if (message.kind === "direct") {
    const recipient = message.to[0];
    return (
      <article className={`board-wire delivery-${recipient?.delivery ?? "held"}`}>
        <div className="board-wire-ends">
          <EndButton author={message.author} agent={authorAgent} status={authorSession?.status} onFocus={focus} />
          <span className="board-wire-line" aria-hidden="true">
            <i />
          </span>
          {recipient ? (
            <EndButton recipient={recipient} agent={agentsById.get(recipient.agent)} status={sessionsById.get(recipient.sessionId)?.status} onFocus={focus} />
          ) : null}
        </div>
        <div className="board-wire-meta">
          <span className="board-wire-names">
            {authorName(message.author)} <span aria-label="에게">→</span> {recipient?.name ?? "?"}
          </span>
          <time dateTime={message.createdAt}>{boardRelativeTime(message.createdAt, now)}</time>
        </div>
        <BoardText text={message.text} />
        {recipient?.delivery ? (
          <p className="board-wire-state" title={recipient.reason ?? undefined}>
            {recipient.delivery === "delivered" ? <Check size={12} aria-hidden="true" /> : null}
            {recipient.delivery === "failed" || recipient.delivery === "dropped" ? <X size={12} aria-hidden="true" /> : null}
            {recipient.delivery === "held" ? holdReasonLabel(recipient.reason ?? null) : deliveryLabel(recipient)}
          </p>
        ) : null}
      </article>
    );
  }

  return (
    <article className={`board-post ${continues ? "continues" : ""} author-${message.author.kind}`}>
      {continues ? (
        <span className="board-post-gutter" aria-hidden="true" />
      ) : (
        <AuthorAvatar author={message.author} agent={authorAgent} status={authorSession?.status} />
      )}
      <div className="board-post-body">
        {continues ? null : (
          <div className="board-post-meta">
            <span className="board-post-author">{authorName(message.author)}</span>
            <time dateTime={message.createdAt}>{boardRelativeTime(message.createdAt, now)}</time>
          </div>
        )}
        <BoardText text={message.text} />
        {message.to.length > 0 ? (
          <ul className="board-mentions" aria-label="받은 세션">
            {message.to.map((recipient) => (
              <li key={recipient.sessionId}>
                <button
                  type="button"
                  className={`board-mention delivery-${recipient.delivery ?? "none"}`}
                  onClick={() => focus(recipient.sessionId)}
                  title={deliveryLabel(recipient) || undefined}
                >
                  <span className="board-mention-dot" aria-hidden="true" />@{recipient.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

function EndButton({
  author,
  recipient,
  agent,
  status,
  onFocus,
}: {
  author?: BoardAuthor;
  recipient?: BoardRecipient;
  agent: AgentView | undefined;
  status: TerminalSessionView["status"] | undefined;
  onFocus(sessionId: string): void;
}) {
  const sessionId = recipient?.sessionId ?? (author?.kind === "session" ? author.sessionId : null);
  const avatar = author ? <AuthorAvatar author={author} agent={agent} status={status} /> : <Avatar agent={agent} status={status} size={26} />;
  if (!sessionId) return avatar;
  return (
    <button type="button" className="board-wire-end" onClick={() => onFocus(sessionId)} title={`${recipient?.name ?? authorName(author!)} 세션으로`}>
      {avatar}
    </button>
  );
}

function AuthorAvatar({ author, agent, status }: { author: BoardAuthor; agent: AgentView | undefined; status?: TerminalSessionView["status"] }) {
  if (author.kind === "user") return <span className="board-avatar board-avatar-user" aria-hidden="true">나</span>;
  if (author.kind === "system") return <span className="board-avatar board-avatar-system" aria-hidden="true" />;
  return <Avatar agent={agent} status={status} size={26} />;
}

function Avatar({ agent, status, size }: { agent: AgentView | undefined; status: TerminalSessionView["status"] | undefined; size: number }) {
  return (
    <span className={`board-avatar status-${status ?? "exited"}`} style={{ width: size, height: size }} aria-hidden="true">
      <AgentIcon agent={agent} size={Math.round(size * 0.58)} className={agentAccentClass(agent)} />
    </span>
  );
}

function BoardText({ text }: { text: string }) {
  return (
    <div className="board-text">
      {boardTextParts(text).map((part, index) =>
        part.code ? (
          <pre key={index}>
            <code>{part.text}</code>
          </pre>
        ) : (
          <p key={index}>{part.text.replace(/^\n+|\n+$/g, "")}</p>
        ),
      )}
    </div>
  );
}

function Composer({
  projectId,
  members,
  agentsById,
}: {
  projectId: string;
  members: TerminalSessionView[];
  agentsById: Map<string, AgentView>;
}) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText("");
    setMentions(new Map());
    setError(null);
  }, [projectId]);

  const candidates = useMemo(() => {
    if (!query) return [];
    const needle = query.query.toLocaleLowerCase();
    return members.filter((member) => memberName(member).toLocaleLowerCase().includes(needle)).slice(0, 6);
  }, [members, query]);

  const readQuery = (value: string, caret: number) => {
    setQuery(mentionQueryAt(value, caret));
    setHighlight(0);
  };

  const pick = (member: TerminalSessionView) => {
    if (!query) return;
    const name = memberName(member);
    const next = `${text.slice(0, query.start)}@${name} ${text.slice(query.start + query.query.length + 1)}`;
    setText(next);
    setMentions((current) => new Map(current).set(member.id, name));
    setQuery(null);
    const caret = query.start + name.length + 2;
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(caret, caret));
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await window.multiCliWork.board.post({ projectId, text: body, mentions: activeMentions(body, mentions) });
      setText("");
      setMentions(new Map());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(cause));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (candidates.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((value) => (value + (event.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(candidates[highlight]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setQuery(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const mentioned = activeMentions(text, mentions);

  return (
    <div className="board-composer">
      <AnimatePresence>
        {candidates.length > 0 ? (
          <motion.ul
            className="board-mention-picker"
            role="listbox"
            aria-label="세션 지목"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: motionDuration.fast, ease: motionEase.out }}
          >
            {candidates.map((member, index) => (
              <li key={member.id} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  className={index === highlight ? "active" : ""}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(member);
                  }}
                >
                  <Avatar agent={agentsById.get(member.kind)} status={member.status} size={20} />
                  <span>{memberName(member)}</span>
                  <small>{statusLabel(member.status)}</small>
                </button>
              </li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
      <textarea
        ref={inputRef}
        value={text}
        rows={2}
        placeholder={members.length > 0 ? "보드에 쓰기 — @로 세션에게도 보냅니다" : "보드에 쓰기"}
        aria-label="팀 보드에 쓰기"
        onChange={(event) => {
          setText(event.target.value);
          readQuery(event.target.value, event.target.selectionStart);
        }}
        onSelect={(event) => readQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => setQuery(null)}
        onKeyDown={onKeyDown}
      />
      <div className="board-composer-row">
        <span className="board-composer-hint">
          {error ? (
            <span className="board-composer-error">{error}</span>
          ) : mentioned.length > 0 ? (
            `${mentioned.length}개 세션에도 프롬프트로 넣습니다`
          ) : (
            "Shift+Enter 줄바꿈"
          )}
        </span>
        <button type="button" className="board-send" onClick={() => void send()} disabled={!text.trim() || sending}>
          <CornerDownLeft size={13} aria-hidden="true" />
          올리기
        </button>
      </div>
    </div>
  );
}

function authorName(author: BoardAuthor): string {
  if (author.kind === "session") return author.name;
  return author.kind === "user" ? "나" : "앱";
}

function statusLabel(status: TerminalSessionView["status"]): string {
  switch (status) {
    case "working":
      return "작업 중";
    case "awaiting-input":
      return "입력 대기";
    case "awaiting-approval":
      return "승인 대기";
    case "starting":
      return "시작 중";
    case "idle":
      return "대기";
    default:
      return "종료됨";
  }
}
