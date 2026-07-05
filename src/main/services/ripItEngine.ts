import fs from 'node:fs/promises';
import type { ChatMessage } from '../../shared/room';
import { createTaskFileContent } from '../../shared/taskfile';
import { WORKSPACE_FILES } from '../../shared/markdown';
import { commitWorkspaceStep } from './gitTracker';
import { listReferences } from './referencesStore';
import { readRoomLog } from './roomEngine';
import { approveSynthesizedPlan } from './whiteboardEngine';
import { resolveWorkspacePath, writeMarkdown } from './markdownWorkspace';

/**
 * "Rip it and Ship It" — the express lane. The founder pitched Erlich (the
 * stakeholder room) and uploaded references; instead of Monica → Richard →
 * gated build, we synthesize ONE build task from that chat + the references and
 * approve it, so the Bullpen (run with every cadence off) hands it straight to
 * Dinesh. The app writes the task (canonical format, inside the workspace), never
 * the CLI — same boundary the Punch List / whiteboard observe.
 */

export interface RipItBuildResult {
  ok: boolean;
  taskId: string | null;
  error: string | null;
}

/** The founder's own words from the Erlich chat = the build spec. */
function founderBrief(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => m.text.trim())
    .filter((t) => t !== '')
    .join('\n\n');
}

/** Remove any prior task files so a re-run doesn't pile up stale tasks. */
async function clearTasks(workspacePath: string): Promise<void> {
  try {
    const entries = await fs.readdir(resolveWorkspacePath(workspacePath, 'tasks'));
    for (const entry of entries) {
      if (/^task-\d+\.md$/.test(entry)) {
        await fs.unlink(resolveWorkspacePath(workspacePath, `tasks/${entry}`));
      }
    }
  } catch {
    // No tasks dir yet — nothing to clear.
  }
}

/**
 * Synthesize the single Rip-it build task from the Erlich chat + references,
 * write it, and approve the plan. Returns the task id. Requires either a founder
 * message or at least one reference to build from (otherwise there's nothing to
 * build).
 */
export async function buildRipItTasks(
  workspacePath: string,
  projectNameValue: string,
): Promise<RipItBuildResult> {
  try {
    const transcript = await readRoomLog(workspacePath, 'stakeholder');
    const brief = founderBrief(transcript);
    const references = await listReferences(workspacePath);
    if (brief === '' && references.length === 0) {
      return {
        ok: false,
        taskId: null,
        error: 'Tell Erlich what to build (or add a reference file) before handing it to Dinesh.',
      };
    }

    const referenceNote =
      references.length > 0
        ? `\nThe founder also provided ${references.length} reference file(s) in the references/ folder (listed below) — honor them; screenshots show the look they want.`
        : '';

    const goal = [
      `Build "${projectNameValue}" in the CURRENT DIRECTORY as a complete, runnable app.`,
      'The founder used the "Rip it and Ship It" express lane, so build the WHOLE thing in',
      'one pass — there is no separate planning, QA, or security review coming. Make it',
      'complete and runnable; do not ask questions.',
      '',
      'WHAT THE FOUNDER WANTS:',
      brief !== '' ? brief : '(see the reference files)',
      referenceNote,
      '',
      'When the app works, create a HOW_TO_TEST.md in the project root with the exact steps',
      'to run and test it locally: the command(s) to start it, what to click, and what to',
      'expect. End your reply with those run/test steps too, so the founder can try it.',
    ].join('\n');

    await clearTasks(workspacePath);
    const content = createTaskFileContent({
      number: 1,
      title: `Build ${projectNameValue}`,
      owner: 'developer',
      feature: 'Build',
      goal,
      acceptanceCriteria: [
        'The app is implemented and runs locally as the founder described',
        'A HOW_TO_TEST.md in the project root documents how to run and test it',
      ],
    });
    await writeMarkdown(workspacePath, 'tasks/task-001.md', content);

    // A one-line features outline so the plan reads cleanly in the workspace.
    await writeMarkdown(
      workspacePath,
      WORKSPACE_FILES.features,
      ['# Features & Phases', '', '## Build', '', '- task-001 — Build the app (Rip it and Ship It)', ''].join('\n'),
    );

    await approveSynthesizedPlan(workspacePath);

    // Checkpoint the synthesized plan before any build code lands (best-effort).
    await commitWorkspaceStep(workspacePath, 'Rip it and Ship It: build task filed');

    return { ok: true, taskId: 'task-001', error: null };
  } catch (err) {
    return { ok: false, taskId: null, error: err instanceof Error ? err.message : String(err) };
  }
}
