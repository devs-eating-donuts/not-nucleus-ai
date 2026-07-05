import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_ROLE_IDS } from '../../shared/roles';
import { createDefaultRoleConfiguration } from '../../shared/settings';
import { assignmentFromPreset } from '../../shared/cliAssignment';
import { createTaskFileContent, parseTaskFile } from '../../shared/taskfile';
import type { ProjectTeam } from '../../shared/project';
import type { ChatMessage } from '../../shared/room';

// The engine imports bullpenEngine (whose gitTracker / settingsStore / invocationLog
// side channels pull in `app` from electron) — stub it so those best-effort paths
// no-op inside a temp workspace.
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));
// Script Richard's replies instead of spawning a real architect CLI.
vi.mock('./cliInvoker', () => ({ invokeCli: vi.fn() }));

import { invokeCli } from './cliInvoker';
import {
  parseFileDirective,
  readWorkRequestLog,
  runWorkRequestTurn,
  stripFileDirective,
} from './workRequestEngine';

// Richard files a task by ending his (terse) reply with a single
// `CREATE-TASK :: <phase> :: <title> :: <work>` line. These guard that the app
// reliably extracts it — and never files off a pushback / clarifying reply.
describe('parseFileDirective', () => {
  it('parses a phase, title, and work from the directive line', () => {
    const reply =
      "Yeah, okay — that's small, I'll file it.\nCREATE-TASK :: Phase 2: Polish :: Center hero headline :: Make the homepage hero headline centered on mobile.";
    expect(parseFileDirective(reply)).toEqual({
      phaseHint: 'Phase 2: Polish',
      title: 'Center hero headline',
      work: 'Make the homepage hero headline centered on mobile.',
    });
  });

  it('keeps :: that appears inside the work description', () => {
    const reply = 'CREATE-TASK :: auto :: Fix copy :: Change "Sign in" :: "Log in" in the header.';
    const d = parseFileDirective(reply);
    expect(d?.phaseHint).toBe('auto');
    expect(d?.title).toBe('Fix copy');
    expect(d?.work).toBe('Change "Sign in" :: "Log in" in the header.');
  });

  it('returns null when there is no directive (a pushback reply)', () => {
    expect(parseFileDirective("That's too vague — which screen, and what exactly?")).toBeNull();
  });

  it('returns null for a directive with no title (never files an untitled task)', () => {
    expect(parseFileDirective('CREATE-TASK :: auto ::  ::')).toBeNull();
  });

  it('uses the LAST directive line if more than one appears', () => {
    const reply = 'CREATE-TASK :: A :: first :: x\nCREATE-TASK :: B :: second :: y';
    expect(parseFileDirective(reply)?.title).toBe('second');
  });
});

describe('stripFileDirective', () => {
  it('removes the directive line, leaving only the prose reply', () => {
    const reply = "Okay, filing it.\nCREATE-TASK :: auto :: Tweak :: Do the thing.";
    expect(stripFileDirective(reply)).toBe('Okay, filing it.');
  });

  it('leaves a pushback reply untouched', () => {
    const reply = 'Too big for one task — can we split it?';
    expect(stripFileDirective(reply)).toBe(reply);
  });
});

// The Punch List reads its own transcript from .nucleus/rooms/work-request.json.
describe('the Punch List transcript', () => {
  it('reads the work-request transcript from its file', async () => {
    const ws = await mkdtemp(path.join(os.tmpdir(), 'nucleus-intake-'));
    try {
      const roomsDir = path.join(ws, '.nucleus', 'rooms');
      await mkdir(roomsDir, { recursive: true });
      await writeFile(
        path.join(roomsDir, 'work-request.json'),
        JSON.stringify({ messages: [{ role: 'user', text: 'punch-list item' }] }),
      );

      expect((await readWorkRequestLog(ws)).map((m) => m.text)).toEqual(['punch-list item']);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it('reads as empty when there is no transcript yet', async () => {
    const ws = await mkdtemp(path.join(os.tmpdir(), 'nucleus-intake-'));
    try {
      expect(await readWorkRequestLog(ws)).toEqual([]);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------------- *
 * runWorkRequestTurn — the entry point roomHandlers' work-request:send calls.
 * Real temp workspaces seeded with a plan (canonical task files carrying the
 * phase in their Feature line), the CLI invoker mocked to script Richard.
 * ------------------------------------------------------------------------- */

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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-intake-turn-'));
  tmpDirs.push(dir);
  await mkdir(path.join(dir, '.nucleus'), { recursive: true });
  await mkdir(path.join(dir, 'tasks'), { recursive: true });
  return dir;
}

/** Seed one canonical task file (the shape listTasks/readProjectPlan parse). */
async function writeTask(
  dir: string,
  opts: { number: number; title: string; feature: string; status?: string },
): Promise<void> {
  let content = createTaskFileContent({
    number: opts.number,
    title: opts.title,
    owner: 'developer',
    feature: opts.feature,
    goal: `Build ${opts.title}.`,
    acceptanceCriteria: ['It works end to end.'],
  });
  if (opts.status && opts.status !== 'todo') {
    content = content.replace('- **Status:** todo', `- **Status:** ${opts.status}`);
  }
  const id = `task-${String(opts.number).padStart(3, '0')}`;
  await writeFile(path.join(dir, 'tasks', `${id}.md`), content, 'utf8');
}

/** A team whose Architect seat has a (mocked) CLI assigned. */
function teamWithArchitect(): ProjectTeam {
  const team = {} as ProjectTeam;
  for (const id of ALL_ROLE_IDS) {
    team[id] = createDefaultRoleConfiguration(id);
  }
  team.architect.assignment = assignmentFromPreset('claude');
  return team;
}

function userSays(text: string): ChatMessage[] {
  return [{ role: 'user', text }];
}

async function taskFiles(dir: string): Promise<string[]> {
  return (await readdir(path.join(dir, 'tasks'))).filter((f) => /^task-\d+\.md$/.test(f)).sort();
}

beforeEach(() => {
  mockInvoke.mockReset();
});

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('runWorkRequestTurn — Richard accepts and the APP files the task', () => {
  it('a CREATE-TASK directive lands a canonical task file; the reply strips the directive', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Build homepage', feature: 'Phase 1' });
    await writeTask(dir, { number: 2, title: 'Polish styles', feature: 'Phase 2' });
    const team = teamWithArchitect();
    mockInvoke.mockResolvedValue(
      inv({
        output:
          "Fine — that's small enough, filing it.\nCREATE-TASK :: Phase 2 :: Add dark mode :: Add a dark-mode toggle to the site header.",
      }),
    );

    const result = await runWorkRequestTurn(dir, team, userSays('Add a dark mode toggle'), 'canon');

    // The result reports the filing…
    expect(result.ok).toBe(true);
    expect(result.createdTaskId).toBe('task-003');
    expect(result.phaseName).toBe('Phase 2');
    // …the user-visible reply has the directive line STRIPPED, prose + filing note kept.
    expect(result.reply).not.toContain('CREATE-TASK');
    expect(result.reply).toContain("Fine — that's small enough, filing it.");
    expect(result.reply).toContain('_Filed as task-003 under "Phase 2". The Bullpen picks it up in turn._');

    // The APP (not the CLI) wrote the canonical task file, matching createdTaskId.
    const content = await readFile(path.join(dir, 'tasks', 'task-003.md'), 'utf8');
    const parsed = parseTaskFile(content);
    expect(parsed.id).toBe('task-003');
    expect(parsed.title).toBe('Add dark mode');
    expect(parsed.feature).toBe('Phase 2');
    expect(parsed.status).toBe('todo');
    // Goal = Richard's work sentence + the Punch List attribution footer.
    expect(content).toContain('Add a dark-mode toggle to the site header.');
    expect(content).toContain('The Punch List');
    // The channel's single acceptance criterion, in canonical [AC1] form.
    expect(content).toContain('**[AC1]** The requested change is implemented as described');

    // The transcript persisted the turn with the STRIPPED reply.
    const log = await readWorkRequestLog(dir);
    expect(log).toHaveLength(2);
    expect(log[0]).toEqual({ role: 'user', text: 'Add a dark mode toggle' });
    expect(log[1].role).toBe('persona');
    expect(log[1].text).toBe(result.reply);

    // Wiring: the turn ran on the work-request surface as the architect, and the
    // prompt carried the plan's phases for placement.
    const [, callOpts] = mockInvoke.mock.calls[0];
    expect(callOpts.surface).toBe('work-request');
    expect(callOpts.role).toBe('architect');
    expect(callOpts.prompt).toContain('- Phase 1');
    expect(callOpts.prompt).toContain('- Phase 2');
  });

  it('a directive naming a NONEXISTENT phase falls back to the active phase', async () => {
    const dir = await makeWorkspace();
    // Phase 1 is finished (terminal), Phase 2 is still building → the active phase.
    await writeTask(dir, { number: 1, title: 'Ship v1', feature: 'Phase 1', status: 'verified' });
    await writeTask(dir, { number: 2, title: 'Polish', feature: 'Phase 2', status: 'todo' });
    const team = teamWithArchitect();
    mockInvoke.mockResolvedValue(
      inv({
        output:
          'Filing it.\nCREATE-TASK :: Deployment Extras :: Tighten headers :: Add security headers to every response.',
      }),
    );

    const result = await runWorkRequestTurn(dir, team, userSays('Harden the headers'), 'canon');

    expect(result.ok).toBe(true);
    expect(result.createdTaskId).toBe('task-003');
    // "Deployment Extras" matches no existing phase → activePhaseOf picks Phase 2.
    expect(result.phaseName).toBe('Phase 2');
    const parsed = parseTaskFile(await readFile(path.join(dir, 'tasks', 'task-003.md'), 'utf8'));
    expect(parsed.feature).toBe('Phase 2');
    expect(result.reply).toContain('_Filed as task-003 under "Phase 2"');
  });
});

describe('runWorkRequestTurn — pushback and failure paths', () => {
  it('a pushback (no directive) files nothing and passes the reply through', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Build homepage', feature: 'Phase 1' });
    const team = teamWithArchitect();
    const pushback = 'Which screen — the dashboard or the settings page?';
    mockInvoke.mockResolvedValue(inv({ output: pushback }));

    const result = await runWorkRequestTurn(dir, team, userSays('Make it better'), 'canon');

    expect(result.ok).toBe(true);
    expect(result.reply).toBe(pushback);
    expect(result.createdTaskId).toBeNull();
    expect(result.phaseName).toBeNull();
    // No new task file — the seeded plan is untouched.
    expect(await taskFiles(dir)).toEqual(['task-001.md']);
    // The pushback turn IS persisted (a normal successful turn).
    const log = await readWorkRequestLog(dir);
    expect(log.map((m) => m.text)).toEqual(['Make it better', pushback]);
  });

  it('a failed CLI turn returns ok:false and the transcript does NOT gain the turn', async () => {
    const dir = await makeWorkspace();
    await writeTask(dir, { number: 1, title: 'Build homepage', feature: 'Phase 1' });
    const team = teamWithArchitect();
    // A prior exchange already on disk — it must survive unchanged.
    const prior: ChatMessage[] = [
      { role: 'user', text: 'earlier ask' },
      { role: 'persona', text: 'earlier reply' },
    ];
    await mkdir(path.join(dir, '.nucleus', 'rooms'), { recursive: true });
    await writeFile(
      path.join(dir, '.nucleus', 'rooms', 'work-request.json'),
      JSON.stringify({ schemaVersion: 1, messages: prior }),
    );
    mockInvoke.mockResolvedValue(inv({ ok: false, output: '', error: 'CLI exploded' }));

    const result = await runWorkRequestTurn(
      dir,
      team,
      [...prior, { role: 'user', text: 'one more thing' }],
      'canon',
    );

    expect(result).toEqual({ ok: false, reply: '', error: 'CLI exploded' });
    // The failed turn was never persisted — the disk transcript is exactly the prior state.
    expect(await readWorkRequestLog(dir)).toEqual(prior);
    // And nothing was filed.
    expect(await taskFiles(dir)).toEqual(['task-001.md']);
  });

  it('an exit-0 EMPTY reply is a failure, not a silent turn', async () => {
    const dir = await makeWorkspace();
    const team = teamWithArchitect();
    mockInvoke.mockResolvedValue(inv({ ok: true, output: '   \n' }));

    const result = await runWorkRequestTurn(dir, team, userSays('hello'), 'canon');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('No response from the Architect CLI.');
    expect(await readWorkRequestLog(dir)).toEqual([]);
  });

  it('refuses when the Architect seat has no CLI assigned (no invoke attempted)', async () => {
    const dir = await makeWorkspace();
    const team = teamWithArchitect();
    team.architect.assignment = null;

    const result = await runWorkRequestTurn(dir, team, userSays('add a thing'), 'canon');

    expect(result.ok).toBe(false);
    expect(result.error).toBe("The Architect has no CLI assigned on the project's team.");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('refuses when the last message is not a user turn', async () => {
    const dir = await makeWorkspace();
    const team = teamWithArchitect();

    const result = await runWorkRequestTurn(
      dir,
      team,
      [{ role: 'persona', text: 'my last word' }],
      'canon',
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('No message to send.');
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
