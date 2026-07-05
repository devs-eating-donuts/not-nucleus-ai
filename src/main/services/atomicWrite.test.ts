import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeFileAtomic, writeJsonAtomic } from './atomicWrite';

const made: string[] = [];
afterAll(async () => {
  await Promise.all(made.map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function tmpDir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'nucleus-aw-'));
  made.push(d);
  return d;
}

describe('atomicWrite', () => {
  it('writeFileAtomic writes the content and creates parent dirs', async () => {
    const f = path.join(await tmpDir(), 'nested', 'deep', 'out.txt');
    await writeFileAtomic(f, 'hello');
    expect(await fs.readFile(f, 'utf8')).toBe('hello');
    // no leftover .tmp
    expect(await fs.readdir(path.dirname(f))).toEqual(['out.txt']);
  });

  it('writeJsonAtomic round-trips pretty-printed JSON', async () => {
    const f = path.join(await tmpDir(), 'data.json');
    await writeJsonAtomic(f, { a: 1, b: ['x'] });
    const raw = await fs.readFile(f, 'utf8');
    expect(JSON.parse(raw)).toEqual({ a: 1, b: ['x'] });
    expect(raw).toContain('\n  '); // 2-space indent
  });

  it('overwrites an existing file', async () => {
    const f = path.join(await tmpDir(), 'o.json');
    await writeJsonAtomic(f, { v: 1 });
    await writeJsonAtomic(f, { v: 2 });
    expect(JSON.parse(await fs.readFile(f, 'utf8'))).toEqual({ v: 2 });
  });
});
