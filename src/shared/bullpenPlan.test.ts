import { describe, expect, it } from 'vitest';
import {
  activePhaseOf,
  bullpenCommitMessage,
  cliErrorEscalationText,
  combineQaVerdict,
  combineGateAndQaVerdict,
  decideNextAction,
  clusterFindings,
  sortClustersBySeverity,
  emptyPhaseProgress,
  findingCitation,
  findingFingerprint,
  gateOutcome,
  reviewIndeterminate,
  isPhaseComplete,
  isPhaseProgressStale,
  mergeFindings,
  parseCriterionVerdicts,
  parseSecurityFindings,
  phaseOrderOf,
} from './bullpenPlan';
import type { NextAction, PhaseProgress, PhaseProgressMap, PlanTask, StepCommitInfo } from './bullpenPlan';

describe('QA per-criterion verdicts', () => {
  it('parses ACn verdicts from varied phrasings', () => {
    const out = [
      'AC1: covered',
      '- AC2 — gap',
      'AC3 n/a',
      'AC4: not applicable',
      'noise line',
      'VERDICT: PASS',
    ].join('\n');
    expect(parseCriterionVerdicts(out)).toEqual({
      AC1: 'covered', AC2: 'gap', AC3: 'n-a', AC4: 'n-a',
    });
  });
  it('any gap forces a fail even on an overall PASS', () => {
    expect(combineQaVerdict('pass', { AC1: 'covered', AC2: 'gap' })).toEqual({
      verdict: 'fail', gaps: ['AC2'],
    });
  });
  it('falls back to the overall verdict with no per-criterion data', () => {
    expect(combineQaVerdict('pass', {})).toEqual({ verdict: 'pass', gaps: [] });
    expect(combineQaVerdict('indeterminate', {})).toEqual({ verdict: 'indeterminate', gaps: [] });
  });
  it('passes when every criterion is covered or n-a', () => {
    expect(combineQaVerdict('pass', { AC1: 'covered', AC2: 'n-a' })).toEqual({
      verdict: 'pass', gaps: [],
    });
  });
});

describe('combineGateAndQaVerdict (C1)', () => {
  const noGates = { ranAny: false, allRequiredPassed: true };
  const gatesGreen = { ranAny: true, allRequiredPassed: true };
  const gatesRed = { ranAny: true, allRequiredPassed: false };

  it('no gates ran → byte-identical to combineQaVerdict (today’s behavior)', () => {
    expect(combineGateAndQaVerdict(noGates, 'pass', {})).toEqual({
      verdict: 'pass', gaps: [], gatesFailed: false, gatesGreen: false,
    });
    expect(combineGateAndQaVerdict(noGates, 'indeterminate', {})).toEqual({
      verdict: 'indeterminate', gaps: [], gatesFailed: false, gatesGreen: false,
    });
  });

  it('a required gate failure forces a FAIL regardless of the model verdict', () => {
    // Even if the model claimed PASS, a red objective floor wins (short-circuit signal).
    expect(combineGateAndQaVerdict(gatesRed, 'pass', {})).toEqual({
      verdict: 'fail', gaps: [], gatesFailed: true, gatesGreen: false,
    });
  });

  it('green gates + model pass → pass, flagged gatesGreen', () => {
    expect(combineGateAndQaVerdict(gatesGreen, 'pass', { AC1: 'covered' })).toEqual({
      verdict: 'pass', gaps: [], gatesFailed: false, gatesGreen: true,
    });
  });

  it('green gates + model indeterminate → indeterminate, gatesGreen (calmer escalation)', () => {
    expect(combineGateAndQaVerdict(gatesGreen, 'indeterminate', {})).toEqual({
      verdict: 'indeterminate', gaps: [], gatesFailed: false, gatesGreen: true,
    });
  });

  it('green gates still let a semantic gap fail the task', () => {
    expect(combineGateAndQaVerdict(gatesGreen, 'pass', { AC1: 'gap' })).toEqual({
      verdict: 'fail', gaps: ['AC1'], gatesFailed: false, gatesGreen: true,
    });
  });
});

describe('parseSecurityFindings', () => {
  it('parses FINDING lines with varied brackets and separators', () => {
    const out = [
      'Reviewed the auth flow. The usual incompetence.',
      'FINDING [critical]: SQL injection in the login query',
      '- FINDING [high] — session token stored in localStorage',
      'FINDING (high): missing CSRF token on the contact form',
      'VERDICT: whatever',
    ].join('\n');
    expect(parseSecurityFindings(out)).toEqual([
      { severity: 'critical', description: 'SQL injection in the login query' },
      { severity: 'high', description: 'session token stored in localStorage' },
      { severity: 'high', description: 'missing CSRF token on the contact form' },
    ]);
  });

  it('ignores free-prose mentions of severity — only FINDING lines count', () => {
    const out = 'This is a critical part of the system, but it is fine.\nNothing to report.';
    expect(parseSecurityFindings(out)).toEqual([]);
  });

  it('parses medium/low findings too (every severity now becomes a fix task)', () => {
    const out = 'FINDING [medium]: verbose error messages\nFINDING [low]: missing security headers';
    expect(parseSecurityFindings(out)).toEqual([
      { severity: 'medium', description: 'verbose error messages' },
      { severity: 'low', description: 'missing security headers' },
    ]);
  });

  it('does not parse an informational severity — only critical/high/medium/low (so info → no task)', () => {
    expect(parseSecurityFindings('FINDING [info]: just an FYI, no fix needed')).toEqual([]);
  });

  it('skips a FINDING line with an empty description', () => {
    expect(parseSecurityFindings('FINDING [high]:')).toEqual([]);
  });

  it('keeps an appended file:line evidence pointer in the description', () => {
    const out = [
      'FINDING [high]: session token stored in localStorage — src/auth.ts:42',
      'FINDING [medium]: missing rate limit on /login — server/routes/auth.ts:88',
    ].join('\n');
    expect(parseSecurityFindings(out)).toEqual([
      { severity: 'high', description: 'session token stored in localStorage — src/auth.ts:42' },
      { severity: 'medium', description: 'missing rate limit on /login — server/routes/auth.ts:88' },
    ]);
  });

  it('parses the (requires-design) tag (B4); an ordinary finding stays untagged', () => {
    const out = [
      'FINDING [high] (requires-design): no real auth provider / issuer exists — src/auth.ts:1',
      'FINDING [medium]: missing rate limit — src/routes.ts:5',
    ].join('\n');
    expect(parseSecurityFindings(out)).toEqual([
      {
        severity: 'high',
        description: 'no real auth provider / issuer exists — src/auth.ts:1',
        requiresDesign: true,
      },
      { severity: 'medium', description: 'missing rate limit — src/routes.ts:5' }, // no requiresDesign key
    ]);
  });

  it('parses the impact-type tags (R1); untagged has no impact key', () => {
    const out = [
      'FINDING [critical] (defect): player throws on malformed URL — src/player.tsx:12',
      'FINDING [high] (hardening): no CSP headers configured — public/_headers:1',
      'FINDING [medium] (refactor): two sources of truth for the palette — tailwind.config.ts:3',
      'FINDING [low] (docs): docs/architecture.md is an empty template — docs/architecture.md:1',
      'FINDING [medium]: untagged finding stays plain — src/x.ts:9',
    ].join('\n');
    expect(parseSecurityFindings(out)).toEqual([
      { severity: 'critical', description: 'player throws on malformed URL — src/player.tsx:12', impact: 'defect' },
      { severity: 'high', description: 'no CSP headers configured — public/_headers:1', impact: 'hardening' },
      { severity: 'medium', description: 'two sources of truth for the palette — tailwind.config.ts:3', impact: 'refactor' },
      { severity: 'low', description: 'docs/architecture.md is an empty template — docs/architecture.md:1', impact: 'docs' },
      { severity: 'medium', description: 'untagged finding stays plain — src/x.ts:9' },
    ]);
  });

  it('parses the tag after a leading colon identically to the canonical form', () => {
    // `FINDING [low]: (refactor): desc` (tag after the colon) must parse the SAME as
    // `FINDING [low] (refactor): desc` — else the tag is lost, the description is polluted
    // with "(refactor):", and it stops deduping with its well-formed twin.
    const canonical = parseSecurityFindings('FINDING [low] (refactor): two palettes — a.ts:3')[0];
    const colonFirst = parseSecurityFindings('FINDING [low]: (refactor): two palettes — a.ts:3')[0];
    expect(colonFirst).toEqual({ severity: 'low', description: 'two palettes — a.ts:3', impact: 'refactor' });
    expect(colonFirst).toEqual(canonical);
    expect(findingFingerprint(colonFirst)).toBe(findingFingerprint(canonical));
  });

  it('tolerates the requires-design tag after a separator too', () => {
    expect(parseSecurityFindings('FINDING [high]: (requires-design): no auth issuer — src/auth.ts:1')).toEqual([
      { severity: 'high', description: 'no auth issuer — src/auth.ts:1', requiresDesign: true },
    ]);
  });

  it('leaves a non-tag parenthetical in the description', () => {
    // `(see note)` is not a known tag, so it is NOT consumed — the description keeps it.
    expect(parseSecurityFindings('FINDING [medium]: (see note) missing validation — src/x.ts:9')).toEqual([
      { severity: 'medium', description: '(see note) missing validation — src/x.ts:9' },
    ]);
  });
});

describe('cliErrorEscalationText (auth-death recovery)', () => {
  it('adds a re-authenticate hint when the error looks like an auth failure', () => {
    const text = cliErrorEscalationText('developer', 'claude', 'Error: Not logged in. Run `claude login`.');
    expect(text).toContain('claude'); // names the CLI
    expect(text).toMatch(/re-authenticate/i);
    expect(text).toMatch(/AI CLIs page/);
    expect(text).toContain('Not logged in'); // raw error still shown
  });

  it('is just the plain error for a non-auth failure', () => {
    const text = cliErrorEscalationText('developer', 'codex', 'SyntaxError: unexpected token');
    expect(text).toBe('The developer CLI (codex) errored: SyntaxError: unexpected token');
    expect(text).not.toMatch(/re-authenticate/i);
  });

  it('handles a null error without throwing', () => {
    expect(cliErrorEscalationText('developer', 'claude', null)).toBe(
      'The developer CLI (claude) errored: unknown error',
    );
  });
});

describe('parseSecurityFindings — repro-test marker (P1)', () => {
  it('extracts [repro-test: <path>] onto reproTest and strips it, keeping the file:line', () => {
    const out =
      'FINDING [critical] (defect): player throws on malformed URL — src/player.tsx:12 [repro-test: tests/repro/player.test.ts]';
    expect(parseSecurityFindings(out)).toEqual([
      {
        severity: 'critical',
        description: 'player throws on malformed URL — src/player.tsx:12',
        impact: 'defect',
        reproTest: 'tests/repro/player.test.ts',
      },
    ]);
  });

  it('an ordinary finding gets no reproTest key', () => {
    expect(parseSecurityFindings('FINDING [high]: session token in localStorage — src/auth.ts:4')).toEqual([
      { severity: 'high', description: 'session token in localStorage — src/auth.ts:4' },
    ]);
  });

  it('fingerprints identically with and without the marker (a re-review dedups to one)', () => {
    const withRepro = parseSecurityFindings(
      'FINDING [critical] (defect): SSRF in the fetcher — src/fetch.ts:9 [repro-test: t/ssrf.test.ts]',
    )[0];
    const without = parseSecurityFindings('FINDING [critical] (defect): SSRF in the fetcher — src/fetch.ts:9')[0];
    expect(withRepro.reproTest).toBe('t/ssrf.test.ts');
    expect(findingFingerprint(withRepro)).toBe(findingFingerprint(without));
  });

  it('skips a line that is only a repro marker with no real description', () => {
    expect(parseSecurityFindings('FINDING [high]: [repro-test: t/x.test.ts]')).toEqual([]);
  });
});

describe('mergeFindings (D1b)', () => {
  it('unions two lists, deduping by normalized description', () => {
    const reply = [{ severity: 'high' as const, description: 'Token in localStorage' }];
    const file = [
      { severity: 'high' as const, description: 'token in   localStorage' }, // dup (case/space)
      { severity: 'medium' as const, description: 'Missing rate limit' }, // new
    ];
    expect(mergeFindings(reply, file)).toEqual([
      { severity: 'high', description: 'Token in localStorage' },
      { severity: 'medium', description: 'Missing rate limit' },
    ]);
  });

  it('recovers findings the reply omitted but the file holds', () => {
    const fromFile = [{ severity: 'critical' as const, description: 'Cleartext bank token' }];
    expect(mergeFindings([], fromFile)).toEqual(fromFile);
  });
});

describe('findingCitation (D1a)', () => {
  it('extracts the last file:line citation from a description', () => {
    expect(findingCitation('token in localStorage — src/auth.ts:42')).toEqual({
      file: 'src/auth.ts',
      line: 42,
    });
    // Takes the LAST citation when several appear.
    expect(findingCitation('see a.ts:10 and also b/c.tsx:200')).toEqual({ file: 'b/c.tsx', line: 200 });
  });

  it('ignores non-citations (clock times, versions, plain prose)', () => {
    expect(findingCitation('the job runs at 10:30 every day')).toBeNull();
    expect(findingCitation('no file reference here at all')).toBeNull();
  });
});

describe('clusterFindings (D2)', () => {
  const f = (severity: 'high' | 'medium' | 'low', description: string) => ({ severity, description });

  it('groups findings by cited file; uncited findings stay singletons', () => {
    const clusters = clusterFindings(
      [
        f('high', 'A — src/auth.ts:10'),
        f('medium', 'B — src/auth.ts:20'),
        f('low', 'C — no citation here'),
        f('high', 'D — src/db.ts:5'),
      ],
      4,
    );
    expect(clusters.map((c) => c.file)).toEqual(['src/auth.ts', 'src/db.ts', null]);
    expect(clusters[0].findings).toHaveLength(2); // auth.ts grouped
    expect(clusters[1].findings).toHaveLength(1);
    expect(clusters[2].findings).toHaveLength(1); // uncited singleton
  });

  it('splits an oversized same-file group into chunks of maxPerCluster', () => {
    const many = Array.from({ length: 5 }, (_, i) => f('high', `X${i} — src/big.ts:${i + 1}`));
    const clusters = clusterFindings(many, 2);
    expect(clusters.map((c) => c.findings.length)).toEqual([2, 2, 1]);
    expect(clusters.every((c) => c.file === 'src/big.ts')).toBe(true);
  });

  it('returns [] for no findings', () => {
    expect(clusterFindings([], 4)).toEqual([]);
  });
});

describe('sortClustersBySeverity (R5)', () => {
  const f = (severity: 'critical' | 'high' | 'medium' | 'low', description: string) => ({
    severity,
    description,
  });

  it('orders clusters worst-severity-first so the cap defers the least severe', () => {
    const clusters = clusterFindings(
      [
        f('low', 'trivial — a.ts:1'),
        f('critical', 'crash — b.ts:1'),
        f('medium', 'meh — c.ts:1'),
        f('high', 'bad — d.ts:1'),
      ],
      4,
    );
    const sorted = sortClustersBySeverity(clusters);
    expect(sorted.map((c) => c.findings[0].severity)).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('ranks a mixed cluster by its WORST finding; stable for ties', () => {
    const clusters = [
      { file: 'a.ts', findings: [f('low', 'x — a.ts:1'), f('low', 'y — a.ts:2')] },
      { file: 'b.ts', findings: [f('low', 'z — b.ts:1'), f('critical', 'boom — b.ts:2')] },
      { file: 'c.ts', findings: [f('low', 'w — c.ts:1')] },
    ];
    const sorted = sortClustersBySeverity(clusters);
    expect(sorted[0].file).toBe('b.ts'); // carries a critical
    expect(sorted.slice(1).map((c) => c.file)).toEqual(['a.ts', 'c.ts']); // ties keep order
  });
});

describe('gateOutcome (blocking review gates)', () => {
  it('skips the gate when no reviewer is assigned (deliberate config)', () => {
    expect(gateOutcome(false, false)).toBe('skip');
    expect(gateOutcome(false, true)).toBe('skip');
  });
  it('passes when an assigned reviewer succeeded', () => {
    expect(gateOutcome(true, true)).toBe('pass');
  });
  it('escalates when an assigned reviewer failed or was unavailable', () => {
    expect(gateOutcome(true, false)).toBe('escalate');
  });
});

describe('reviewIndeterminate (exit-0 empty reply = review never ran)', () => {
  it('flags an ok run whose output is empty or whitespace-only', () => {
    expect(reviewIndeterminate({ ok: true, output: '' })).toBe(true);
    expect(reviewIndeterminate({ ok: true, output: '   \n\t ' })).toBe(true);
  });
  it('does not flag a run with real output', () => {
    expect(reviewIndeterminate({ ok: true, output: 'Reviewed. No findings.' })).toBe(false);
  });
  it('does not flag a failed run (the gate already escalates on !ok)', () => {
    expect(reviewIndeterminate({ ok: false, output: '' })).toBe(false);
  });
  it('does not flag null (no reviewer assigned — the honest skip path)', () => {
    expect(reviewIndeterminate(null)).toBe(false);
  });
});

describe('isPhaseProgressStale (re-draft reset)', () => {
  it('is stale when the stored revision differs from the current plan revision', () => {
    expect(isPhaseProgressStale('rev-a', 'rev-b')).toBe(true);
    expect(isPhaseProgressStale(null, 'rev-b')).toBe(true);
    expect(isPhaseProgressStale(undefined, 'rev-b')).toBe(true);
  });
  it('is fresh when the revisions match', () => {
    expect(isPhaseProgressStale('rev-a', 'rev-a')).toBe(false);
  });
  it('never invalidates a legacy plan with no current revision id', () => {
    expect(isPhaseProgressStale('rev-a', null)).toBe(false);
    expect(isPhaseProgressStale(null, null)).toBe(false);
  });
});

function task(id: string, status: string, phase = 'P1', kind: PlanTask['kind'] = 'build'): PlanTask {
  return { id, status, phase, kind };
}

function prog(p: Partial<PhaseProgress> = {}): PhaseProgress {
  return { ...emptyPhaseProgress(), ...p };
}

describe('phaseOrderOf', () => {
  it('keeps first-seen order, de-duplicated', () => {
    const tasks = [task('1', 'todo', 'A'), task('2', 'todo', 'B'), task('3', 'todo', 'A')];
    expect(phaseOrderOf(tasks)).toEqual(['A', 'B']);
  });
});

describe('activePhaseOf (where an injected work item lands)', () => {
  it('is null when there are no tasks', () => {
    expect(activePhaseOf([])).toBeNull();
  });
  it('is the first phase that still has non-terminal work', () => {
    // A is fully built; B is mid-build → injected work joins B.
    const tasks = [
      task('1', 'verified', 'A'),
      task('2', 'in-progress', 'B'),
      task('3', 'todo', 'C'),
    ];
    expect(activePhaseOf(tasks)).toBe('B');
  });
  it('treats parked tasks as terminal (does not anchor on a blocked task)', () => {
    const tasks = [task('1', 'blocked', 'A'), task('2', 'todo', 'B')];
    expect(activePhaseOf(tasks)).toBe('B');
  });
  it('reopens the LAST phase when every task is terminal (build done / in review)', () => {
    const tasks = [task('1', 'verified', 'A'), task('2', 'verified', 'B')];
    expect(activePhaseOf(tasks)).toBe('B');
  });
});

describe('decideNextAction — single phase, afterEach testing + endOfPhase security', () => {
  const test = 'afterEachTask' as const;
  const sec = 'endOfPhase' as const;
  const empty: PhaseProgressMap = {};

  it('starts with dev on the first todo task', () => {
    const a = decideNextAction([task('1', 'todo'), task('2', 'todo')], empty, test, sec);
    expect(a).toEqual({ phase: 'P1', kind: 'dev', taskId: '1' });
  });

  it('devs the next todo while an earlier task is verified', () => {
    const a = decideNextAction([task('1', 'verified'), task('2', 'todo')], empty, test, sec);
    expect(a).toEqual({ phase: 'P1', kind: 'dev', taskId: '2' });
  });

  it('QAs a finished (done) task before devving the next (per-task interleave)', () => {
    // Contrast with endOfPhase, which devs task 2 before QAing task 1.
    const a = decideNextAction([task('1', 'done'), task('2', 'todo')], empty, test, sec);
    expect(a).toEqual({ phase: 'P1', kind: 'qa', taskId: '1' });
  });

  it('runs the end-of-phase security review once all tasks are verified', () => {
    const a = decideNextAction([task('1', 'verified'), task('2', 'verified')], empty, test, sec);
    expect(a).toEqual({ phase: 'P1', kind: 'security-phase' });
  });

  it('runs the architect review after security', () => {
    const p: PhaseProgressMap = { P1: prog({ securityDone: true }) };
    const a = decideNextAction([task('1', 'verified')], p, test, sec);
    expect(a).toEqual({ phase: 'P1', kind: 'architect' });
  });

  it('celebrates after security + architect are done', () => {
    const p: PhaseProgressMap = { P1: prog({ securityDone: true, architectDone: true }) };
    const a = decideNextAction([task('1', 'verified')], p, test, sec);
    expect(a).toEqual({ phase: 'P1', kind: 'celebrate' });
  });

  it('returns null when the phase is fully complete', () => {
    const p: PhaseProgressMap = {
      P1: prog({ securityDone: true, architectDone: true, celebrated: true }),
    };
    expect(decideNextAction([task('1', 'verified')], p, test, sec)).toBeNull();
  });
});

describe('decideNextAction — endOfPhase testing builds before testing', () => {
  it('devs the next todo before QAing a done task (all dev first)', () => {
    const a = decideNextAction(
      [task('1', 'done'), task('2', 'todo')],
      {},
      'endOfPhase',
      'endOfPhase',
    );
    expect(a).toEqual({ phase: 'P1', kind: 'dev', taskId: '2' });
  });

  it('QAs done tasks once nothing is left to build', () => {
    const a = decideNextAction([task('1', 'done'), task('2', 'done')], {}, 'endOfPhase', 'endOfPhase');
    expect(a).toEqual({ phase: 'P1', kind: 'qa', taskId: '1' });
  });
});

describe('decideNextAction — afterEach security interleaves per task', () => {
  it('reviews a verified-but-unsecured task before devving the next one', () => {
    const a = decideNextAction(
      [task('1', 'verified'), task('2', 'todo')],
      {},
      'afterEachTask',
      'afterEachTask',
    );
    expect(a).toEqual({ phase: 'P1', kind: 'security-task', taskId: '1' });
  });

  it('moves on once the verified task is recorded as secured', () => {
    const p: PhaseProgressMap = { P1: prog({ securedTaskIds: ['1'] }) };
    const a = decideNextAction(
      [task('1', 'verified'), task('2', 'todo')],
      p,
      'afterEachTask',
      'afterEachTask',
    );
    expect(a).toEqual({ phase: 'P1', kind: 'dev', taskId: '2' });
  });
});

describe('phase-end auto-fire contract (one-step mode)', () => {
  // The renderer auto-continues (no extra click) when the NEXT action after a
  // settled task is one of these phase-level stages, pausing only before a new
  // task's 'dev'. Lock in that the stages a finished phase yields are exactly
  // that set — a rename here would silently break the renderer's auto-fire.
  const phaseEndKinds = new Set(['security-phase', 'architect', 'ops', 'celebrate']);

  it('every action after the last verified task (until the next dev) is a phase-end stage', () => {
    // Two phases; P1's tasks are all verified, P2 is still to build.
    const tasks = [task('1', 'verified', 'P1'), task('2', 'todo', 'P2')];
    const kinds: string[] = [];
    // Walk P1's wrap-up by advancing the recorded progress as each stage runs.
    let p = prog();
    for (let i = 0; i < 5; i++) {
      const a = decideNextAction(tasks, { P1: p }, 'afterEachTask', 'endOfPhase', 'endOfPhase');
      if (!a || a.phase !== 'P1') break;
      kinds.push(a.kind);
      p = prog({
        securityDone: p.securityDone || a.kind === 'security-phase',
        architectDone: p.architectDone || a.kind === 'architect',
        opsDone: p.opsDone || a.kind === 'ops',
        celebrated: p.celebrated || a.kind === 'celebrate',
      });
    }
    expect(kinds).toEqual(['security-phase', 'architect', 'ops', 'celebrate']);
    expect(kinds.every((k) => phaseEndKinds.has(k))).toBe(true);
    // Once P1 is wrapped, the loop pauses-point is a fresh dev on P2.
    const next = decideNextAction(
      tasks,
      { P1: prog({ securityDone: true, architectDone: true, opsDone: true, celebrated: true }) },
      'afterEachTask',
      'endOfPhase',
      'endOfPhase',
    );
    expect(next).toEqual({ phase: 'P2', kind: 'dev', taskId: '2' });
  });
});

describe('decideNextAction — multiple phases', () => {
  it('only starts phase 2 after phase 1 is fully complete', () => {
    const tasks = [task('1', 'verified', 'P1'), task('2', 'todo', 'P2')];
    // P1 not yet celebrated → still on P1.
    const before = decideNextAction(tasks, { P1: prog({ securityDone: true }) }, 'afterEachTask', 'endOfPhase');
    expect(before).toEqual({ phase: 'P1', kind: 'architect' });
    // P1 complete → move to P2.
    const after = decideNextAction(
      tasks,
      { P1: prog({ securityDone: true, architectDone: true, celebrated: true }) },
      'afterEachTask',
      'endOfPhase',
    );
    expect(after).toEqual({ phase: 'P2', kind: 'dev', taskId: '2' });
  });
});

describe('parked tasks do not block a phase', () => {
  it('a human-needed task alongside verified work still reaches the review stages', () => {
    const tasks = [task('1', 'verified'), task('2', 'human-needed')];
    const a = decideNextAction(tasks, {}, 'afterEachTask', 'endOfPhase');
    expect(a).toEqual({ phase: 'P1', kind: 'security-phase' });
  });

  it('a phase that is entirely parked is treated as complete (no reviews)', () => {
    const tasks = [task('1', 'human-needed', 'P1'), task('2', 'todo', 'P2')];
    expect(isPhaseComplete([task('1', 'human-needed')], emptyPhaseProgress(), 'endOfPhase')).toBe(true);
    // The only actionable work is in P2.
    expect(decideNextAction(tasks, {}, 'afterEachTask', 'endOfPhase')).toEqual({
      phase: 'P2',
      kind: 'dev',
      taskId: '2',
    });
  });
});

describe('human-setup tasks', () => {
  it('are surfaced as a dev action (the engine then hands them off)', () => {
    const a = decideNextAction([task('1', 'todo', 'P1', 'human-setup')], {}, 'afterEachTask', 'endOfPhase');
    expect(a).toEqual({ phase: 'P1', kind: 'dev', taskId: '1' });
  });
});

describe('decideNextAction — security off', () => {
  it('needs no security review on a verified phase (goes straight to architect)', () => {
    expect(decideNextAction([task('1', 'verified')], {}, 'afterEachTask', 'off')).toEqual({
      phase: 'P1',
      kind: 'architect',
    });
  });

  it('a phase completes with no security gate at all', () => {
    const done = prog({ architectDone: true, celebrated: true });
    expect(isPhaseComplete([task('1', 'verified')], done, 'off')).toBe(true);
    expect(decideNextAction([task('1', 'verified')], { P1: done }, 'afterEachTask', 'off')).toBeNull();
  });
});

describe('decideNextAction — Jared documentation pass (ops cadence)', () => {
  it('endOfPhase: runs after the architect review, before the celebration', () => {
    const p: PhaseProgressMap = { P1: prog({ securityDone: true, architectDone: true }) };
    expect(decideNextAction([task('1', 'verified')], p, 'afterEachTask', 'endOfPhase', 'endOfPhase')).toEqual(
      { phase: 'P1', kind: 'ops' },
    );
  });

  it('endOfPhase: the phase is not complete until the docs pass runs', () => {
    const reviewed = prog({ securityDone: true, architectDone: true, celebrated: true });
    expect(isPhaseComplete([task('1', 'verified')], reviewed, 'endOfPhase', 'endOfPhase')).toBe(false);
    expect(
      isPhaseComplete([task('1', 'verified')], { ...reviewed, opsDone: true }, 'endOfPhase', 'endOfPhase'),
    ).toBe(true);
  });

  it('endOfProject: one pass on the final phase after every phase is otherwise done, then null', () => {
    const tasks = [task('1', 'verified', 'P1'), task('2', 'verified', 'P2')];
    const phaseDone = prog({ securityDone: true, architectDone: true, celebrated: true });
    const progress: PhaseProgressMap = { P1: phaseDone, P2: { ...phaseDone } };
    expect(decideNextAction(tasks, progress, 'afterEachTask', 'endOfPhase', 'endOfProject')).toEqual({
      phase: 'P2',
      kind: 'ops',
    });
    const after: PhaseProgressMap = { P1: phaseDone, P2: { ...phaseDone, opsDone: true } };
    expect(decideNextAction(tasks, after, 'afterEachTask', 'endOfPhase', 'endOfProject')).toBeNull();
  });

  it('off: never schedules a docs pass', () => {
    const p: PhaseProgressMap = { P1: prog({ securityDone: true, architectDone: true, celebrated: true }) };
    expect(decideNextAction([task('1', 'verified')], p, 'afterEachTask', 'endOfPhase', 'off')).toBeNull();
  });
});

describe("decideNextAction — testing 'off' (rip-it / POC path) never queues QA", () => {
  // The rip-it / POC build runs with testingCadence 'off' (and a blank QA seat).
  // Under 'off', devStep marks Dinesh's work 'verified' DIRECTLY (bullpenEngine.ts
  // line ~1258 — it never parks a task at 'done'/awaiting-QA), so the decision
  // engine must never produce a 'qa' action for those builds. A regression here
  // makes a rip-it build either stall forever on an unresolvable QA escalation or
  // wrongly invoke a blank QA seat. These lock that in.

  it("a single 'verified' task goes straight to the architect gate, not 'qa'", () => {
    const a = decideNextAction([task('1', 'verified')], {}, 'off', 'off');
    expect(a).toEqual({ phase: 'P1', kind: 'architect' });
    expect(a?.kind).not.toBe('qa');
  });

  it("yields a phase-level security gate (not 'qa') when security is endOfPhase", () => {
    const a = decideNextAction([task('1', 'verified')], {}, 'off', 'endOfPhase');
    expect(a).toEqual({ phase: 'P1', kind: 'security-phase' });
    expect(a?.kind).not.toBe('qa');
  });

  it("celebrates (not 'qa') once the architect gate is past with security off", () => {
    const p: PhaseProgressMap = { P1: prog({ architectDone: true }) };
    const a = decideNextAction([task('1', 'verified')], p, 'off', 'off');
    expect(a).toEqual({ phase: 'P1', kind: 'celebrate' });
    expect(a?.kind).not.toBe('qa');
  });

  it("never returns 'qa' across the whole verified phase wrap-up (off testing + off security)", () => {
    // Walk every stage a single verified task yields and assert none is 'qa'.
    const tasks = [task('1', 'verified')];
    const kinds: string[] = [];
    let p = prog();
    for (let i = 0; i < 6; i++) {
      const a = decideNextAction(tasks, { P1: p }, 'off', 'off');
      if (!a) break;
      kinds.push(a.kind);
      p = prog({
        architectDone: p.architectDone || a.kind === 'architect',
        celebrated: p.celebrated || a.kind === 'celebrate',
      });
    }
    expect(kinds).toEqual(['architect', 'celebrate']);
    expect(kinds).not.toContain('qa');
  });

  it('full rip-it scenario — all cadences off, verified task — queues no QA and completes cleanly', () => {
    // The rip-it project blanks QA/Security/Ops seats and runs every cadence off.
    const tasks = [task('1', 'verified')];
    const kinds: string[] = [];
    let p = prog();
    for (let i = 0; i < 6; i++) {
      const a = decideNextAction(tasks, { P1: p }, 'off', 'off', 'off');
      if (!a) break;
      kinds.push(a.kind);
      p = prog({
        architectDone: p.architectDone || a.kind === 'architect',
        celebrated: p.celebrated || a.kind === 'celebrate',
      });
    }
    expect(kinds).toEqual(['architect', 'celebrate']);
    expect(kinds).not.toContain('qa');
    // Once architect + celebrate have run, the build is finished — not a QA loop.
    const done: PhaseProgressMap = { P1: prog({ architectDone: true, celebrated: true }) };
    expect(decideNextAction(tasks, done, 'off', 'off', 'off')).toBeNull();
  });

  it("an in-flight 'todo' task under 'off' still devs (then dev produces 'verified', never QA)", () => {
    // The dev action itself is unchanged; the point is the absence of a later 'qa'.
    const a = decideNextAction([task('1', 'todo')], {}, 'off', 'off', 'off');
    expect(a).toEqual({ phase: 'P1', kind: 'dev', taskId: '1' });
  });

  it("isPhaseComplete treats a 'verified' task as complete with every cadence off", () => {
    const reviewed = prog({ architectDone: true, celebrated: true });
    expect(isPhaseComplete([task('1', 'verified')], reviewed, 'off', 'off')).toBe(true);
  });

  it("isPhaseComplete still holds the phase open until the architect gate (security off)", () => {
    // 'off' security skips the security gate, but the architect gate is always
    // required — so a not-yet-reviewed verified phase is NOT complete (and the
    // engine returns the gate, not 'qa').
    const notReviewed = prog({ celebrated: true });
    expect(isPhaseComplete([task('1', 'verified')], notReviewed, 'off', 'off')).toBe(false);
    expect(decideNextAction([task('1', 'verified')], { P1: notReviewed }, 'off', 'off')).toEqual({
      phase: 'P1',
      kind: 'architect',
    });
  });

  it('multi-phase rip-it path: each verified phase wraps to the next without a QA step', () => {
    const tasks = [task('1', 'verified', 'P1'), task('2', 'verified', 'P2')];
    // P1 reviewed + celebrated → advance to P2's architect gate, never 'qa'.
    const p1Done = prog({ architectDone: true, celebrated: true });
    const a = decideNextAction(tasks, { P1: p1Done }, 'off', 'off', 'off');
    expect(a).toEqual({ phase: 'P2', kind: 'architect' });
    expect(a?.kind).not.toBe('qa');
  });
});

describe('bullpenCommitMessage', () => {
  const act = (kind: NextAction['kind'], phase = 'Auth', taskId = 'task-003'): NextAction => ({
    kind,
    phase,
    taskId,
  });
  const info = (over: Partial<StepCommitInfo>): StepCommitInfo => ({
    taskId: 'task-003',
    iterations: null,
    passed: null,
    escalated: false,
    phaseName: 'Auth',
    ...over,
  });

  it('dev includes the attempt count when present, omits it otherwise', () => {
    expect(bullpenCommitMessage(act('dev'), info({ iterations: '2/5' }))).toBe('task-003: dev (attempt 2/5)');
    expect(bullpenCommitMessage(act('dev'), info({}))).toBe('task-003: dev');
  });

  it('qa reflects pass / fail', () => {
    expect(bullpenCommitMessage(act('qa'), info({ passed: true }))).toBe('task-003: QA PASS');
    expect(bullpenCommitMessage(act('qa'), info({ passed: false }))).toBe('task-003: QA FAIL → back to dev');
  });

  it('any escalated step (whatever the kind) reads as a human-paused build, no false cause', () => {
    // Budget-exhaustion escalates under action.kind 'dev'; indeterminate QA under 'qa'.
    // Both must read honestly as an escalation, not "dev attempt" or "budget exhausted".
    expect(bullpenCommitMessage(act('dev'), info({ iterations: '5/5', escalated: true }))).toBe(
      'task-003: escalated to human — build paused',
    );
    expect(bullpenCommitMessage(act('qa'), info({ passed: false, escalated: true }))).toBe(
      'task-003: escalated to human — build paused',
    );
  });

  it('security-task references the task; phase-level steps use the phase name', () => {
    expect(bullpenCommitMessage(act('security-task'), info({}))).toBe('task-003: security review');
    expect(bullpenCommitMessage(act('security-phase'), info({ taskId: null }))).toBe('Security review: Auth');
    expect(bullpenCommitMessage(act('architect'), info({ taskId: null }))).toBe('Architecture review: Auth');
    expect(bullpenCommitMessage(act('ops'), info({ taskId: null }))).toBe('Docs pass: Auth');
    expect(bullpenCommitMessage(act('celebrate'), info({ taskId: null }))).toBe('Phase complete: Auth');
  });
});
