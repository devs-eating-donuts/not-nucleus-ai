import os from 'node:os';
import { META_DIR } from '../../shared/markdown';
import type { ProjectTeam } from '../../shared/project';
import type { ChatMessage, WorkRequestTurnResult } from '../../shared/room';
import type { InvocationSurface } from '../../shared/diagnostics';
import { JIAN_YANG_TAKEOVER } from '../../shared/roomPrompts';
import type { NamingMode } from '../../shared/naming';
import { activePhaseOf } from '../../shared/bullpenPlan';
import type { PlanTask } from '../../shared/bullpenPlan';
import { roomTimeoutMsForThinking } from '../../shared/cli';
import { invokeCli } from './cliInvoker';
import { jianYangTakeoverActive } from './settingsStore';
import { appendTaskToPhase } from './bullpenEngine';
import { readProjectPlan } from './whiteboardEngine';
import { resolveWorkspacePath } from './markdownWorkspace';
import { promptWindow, readTranscript, sanitizeChatMessages, writeTranscript } from './transcriptStore';

/**
 * Task-intake rooms — terse 1-on-1 chats with Richard (the architect's CLI) that
 * run AFTER the plan is drafted and turn the owner's words into canonical tasks
 * the Bullpen picks up. The app (not the CLI) writes each task, so it stays in
 * the canonical format and inside the workspace boundary.
 *
 * The Punch List (`work-request`) channel uses this engine: ad-hoc change
 * requests mid/post-build, turned into canonical tasks the Bullpen picks up.
 */

/* ----- the "file a task" directive Richard emits when he accepts ----- */

export interface FileDirective {
  /** An existing phase name to file under, or 'auto' for the system to pick. */
  phaseHint: string;
  title: string;
  work: string;
}

const DIRECTIVE_RE = /^\s*CREATE-TASK\s*::\s*(.*)$/i;

/**
 * Parse Richard's final filing directive from his reply: a single line
 *   `CREATE-TASK :: <phase|auto> :: <title> :: <work>`
 * Scanned from the end; only the last matching line counts. null when he isn't
 * filing (a pushback / clarifying reply has no such line). A directive with no
 * title is treated as absent (don't file an untitled task).
 */
export function parseFileDirective(reply: string): FileDirective | null {
  const lines = reply.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(DIRECTIVE_RE);
    if (!m) {
      continue;
    }
    const parts = m[1].split('::').map((p) => p.trim());
    const phaseHint = parts[0] ?? '';
    const title = parts[1] ?? '';
    const work = parts.slice(2).join(' :: ').trim();
    if (title === '') {
      return null;
    }
    return { phaseHint, title, work };
  }
  return null;
}

/** Remove the directive line(s) so the user sees only Richard's prose reply. */
export function stripFileDirective(reply: string): string {
  return reply
    .split(/\r?\n/)
    .filter((l) => !DIRECTIVE_RE.test(l))
    .join('\n')
    .trim();
}

/* ----- channels ----- */

interface IntakeChannel {
  /** Transcript file under the workspace (one per channel, distinct from rooms). */
  logFile: string;
  /** Diagnostics tag so The Garage tells the channels apart. */
  surface: InvocationSurface;
  /** The persona prompt for a turn on this channel. */
  buildPrompt: (
    phases: string[],
    taskLines: string[],
    messages: ChatMessage[],
    namingMode: NamingMode,
  ) => string;
  /** Footer lines appended to a filed task's goal (attribution + build guard). */
  goalFooter: string[];
  /** The single acceptance criterion the filed task carries. */
  acceptanceCriterion: string;
  /** Stand-in reply when Richard filed but his prose came back empty. */
  emptyFiledReply: string;
}

/* ----- The Punch List prompt (ad-hoc change requests) ----- */

function buildPunchListPrompt(
  phases: string[],
  taskLines: string[],
  messages: ChatMessage[],
  _namingMode: NamingMode,
): string {
  const voice = jianYangTakeoverActive() ? JIAN_YANG_TAKEOVER : '';
  const phaseList = phases.length > 0 ? phases.map((p) => `- ${p}`).join('\n') : '(no phases yet)';
  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'Owner' : 'You'}: ${m.text}`)
    .join('\n');
  return [
    voice,
    'You are Richard Hendricks, the architect, holding the line on scope during a build.',
    'The owner walks in with an ad-hoc change request — a tweak, a look/feel fix, one more',
    'small thing. Your job is to TRIAGE it, fast. KEY RULE: keep every reply to ONE or TWO',
    'sentences, max — no rambling, no monologue (this is not The Whiteboard). Be a little',
    'anxious but decisive.',
    '',
    'Decide one of two things each turn:',
    '1) PUSH BACK if the request is vague, too big for a single task, or a bad idea — ask ONE',
    '   sharp clarifying question, or say plainly why it should wait. Do NOT file anything.',
    '2) ACCEPT if it is clear and reasonably scoped. Say so in a sentence, then file it: end',
    '   your message with a SINGLE final line in EXACTLY this format and nothing after it:',
    '   CREATE-TASK :: <phase> :: <title> :: <one-sentence description for the developer>',
    '   For <phase>, copy ONE of the existing phase names below that best fits the work, or',
    '   write `auto` to let the system place it. Keep <title> short. Output that line ONLY',
    '   when you are actually filing — never in a pushback or a question.',
    '',
    `EXISTING PHASES (file under the most plausible one):\n${phaseList}`,
    '',
    `CURRENT TASKS (so you don't duplicate work):\n${taskLines.length > 0 ? taskLines.join('\n') : '(none yet)'}`,
    '',
    `Conversation so far:\n${transcript}`,
    '',
    'Reply with your next message only, in character. One or two sentences — plus the',
    'CREATE-TASK line only if you are accepting and filing.',
  ].join('\n');
}

const WORK_REQUEST: IntakeChannel = {
  logFile: `${META_DIR}/rooms/work-request.json`,
  surface: 'work-request',
  buildPrompt: buildPunchListPrompt,
  goalFooter: [
    'Change requested by the owner via The Punch List (Richard reviewed and accepted it).',
    'Implement it in the current directory without breaking what already works.',
  ],
  acceptanceCriterion: 'The requested change is implemented as described',
  emptyFiledReply: 'Okay — yeah, filing that.',
};

/* ----- transcript persistence ----- */

function logPath(channel: IntakeChannel, workspacePath: string): string {
  return resolveWorkspacePath(workspacePath, channel.logFile);
}

async function readIntakeLog(channel: IntakeChannel, workspacePath: string): Promise<ChatMessage[]> {
  return readTranscript(logPath(channel, workspacePath));
}

async function writeIntakeLog(
  channel: IntakeChannel,
  workspacePath: string,
  messages: ChatMessage[],
): Promise<void> {
  await writeTranscript(logPath(channel, workspacePath), messages);
}

/**
 * Resolve the phase to file under: Richard's hint if it names (or clearly
 * matches) an existing phase, else the active phase (first still being built;
 * the last phase if every task is terminal), else the only/last phase.
 */
function resolvePhase(phaseHint: string, phases: string[], planTasks: PlanTask[]): string {
  const hint = phaseHint.trim().toLowerCase();
  if (hint !== '' && hint !== 'auto') {
    const exact = phases.find((p) => p.toLowerCase() === hint);
    if (exact) {
      return exact;
    }
    const partial = phases.find(
      (p) => p.toLowerCase().includes(hint) || hint.includes(p.toLowerCase()),
    );
    if (partial) {
      return partial;
    }
  }
  return activePhaseOf(planTasks) ?? phases[phases.length - 1] ?? 'Tasks';
}

/* ----- the turn ----- */

async function runIntakeTurn(
  channel: IntakeChannel,
  workspacePath: string,
  team: ProjectTeam,
  messages: ChatMessage[],
  namingMode: NamingMode,
): Promise<WorkRequestTurnResult> {
  const clean = sanitizeChatMessages(messages);
  if (clean.length === 0 || clean[clean.length - 1].role !== 'user') {
    return { ok: false, reply: '', error: 'No message to send.' };
  }
  const assignment = team.architect?.assignment;
  if (!assignment || assignment.command.trim() === '') {
    return { ok: false, reply: '', error: "The Architect has no CLI assigned on the project's team." };
  }

  // Context for placement: the plan's phases (in order) + a short task list.
  const plan = await readProjectPlan(workspacePath);
  const phases: string[] = [];
  for (const t of plan.tasks) {
    const feature = t.feature ?? 'Tasks';
    if (!phases.includes(feature)) {
      phases.push(feature);
    }
  }
  const planTasks: PlanTask[] = plan.tasks.map((t) => ({
    id: t.id,
    status: t.status,
    kind: 'build',
    phase: t.feature ?? 'Tasks',
  }));
  const taskLines = plan.tasks.map(
    (t) => `- ${t.id} [${t.feature ?? 'Tasks'}] ${t.title} (${t.status})`,
  );

  const prompt = channel.buildPrompt(phases, taskLines, promptWindow(clean), namingMode);
  // Conversational: tmp cwd, no autopilot — Richard reasons, the APP files the task.
  // Budget scales with the architect's thinking level (ultrathink needs minutes).
  const run = await invokeCli(assignment, {
    prompt,
    cwd: os.tmpdir(),
    timeoutMs: roomTimeoutMsForThinking(
      assignment.defaultThinkingLevel,
      assignment.capabilities?.supportsThinkingLevel ?? false,
    ),
    surface: channel.surface,
    role: 'architect',
  });
  if (!run.ok || run.output.trim() === '') {
    return { ok: false, reply: '', error: run.error ?? 'No response from the Architect CLI.' };
  }

  const raw = run.output.trim();
  const directive = parseFileDirective(raw);
  let display = stripFileDirective(raw);
  let createdTaskId: string | null = null;
  let phaseName: string | null = null;

  if (directive) {
    phaseName = resolvePhase(directive.phaseHint, phases, planTasks);
    const goal = [directive.work || directive.title, '', ...channel.goalFooter].join('\n');
    createdTaskId = await appendTaskToPhase(
      workspacePath,
      phaseName,
      directive.title.slice(0, 120),
      goal,
      [channel.acceptanceCriterion],
      false,
    );
    if (createdTaskId) {
      if (display === '') {
        display = channel.emptyFiledReply;
      }
      display += `\n\n_Filed as ${createdTaskId} under "${phaseName}". The Bullpen picks it up in turn._`;
    } else {
      display =
        (display === '' ? 'Okay, I tried to file that' : display) +
        '\n\n_(Couldn’t write the task — check the workspace and try again.)_';
      phaseName = null;
    }
  }

  // Best-effort: the TURN already succeeded (reply generated, task filed) — a failed
  // log write must not surface as a failed turn, or its Retry would re-run Richard
  // and file a DUPLICATE task. The renderer keeps the in-memory transcript either way.
  try {
    await writeIntakeLog(channel, workspacePath, [...clean, { role: 'persona', text: display }]);
  } catch {
    /* transcript persistence is best-effort once the task is filed */
  }
  return { ok: true, reply: display, createdTaskId, phaseName };
}

/* ----- public surface (one pair per channel) ----- */

/** The Punch List transcript (Richard's ad-hoc change-intake chat). */
export function readWorkRequestLog(workspacePath: string): Promise<ChatMessage[]> {
  return readIntakeLog(WORK_REQUEST, workspacePath);
}

/** One Punch List turn: Richard triages the request and may file a task. */
export function runWorkRequestTurn(
  workspacePath: string,
  team: ProjectTeam,
  messages: ChatMessage[],
  namingMode: NamingMode,
): Promise<WorkRequestTurnResult> {
  return runIntakeTurn(WORK_REQUEST, workspacePath, team, messages, namingMode);
}
