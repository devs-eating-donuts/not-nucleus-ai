/**
 * Parses a persona's lettered multiple-choice options out of a chat message so
 * the renderer can offer clickable chips. The Architect (and other rooms) ask
 * build decisions as "A) … / B) … / C) …"; this turns those lines into chips
 * that send the chosen letter back. Pure + unit-testable — no DOM, no React.
 */

export interface LetteredOption {
  /** The single uppercase letter, e.g. "A". */
  letter: string;
  /** The option text after the letter, trimmed (always non-empty). */
  label: string;
}

// A line that is exactly an option: one A–Z letter in the "A)" / "(A)" form the
// personas emit (renderDecision / ROOM_PROMPTS), then the label. Optional
// markdown emphasis (**A)**) around the marker is tolerated. Anchored to the
// line so a stray "A)" mid-sentence in prose doesn't match. The "." delimiter is
// deliberately NOT accepted — "A. First point" is ordinary prose, not an option.
const EMPHASIS = '(?:\\*\\*|\\*|__|_)?';
const OPTION_LINE = new RegExp(`^${EMPHASIS}\\(?([A-Z])\\)${EMPHASIS}\\s+(\\S.*)$`);

// Split on any newline flavor — Windows CLI shims commonly emit CRLF, and the
// non-PTY spawn path does not strip the "\r" (only the PTY runner does). Without
// this, "$" anchors before the trailing "\r" and every option line fails to match.
const NEWLINE = /\r\n|\r|\n/;

/**
 * Extracts lettered options from `text`. Returns [] unless there are at least
 * two options whose letters are distinct and start at "A" running consecutively
 * (A, B, C…) — that consecutiveness check is what keeps it from firing on
 * arbitrary capital-letter-plus-paren prose.
 */
export function parseLetteredOptions(text: string): LetteredOption[] {
  const found: LetteredOption[] = [];
  for (const rawLine of text.split(NEWLINE)) {
    // Strip a leading list bullet ("- " / "* ") so bulleted option lines match.
    const line = rawLine.trim().replace(/^[-*]\s+/, '');
    const m = OPTION_LINE.exec(line);
    if (!m) {
      continue;
    }
    // Drop any stray bold markers left inside the captured label.
    const label = m[2].replace(/\*\*/g, '').trim();
    found.push({ letter: m[1], label });
  }
  if (found.length < 2) {
    return [];
  }
  // Must be A, B, C… in order with no duplicates — a real option list.
  for (let i = 0; i < found.length; i += 1) {
    if (found[i].letter !== String.fromCharCode(65 + i)) {
      return [];
    }
  }
  return found;
}

/** Minimal shape of a chat message — structural so this stays dependency-free. */
interface ChatTurn {
  role: 'user' | 'persona';
  text: string;
}

interface ChatOptionsState {
  /** A turn is in flight — hide chips until it settles. */
  sending: boolean;
  /** The input is disabled (e.g. no CLI assigned) — no chips. */
  disabled: boolean;
  /** The last turn errored/timed out (room error is set for this role). */
  hasError: boolean;
}

/**
 * Selects the lettered-option chips to offer for the current chat state.
 *
 * Normally the standing question is the LAST message — a fresh persona turn. But
 * a room turn is optimistic: the user's message is appended immediately and only
 * persisted if the CLI replies. When a turn errors or times out, that user turn
 * is LEFT as the trailing message (kept so Retry can re-send it) while the
 * persona's question still stands. The naive "last message must be persona" gate
 * then collapses the options to un-clickable plain text and forces the user to
 * retype the letter. So on error we fall back to the most recent persona message,
 * keeping its chips clickable. Hidden while sending or disabled. Pure — no DOM.
 */
export function chatOptions(messages: ChatTurn[], state: ChatOptionsState): LetteredOption[] {
  if (state.sending || state.disabled) {
    return [];
  }
  const last = messages[messages.length - 1];
  let source: string | undefined;
  if (last?.role === 'persona') {
    source = last.text;
  } else if (state.hasError && last?.role === 'user') {
    // The user's answer didn't go through — re-offer the question it was answering.
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'persona') {
        source = messages[i].text;
        break;
      }
    }
  }
  return source ? parseLetteredOptions(source) : [];
}
