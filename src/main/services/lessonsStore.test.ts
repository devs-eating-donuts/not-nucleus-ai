import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { lessonsStore as LessonsStoreType } from './lessonsStore';

// The store resolves its file via electron's userData — point it at a per-test temp
// dir through a hoisted holder (the getter re-reads it on every call).
const h = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.dir } }));

let store: typeof LessonsStoreType;
const tmpDirs: string[] = [];

beforeEach(async () => {
  h.dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-lessons-'));
  tmpDirs.push(h.dir);
  // Fresh singleton per test — the in-memory cache must not leak across temp dirs.
  vi.resetModules();
  ({ lessonsStore: store } = await import('./lessonsStore'));
});

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function obs(key: string) {
  return {
    signal: 'qa-gap' as const,
    archetype: 'static-site',
    stack: ['react'],
    roleId: 'developer' as const,
    normalizedKey: key,
    projectId: 'proj-1',
  };
}

describe('lessonsStore — capture + 3×-elevation (the feature promise)', () => {
  it('a new observation lands as a candidate; the third sighting confirms it', async () => {
    const first = await store.recordObservation(obs('missing env source'));
    expect(first.status).toBe('candidate');
    expect(first.occurrences).toBe(1);

    await store.recordObservation(obs('missing env source'));
    const third = await store.recordObservation(obs('missing env source'));
    expect(third.status).toBe('confirmed');
    expect(third.occurrences).toBe(3);
    expect(third.confirmedAt).toBeTruthy();

    // Confirmed lessons are the injection candidate set for matching stacks
    // (tags carry the `stack:` / `archetype:` prefixes from techTagsFor).
    const confirmed = await store.confirmedFor(['stack:react']);
    expect(confirmed.map((l) => l.id)).toEqual([third.id]);
  });

  it('the summarizer sharpens the rule exactly once at confirmation; its failure keeps the heuristic', async () => {
    await store.recordObservation(obs('flaky check'));
    await store.recordObservation(obs('flaky check'));
    const summarize = vi.fn().mockResolvedValue('Avoid X; verify Y first.');
    const confirmed = await store.recordObservation(obs('flaky check'), summarize);
    expect(confirmed.rule).toBe('Avoid X; verify Y first.');
    expect(summarize).toHaveBeenCalledTimes(1);

    // A summarizer that throws is best-effort: the heuristic rule survives.
    await store.recordObservation(obs('other pattern'));
    await store.recordObservation(obs('other pattern'));
    const kept = await store.recordObservation(obs('other pattern'), vi.fn().mockRejectedValue(new Error('x')));
    expect(kept.status).toBe('confirmed');
    expect(kept.rule).not.toBe('');
  });
});

describe('lessonsStore — read resilience (never wipe on a transient failure)', () => {
  it('an absent file reads as a fresh, empty store', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('corrupt JSON reads as fresh (unrecoverable data, not a transient lock)', async () => {
    await writeFile(path.join(h.dir, 'lessons.json'), '{not json', 'utf8');
    expect(await store.list()).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')(
    'a transient read failure REJECTS the mutation instead of wiping lessons.json',
    async () => {
      // Two real lessons on disk…
      await store.recordObservation(obs('lesson one'));
      await store.recordObservation(obs('lesson two'));
      // …then a fresh process (no cache) hits an unreadable file (EACCES ≈ AV/cloud-sync lock).
      vi.resetModules();
      ({ lessonsStore: store } = await import('./lessonsStore'));
      const file = path.join(h.dir, 'lessons.json');
      await chmod(file, 0o000);
      try {
        await expect(store.recordObservation(obs('lesson three'))).rejects.toThrow();
      } finally {
        await chmod(file, 0o644);
      }
      // The original data is intact — the failed capture did NOT persist an empty store —
      // and the next read sees it (the give-up was never cached).
      const raw = JSON.parse(await readFile(file, 'utf8')) as { lessons: unknown[] };
      expect(raw.lessons).toHaveLength(2);
      expect((await store.list()).length).toBe(2);
    },
  );
});
