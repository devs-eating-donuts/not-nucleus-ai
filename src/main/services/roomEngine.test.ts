import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assignmentFromPreset } from '../../shared/cliAssignment';
import type { ProjectTeam } from '../../shared/project';
import type { ChatMessage } from '../../shared/room';
import { ALL_ROLE_IDS } from '../../shared/roles';
import type { RoleId } from '../../shared/roles';
import { createDefaultRoleConfiguration } from '../../shared/settings';

// lessonsStore (via lessonsContext → lessonsInjection) imports `app` from electron —
// stub it so the best-effort pitfalls block resolves against a harmless tmp path.
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

// The whole point: mock the CLI invoker so we can script the persona's reply and
// capture the exact prompt the room engine assembles, without spawning a real agent.
vi.mock('./cliInvoker', () => ({ invokeCli: vi.fn() }));

import { invokeCli } from './cliInvoker';
import { readRoomLog, runRoomKickoff, runRoomTurn } from './roomEngine';

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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-room-'));
  tmpDirs.push(dir);
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

function transcriptPath(dir: string, roleId: RoleId): string {
  return path.join(dir, '.nucleus', 'rooms', `${roleId}.json`);
}

async function readTranscriptFile(
  dir: string,
  roleId: RoleId,
): Promise<{ roleId?: string; messages: ChatMessage[] }> {
  return JSON.parse(await readFile(transcriptPath(dir, roleId), 'utf8'));
}

async function fileExists(absPath: string): Promise<boolean> {
  return readFile(absPath, 'utf8').then(
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

describe('runRoomTurn — happy path', () => {
  it('returns the trimmed reply and persists the transcript ending with the persona turn', async () => {
    const dir = await makeWorkspace();
    const team = makeTeam(['projectLead']);
    mockInvoke.mockResolvedValue(inv({ output: '  Great. Who exactly is this for?  \n' }));

    const messages: ChatMessage[] = [{ role: 'user', text: 'I want to build a podcast site.' }];
    const result = await runRoomTurn(dir, 'projectLead', team, messages, 'canon');

    expect(result).toEqual({ ok: true, reply: 'Great. Who exactly is this for?' });

    // Persisted at .nucleus/rooms/<roleId>.json, ending with the persona reply.
    const onDisk = await readTranscriptFile(dir, 'projectLead');
    expect(onDisk.roleId).toBe('projectLead');
    expect(onDisk.messages).toEqual([
      { role: 'user', text: 'I want to build a podcast site.' },
      { role: 'persona', text: 'Great. Who exactly is this for?' },
    ]);
    // readRoomLog round-trips the same transcript.
    expect(await readRoomLog(dir, 'projectLead')).toEqual(onDisk.messages);

    // Conversational invocation: tmp cwd (never the workspace), tagged for The Garage.
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const opts = mockInvoke.mock.calls[0][1];
    expect(opts.cwd).toBe(os.tmpdir());
    expect(opts.autopilot).toBeUndefined();
    expect(opts.surface).toBe('room');
    expect(opts.role).toBe('projectLead');
    expect(opts.prompt).toContain('Founder: I want to build a podcast site.');
    expect(opts.prompt.endsWith('Reply with your next message only, in character.')).toBe(true);
  });
});

describe('runRoomTurn — failed invocation', () => {
  it('returns ok:false and the existing transcript on disk does NOT gain the failed turn', async () => {
    const dir = await makeWorkspace();
    const team = makeTeam(['projectLead']);

    // Seed a prior successful exchange directly on disk.
    const prior: ChatMessage[] = [
      { role: 'user', text: 'hello' },
      { role: 'persona', text: 'hi there' },
    ];
    await mkdir(path.dirname(transcriptPath(dir, 'projectLead')), { recursive: true });
    await writeFile(
      transcriptPath(dir, 'projectLead'),
      JSON.stringify({ schemaVersion: 1, roleId: 'projectLead', messages: prior }),
      'utf8',
    );

    mockInvoke.mockResolvedValue(inv({ ok: false, error: 'CLI exploded' }));
    const result = await runRoomTurn(
      dir,
      'projectLead',
      team,
      [...prior, { role: 'user', text: 'a new question' }],
      'canon',
    );

    expect(result).toEqual({ ok: false, reply: '', error: 'CLI exploded' });
    // The failed turn was never persisted — disk still holds only the prior exchange.
    const onDisk = await readTranscriptFile(dir, 'projectLead');
    expect(onDisk.messages).toEqual(prior);
  });

  it('a whitespace-only exit-0 reply is a failure ("No response from the CLI.") and writes nothing', async () => {
    const dir = await makeWorkspace();
    const team = makeTeam(['projectLead']);
    mockInvoke.mockResolvedValue(inv({ ok: true, output: '   \n' }));

    const result = await runRoomTurn(
      dir,
      'projectLead',
      team,
      [{ role: 'user', text: 'hello?' }],
      'canon',
    );

    expect(result).toEqual({ ok: false, reply: '', error: 'No response from the CLI.' });
    expect(await fileExists(transcriptPath(dir, 'projectLead'))).toBe(false);
  });
});

describe('runRoomTurn — empty message list', () => {
  it("refuses with 'No message to send.' without invoking the CLI", async () => {
    const dir = await makeWorkspace();
    const team = makeTeam(['projectLead']);

    const result = await runRoomTurn(dir, 'projectLead', team, [], 'canon');

    expect(result).toEqual({ ok: false, reply: '', error: 'No message to send.' });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(await fileExists(transcriptPath(dir, 'projectLead'))).toBe(false);
  });
});

describe('runRoomTurn — prompt window', () => {
  it('embeds only the newest 40 messages of a longer transcript in the prompt', async () => {
    const dir = await makeWorkspace();
    const team = makeTeam(['projectLead']);
    mockInvoke.mockResolvedValue(inv({ output: 'noted' }));

    // 45 alternating messages, msg-01 (user) … msg-45 (user). Zero-padded tokens so a
    // substring check can never collide (msg-05 vs msg-45).
    const messages: ChatMessage[] = Array.from({ length: 45 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('persona' as const),
      text: `msg-${String(i + 1).padStart(2, '0')}`,
    }));

    const result = await runRoomTurn(dir, 'projectLead', team, messages, 'canon');
    expect(result.ok).toBe(true);

    const prompt = mockInvoke.mock.calls[0][1].prompt;
    // The five oldest rolled out of the prompt window…
    for (const n of ['01', '02', '03', '04', '05']) {
      expect(prompt).not.toContain(`msg-${n}`);
    }
    // …the newest 40 (msg-06 … msg-45) are embedded, speaker-labelled.
    expect(prompt).toContain('You: msg-06'); // index 5 → persona
    expect(prompt).toContain('Founder: msg-45');
    for (const n of ['06', '20', '44', '45']) {
      expect(prompt).toContain(`msg-${n}`);
    }

    // Persistence is NOT windowed: the full 45 + the reply land on disk.
    const onDisk = await readTranscriptFile(dir, 'projectLead');
    expect(onDisk.messages).toHaveLength(46);
    expect(onDisk.messages[0]).toEqual({ role: 'user', text: 'msg-01' });
    expect(onDisk.messages.at(-1)).toEqual({ role: 'persona', text: 'noted' });
  });
});

describe('runRoomKickoff', () => {
  it('persists a single opening persona message on an empty room', async () => {
    const dir = await makeWorkspace();
    const team = makeTeam(['projectLead']);
    mockInvoke.mockResolvedValue(inv({ output: 'So — a podcast site. Who is it for?' }));

    const result = await runRoomKickoff(dir, 'projectLead', team, 'canon');

    expect(result).toEqual({ ok: true, reply: 'So — a podcast site. Who is it for?' });
    const onDisk = await readTranscriptFile(dir, 'projectLead');
    expect(onDisk.messages).toEqual([
      { role: 'persona', text: 'So — a podcast site. Who is it for?' },
    ]);
    // The opening instruction rides the prompt (the persona speaks first).
    expect(mockInvoke.mock.calls[0][1].prompt).toContain('Open the session');
  });

  it('a second kickoff on the now-non-empty room is a no-op (no duplicate opening, no CLI call)', async () => {
    const dir = await makeWorkspace();
    const team = makeTeam(['projectLead']);
    mockInvoke.mockResolvedValue(inv({ output: 'Opening message.' }));

    await runRoomKickoff(dir, 'projectLead', team, 'canon');
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    const second = await runRoomKickoff(dir, 'projectLead', team, 'canon');

    expect(second).toEqual({ ok: true, reply: '' });
    expect(mockInvoke).toHaveBeenCalledTimes(1); // still just the first call
    const onDisk = await readTranscriptFile(dir, 'projectLead');
    expect(onDisk.messages).toEqual([{ role: 'persona', text: 'Opening message.' }]);
  });

  it('a role without an opening prompt refuses without invoking the CLI', async () => {
    const dir = await makeWorkspace();
    const team = makeTeam(['developer']);

    const result = await runRoomKickoff(dir, 'developer', team, 'canon');

    expect(result).toEqual({
      ok: false,
      reply: '',
      error: 'This role does not open the conversation.',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('a failed kickoff invocation persists nothing', async () => {
    const dir = await makeWorkspace();
    const team = makeTeam(['architect']);
    mockInvoke.mockResolvedValue(inv({ ok: false, error: 'not signed in' }));

    const result = await runRoomKickoff(dir, 'architect', team, 'canon');

    expect(result).toEqual({ ok: false, reply: '', error: 'not signed in' });
    expect(await fileExists(transcriptPath(dir, 'architect'))).toBe(false);
  });
});
