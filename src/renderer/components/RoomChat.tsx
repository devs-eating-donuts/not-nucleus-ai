import { useEffect, useRef, useState } from 'react';
import { defaultPersonaForRole } from '../../shared/personas';
import type { ChatMessage } from '../../shared/room';
import type { RoleId } from '../../shared/roles';
import { chatOptions } from '../lib/letteredOptions';
import { MessageText } from './MessageText';
import { PersonaAvatar } from './PersonaAvatar';

interface RoomChatProps {
  /** Display name of the persona in this room. */
  personaName: string;
  /** Role whose persona portrait shows beside their messages (chat-app style). */
  roleId?: RoleId;
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  onSend: (text: string) => void;
  /**
   * Re-send the last unanswered user turn after a failure/timeout (no new message).
   * When provided, a Retry button appears beside the error so a timed-out turn
   * doesn't make the user retype. Omit for surfaces that have their own re-click path.
   */
  onRetry?: () => void;
  placeholder?: string;
  /** When set, the input is disabled and this note is shown instead. */
  disabledNote?: string;
  /** Fill the available height (flex-grow) instead of a fixed height. */
  fill?: boolean;
}

/**
 * Reusable project-room chat surface: a scrolling transcript plus a
 * full-width input and send button. Auto-scrolls to the newest message.
 */
export function RoomChat({
  personaName,
  roleId,
  messages,
  sending,
  error,
  onSend,
  onRetry,
  placeholder,
  disabledNote,
  fill = false,
}: RoomChatProps) {
  const [text, setText] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const disabled = disabledNote !== undefined;

  // Copy a message's text (e.g. a persona's question) so the user can paste it into
  // another AI to help draft an answer. Brief "Copied" confirmation on the button.
  const copyMessage = (value: string, i: number) => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopiedIndex(i);
        window.setTimeout(() => setCopiedIndex((cur) => (cur === i ? null : cur)), 1500);
      })
      .catch(() => undefined);
  };
  // Belt-and-suspenders draft preservation: remember the last sent text so a failed
  // turn can restore it to the (now-empty) textarea, without clobbering anything the
  // user has started typing since. Deduped per failure so it restores at most once.
  const lastSentRef = useRef<string | null>(null);
  const restoredForErrorRef = useRef(false);
  // Portrait is keyed by the role's default persona (stable across renames).
  const personaId = roleId ? defaultPersonaForRole(roleId)?.id : undefined;

  // Auto-scroll to the bottom whenever a message is sent or a reply lands.
  useEffect(() => {
    const el = threadRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, sending]);

  const send = () => {
    const value = text.trim();
    if (value === '' || sending || disabled) {
      return;
    }
    lastSentRef.current = value;
    restoredForErrorRef.current = false;
    onSend(value);
    setText('');
  };

  // If the turn failed (error set, not in flight), put the user's text back so they
  // don't retype — but only into an empty box, never over what they're typing now.
  useEffect(() => {
    if (error && !sending && lastSentRef.current && !restoredForErrorRef.current) {
      restoredForErrorRef.current = true;
      setText((t) => (t.trim() === '' ? (lastSentRef.current ?? '') : t));
    }
  }, [error, sending]);

  // If the standing persona question poses lettered options (A/B/C…), offer them as
  // clickable chips. Clicking sends the choice; the input still works for replies
  // that don't fit a single letter. chatOptions keeps the chips clickable even when
  // the user's last answer errored/timed out (the question still stands) instead of
  // collapsing them to plain text — see its doc comment.
  const lastMessage = messages[messages.length - 1];
  const options = chatOptions(messages, { sending, disabled, hasError: error !== null });
  const pickOption = (letter: string, label: string) => {
    if (sending || disabled) {
      return;
    }
    // The visible chip keeps the persona's "[recommended]" annotation, but it
    // reads oddly echoed back as the founder's own words — drop it from the reply.
    const clean = label.replace(/\s*\[recommended\]\s*$/i, '').trim();
    onSend(clean ? `${letter}) ${clean}` : letter);
  };

  return (
    <div className={`card room-chat${fill ? ' room-chat-fill' : ''}`}>
      <div className={`pitch-thread room-thread${fill ? ' room-thread-fill' : ''}`} ref={threadRef}>
        {messages.length === 0 && !sending && (
          <p className="field-hint" style={{ margin: 'auto' }}>
            No messages yet — say hello to {personaName}.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`pitch-msg ${m.role === 'user' ? 'founder' : 'erlich'}`}>
            {m.role === 'user' ? (
              <span className="pitch-who">You</span>
            ) : (
              <span className="pitch-who-row">
                <PersonaAvatar personaId={personaId} name={personaName} size={22} headFocus />
                <span className="pitch-who">{personaName}</span>
              </span>
            )}
            {m.role === 'user' ? (
              <span className="pitch-text">{m.text}</span>
            ) : (
              <MessageText text={m.text} />
            )}
            <button
              type="button"
              className="msg-copy"
              title="Copy this message (e.g. to ask another AI to help answer)"
              aria-label="Copy message"
              onClick={() => copyMessage(m.text, i)}
            >
              {copiedIndex === i ? 'Copied' : 'Copy'}
            </button>
          </div>
        ))}
        {sending && (
          <div className="pitch-msg erlich">
            <span className="pitch-who-row">
              <PersonaAvatar personaId={personaId} name={personaName} size={22} headFocus />
              <span className="pitch-who">{personaName}</span>
            </span>
            <span className="pitch-text pitch-thinking">
              <span className="room-spinner" aria-hidden="true" />
              {messages.length === 0 ? 'reading the brief…' : 'thinking…'}
            </span>
          </div>
        )}
      </div>

      {options.length > 0 && (
        <>
          <div className="room-options" role="group" aria-label="Suggested replies">
            {options.map((o) => (
              <button
                key={o.letter}
                type="button"
                className="room-option-chip"
                aria-label={o.label ? `${o.letter}: ${o.label}` : o.letter}
                onClick={() => pickOption(o.letter, o.label)}
              >
                <span className="room-option-letter">{o.letter}</span>
                <span className="room-option-label">{o.label}</span>
              </button>
            ))}
          </div>
          <p className="field-hint room-options-hint">
            Pick an option above, or type your own answer below.
          </p>
        </>
      )}

      {error && (
        <div className="room-error-row">
          <p className="validation-note err" style={{ margin: 'var(--space-2) 0 0' }}>
            {error}
          </p>
          {onRetry && !sending && lastMessage?.role === 'user' && (
            <button
              type="button"
              className="btn"
              disabled={disabled}
              onClick={() => onRetry()}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {disabledNote && (
        <p className="field-hint" style={{ margin: 'var(--space-2) 0 0' }}>
          {disabledNote}
        </p>
      )}

      <div className="pitch-input-col" style={{ marginTop: 'var(--space-3)' }}>
        <textarea
          value={text}
          disabled={disabled}
          placeholder={placeholder ?? `Message ${personaName}…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className="btn primary"
          disabled={disabled || text.trim() === '' || sending}
          onClick={send}
        >
          {sending ? 'Sending…' : `Send to ${personaName}`}
        </button>
      </div>
    </div>
  );
}
