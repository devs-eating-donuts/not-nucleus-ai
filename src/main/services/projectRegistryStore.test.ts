import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRegistryEntry } from '../../shared/project';
import type { projectRegistryStore as ProjectRegistryStoreType } from './projectRegistryStore';

// The store resolves projects.json via electron's userData — point it at a
// per-test temp dir through a hoisted holder (the getter re-reads it per call).
const h = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.dir } }));

let store: typeof ProjectRegistryStoreType;
const tmpDirs: string[] = [];

beforeEach(async () => {
  h.dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-registry-'));
  tmpDirs.push(h.dir);
  // Fresh singleton per test — the in-memory cache must not leak across temp dirs.
  vi.resetModules();
  ({ projectRegistryStore: store } = await import('./projectRegistryStore'));
});

afterEach(async () => {
  h.dir = '';
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const registryPath = () => path.join(h.dir, 'projects.json');

function entry(id: string, overrides: Partial<ProjectRegistryEntry> = {}): ProjectRegistryEntry {
  return {
    id,
    name: `Project ${id}`,
    workspacePath: path.join(h.dir, 'workspaces', id),
    createdAt: '2020-01-01T00:00:00.000Z',
    lastOpenedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('projectRegistryStore — fresh install + round-trip', () => {
  it('an absent projects.json is a genuinely-empty registry (fresh install)', async () => {
    expect(await store.list()).toEqual({ projects: [], activeProjectId: null });
    expect(await store.get('anything')).toBeNull();
  });

  it('a persisted registry round-trips through a fresh store instance, newest-opened first', async () => {
    await store.upsert(entry('alpha', { lastOpenedAt: '2020-01-01T01:00:00.000Z' }));
    await store.upsert(entry('beta', { lastOpenedAt: '2020-01-02T01:00:00.000Z' }));
    await store.setActive('alpha');
    // New process (no cache) — the read path, not the write cache, must deliver it.
    vi.resetModules();
    ({ projectRegistryStore: store } = await import('./projectRegistryStore'));
    const { projects, activeProjectId } = await store.list();
    expect(projects.map((p) => p.id)).toEqual(['beta', 'alpha']);
    expect(activeProjectId).toBe('alpha');
    expect(projects[1]).toEqual(entry('alpha', { lastOpenedAt: '2020-01-01T01:00:00.000Z' }));
    expect(await store.get('beta')).toMatchObject({ id: 'beta', name: 'Project beta' });
  });

  it('reading a hand-edited file drops invalid entries and an activeProjectId that matches no project', async () => {
    await writeFile(
      registryPath(),
      JSON.stringify({
        schemaVersion: 1,
        projects: [
          entry('alpha'),
          { id: '', name: 'no id', workspacePath: '/tmp/x' }, // blank id → dropped
          { id: 'no-path', name: 'no path', workspacePath: '   ' }, // blank path → dropped
          'garbage',
          null,
        ],
        activeProjectId: 'ghost', // points at no surviving project → null
      }),
      'utf8',
    );
    const { projects, activeProjectId } = await store.list();
    expect(projects.map((p) => p.id)).toEqual(['alpha']);
    expect(activeProjectId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// load() — boot resilience (the "lost projects on startup" guard).
// A transient read failure on an EXISTING registry must not masquerade as
// "no projects" and hide the user's work: only ENOENT is a genuine empty
// registry; a lock-style error retries with backoff; give-up returns empty
// WITHOUT caching, so a later read still recovers the real registry.
// ---------------------------------------------------------------------------
describe('projectRegistryStore — boot resilience (never masquerade as an empty registry)', () => {
  it('corrupt JSON reads as empty WITHOUT caching — a repaired file is picked up by the SAME instance', async () => {
    await writeFile(registryPath(), '{ definitely not json', 'utf8');
    // SyntaxError is unrecoverable data (not a transient lock): empty, no retry storm.
    expect(await store.list()).toEqual({ projects: [], activeProjectId: null });
    // Repair the file — the give-up was never cached, so the next read sees the real data.
    await writeFile(
      registryPath(),
      JSON.stringify({
        schemaVersion: 1,
        projects: [entry('alpha')],
        activeProjectId: 'alpha',
      }),
      'utf8',
    );
    const recovered = await store.list();
    expect(recovered.projects.map((p) => p.id)).toEqual(['alpha']);
    expect(recovered.activeProjectId).toBe('alpha');
  });

  it.skipIf(process.platform === 'win32')(
    'an unreadable registry gives up to empty WITHOUT caching — the projects reappear once readable',
    async () => {
      // A real registered project on disk…
      await store.upsert(entry('alpha'));
      await store.setActive('alpha');
      // …read by a fresh process (no cache) while the file is locked (EACCES ≈ AV/cloud-sync/second instance).
      vi.resetModules();
      ({ projectRegistryStore: store } = await import('./projectRegistryStore'));
      await chmod(registryPath(), 0o000);
      try {
        const during = await store.list();
        // Retries exhausted → empty returned for THIS read only.
        expect(during.projects).toEqual([]);
        expect(during.activeProjectId).toBeNull();
      } finally {
        await chmod(registryPath(), 0o644);
      }
      // The wipe/masquerade guard: the give-up was NEVER cached, so the next read
      // on the same instance recovers the real registry — the project was never lost.
      const recovered = await store.list();
      expect(recovered.projects.map((p) => p.id)).toEqual(['alpha']);
      expect(recovered.activeProjectId).toBe('alpha');
      // And the on-disk file was never overwritten by the give-up default.
      const raw = JSON.parse(await readFile(registryPath(), 'utf8')) as { projects: unknown[] };
      expect(raw.projects).toHaveLength(1);
    },
  );
});
