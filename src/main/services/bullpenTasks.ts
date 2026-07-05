import fs from 'node:fs/promises';
import path from 'node:path';
import { appendEscalation, markEscalationsResolved } from '../../shared/escalations';
import { WORKSPACE_FILES } from '../../shared/markdown';
import type { BullpenStepResult } from '../../shared/bullpen';
import {
  createTaskFileContent,
  getTaskSectionBody,
  parseTaskFile,
  setTaskStatus,
} from '../../shared/taskfile';
import type { TaskKind } from '../../shared/taskfile';
import { commitWorkspaceStep } from './gitTracker';
import { readMarkdown, resolveWorkspacePath, writeMarkdown } from './markdownWorkspace';

/**
 * Bullpen task-file operations: discovery (listTasks), the human handoff /
 * escalation transitions, "Mark done" / "Redo QA" resolution, and the serialized
 * task-append the remediation + Punch List paths share. Extracted from bullpenEngine;
 * all pure task-file I/O, no persona/banter concerns.
 */

/* ----- task discovery ----- */

export interface TaskRef {
  number: number;
  id: string;
  relPath: string;
  content: string;
  status: string;
  title: string;
  feature: string | null;
  kind: TaskKind;
  isRemediation: boolean;
  iterationsUsed: number;
  iterationBudget: number;
}

export async function listTasks(workspacePath: string): Promise<TaskRef[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(resolveWorkspacePath(workspacePath, 'tasks'));
  } catch {
    return [];
  }
  const refs: TaskRef[] = [];
  for (const entry of entries.sort()) {
    const m = entry.match(/^task-(\d+)\.md$/);
    if (!m) {
      continue;
    }
    const relPath = `tasks/${entry}`;
    const content = await readMarkdown(workspacePath, relPath).catch(() => '');
    const parsed = parseTaskFile(content);
    refs.push({
      number: Number.parseInt(m[1], 10),
      id: parsed.id ?? entry.replace(/\.md$/, ''),
      relPath,
      content,
      status: parsed.status ?? 'todo',
      title: parsed.title ?? entry,
      feature: parsed.feature,
      kind: parsed.kind,
      isRemediation: parsed.isRemediation,
      iterationsUsed: parsed.iterationsUsed,
      iterationBudget: parsed.iterationBudget,
    });
  }
  return refs.sort((a, b) => a.number - b.number);
}

/** Mark a task human-needed and record an ESC-NNN escalation. */
export async function escalateTask(
  workspacePath: string,
  taskContent: string,
  relPath: string,
  taskId: string,
  taskTitle: string,
  from: 'developer' | 'qa' | 'engine',
  reason: 'iteration-cap-hit' | 'other',
  context: string,
  tried: string,
  iterationsLabel: string | null,
): Promise<BullpenStepResult> {
  await writeMarkdown(workspacePath, relPath, setTaskStatus(taskContent, 'human-needed'));
  const escContent = await readMarkdown(workspacePath, WORKSPACE_FILES.escalations).catch(
    () => '# Escalations\n',
  );
  const { content: nextEsc } = appendEscalation(escContent, {
    title: `${taskId} — ${taskTitle}`,
    from,
    task: taskId,
    reason,
    context,
    tried,
    recommendation: 'A human should review the task and the implementation.',
    createdAt: new Date().toISOString(),
  });
  await writeMarkdown(workspacePath, WORKSPACE_FILES.escalations, nextEsc);
  return {
    allDone: false,
    taskId,
    taskTitle,
    actor: from === 'qa' ? 'qa' : 'developer',
    status: 'human-needed',
    log: context,
    passed: false,
    escalated: true,
    iterations: iterationsLabel,
    error: null,
  };
}

/**
 * Hand a human-setup task to the person: mark it human-needed, record an
 * escalation with its checklist, and pause the loop (escalated). The build
 * never runs an agent on it. The human does the steps, marks it done
 * (resolveTask → verified), and resumes.
 */
export async function handoffSetupTask(workspacePath: string, task: TaskRef): Promise<BullpenStepResult> {
  const steps = getTaskSectionBody(task.content, 'Manual Steps').trim();
  const checklist = steps !== '' ? steps : 'See the task file for what needs doing.';
  await writeMarkdown(workspacePath, task.relPath, setTaskStatus(task.content, 'human-needed'));
  const escContent = await readMarkdown(workspacePath, WORKSPACE_FILES.escalations).catch(
    () => '# Escalations\n',
  );
  const { content: nextEsc } = appendEscalation(escContent, {
    title: `${task.id} — ${task.title}`,
    from: 'engine',
    task: task.id,
    reason: 'needs-credential',
    context: `This step needs hands-on setup the autonomous build can't do (interactive logins, cloud accounts, secrets).\n\n${checklist}`,
    tried: 'Not attempted — handed to the human by design.',
    recommendation: 'Run the steps yourself, then mark the task done and resume the build.',
    createdAt: new Date().toISOString(),
  });
  await writeMarkdown(workspacePath, WORKSPACE_FILES.escalations, nextEsc);
  return {
    allDone: false,
    taskId: task.id,
    taskTitle: task.title,
    actor: null,
    status: 'human-needed',
    log: `${task.title} — this one's yours.\n\n${checklist}`,
    passed: null,
    escalated: true,
    iterations: null,
    error: null,
  };
}

/**
 * Mark a human-needed task complete (→ verified) after the human has handled
 * it. Used by the "Mark done" affordance on setup/escalated tasks.
 */
export async function resolveTask(
  workspacePath: string,
  taskId: string,
  founderNote?: string,
): Promise<{ ok: boolean; error: string | null }> {
  if (!/^task-\d+$/.test(taskId)) {
    return { ok: false, error: 'Invalid task id.' };
  }
  const relPath = `tasks/${taskId}.md`;
  let content: string;
  try {
    content = await readMarkdown(workspacePath, relPath);
  } catch {
    return { ok: false, error: 'Task not found.' };
  }
  // The founder's outcome must land in the WORKSPACE, not just the click: otherwise
  // a build can burn dev↔QA attempts because "no issues found" existed only
  // in the founder's head — QA (correctly) refuses claims with no recorded source
  // of truth. The note rides the task file itself, where QA and later tasks look.
  let next = setTaskStatus(content, 'verified');
  const note = founderNote?.trim();
  if (note) {
    next =
      next.trimEnd() +
      `\n\n## Founder note (Mark done)\n\n_${new Date().toISOString()}_\n\n${note}\n`;
  }
  try {
    await writeMarkdown(workspacePath, relPath, next);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  await resolveTaskEscalations(workspacePath, taskId);
  // Commit the handoff (best-effort) — Mark done happens OUTSIDE the step loop,
  // so without this the status flip + note sat uncommitted until the next step's
  // sweep, unattributed in the audit trail.
  await commitWorkspaceStep(workspacePath, `${taskId}: marked done by the founder`);
  return { ok: true, error: null };
}

/** Best-effort: flip this task's open ESCALATIONS.md records to resolved. */
async function resolveTaskEscalations(workspacePath: string, taskId: string): Promise<void> {
  try {
    const esc = await readMarkdown(workspacePath, WORKSPACE_FILES.escalations);
    const next = markEscalationsResolved(esc, taskId);
    if (next !== esc) {
      await writeMarkdown(workspacePath, WORKSPACE_FILES.escalations, next);
    }
  } catch {
    // Housekeeping only — never block the task transition on it.
  }
}

/**
 * Re-queue a QA-escalated task for another QA pass. The build escalates (→
 * human-needed) when QA can't produce a PASS/FAIL — usually a transient stall,
 * not a real failure. "Redo QA" resets the task to 'done' (dev-complete, awaiting
 * QA) and clears its open escalation, so the next build step runs QA on it again.
 * Refuses manual-setup tasks: those have no implementation to test — the human
 * does the steps and uses Mark done instead (resetting one to 'done' would let
 * the dev agent try to "implement" a cloud login).
 */
export async function requeueTaskForQa(
  workspacePath: string,
  taskId: string,
): Promise<{ ok: boolean; error: string | null }> {
  if (!/^task-\d+$/.test(taskId)) {
    return { ok: false, error: 'Invalid task id.' };
  }
  const relPath = `tasks/${taskId}.md`;
  let content: string;
  try {
    content = await readMarkdown(workspacePath, relPath);
  } catch {
    return { ok: false, error: 'Task not found.' };
  }
  if (getTaskSectionBody(content, 'Manual Steps').trim() !== '') {
    return {
      ok: false,
      error: 'This is a manual-setup task — there’s nothing for QA to test. Do the steps, then Mark done.',
    };
  }
  try {
    await writeMarkdown(workspacePath, relPath, setTaskStatus(content, 'done'));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  await resolveTaskEscalations(workspacePath, taskId);
  return { ok: true, error: null };
}

// E3 — serialize task-number allocation per workspace. Both the Punch List CREATE-TASK
// path (workRequestEngine) and the Bullpen's own remediation creators go through
// appendTaskToPhase; without a lock two concurrent callers can readdir → compute the same
// max+1 → both write task-NNN, and the second rename silently DROPS the first (a lost
// security-remediation task is the bad direction). In-process is sufficient: every task
// write funnels through this one function in the single main process. Best-effort chain,
// mirroring runHistoryStore.withRunLock — a failed op never wedges the next.
const taskAllocLocks = new Map<string, Promise<unknown>>();

function withTaskAllocLock<T>(workspacePath: string, work: () => Promise<T>): Promise<T> {
  const key = path.resolve(workspacePath);
  const prev = taskAllocLocks.get(key) ?? Promise.resolve();
  const run = prev.then(work, work);
  const tail = run.catch(() => undefined);
  taskAllocLocks.set(key, tail);
  void tail.then(() => {
    if (taskAllocLocks.get(key) === tail) taskAllocLocks.delete(key);
  });
  return run;
}

/**
 * Append a new developer task (fresh budget) to `phase` and return its id
 * (e.g. "task-007"), or null if the write failed. The decision engine then picks
 * it up like any other todo task in the phase. `remediation: true` tags it so
 * reviewing/failing it can't spawn further remediation. Best-effort — the build
 * never breaks on a task write. The allocate-and-write is serialized per workspace
 * (withTaskAllocLock) so concurrent callers can't collide on a task number.
 */
export async function appendTaskToPhase(
  workspacePath: string,
  phase: string,
  title: string,
  goal: string,
  acceptanceCriteria: string[],
  remediation: boolean,
  iterationBudget?: number,
): Promise<string | null> {
  return withTaskAllocLock(workspacePath, async () => {
    try {
      const tasks = await listTasks(workspacePath);
      const nextNumber = tasks.reduce((max, t) => Math.max(max, t.number), 0) + 1;
      const id = `task-${String(nextNumber).padStart(3, '0')}`;
      const content = createTaskFileContent({
        number: nextNumber,
        title,
        owner: 'developer',
        feature: phase,
        goal,
        acceptanceCriteria,
        remediation,
        iterationBudget,
      });
      await writeMarkdown(workspacePath, `tasks/${id}.md`, content);
      return id;
    } catch {
      return null;
    }
  });
}
