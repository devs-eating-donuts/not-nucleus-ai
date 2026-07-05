import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { aggregateGateResults, runGates, formatGateSummary } from './verificationRunner';
import type { GateResult } from './verificationRunner';

// Real-subprocess integration test (mirrors gitTracker.test.ts spawning real git): drives
// runGates against a temp workspace whose package.json has fast, one-shot node scripts, so we
// exercise the true detect → resolve('npm') → run → read-exit-code → aggregate path.

const tmpDirs: string[] = [];
async function makeWorkspace(pkg: object | null): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-gates-'));
  tmpDirs.push(dir);
  if (pkg) await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg), 'utf8');
  return dir;
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)));
});

describe('aggregateGateResults (L1)', () => {
  const r = (o: Partial<GateResult>): GateResult => ({
    id: 'build', label: 'build', passed: false, skipped: false, timedOut: false, required: true, outputTail: '', durationMs: 5, ...o,
  });

  it('a required gate that FAILED (real non-zero exit) blocks the build', () => {
    expect(aggregateGateResults([r({ passed: false })])).toEqual({ allRequiredPassed: false, ranAny: true });
  });

  it('a TIMED-OUT required gate is advisory, not a false FAIL (L1)', () => {
    expect(aggregateGateResults([r({ passed: false, timedOut: true })])).toEqual({
      allRequiredPassed: true, ranAny: true,
    });
  });

  it('a skipped tool never blocks and does not count as having run', () => {
    expect(aggregateGateResults([r({ skipped: true, skipReason: 'npm not on PATH' })])).toEqual({
      allRequiredPassed: true, ranAny: false,
    });
  });

  it('an advisory (lint) failure never blocks', () => {
    expect(aggregateGateResults([r({ id: 'lint', label: 'lint', required: false, passed: false })])).toEqual({
      allRequiredPassed: true, ranAny: true,
    });
  });
});

describe('runGates (integration)', () => {
  it('no package.json → no npm-script gates (only a PATH-conditional secret-scan may appear)', async () => {
    const dir = await makeWorkspace(null);
    const report = await runGates(dir);
    // The npm-based gates (typecheck/build/test/lint) require a manifest → none here. A
    // `secret-scan` may still run if gitleaks is on PATH (correct — a committed secret matters
    // even on a static site); the pure detectGates test covers the strict []-when-empty path.
    expect(report.results.filter((r) => r.id !== 'secret-scan')).toEqual([]);
  }, 30_000);

  // Uses the `test` (required, denylist-guarded) + `lint` (advisory) gates with fast node
  // one-liners; the allow-listed `build` gate is covered by the pure detectGates tests.
  it('a passing required gate + a failing ADVISORY lint → allRequiredPassed stays true', async () => {
    const dir = await makeWorkspace({
      name: 'x',
      // DOUBLE quotes: cmd.exe does not strip single quotes, so on Windows
      // `node -e 'process.exit(1)'` evaluates a harmless string literal and exits 0.
      scripts: { test: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(1)"' },
    });
    const report = await runGates(dir);
    expect(report.ranAny).toBe(true);
    const byId = Object.fromEntries(report.results.map((r) => [r.id, r]));
    expect(byId.test.passed).toBe(true);
    expect(byId.lint.passed).toBe(false); // lint failed…
    expect(report.allRequiredPassed).toBe(true); // …but it's advisory, so the floor is green
    expect(formatGateSummary(report)).toContain('✓ test');
  }, 30_000);

  it('a failing REQUIRED gate → allRequiredPassed false (the short-circuit signal)', async () => {
    const dir = await makeWorkspace({
      name: 'x',
      scripts: { test: 'node -e "process.exit(1)"' },
    });
    const report = await runGates(dir);
    expect(report.ranAny).toBe(true);
    expect(report.results.find((r) => r.id === 'test')?.passed).toBe(false);
    expect(report.allRequiredPassed).toBe(false);
    expect(formatGateSummary(report)).toContain('✗ test');
    // R3 — gate cost is observable: real durations on the results + the report total.
    expect(report.results.find((r) => r.id === 'test')!.durationMs).toBeGreaterThan(0);
    expect(report.totalDurationMs).toBeGreaterThan(0);
  }, 30_000);
});
