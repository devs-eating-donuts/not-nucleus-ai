/**
 * Lessons memory — the cross-build "what went wrong" model.
 *
 * The Bullpen already emits hard-failure signals (iteration-cap, dev crash, QA gap,
 * gate failure, indeterminate QA). We capture each as an OBSERVATION, dedup by a
 * coarse stack-scoped FINGERPRINT, and once the same fingerprint recurs
 * ELEVATION_THRESHOLD times we mark the lesson `confirmed` and inject its `rule` into
 * future builds of the same kind of tech. See docs/design/lessons-memory.md.
 *
 * This module is shared (main + renderer): pure types + helpers only, NO node:crypto /
 * electron — the renderer imports the `Lesson` type for the ledger page.
 */

export const ELEVATION_THRESHOLD = 3; // 3rd sighting elevates (owner rule)
export const LESSON_INJECT_TOP_K = 4; // max lessons per injected block
export const LESSON_INJECT_CHAR_BUDGET = 1200; // hard cap so prompts don't bloat
export const LESSON_EXAMPLE_CAP = 5; // provenance project ids kept per lesson

export type LessonSignal =
  | 'iteration-cap-hit' // dev↔QA loop exhausted
  | 'qa-gap' // a criterion came back ACn: gap
  | 'gate-failure' // security/architect reviewer CLI failed/unavailable
  | 'dev-crash' // dev.ok === false && !timedOut
  | 'qa-indeterminate' // no verdict — CLI needs login/PTY
  | 'manual'; // owner-authored

export type LessonStatus = 'candidate' | 'confirmed' | 'muted';

export interface Lesson {
  id: string; // lesson-${ts}-${rand}
  fingerprint: string; // dedup key — the unique upsert match field
  summary: string; // one line: what went wrong
  rule: string; // injected verbatim: "Avoid X. Do Y instead."
  signal: LessonSignal;
  techTags: string[]; // ["archetype:saas","stack:nextjs","role:developer"]
  occurrences: number; // >= ELEVATION_THRESHOLD ⇒ confirm
  status: LessonStatus;
  firstSeen: string; // ISO
  lastSeen: string; // ISO
  confirmedAt?: string; // ISO, set on candidate→confirmed
  exampleProjectIds: string[]; // provenance, capped (LESSON_EXAMPLE_CAP, most recent)
}

export interface LessonsFile {
  schemaVersion: 1;
  lessons: Lesson[];
}

/** One captured failure, fed to the store's upsert. */
export interface LessonObservation {
  signal: LessonSignal;
  /** Archetype/template id (null = freeform). */
  archetype: string | null;
  /** Stack entries (the template's suggestedStack), normalized to tags for ranking. */
  stack: string[];
  /** Role in scope when the failure happened. */
  roleId: string;
  /**
   * The coarse, stable identity of WHAT failed — deliberately NOT free text:
   * the criterion id (`AC2`) for qa-gap; the task slug for cap/crash/indeterminate;
   * the reviewer label for gate-failure.
   */
  normalizedKey: string;
  /** Provenance id (we use the workspace folder name). */
  projectId: string;
  /** Free-text context for the heuristic summary — NOT part of the fingerprint. */
  detail?: string;
}

const LABELS: Record<LessonSignal, string> = {
  'iteration-cap-hit': 'iteration cap hit',
  'qa-gap': 'QA gap',
  'gate-failure': 'review gate failed',
  'dev-crash': 'developer crash',
  'qa-indeterminate': 'QA indeterminate',
  manual: 'manual',
};

/* ----- tech tags ----- */

/** Normalize one raw value into a stable, lowercase tag fragment. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // drop parentheticals ("Astro (static-site)" → "astro")
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build the tag set for an observation: archetype + each stack entry + role.
 * Stack is the ranking axis (Decision 3 keeps it OUT of the fingerprint).
 */
export function techTagsFor(obs: Pick<LessonObservation, 'archetype' | 'stack' | 'roleId'>): string[] {
  const tags: string[] = [];
  if (obs.archetype) {
    tags.push(`archetype:${slug(obs.archetype)}`);
  }
  for (const s of obs.stack) {
    const sl = slug(s);
    if (sl) {
      tags.push(`stack:${sl}`);
    }
  }
  if (obs.roleId) {
    tags.push(`role:${slug(obs.roleId)}`);
  }
  // De-dup while preserving order.
  return [...new Set(tags)];
}

/* ----- fingerprint (the dedup trick) ----- */

/**
 * The canonical fingerprint INPUT: signal | archetypeTag | roleTag | normalizedKey.
 * Stack is intentionally excluded (Decision 3) so mistakes accumulate by archetype.
 */
export function fingerprintInput(obs: LessonObservation): string {
  // normalizedKey is slugged too so the engine can pass a raw task title / criterion id
  // / reviewer label and the same thing always collapses to one fingerprint.
  return [obs.signal, `archetype:${slug(obs.archetype ?? 'none')}`, `role:${slug(obs.roleId)}`, slug(obs.normalizedKey)].join('|');
}

/** Pure, dependency-free 64-bit-ish hash → 16 hex chars. Internal dedup key only;
 * never compared across systems, so the exact algorithm is unimportant. */
function hash16(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function fingerprintOf(obs: LessonObservation): string {
  return hash16(fingerprintInput(obs));
}

/* ----- heuristic candidate text (pre-summarizer) ----- */

/**
 * A cheap, templated summary/rule for a fresh candidate. Candidates never inject;
 * on elevation the engine may replace `rule` with a sharper one-shot summary.
 */
export function heuristicLesson(obs: LessonObservation): { summary: string; rule: string } {
  const where = [obs.archetype ? `${obs.archetype}` : null, obs.roleId].filter(Boolean).join(' / ');
  const key = obs.normalizedKey;
  switch (obs.signal) {
    case 'qa-gap':
      return {
        summary: `QA gap on ${key} (${where})`,
        rule: `${obs.roleId === 'developer' ? 'Before claiming a task done' : 'When reviewing'}, make sure criterion ${key} is actually satisfied — it has been left as a gap before.`,
      };
    case 'iteration-cap-hit':
      return {
        summary: `Dev↔QA loop exhausted on "${key}" (${where})`,
        rule: `"${key}"-type tasks have hit the iteration cap before. Implement to the acceptance criteria fully on the first pass instead of iterating against QA.`,
      };
    case 'dev-crash':
      return {
        summary: `Developer CLI crashed on "${key}" (${where})`,
        rule: `Builds in this archetype have crashed the developer agent on "${key}"-type work. Keep changes incremental and avoid commands that can hard-fail the agent.`,
      };
    case 'qa-indeterminate':
      return {
        summary: `QA returned no verdict on "${key}" (${where})`,
        rule: `QA has failed to produce a verdict here before — usually a CLI that needs login/PTY. Ensure the QA CLI is signed in and emits a clear VERDICT line.`,
      };
    case 'gate-failure':
      return {
        summary: `${key} review gate failed (${where})`,
        rule: `The ${key} review gate has failed before in this archetype. Confirm a working ${key} reviewer CLI is assigned so the gate can actually run.`,
      };
    case 'manual':
    default:
      return { summary: obs.detail?.slice(0, 120) ?? `${LABELS[obs.signal]} (${where})`, rule: obs.detail ?? '' };
  }
}

/* ----- injection ranking ----- */

/** Count how many of `tags` appear in `lesson.techTags`. */
function tagOverlap(lesson: Lesson, tags: Set<string>): number {
  let n = 0;
  for (const t of lesson.techTags) {
    if (tags.has(t)) {
      n++;
    }
  }
  return n;
}

/**
 * Rank confirmed lessons for injection: by tag overlap, PREFERRING a `role:<roleId>`
 * match, tie-broken by occurrences then recency. Enforces TOP_K and CHAR_BUDGET.
 * Pure — caller passes already-confirmed, non-muted lessons.
 */
export function rankLessonsForInjection(
  confirmed: Lesson[],
  techTags: string[],
  roleId: string,
  opts: { topK?: number; charBudget?: number } = {},
): Lesson[] {
  const topK = opts.topK ?? LESSON_INJECT_TOP_K;
  const charBudget = opts.charBudget ?? LESSON_INJECT_CHAR_BUDGET;
  const tagSet = new Set(techTags);
  const roleTag = `role:${slug(roleId)}`;

  const ranked = confirmed
    .map((l) => ({
      l,
      overlap: tagOverlap(l, tagSet),
      roleMatch: l.techTags.includes(roleTag) ? 1 : 0,
    }))
    .filter((r) => r.overlap > 0) // at least one shared tag, else it's an unrelated build
    .sort(
      (a, b) =>
        b.roleMatch - a.roleMatch ||
        b.overlap - a.overlap ||
        b.l.occurrences - a.l.occurrences ||
        b.l.lastSeen.localeCompare(a.l.lastSeen),
    );

  const out: Lesson[] = [];
  let used = 0;
  for (const { l } of ranked) {
    if (out.length >= topK) {
      break;
    }
    const cost = l.rule.length + 3; // "- " + newline
    if (used + cost > charBudget && out.length > 0) {
      break;
    }
    out.push(l);
    used += cost;
  }
  return out;
}

/**
 * Render the injected block, or '' for an empty list. Headed "learned across past
 * builds" so it reads as advisory, not as the founder's voice.
 */
export function renderPitfallsBlock(lessons: Lesson[], stackLabel: string): string {
  if (lessons.length === 0) {
    return '';
  }
  const head = stackLabel
    ? `Known pitfalls for ${stackLabel} — avoid these (learned across past builds):`
    : 'Known pitfalls — avoid these (learned across past builds):';
  return [head, ...lessons.map((l) => `- ${l.rule}`)].join('\n');
}
