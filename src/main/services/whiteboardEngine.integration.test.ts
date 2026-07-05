import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_ROLE_IDS } from '../../shared/roles';
import type { RoleId } from '../../shared/roles';
import { createDefaultRoleConfiguration } from '../../shared/settings';
import { assignmentFromPreset } from '../../shared/cliAssignment';
import { parseTaskFile } from '../../shared/taskfile';
import type { ProjectTeam } from '../../shared/project';

// settingsStore / invocationLog / lessonsStore import `app` from electron — stub it so
// any best-effort side path no-ops in a temp workspace.
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

// The whole point: mock the CLI invoker so we can script Richard's structured-JSON
// reply and drive the REAL draftPlan keystone (prompt assembly → parse → task-file
// writes → plan/decisions artifacts) without spawning a real agent.
vi.mock('./cliInvoker', () => ({ invokeCli: vi.fn() }));

import { invokeCli } from './cliInvoker';
import {
  draftPlan,
  readPlanRevisionId,
  readProjectPlan,
  setPlanApproved,
} from './whiteboardEngine';

const mockInvoke = vi.mocked(invokeCli);

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

/** Two-phase plan: two dev tasks + one human-setup task (exercises both owners). */
const PLAN_A = JSON.stringify({
  phases: [
    {
      name: 'Foundation',
      tasks: [
        {
          title: 'Set up routing',
          goal: 'Wire the app routes.',
          acceptanceCriteria: ['npm run build succeeds with zero TS errors'],
          setup: false,
          manualSteps: [],
        },
        {
          title: 'Landing page',
          goal: 'Build the landing page.',
          acceptanceCriteria: ['npm run build succeeds', 'unit tests pass'],
          setup: false,
          manualSteps: [],
        },
      ],
    },
    {
      name: 'Go live',
      tasks: [
        {
          title: 'Create the hosting account',
          goal: 'Founder creates the hosting account and points DNS.',
          acceptanceCriteria: ['The account exists and DNS resolves'],
          setup: true,
          manualSteps: ['Sign up at host.example', 'Add the DNS record'],
        },
      ],
    },
  ],
});

/** Single-task re-draft plan, distinct from PLAN_A so stale files are detectable. */
const PLAN_B = JSON.stringify({
  phases: [
    {
      name: 'Rewrite',
      tasks: [
        {
          title: 'Rebuild everything',
          goal: 'One task to rule them all.',
          acceptanceCriteria: ['npm run build succeeds'],
          setup: false,
          manualSteps: [],
        },
      ],
    },
  ],
});

const tmpDirs: string[] = [];

/**
 * A minimal real workspace: `.nucleus/current-run.json` (what readProjectInfo reads)
 * for a from-scratch project — templateId null, no overlays, no scaffold, not rip-it.
 * No vision / room logs / references / secrets unless a test adds them.
 */
async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-whiteboard-'));
  tmpDirs.push(dir);
  await mkdir(path.join(dir, '.nucleus'), { recursive: true });
  await writeFile(
    path.join(dir, '.nucleus', 'current-run.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        projectName: 'Test Project',
        workspacePath: dir,
        createdAt: '2020-01-01T00:00:00.000Z',
        templateId: null,
        overlayIds: [],
        status: 'initialized',
        run: null,
      },
      null,
      2,
    ),
    'utf8',
  );
  return dir;
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

/** Room transcripts live at .nucleus/rooms/<roleId>.json in the transcriptStore shape. */
async function writeRoomLog(
  dir: string,
  roleId: 'projectLead' | 'architect',
  messages: Array<{ role: 'user' | 'persona'; text: string }>,
): Promise<void> {
  await mkdir(path.join(dir, '.nucleus', 'rooms'), { recursive: true });
  await writeFile(
    path.join(dir, '.nucleus', 'rooms', `${roleId}.json`),
    JSON.stringify({ schemaVersion: 1, roleId, messages }, null, 2),
    'utf8',
  );
}

async function exists(dir: string, rel: string): Promise<boolean> {
  try {
    await readFile(path.join(dir, ...rel.split('/')), 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function taskFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(path.join(dir, 'tasks'))).filter((f) => /^task-\d+\.md$/.test(f)).sort();
  } catch {
    return []; // tasks dir never created
  }
}

/** file name → exact content, for byte-for-byte "nothing changed" assertions. */
async function snapshotTasks(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of await taskFiles(dir)) {
    out[f] = await readFile(path.join(dir, 'tasks', f), 'utf8');
  }
  return out;
}

async function readJson(dir: string, rel: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(dir, ...rel.split('/')), 'utf8')) as Record<
    string,
    unknown
  >;
}

/** The prompts sent to the mocked invoker, in call order. */
function sentPrompts(): string[] {
  return mockInvoke.mock.calls.map(([, o]) => o.prompt);
}

beforeEach(() => {
  mockInvoke.mockReset();
});

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('draftPlan — happy path writes the whole plan surface to disk', () => {
  it('writes canonical task files, features.md, an unapproved plan.json with a revisionId, and decisions.json', async () => {
    const dir = await makeWorkspace();
    // Seed the inputs draftPlan reads, so we can prove they feed the prompt.
    await mkdir(path.join(dir, 'docs'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs', 'vision.md'),
      '# Vision — Test Project\n\nA site that does the thing.\n',
      'utf8',
    );
    await writeRoomLog(dir, 'projectLead', [
      { role: 'user', text: 'I want a marketing site.' },
      { role: 'persona', text: 'Ship a one-page site with a contact form.' },
    ]);
    await writeRoomLog(dir, 'architect', [
      { role: 'user', text: 'Use Astro.' },
      { role: 'persona', text: 'Astro + Cloudflare Pages it is.' },
    ]);
    mockInvoke.mockResolvedValue(inv({ output: PLAN_A }));

    const result = await draftPlan(dir, makeTeam(['architect']));

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.tasksWritten).toBe(3);
    expect(result.phases.map((p) => p.name)).toEqual(['Foundation', 'Go live']);

    // Task files on disk, in the canonical taskfile format.
    expect(await taskFiles(dir)).toEqual(['task-001.md', 'task-002.md', 'task-003.md']);
    const t1 = parseTaskFile(await readFile(path.join(dir, 'tasks', 'task-001.md'), 'utf8'));
    expect(t1.id).toBe('task-001');
    expect(t1.title).toBe('Set up routing');
    expect(t1.status).toBe('todo');
    expect(t1.owner).toBe('developer');
    expect(t1.feature).toBe('Foundation');
    expect(t1.kind).toBe('build');
    expect(t1.problems).toEqual([]);

    // Stable [ACn] ids on the criteria.
    const raw2 = await readFile(path.join(dir, 'tasks', 'task-002.md'), 'utf8');
    expect(raw2).toContain('- [ ] **[AC1]** npm run build succeeds');
    expect(raw2).toContain('- [ ] **[AC2]** unit tests pass');

    // The setup:true task is ops-owned human-setup with the manual checklist.
    const raw3 = await readFile(path.join(dir, 'tasks', 'task-003.md'), 'utf8');
    const t3 = parseTaskFile(raw3);
    expect(t3.owner).toBe('ops');
    expect(t3.kind).toBe('human-setup');
    expect(t3.feature).toBe('Go live');
    expect(raw3).toContain('1. Sign up at host.example');
    expect(raw3).toContain('2. Add the DNS record');

    // planning/features.md — the phase outline.
    const features = await readFile(path.join(dir, 'planning', 'features.md'), 'utf8');
    expect(features).toContain('# Features & Phases');
    expect(features).toContain('## Foundation');
    expect(features).toContain('- task-001 — Set up routing');
    expect(features).toContain('- task-002 — Landing page');
    expect(features).toContain('## Go live');
    expect(features).toContain('- task-003 — Create the hosting account');

    // .nucleus/plan.json — a fresh UNAPPROVED revision.
    const plan = await readJson(dir, '.nucleus/plan.json');
    expect(plan.schemaVersion).toBe(1);
    expect(plan.approved).toBe(false);
    expect(plan.approvedAt).toBeNull();
    expect(typeof plan.revisionId).toBe('string');
    expect(plan.revisionId).not.toBe('');
    expect(await readPlanRevisionId(dir)).toBe(plan.revisionId);

    // .nucleus/decisions.json (B1) — strict inferred posture for a non-rip-it,
    // template-less project; empty composed blueprint → no decisions/descopes.
    const decisions = await readJson(dir, '.nucleus/decisions.json');
    expect(decisions).toEqual({
      schemaVersion: 1,
      deploymentPosture: 'public-internet',
      decisions: [],
      acceptedDescopes: [],
    });

    // readProjectPlan sees the drafted, unapproved plan.
    const readBack = await readProjectPlan(dir);
    expect(readBack.approved).toBe(false);
    expect(readBack.tasks.map((t) => t.id)).toEqual(['task-001', 'task-002', 'task-003']);
    expect(readBack.tasks[0].feature).toBe('Foundation');

    // The prompt carried the vision + BOTH room transcripts (the reads are wired),
    // and the invocation is tagged for the whiteboard surface.
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [assignment, opts] = mockInvoke.mock.calls[0];
    expect(assignment?.command).toBe('claude');
    expect(opts.surface).toBe('whiteboard');
    expect(opts.role).toBe('architect');
    expect(opts.prompt).toContain('A site that does the thing.');
    expect(opts.prompt).toContain('Founder: I want a marketing site.');
    expect(opts.prompt).toContain('Monica: Ship a one-page site with a contact form.');
    expect(opts.prompt).toContain('Richard: Astro + Cloudflare Pages it is.');
  });

  it('parses a plan wrapped in prose (first "{" to last "}")', async () => {
    const dir = await makeWorkspace();
    mockInvoke.mockResolvedValue(
      inv({ output: `Here is the plan you asked for:\n${PLAN_B}\nGood luck!` }),
    );

    const result = await draftPlan(dir, makeTeam(['architect']));
    expect(result.ok).toBe(true);
    expect(result.tasksWritten).toBe(1);
    expect(await taskFiles(dir)).toEqual(['task-001.md']);
  });

  it('refuses without touching disk when the Architect seat has no CLI', async () => {
    const dir = await makeWorkspace();
    const result = await draftPlan(dir, makeTeam([]));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("The Architect has no CLI assigned on the project's team.");
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(await taskFiles(dir)).toEqual([]);
    expect(await exists(dir, '.nucleus/plan.json')).toBe(false);
  });
});

describe('draftPlan — re-draft replaces the old plan', () => {
  it('removes stale task files, resets approval, and assigns a DIFFERENT revisionId', async () => {
    const dir = await makeWorkspace();
    mockInvoke.mockResolvedValue(inv({ output: PLAN_A }));
    const first = await draftPlan(dir, makeTeam(['architect']));
    expect(first.ok).toBe(true);
    expect(await taskFiles(dir)).toEqual(['task-001.md', 'task-002.md', 'task-003.md']);
    const rev1 = await readPlanRevisionId(dir);
    expect(rev1).not.toBeNull();

    // The founder approves the first plan…
    await setPlanApproved(dir, true);
    expect((await readProjectPlan(dir)).approved).toBe(true);

    // …then re-drafts with a smaller plan.
    mockInvoke.mockResolvedValue(inv({ output: PLAN_B }));
    const second = await draftPlan(dir, makeTeam(['architect']));
    expect(second.ok).toBe(true);
    expect(second.tasksWritten).toBe(1);

    // Old task-002/003 are GONE — no stale higher-numbered tasks linger.
    expect(await taskFiles(dir)).toEqual(['task-001.md']);
    const t1 = parseTaskFile(await readFile(path.join(dir, 'tasks', 'task-001.md'), 'utf8'));
    expect(t1.title).toBe('Rebuild everything');
    expect(t1.feature).toBe('Rewrite');

    // features.md reflects only the new plan.
    const features = await readFile(path.join(dir, 'planning', 'features.md'), 'utf8');
    expect(features).toContain('## Rewrite');
    expect(features).not.toContain('Foundation');

    // New revision, approval reset — the Bullpen's gate state keys off this.
    const rev2 = await readPlanRevisionId(dir);
    expect(rev2).not.toBeNull();
    expect(rev2).not.toBe(rev1);
    expect((await readProjectPlan(dir)).approved).toBe(false);
  });
});

describe('setPlanApproved — approval round-trip', () => {
  it('approve flips plan.json (approvedAt set, revisionId preserved); un-approve reverses it', async () => {
    const dir = await makeWorkspace();
    mockInvoke.mockResolvedValue(inv({ output: PLAN_B }));
    await draftPlan(dir, makeTeam(['architect']));
    const rev = await readPlanRevisionId(dir);

    await setPlanApproved(dir, true);
    const approved = await readJson(dir, '.nucleus/plan.json');
    expect(approved.approved).toBe(true);
    expect(typeof approved.approvedAt).toBe('string');
    expect(approved.revisionId).toBe(rev);
    expect((await readProjectPlan(dir)).approved).toBe(true);

    await setPlanApproved(dir, false);
    const sentBack = await readJson(dir, '.nucleus/plan.json');
    expect(sentBack.approved).toBe(false);
    expect(sentBack.approvedAt).toBeNull();
    expect(sentBack.revisionId).toBe(rev); // send-back is NOT a re-draft
  });
});

describe('draftPlan — from-scratch prompt is exactly the base prompt (no-extras invariant)', () => {
  it('a project with no blueprint/scaffold/references/secrets/rooms sends the pinned base prompt', async () => {
    const dir = await makeWorkspace();
    mockInvoke.mockResolvedValue(inv({ output: PLAN_B }));

    const result = await draftPlan(dir, makeTeam(['architect']));
    expect(result.ok).toBe(true);

    const prompt = sentPrompts()[0];
    // None of the optional blocks were appended…
    expect(prompt).not.toContain('ARCHETYPE REQUIREMENTS');
    expect(prompt).not.toContain('SCOPE RECONCILIATION');
    expect(prompt).not.toContain('SECRETS MANIFEST');
    expect(prompt).not.toContain('FINAL REMINDER');
    // …the empty inputs render as their placeholders…
    expect(prompt).toContain('PRODUCT (from Monica):\n(none yet)');
    expect(prompt).toContain('VISION:\n(none yet)');
    expect(prompt).toContain('ARCHITECT NOTES (your own discussion, if any):\n(none yet)');
    // …and the EXACT assembled bytes are pinned at the assembly site, so any
    // accidental prompt drift for from-scratch projects fails this test.
    expect(prompt).toMatchSnapshot();
  });
});

describe('draftPlan — an unusable reply never leaves a half-written plan', () => {
  it('a prose (non-JSON) reply fails with a diagnosable error and writes NOTHING to a fresh workspace', async () => {
    const dir = await makeWorkspace();
    mockInvoke.mockResolvedValue(
      inv({ output: 'Well, I think we should talk about the stack first.' }),
    );

    const result = await draftPlan(dir, makeTeam(['architect']));

    expect(result.ok).toBe(false);
    expect(result.tasksWritten).toBe(0);
    expect(result.error).toMatch(/Could not parse the Architect's plan/);
    // The raw reply is quoted so a non-JSON reply is diagnosable.
    expect(result.error).toContain('Well, I think we should talk about the stack first.');

    // The parse failure returns BEFORE any mutation: no task files, no features.md,
    // no plan.json revision, no decisions artifact.
    expect(await taskFiles(dir)).toEqual([]);
    expect(await exists(dir, 'planning/features.md')).toBe(false);
    expect(await exists(dir, '.nucleus/plan.json')).toBe(false);
    expect(await exists(dir, '.nucleus/decisions.json')).toBe(false);
    expect(await readPlanRevisionId(dir)).toBeNull();
  });

  it('a parse failure after a good draft leaves the EXISTING plan byte-for-byte intact', async () => {
    const dir = await makeWorkspace();
    mockInvoke.mockResolvedValue(inv({ output: PLAN_A }));
    await draftPlan(dir, makeTeam(['architect']));
    await setPlanApproved(dir, true);
    const rev = await readPlanRevisionId(dir);
    const tasksBefore = await snapshotTasks(dir);
    const featuresBefore = await readFile(path.join(dir, 'planning', 'features.md'), 'utf8');

    mockInvoke.mockResolvedValue(inv({ output: 'no json here, sorry' }));
    const result = await draftPlan(dir, makeTeam(['architect']));
    expect(result.ok).toBe(false);

    // Old tasks still present and unchanged; approval + revision untouched.
    expect(await snapshotTasks(dir)).toEqual(tasksBefore);
    expect(await readFile(path.join(dir, 'planning', 'features.md'), 'utf8')).toBe(featuresBefore);
    expect(await readPlanRevisionId(dir)).toBe(rev);
    expect((await readProjectPlan(dir)).approved).toBe(true);
  });

  it('a valid-JSON reply with zero usable tasks is rejected and the workspace stays untouched', async () => {
    const dir = await makeWorkspace();
    mockInvoke.mockResolvedValue(inv({ output: '{"phases":[]}' }));

    const result = await draftPlan(dir, makeTeam(['architect']));

    expect(result.ok).toBe(false);
    expect(result.error).toBe('The Architect returned no usable tasks.');
    expect(await taskFiles(dir)).toEqual([]);
    expect(await exists(dir, '.nucleus/plan.json')).toBe(false);
  });

  it('a timed-out draft reports the timeout (not a parse failure) and writes nothing', async () => {
    const dir = await makeWorkspace();
    mockInvoke.mockResolvedValue({
      ...inv({ ok: false, output: '{"phases": [ {"name": "partial', error: 'killed' }),
      timedOut: true,
    });

    const result = await draftPlan(dir, makeTeam(['architect']));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
    expect(result.error).not.toMatch(/Could not parse/);
    expect(await taskFiles(dir)).toEqual([]);
    expect(await exists(dir, '.nucleus/plan.json')).toBe(false);
  });
});
