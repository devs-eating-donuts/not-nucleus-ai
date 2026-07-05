import fs from 'node:fs/promises';
import { META_DIR } from '../../shared/markdown';
import type {
  BullpenActivity,
  BullpenActor,
  TelemetryEntry,
  TelemetrySummary,
} from '../../shared/bullpen';
import { isPhaseProgressStale } from '../../shared/bullpenPlan';
import type { PhaseProgressMap } from '../../shared/bullpenPlan';
import { readPlanRevisionId } from './whiteboardEngine';
import { writeJsonAtomic } from './atomicWrite';
import { resolveWorkspacePath } from './markdownWorkspace';

/**
 * Bullpen persistence: the three per-project state files the build loop reads/writes each
 * step — telemetry (The Garage), phase progress (which gates ran), and the live "who's
 * working now" activity marker. Extracted from bullpenEngine so the engine keeps only the
 * step machine. All best-effort I/O through the hardened atomic writer.
 */

const TELEMETRY_PATH = `${META_DIR}/telemetry.json`;
// Cap retained telemetry so a long-lived / repeatedly-rebuilt project can't grow the file
// (and the O(n) read-append-rewrite per step → O(n²) over a build) without bound — keep the
// most recent N entries, mirroring the invocation-log rotation (review L20).
const MAX_TELEMETRY_ENTRIES = 5000;

export async function recordTelemetry(workspacePath: string, entry: TelemetryEntry): Promise<void> {
  const abs = resolveWorkspacePath(workspacePath, TELEMETRY_PATH);
  let entries: TelemetryEntry[] = [];
  try {
    const raw = await fs.readFile(abs, 'utf8');
    const parsed = JSON.parse(raw) as { entries?: TelemetryEntry[] };
    if (Array.isArray(parsed.entries)) {
      entries = parsed.entries;
    }
  } catch {
    entries = [];
  }
  entries.push(entry);
  if (entries.length > MAX_TELEMETRY_ENTRIES) {
    entries = entries.slice(-MAX_TELEMETRY_ENTRIES);
  }
  await writeJsonAtomic(abs, { schemaVersion: 1, entries });
}

/* ----- phase progress (security / architect / celebration per phase) ----- */

const PHASES_PATH = `${META_DIR}/bullpen-phases.json`;

export async function readPhaseProgress(workspacePath: string): Promise<PhaseProgressMap> {
  try {
    const raw = await fs.readFile(resolveWorkspacePath(workspacePath, PHASES_PATH), 'utf8');
    const parsed = JSON.parse(raw) as { phases?: PhaseProgressMap; planRevisionId?: string | null };
    // Stale guard (TODO #6): if this progress was recorded under a DIFFERENT plan
    // revision than the current plan, the plan was re-drafted — drop it so gate /
    // security state from the old plan can't carry over.
    const current = await readPlanRevisionId(workspacePath);
    if (isPhaseProgressStale(parsed.planRevisionId, current)) {
      return {};
    }
    return parsed.phases ?? {};
  } catch {
    return {};
  }
}

export async function writePhaseProgress(workspacePath: string, phases: PhaseProgressMap): Promise<void> {
  const abs = resolveWorkspacePath(workspacePath, PHASES_PATH);
  const planRevisionId = await readPlanRevisionId(workspacePath);
  await writeJsonAtomic(abs, { schemaVersion: 1, planRevisionId, phases });
}

/* ----- live activity marker ("who's working right now") ----- */

const ACTIVITY_PATH = `${META_DIR}/bullpen-activity.json`;

/**
 * Publish (or clear) the agent working right now. Written just before each CLI
 * invocation and cleared when the step ends, so the renderer's poll can show
 * "Dinesh is building / Big Head is testing / Gilfoyle is reviewing" live.
 * Best-effort — a failed marker write never breaks the build.
 */
export async function writeActivity(
  workspacePath: string,
  actor: BullpenActor,
  taskId: string | null,
  taskTitle: string | null,
  phaseName: string | null,
): Promise<void> {
  const activity: BullpenActivity | null =
    actor === null ? null : { actor, taskId, taskTitle, phaseName, startedAt: new Date().toISOString() };
  try {
    const abs = resolveWorkspacePath(workspacePath, ACTIVITY_PATH);
    await writeJsonAtomic(abs, { schemaVersion: 1, activity });
  } catch {
    // Non-fatal: the marker is a UI nicety, not build state.
  }
}

export async function readActivity(workspacePath: string): Promise<BullpenActivity | null> {
  try {
    const raw = await fs.readFile(resolveWorkspacePath(workspacePath, ACTIVITY_PATH), 'utf8');
    return (JSON.parse(raw) as { activity?: BullpenActivity | null }).activity ?? null;
  } catch {
    return null;
  }
}

/* ----- telemetry read (The Garage) ----- */

export async function readTelemetry(workspacePath: string): Promise<TelemetrySummary> {
  let entries: TelemetryEntry[] = [];
  try {
    const raw = await fs.readFile(resolveWorkspacePath(workspacePath, TELEMETRY_PATH), 'utf8');
    const parsed = JSON.parse(raw) as { entries?: TelemetryEntry[] };
    if (Array.isArray(parsed.entries)) {
      entries = parsed.entries;
    }
  } catch {
    entries = [];
  }
  const byCliMap = new Map<string, { runs: number; durationMs: number }>();
  const byRoleMap = new Map<string, { runs: number; durationMs: number }>();
  let totalDurationMs = 0;
  for (const e of entries) {
    totalDurationMs += e.durationMs;
    // Read and write under the SAME key — otherwise empty-cliName entries (a
    // role with no CLI assigned) each re-miss and overwrite '(none)', collapsing
    // to runs:1 with only the last entry's duration.
    const cliKey = e.cliName || '(none)';
    const cli = byCliMap.get(cliKey) ?? { runs: 0, durationMs: 0 };
    cli.runs += 1;
    cli.durationMs += e.durationMs;
    byCliMap.set(cliKey, cli);
    const role = byRoleMap.get(e.roleId) ?? { runs: 0, durationMs: 0 };
    role.runs += 1;
    role.durationMs += e.durationMs;
    byRoleMap.set(e.roleId, role);
  }
  return {
    entries,
    totalDurationMs,
    byCli: [...byCliMap.entries()].map(([cliName, v]) => ({ cliName, ...v })),
    byRole: [...byRoleMap.entries()].map(([roleId, v]) => ({ roleId, ...v })),
  };
}
