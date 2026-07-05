import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_ROLE_IDS } from '../../shared/roles';
import type { RoleId } from '../../shared/roles';
import { createDefaultRoleConfiguration } from '../../shared/settings';
import { assignmentFromPreset } from '../../shared/cliAssignment';
import { createTaskFileContent, parseTaskFile } from '../../shared/taskfile';
import type { ProjectTeam } from '../../shared/project';
import type { BullpenRunOptions } from '../../shared/bullpen';

// gitTracker / settingsStore / invocationLog import `app` from electron — stub it so
// the engine's best-effort commit/log no-op in a non-repo temp workspace.
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

// The whole point: mock the CLI invoker so we can script each role's response and
// drive the real build loop (devStep / qaStep / remediation / budget / escalation)
// without spawning a real agent.
vi.mock('./cliInvoker', () => ({ invokeCli: vi.fn() }));

// HERMETICITY: qaStep calls the REAL runGates, so bullpen behavior would
// depend on the dev machine's PATH (a resolvable `gitleaks` would actually run against the
// temp workspace). Mock ONLY runGates — a scripted no-gates report by default (ranAny:false
// → byte-identical pre-gate QA for every existing test); individual tests script gate
// outcomes. formatGateSummary / aggregateGateResults stay real.
vi.mock('./verificationRunner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./verificationRunner')>();
  return { ...actual, runGates: vi.fn(), runReproTest: vi.fn() };
});

import { invokeCli } from './cliInvoker';
import { runGates, runReproTest } from './verificationRunner';
import type { GateReport } from './verificationRunner';
import {
  appendTaskToPhase,
  remediateSecurityFindings,
  requeueTaskForQa,
  resolveTask,
  runNextStep,
} from './bullpenEngine';

const mockInvoke = vi.mocked(invokeCli);
const mockRunGates = vi.mocked(runGates);
const mockRunReproTest = vi.mocked(runReproTest);

const NO_GATES_REPORT: GateReport = {
  results: [],
  allRequiredPassed: true,
  ranAny: false,
  totalDurationMs: 0,
};

/** A one-gate report — required, ran, passed or failed as scripted. */
function gateReport(over: { passed: boolean; label?: 'typecheck' | 'build' | 'test' }): GateReport {
  const label = over.label ?? 'typecheck';
  return {
    results: [
      {
        id: label,
        label,
        passed: over.passed,
        skipped: false,
        timedOut: false,
        required: true,
        outputTail: over.passed ? '' : "src/app.ts(3,1): error TS2304: Cannot find name 'foo'.",
        durationMs: 42,
      },
    ],
    allRequiredPassed: over.passed,
    ranAny: true,
    totalDurationMs: 42,
  };
}

function inv(partial: { ok?: boolean; output?: string; error?: string | null }) {
  return {
    ok: partial.ok ?? true,
    output: partial.output ?? '',
    durationMs: 1,
    cliName: 'claude',
    command: 'claude',
    error: partial.error ?? null,
    timedOut: false,
  };
}

const tmpDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-bullpen-'));
  tmpDirs.push(dir);
  await mkdir(path.join(dir, '.nucleus'), { recursive: true });
  await mkdir(path.join(dir, 'tasks'), { recursive: true });
  return dir;
}

async function writeTask(
  dir: string,
  opts: { number: number; title: string; feature: string; budget: number },
): Promise<void> {
  const content = createTaskFileContent({
    number: opts.number,
    title: opts.title,
    owner: 'developer',
    feature: opts.feature,
    goal: `Build ${opts.title}.`,
    acceptanceCriteria: ['It works end to end.'],
    iterationBudget: opts.budget,
  });
  const id = `task-${String(opts.number).padStart(3, '0')}`;
  await writeFile(path.join(dir, 'tasks', `${id}.md`), content, 'utf8');
}

/** A human-setup task (Manual Steps section) the Bullpen must hand to the human. */
async function writeSetupTask(
  dir: string,
  opts: { number: number; title: string; feature: string },
): Promise<void> {
  const content = createTaskFileContent({
    number: opts.number,
    title: opts.title,
    owner: 'developer',
    feature: opts.feature,
    goal: `Set up ${opts.title} by hand.`,
    acceptanceCriteria: ['The account exists and the CLI is signed in.'],
    iterationBudget: 3,
    kind: 'human-setup',
    manualSteps: ['Run `gcloud auth login` yourself.', 'Paste the project id into .env.local.'],
  });
  const id = `task-${String(opts.number).padStart(3, '0')}`;
  await writeFile(path.join(dir, 'tasks', `${id}.md`), content, 'utf8');
}

/** A team where exactly the named roles have a (mocked) CLI assigned. */
function makeTeam(active: RoleId[]): ProjectTeam {
  const team = {} as ProjectTeam;
  for (const id of ALL_ROLE_IDS) {
    const cfg = createDefaultRoleConfiguration(id);
    if (active.includes(id)) {
      cfg.assignment = assignmentFromPreset('claude');
    }
    team[id] = cfg;
  }
  return team;
}

function opts(over: Partial<BullpenRunOptions> = {}): BullpenRunOptions {
  return {
    testingCadence: 'afterEachTask',
    securityCadence: 'off',
    opsCadence: 'off',
    namingMode: 'canon',
    ...over,
  };
}

/** Drive the loop like the renderer does, until done/escalated or a step cap. */
async function drive(dir: string, team: ProjectTeam, o: BullpenRunOptions, maxSteps = 40) {
  const steps = [];
  for (let i = 0; i < maxSteps; i += 1) {
    const step = await runNextStep(dir, team, o);
    steps.push(step);
    if (step.allDone || step.escalated) {
      break;
    }
  }
  return steps;
}

async function statusOf(dir: string, n: number): Promise<string> {
  const id = `task-${String(n).padStart(3, '0')}`;
  const content = await readFile(path.join(dir, 'tasks', `${id}.md`), 'utf8');
  return parseTaskFile(content).status ?? 'todo';
}

async function taskFiles(dir: string): Promise<string[]> {
  return (await readdir(path.join(dir, 'tasks'))).filter((f) => /^task-\d+\.md$/.test(f)).sort();
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockRunGates.mockReset();
  mockRunGates.mockResolvedValue(NO_GATES_REPORT);
  mockRunReproTest.mockReset();
});

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('runNextStep — happy path', () => {
  it('dev builds → QA passes → the task is verified and the build completes', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Login', feature: 'Phase 1', budget: 3 });
    const team = makeTeam(['developer', 'qa']);
    mockInvoke.mockImplementation(async (_assignment, o) =>
      inv({ output: o.role === 'qa' ? 'looks good\nVERDICT: PASS' : 'implemented the feature' }),
    );

    const steps = await drive(dir, team, opts());

    expect(await statusOf(dir, 1)).toBe('verified');
    expect(steps.some((s) => s.actor === 'developer')).toBe(true);
    expect(steps.some((s) => s.actor === 'qa' && s.passed === true)).toBe(true);
    expect(steps.at(-1)?.allDone).toBe(true);
  });
});

// B1: the reconciliation gate. A finding that contradicts the approved deployment posture
// (e.g. no auth on an approved single-user localhost app) must become an advisory note in the
// backlog, NOT a dev remediation task — while genuine (posture-independent) findings still do.
describe('remediateSecurityFindings — B1 reconciliation gate', () => {
  async function writeDecisions(dir: string, posture: string): Promise<void> {
    await writeFile(
      path.join(dir, '.nucleus', 'decisions.json'),
      JSON.stringify({ schemaVersion: 1, deploymentPosture: posture, decisions: [], acceptedDescopes: [] }),
      'utf8',
    );
  }

  it('routes a posture-contradicting finding to the backlog, not the dev queue', async () => {
    const dir = await makeWorkspace();
    await mkdir(path.join(dir, 'reviews'), { recursive: true });
    await writeDecisions(dir, 'local-single-user');
    const output = [
      'FINDING [critical]: The API has zero authentication — anyone can call it — src/api.ts:1',
      'FINDING [critical]: Plaid access token stored in cleartext in the DB — src/db.ts:10',
    ].join('\n');

    const surface = await remediateSecurityFindings(dir, 'Phase 1', output, 'task-001');

    // Only the cleartext token (posture-independent) becomes a remediation task.
    const files = await taskFiles(dir);
    expect(files).toHaveLength(1);
    const task = await readFile(path.join(dir, 'tasks', files[0]), 'utf8');
    expect(task).toMatch(/cleartext/i);
    expect(task).not.toMatch(/zero authentication/i);

    // The no-auth finding is logged as an advisory under the distinct backlog label.
    const backlog = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(backlog).toMatch(/Advisory — contradicts approved scope/);
    expect(backlog).toMatch(/zero authentication/i);
    expect(surface).toMatch(/1 advisory/);
  });

  it('under a strict (public-internet) posture, BOTH findings remediate', async () => {
    const dir = await makeWorkspace();
    await mkdir(path.join(dir, 'reviews'), { recursive: true });
    await writeDecisions(dir, 'public-internet');
    const output = [
      'FINDING [critical]: The API has zero authentication — src/api.ts:1',
      'FINDING [critical]: Plaid token in cleartext — src/db.ts:10',
    ].join('\n');

    await remediateSecurityFindings(dir, 'Phase 1', output, 'task-001');
    expect(await taskFiles(dir)).toHaveLength(2);
  });

  it('with NO decisions artifact, every finding remediates (pre-B1 unchanged)', async () => {
    const dir = await makeWorkspace();
    await mkdir(path.join(dir, 'reviews'), { recursive: true });
    const output = 'FINDING [high]: zero authentication on the API — src/api.ts:1';

    await remediateSecurityFindings(dir, 'Phase 1', output, 'task-001');
    expect(await taskFiles(dir)).toHaveLength(1);
  });
});

describe('runNextStep — QA fail loops back to dev', () => {
  it('a QA fail bounces the task to in-progress, then a later pass verifies it', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Signup', feature: 'Phase 1', budget: 5 });
    const team = makeTeam(['developer', 'qa']);
    let qaCalls = 0;
    mockInvoke.mockImplementation(async (_assignment, o) => {
      if (o.role === 'qa') {
        qaCalls += 1;
        return inv({ output: qaCalls === 1 ? 'VERDICT: FAIL' : 'VERDICT: PASS' });
      }
      return inv({ output: 'built it' });
    });

    const steps = await drive(dir, team, opts());

    // Two dev runs (initial + retry after the fail) and a final verified task.
    const devSteps = steps.filter((s) => s.actor === 'developer');
    expect(devSteps.length).toBeGreaterThanOrEqual(2);
    expect(steps.some((s) => s.actor === 'qa' && s.passed === false)).toBe(true);
    expect(await statusOf(dir, 1)).toBe('verified');
  });
});

describe('runNextStep — budget exhaustion', () => {
  it('exhausting the dev↔QA budget parks the task blocked and spawns ONE remediation task (no infinite loop)', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Flaky', feature: 'Phase 1', budget: 2 });
    const team = makeTeam(['developer', 'qa']);
    // QA fails the original task forever, but passes the remediation fix task so the
    // build can settle (and we prove the loop guard stops, not just that it stalls).
    mockInvoke.mockImplementation(async (_assignment, o) => {
      if (o.role === 'qa') {
        const onRemediation = (o.prompt ?? '').includes('task-002');
        return inv({ output: onRemediation ? 'VERDICT: PASS' : 'VERDICT: FAIL' });
      }
      return inv({ output: 'attempted' });
    });

    await drive(dir, team, opts());

    // The original task is parked, and exactly one remediation task was created.
    expect(await statusOf(dir, 1)).toBe('blocked');
    const files = await taskFiles(dir);
    expect(files).toContain('task-002.md');
    const remediation = await readFile(path.join(dir, 'tasks', 'task-002.md'), 'utf8');
    expect(remediation.toLowerCase()).toContain('remediation');
  });
});

// Empty-reply gate: a reviewer that exits 0 with NO output did not
// actually review anything (a signed-out or stalled CLI) — the gate must escalate like a
// reviewer failure, never record a silent pass with the done-flag set.
describe('runNextStep — a review gate never passes on an exit-0 EMPTY reply', () => {
  it('an empty end-of-phase security reply escalates without setting securityDone; a real reply later passes', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Feed', feature: 'Phase 1', budget: 3 });
    const team = makeTeam(['developer', 'qa', 'security']);
    let securityOutput = '   \n'; // exit 0, whitespace-only — the review never ran
    mockInvoke.mockImplementation(async (_assignment, o) => {
      if (o.role === 'qa') return inv({ output: 'VERDICT: PASS' });
      if (o.role === 'security') return inv({ output: securityOutput });
      return inv({ output: 'implemented' });
    });

    const steps = await drive(dir, team, opts({ securityCadence: 'endOfPhase' }));

    // The security gate escalated instead of silently passing…
    const last = steps.at(-1);
    expect(last?.actor).toBe('security');
    expect(last?.escalated).toBe(true);
    expect(last?.log).toContain('no output');
    // …and phase progress does NOT claim the review ran (the escalation path never
    // writes the done-flag, so the file may not even exist yet).
    const progress = JSON.parse(
      await readFile(path.join(dir, '.nucleus', 'bullpen-phases.json'), 'utf8').catch(
        () => '{"phases":{}}',
      ),
    ) as { phases: Record<string, { securityDone?: boolean }> };
    expect(progress.phases['Phase 1']?.securityDone ?? false).toBe(false);
    // ESCALATIONS.md records why.
    const esc = await readFile(path.join(dir, 'ESCALATIONS.md'), 'utf8');
    expect(esc).toContain('Security review — Phase 1');

    // The founder fixes the seat; the resumed run's REAL reply passes the gate.
    securityOutput = 'Reviewed the phase. No findings.';
    const resumed = await drive(dir, team, opts({ securityCadence: 'endOfPhase' }));
    expect(resumed.at(-1)?.allDone).toBe(true);
    const after = JSON.parse(
      await readFile(path.join(dir, '.nucleus', 'bullpen-phases.json'), 'utf8'),
    ) as { phases: Record<string, { securityDone?: boolean }> };
    expect(after.phases['Phase 1']?.securityDone).toBe(true);
  });

  it('an empty PER-TASK security reply escalates; the later pass resolves the escalation', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Feed', feature: 'Phase 1', budget: 3 });
    const team = makeTeam(['developer', 'qa', 'security']);
    let securityOutput = '';
    mockInvoke.mockImplementation(async (_assignment, o) => {
      if (o.role === 'qa') return inv({ output: 'VERDICT: PASS' });
      if (o.role === 'security') return inv({ output: securityOutput });
      return inv({ output: 'implemented' });
    });

    const steps = await drive(dir, team, opts({ securityCadence: 'afterEachTask' }));
    const last = steps.at(-1);
    expect(last?.actor).toBe('security');
    expect(last?.escalated).toBe(true);
    expect(await readFile(path.join(dir, 'ESCALATIONS.md'), 'utf8')).toMatch(/\*\*Status:\*\*\s*open/);

    // The recovered per-task review passes AND flips the gate escalation to resolved
    // (securityTaskStep now mirrors the phase-level gates' resolveGateEscalation).
    securityOutput = 'Reviewed the task. No findings.';
    const resumed = await drive(dir, team, opts({ securityCadence: 'afterEachTask' }));
    expect(resumed.at(-1)?.allDone).toBe(true);
    const esc = await readFile(path.join(dir, 'ESCALATIONS.md'), 'utf8');
    expect(esc).toMatch(/\*\*Status:\*\*\s*resolved/);
    expect(esc).not.toMatch(/\*\*Status:\*\*\s*open/);
  });

  it('empty architect and ops replies escalate their gates too', async () => {
    // Architect (always end-of-phase when seated).
    {
      const dir = await makeWorkspace();
      await writeTask(dir, { number: 1, title: 'A', feature: 'P', budget: 3 });
      const team = makeTeam(['developer', 'qa', 'architect']);
      mockInvoke.mockImplementation(async (_assignment, o) =>
        inv({ output: o.role === 'qa' ? 'VERDICT: PASS' : o.role === 'architect' ? '' : 'built' }),
      );
      const steps = await drive(dir, team, opts());
      expect(steps.at(-1)?.actor).toBe('architect');
      expect(steps.at(-1)?.escalated).toBe(true);
    }
    // Ops docs pass (endOfPhase cadence).
    {
      const dir = await makeWorkspace();
      await writeTask(dir, { number: 1, title: 'B', feature: 'P', budget: 3 });
      const team = makeTeam(['developer', 'qa', 'ops']);
      mockInvoke.mockImplementation(async (_assignment, o) =>
        inv({ output: o.role === 'qa' ? 'VERDICT: PASS' : o.role === 'ops' ? '' : 'built' }),
      );
      const steps = await drive(dir, team, opts({ opsCadence: 'endOfPhase' }));
      expect(steps.at(-1)?.actor).toBe('ops');
      expect(steps.at(-1)?.escalated).toBe(true);
    }
  });
});

describe('runNextStep — security findings become remediation tasks', () => {
  it('a HIGH security finding spawns a fix task in the same phase', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Auth', feature: 'Phase 1', budget: 3 });
    const team = makeTeam(['developer', 'qa', 'security']);
    mockInvoke.mockImplementation(async (_assignment, o) => {
      if (o.role === 'qa') {
        return inv({ output: 'VERDICT: PASS' });
      }
      if (o.role === 'security') {
        return inv({
          output: 'Reviewed.\nFINDING [high]: unsanitized SQL in the login query — src/auth.ts:42',
        });
      }
      return inv({ output: 'implemented' });
    });

    await drive(dir, team, opts({ securityCadence: 'afterEachTask' }));

    // The original task is verified; a remediation fix task was appended for the finding.
    expect(await statusOf(dir, 1)).toBe('verified');
    const files = await taskFiles(dir);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files).toContain('task-002.md');
  });

  // D1a — a finding whose file:line citation is out of range (a hallucination) is routed to
  // the findings backlog, NOT turned into a wasted dev remediation task; an in-range citation
  // still becomes a task.
  it('D1a: an out-of-range file:line citation is backlogged, not remediated', async () => {
    const dir = await makeWorkspace();
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'short.ts'), 'a\nb\nc\nd\ne\n', 'utf8'); // 5 lines

    const output = [
      'FINDING [high]: real issue on a valid line — src/short.ts:3',
      'FINDING [high]: hallucinated citation — src/short.ts:999',
    ].join('\n');
    await remediateSecurityFindings(dir, 'Core', output, 'phase "Core"');

    // Exactly one remediation task was created (the in-range finding); no seed tasks here.
    const files = await taskFiles(dir);
    expect(files.length).toBe(1);
    // The out-of-range one landed in the backlog instead.
    const backlog = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(backlog).toContain('hallucinated citation');
    expect(backlog).toContain('Unverified citation');
  });

  // D1b — a finding the CLI wrote to its review FILE but under-emitted in its stdout reply is
  // still recovered (merged from the file), so it isn't silently dropped.
  it('D1b: findings in the review file are recovered when the reply omits them', async () => {
    const dir = await makeWorkspace();
    await mkdir(path.join(dir, 'reviews'), { recursive: true });
    await writeFile(
      path.join(dir, 'reviews', 'security-review.md'),
      '# Security review\n\nSome prose.\n\nFINDING [critical]: cleartext bank token persisted\n',
      'utf8',
    );

    // The reply has NO FINDING lines — only the file does.
    await remediateSecurityFindings(dir, 'Core', 'Reviewed everything, see the file.', 'phase "Core"');

    const files = await taskFiles(dir);
    expect(files.length).toBe(1); // the file's finding became a task
    const created = await readFile(path.join(dir, 'tasks', files[0]), 'utf8');
    expect(created).toContain('cleartext bank token');
  });

  // R5 — an uncited LOW finding routes to the backlog (a cited low, and any medium+, still
  // become tasks — never defer real work on a formatting miss).
  it('R5: an uncited low is backlogged; cited low and uncited medium still become tasks', async () => {
    const dir = await makeWorkspace();
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'a.ts'), 'x\n'.repeat(10), 'utf8');
    const output = [
      'FINDING [low]: vague style nit with no citation at all',
      'FINDING [low]: cited low — src/a.ts:3',
      'FINDING [medium]: uncited medium stays a task',
    ].join('\n');
    await remediateSecurityFindings(dir, 'Core', output, 'phase "Core"');

    const files = await taskFiles(dir);
    expect(files.length).toBe(2); // cited low + uncited medium
    const backlog = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(backlog).toContain('Uncited low');
    expect(backlog).toContain('vague style nit');
  });

  // R4 — the seen-set splits remediated vs backlogged: BOTH suppress re-processing (a
  // re-sighted backlogged finding must not duplicate its backlog entry or become a task),
  // and the on-disk ledger keeps the split (schemaVersion 2).
  it('R4: re-emitted findings are suppressed by disposition; ledger splits the two', async () => {
    const dir = await makeWorkspace();
    const first = [
      'FINDING [high] (defect): crash on empty feed',
      'FINDING [medium] (refactor): two sources of truth for the palette',
    ].join('\n');
    await remediateSecurityFindings(dir, 'Core', first, 'phase "Core"');
    expect((await taskFiles(dir)).length).toBe(1); // defect tasked; refactor backlogged

    // The on-disk ledger recorded the split.
    const ledger = JSON.parse(await readFile(path.join(dir, '.nucleus', 'remediated-findings.json'), 'utf8'));
    expect(ledger.schemaVersion).toBe(2);
    expect(ledger.remediated.some((s: string) => s.includes('crash on empty feed'))).toBe(true);
    expect(ledger.backlogged.some((s: string) => s.includes('sources of truth'))).toBe(true);

    // A later review re-emits BOTH (the append-only file) plus one genuinely new defect.
    const second = [
      first,
      'FINDING [high] (defect): XSS in show notes renderer',
    ].join('\n');
    await remediateSecurityFindings(dir, 'Core', second, 'phase "Core"');

    // Only the NEW defect became a task (2 total)…
    expect((await taskFiles(dir)).length).toBe(2);
    // …and the backlog holds exactly ONE entry for the refactor finding (no duplicate).
    const backlog = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(backlog.match(/sources of truth/g)?.length).toBe(1);
  });

  it('R4: a legacy flat-array ledger still suppresses (read as remediated)', async () => {
    const dir = await makeWorkspace();
    const finding = { severity: 'high', description: 'crash on empty feed' };
    // Pre-R4 file shape: a flat fingerprint array.
    await writeFile(
      path.join(dir, '.nucleus', 'remediated-findings.json'),
      JSON.stringify(['crash on empty feed']),
      'utf8',
    );
    await remediateSecurityFindings(dir, 'Core', `FINDING [high]: ${finding.description}`, 'phase "Core"');
    expect((await taskFiles(dir)).length).toBe(0); // suppressed by the legacy ledger
  });

  // A one-shot step that TIMES OUT at a high thinking level gets ONE automatic retry at
  // the next-lower level (a high level can stall for a very long time; one level down
  // often finishes quickly).
  it('R2: a timed-out step retries once at the next-lower thinking level', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Feature', feature: 'Core', budget: 5 });
    const team = makeTeam(['developer', 'qa']);
    // The dev seat runs at ultrathink; its first invocation hits the timeout wall.
    team.developer.assignment!.defaultThinkingLevel = 'ultrathink';

    const levels: (string | undefined)[] = [];
    mockInvoke.mockImplementation(async (assignment, o) => {
      if (o.role === 'developer') {
        levels.push(assignment?.defaultThinkingLevel);
        if (levels.length === 1) {
          // First dev call: killed by the budget.
          return { ...inv({ ok: false, error: 'Timed out after 600s' }), timedOut: true };
        }
        return inv({ output: 'implemented' });
      }
      return inv({ output: 'VERDICT: PASS' });
    });

    await drive(dir, team, opts());

    // The retry happened, one step down (ultrathink → think-hard), and the task completed.
    expect(levels[0]).toBe('ultrathink');
    expect(levels[1]).toBe('think-hard');
    expect(await statusOf(dir, 1)).toBe('verified');
  });

  // R1 — refactor/docs impact types route to the findings backlog for founder triage (never a
  // dev task); defect/hardening/untagged still become tasks. Kills the taste/docs cycle tail.
  it('R1: (refactor)/(docs) findings are backlogged for triage, not built', async () => {
    const dir = await makeWorkspace();
    const output = [
      'FINDING [critical] (defect): uncaught throw on malformed URL',
      'FINDING [medium] (refactor): two sources of truth for the palette',
      'FINDING [low] (docs): architecture doc is an empty template',
      'FINDING [medium]: untagged finding — stays a task (conservative)',
    ].join('\n');
    await remediateSecurityFindings(dir, 'Core', output, 'phase "Core"');

    // The defect + the untagged finding became tasks; refactor/docs did NOT.
    const files = await taskFiles(dir);
    expect(files.length).toBe(2);
    const bodies = await Promise.all(files.map((f) => readFile(path.join(dir, 'tasks', f), 'utf8')));
    const joined = bodies.join('\n');
    expect(joined).toContain('uncaught throw');
    expect(joined).toContain('untagged finding');
    expect(joined).not.toContain('sources of truth');
    expect(joined).not.toContain('empty template');
    // …they landed in the backlog under the triage heading instead.
    const backlog = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(backlog).toContain('Refactor/docs — triage via The Punch List');
    expect(backlog).toContain('sources of truth');
    expect(backlog).toContain('empty template');
  });

  // B4 — a (requires-design) finding names a missing capability, not a code patch, so it routes
  // to the design backlog instead of becoming a Dinesh dev task he'd fake-satisfy.
  it('B4: a (requires-design) finding routes to the design backlog, not a dev task', async () => {
    const dir = await makeWorkspace();
    const output = [
      'FINDING [high] (requires-design): no real auth provider / issuer exists',
      'FINDING [medium]: missing input validation on the form',
    ].join('\n');
    await remediateSecurityFindings(dir, 'Core', output, 'phase "Core"');

    // The ordinary finding became a task; the requires-design one did NOT.
    const files = await taskFiles(dir);
    expect(files.length).toBe(1);
    const body = await readFile(path.join(dir, 'tasks', files[0]), 'utf8');
    expect(body).toContain('missing input validation');
    expect(body).not.toContain('no real auth provider');
    // …it landed in the design backlog instead.
    const backlog = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(backlog).toContain('Requires design');
    expect(backlog).toContain('no real auth provider');
  });

  // P1 — repro-backed findings (opt-in). A `defect` auto-tasks only when a reviewer-written repro
  // test CONFIRMS it; a refuted / repro-less defect routes to the backlog. hardening isn't gated.
  describe('P1: repro-backed defect findings', () => {
    async function enableReproBacked(dir: string): Promise<void> {
      await writeFile(
        path.join(dir, '.nucleus', 'current-run.json'),
        JSON.stringify({ projectName: 'Test', workspacePath: dir, createdAt: '2020-01-01T00:00:00Z', reproBackedFindings: true }),
        'utf8',
      );
    }

    it('confirmed → task; refuted / repro-less → backlog; hardening is not gated', async () => {
      const dir = await makeWorkspace();
      await enableReproBacked(dir);
      mockRunReproTest.mockImplementation(async (_ws, reproPath) =>
        reproPath === 'confirm.test.ts' ? 'confirmed' : 'refuted',
      );
      const output = [
        'FINDING [critical] (defect): throws on malformed URL [repro-test: confirm.test.ts]',
        'FINDING [high] (defect): off-by-one in the pager [repro-test: refute.test.ts]',
        'FINDING [high] (defect): unproven claim with no repro',
        'FINDING [high] (hardening): no CSP header configured',
      ].join('\n');
      await remediateSecurityFindings(dir, 'Core', output, 'phase "Core"');

      const bodies = (
        await Promise.all((await taskFiles(dir)).map((f) => readFile(path.join(dir, 'tasks', f), 'utf8')))
      ).join('\n');
      expect(bodies).toContain('throws on malformed URL'); // confirmed → task
      expect(bodies).toContain('no CSP header'); // hardening not gated → task
      expect(bodies).not.toContain('off-by-one'); // refuted → not a task
      expect(bodies).not.toContain('unproven claim'); // no repro → not a task
      const backlog = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
      expect(backlog).toContain('Unconfirmed defect — needs a failing repro test');
      expect(backlog).toContain('off-by-one');
      expect(backlog).toContain('unproven claim');
    });

    it('is byte-identical when off (default): a repro-less defect still becomes a task, no repro run', async () => {
      const dir = await makeWorkspace(); // no current-run.json → flag off
      await remediateSecurityFindings(dir, 'Core', 'FINDING [high] (defect): unproven claim with no repro', 'phase "Core"');
      expect((await taskFiles(dir)).length).toBe(1); // gate skipped → normal task
      expect(mockRunReproTest).not.toHaveBeenCalled();
    });
  });

  // D2 — several findings in the SAME file become ONE "harden this file" task (each finding an
  // acceptance criterion), instead of three separate dev↔QA tasks.
  it('D2: same-file findings cluster into one remediation task with multiple ACs', async () => {
    const dir = await makeWorkspace();
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'auth.ts'), Array.from({ length: 50 }, () => 'x').join('\n'), 'utf8');
    const output = [
      'FINDING [high]: missing input validation — src/auth.ts:10',
      'FINDING [high]: token stored in plaintext — src/auth.ts:20',
      'FINDING [medium]: weak error handling — src/auth.ts:30',
    ].join('\n');
    await remediateSecurityFindings(dir, 'Core', output, 'phase "Core"');

    const files = await taskFiles(dir);
    expect(files.length).toBe(1); // ONE clustered task, not three
    const body = await readFile(path.join(dir, 'tasks', files[0]), 'utf8');
    expect(body).toContain('Harden auth.ts');
    for (const s of ['missing input validation', 'token stored in plaintext', 'weak error handling']) {
      expect(body).toContain(s); // each finding rides as its own acceptance criterion
    }
  });

  // D1b guard — the review file is append-only, so a later review must NOT re-remediate a
  // finding already handled in an earlier one (else afterEachTask grows a quadratic tail).
  it('D1b: an already-remediated finding is not re-created on a later review', async () => {
    const dir = await makeWorkspace();
    await mkdir(path.join(dir, 'reviews'), { recursive: true });
    const finding1 = 'FINDING [high]: token in localStorage';
    await writeFile(path.join(dir, 'reviews', 'security-review.md'), `# Security\n\n${finding1}\n`, 'utf8');

    // First review → one remediation task.
    await remediateSecurityFindings(dir, 'Core', finding1, 'phase "Core"');
    expect((await taskFiles(dir)).length).toBe(1);

    // Phase 2: the CLI APPENDS a new finding to the same cumulative file.
    const finding2 = 'FINDING [high]: missing CSRF protection';
    await writeFile(
      path.join(dir, 'reviews', 'security-review.md'),
      `# Security\n\n${finding1}\n${finding2}\n`,
      'utf8',
    );
    // Second review reply only mentions the new finding.
    await remediateSecurityFindings(dir, 'Core', finding2, 'phase "Core"');

    // Only ONE more task (the new finding) — the old finding is not re-remediated.
    const files = await taskFiles(dir);
    expect(files.length).toBe(2);
    const bodies = await Promise.all(files.map((f) => readFile(path.join(dir, 'tasks', f), 'utf8')));
    expect(bodies.filter((b) => b.includes('token in localStorage')).length).toBe(1);
    expect(bodies.filter((b) => b.includes('missing CSRF protection')).length).toBe(1);
  });

  // E3 — concurrent appendTaskToPhase (a Punch List filing during a build's remediation
  // creation) must not collide on a task number. The per-workspace alloc lock serializes
  // the readdir→max+1→write so every caller gets a distinct id and no file is overwritten.
  it('E3: concurrent appendTaskToPhase never drops a task (no id collision)', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Seed', feature: 'Core', budget: 5 });
    await writeTask(dir, { number: 2, title: 'Seed 2', feature: 'Core', budget: 5 });

    const N = 10;
    const ids = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendTaskToPhase(dir, 'Core', `Concurrent ${i}`, `Goal ${i}`, ['ok'], true),
      ),
    );

    // Every call returned a distinct, non-null id…
    const unique = new Set(ids.filter((id): id is string => id !== null));
    expect(unique.size).toBe(N);
    // …and every file is actually on disk (nothing overwritten).
    const files = await taskFiles(dir);
    expect(files.length).toBe(2 + N);
    for (const id of unique) expect(files).toContain(`${id}.md`);
  });
});

// (c) Human-setup handoff: a task with a Manual Steps section is handed to the HUMAN — the
// engine escalates (human-needed + an ESCALATIONS.md record with the checklist) and never
// invokes the dev CLI on it.
describe('runNextStep — human-setup handoff (Manual Steps)', () => {
  it('escalates the task to the human WITHOUT invoking any CLI', async () => {
    const dir = await makeWorkspace();
    await writeSetupTask(dir, { number: 1, title: 'Cloud login', feature: 'Phase 1' });
    const team = makeTeam(['developer', 'qa']);
    mockInvoke.mockImplementation(async () => inv({ output: 'should never run' }));

    const steps = await drive(dir, team, opts());

    // The step paused the loop as an escalation, attributed to no agent.
    const last = steps.at(-1);
    expect(last?.escalated).toBe(true);
    expect(last?.actor).toBeNull();
    expect(last?.status).toBe('human-needed');
    // The checklist rides in the step log for the human.
    expect(last?.log).toContain('gcloud auth login');

    // Disk state: the task is parked human-needed…
    expect(await statusOf(dir, 1)).toBe('human-needed');
    // …no agent was ever invoked for it…
    expect(mockInvoke).not.toHaveBeenCalled();
    // …and ESCALATIONS.md carries an OPEN record with the manual steps.
    const esc = await readFile(path.join(dir, 'ESCALATIONS.md'), 'utf8');
    expect(esc).toContain('task-001 — Cloud login');
    expect(esc).toMatch(/\*\*Status:\*\*\s*open/);
    expect(esc).toContain('gcloud auth login');
  });
});

// (b) The Mark-done recovery path (the engine function behind the bullpen:resolve-task IPC):
// the human does the manual steps, marks the task done → verified + escalation resolved, and
// the resumed build completes.
describe('resolveTask — the Mark-done recovery path', () => {
  it('marks a human-setup task verified, resolves its escalation, and the build completes', async () => {
    const dir = await makeWorkspace();
    await writeSetupTask(dir, { number: 1, title: 'Cloud login', feature: 'Phase 1' });
    const team = makeTeam(['developer', 'qa']);
    mockInvoke.mockImplementation(async () => inv({ output: 'should never run' }));

    // The handoff escalates and pauses the build.
    const steps = await drive(dir, team, opts());
    expect(steps.at(-1)?.escalated).toBe(true);
    expect(await statusOf(dir, 1)).toBe('human-needed');

    // The human runs the steps and marks it done.
    const result = await resolveTask(dir, 'task-001');
    expect(result).toEqual({ ok: true, error: null });

    // Task verified; the open escalation flipped to resolved.
    expect(await statusOf(dir, 1)).toBe('verified');
    const esc = await readFile(path.join(dir, 'ESCALATIONS.md'), 'utf8');
    expect(esc).toMatch(/\*\*Status:\*\*\s*resolved/);
    expect(esc).not.toMatch(/\*\*Status:\*\*\s*open/);

    // The resumed run wraps the phase (nothing left for an agent to do).
    const resumed = await drive(dir, team, opts());
    expect(resumed.at(-1)?.allDone).toBe(true);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('rejects a malformed id and a missing task', async () => {
    const dir = await makeWorkspace();
    expect(await resolveTask(dir, '../evil')).toEqual({ ok: false, error: 'Invalid task id.' });
    expect(await resolveTask(dir, 'task-999')).toEqual({ ok: false, error: 'Task not found.' });
  });

  it("writes the founder's note into the task file — the outcome lands in the workspace, not just the click", async () => {
    // Otherwise a "no issues found" verdict exists only in the founder's head, so the
    // downstream "fix issues" task burns dev↔QA attempts proving a negative.
    const dir = await makeWorkspace();
    await writeSetupTask(dir, { number: 1, title: 'Exercise every flow', feature: 'Testing' });

    const result = await resolveTask(dir, 'task-001', 'Ran every step on localhost — zero issues found.');
    expect(result).toEqual({ ok: true, error: null });

    const content = await readFile(path.join(dir, 'tasks', 'task-001.md'), 'utf8');
    expect(content).toMatch(/## Founder note \(Mark done\)/);
    expect(content).toMatch(/zero issues found/);
    expect(await statusOf(dir, 1)).toBe('verified');

    // No note → no section (byte-identical to the pre-note behavior).
    await writeSetupTask(dir, { number: 2, title: 'Another handoff', feature: 'Testing' });
    await resolveTask(dir, 'task-002');
    const plain = await readFile(path.join(dir, 'tasks', 'task-002.md'), 'utf8');
    expect(plain).not.toMatch(/Founder note/);
  });
});

// (a) Redo QA: an indeterminate QA verdict (ran, but no PASS/FAIL line) escalates; the founder
// re-queues the task, its escalation resolves, and the next run re-runs QA — no extra dev run.
describe('requeueTaskForQa — Redo QA recovery', () => {
  it('re-queues an indeterminate-QA escalated task; the next drive re-runs QA to a pass', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Feed', feature: 'Phase 1', budget: 3 });
    const team = makeTeam(['developer', 'qa']);
    let devCalls = 0;
    let qaCalls = 0;
    let qaOutput = 'I started the test suite but never saw it finish.'; // NO verdict line
    mockInvoke.mockImplementation(async (_assignment, o) => {
      if (o.role === 'qa') {
        qaCalls += 1;
        return inv({ output: qaOutput });
      }
      devCalls += 1;
      return inv({ output: 'implemented' });
    });

    // Dev builds, QA runs but can't produce a verdict → escalate to the human.
    const steps = await drive(dir, team, opts());
    const last = steps.at(-1);
    expect(last?.actor).toBe('qa');
    expect(last?.escalated).toBe(true);
    expect(last?.status).toBe('human-needed');
    // No-gates default → the plain (non-calmer) framing, with the ran-but-no-verdict cause.
    expect(last?.log).toContain("QA couldn't verify this task.");
    expect(last?.log).toContain('never printed a clear PASS/FAIL verdict');
    expect(await statusOf(dir, 1)).toBe('human-needed');
    expect(devCalls).toBe(1);
    expect(qaCalls).toBe(1);
    const escBefore = await readFile(path.join(dir, 'ESCALATIONS.md'), 'utf8');
    expect(escBefore).toContain('task-001 — Feed');
    expect(escBefore).toMatch(/\*\*Status:\*\*\s*open/);

    // Redo QA: back to 'done' (dev-complete, awaiting QA) + escalation resolved.
    expect(await requeueTaskForQa(dir, 'task-001')).toEqual({ ok: true, error: null });
    expect(await statusOf(dir, 1)).toBe('done');
    const escAfter = await readFile(path.join(dir, 'ESCALATIONS.md'), 'utf8');
    expect(escAfter).toMatch(/\*\*Status:\*\*\s*resolved/);
    expect(escAfter).not.toMatch(/\*\*Status:\*\*\s*open/);

    // The next drive re-runs QA (no new dev run) and the recovered verdict verifies the task.
    qaOutput = 'Checked everything.\nVERDICT: PASS';
    const resumed = await drive(dir, team, opts());
    expect(qaCalls).toBe(2);
    expect(devCalls).toBe(1);
    expect(await statusOf(dir, 1)).toBe('verified');
    expect(resumed.at(-1)?.allDone).toBe(true);
  });

  it('REFUSES a manual-setup task — nothing for QA to test', async () => {
    const dir = await makeWorkspace();
    await writeSetupTask(dir, { number: 1, title: 'Cloud login', feature: 'Phase 1' });

    const result = await requeueTaskForQa(dir, 'task-001');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('manual-setup');
    // The task file is untouched.
    expect(await statusOf(dir, 1)).toBe('todo');
  });
});

// (d) C1 verification gates at the top of qaStep — Decision #8 (a failed required gate
// short-circuits back to dev without a QA-CLI call) and Decision #7 (a green floor makes an
// indeterminate QA escalation calmer, citing the objective checks).
describe('qaStep — C1 verification gates (Decisions #8 and #7)', () => {
  it('a FAILED required gate bounces the task back to dev WITHOUT invoking the QA CLI', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Login', feature: 'Phase 1', budget: 3 });
    const team = makeTeam(['developer', 'qa']);
    mockRunGates.mockResolvedValue(gateReport({ passed: false, label: 'build' }));
    const rolesInvoked: string[] = [];
    mockInvoke.mockImplementation(async (_assignment, o) => {
      rolesInvoked.push(o.role ?? '(none)');
      return inv({ output: 'implemented' });
    });

    // Step 1: dev builds the task ('done'). Step 2: the QA slot — gates fail first.
    const dev = await runNextStep(dir, team, opts());
    expect(dev.actor).toBe('developer');
    const qa = await runNextStep(dir, team, opts());

    // The bounce is attributed to QA but the QA CLI was never called (dev-only invocations).
    expect(rolesInvoked).toEqual(['developer']);
    expect(qa.actor).toBe('qa');
    expect(qa.passed).toBe(false);
    expect(qa.escalated).toBe(false);
    expect(qa.status).toBe('in-progress');
    expect(qa.log).toContain('🧪 Gates: ✗ build');
    expect(qa.log).toContain('Objective verification gates failed');
    expect(qa.log).toContain("error TS2304: Cannot find name 'foo'.");

    // Disk state: the task bounced to in-progress and the gate fail is diagnosable on disk.
    expect(await statusOf(dir, 1)).toBe('in-progress');
    const review = await readFile(path.join(dir, 'reviews', 'qa-review.md'), 'utf8');
    expect(review).toContain('GATE FAIL');
  });

  it('gates GREEN + an indeterminate QA reply → the calmer objective-checks escalation', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Login', feature: 'Phase 1', budget: 3 });
    const team = makeTeam(['developer', 'qa']);
    mockRunGates.mockResolvedValue(gateReport({ passed: true, label: 'typecheck' }));
    let qaCalled = false;
    mockInvoke.mockImplementation(async (_assignment, o) => {
      if (o.role === 'qa') {
        qaCalled = true;
        return inv({ output: 'Poked around a bit, seemed fine, then my terminal froze.' });
      }
      return inv({ output: 'implemented' });
    });

    const steps = await drive(dir, team, opts());

    // The QA CLI ran (gates passed, so no short-circuit) but gave no verdict → escalate,
    // with the calmer Decision #7 framing that cites the passing objective checks.
    expect(qaCalled).toBe(true);
    const last = steps.at(-1);
    expect(last?.actor).toBe('qa');
    expect(last?.escalated).toBe(true);
    expect(last?.status).toBe('human-needed');
    expect(last?.log).toContain('Objective checks (typecheck) PASS, but QA gave no clear semantic read.');
    expect(last?.log).not.toContain("QA couldn't verify this task.");
    expect(await statusOf(dir, 1)).toBe('human-needed');
  });
});

// Off-cadence QA edge: a task left in 'done' when QA is off (e.g. a mid-build cadence toggle)
// is accepted as verified as-is — never QA'd (respects "QA off") and never stranded (a 'done'
// task is non-terminal, so skipping it would stall the phase).
describe('runNextStep — testingCadence off accepts a lingering done task', () => {
  it("marks a 'done' task verified without invoking QA when the cadence is off", async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Login', feature: 'Phase 1', budget: 3 });
    const team = makeTeam(['developer', 'qa']);
    const rolesInvoked: string[] = [];
    mockInvoke.mockImplementation(async (_assignment, o) => {
      rolesInvoked.push(o.role ?? '(none)');
      return inv({ output: 'implemented' });
    });

    // Step 1 under a QA-ON cadence: dev builds the task → 'done', awaiting QA.
    const dev = await runNextStep(dir, team, opts({ testingCadence: 'afterEachTask' }));
    expect(dev.actor).toBe('developer');
    expect(await statusOf(dir, 1)).toBe('done');

    // The founder toggles QA OFF and continues. The lingering 'done' task is accepted as-is.
    const accept = await runNextStep(dir, team, opts({ testingCadence: 'off' }));
    expect(accept.actor).toBe('developer');
    expect(accept.status).toBe('verified');
    expect(accept.log).toMatch(/QA is off/i);
    expect(await statusOf(dir, 1)).toBe('verified');

    // QA never ran — only the single dev invocation from step 1 (no phase stall).
    expect(rolesInvoked).toEqual(['developer']);
  });
});
