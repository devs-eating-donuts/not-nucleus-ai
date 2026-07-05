import { describe, expect, it } from 'vitest';
import {
  fingerprintOf,
  heuristicLesson,
  rankLessonsForInjection,
  renderPitfallsBlock,
  techTagsFor,
  type Lesson,
  type LessonObservation,
} from './lessons';

const obs = (over: Partial<LessonObservation> = {}): LessonObservation => ({
  signal: 'qa-gap',
  archetype: 'saas',
  stack: ['Next.js', 'PostgreSQL (db)'],
  roleId: 'developer',
  normalizedKey: 'AC2',
  projectId: 'proj-a',
  ...over,
});

const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: 'lesson-1',
  fingerprint: 'fp',
  summary: 's',
  rule: 'Avoid leaving AC2 a gap.',
  signal: 'qa-gap',
  techTags: ['archetype:saas', 'role:developer'],
  occurrences: 3,
  status: 'confirmed',
  firstSeen: '2020-01-01T00:00:00.000Z',
  lastSeen: '2020-01-01T00:00:00.000Z',
  exampleProjectIds: [],
  ...over,
});

describe('techTagsFor', () => {
  it('slugifies archetype + stack + role and drops parentheticals', () => {
    expect(techTagsFor({ archetype: 'saas', stack: ['Next.js', 'PostgreSQL (db)'], roleId: 'developer' })).toEqual([
      'archetype:saas',
      'stack:next-js',
      'stack:postgresql',
      'role:developer',
    ]);
  });

  it('omits archetype when null and de-dups', () => {
    expect(techTagsFor({ archetype: null, stack: ['React', 'React'], roleId: 'qa' })).toEqual([
      'stack:react',
      'role:qa',
    ]);
  });
});

describe('fingerprintOf (dedup key)', () => {
  it('is stable for the same (signal, archetype, role, key)', () => {
    expect(fingerprintOf(obs())).toBe(fingerprintOf(obs()));
  });

  it('IGNORES stack — Decision 3 keeps it out of the key', () => {
    expect(fingerprintOf(obs({ stack: ['Astro'] }))).toBe(fingerprintOf(obs({ stack: ['Vue'] })));
  });

  it('normalizes the key so raw titles/ids collapse consistently', () => {
    expect(fingerprintOf(obs({ normalizedKey: 'AC2' }))).toBe(fingerprintOf(obs({ normalizedKey: ' ac2 ' })));
  });

  it('differs by signal, archetype, role, and key', () => {
    const base = fingerprintOf(obs());
    expect(fingerprintOf(obs({ signal: 'dev-crash' }))).not.toBe(base);
    expect(fingerprintOf(obs({ archetype: 'static-site' }))).not.toBe(base);
    expect(fingerprintOf(obs({ roleId: 'qa' }))).not.toBe(base);
    expect(fingerprintOf(obs({ normalizedKey: 'AC3' }))).not.toBe(base);
  });

  it('returns 16 hex chars', () => {
    expect(fingerprintOf(obs())).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('heuristicLesson', () => {
  it('produces a developer-facing rule for a qa-gap', () => {
    const { summary, rule } = heuristicLesson(obs());
    expect(summary).toContain('AC2');
    expect(rule).toContain('AC2');
  });

  it('covers every signal with a non-empty rule', () => {
    for (const signal of ['iteration-cap-hit', 'dev-crash', 'qa-indeterminate', 'gate-failure'] as const) {
      expect(heuristicLesson(obs({ signal, normalizedKey: 'security' })).rule).not.toBe('');
    }
  });
});

describe('rankLessonsForInjection', () => {
  const tags = ['archetype:saas', 'stack:next-js', 'role:developer'];

  it('drops lessons with zero tag overlap (unrelated builds)', () => {
    const unrelated = lesson({ id: 'lesson-x', techTags: ['archetype:static-site', 'role:qa'] });
    expect(rankLessonsForInjection([unrelated], tags, 'developer')).toEqual([]);
  });

  it('prefers a role match over a higher raw overlap', () => {
    const roleMatch = lesson({ id: 'role', techTags: ['archetype:saas', 'role:developer'] });
    const moreOverlapNoRole = lesson({
      id: 'noRole',
      techTags: ['archetype:saas', 'stack:next-js', 'role:qa'],
    });
    const out = rankLessonsForInjection([moreOverlapNoRole, roleMatch], tags, 'developer');
    expect(out[0].id).toBe('role');
  });

  it('caps at top-K', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      lesson({ id: `lesson-${i}`, techTags: ['archetype:saas', 'role:developer'], occurrences: i + 3 }),
    );
    expect(rankLessonsForInjection(many, tags, 'developer', { topK: 4 })).toHaveLength(4);
  });

  it('respects the char budget (keeps at least one)', () => {
    const big = lesson({ id: 'big', rule: 'x'.repeat(500), techTags: ['archetype:saas', 'role:developer'] });
    const out = rankLessonsForInjection([big, big, big], tags, 'developer', { charBudget: 600 });
    expect(out.length).toBe(1);
  });
});

describe('renderPitfallsBlock', () => {
  it("returns '' for no lessons", () => {
    expect(renderPitfallsBlock([], 'saas')).toBe('');
  });

  it('renders a labelled advisory list', () => {
    const block = renderPitfallsBlock([lesson(), lesson({ id: 'lesson-2', rule: 'Validate inputs.' })], 'saas');
    expect(block).toContain('Known pitfalls for saas');
    expect(block).toContain('learned across past builds');
    expect(block).toContain('- Avoid leaving AC2 a gap.');
    expect(block).toContain('- Validate inputs.');
  });
});
