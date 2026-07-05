import { describe, expect, it } from 'vitest';
import {
  buildInterventionPrompt,
  formatInterventionContext,
  type InterventionContext,
} from './intervention';

const ctx: InterventionContext = {
  taskId: 'task-017',
  title: 'Wire Supabase JWT secret',
  goal: 'The API verifies Supabase JWTs.',
  status: 'human-needed',
  acceptanceCriteria: [
    { id: 'AC1', text: 'Requests with a valid JWT are accepted.' },
    { id: 'AC2', text: 'docker compose up starts cleanly.' },
  ],
  reviewLabel: 'What QA last reported (tail of reviews/qa-review.md)',
  reviewTail: 'AC2: gap — SUPABASE_JWT_SECRET unset, compose fails.',
};

describe('intervention context + prompt', () => {
  it('formatInterventionContext includes the task, every [ACn], and the QA tail', () => {
    const block = formatInterventionContext(ctx);
    expect(block).toContain('task-017 — Wire Supabase JWT secret');
    expect(block).toContain('Goal: The API verifies Supabase JWTs.');
    expect(block).toContain('Current status: human-needed');
    expect(block).toContain('[AC1] Requests with a valid JWT are accepted.');
    expect(block).toContain('[AC2] docker compose up starts cleanly.');
    expect(block).toContain('SUPABASE_JWT_SECRET unset');
  });

  it('formatInterventionContext degrades gracefully with no ACs / no review', () => {
    const block = formatInterventionContext({
      ...ctx,
      goal: '',
      acceptanceCriteria: [],
      reviewTail: '',
    });
    expect(block).toContain('(none recorded)');
    expect(block).toContain('(nothing recorded yet)');
    expect(block).not.toContain('Goal:'); // omitted when empty
  });

  it('buildInterventionPrompt assembles persona + context + transcript, voice first', () => {
    const prompt = buildInterventionPrompt({
      persona: 'You are Big Head.',
      principles: '\n\n[principles]',
      context: ctx,
      references: '',
      pitfalls: '',
      voice: '[JIAN]',
      messages: [
        { role: 'user', text: 'what does QA need?' },
        { role: 'persona', text: 'AC2 fails.' },
        { role: 'user', text: 'how do I fix it?' },
      ],
    });
    expect(prompt.startsWith('[JIAN]You are Big Head.')).toBe(true);
    expect(prompt).toContain('[principles]');
    expect(prompt).toContain('ESCALATED TASK YOU ARE HELPING UNBLOCK');
    // transcript labels: user -> Founder, persona -> You
    expect(prompt).toContain('Founder: what does QA need?');
    expect(prompt).toContain('You: AC2 fails.');
    expect(prompt.trimEnd().endsWith('Reply with your next message only, in character.')).toBe(true);
  });

  it('buildInterventionPrompt is byte-identical with empty voice/references/pitfalls aside from those slots', () => {
    const base = {
      persona: 'P',
      principles: '',
      context: ctx,
      references: '',
      pitfalls: '',
      messages: [{ role: 'user' as const, text: 'hi' }],
    };
    const plain = buildInterventionPrompt({ ...base, voice: '' });
    const withVoice = buildInterventionPrompt({ ...base, voice: 'V' });
    expect(withVoice).toBe('V' + plain);
  });
});
