import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCAFFOLDERS } from '../../shared/scaffold';

// Mock the safe-spawn layer + the workspace-boundary helper so the service is unit-testable
// without electron / a real subprocess.
vi.mock('./cliValidator', () => ({
  resolveCommand: vi.fn(),
  runResolvedCommand: vi.fn(),
}));
vi.mock('./markdownWorkspace', () => ({
  resolveWorkspacePath: (root: string, sub: string) => `${root}/${sub}`,
}));
vi.mock('node:fs/promises', () => ({
  default: { access: vi.fn(), readdir: vi.fn(), rename: vi.fn(), rmdir: vi.fn() },
}));

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveCommand, runResolvedCommand } from './cliValidator';
import { runInstall, runScaffolder } from './scaffolder';

const spec = SCAFFOLDERS['vite-react-ts'];

describe('runScaffolder (best-effort, never throws)', () => {
  beforeEach(() => {
    vi.mocked(resolveCommand).mockReset();
    vi.mocked(runResolvedCommand).mockReset();
    vi.mocked(fs.access).mockReset();
    vi.mocked(fs.readdir).mockReset();
    vi.mocked(fs.rename).mockReset();
    vi.mocked(fs.rmdir).mockReset();
  });

  it('spawns the catalog argv in the workspace cwd and verifies the marker on success', async () => {
    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/npm');
    vi.mocked(runResolvedCommand).mockResolvedValue({ ok: true, code: 0, output: 'Done' });
    vi.mocked(fs.access).mockResolvedValue(undefined); // marker exists → real scaffold

    const out = await runScaffolder('/ws', spec);
    // The marker (package.json at the root) is what we actually check, not exit code.
    expect(fs.access).toHaveBeenCalledWith('/ws/package.json');

    expect(resolveCommand).toHaveBeenCalledWith('npm');
    expect(runResolvedCommand).toHaveBeenCalledWith(
      '/usr/bin/npm',
      spec.args,
      expect.objectContaining({ cwd: '/ws' }),
    );
    expect(out).toMatchObject({
      id: 'vite-react-ts',
      attempted: true,
      ok: true,
      subdir: '.',
      error: null,
    });
  });

  it('treats exit-0-but-no-marker (the silent create-vite cancel) as a FAILURE', async () => {
    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/npm');
    // create-vite cancels on a non-empty dir: exit 0, but writes nothing.
    vi.mocked(runResolvedCommand).mockResolvedValue({ ok: true, code: 0, output: 'Operation cancelled' });
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT')); // marker absent

    const out = await runScaffolder('/ws', spec);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/produced no files/);
  });

  it('records a missing tool without spawning or throwing', async () => {
    vi.mocked(resolveCommand).mockResolvedValue(null);

    const out = await runScaffolder('/ws', spec);

    expect(runResolvedCommand).not.toHaveBeenCalled();
    expect(out).toMatchObject({ attempted: true, ok: false });
    expect(out.error).toMatch(/npm/);
  });

  it('records a non-zero exit without throwing', async () => {
    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/npm');
    vi.mocked(runResolvedCommand).mockResolvedValue({ ok: false, code: 1, output: 'boom' });

    const out = await runScaffolder('/ws', spec);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/exited with code 1/);
  });

  it('records a timeout distinctly', async () => {
    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/npm');
    vi.mocked(runResolvedCommand).mockResolvedValue({
      ok: false,
      code: null,
      output: '',
      timedOut: true,
    });

    const out = await runScaffolder('/ws', spec);
    expect(out.error).toMatch(/timed out/);
  });

  it('never throws even if the spawn helper rejects', async () => {
    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/npm');
    vi.mocked(runResolvedCommand).mockRejectedValue(new Error('explode'));

    const out = await runScaffolder('/ws', spec);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/explode/);
  });

  it('passes the fixed env and FLATTENS a named-subdir scaffolder up to the root', async () => {
    const angular = SCAFFOLDERS['angular']; // subdir 'app', flatten true, env NG_CLI_ANALYTICS
    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/npx');
    vi.mocked(runResolvedCommand).mockResolvedValue({ ok: true, code: 0, output: 'CREATE app/…' });
    // The marker lives at app/package.json; nothing exists yet at the root (no clobber).
    vi.mocked(fs.access).mockImplementation(async (p) => {
      if (String(p) === '/ws/app/package.json') return undefined;
      throw new Error('ENOENT');
    });
    vi.mocked(fs.readdir).mockResolvedValue(['package.json', '.gitignore', 'src'] as never);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
    vi.mocked(fs.rmdir).mockResolvedValue(undefined);

    const out = await runScaffolder('/ws', angular);

    // The analytics-suppressing env reached the spawn.
    expect(runResolvedCommand).toHaveBeenCalledWith(
      '/usr/bin/npx',
      angular.args,
      expect.objectContaining({ cwd: '/ws', env: { NG_CLI_ANALYTICS: 'false' } }),
    );
    // Every subdir entry (dotfiles + nested dirs) moved up to the root; subdir removed.
    expect(fs.rename).toHaveBeenCalledTimes(3);
    expect(fs.rename).toHaveBeenCalledWith(path.join('/ws/app', '.gitignore'), '/ws/.gitignore');
    expect(fs.rename).toHaveBeenCalledWith(path.join('/ws/app', 'src'), '/ws/src');
    expect(fs.rmdir).toHaveBeenCalledWith('/ws/app');
    // The reported location is the project root, not the scratch subdir.
    expect(out).toMatchObject({ id: 'angular', ok: true, subdir: '.' });
  });

  it('REFUSES to flatten over an existing root file (never clobbers)', async () => {
    const angular = SCAFFOLDERS['angular'];
    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/npx');
    vi.mocked(runResolvedCommand).mockResolvedValue({ ok: true, code: 0, output: 'ok' });
    // Marker present AND a colliding file already at the root → flatten must bail.
    vi.mocked(fs.access).mockImplementation(async (p) => {
      if (String(p) === '/ws/app/package.json' || String(p) === '/ws/package.json') return undefined;
      throw new Error('ENOENT');
    });
    vi.mocked(fs.readdir).mockResolvedValue(['package.json'] as never);

    const out = await runScaffolder('/ws', angular);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/already exists at the project root/);
    expect(fs.rename).not.toHaveBeenCalled();
  });
});

describe('runInstall (best-effort, never throws)', () => {
  beforeEach(() => {
    vi.mocked(resolveCommand).mockReset();
    vi.mocked(runResolvedCommand).mockReset();
  });

  it('runs the spec install command in the workspace cwd on success', async () => {
    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/npm');
    vi.mocked(runResolvedCommand).mockResolvedValue({ ok: true, code: 0, output: 'added 200' });

    const out = await runInstall('/ws', spec);
    expect(resolveCommand).toHaveBeenCalledWith('npm');
    expect(runResolvedCommand).toHaveBeenCalledWith(
      '/usr/bin/npm',
      ['install'],
      expect.objectContaining({ cwd: '/ws' }),
    );
    expect(out).toMatchObject({ attempted: true, ok: true, error: null });
  });

  it('records a missing tool / failure / timeout without throwing', async () => {
    vi.mocked(resolveCommand).mockResolvedValue(null);
    expect((await runInstall('/ws', spec)).ok).toBe(false);

    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/npm');
    vi.mocked(runResolvedCommand).mockResolvedValue({ ok: false, code: 1, output: 'ERESOLVE' });
    expect((await runInstall('/ws', spec)).error).toMatch(/exited with code 1/);

    vi.mocked(runResolvedCommand).mockResolvedValue({ ok: false, code: null, output: '', timedOut: true });
    expect((await runInstall('/ws', spec)).error).toMatch(/timed out/);

    vi.mocked(runResolvedCommand).mockRejectedValue(new Error('boom'));
    expect((await runInstall('/ws', spec)).error).toMatch(/boom/);
  });
});
