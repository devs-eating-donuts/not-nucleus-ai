import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveCommand, runResolvedCommand } from './cliValidator';
import { detectGates, reproTestCommand } from '../../shared/verificationGates';
import type { GateId, PackageJsonLike, VerificationGate } from '../../shared/verificationGates';
import { resolveWorkspacePath } from './markdownWorkspace';
import { outputTail } from '../../shared/diagnostics';

/**
 * Code-enforced verification gates (C1) — the I/O half. See
 * docs/design/verification-gates.md. Mirrors stackManager.ts almost line-for-line: reads the
 * project's package.json + present files, asks the pure detector which gates apply, then runs
 * each with resolveCommand + runResolvedCommand and reads the real exit code.
 *
 * Best-effort throughout, exactly like stackManager / gitTracker / telemetry: an unparseable
 * manifest, a missing tool, or a hung command (timeout-bounded) all degrade to skip / no-op —
 * a broken gate runner must NEVER be able to break a build. Safe-spawn only (array args). Runs
 * with cwd = workspacePath (no traversal). A project with no detectable gates → ranAny:false →
 * the caller behaves byte-identically to before this feature.
 */

const GATE_TIMEOUT_MS = 600_000; // 10 min — a real test suite can be slow (the DEV_TIMEOUT ceiling).

export interface GateResult {
  id: GateId;
  label: string;
  passed: boolean;
  skipped: boolean;
  skipReason?: string;
  timedOut: boolean;
  required: boolean;
  outputTail: string;
  /** Real wall-clock of the gate command (0 when skipped) — R3, so gate cost is observable. */
  durationMs: number;
}

export interface GateReport {
  results: GateResult[];
  /** false if ANY present + required gate exited non-zero (short-circuit signal). */
  allRequiredPassed: boolean;
  /** false → no gate actually ran (no-op; byte-identical to pre-C1 QA). */
  ranAny: boolean;
  /** Total wall-clock across all gate commands this run (R3 — telemetry/ADR §10). */
  totalDurationMs: number;
}

const NO_GATES: GateReport = { results: [], allRequiredPassed: true, ranAny: false, totalDurationMs: 0 };

/**
 * Aggregate gate results into the report's verdict flags. Pure (exported for tests). A
 * required gate blocks the build ONLY if it actually RAN and exited non-zero — a skipped tool
 * doesn't fail, and a TIMED-OUT gate is advisory too (L1: a slow suite or a residual
 * long-runner that slipped the detector degrades to advisory, never a false FAIL that would
 * bounce the task to a dev who can't fix a hanging script). Advisory gates (lint) never block.
 */
export function aggregateGateResults(results: GateResult[]): {
  allRequiredPassed: boolean;
  ranAny: boolean;
} {
  const allRequiredPassed = results.every((r) => !r.required || r.skipped || r.timedOut || r.passed);
  const ranAny = results.some((r) => !r.skipped);
  return { allRequiredPassed, ranAny };
}

async function readPackageJson(workspacePath: string): Promise<PackageJsonLike | null> {
  try {
    const raw = await fs.readFile(path.join(workspacePath, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PackageJsonLike) : null;
  } catch {
    return null;
  }
}

/** Parsed tsconfig.json for the solution-style detection (R3); null when absent/unparseable. */
async function readTsconfig(workspacePath: string): Promise<unknown> {
  try {
    // tsconfig.json allows comments/trailing commas; strip them best-effort before parsing.
    const raw = await fs.readFile(path.join(workspacePath, 'tsconfig.json'), 'utf8');
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

/** Top-level entry names at the workspace root, for the detector's file checks. */
async function listPresentFiles(workspacePath: string): Promise<string[]> {
  try {
    return await fs.readdir(workspacePath);
  } catch {
    return [];
  }
}

/**
 * Run every applicable gate for the workspace and report the results. Never throws.
 * `secret-scan` (gitleaks) is appended here rather than in the pure detector because it's
 * PATH-conditional: present → a required gate, absent → not added at all (not a failure).
 */
export async function runGates(workspacePath: string): Promise<GateReport> {
  try {
    const pkg = await readPackageJson(workspacePath);
    const files = await listPresentFiles(workspacePath);
    const tsconfig = await readTsconfig(workspacePath);
    const gates: VerificationGate[] = detectGates(pkg, files, tsconfig);

    // secret-scan is I/O-conditional (Decision #5: a missing tool is a skip, never a failure).
    const gitleaks = await resolveCommand('gitleaks');
    if (gitleaks) {
      gates.push({
        id: 'secret-scan',
        label: 'secret-scan',
        command: 'gitleaks',
        args: ['detect', '--no-banner'],
        required: true,
      });
    }

    if (gates.length === 0) {
      return NO_GATES;
    }

    const results: GateResult[] = [];
    for (const gate of gates) {
      const resolved = await resolveCommand(gate.command);
      if (!resolved) {
        results.push({
          id: gate.id,
          label: gate.label,
          passed: false,
          skipped: true,
          skipReason: `${gate.command} not on PATH`,
          timedOut: false,
          required: gate.required,
          outputTail: '',
          durationMs: 0,
        });
        continue;
      }
      const start = Date.now();
      const run = await runResolvedCommand(resolved, gate.args, {
        cwd: workspacePath,
        timeoutMs: GATE_TIMEOUT_MS,
      });
      results.push({
        id: gate.id,
        label: gate.label,
        passed: run.ok,
        skipped: false,
        timedOut: run.timedOut === true,
        required: gate.required,
        outputTail: outputTail(run.output),
        durationMs: Date.now() - start,
      });
    }

    return {
      results,
      ...aggregateGateResults(results),
      totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
    };
  } catch {
    // Best-effort: any unexpected failure degrades to the no-op path (pre-C1 behavior).
    return NO_GATES;
  }
}

const REPRO_TIMEOUT_MS = 120_000; // one repro test should be quick — bound tighter than a full gate.

export type ReproOutcome = 'confirmed' | 'refuted' | 'unproven';

/**
 * P1 (repro-backed findings) — run a reviewer-authored repro TEST FILE for a `defect` finding
 * and classify it. A repro that FAILS demonstrates the bug (confirmed → build the fix); one that
 * PASSES refutes it (→ backlog, the code is correct); anything we cannot run cleanly (the path
 * escapes the workspace / no such file / no recognized runner / timeout / error) is UNPROVEN and
 * the caller keeps it a task (never drop real work on an inability to verify). Best-effort, never
 * throws. Safe-spawn (array args), cwd = workspace, path-guarded against traversal.
 */
export async function runReproTest(workspacePath: string, reproPath: string): Promise<ReproOutcome> {
  try {
    // The path must resolve INSIDE the workspace and name an existing file (no traversal, no dir).
    let abs: string;
    try {
      abs = resolveWorkspacePath(workspacePath, reproPath);
    } catch {
      return 'unproven';
    }
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat || !stat.isFile()) return 'unproven';
    const cmd = reproTestCommand(await readPackageJson(workspacePath), reproPath);
    if (!cmd) return 'unproven';
    const resolved = await resolveCommand(cmd.command);
    if (!resolved) return 'unproven';
    const run = await runResolvedCommand(resolved, cmd.args, { cwd: workspacePath, timeoutMs: REPRO_TIMEOUT_MS });
    if (run.timedOut === true) return 'unproven';
    // exit 0 = the test passed = the bug did NOT reproduce (refuted); non-zero = it failed = confirmed.
    return run.ok ? 'refuted' : 'confirmed';
  } catch {
    return 'unproven';
  }
}

/** A one-line build-log summary of a gate run — `✓ typecheck · ✗ build · — lint (no tool)`. */
export function formatGateSummary(report: GateReport): string {
  if (!report.ranAny && report.results.length === 0) {
    return '';
  }
  const parts = report.results.map((r) => {
    if (r.skipped) return `— ${r.label} (${r.skipReason ?? 'skipped'})`;
    if (r.timedOut) return `⏱ ${r.label} (timed out)`;
    return `${r.passed ? '✓' : '✗'} ${r.label}`;
  });
  return `🧪 Gates: ${parts.join(' · ')}`;
}
