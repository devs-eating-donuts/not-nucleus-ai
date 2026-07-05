import fs from 'node:fs/promises';
import path from 'node:path';
import { getBlueprint } from '../../shared/blueprints';
import { partitionFindings } from '../../shared/decisions';
import { META_DIR } from '../../shared/markdown';
import {
  clusterFindings,
  findingCitation,
  findingFingerprint,
  mergeFindings,
  parseSecurityFindings,
  sortClustersBySeverity,
} from '../../shared/bullpenPlan';
import type { FindingCluster, SecurityFinding } from '../../shared/bullpenPlan';
import { DEFAULT_ITERATION_BUDGET } from '../../shared/taskfile';
import { writeJsonAtomic } from './atomicWrite';
import { runReproTest } from './verificationRunner';
import { appendTaskToPhase } from './bullpenTasks';
import { readDecisions } from './bullpenContext';
import {
  readMarkdown,
  readProjectInfo,
  resolveWorkspacePath,
  writeMarkdown,
} from './markdownWorkspace';

/**
 * The remediation pipeline: a review's findings → fix tasks the Bullpen loop picks up,
 * with the never-drop invariant (everything routes to a task or the findings backlog).
 * The single shared remediateFindings behind both the security and architect reviews.
 * Extracted from bullpenEngine — the highest-churn seam in the codebase.
 */

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Collect a review's findings from BOTH the CLI reply AND the review file it was told to
 * write (D1b). A verbose reviewer can under-emit the strict FINDING lines in stdout while
 * its review file holds them (or vice versa) — merging + deduping means neither source
 * silently drops a finding. Best-effort file read; '' when the file isn't there.
 */
async function collectReviewFindings(
  workspacePath: string,
  output: string,
  reviewRelPath: string,
): Promise<SecurityFinding[]> {
  const fromReply = parseSecurityFindings(output);
  const fileText = await readMarkdown(workspacePath, reviewRelPath).catch(() => '');
  const fromFile = fileText ? parseSecurityFindings(fileText) : [];
  return mergeFindings(fromReply, fromFile);
}

/**
 * The review files (reviews/*-review.md) are APPEND-ONLY — the CLI accumulates every phase's
 * findings, so D1b's file cross-read would otherwise re-remediate earlier phases' findings on
 * each later review (quadratic under afterEachTask). This persisted fingerprint ledger records
 * every finding already dispositioned, SPLIT by what happened to it (R4): `remediated` = it
 * became a fix task; `backlogged` = it was recorded in reviews/findings-backlog.md for founder
 * triage (advisory / requires-design / refactor-docs / uncited / overflow). Both suppress
 * re-processing (the backlog is the durable founder surface — a re-sighting adds nothing),
 * but the split keeps the semantics honest and feeds the review-prompt injection ("already
 * dispositioned — don't re-emit"), which attacks the text-drift dedup misses at the source.
 * Legacy flat-array files (pre-R4) are read as `remediated`. Best-effort; a read/write failure
 * degrades to a duplicate disposition next review, never a drop.
 */
const SEEN_FINDINGS_PATH = `${META_DIR}/remediated-findings.json`;

interface SeenFindings {
  remediated: Set<string>;
  backlogged: Set<string>;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

async function readSeenFindings(workspacePath: string): Promise<SeenFindings> {
  try {
    const raw = JSON.parse(
      await fs.readFile(resolveWorkspacePath(workspacePath, SEEN_FINDINGS_PATH), 'utf8'),
    );
    if (Array.isArray(raw)) {
      // Legacy (pre-R4) flat fingerprint array — everything was treated as remediated.
      return { remediated: new Set(strings(raw)), backlogged: new Set() };
    }
    const r = raw as { remediated?: unknown; backlogged?: unknown };
    return { remediated: new Set(strings(r.remediated)), backlogged: new Set(strings(r.backlogged)) };
  } catch {
    return { remediated: new Set(), backlogged: new Set() };
  }
}

async function recordSeenFindings(
  workspacePath: string,
  entries: { remediated: string[]; backlogged: string[] },
): Promise<void> {
  if (entries.remediated.length === 0 && entries.backlogged.length === 0) return;
  try {
    const seen = await readSeenFindings(workspacePath);
    for (const fp of entries.remediated) seen.remediated.add(fp);
    for (const fp of entries.backlogged) seen.backlogged.add(fp);
    await writeJsonAtomic(resolveWorkspacePath(workspacePath, SEEN_FINDINGS_PATH), {
      schemaVersion: 2,
      remediated: [...seen.remediated],
      backlogged: [...seen.backlogged],
    });
  } catch {
    // best-effort — worst case is a duplicate disposition next review (the pre-D1 behavior)
  }
}

/**
 * The "already dispositioned" block for the REVIEW prompts: tells the reviewer which
 * findings earlier reviews already handled, so it doesn't re-emit them (or a rewording — the
 * text-drift class the exact-match fingerprint can't catch; in practice most dedup
 * misses are re-narrations). '' when nothing is recorded — byte-identical first review.
 * Capped at the most recent 40 so the prompt stays bounded. Best-effort.
 */
export async function dispositionedFindingsBlock(workspacePath: string): Promise<string> {
  const seen = await readSeenFindings(workspacePath);
  const all = [...seen.remediated, ...seen.backlogged];
  if (all.length === 0) return '';
  const shown = all.slice(-40);
  return (
    '\n\nALREADY DISPOSITIONED FINDINGS from earlier reviews of this build — each one either ' +
    'became a fix task or is recorded in reviews/findings-backlog.md for founder triage. Do ' +
    'NOT re-emit these (or a reworded version of them) as new FINDING lines; reference them ' +
    'in prose if still relevant:\n' +
    shown.map((s) => `- ${s}`).join('\n')
  );
}

/**
 * Split findings by whether their file:line citation checks out (D1a). A finding whose
 * cited file EXISTS in the workspace but whose line is beyond the file's length is a clear
 * hallucination ("app.ts:292" in a 73-line file) — routed to the backlog instead of wasting
 * a dev↔QA cycle. Conservative: a finding with NO citation, or one whose file is missing (it
 * may be recommending a NEW file), or whose line is in range, stays a real remediation task.
 */
async function validateFindingCitations(
  workspacePath: string,
  findings: SecurityFinding[],
): Promise<{ verified: SecurityFinding[]; unverified: SecurityFinding[] }> {
  const verified: SecurityFinding[] = [];
  const unverified: SecurityFinding[] = [];
  for (const f of findings) {
    const cite = findingCitation(f.description);
    let hallucinated = false;
    if (cite) {
      try {
        const content = await fs.readFile(resolveWorkspacePath(workspacePath, cite.file), 'utf8');
        if (cite.line > content.split(/\r?\n/).length) hallucinated = true;
      } catch {
        // Missing / unreadable / outside the workspace → ambiguous; keep as a real task.
      }
    }
    (hallucinated ? unverified : verified).push(f);
  }
  return { verified, unverified };
}

/** Auto-create one remediation task in `phase` (tagged so it can't recurse). */
export function createRemediationTask(
  workspacePath: string,
  phase: string,
  title: string,
  goal: string,
  acceptanceCriteria: string[],
  iterationBudget?: number,
): Promise<string | null> {
  return appendTaskToPhase(workspacePath, phase, title, goal, acceptanceCriteria, true, iterationBudget);
}

// D2 — at most this many findings per "harden this module" remediation task.
const MAX_FINDINGS_PER_CLUSTER = 4;

/** Scale the dev↔QA budget up for a multi-finding cluster so fixing several issues at once
 *  doesn't blow the default 5-attempt budget and park the task blocked. Capped at 10. */
function clusterBudget(size: number): number {
  return Math.min(DEFAULT_ITERATION_BUDGET + Math.max(0, size - 1), 10);
}

interface ClusterWording {
  /** e.g. "Gilfoyle's security review of {source}" — {source} is substituted. */
  reviewerPhrase: string;
  reviewFile: string;
  /** The single-finding title verb, e.g. "Fix" / "Address". */
  verb: string;
}

/**
 * D2 — create ONE remediation task for a finding cluster: a singleton keeps the familiar
 * per-finding shape; a multi-finding cluster (same file) becomes a "Harden <file>" task with
 * each finding as its own acceptance criterion and a scaled dev↔QA budget. Shared by the
 * security + architect remediation paths (wording differs via `w`).
 */
function createRemediationForCluster(
  workspacePath: string,
  phase: string,
  source: string,
  cluster: FindingCluster,
  w: ClusterWording,
): Promise<string | null> {
  const reviewer = w.reviewerPhrase.replace('{source}', source);
  const budget = clusterBudget(cluster.findings.length);
  if (cluster.findings.length === 1) {
    const f = cluster.findings[0];
    return createRemediationTask(
      workspacePath, phase,
      `${w.verb} (${f.severity}): ${truncate(f.description, 70)}`,
      [
        `${reviewer} flagged a ${f.severity}-severity issue:`,
        '', f.description, '',
        `${w.verb} it in the current directory. See ${w.reviewFile} for the full finding and the recommended mitigation.`,
      ].join('\n'),
      [
        `The ${f.severity}-severity finding is resolved`,
        'The fix builds/type-checks cleanly and introduces no regressions',
      ],
      budget,
    );
  }
  const where = cluster.file ?? 'this area';
  const label = cluster.file ? path.basename(cluster.file) : 'this area';
  return createRemediationTask(
    workspacePath, phase,
    `Harden ${label}: ${cluster.findings.length} findings`,
    [
      `${reviewer} flagged ${cluster.findings.length} issues in ${where}:`,
      '', ...cluster.findings.map((f) => `- [${f.severity}] ${f.description}`), '',
      `${w.verb} them in the current directory. See ${w.reviewFile} for the full findings and recommended mitigations.`,
    ].join('\n'),
    [
      ...cluster.findings.map((f) => `The ${f.severity} finding is resolved: ${truncate(f.description, 120)}`),
      'The changes build/type-check cleanly and introduce no regressions',
    ],
    budget,
  );
}

/**
 * Per-review remediation cap, scaled to project scope, so one finding-heavy review can't
 * spawn an unbounded fix-task tail (the "no end" failure mode). Enterprise blueprints keep a
 * generous cap; lean / no-blueprint / rip-it projects stay tight.
 * Best-effort: a missing/unreadable project info falls back to the lean cap.
 */
export async function remediationCapFor(workspacePath: string): Promise<number> {
  const info = await readProjectInfo(workspacePath).catch(() => null);
  if (info?.ripIt) return 3; // express build — minimal review surface
  return getBlueprint(info?.templateId) ? 12 : 6; // deep blueprint vs lean/POC
}

/**
 * Append findings that exceeded the per-review remediation cap to
 * `reviews/findings-backlog.md`, so NOTHING is silently dropped — the
 * founder triages them via The Punch List. (The full review file already holds every
 * finding; this is the at-a-glance overflow surface.) Best-effort: never throws.
 * Returns whether the findings are durably recorded (an empty bucket trivially is) —
 * a FAILED write must not be fingerprinted 'backlogged', or the findings would be
 * suppressed on every later review with no backlog entry anywhere (the same silent
 * permanent drop as an unrecorded task write).
 */
/** Normalized token set for the near-duplicate check (lowercase, word chars only). */
function backlogTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

/**
 * True when `description` is a near-duplicate of an existing backlog bullet — the
 * finding-text-drift class: the same issue reworded across the reply/file or across
 * reviewers slips the exact-match fingerprint (e.g. `react-test-renderer deprecated`
 * logged twice). CONTAINMENT (overlap over the smaller token set) ≥ 0.8, not
 * Jaccard — a rewording typically ADDS words, which sinks Jaccard while the original's
 * tokens stay almost fully contained. Both sets must be ≥ 5 tokens (tiny texts inflate
 * containment). Used ONLY for backlog writes — never the remediation path, where
 * fuzzy-matching risks dropping a distinct finding.
 */
export function isNearDuplicateBacklogEntry(description: string, existingBody: string): boolean {
  const cand = backlogTokens(truncate(description, 200));
  if (cand.size < 5) return false;
  for (const line of existingBody.split(/\r?\n/)) {
    if (!line.startsWith('- **[')) continue;
    const prior = backlogTokens(line);
    if (prior.size < 5) continue;
    let overlap = 0;
    for (const t of cand) if (prior.has(t)) overlap += 1;
    const containment = overlap / Math.min(cand.size, prior.size);
    if (containment >= 0.8) return true;
  }
  return false;
}

async function logFindingsBacklog(
  workspacePath: string,
  source: string,
  kind: string,
  findings: SecurityFinding[],
): Promise<boolean> {
  if (findings.length === 0) return true;
  try {
    const rel = 'reviews/findings-backlog.md';
    const existing = (await readMarkdown(workspacePath, rel).catch(() => '')).replace(/\s+$/, '');
    // Drop rewordings of findings ALREADY in the backlog (they stay fingerprinted as
    // dispositioned by the caller — the information is present via the earlier copy).
    const fresh = findings.filter((f) => !isNearDuplicateBacklogEntry(f.description, existing));
    if (fresh.length === 0) {
      return true; // everything already recorded — nothing to write, nothing lost
    }
    const head =
      existing === ''
        ? '# Findings backlog\n\nFindings beyond the per-review remediation cap — not auto-created as fix tasks. Triage them via The Punch List.'
        : existing;
    const section = [
      '',
      '',
      `## ${kind} — ${source}`,
      ...fresh.map((f) => `- **[${f.severity}]** ${truncate(f.description, 200)}`),
      '',
    ].join('\n');
    await writeMarkdown(workspacePath, rel, head + section);
    return true;
  } catch {
    /* best-effort — never break a build step on the backlog write */
    return false;
  }
}

/**
 * Turn a security review's findings into remediation tasks in the phase, and return
 * a one-line surface for the build log ('' when nothing was found). EVERY severity
 * (critical/high/medium/low) becomes a task, up to remediationCapFor (ripIt 3 / lean 6 /
 * deep-blueprint 12); any overflow is written to reviews/findings-backlog.md
 * (never silently dropped). Only purely informational notes don't become tasks (the
 * reviewer emits no FINDING line for those). `source`
 * describes what was reviewed. The caller skips this for reviews OF a remediation task
 * — the one-level guard. Bounded in practice by the no-recurse tag + the per-run step cap.
 */
/** P1 — whether this project opts into repro-backed defect findings (default off). */
export async function reproBackedFindingsEnabled(workspacePath: string): Promise<boolean> {
  return (await readProjectInfo(workspacePath).catch(() => null))?.reproBackedFindings === true;
}

/**
 * P1 — split actionable findings into those that may become dev tasks vs. those routed to the
 * backlog, gating ONLY the `defect` impact type on an executable repro. A `defect` auto-tasks
 * only when a reviewer-written repro test CONFIRMS it (fails against the current code) — or is
 * UNPROVEN (no recognized runner / couldn't run: conservative, kept a task); a refuted or
 * repro-less defect is recorded for triage. `hardening` / untagged / requires-design findings
 * (which often have no runtime repro) pass through unchanged. Descriptions are NOT mutated, so
 * fingerprints stay stable across re-reviews. Best-effort — runReproTest never throws.
 */
async function verifyDefectRepros(
  workspacePath: string,
  findings: SecurityFinding[],
): Promise<{ toTask: SecurityFinding[]; toBacklog: SecurityFinding[] }> {
  const toTask: SecurityFinding[] = [];
  const toBacklog: SecurityFinding[] = [];
  for (const f of findings) {
    if (f.impact !== 'defect') {
      toTask.push(f);
      continue;
    }
    if (!f.reproTest) {
      toBacklog.push(f); // an unproven claim — record for triage, don't auto-build
      continue;
    }
    const outcome = await runReproTest(workspacePath, f.reproTest);
    if (outcome === 'refuted') {
      toBacklog.push(f); // the repro passes → the code is correct → not a task
    } else {
      toTask.push(f); // confirmed (bug reproduces) or unproven (couldn't run) → keep the task
    }
  }
  return { toTask, toBacklog };
}

export async function remediateSecurityFindings(
  workspacePath: string,
  phase: string,
  output: string,
  source: string,
): Promise<string> {
  return remediateFindings(workspacePath, phase, output, source, {
    reviewFile: 'reviews/security-review.md',
    reviewerPhrase: "Gilfoyle's security review of {source}",
    verb: 'Fix',
    overflowKind: 'Security',
    createdVerbPhrase: 'for Dinesh to fix',
    noneCreatedNote: 'no fix tasks created',
    surfaceLead: (n) => `⚠ Remediation: ${n} new security finding(s)`,
  });
}

/** The wording + routing knobs that differ between the security and architect pipelines. */
interface RemediationConfig extends ClusterWording {
  /** The overflow bucket's findings-backlog heading ('Security' / 'Architecture'). */
  overflowKind: string;
  /** Suffix after the created task ids in the build-log surface. */
  createdVerbPhrase: string;
  /** The surface's zero-tasks-created wording. */
  noneCreatedNote: string;
  /** Lead of the build-log surface line, given the fresh-finding count. */
  surfaceLead: (freshCount: number) => string;
}

/**
 * The shared remediation pipeline behind BOTH review kinds — it was duplicated
 * verbatim per reviewer (the highest-churn seam in the codebase; the copies had
 * already drifted once) and now lives once, wording via `cfg`:
 * collect findings from reply+file (D1b) → drop already-dispositioned (R4) →
 * requires-design routing (B4) → posture partition (B1) → refactor/docs triage (R1)
 * → uncited lows (R5) → citation validation (D1a) → cluster by file (D2) →
 * severity-sorted cap → create tasks → record dispositions. NEVER-DROP: a finding
 * is fingerprinted as dispositioned only when its task write (or backlog write)
 * actually LANDED — a failed write stays eligible for the next review. Returns a
 * one-line build-log surface ('' when nothing new was found).
 */
async function remediateFindings(
  workspacePath: string,
  phase: string,
  output: string,
  source: string,
  cfg: RemediationConfig,
): Promise<string> {
  // D1b: union the reply's findings with the review file's, so an under-emitted stdout
  // reply doesn't drop findings the file actually holds.
  const parsed: SecurityFinding[] = await collectReviewFindings(workspacePath, output, cfg.reviewFile);
  if (parsed.length === 0) {
    return '';
  }
  // The review file is append-only, so drop findings already dispositioned in an earlier
  // review — otherwise D1b's file cross-read would re-remediate every prior phase's findings.
  const seen = await readSeenFindings(workspacePath);
  const fresh = parsed.filter(
    (f) => !seen.remediated.has(findingFingerprint(f)) && !seen.backlogged.has(findingFingerprint(f)),
  );
  if (fresh.length === 0) {
    return '';
  }
  // A `requires-design` finding is a missing CAPABILITY, not a
  // posture-descopable network concern, so it must be pulled out BEFORE the posture partition.
  // Otherwise a capability gap whose text happens to match a network keyword (e.g. "auth") under
  // a permissive posture gets classified as a posture advisory and silently suppressed instead of
  // reaching the design lane (Richard, via The Whiteboard / Punch List). Dinesh would otherwise
  // fake-satisfy it (e.g. a paste-a-JWT "login" with no issuer).
  const needsDesign = fresh.filter((f) => f.requiresDesign);
  const posturable = fresh.filter((f) => !f.requiresDesign);
  const designLogged = await logFindingsBacklog(
    workspacePath,
    source,
    'Requires design — needs a new feature/capability; route via The Whiteboard or Punch List',
    needsDesign,
  );
  // Posture reconciliation gate, on the non-design remainder: a finding that contradicts the
  // approved deployment posture (e.g. "no auth" on an approved single-user localhost app) is an
  // ADVISORY note — logged to the findings backlog for triage, NOT turned into a dev remediation
  // task. Conservative: data-at-rest / secret / injection findings, and anything uncertain, still
  // remediate, and no decisions artifact → everything remediates (so those projects are unchanged).
  const { remediate: codeFindings, advisory } = partitionFindings(posturable, await readDecisions(workspacePath));
  const advisoryLogged = await logFindingsBacklog(workspacePath, source, 'Advisory — contradicts approved scope', advisory);
  // refactor/docs impact types (any severity) are recorded for founder triage, not built —
  // in practice a large share of the remediation tail is taste/docs churn. Untagged
  // findings stay actionable (conservative — a mis-tag degrades to a visible backlog entry).
  const triage = codeFindings.filter((f) => f.impact === 'refactor' || f.impact === 'docs');
  const withImpact = codeFindings.filter((f) => f.impact !== 'refactor' && f.impact !== 'docs');
  const triageLogged = await logFindingsBacklog(workspacePath, source, 'Refactor/docs — triage via The Punch List', triage);
  // R5: an uncited LOW finding can't anchor a fix cleanly and is the pure-noise class —
  // record it for triage. Critical/high/medium stay tasks even uncited (never defer real
  // work on a formatting miss); the prompt now demands file:line, so this should be rare.
  const uncitedLow = withImpact.filter((f) => f.severity === 'low' && !findingCitation(f.description));
  const actionable = withImpact.filter((f) => f.severity !== 'low' || !!findingCitation(f.description));
  const uncitedLogged = await logFindingsBacklog(workspacePath, source, 'Uncited low — cite file:line to auto-remediate', uncitedLow);
  // P1 (repro-backed findings, opt-in): a `defect` auto-tasks only when a reviewer-written repro
  // test CONFIRMS it; a refuted / repro-less defect routes to the backlog. Off by default →
  // reproConfirmed === actionable (byte-identical). Only defects are gated (hardening/untagged
  // pass through), and descriptions are unchanged so fingerprints stay stable.
  let reproConfirmed = actionable;
  let reproBacklog: SecurityFinding[] = [];
  let reproLogged = true;
  if (await reproBackedFindingsEnabled(workspacePath)) {
    const split = await verifyDefectRepros(workspacePath, actionable);
    reproConfirmed = split.toTask;
    reproBacklog = split.toBacklog;
    reproLogged = await logFindingsBacklog(workspacePath, source, 'Unconfirmed defect — needs a failing repro test', reproBacklog);
  }
  // D1a: a finding whose file:line citation is impossible (file exists, line out of range) is
  // a hallucination — route it to the backlog instead of a wasted dev cycle.
  const { verified: findings, unverified } = await validateFindingCitations(workspacePath, reproConfirmed);
  const unverifiedLogged = await logFindingsBacklog(workspacePath, source, 'Unverified citation', unverified);
  // D2: cluster findings by their source file — a module with several findings becomes ONE
  // "harden this file" task (each finding an AC), cutting the remediation explosion. Bound the
  // auto-created TASKS to the project's scope; overflow clusters' findings are logged (never
  // dropped) so a finding-heavy review can't grow an endless task tail. R5: clusters are
  // ordered worst-severity-first so the cap defers the least severe, not the last emitted.
  const clusters = sortClustersBySeverity(clusterFindings(findings, MAX_FINDINGS_PER_CLUSTER));
  const cap = await remediationCapFor(workspacePath);
  const withinCap = clusters.slice(0, cap);
  const overflow = clusters.slice(cap).flatMap((c) => c.findings);
  const created: string[] = [];
  // Only clusters whose task write actually SUCCEEDED may be fingerprinted as
  // 'remediated' below — recording a failed cluster would silently drop its
  // findings forever (no task, no backlog entry, never re-processed, and the
  // reviewer is told not to re-emit them). A failed cluster stays unrecorded,
  // so the next review retries it (never-drop).
  const tasked: typeof withinCap = [];
  for (const c of withinCap) {
    const id = await createRemediationForCluster(workspacePath, phase, source, c, cfg);
    if (id) {
      created.push(id);
      tasked.push(c);
    }
  }
  const overflowLogged = await logFindingsBacklog(workspacePath, source, cfg.overflowKind, overflow);
  if (
    created.length === 0 &&
    overflow.length === 0 &&
    advisory.length === 0 &&
    unverified.length === 0 &&
    needsDesign.length === 0 &&
    triage.length === 0 &&
    uncitedLow.length === 0 &&
    reproBacklog.length === 0
  ) {
    return '';
  }
  // Remember these findings so a later review's re-read of the cumulative file skips them —
  // split by disposition (R4): tasked findings vs the ones recorded for founder triage.
  // `tasked`, not `withinCap`: a cluster whose task write failed must stay eligible.
  await recordSeenFindings(workspacePath, {
    remediated: tasked.flatMap((c) => c.findings).map(findingFingerprint),
    // Each backlog bucket is fingerprinted only if its backlog write SUCCEEDED —
    // a failed write left them recorded-as-dispositioned with no entry anywhere
    // (the same silent permanent drop as an unrecorded task write).
    backlogged: [
      ...(advisoryLogged ? advisory : []),
      ...(designLogged ? needsDesign : []),
      ...(triageLogged ? triage : []),
      ...(uncitedLogged ? uncitedLow : []),
      ...(unverifiedLogged ? unverified : []),
      ...(reproLogged ? reproBacklog : []),
      ...(overflowLogged ? overflow : []),
    ].map(findingFingerprint),
  });
  const overflowNote =
    overflow.length > 0
      ? ` (+${overflow.length} more logged to reviews/findings-backlog.md — triage via The Punch List)`
      : '';
  const advisoryNote =
    advisory.length > 0
      ? ` (${advisory.length} advisory — contradict the approved scope, logged to reviews/findings-backlog.md)`
      : '';
  const unverifiedNote =
    unverified.length > 0
      ? ` (${unverified.length} with an out-of-range file:line citation, logged to reviews/findings-backlog.md)`
      : '';
  const designNote =
    needsDesign.length > 0
      ? ` (${needsDesign.length} require design — routed to the design backlog, not a dev patch)`
      : '';
  const triageNote =
    triage.length > 0
      ? ` (${triage.length} refactor/docs — logged to reviews/findings-backlog.md for triage, not built)`
      : '';
  const uncitedNote =
    uncitedLow.length > 0
      ? ` (${uncitedLow.length} uncited low — logged to reviews/findings-backlog.md for triage)`
      : '';
  const reproNote =
    reproBacklog.length > 0
      ? ` (${reproBacklog.length} defect(s) without a confirmed failing repro — logged for triage, not built)`
      : '';
  const createdNote =
    created.length > 0 ? `created ${created.join(', ')} ${cfg.createdVerbPhrase}` : cfg.noneCreatedNote;
  return `\n\n${cfg.surfaceLead(fresh.length)} → ${createdNote}${overflowNote}${advisoryNote}${unverifiedNote}${designNote}${triageNote}${uncitedNote}${reproNote}.`;
}

/**
 * Turn the architect's end-of-phase findings into follow-up tasks in the phase, so
 * NONE of Richard's findings slip through. Captures EVERY severity (like security) —
 * the architect emits a FINDING line for each thing he wants addressed (see
 * ARCHITECT_FINDING_FORMAT). Tasks are remediation-tagged (can't recurse) and the
 * architect gate runs once per phase (architectDone is set), so this can't loop.
 * Returns a one-line build-log surface.
 *
 * NOTE: like the end-of-phase security remediations, these fix tasks are
 * QA-verified but only RE-security-reviewed under the afterEachTask cadence — under
 * endOfPhase, securityDone is already set, so re-run the security pass to confirm.
 */
export async function remediateArchitectFindings(
  workspacePath: string,
  phase: string,
  output: string,
  source: string,
): Promise<string> {
  return remediateFindings(workspacePath, phase, output, source, {
    reviewFile: 'reviews/architecture-review.md',
    reviewerPhrase: "Richard's end-of-phase architecture review of {source}",
    verb: 'Address',
    overflowKind: 'Architecture',
    createdVerbPhrase: 'for Dinesh to address',
    noneCreatedNote: 'no follow-up tasks created',
    surfaceLead: (n) => `⚠ Architecture follow-up: ${n} new finding(s)`,
  });
}
