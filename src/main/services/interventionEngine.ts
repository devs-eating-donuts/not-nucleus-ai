import { roomTimeoutMsForThinking } from '../../shared/cli';
import type { InterventionContext, InterventionLoadResult } from '../../shared/intervention';
import { buildInterventionPrompt } from '../../shared/intervention';
import { redactSecrets } from '../../shared/secrets';
import { META_DIR, WORKSPACE_FILES } from '../../shared/markdown';
import type { NamingMode } from '../../shared/naming';
import { operatingPrinciplesBlock } from '../../shared/operatingPrinciples';
import type { ProjectTeam } from '../../shared/project';
import type { ChatMessage, RoomTurnResult } from '../../shared/room';
import { INTERVENTION_PROMPTS, JIAN_YANG_TAKEOVER } from '../../shared/roomPrompts';
import type { RoleId } from '../../shared/roles';
import { extractAcceptanceCriteria, getTaskSectionBody, parseTaskFile } from '../../shared/taskfile';
import { invokeCli } from './cliInvoker';
import { jianYangTakeoverActive } from './settingsStore';
import { commitWorkspaceStep } from './gitTracker';
import { pitfallsSuffix } from './lessonsContext';
import { readMarkdown, resolveWorkspacePath } from './markdownWorkspace';
import { referencesPromptBlock } from './referencesStore';
import { promptWindow, readTranscript, sanitizeChatMessages, writeTranscript } from './transcriptStore';

/**
 * Intervention chat engine. Phase 1 = Big Head (QA): a human-in-the-loop
 * conversation about a task the autonomous Bullpen escalated. Unlike the design
 * rooms (roomEngine — tmpdir cwd, no autopilot, deliberately can't touch files),
 * an intervention turn runs the seat's CLI in the WORKSPACE cwd with autopilot,
 * so the persona can inspect the real code to ground its answers. The founder
 * drives each turn — which also sidesteps the one-shot CLI stalls that escalate
 * tasks in the first place. Transcript lives at
 * .nucleus/interventions/<roleId>-<taskId>.json (its own channel, distinct from
 * the design rooms' <roleId>.json).
 */

/** Task ids are the canonical `task-NNN` form; reject anything else (no traversal). */
function isSafeTaskId(taskId: string): boolean {
  return /^task-[A-Za-z0-9._-]+$/.test(taskId);
}

function logPath(workspacePath: string, roleId: RoleId, taskId: string): string {
  return resolveWorkspacePath(workspacePath, `${META_DIR}/interventions/${roleId}-${taskId}.json`);
}

export async function readInterventionLog(
  workspacePath: string,
  roleId: RoleId,
  taskId: string,
): Promise<ChatMessage[]> {
  if (!isSafeTaskId(taskId)) {
    return [];
  }
  return readTranscript(logPath(workspacePath, roleId, taskId));
}

async function writeInterventionLog(
  workspacePath: string,
  roleId: RoleId,
  taskId: string,
  messages: ChatMessage[],
): Promise<void> {
  await writeTranscript(logPath(workspacePath, roleId, taskId), messages, { roleId, taskId });
}

/** Tail of a text blob: the last `maxLines` lines, capped at `maxChars`. */
function tailText(text: string, maxLines: number, maxChars: number): string {
  let out = text.split(/\r?\n/).slice(-maxLines).join('\n');
  if (out.length > maxChars) {
    out = out.slice(out.length - maxChars);
  }
  return out.trim();
}

/** Which review file + label seeds the chat, by persona. */
function reviewSourceFor(roleId: RoleId): { file: string; label: string } {
  if (roleId === 'security') {
    return {
      file: WORKSPACE_FILES.securityReview,
      label: "Gilfoyle's security findings (tail of reviews/security-review.md)",
    };
  }
  // QA (Big Head) and the developer (Dinesh, fixing what QA flagged) both read QA's notes.
  return { file: WORKSPACE_FILES.qaReview, label: 'What QA last reported (tail of reviews/qa-review.md)' };
}

/**
 * Seed context for the chat: the escalated task (title/goal/status + its [ACn]
 * criteria) plus the tail of the role-appropriate review file. null when the task
 * file can't be read (e.g. the id no longer exists).
 */
export async function interventionContext(
  workspacePath: string,
  roleId: RoleId,
  taskId: string,
): Promise<InterventionContext | null> {
  if (!isSafeTaskId(taskId)) {
    return null;
  }
  let content: string;
  try {
    content = await readMarkdown(workspacePath, `tasks/${taskId}.md`);
  } catch {
    return null;
  }
  const parsed = parseTaskFile(content);
  const review = reviewSourceFor(roleId);
  const reviewRaw = await readMarkdown(workspacePath, review.file).catch(() => '');
  return {
    taskId,
    title: parsed.title || taskId,
    goal: getTaskSectionBody(content, 'Goal').trim(),
    status: parsed.status || 'unknown',
    acceptanceCriteria: extractAcceptanceCriteria(content),
    reviewLabel: review.label,
    reviewTail: tailText(reviewRaw, 60, 4000),
  };
}

/** Reads the transcript + the seed context in one shot for the renderer. */
export async function loadIntervention(
  workspacePath: string,
  roleId: RoleId,
  taskId: string,
): Promise<InterventionLoadResult> {
  const [messages, context] = await Promise.all([
    readInterventionLog(workspacePath, roleId, taskId),
    interventionContext(workspacePath, roleId, taskId),
  ]);
  return { messages, context };
}

/**
 * One intervention turn: invoke the seat's CLI in the WORKSPACE cwd (so it can
 * read the real code) with autopilot, seeded with the stuck task + QA output, and
 * persist the transcript. Returns the persona's reply.
 */
export async function runInterventionTurn(
  workspacePath: string,
  roleId: RoleId,
  taskId: string,
  team: ProjectTeam,
  messages: ChatMessage[],
  _namingMode: NamingMode,
): Promise<RoomTurnResult> {
  const clean = sanitizeChatMessages(messages);
  if (clean.length === 0) {
    return { ok: false, reply: '', error: 'No message to send.' };
  }
  const persona = INTERVENTION_PROMPTS[roleId];
  if (!persona) {
    return { ok: false, reply: '', error: 'No intervention chat is available for this role yet.' };
  }
  const context = await interventionContext(workspacePath, roleId, taskId);
  if (!context) {
    return { ok: false, reply: '', error: `Could not read task ${taskId}.` };
  }
  const assignment = team[roleId]?.assignment;
  const prompt = buildInterventionPrompt({
    persona,
    principles: operatingPrinciplesBlock(roleId),
    context,
    references: await referencesPromptBlock(workspacePath),
    pitfalls: await pitfallsSuffix(workspacePath, roleId),
    voice: jianYangTakeoverActive() ? JIAN_YANG_TAKEOVER : '',
    messages: promptWindow(clean),
  });
  const result = await invokeCli(assignment, {
    prompt,
    cwd: workspacePath,
    autopilot: true,
    surface: 'intervention',
    role: roleId,
    timeoutMs: roomTimeoutMsForThinking(
      assignment?.defaultThinkingLevel,
      assignment?.capabilities?.supportsThinkingLevel ?? false,
    ),
  });
  if (!result.ok || result.output.trim() === '') {
    return { ok: false, reply: '', error: result.error ?? 'No response from the CLI.' };
  }
  // Redact secret-shaped tokens before the transcript persists AND git-commits: this
  // seat runs autopilot in the WORKSPACE and can echo real file contents (an .env value)
  // — parity with the run-history/export redaction. Design rooms stay raw by design
  // (temp cwd, no file access, the founder's own working data).
  const reply = redactSecrets(result.output.trim());
  await writeInterventionLog(workspacePath, roleId, taskId, [
    ...clean,
    { role: 'persona', text: reply },
  ]);
  // Diagnosis is meant to be read-only, but the seat runs with autopilot — so commit
  // anything that DID change (best-effort, no-ops when the tree is clean / git is off)
  // to keep the audit trail intact, mirroring the Bullpen's per-actor commits.
  await commitWorkspaceStep(workspacePath, `intervention: ${roleId} chat on ${taskId}`);
  return { ok: true, reply };
}
