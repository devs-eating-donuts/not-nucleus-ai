/**
 * Diagnostics model for the CLI-invocation log. Every CLI call in the app goes
 * through `invokeCli` (the one choke point), which appends a sanitized record to a
 * rotated JSONL under userData/logs/. The renderer reads recent records back for a
 * read-only "recent CLI activity" panel in The Garage. This file is the shared
 * contract — it must stay free of Node/Electron imports (the renderer imports it),
 * so it carries TYPES plus PURE helpers only; the file I/O lives in the main-process
 * `invocationLog` service, and the prompt hash is computed there (crypto is Node-only).
 */

/** Where in the lifecycle a CLI call originated — identifies the seam in the log. */
export type InvocationSurface =
  | 'room'
  | 'work-request'
  | 'whiteboard'
  | 'bullpen'
  | 'intervention'
  | 'pitch'
  | 'cli-test'
  | 'unknown';

/** How an invocation ended. `timeout` is a killed-by-budget run. */
export type InvocationOutcome = 'ok' | 'error' | 'timeout';

/** One CLI invocation, as persisted to the JSONL log and read back by The Garage. */
export interface InvocationLogRecord {
  /** ISO timestamp when the record was written (run settled). */
  timestamp: string;
  surface: InvocationSurface;
  /** Lifecycle role that made the call, when known. */
  role: string | null;
  /** Project id, when the call is project-scoped (omitted for cli-test etc.). */
  projectId: string | null;
  /** Display name of the CLI (e.g. "Claude CLI"); '' when no CLI was assigned. */
  cliName: string;
  /** Resolved executable or the configured command — never a shell string. */
  command: string;
  /** Argv with the untrusted prompt arg redacted; flags only, never secrets/env. */
  args: string[];
  /** Working directory the child ran in. */
  cwd: string;
  /** The timeout budget in effect (ms) — the binding constraint on long thinking. */
  timeoutMs: number;
  /** Configured thinking/reasoning level in effect, or null when unset/'default'. */
  thinkingLevel: string | null;
  /** Prompt size in characters — the prompt itself is NEVER logged. */
  promptChars: number;
  /** Short hash of the prompt, so identical prompts are correlatable without storing them. */
  promptHash: string;
  /** First line of the prompt (capped) — a human-readable hint, not the full text. */
  promptFirstLine: string;
  durationMs: number;
  outcome: InvocationOutcome;
  /** Process exit code when available; null for timeouts / pre-spawn refusals. */
  exitCode: number | null;
  /** Failure message, or null on success. */
  error: string | null;
  /** Tail of stdout/stderr (~2KB), the diagnostic fallback when a run misbehaves. */
  outputTail: string;
}

/** Cap for the prompt's first-line hint in the log (keeps records compact). */
export const PROMPT_FIRST_LINE_CAP = 200;
/** Cap for the captured stdout/stderr tail in the log. */
export const OUTPUT_TAIL_CAP = 2048;

/**
 * Redact the untrusted prompt from an argv before logging. Most CLIs take the
 * prompt on stdin (it never appears in argv), but arg-delivery CLIs (Copilot, agy)
 * put the whole prompt in argv — replace any arg equal to the prompt with a
 * `<prompt:Nc>` placeholder so the log keeps the flags but never the content. Pure.
 */
export function redactPromptArg(args: string[], prompt: string): string[] {
  if (prompt === '') {
    return [...args];
  }
  return args.map((a) => (a === prompt ? `<prompt:${prompt.length}c>` : a));
}

/** First line of a prompt, trimmed and capped — a hint for the log, never the full text. Pure. */
export function promptFirstLine(prompt: string): string {
  const firstLine = prompt.split('\n', 1)[0]?.trim() ?? '';
  return firstLine.length > PROMPT_FIRST_LINE_CAP
    ? `${firstLine.slice(0, PROMPT_FIRST_LINE_CAP)}…`
    : firstLine;
}

/** Keep only the trailing OUTPUT_TAIL_CAP chars of captured output. Pure. */
export function outputTail(output: string): string {
  return output.length > OUTPUT_TAIL_CAP ? output.slice(output.length - OUTPUT_TAIL_CAP) : output;
}

// E1 — signals in a CLI's failure output that indicate a TRANSIENT, retry-worthy
// condition (provider congestion / network flap), as opposed to a genuine failure that
// needs human action (auth, config, a real bug). Deliberately narrow: an auth/permission
// failure is NOT here — retrying a dead token just wastes minutes; a bare resume handles a
// transient auth blip. Timeouts are NOT here either — retrying doubles an already-long wait.
const TRANSIENT_ERROR_SIGNALS = [
  'overloaded',
  '529',
  '503',
  '502',
  '500 internal',
  'internal server error',
  'service unavailable',
  'temporarily unavailable',
  'rate limit',
  'rate-limit',
  'rate_limit',
  'ratelimit',
  '429',
  'too many requests',
  'econnreset',
  'etimedout',
  'econnrefused',
  'eai_again',
  'socket hang up',
  'connection reset',
  'connection refused',
  'network error',
  'try again',
];

/**
 * Whether a CLI failure's output/error text looks like a transient, retry-worthy provider
 * or network hiccup (Overloaded 529, rate limit, connection reset) rather than a genuine
 * failure. Pure + case-insensitive; used by invokeCli to auto-retry with backoff before
 * escalating an unattended build to a human (e.g. a transient "Overloaded" response).
 */
export function isTransientCliError(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return TRANSIENT_ERROR_SIGNALS.some((s) => lower.includes(s));
}

// Signals that a CLI failed because it is SIGNED OUT / its token expired — a genuine
// (non-transient) failure whose fix is re-authentication, not a retry. Retrying a dead
// token just fails the same way and burns minutes on an unattended build, so the escalation
// must point the founder at the login surface. Deliberately specific phrases (these run only
// on a CLI FAILURE's text): auth-failure wording + 401/403, not bare "auth"/"expired"/"key".
const AUTH_ERROR_SIGNALS = [
  'not logged in',
  'not authenticated',
  'unauthenticated',
  'not signed in',
  'please log in',
  'please login',
  'please sign in',
  'login required',
  'log in to continue',
  'sign in to continue',
  'authentication required',
  'authentication failed',
  'authentication error',
  'auth failed',
  'unauthorized',
  '401',
  '403 forbidden',
  'invalid api key',
  'incorrect api key',
  'no api key',
  'missing api key',
  'api key is required',
  'session expired',
  'token expired',
  'token has expired',
  'expired token',
  'credentials expired',
  're-authenticate',
  'reauthenticate',
  'sign in again',
  'log in again',
  'run `claude login`',
  'claude login',
  'codex login',
  'run login',
];

/**
 * Whether a CLI failure looks like an AUTH problem (signed out / expired token) rather than a
 * bug — so the build's escalation can tell the founder to re-authenticate instead of leaving
 * them to retry a dead token. Pure + case-insensitive. A slightly-inclusive match is safe: the
 * effect is only a clearer escalation hint (the raw error is still shown).
 */
export function isAuthError(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return AUTH_ERROR_SIGNALS.some((s) => lower.includes(s));
}
