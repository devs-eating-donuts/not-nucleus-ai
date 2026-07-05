import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { META_FILES, WORKSPACE_MARKER_KIND } from '../../shared/markdown';
import { assertSafeToDeleteFolder, within } from './projectDeletion';

const made: string[] = [];

async function makeWorkspace(opts: {
  /** marker id to write, or undefined for no marker file. */
  markerId?: string;
  /** also drop a user file Nucleus didn't create. */
  userContent?: boolean;
  /** also seed the app-created git entries (.git dir + .gitignore). */
  gitTracked?: boolean;
}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nucleus-deltest-'));
  made.push(dir);
  await fs.mkdir(path.join(dir, '.nucleus'), { recursive: true });
  await fs.mkdir(path.join(dir, 'tasks'), { recursive: true }); // a managed dir
  if (opts.markerId !== undefined) {
    await fs.writeFile(
      path.join(dir, META_FILES.marker),
      JSON.stringify({ kind: WORKSPACE_MARKER_KIND, id: opts.markerId }),
    );
  }
  if (opts.userContent) {
    await fs.writeFile(path.join(dir, 'index.html'), '<html></html>');
  }
  if (opts.gitTracked) {
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
    await fs.writeFile(path.join(dir, '.gitignore'), 'node_modules/\n');
  }
  return dir;
}

afterAll(async () => {
  await Promise.all(made.map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('assertSafeToDeleteFolder', () => {
  it('refuses a filesystem/drive root', async () => {
    await expect(assertSafeToDeleteFolder(path.parse(process.cwd()).root)).rejects.toThrow(
      /drive root/,
    );
  });

  it('refuses a folder with no .nucleus/', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nucleus-deltest-'));
    made.push(dir);
    await expect(assertSafeToDeleteFolder(dir)).rejects.toThrow(/does not look like a Nucleus/);
  });

  it('allows an app-created workspace (marker matches id) even with user content', async () => {
    const ws = await makeWorkspace({ markerId: 'abc', userContent: true });
    await expect(assertSafeToDeleteFolder(ws, 'abc')).resolves.toBeUndefined();
  });

  it('allows a marker-keyed workspace when no expected id is supplied', async () => {
    const ws = await makeWorkspace({ markerId: 'abc', userContent: true });
    await expect(assertSafeToDeleteFolder(ws)).resolves.toBeUndefined();
  });

  it('refuses a legacy workspace (no marker) that holds user content', async () => {
    const ws = await makeWorkspace({ userContent: true });
    await expect(assertSafeToDeleteFolder(ws)).rejects.toThrow(/files Nucleus didn't create/);
  });

  it('allows a legacy workspace (no marker) with only Nucleus-managed entries', async () => {
    const ws = await makeWorkspace({ userContent: false });
    await expect(assertSafeToDeleteFolder(ws)).resolves.toBeUndefined();
  });

  it('allows a marker-less git-tracked workspace (the app-created .git/.gitignore are managed)', async () => {
    const ws = await makeWorkspace({ userContent: false, gitTracked: true });
    await expect(assertSafeToDeleteFolder(ws)).resolves.toBeUndefined();
  });

  it('refuses when the marker id mismatches and user content is present', async () => {
    const ws = await makeWorkspace({ markerId: 'abc', userContent: true });
    await expect(assertSafeToDeleteFolder(ws, 'different-id')).rejects.toThrow(
      /files Nucleus didn't create/,
    );
  });
});

describe('within (shared containment guard)', () => {
  const root = path.resolve(path.parse(process.cwd()).root, 'proj', 'workspace');

  it('is true for the folder itself and any descendant', () => {
    expect(within(root, root)).toBe(true);
    expect(within(root, path.join(root, 'export.md'))).toBe(true);
    expect(within(root, path.join(root, 'nested', 'deep', 'file.md'))).toBe(true);
  });

  it('is false for a sibling or a name-prefix neighbor (the startsWith trap)', () => {
    expect(within(root, path.resolve(root, '..', 'other'))).toBe(false);
    // `${root}-backup` shares the string prefix but is NOT inside root.
    expect(within(root, `${root}-backup`)).toBe(false);
  });

  it('is case-insensitive so a differently-cased path still counts as inside (NTFS)', () => {
    const shouty = path.join(root.toUpperCase(), 'EXPORT.MD');
    expect(within(root, shouty)).toBe(true);
  });
});
