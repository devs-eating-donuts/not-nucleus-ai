import type { ChatMessage } from './room';
import type { AcceptanceCriterion } from './taskfile';

/**
 * Intervention chat — a human-in-the-loop conversation with a build persona
 * (Phase 1: Big Head / QA) about a task the autonomous Bullpen escalated. Unlike
 * the design rooms (tmpdir, conversational), an intervention turn runs the seat's
 * CLI in the WORKSPACE cwd so the persona can inspect the real code. The context
 * below seeds the chat so the founder (and the persona) start from the stuck task
 * + its acceptance criteria + what QA last reported.
 */
export interface InterventionContext {
  taskId: string;
  title: string;
  goal: string;
  /** The task's current Status line (e.g. "human-needed", "blocked"). */
  status: string;
  acceptanceCriteria: AcceptanceCriterion[];
  /** Role-appropriate review label, e.g. "What QA last reported". */
  reviewLabel: string;
  /** Tail of the role's review file (qa-review / security-review). '' when none. */
  reviewTail: string;
}

export interface InterventionLoadResult {
  messages: ChatMessage[];
  /** null when the task file can't be read (e.g. id no longer exists). */
  context: InterventionContext | null;
}

/** The seeded task/criteria/QA block, rendered into the persona prompt. */
export function formatInterventionContext(c: InterventionContext): string {
  const acs =
    c.acceptanceCriteria.length > 0
      ? c.acceptanceCriteria.map((a) => `  - [${a.id}] ${a.text}`).join('\n')
      : '  (none recorded)';
  return [
    'ESCALATED TASK YOU ARE HELPING UNBLOCK:',
    `${c.taskId} — ${c.title}`,
    c.goal ? `Goal: ${c.goal}` : '',
    `Current status: ${c.status}`,
    '',
    'Acceptance criteria:',
    acs,
    '',
    `${c.reviewLabel}:`,
    '"""',
    c.reviewTail || '(nothing recorded yet)',
    '"""',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/**
 * Pure prompt assembly — persona voice + senior principles + the seeded task
 * context + references/pitfalls + the transcript. Kept pure (no IO) so it's
 * unit-tested; the engine supplies the async blocks.
 */
export function buildInterventionPrompt(opts: {
  persona: string;
  principles: string;
  context: InterventionContext;
  references: string;
  pitfalls: string;
  voice: string;
  messages: ChatMessage[];
}): string {
  const transcript = opts.messages
    .map((m) => `${m.role === 'user' ? 'Founder' : 'You'}: ${m.text}`)
    .join('\n');
  return (
    `${opts.voice}${opts.persona}${opts.principles}\n\n${formatInterventionContext(opts.context)}` +
    `${opts.references}${opts.pitfalls}\n\nConversation so far:\n${transcript}\n\n` +
    'Reply with your next message only, in character.'
  );
}
