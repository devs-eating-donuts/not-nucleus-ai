import { describe, expect, it } from 'vitest';
import { chatOptions, parseLetteredOptions } from './letteredOptions';

describe('parseLetteredOptions', () => {
  it('parses a simple A/B/C list', () => {
    const opts = parseLetteredOptions(
      'How should sign-in work?\nA) Microsoft Entra\nB) Clerk\nC) Auth.js',
    );
    expect(opts.map((o) => o.letter)).toEqual(['A', 'B', 'C']);
    expect(opts[0].label).toBe('Microsoft Entra');
    expect(opts[1].label).toBe('Clerk');
  });

  it('accepts a leading bullet and a paren prefix', () => {
    expect(parseLetteredOptions('- A) One\n- B) Two').map((o) => o.letter)).toEqual(['A', 'B']);
    expect(parseLetteredOptions('(A) One\n(B) Two').map((o) => o.letter)).toEqual(['A', 'B']);
  });

  it('tolerates CRLF line endings (Windows CLI output)', () => {
    const opts = parseLetteredOptions('Pick a datastore?\r\nA) PostgreSQL\r\nB) Azure SQL\r\nC) Cosmos');
    expect(opts.map((o) => o.letter)).toEqual(['A', 'B', 'C']);
    expect(opts[1].label).toBe('Azure SQL');
  });

  it('parses the em-dash cost format the personas emit', () => {
    const opts = parseLetteredOptions(
      'A) Azure Static Web Apps — Free, then ~$9/mo\nB) Cloudflare Pages — Free tier',
    );
    expect(opts.map((o) => o.letter)).toEqual(['A', 'B']);
    expect(opts[0].label).toBe('Azure Static Web Apps — Free, then ~$9/mo');
  });

  it('parses bolded option markers and cleans the label', () => {
    const opts = parseLetteredOptions('**A)** PostgreSQL\n**B)** Azure SQL');
    expect(opts.map((o) => o.letter)).toEqual(['A', 'B']);
    expect(opts[0].label).toBe('PostgreSQL');
  });

  it('keeps the A/B/C run intact when a recommendation line follows', () => {
    const opts = parseLetteredOptions('A) Postgres\nB) Azure SQL\nI recommend A.');
    expect(opts.map((o) => o.letter)).toEqual(['A', 'B']);
  });

  it('returns [] for a single option', () => {
    expect(parseLetteredOptions('A) Only one choice')).toEqual([]);
  });

  it('returns [] when letters are not consecutive from A', () => {
    expect(parseLetteredOptions('B) Two\nC) Three')).toEqual([]);
    expect(parseLetteredOptions('A) One\nC) Three')).toEqual([]);
  });

  it('does not fire on prose containing a parenthesis', () => {
    const prose =
      'I think option A (the managed one) is best, and B is also fine.\nLet me know which you prefer.';
    expect(parseLetteredOptions(prose)).toEqual([]);
  });

  it('does not fire on an ordinary "A." / "B." prose list', () => {
    expect(parseLetteredOptions('A. This is the first point.\nB. This is the second point.')).toEqual([]);
  });

  it('ignores duplicate letters that would break the A,B,C ordering', () => {
    expect(parseLetteredOptions('A) One\nA) Again\nB) Two')).toEqual([]);
  });

  it('keeps the recommended marker as part of the label', () => {
    const opts = parseLetteredOptions('A) Stripe Checkout [recommended]\nB) Custom Elements');
    expect(opts[0].label).toBe('Stripe Checkout [recommended]');
  });
});

describe('chatOptions', () => {
  const question = {
    role: 'persona' as const,
    text: 'Which framework?\nA) Next.js\nB) Remix\nC) Astro',
  };
  const ok = { sending: false, disabled: false, hasError: false };

  it('offers the chips when the persona just asked', () => {
    const opts = chatOptions([question], ok);
    expect(opts.map((o) => o.letter)).toEqual(['A', 'B', 'C']);
  });

  it('hides chips while a turn is in flight', () => {
    expect(chatOptions([question], { ...ok, sending: true })).toEqual([]);
  });

  it('hides chips when the room is disabled', () => {
    expect(chatOptions([question], { ...ok, disabled: true })).toEqual([]);
  });

  it('hides chips during the in-flight/limbo state (trailing user turn, no error)', () => {
    const msgs = [question, { role: 'user' as const, text: 'B) Remix' }];
    expect(chatOptions(msgs, ok)).toEqual([]);
  });

  it('re-offers the standing question when the last answer errored (the bug fix)', () => {
    // A timed-out chip click leaves the user turn as the trailing message; the
    // persona's question still stands, so the chips must stay clickable.
    const msgs = [question, { role: 'user' as const, text: 'B) Remix' }];
    const opts = chatOptions(msgs, { ...ok, hasError: true });
    expect(opts.map((o) => o.letter)).toEqual(['A', 'B', 'C']);
  });

  it('returns [] on error when no prior persona message has options', () => {
    const msgs = [
      { role: 'persona' as const, text: 'Tell me about your idea.' },
      { role: 'user' as const, text: 'It is a social app' },
    ];
    expect(chatOptions(msgs, { ...ok, hasError: true })).toEqual([]);
  });

  it('returns [] for an empty conversation', () => {
    expect(chatOptions([], ok)).toEqual([]);
    expect(chatOptions([], { ...ok, hasError: true })).toEqual([]);
  });
});
