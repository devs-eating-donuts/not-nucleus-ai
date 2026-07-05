import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ripItEngine → gitTracker → settingsStore imports `app` from electron. Mock it so
// the engine's best-effort commit no-ops cleanly in a non-repo temp workspace.
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

import { buildRipItTasks } from './ripItEngine';

const tmpDirs: string[] = [];
async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-ripit-'));
  tmpDirs.push(dir);
  await mkdir(path.join(dir, '.nucleus', 'rooms'), { recursive: true });
  await mkdir(path.join(dir, 'tasks'), { recursive: true });
  return dir;
}

async function writeStakeholderChat(dir: string, userText: string): Promise<void> {
  await writeFile(
    path.join(dir, '.nucleus', 'rooms', 'stakeholder.json'),
    JSON.stringify({
      schemaVersion: 1,
      roleId: 'stakeholder',
      messages: [
        { role: 'persona', text: 'Not incubator material, but take Dinesh.' },
        { role: 'user', text: userText },
      ],
    }),
    'utf8',
  );
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('buildRipItTasks', () => {
  it('synthesizes one approved build task from the founder chat', async () => {
    const dir = await makeWorkspace();
    await writeStakeholderChat(dir, 'A dark-themed landing page with an email signup.');

    const res = await buildRipItTasks(dir, 'QuickSite');
    expect(res.ok).toBe(true);
    expect(res.taskId).toBe('task-001');

    const task = await readFile(path.join(dir, 'tasks', 'task-001.md'), 'utf8');
    expect(task).toContain('# task-001 — Build QuickSite');
    expect(task).toContain('- **Owner:** developer');
    expect(task).toContain('- **Feature:** Build');
    expect(task).toContain('A dark-themed landing page with an email signup.');
    expect(task).toContain('HOW_TO_TEST.md');

    const plan = JSON.parse(await readFile(path.join(dir, '.nucleus', 'plan.json'), 'utf8'));
    expect(plan.approved).toBe(true);
    expect(typeof plan.revisionId).toBe('string');
    expect(plan.revisionId.length).toBeGreaterThan(0);
  });

  it('refuses to build when there is no chat and no references', async () => {
    const dir = await makeWorkspace();
    // No stakeholder transcript, no references.
    const res = await buildRipItTasks(dir, 'Empty');
    expect(res.ok).toBe(false);
    expect(res.taskId).toBeNull();
    expect(res.error).toMatch(/Tell Erlich|reference/i);
  });

  it('re-running replaces the prior task rather than piling up', async () => {
    const dir = await makeWorkspace();
    await writeStakeholderChat(dir, 'First idea.');
    await buildRipItTasks(dir, 'App');
    // Leave a stray higher-numbered task to prove clearTasks removes it.
    await writeFile(path.join(dir, 'tasks', 'task-002.md'), '# task-002 — stale\n', 'utf8');

    await buildRipItTasks(dir, 'App');
    const entries = await readFile(path.join(dir, 'tasks', 'task-001.md'), 'utf8');
    expect(entries).toContain('# task-001 — Build App');
    await expect(readFile(path.join(dir, 'tasks', 'task-002.md'), 'utf8')).rejects.toThrow();
  });
});
