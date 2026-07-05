import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectRegistryEntry } from '../../shared/project';
import { writeJsonAtomic } from './atomicWrite';

/**
 * App-level project registry — the index of which projects exist, where
 * their workspaces are, and which one is active. Stored as JSON in
 * userData (app metadata, not workspace content). Per-project detail lives
 * in each workspace; this is only the directory of them.
 */
interface RegistryFile {
  schemaVersion: 1;
  projects: ProjectRegistryEntry[];
  activeProjectId: string | null;
}

function sanitizeEntry(value: unknown): ProjectRegistryEntry | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const v = value as Partial<ProjectRegistryEntry>;
  if (
    typeof v.id !== 'string' ||
    typeof v.name !== 'string' ||
    typeof v.workspacePath !== 'string' ||
    v.id.trim() === '' ||
    v.workspacePath.trim() === ''
  ) {
    return null;
  }
  const createdAt = typeof v.createdAt === 'string' ? v.createdAt : new Date().toISOString();
  return {
    id: v.id,
    name: v.name.trim() === '' ? v.id : v.name,
    workspacePath: path.resolve(v.workspacePath),
    createdAt,
    lastOpenedAt: typeof v.lastOpenedAt === 'string' ? v.lastOpenedAt : createdAt,
    ventureId:
      typeof v.ventureId === 'string' && v.ventureId.trim() !== '' ? v.ventureId : undefined,
    ventureName:
      typeof v.ventureName === 'string' && v.ventureName.trim() !== '' ? v.ventureName : undefined,
  };
}

function sanitizeFile(value: unknown): RegistryFile {
  const v = (value ?? {}) as Partial<RegistryFile>;
  const projects = Array.isArray(v.projects)
    ? v.projects.map(sanitizeEntry).filter((e): e is ProjectRegistryEntry => e !== null)
    : [];
  const activeProjectId =
    typeof v.activeProjectId === 'string' && projects.some((p) => p.id === v.activeProjectId)
      ? v.activeProjectId
      : null;
  return { schemaVersion: 1, projects, activeProjectId };
}

class ProjectRegistryStore {
  private cache: RegistryFile | null = null;

  private get filePath(): string {
    return path.join(app.getPath('userData'), 'projects.json');
  }

  private async load(): Promise<RegistryFile> {
    if (this.cache) {
      return this.cache;
    }
    // Same robustness rule as settingsStore.get(): a transient read failure on an EXISTING
    // registry must not masquerade as "no projects" and hide the user's work. Only an absent
    // file is a genuine empty registry; a lock-style error retries; give-up returns empty
    // WITHOUT caching, so a later read can still recover the real registry.
    const empty: RegistryFile = { schemaVersion: 1, projects: [], activeProjectId: null };
    for (let attempt = 0; ; attempt++) {
      try {
        const raw = await fs.readFile(this.filePath, 'utf8');
        this.cache = sanitizeFile(JSON.parse(raw));
        return this.cache;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          this.cache = empty;
          return this.cache;
        }
        if (err instanceof SyntaxError || attempt >= 4) {
          return empty;
        }
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }

  private async save(file: RegistryFile): Promise<void> {
    this.cache = file;
    await writeJsonAtomic(this.filePath, file);
  }

  async list(): Promise<{ projects: ProjectRegistryEntry[]; activeProjectId: string | null }> {
    const file = await this.load();
    // Newest-opened first.
    const projects = [...file.projects].sort((a, b) =>
      b.lastOpenedAt.localeCompare(a.lastOpenedAt),
    );
    return { projects, activeProjectId: file.activeProjectId };
  }

  async get(id: string): Promise<ProjectRegistryEntry | null> {
    const file = await this.load();
    return file.projects.find((p) => p.id === id) ?? null;
  }

  /** Add or update by workspacePath (recreating a folder reuses its entry). */
  async upsert(entry: ProjectRegistryEntry): Promise<ProjectRegistryEntry> {
    const file = await this.load();
    const target = path.resolve(entry.workspacePath);
    const existing = file.projects.find((p) => path.resolve(p.workspacePath) === target);
    let result: ProjectRegistryEntry;
    if (existing) {
      result = {
        ...existing,
        name: entry.name,
        lastOpenedAt: entry.lastOpenedAt,
        // Refresh the venture tag too (mirrors `name`) so a folder re-init can't leave
        // the registry's grouping diverged from the workspace's current-run.json.
        ventureId: entry.ventureId,
        ventureName: entry.ventureName,
      };
      file.projects = file.projects.map((p) => (p.id === existing.id ? result : p));
    } else {
      result = entry;
      file.projects.push(entry);
    }
    await this.save(file);
    return result;
  }

  /** Update lastOpenedAt and make this project active. */
  async touch(id: string, when: string): Promise<ProjectRegistryEntry | null> {
    const file = await this.load();
    const entry = file.projects.find((p) => p.id === id);
    if (!entry) {
      return null;
    }
    entry.lastOpenedAt = when;
    file.activeProjectId = id;
    await this.save(file);
    return entry;
  }

  async remove(id: string): Promise<void> {
    const file = await this.load();
    file.projects = file.projects.filter((p) => p.id !== id);
    if (file.activeProjectId === id) {
      file.activeProjectId = null;
    }
    await this.save(file);
  }

  /** Erase the whole registry (factory reset) — no projects, none active. */
  async clear(): Promise<void> {
    await this.save({ schemaVersion: 1, projects: [], activeProjectId: null });
  }

  async setActive(id: string | null): Promise<void> {
    const file = await this.load();
    file.activeProjectId =
      id !== null && file.projects.some((p) => p.id === id) ? id : null;
    await this.save(file);
  }
}

export const projectRegistryStore = new ProjectRegistryStore();
