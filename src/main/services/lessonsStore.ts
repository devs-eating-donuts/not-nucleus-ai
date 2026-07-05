import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ELEVATION_THRESHOLD,
  LESSON_EXAMPLE_CAP,
  fingerprintOf,
  heuristicLesson,
  techTagsFor,
} from '../../shared/lessons';
import type { Lesson, LessonObservation, LessonStatus, LessonsFile } from '../../shared/lessons';
import { writeJsonAtomic } from './atomicWrite';

/**
 * Cross-build lessons store — `userData/lessons.json` (same scope as projects.json,
 * app metadata, cross-project by design). A near-clone of projectRegistryStore:
 * in-memory cache, lazy load, atomic save via the shared helper (Windows EPERM
 * fallback), sanitize on read, id guard.
 *
 * READ RESILIENCE: only a GENUINELY absent file (ENOENT) or corrupt
 * JSON reads as a fresh/empty store. A transient failure (AV scan, cloud-sync lock,
 * messy restart) is retried with backoff and, on give-up, NEVER cached — because each
 * save() rewrites the whole file, caching an accidental empty store meant the next
 * lesson capture silently WIPED the entire cross-build memory. Mutations throw on an
 * unreadable file (captureLesson swallows; the Ledger surfaces); plain reads degrade
 * to empty without caching, so the next call re-reads the real file.
 *
 * Each save() rewrites the whole file, so mutations are serialized through a promise
 * chain — the Bullpen step machine is sequential, but the chain makes it safe regardless.
 */

const ID_RE = /^lesson-[a-z0-9-]+$/;
const VALID_STATUS: LessonStatus[] = ['candidate', 'confirmed', 'muted'];
const VALID_SIGNALS = new Set<Lesson['signal']>([
  'iteration-cap-hit',
  'qa-gap',
  'gate-failure',
  'dev-crash',
  'qa-indeterminate',
  'manual',
]);

/** A summarizer turns a freshly-confirmed lesson into a sharp "avoid X, do Y" rule.
 * Returns null/'' to keep the heuristic rule. Called at most once per confirmation. */
export type LessonSummarizer = (lesson: Lesson) => Promise<string | null>;

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeEntry(value: unknown): Lesson | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const v = value as Partial<Lesson>;
  if (
    typeof v.id !== 'string' ||
    !ID_RE.test(v.id) ||
    typeof v.fingerprint !== 'string' ||
    v.fingerprint.trim() === '' ||
    typeof v.signal !== 'string' ||
    !VALID_SIGNALS.has(v.signal)
  ) {
    return null;
  }
  const status: LessonStatus = VALID_STATUS.includes(v.status as LessonStatus)
    ? (v.status as LessonStatus)
    : 'candidate';
  const firstSeen = typeof v.firstSeen === 'string' ? v.firstSeen : nowIso();
  return {
    id: v.id,
    fingerprint: v.fingerprint,
    summary: typeof v.summary === 'string' ? v.summary : '',
    rule: typeof v.rule === 'string' ? v.rule : '',
    signal: v.signal,
    techTags: Array.isArray(v.techTags) ? v.techTags.filter((t): t is string => typeof t === 'string') : [],
    occurrences: typeof v.occurrences === 'number' && v.occurrences > 0 ? Math.floor(v.occurrences) : 1,
    status,
    firstSeen,
    lastSeen: typeof v.lastSeen === 'string' ? v.lastSeen : firstSeen,
    confirmedAt: typeof v.confirmedAt === 'string' ? v.confirmedAt : undefined,
    exampleProjectIds: Array.isArray(v.exampleProjectIds)
      ? v.exampleProjectIds.filter((p): p is string => typeof p === 'string').slice(0, LESSON_EXAMPLE_CAP)
      : [],
  };
}

function sanitizeFile(value: unknown): LessonsFile {
  const v = (value ?? {}) as Partial<LessonsFile>;
  const lessons = Array.isArray(v.lessons)
    ? v.lessons.map(sanitizeEntry).filter((l): l is Lesson => l !== null)
    : [];
  return { schemaVersion: 1, lessons };
}

class LessonsStore {
  private cache: LessonsFile | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  private get filePath(): string {
    return path.join(app.getPath('userData'), 'lessons.json');
  }

  private async load(): Promise<LessonsFile> {
    if (this.cache) {
      return this.cache;
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        const raw = await fs.readFile(this.filePath, 'utf8');
        this.cache = sanitizeFile(JSON.parse(raw));
        return this.cache;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT' || err instanceof SyntaxError) {
          // Genuinely absent, or corrupt beyond recovery → a fresh store (cacheable).
          this.cache = { schemaVersion: 1, lessons: [] };
          return this.cache;
        }
        if (attempt >= 4) {
          // Give up WITHOUT caching — a momentary lock must never masquerade as an
          // empty store that the next save() would persist over the real data.
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }

  /** Reads degrade to empty on an unreadable file (uncached); mutations must throw instead. */
  private async loadForRead(): Promise<LessonsFile> {
    try {
      return await this.load();
    } catch {
      return { schemaVersion: 1, lessons: [] };
    }
  }

  private async save(file: LessonsFile): Promise<void> {
    this.cache = file;
    await writeJsonAtomic(this.filePath, file);
  }

  /** Serialize a read-modify-write so concurrent captures can't clobber the file. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    // Keep the chain alive even if fn throws, but don't swallow fn's result.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async list(): Promise<Lesson[]> {
    const file = await this.loadForRead();
    return [...file.lessons].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }

  async get(id: string): Promise<Lesson | null> {
    const file = await this.loadForRead();
    return file.lessons.find((l) => l.id === id) ?? null;
  }

  async getByFingerprint(fp: string): Promise<Lesson | null> {
    const file = await this.loadForRead();
    return file.lessons.find((l) => l.fingerprint === fp) ?? null;
  }

  /** Confirmed, non-muted lessons sharing at least one tag — the injection candidate set. */
  async confirmedFor(techTags: string[]): Promise<Lesson[]> {
    const file = await this.loadForRead();
    const tagSet = new Set(techTags);
    return file.lessons.filter(
      (l) => l.status === 'confirmed' && l.techTags.some((t) => tagSet.has(t)),
    );
  }

  /**
   * The upsert + elevation (design §3). New fingerprint → a candidate at 1; an existing
   * one bumps occurrences and, on crossing ELEVATION_THRESHOLD, becomes `confirmed`
   * (running the optional summarizer once). Returns the resulting lesson.
   */
  recordObservation(obs: LessonObservation, summarize?: LessonSummarizer): Promise<Lesson> {
    return this.enqueue(async () => {
      const file = await this.load();
      const fp = fingerprintOf(obs);
      const now = nowIso();
      let lesson = file.lessons.find((l) => l.fingerprint === fp);

      if (!lesson) {
        const { summary, rule } = heuristicLesson(obs);
        lesson = {
          id: `lesson-${Date.now()}-${randomUUID().slice(0, 8)}`,
          fingerprint: fp,
          summary,
          rule,
          signal: obs.signal,
          techTags: techTagsFor(obs),
          occurrences: 1,
          status: 'candidate',
          firstSeen: now,
          lastSeen: now,
          exampleProjectIds: obs.projectId ? [obs.projectId] : [],
        };
        file.lessons.push(lesson);
      } else {
        lesson.occurrences += 1;
        lesson.lastSeen = now;
        // Union new tags so a recurring mistake ranks for every stack it's hit on.
        lesson.techTags = [...new Set([...lesson.techTags, ...techTagsFor(obs)])];
        if (obs.projectId) {
          lesson.exampleProjectIds = [
            obs.projectId,
            ...lesson.exampleProjectIds.filter((p) => p !== obs.projectId),
          ].slice(0, LESSON_EXAMPLE_CAP);
        }
        if (lesson.status === 'candidate' && lesson.occurrences >= ELEVATION_THRESHOLD) {
          lesson.status = 'confirmed';
          lesson.confirmedAt = now;
          if (summarize) {
            try {
              const sharper = await summarize(lesson);
              if (sharper && sharper.trim() !== '') {
                lesson.rule = sharper.trim();
              }
            } catch {
              // Summarizer is best-effort — keep the heuristic rule on any failure.
            }
          }
        }
      }
      await this.save(file);
      return lesson;
    });
  }

  /** Owner curation: confirm/mute/un-mute a lesson. `muted` excludes it from injection. */
  setStatus(id: string, status: LessonStatus): Promise<Lesson | null> {
    return this.enqueue(async () => {
      const file = await this.load();
      const lesson = file.lessons.find((l) => l.id === id);
      if (!lesson) {
        return null;
      }
      lesson.status = status;
      if (status === 'confirmed' && !lesson.confirmedAt) {
        lesson.confirmedAt = nowIso();
      }
      await this.save(file);
      return lesson;
    });
  }

  /** Erase all lessons (factory reset). Resets the file to an empty store. */
  async clear(): Promise<void> {
    return this.enqueue(() => this.save({ schemaVersion: 1, lessons: [] }));
  }
}

export const lessonsStore = new LessonsStore();
