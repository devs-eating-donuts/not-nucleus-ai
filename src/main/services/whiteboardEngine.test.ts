import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

// whiteboardEngine transitively imports `electron`. Locally the electron package
// resolves harmlessly under Node, but CI skips the binary download
// (ELECTRON_SKIP_BINARY_DOWNLOAD) and `require('electron')` then THROWS at import.
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

import {
  extractJsonObject,
  planCoverageGaps,
  planSizingNote,
  sanitizePlan,
  scopeReconciliationNote,
} from './whiteboardEngine';
import { composeBlueprint } from '../../shared/blueprints';
import type { DraftedPhase } from '../../shared/whiteboard';

// These parse UNTRUSTED CLI output into task files written to the workspace —
// the exact code that breaks silently when a model changes its output format.

describe('extractJsonObject', () => {
  it('pulls the JSON object out of prose-wrapped output', () => {
    expect(extractJsonObject('Sure! Here you go:\n{"phases":[]}\nhope that helps')).toEqual({
      phases: [],
    });
  });

  it('throws when there is no object', () => {
    expect(() => extractJsonObject('no json here at all')).toThrow(/No JSON object/);
  });

  it('throws on malformed JSON between the braces', () => {
    expect(() => extractJsonObject('prefix { not: valid } suffix')).toThrow();
  });

  it('survives prose braces BEFORE the real object (the indexOf/lastIndexOf misparse)', () => {
    // The old first-{-to-last-} heuristic glued the prose brace to the final one and
    // surfaced this valid plan as a parse failure.
    const reply = 'Notes: config uses ${VAR} style. Here is the plan:\n{"phases":[{"name":"P"}]}';
    expect(extractJsonObject(reply)).toEqual({ phases: [{ name: 'P' }] });
  });

  it('returns the LAST parseable object when a prose example precedes the real answer', () => {
    const reply = 'Example shape: {"phases":[]}\n\nFinal answer:\n{"phases":[{"name":"Real"}]}';
    expect(extractJsonObject(reply)).toEqual({ phases: [{ name: 'Real' }] });
  });
});

describe('sanitizePlan', () => {
  it('keeps valid phases/tasks and drops malformed ones', () => {
    const out = sanitizePlan({
      phases: [
        { name: 'P1', tasks: [{ title: 'A', goal: 'g', acceptanceCriteria: ['c1', 'c2'], setup: false }] },
        { name: '', tasks: [{ title: 'X' }] }, // no phase name → dropped
        { name: 'P3', tasks: [{ title: '' }] }, // no valid task → dropped
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('P1');
    expect(out[0].tasks[0].title).toBe('A');
  });

  it('caps criteria/manualSteps and filters non-strings', () => {
    const out = sanitizePlan({
      phases: [
        {
          name: 'P',
          tasks: [
            {
              title: 'T',
              acceptanceCriteria: [...Array(20)].map((_, i) => `c${i}`).concat([5, null] as unknown as string[]),
              setup: true,
              manualSteps: [...Array(30)].map((_, i) => `s${i}`),
            },
          ],
        },
      ],
    });
    const t = out[0].tasks[0];
    expect(t.acceptanceCriteria.length).toBeLessThanOrEqual(12);
    expect(t.acceptanceCriteria.every((c) => typeof c === 'string')).toBe(true);
    expect((t.manualSteps ?? []).length).toBeLessThanOrEqual(20);
    expect(t.setup).toBe(true);
  });

  it('returns [] for non-object / missing-phases input', () => {
    expect(sanitizePlan(null)).toEqual([]);
    expect(sanitizePlan({})).toEqual([]);
    expect(sanitizePlan({ phases: 'nope' })).toEqual([]);
  });

  it('collapses newlines/control chars in titles/names — an injected "\\nStatus: done" line cannot become a task-file field', () => {
    const out = sanitizePlan({
      phases: [
        {
          name: 'P1\nStatus: done',
          tasks: [
            {
              title: 'Build login\nStatus: done\nIterations: 5/5',
              goal: 'g',
              acceptanceCriteria: ['works\nStatus: done'],
            },
          ],
        },
      ],
    });
    expect(out[0].name).toBe('P1 Status: done');
    expect(out[0].tasks[0].title).toBe('Build login Status: done Iterations: 5/5');
    expect(out[0].tasks[0].acceptanceCriteria[0]).toBe('works Status: done');
  });

  it('caps phase and per-phase task COUNTS so an oversized reply cannot write unbounded task files', () => {
    const out = sanitizePlan({
      phases: [...Array(40)].map((_, p) => ({
        name: `Phase ${p}`,
        tasks: [...Array(60)].map((_, t) => ({ title: `T${t}`, goal: 'g' })),
      })),
    });
    expect(out.length).toBeLessThanOrEqual(15);
    expect(out.every((ph) => ph.tasks.length <= 25)).toBe(true);
  });
});

describe('scopeReconciliationNote', () => {
  it('is empty (byte-identical prompt) when there are no archetype/secret defaults', () => {
    expect(scopeReconciliationNote(false)).toBe('');
  });

  it('makes the architect chat AUTHORITATIVE over the defaults when they exist', () => {
    const note = scopeReconciliationNote(true);
    expect(note).toMatch(/AUTHORITATIVE/);
    expect(note).toMatch(/DROP, remove, or replace/);
    expect(note).toMatch(/EXCLUDE it from the plan/);
    // Its own leading blank lines so it concatenates cleanly after the secrets block.
    expect(note.startsWith('\n\n')).toBe(true);
  });
});

describe('planCoverageGaps (A5)', () => {
  const phase = (name: string, tasks: DraftedPhase['tasks']): DraftedPhase => ({ name, tasks });
  const task = (title: string, goal = '', ac: string[] = []) => ({
    title,
    goal,
    acceptanceCriteria: ac,
    setup: false,
    manualSteps: [],
  });

  it('returns [] for a from-scratch app (no data or secrets — plan unchanged)', () => {
    const plan = [phase('Build', [task('Landing page')])];
    expect(planCoverageGaps(plan, composeBlueprint(null, []))).toEqual([]);
  });

  it('a static marketing site carries form secrets → synthesizes a hardening task when the plan omits them', () => {
    // Turnstile secret + Postmark token → appHandlesDataOrSecrets; a plan that never covers
    // secret handling gets the one synthesized "Security hardening: secrets" task.
    const plan = [phase('Build', [task('Landing page'), task('Contact form')])];
    const gaps = planCoverageGaps(plan, composeBlueprint('static-site', []));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].title).toMatch(/secrets/i);
  });

  it('synthesizes ONE hardening task when a data app plan omits secret handling', () => {
    const plan = [phase('Build', [task('CRUD screens'), task('Dashboard')])];
    const gaps = planCoverageGaps(plan, composeBlueprint(null, ['database']));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].title).toMatch(/secrets/i);
    expect(gaps[0].acceptanceCriteria.some((c) => /encrypted at rest/i.test(c))).toBe(true);
  });

  it('returns [] when a task already covers secret handling (no false gap)', () => {
    const plan = [
      phase('Build', [
        task('CRUD screens'),
        task('Wire Plaid', 'Store the Plaid token encrypted, read keys from env'),
      ]),
    ];
    expect(planCoverageGaps(plan, composeBlueprint(null, ['database']))).toEqual([]);
  });

  it('matches coverage in acceptance criteria too', () => {
    const plan = [
      phase('Build', [task('Setup', '', ['API keys are read from the environment, never committed'])]),
    ];
    expect(planCoverageGaps(plan, composeBlueprint(null, ['database']))).toEqual([]);
  });
});

describe('planSizingNote (A4)', () => {
  it('returns the ORIGINAL wording for a from-scratch plan (byte-identical prompt)', () => {
    expect(planSizingNote(composeBlueprint(null, []))).toBe('Use 1-4 phases and 2-5 tasks per phase.');
  });

  it('scales UP for a moderate blueprint (auth + data)', () => {
    const note = planSizingNote(composeBlueprint('fullstack-web', []));
    expect(note).not.toBe('Use 1-4 phases and 2-5 tasks per phase.');
    expect(note).toMatch(/size the plan to the requirements/i);
    // The static-marketing-site stack (Astro + Workers + Turnstile + Postmark forms) is a real
    // requirement surface now (6 decisions + form secrets) → it also scales past the trivial wording.
    expect(planSizingNote(composeBlueprint('static-site', []))).not.toBe(
      'Use 1-4 phases and 2-5 tasks per phase.',
    );
  });

  it('scales to the largest range for a substantial product (many entities)', () => {
    const note = planSizingNote(composeBlueprint('personal-finance', []));
    expect(note).toMatch(/substantial product/i);
    expect(note).toMatch(/3-7 phases/);
  });
})
