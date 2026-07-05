import type { RoleId } from './roles';

/**
 * ESCALATIONS.md format (ESC-NNN records). When an
 * agent exhausts its iteration budget or cannot proceed, it appends an
 * escalation and stops — humans resolve, and resolutions stay on record.
 * Pure string handling; the main process owns I/O.
 */

export type EscalationReason =
  | 'iteration-cap-hit'
  | 'judgment-call'
  | 'blocked-dependency'
  | 'needs-credential'
  | 'other';

export type EscalationStatus = 'open' | 'resolved';

export interface EscalationInput {
  title: string;
  /** Role that raised it (or "engine" for the orchestrator itself). */
  from: RoleId | 'engine';
  /** Task id it concerns, when applicable. */
  task: string | null;
  reason: EscalationReason;
  context: string;
  tried: string;
  recommendation: string;
  createdAt: string;
}

export interface EscalationHeader {
  id: string;
  title: string;
  status: EscalationStatus | null;
}

const HEADING_PATTERN = /^##\s+(ESC-\d+)\s*[—–-]\s*(.+?)\s*$/gm;
const STATUS_PATTERN = /^[-*]\s+\*\*Status:\*\*\s*(\S+)/im;

/** Headers (id, title, status) for every escalation block, in order. */
export function parseEscalationHeaders(content: string): EscalationHeader[] {
  const matches = [...content.matchAll(HEADING_PATTERN)];
  return matches.map((match, index) => {
    const blockStart = (match.index ?? 0) + match[0].length;
    const blockEnd =
      index + 1 < matches.length ? (matches[index + 1].index ?? content.length) : content.length;
    const statusRaw = content
      .slice(blockStart, blockEnd)
      .match(STATUS_PATTERN)?.[1]
      ?.toLowerCase();
    const status: EscalationStatus | null =
      statusRaw === 'open' || statusRaw === 'resolved' ? statusRaw : null;
    return { id: match[1], title: match[2], status };
  });
}

/**
 * Mark every OPEN escalation whose Task field is `taskId` as resolved. Used when
 * a human resolves a task (Mark done) or re-queues it for QA, so the close/redo
 * starts from a clean ledger instead of leaving a stale "open" record behind.
 * Pure string handling; returns the content unchanged when nothing matches.
 */
export function markEscalationsResolved(content: string, taskId: string): string {
  const matches = [...content.matchAll(HEADING_PATTERN)];
  if (matches.length === 0) {
    return content;
  }
  let result = '';
  let cursor = 0;
  matches.forEach((match, index) => {
    const blockStart = match.index ?? 0;
    const blockEnd =
      index + 1 < matches.length ? (matches[index + 1].index ?? content.length) : content.length;
    // Preamble / prior block: keep verbatim.
    result += content.slice(cursor, blockStart);
    let block = content.slice(blockStart, blockEnd);
    const taskMatch = block.match(/^[-*]\s+\*\*Task:\*\*\s*(\S+)/im);
    if (taskMatch && taskMatch[1] === taskId) {
      block = block.replace(/^([-*]\s+\*\*Status:\*\*\s*)open\b/im, '$1resolved');
    }
    result += block;
    cursor = blockEnd;
  });
  result += content.slice(cursor);
  return result;
}

/**
 * Mark every OPEN escalation whose HEADING TITLE equals `title` as resolved. Used when a
 * review GATE (architecture / security / ops) completes on a later retry: gate escalations
 * aren't task-scoped (their Task field is the phase name, shared across all of a phase's
 * gates), so they're keyed off the gate-specific title (e.g. "Security review — Backend").
 * Resolving by title flips ONLY that gate's stale record, not the sibling gates on the same
 * phase. Pure string handling; returns the content unchanged when nothing matches.
 */
export function resolveEscalationsByTitle(content: string, title: string): string {
  const matches = [...content.matchAll(HEADING_PATTERN)];
  if (matches.length === 0) {
    return content;
  }
  let result = '';
  let cursor = 0;
  matches.forEach((match, index) => {
    const blockStart = match.index ?? 0;
    const blockEnd =
      index + 1 < matches.length ? (matches[index + 1].index ?? content.length) : content.length;
    result += content.slice(cursor, blockStart);
    let block = content.slice(blockStart, blockEnd);
    if (match[2] === title) {
      block = block.replace(/^([-*]\s+\*\*Status:\*\*\s*)open\b/im, '$1resolved');
    }
    result += block;
    cursor = blockEnd;
  });
  result += content.slice(cursor);
  return result;
}

export function nextEscalationId(content: string): string {
  let max = 0;
  for (const header of parseEscalationHeaders(content)) {
    const n = Number.parseInt(header.id.slice('ESC-'.length), 10);
    if (Number.isFinite(n) && n > max) {
      max = n;
    }
  }
  return `ESC-${String(max + 1).padStart(3, '0')}`;
}

/** Append a new escalation block; returns the updated content and its id. */
export function appendEscalation(
  content: string,
  input: EscalationInput,
): { content: string; id: string } {
  const id = nextEscalationId(content);
  const block = [
    `## ${id} — ${input.title}`,
    '',
    `- **Created:** ${input.createdAt}`,
    `- **From:** ${input.from}`,
    `- **Task:** ${input.task ?? 'none'}`,
    `- **Reason:** ${input.reason}`,
    `- **Status:** open`,
    '',
    '### Context',
    '',
    input.context,
    '',
    '### What was tried',
    '',
    input.tried,
    '',
    '### Recommended action',
    '',
    input.recommendation,
    '',
  ].join('\n');
  return { content: `${content.trimEnd()}\n\n${block}`, id };
}
