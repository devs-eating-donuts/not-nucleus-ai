import { describe, expect, it } from 'vitest';
import {
  appendEscalation,
  markEscalationsResolved,
  nextEscalationId,
  parseEscalationHeaders,
  resolveEscalationsByTitle,
} from './escalations';

const input = {
  title: 'task-001 — Bootstrap',
  from: 'engine' as const,
  task: 'task-001',
  reason: 'needs-credential' as const,
  context: 'Needs hands-on setup.',
  tried: 'Not attempted.',
  recommendation: 'Do it yourself.',
  createdAt: '2020-01-01T00:00:00.000Z',
};

describe('escalations', () => {
  it('assigns ESC-001 to the first escalation', () => {
    const { content, id } = appendEscalation('# Escalations\n', input);
    expect(id).toBe('ESC-001');
    expect(content).toMatch(/## ESC-001 — task-001 — Bootstrap/);
    expect(content).toMatch(/\*\*Status:\*\* open/);
    expect(content).toMatch(/needs-credential/);
  });

  it('increments the id for each subsequent escalation', () => {
    const first = appendEscalation('# Escalations\n', input).content;
    const second = appendEscalation(first, { ...input, title: 'task-002 — Next' });
    expect(second.id).toBe('ESC-002');
    const headers = parseEscalationHeaders(second.content);
    expect(headers.map((h) => h.id)).toEqual(['ESC-001', 'ESC-002']);
    expect(headers.every((h) => h.status === 'open')).toBe(true);
  });

  it('nextEscalationId reads the max existing id', () => {
    const c = appendEscalation(appendEscalation('# Escalations\n', input).content, input).content;
    expect(nextEscalationId(c)).toBe('ESC-003');
  });

  describe('markEscalationsResolved', () => {
    it('flips only the matching task’s open escalation to resolved', () => {
      const first = appendEscalation('# Escalations\n', input).content; // task-001
      const both = appendEscalation(first, { ...input, title: 'task-002 — Next', task: 'task-002' })
        .content;
      const resolved = markEscalationsResolved(both, 'task-002');
      const headers = parseEscalationHeaders(resolved);
      expect(headers.find((h) => h.title.includes('task-001'))?.status).toBe('open');
      expect(headers.find((h) => h.title.includes('task-002'))?.status).toBe('resolved');
    });

    it('is a no-op when no escalation matches the task', () => {
      const c = appendEscalation('# Escalations\n', input).content;
      expect(markEscalationsResolved(c, 'task-999')).toBe(c);
    });

    it('resolves every open escalation for the same task', () => {
      const a = appendEscalation('# Escalations\n', input).content;
      const b = appendEscalation(a, input).content; // second escalation, same task-001
      const resolved = markEscalationsResolved(b, 'task-001');
      expect(parseEscalationHeaders(resolved).every((h) => h.status === 'resolved')).toBe(true);
    });
  });

  // Gate-escalation auto-resolve — gate records share a phase-name Task field, so they must
  // resolve by their gate-specific TITLE, not by task (else one passing gate would resolve a
  // still-open sibling gate on the same phase).
  describe('resolveEscalationsByTitle', () => {
    const gate = (title: string) => ({ ...input, title, task: 'Backend', from: 'engine' as const });

    it('flips only the gate with the matching title, not a sibling gate on the same phase', () => {
      const sec = appendEscalation('# Escalations\n', gate('Security review — Backend')).content;
      const both = appendEscalation(sec, gate('Architecture review — Backend')).content;
      const resolved = resolveEscalationsByTitle(both, 'Security review — Backend');
      const headers = parseEscalationHeaders(resolved);
      expect(headers.find((h) => h.title.includes('Security review'))?.status).toBe('resolved');
      // The architecture gate for the SAME phase stays open.
      expect(headers.find((h) => h.title.includes('Architecture review'))?.status).toBe('open');
    });

    it('is a no-op when no escalation title matches', () => {
      const c = appendEscalation('# Escalations\n', gate('Security review — Backend')).content;
      expect(resolveEscalationsByTitle(c, 'Security review — Frontend')).toBe(c);
    });
  });
});
