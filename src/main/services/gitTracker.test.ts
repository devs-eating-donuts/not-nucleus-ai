import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// gitTracker reads settings via settingsStore, which imports `app` from electron.
// Mock it so the cached read resolves to defaults (gitTracking defaults to true).
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

import {
  commitWorkspaceStep,
  initWorkspaceRepo,
  resetGitPathCacheForTests,
  sanitizeMessage,
  samePath,
} from './gitTracker';

const exec = promisify(execFile);

async function gitAvailable(): Promise<boolean> {
  try {
    await exec('git', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/** Commit subjects (newest first), or [] for an empty repo / non-repo. */
async function subjects(dir: string): Promise<string[]> {
  try {
    const { stdout } = await exec('git', ['-C', dir, 'log', '--pretty=%s']);
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function currentBranch(dir: string): Promise<string> {
  const { stdout } = await exec('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout.trim();
}

const tmpDirs: string[] = [];
async function makeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-git-'));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  resetGitPathCacheForTests();
});

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('gitTracker (real git)', () => {
  it('inits a repo on main with an initial commit, then commits each step', async () => {
    if (!(await gitAvailable())) return; // no git on this machine — nothing to verify
    const ws = await makeDir();
    await writeFile(path.join(ws, 'README.md'), '# scaffold\n');

    await initWorkspaceRepo(ws, true);
    expect(existsSync(path.join(ws, '.git'))).toBe(true);
    expect(await currentBranch(ws)).toBe('main');
    expect(await subjects(ws)).toEqual(['Initial project scaffold']);

    // A step that changed a file produces a commit with the structured message.
    await writeFile(path.join(ws, 'app.ts'), 'export const x = 1;\n');
    await commitWorkspaceStep(ws, 'task-001: dev (attempt 1/5)');
    expect(await subjects(ws)).toEqual(['task-001: dev (attempt 1/5)', 'Initial project scaffold']);
  });

  it('skips an empty commit when nothing changed', async () => {
    if (!(await gitAvailable())) return;
    const ws = await makeDir();
    await writeFile(path.join(ws, 'README.md'), '# scaffold\n');
    await initWorkspaceRepo(ws, true);

    await commitWorkspaceStep(ws, 'task-001: QA PASS'); // nothing changed since init
    expect(await subjects(ws)).toEqual(['Initial project scaffold']);
  });

  it('does nothing when git tracking is off for the project (enabled=false)', async () => {
    if (!(await gitAvailable())) return;
    const ws = await makeDir();
    await writeFile(path.join(ws, 'README.md'), '# scaffold\n');

    await initWorkspaceRepo(ws, false);
    expect(existsSync(path.join(ws, '.git'))).toBe(false); // no repo created

    // A later step is a no-op too — there is no repo to commit to.
    await writeFile(path.join(ws, 'app.ts'), 'export const x = 1;\n');
    await commitWorkspaceStep(ws, 'task-001: dev');
    expect(existsSync(path.join(ws, '.git'))).toBe(false);
  });

  it('leaves a workspace nested inside a parent repo alone', async () => {
    if (!(await gitAvailable())) return;
    const parent = await makeDir();
    await exec('git', ['-C', parent, 'init', '-b', 'main']);
    await exec('git', ['-C', parent, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'parent root']);
    const ws = path.join(parent, 'workspace');
    await mkdir(ws);
    await writeFile(path.join(ws, 'README.md'), '# nested\n');

    await initWorkspaceRepo(ws, true);
    expect(existsSync(path.join(ws, '.git'))).toBe(false); // never nest a repo

    await commitWorkspaceStep(ws, 'task-001: dev');
    // The parent repo must not have gained our commit.
    expect(await subjects(parent)).toEqual(['parent root']);
  });
});

describe('sanitizeMessage (commit-message injection defense)', () => {
  it('collapses a multi-line message to a single line', () => {
    const out = sanitizeMessage('Phase complete: Auth\nSecond line\r\nThird');
    expect(out).not.toMatch(/[\r\n]/);
    expect(out).toBe('Phase complete: Auth Second line Third');
  });

  it('collapses a run of newlines into a single space', () => {
    // A run of \r\n\r\n must not leave behind multiple spaces from per-char replacement.
    const out = sanitizeMessage('a\n\n\r\nb');
    expect(out).toBe('a b');
  });

  it('strips backtick, dollar, backslash, and double-quote metacharacters', () => {
    const out = sanitizeMessage('fix `whoami` $HOME C:\\path "quoted"');
    expect(out).not.toMatch(/[`$\\"]/);
    // Surrounding text is preserved; only the metacharacters are removed.
    expect(out).toBe('fix whoami HOME C:path quoted');
  });

  it('neutralizes a shell-injection-shaped phase name', () => {
    const out = sanitizeMessage('Phase complete: $(rm -rf /) `id` "; cat /etc/passwd');
    expect(out).not.toMatch(/[`$\\"]/);
    expect(out).not.toMatch(/[\r\n]/);
    // The literal words survive but every dangerous shell metachar is gone.
    expect(out).toBe('Phase complete: (rm -rf /) id ; cat /etc/passwd');
  });

  it('caps the message at the 200-char limit', () => {
    const out = sanitizeMessage('x'.repeat(250));
    expect(out).toHaveLength(200);
    expect(out).toBe('x'.repeat(200));
  });

  it('caps AFTER sanitizing, so a stripped-char message is not over-truncated', () => {
    // 250 backticks strip to '', which then becomes the fallback (under the cap).
    expect(sanitizeMessage('`'.repeat(250))).toBe('Nucleus update');
  });

  it('falls back to a default when the message is empty or whitespace-only', () => {
    expect(sanitizeMessage('')).toBe('Nucleus update');
    expect(sanitizeMessage('   \n\t  ')).toBe('Nucleus update');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeMessage('  task-001: dev  ')).toBe('task-001: dev');
  });
});

describe('samePath (realpath case-fold equality)', () => {
  const isWin = process.platform === 'win32';

  it('treats a path as equal to itself', () => {
    const dir = process.cwd();
    expect(samePath(dir, dir)).toBe(true);
  });

  it('does not equate two genuinely different paths', () => {
    expect(samePath('/a/b/c', '/a/b/d')).toBe(false);
  });

  // The Windows drive-letter case-fold: git emits a lowercase-drive
  // forward-slash path while Electron supplies an uppercase-drive backslash one
  // for the SAME directory. samePath must read them as equal under win32 semantics.
  it.runIf(isWin)('equates differing-case, mixed-separator Windows paths', () => {
    expect(samePath('C:/Users/foo', 'C:\\Users\\foo')).toBe(true);
    expect(samePath('c:/users/foo', 'C:\\Users\\FOO')).toBe(true);
  });

  // On POSIX the same comparison is case-SENSITIVE (no drive letters / backslash
  // folding), so the case-folded pair must read as NOT equal — proving the
  // platform branch is real, not a tautology.
  it.runIf(!isWin)('is case-sensitive on POSIX', () => {
    expect(samePath('/Users/foo', '/users/FOO')).toBe(false);
  });
});
