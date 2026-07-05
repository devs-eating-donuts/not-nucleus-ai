import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the I/O deps so we can drive ensureStackUp/stackDown's control flow + caching.
const { access, resolveCommand, runResolvedCommand } = vi.hoisted(() => ({
  access: vi.fn(),
  resolveCommand: vi.fn(),
  runResolvedCommand: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({ default: { access } }));
vi.mock('./cliValidator', () => ({ resolveCommand, runResolvedCommand }));

import { ensureStackUp, stackDown } from './stackManager';

const ok = { ok: true, code: 0, output: '' };
const fail = { ok: false, code: 1, output: 'Cannot connect to the Docker daemon' };

// The module cache is keyed by workspace path, so a unique path per test = fresh state.
let n = 0;
const freshWs = (): string => `/ws/proj-${++n}`;

beforeEach(() => {
  access.mockReset();
  resolveCommand.mockReset();
  runResolvedCommand.mockReset();
});

describe('stackManager.ensureStackUp', () => {
  it('no compose file → no-op, and is NOT cached (brings it up once it appears later)', async () => {
    const ws = freshWs();
    access.mockRejectedValue(new Error('ENOENT')); // no compose file yet
    expect(await ensureStackUp(ws)).toBe('');
    expect(resolveCommand).not.toHaveBeenCalled(); // didn't even reach docker

    // The setup task now writes the compose file — a later step must bring it up.
    access.mockResolvedValue(undefined);
    resolveCommand.mockResolvedValue('/usr/bin/docker');
    runResolvedCommand.mockResolvedValue(ok);
    expect(await ensureStackUp(ws)).toMatch(/started/);
  });

  it('docker missing → notes once, silent on repeat', async () => {
    const ws = freshWs();
    access.mockResolvedValue(undefined);
    resolveCommand.mockResolvedValue(null);
    expect(await ensureStackUp(ws)).toMatch(/isn’t on PATH/);
    expect(await ensureStackUp(ws)).toBe('');
  });

  it('up succeeds → cached (no second docker call)', async () => {
    const ws = freshWs();
    access.mockResolvedValue(undefined);
    resolveCommand.mockResolvedValue('/usr/bin/docker');
    runResolvedCommand.mockResolvedValue(ok);
    expect(await ensureStackUp(ws)).toMatch(/started/);
    runResolvedCommand.mockClear();
    expect(await ensureStackUp(ws)).toBe(''); // cached
    expect(runResolvedCommand).not.toHaveBeenCalled();
  });

  it('transient up failure is NOT cached → a later step retries and succeeds', async () => {
    const ws = freshWs();
    access.mockResolvedValue(undefined);
    resolveCommand.mockResolvedValue('/usr/bin/docker');
    runResolvedCommand.mockResolvedValueOnce(fail);
    expect(await ensureStackUp(ws)).toMatch(/failed/);
    runResolvedCommand.mockResolvedValueOnce(ok); // daemon came up
    expect(await ensureStackUp(ws)).toMatch(/started/);
  });

  it('timeout reports a pull-in-progress message (not "is Docker running?")', async () => {
    const ws = freshWs();
    access.mockResolvedValue(undefined);
    resolveCommand.mockResolvedValue('/usr/bin/docker');
    runResolvedCommand.mockResolvedValue({ ok: false, code: null, output: '[timed out]', timedOut: true });
    expect(await ensureStackUp(ws)).toMatch(/still pulling images/);
  });
});

describe('stackManager.stackDown', () => {
  it('tears down only a stack we got up; no-op otherwise', async () => {
    const ws = freshWs();
    access.mockResolvedValue(undefined);
    resolveCommand.mockResolvedValue('/usr/bin/docker');
    runResolvedCommand.mockResolvedValue(ok);
    await ensureStackUp(ws); // now up + cached

    runResolvedCommand.mockClear();
    runResolvedCommand.mockResolvedValue(ok);
    expect(await stackDown(ws)).toMatch(/stopped/);
    expect(runResolvedCommand).toHaveBeenCalledWith('/usr/bin/docker', ['compose', 'down'], expect.anything());

    // A workspace we never brought up → no teardown.
    expect(await stackDown(freshWs())).toBeNull();
  });
});
