import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// referencesStore → atomicWrite / markdownWorkspace may pull `app` from electron
// transitively; mock it so the store runs against a plain temp workspace.
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

import { addReferences, listReferences, removeReference, setReferenceNote } from './referencesStore';

/** Create a .tar of a directory's contents via the system tar; false if unavailable. */
function makeTar(srcDir: string, outFile: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('tar', ['-cf', outFile, '-C', srcDir, '.'], { stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

const tmpDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-refs-'));
  tmpDirs.push(dir);
  await mkdir(path.join(dir, '.nucleus'), { recursive: true });
  return dir;
}

async function makeSource(dir: string, name: string): Promise<string> {
  const src = path.join(dir, name);
  await writeFile(src, 'reference-bytes');
  return src;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('referencesStore add/remove/note round-trip', () => {
  it('dedupes a re-added file to a parenthesized name', async () => {
    const dir = await makeWorkspace();
    const src = await makeSource(dir, 'logo.png');
    const result = await addReferences(dir, [src, src]);
    const names = result.references.map((r) => r.fileName);
    expect(names).toContain('logo.png');
    expect(names).toContain('logo (2).png');
  });

  it('removes a deduped file whose name has parentheses (the reported bug)', async () => {
    const dir = await makeWorkspace();
    const src = await makeSource(dir, 'logo.png');
    await addReferences(dir, [src, src]);

    // Before the fix, re-sanitizing "logo (2).png" → "logo _2_.png" made this a
    // silent no-op, so the Remove button appeared dead.
    const after = await removeReference(dir, 'logo (2).png');
    const remaining = after.map((r) => r.fileName);
    expect(remaining).toContain('logo.png');
    expect(remaining).not.toContain('logo (2).png');

    const onDisk = await readdir(path.join(dir, 'references'));
    expect(onDisk).not.toContain('logo (2).png');
  });

  it('saves a note on a parenthesized dedupe name', async () => {
    const dir = await makeWorkspace();
    const src = await makeSource(dir, 'shot.png');
    await addReferences(dir, [src, src]);

    const after = await setReferenceNote(dir, 'shot (2).png', 'the look I want');
    expect(after.find((r) => r.fileName === 'shot (2).png')?.note).toBe('the look I want');
  });

  it('no-ops cleanly when removing a name that is not present', async () => {
    const dir = await makeWorkspace();
    const src = await makeSource(dir, 'a.png');
    await addReferences(dir, [src]);
    const after = await removeReference(dir, 'does-not-exist.png');
    expect(after.map((r) => r.fileName)).toEqual(['a.png']);
  });
});

describe('referencesStore archive uploads', () => {
  it('surfaces an extracted-archive folder as one archive reference and removes it recursively', async () => {
    const dir = await makeWorkspace();
    await mkdir(path.join(dir, 'references', 'poc', 'src'), { recursive: true });
    await writeFile(path.join(dir, 'references', 'poc', 'src', 'index.ts'), 'export const x = 1;\n');
    await writeFile(path.join(dir, 'references', 'poc', 'README.md'), '# poc\n');

    const list = await listReferences(dir);
    const poc = list.find((r) => r.fileName === 'poc');
    expect(poc?.kind).toBe('archive');
    expect(poc?.sizeBytes ?? 0).toBeGreaterThan(0);

    const after = await removeReference(dir, 'poc');
    expect(after.find((r) => r.fileName === 'poc')).toBeUndefined();
    const onDisk = await readdir(path.join(dir, 'references')).catch(() => []);
    expect(onDisk).not.toContain('poc');
  });

  it('extracts an uploaded .tar, keeping source files and skipping secrets/deps', async () => {
    const dir = await makeWorkspace();
    const proj = await mkdtemp(path.join(os.tmpdir(), 'nucleus-poc-'));
    tmpDirs.push(proj);
    await mkdir(path.join(proj, 'src'), { recursive: true });
    await writeFile(path.join(proj, 'src', 'index.ts'), 'export const x = 1;\n');
    await writeFile(path.join(proj, 'README.md'), '# my poc\n');
    await writeFile(path.join(proj, '.env'), 'SECRET=skip-me\n');
    await mkdir(path.join(proj, 'node_modules'), { recursive: true });
    await writeFile(path.join(proj, 'node_modules', 'junk.js'), '1;\n');

    const outDir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-tar-'));
    tmpDirs.push(outDir);
    const tarPath = path.join(outDir, 'poc.tar');
    if (!(await makeTar(proj, tarPath))) {
      return; // no system tar on this runner — the pure filter tests still cover the logic
    }

    const res = await addReferences(dir, [tarPath]);
    expect(res.added).toContain('poc');
    const extracted = await readdir(path.join(dir, 'references', 'poc'));
    expect(extracted).toContain('src');
    expect(extracted).toContain('README.md');
    expect(extracted).not.toContain('.env'); // secret skipped
    expect(extracted).not.toContain('node_modules'); // dependency folder skipped
  });
});
