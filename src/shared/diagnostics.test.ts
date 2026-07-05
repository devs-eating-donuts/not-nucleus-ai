import { describe, expect, it } from 'vitest';
import {
  OUTPUT_TAIL_CAP,
  PROMPT_FIRST_LINE_CAP,
  isAuthError,
  isTransientCliError,
  outputTail,
  promptFirstLine,
  redactPromptArg,
} from './diagnostics';

describe('redactPromptArg', () => {
  it('replaces an arg equal to the prompt with a length placeholder (arg-delivery CLIs)', () => {
    const prompt = 'Build the contact form\nwith Turnstile';
    expect(redactPromptArg(['-p', prompt, '--allow-all-tools'], prompt)).toEqual([
      '-p',
      `<prompt:${prompt.length}c>`,
      '--allow-all-tools',
    ]);
  });

  it('leaves argv untouched when the prompt is not in it (stdin-delivery CLIs)', () => {
    const args = ['exec', '--skip-git-repo-check'];
    expect(redactPromptArg(args, 'a prompt that is on stdin, not argv')).toEqual(args);
  });

  it('redacts every occurrence and never leaks the prompt text', () => {
    const prompt = 'secret-looking content';
    const out = redactPromptArg(['-p', prompt, '-x', prompt], prompt);
    expect(out.join(' ')).not.toContain(prompt);
    expect(out).toEqual(['-p', `<prompt:${prompt.length}c>`, '-x', `<prompt:${prompt.length}c>`]);
  });

  it('does nothing for an empty prompt (no spurious redaction of empty args)', () => {
    expect(redactPromptArg(['-p', ''], '')).toEqual(['-p', '']);
  });
});

describe('promptFirstLine', () => {
  it('returns the trimmed first line only', () => {
    expect(promptFirstLine('  Hello there \nsecond line\nthird')).toBe('Hello there');
  });

  it('caps an overlong first line with an ellipsis', () => {
    const long = 'x'.repeat(PROMPT_FIRST_LINE_CAP + 50);
    const out = promptFirstLine(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBe(PROMPT_FIRST_LINE_CAP + 1);
  });

  it('handles an empty prompt', () => {
    expect(promptFirstLine('')).toBe('');
  });
});

describe('outputTail', () => {
  it('keeps the trailing chars (where QA verdicts / errors land), not the head', () => {
    const text = `${'a'.repeat(OUTPUT_TAIL_CAP)}VERDICT: PASS`;
    const tail = outputTail(text);
    expect(tail.length).toBe(OUTPUT_TAIL_CAP);
    expect(tail.endsWith('VERDICT: PASS')).toBe(true);
  });

  it('returns short output unchanged', () => {
    expect(outputTail('short')).toBe('short');
  });
});

describe('isTransientCliError (E1)', () => {
  it('flags provider-congestion + network signals (case-insensitive)', () => {
    expect(isTransientCliError('API Error: Overloaded')).toBe(true);
    expect(isTransientCliError('HTTP 529 from the provider')).toBe(true);
    expect(isTransientCliError('429 Too Many Requests — rate limit exceeded')).toBe(true);
    expect(isTransientCliError('read ECONNRESET')).toBe(true);
    expect(isTransientCliError('503 Service Unavailable')).toBe(true);
    expect(isTransientCliError('socket hang up')).toBe(true);
  });

  it('does NOT flag genuine failures that need human action', () => {
    expect(isTransientCliError('Authentication failed — run `copilot /login`')).toBe(false);
    expect(isTransientCliError('SyntaxError: unexpected token')).toBe(false);
    expect(isTransientCliError('VERDICT: FAIL')).toBe(false);
    expect(isTransientCliError('')).toBe(false);
    expect(isTransientCliError(null)).toBe(false);
    expect(isTransientCliError(undefined)).toBe(false);
  });
});

describe('isAuthError (auth-death recovery)', () => {
  it('flags signed-out / expired-token failures (case-insensitive)', () => {
    expect(isAuthError('Error: Not logged in. Please run `claude login`.')).toBe(true);
    expect(isAuthError('Authentication failed — run `copilot /login`')).toBe(true);
    expect(isAuthError('HTTP 401 Unauthorized')).toBe(true);
    expect(isAuthError('Your session expired, please sign in again')).toBe(true);
    expect(isAuthError('invalid API key')).toBe(true);
    expect(isAuthError('You are not signed in')).toBe(true);
  });

  it('does NOT flag ordinary failures, transient blips, or empty text', () => {
    // An overload/network blip is transient, not auth.
    expect(isAuthError('API Error: Overloaded')).toBe(false);
    expect(isAuthError('read ECONNRESET')).toBe(false);
    expect(isAuthError('SyntaxError: unexpected token')).toBe(false);
    expect(isAuthError('VERDICT: FAIL')).toBe(false);
    expect(isAuthError('')).toBe(false);
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });
});
