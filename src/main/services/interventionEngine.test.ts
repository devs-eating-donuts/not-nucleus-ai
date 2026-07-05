import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assignmentFromPreset } from '../../shared/cliAssignment';
import type { ProjectTeam } from '../../shared/project';
import type { ChatMessage } from '../../shared/room';
import { ALL_ROLE_IDS } from '../../shared/roles';
import type { RoleId } from '../../shared/roles';
import { createDefaultRoleConfiguration } from '../../shared/settings';
import { createTaskFileContent } from '../../shared/taskfile';

// lessonsStore (via lessonsContext) imports `app` from electron — stub it. The engine
// also calls the REAL gitTracker.commitWorkspaceStep after each turn; that is
// best-effort and no-ops here because the temp workspace is not a git repo root
// (repoState 'none'), so nothing needs stubbing for git.
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

// Script the seat CLI's replies and capture the exact prompt/options the engine builds.
vi.mock('./cliInvoker', () => ({ invokeCli: vi.fn() }));

import { invokeCli } from './cliInvoker';
import {
  interventionContext,
  loadIntervention,
  readInterventionLog,
  runInterventionTurn,
} from './interventionEngine';

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

const tmpDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-intervention-'));
  tmpDirs.push(dir);
  await mkdir(path.join(dir, 'tasks'), { recursive: true });
  await mkdir(path.join(dir, 'reviews'), { recursive: true });
  return dir;
}

/** Seeds the canonical task-001 the escalated-chat tests talk about. */
async function writeTask001(dir: string): Promise<void> {
  const content = createTaskFileContent({
    number: 1,
    title: 'Login flow',
    owner: 'developer',
    feature: 'Phase 1',
    goal: 'Build the login flow.',
    acceptanceCriteria: ['Login works end to end.'],
    iterationBudget: 3,
  });
  await writeFile(path.join(dir, 'tasks', 'task-001.md'), content, 'utf8');
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

function transcriptPath(dir: string, roleId: RoleId, taskId: string): string {
  return path.join(dir, '.nucleus', 'interventions', `${roleId}-${taskId}.json`);
}

async function exists(absPath: string): Promise<boolean> {
  return access(absPath).then(
    () => true,
    () => false,
  );
}

beforeEach(() => {
  mockInvoke.mockReset();
});

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('runInterventionTurn — happy path', () => {
  it('returns the reply and persists the transcript at .nucleus/interventions/<roleId>-<taskId>.json', async () => {
    const dir = await makeWorkspace();
    await writeTask001(dir);
    await writeFile(
      path.join(dir, 'reviews', 'qa-review.md'),
      'QA note: npm test never returned.',
      'utf8',
    );
    const team = makeTeam(['qa']);
    mockInvoke.mockResolvedValue(inv({ output: '  It hangs on npm test.  \n' }));

    const messages: ChatMessage[] = [{ role: 'user', text: 'Why is task-001 stuck?' }];
    const result = await runInterventionTurn(dir, 'qa', 'task-001', team, messages, 'canon');

    expect(result).toEqual({ ok: true, reply: 'It hangs on npm test.' });

    // Transcript persisted on its own channel, carrying both identity fields.
    const onDisk = JSON.parse(await readFile(transcriptPath(dir, 'qa', 'task-001'), 'utf8')) as {
      roleId?: string;
      taskId?: string;
      messages: ChatMessage[];
    };
    expect(onDisk.roleId).toBe('qa');
    expect(onDisk.taskId).toBe('task-001');
    expect(onDisk.messages).toEqual([
      { role: 'user', text: 'Why is task-001 stuck?' },
      { role: 'persona', text: 'It hangs on npm test.' },
    ]);
    expect(await readInterventionLog(dir, 'qa', 'task-001')).toEqual(onDisk.messages);

    // Unlike the design rooms: WORKSPACE cwd + autopilot, tagged for The Garage.
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const opts = mockInvoke.mock.calls[0][1];
    expect(opts.cwd).toBe(dir);
    expect(opts.autopilot).toBe(true);
    expect(opts.surface).toBe('intervention');
    expect(opts.role).toBe('qa');
    // The prompt is seeded with the stuck task, its [ACn] criteria, and the QA review tail.
    expect(opts.prompt).toContain('task-001 — Login flow');
    expect(opts.prompt).toContain('[AC1] Login works end to end.');
    expect(opts.prompt).toContain('What QA last reported (tail of reviews/qa-review.md)');
    expect(opts.prompt).toContain('QA note: npm test never returned.');
    expect(opts.prompt).toContain('Founder: Why is task-001 stuck?');
  });

  it('loadIntervention returns the persisted messages plus the seeded context', async () => {
    const dir = await makeWorkspace();
    await writeTask001(dir);
    const team = makeTeam(['qa']);
    mockInvoke.mockResolvedValue(inv({ output: 'Answered.' }));
    await runInterventionTurn(
      dir,
      'qa',
      'task-001',
      team,
      [{ role: 'user', text: 'help' }],
      'canon',
    );

    const loaded = await loadIntervention(dir, 'qa', 'task-001');

    expect(loaded.messages).toEqual([
      { role: 'user', text: 'help' },
      { role: 'persona', text: 'Answered.' },
    ]);
    expect(loaded.context).not.toBeNull();
    expect(loaded.context?.taskId).toBe('task-001');
    expect(loaded.context?.title).toBe('Login flow');
    expect(loaded.context?.status).toBe('todo');
    expect(loaded.context?.goal).toBe('Build the login flow.');
    expect(loaded.context?.acceptanceCriteria).toEqual([
      { id: 'AC1', text: 'Login works end to end.' },
    ]);
  });

  it('the security persona is seeded from security-review.md, not qa-review.md', async () => {
    const dir = await makeWorkspace();
    await writeTask001(dir);
    await writeFile(path.join(dir, 'reviews', 'qa-review.md'), 'qa words', 'utf8');
    await writeFile(
      path.join(dir, 'reviews', 'security-review.md'),
      'FINDING [high]: token stored in cleartext',
      'utf8',
    );

    const context = await interventionContext(dir, 'security', 'task-001');

    expect(context?.reviewLabel).toContain('security-review.md');
    expect(context?.reviewTail).toBe('FINDING [high]: token stored in cleartext');
  });
});

describe('runInterventionTurn — refusals', () => {
  it('a traversal-shaped taskId is refused before any read, invoke, or write', async () => {
    const dir = await makeWorkspace();
    await writeTask001(dir);
    const team = makeTeam(['qa']);

    // The read path guards too: an unsafe id reads as an empty transcript.
    expect(await readInterventionLog(dir, 'qa', '../evil')).toEqual([]);

    const result = await runInterventionTurn(
      dir,
      'qa',
      '../evil',
      team,
      [{ role: 'user', text: 'help' }],
      'canon',
    );

    // interventionContext returns null for the unsafe id, so the send refuses.
    expect(result).toEqual({ ok: false, reply: '', error: 'Could not read task ../evil.' });
    expect(mockInvoke).not.toHaveBeenCalled();
    // Nothing was written anywhere — the interventions channel was never created.
    expect(await exists(path.join(dir, '.nucleus', 'interventions'))).toBe(false);
    expect(await exists(path.resolve(dir, '..', 'evil'))).toBe(false);
  });

  it('a safe id whose task file does not exist refuses with the same shape', async () => {
    const dir = await makeWorkspace();
    const team = makeTeam(['qa']);

    const result = await runInterventionTurn(
      dir,
      'qa',
      'task-999',
      team,
      [{ role: 'user', text: 'help' }],
      'canon',
    );

    expect(result).toEqual({ ok: false, reply: '', error: 'Could not read task task-999.' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('a role with no intervention prompt is refused', async () => {
    const dir = await makeWorkspace();
    await writeTask001(dir);
    const team = makeTeam(['stakeholder']);

    const result = await runInterventionTurn(
      dir,
      'stakeholder',
      'task-001',
      team,
      [{ role: 'user', text: 'help' }],
      'canon',
    );

    expect(result).toEqual({
      ok: false,
      reply: '',
      error: 'No intervention chat is available for this role yet.',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("an empty message list refuses with 'No message to send.'", async () => {
    const dir = await makeWorkspace();
    await writeTask001(dir);
    const team = makeTeam(['qa']);

    const result = await runInterventionTurn(dir, 'qa', 'task-001', team, [], 'canon');

    expect(result).toEqual({ ok: false, reply: '', error: 'No message to send.' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('a failed invocation does not persist the failed turn', async () => {
    const dir = await makeWorkspace();
    await writeTask001(dir);
    const team = makeTeam(['qa']);
    mockInvoke.mockResolvedValue(inv({ ok: false, error: 'CLI exploded' }));

    const result = await runInterventionTurn(
      dir,
      'qa',
      'task-001',
      team,
      [{ role: 'user', text: 'help' }],
      'canon',
    );

    expect(result).toEqual({ ok: false, reply: '', error: 'CLI exploded' });
    expect(await exists(transcriptPath(dir, 'qa', 'task-001'))).toBe(false);
  });
});
