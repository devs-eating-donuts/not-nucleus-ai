import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// bullpenEngine pulls in gitTracker / settingsStore / invocationLog (which import electron)
// and the CLI invoker — stub them so the module loads in a plain temp workspace.
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));
vi.mock('./cliInvoker', () => ({ invokeCli: vi.fn() }));

import { remediateSecurityFindings, remediationCapFor } from './bullpenEngine';

const tmpDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-remediation-'));
  tmpDirs.push(dir);
  await mkdir(path.join(dir, '.nucleus'), { recursive: true });
  await mkdir(path.join(dir, 'tasks'), { recursive: true });
  await mkdir(path.join(dir, 'reviews'), { recursive: true });
  return dir;
}

async function taskFiles(dir: string): Promise<string[]> {
  return (await readdir(path.join(dir, 'tasks'))).filter((f) => /^task-\d+\.md$/.test(f)).sort();
}

/**
 * Write a minimal .nucleus/current-run.json so readProjectInfo (used by remediationCapFor)
 * reads back the scope flags. projectName + createdAt are required by readProjectInfo.
 */
async function writeProjectInfo(
  dir: string,
  info: { ripIt?: boolean; templateId?: string | null },
): Promise<void> {
  await writeFile(
    path.join(dir, '.nucleus', 'current-run.json'),
    JSON.stringify(
      {
        projectName: 'Scope Test',
        createdAt: new Date().toISOString(),
        templateId: info.templateId ?? null,
        ripIt: info.ripIt === true,
      },
      null,
      2,
    ),
    'utf8',
  );
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('remediation cap — scope-aware, nothing lost', () => {
  it('a project with no blueprint defaults to the lean cap (6)', async () => {
    const dir = await makeWorkspace();
    expect(await remediationCapFor(dir)).toBe(6);
  });

  it('caps the auto-created fix tasks and logs the overflow to the findings backlog', async () => {
    const dir = await makeWorkspace();
    // 8 findings on a lean (no-blueprint) project → cap is 6: 6 fix tasks, 2 to the backlog.
    const output = [
      'Reviewed the phase.',
      ...Array.from(
        { length: 8 },
        (_unused, i) => `FINDING [medium]: issue number ${i + 1} — src/file${i + 1}.ts:${i + 1}`,
      ),
    ].join('\n');

    const surface = await remediateSecurityFindings(dir, 'Phase 1', output, 'phase "Phase 1"');

    // Exactly 6 remediation tasks created (the cap), not all 8.
    const files = await taskFiles(dir);
    expect(files).toEqual([
      'task-001.md',
      'task-002.md',
      'task-003.md',
      'task-004.md',
      'task-005.md',
      'task-006.md',
    ]);

    // The 2 overflow findings are written down (not dropped) and pointed at the Punch List.
    const backlog = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(backlog).toContain('issue number 7');
    expect(backlog).toContain('issue number 8');
    expect(backlog).not.toContain('issue number 6'); // #6 became a task, not backlog
    expect(surface).toContain('+2 more logged to reviews/findings-backlog.md');
  });

  it('under the cap, no backlog file is written', async () => {
    const dir = await makeWorkspace();
    const output = 'FINDING [high]: one real issue — src/a.ts:1';

    const surface = await remediateSecurityFindings(dir, 'Phase 1', output, 'phase "Phase 1"');

    expect(await taskFiles(dir)).toEqual(['task-001.md']);
    expect(surface).not.toContain('findings-backlog.md');
    await expect(readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8')).rejects.toThrow();
  });

  it('a rip-it project caps remediation at 3 (express build — minimal review surface)', async () => {
    const dir = await makeWorkspace();
    await writeProjectInfo(dir, { ripIt: true });
    expect(await remediationCapFor(dir)).toBe(3);
  });

  it('a deep-blueprint project (saas-ai-budget) caps remediation at 12', async () => {
    const dir = await makeWorkspace();
    await writeProjectInfo(dir, { templateId: 'saas-ai-budget' });
    expect(await remediationCapFor(dir)).toBe(12);
  });

  it('ripIt wins over a deep templateId (express scope is the tighter floor)', async () => {
    const dir = await makeWorkspace();
    // Even with a deep blueprint set, a rip-it build keeps the minimal cap of 3.
    await writeProjectInfo(dir, { ripIt: true, templateId: 'saas-ai-budget' });
    expect(await remediationCapFor(dir)).toBe(3);
  });

  // Backlog near-duplicate suppression: the same finding reworded
  // across reviewers slips the exact-match fingerprint and landed in the backlog twice.
  it('a REWORDED already-backlogged finding is not written to the backlog again', async () => {
    const dir = await makeWorkspace();
    // First review: a refactor-tagged low lands in the backlog.
    await remediateSecurityFindings(
      dir,
      'Phase 1',
      'FINDING [low] (refactor): react-test-renderer devDependency is deprecated upstream, no migration path wired — package.json:15',
      'phase "Phase 1"',
    );
    const first = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(first.match(/react-test-renderer/g)?.length).toBe(1);

    // A later review re-emits it REWORDED (different fingerprint — the drift class).
    await remediateSecurityFindings(
      dir,
      'Phase 2',
      'FINDING [low] (refactor): react-test-renderer devDependency is deprecated upstream and prints warnings on every test run — no maintained migration path wired yet — package.json:15',
      'phase "Phase 2"',
    );
    const second = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(second.match(/react-test-renderer/g)?.length).toBe(1); // still ONE entry

    // A genuinely DIFFERENT finding still lands (the filter never over-drops).
    await remediateSecurityFindings(
      dir,
      'Phase 2',
      'FINDING [low] (refactor): duplicated query builder branches in listBookmarks — server/app.ts:257',
      'phase "Phase 2"',
    );
    const third = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(third).toContain('duplicated query builder');
  });

  // Never-drop: a finding whose remediation-task WRITE failed must
  // not be fingerprinted as 'remediated' — that would silently drop it forever (no task, no
  // backlog entry, never re-processed). It stays unrecorded so the next review retries it.
  it('a finding whose task write failed stays eligible and is remediated on the next review', async () => {
    const dir = await makeWorkspace();
    // Break ALL task writes: replace tasks/ with a regular file.
    await rm(path.join(dir, 'tasks'), { recursive: true, force: true });
    await writeFile(path.join(dir, 'tasks'), 'not a directory', 'utf8');

    // One actionable defect + one refactor-tagged finding — the refactor keeps the
    // disposition-ledger write on the code path even when zero tasks are created.
    const output = [
      'FINDING [high]: leaks the API key in logs — src/a.ts:1',
      'FINDING [medium] (refactor): tidy the naming — src/b.ts:2',
    ].join('\n');
    const surface = await remediateSecurityFindings(dir, 'Phase 1', output, 'phase "Phase 1"');
    expect(surface).toContain('no fix tasks created');

    // The ledger must NOT claim the defect was remediated (its task never landed)…
    const ledger = JSON.parse(
      await readFile(path.join(dir, '.nucleus', 'remediated-findings.json'), 'utf8'),
    ) as { remediated: string[]; backlogged: string[] };
    expect(ledger.remediated).toHaveLength(0);
    expect(ledger.backlogged.some((s) => s.includes('tidy the naming'))).toBe(true);

    // …so once the workspace is healthy again, the SAME review output retries it.
    await rm(path.join(dir, 'tasks'), { force: true });
    await mkdir(path.join(dir, 'tasks'), { recursive: true });
    const retry = await remediateSecurityFindings(dir, 'Phase 1', output, 'phase "Phase 1"');
    expect(retry).toContain('created task-001');
    expect(await taskFiles(dir)).toEqual(['task-001.md']);
    const body = await readFile(path.join(dir, 'tasks', 'task-001.md'), 'utf8');
    expect(body).toContain('leaks the API key');
  });

  it('a rip-it project with 5 findings creates exactly 3 fix tasks and backlogs the other 2', async () => {
    const dir = await makeWorkspace();
    await writeProjectInfo(dir, { ripIt: true });
    const output = [
      'Reviewed the phase.',
      ...Array.from(
        { length: 5 },
        (_unused, i) => `FINDING [high]: ripit issue ${i + 1} — src/file${i + 1}.ts:${i + 1}`,
      ),
    ].join('\n');

    const surface = await remediateSecurityFindings(dir, 'Phase 1', output, 'phase "Phase 1"');

    // Exactly 3 remediation tasks (the rip-it cap), not all 5.
    expect(await taskFiles(dir)).toEqual(['task-001.md', 'task-002.md', 'task-003.md']);

    // The 2 overflow findings are written down (not dropped), and #3 stayed a task.
    const backlog = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(backlog).toContain('ripit issue 4');
    expect(backlog).toContain('ripit issue 5');
    expect(backlog).not.toContain('ripit issue 3');
    expect(surface).toContain('+2 more logged to reviews/findings-backlog.md');
  });
});

// A requires-design finding must be pulled out BEFORE the posture partition,
// or a capability gap whose text matches a network keyword (e.g. "auth") under a permissive
// posture gets classified as a posture advisory and never reaches the design lane.
describe('requires-design routing precedes the posture partition', () => {
  async function writeDecisions(dir: string, posture: string): Promise<void> {
    await writeFile(
      path.join(dir, '.nucleus', 'decisions.json'),
      JSON.stringify({ schemaVersion: 1, deploymentPosture: posture, decisions: [], acceptedDescopes: [] }),
      'utf8',
    );
  }

  it('a requires-design finding under a permissive posture routes to the DESIGN lane, not advisory', async () => {
    const dir = await makeWorkspace();
    await writeDecisions(dir, 'local-single-user'); // permissive — network findings can be advisory
    const output =
      'FINDING [high] (requires-design): no authentication provider exists for the admin routes — src/admin.ts:1';

    await remediateSecurityFindings(dir, 'Phase 1', output, 'phase "Phase 1"');

    // Capability gap → no dev task (no wasted fake-patch cycle)…
    expect(await taskFiles(dir)).toEqual([]);
    // …and it lands under "Requires design", NOT posture-advisory.
    const backlog = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(backlog).toContain('no authentication provider exists for the admin routes');
    expect(backlog).toContain('Requires design');
    expect(backlog).not.toContain('Advisory — contradicts approved scope');
  });

  it('a NON-requires-design network finding under the same posture still routes to advisory (B1 intact)', async () => {
    const dir = await makeWorkspace();
    await writeDecisions(dir, 'local-single-user');
    const output = 'FINDING [high]: no authentication on the admin routes — src/admin.ts:1';

    await remediateSecurityFindings(dir, 'Phase 1', output, 'phase "Phase 1"');

    expect(await taskFiles(dir)).toEqual([]);
    const backlog = await readFile(path.join(dir, 'reviews', 'findings-backlog.md'), 'utf8');
    expect(backlog).toContain('Advisory — contradicts approved scope');
    expect(backlog).not.toContain('Requires design');
  });
});
