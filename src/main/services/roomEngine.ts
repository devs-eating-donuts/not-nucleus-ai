import os from 'node:os';
import { META_DIR } from '../../shared/markdown';
import type { ProjectTeam } from '../../shared/project';
import type { ChatMessage, RoomTurnResult } from '../../shared/room';
import {
  JIAN_YANG_TAKEOVER,
  OPENING_PROMPTS,
  RIP_IT_STAKEHOLDER_OPENING,
  RIP_IT_STAKEHOLDER_PROMPT,
  ROOM_PROMPTS,
} from '../../shared/roomPrompts';
import type { NamingMode } from '../../shared/naming';
import { renderCustomRolePrompt } from '../../shared/prompts';
import type { PromptVariableValues } from '../../shared/prompts';
import type { RoleId } from '../../shared/roles';
import { ROLE_DEFINITIONS } from '../../shared/roles';
import { getTemplateById } from '../../shared/templates';
import { architectTemplateBlock, composeBlueprint } from '../../shared/blueprints';
import type { IntakeQuestion } from '../../shared/blueprints';
import { operatingPrinciplesBlock } from '../../shared/operatingPrinciples';
import { scaffoldContextBlock } from '../../shared/scaffold';
import { roomTimeoutMsForThinking } from '../../shared/cli';
import { invokeCli } from './cliInvoker';
import { pitfallsSuffix } from './lessonsContext';
import { referencesPromptBlock } from './referencesStore';
import { secretsManifestPromptBlock } from './secretsManifestStore';
import { jianYangTakeoverActive } from './settingsStore';
import { promptWindow, readTranscript, sanitizeChatMessages, writeTranscript } from './transcriptStore';

/**
 * The names-only secrets block, but only for the design roles who decide secrets
 * (Richard plans them; Monica scopes them) — so the founder is asked which store
 * each targets. '' for every other role and for projects with no secrets, keeping
 * those prompts byte-identical.
 */
async function secretsRoomBlock(workspacePath: string, roleId: RoleId): Promise<string> {
  if (roleId !== 'architect' && roleId !== 'projectLead') {
    return '';
  }
  return secretsManifestPromptBlock(workspacePath);
}
import { readProjectInfo, resolveWorkspacePath } from './markdownWorkspace';

/**
 * Runs a project-scoped room turn: invokes the role's assigned CLI (from the
 * PROJECT's team) one-shot, in character, and persists the transcript in the
 * workspace at .nucleus/rooms/<roleId>.json. Runs in a temp cwd so the
 * agentic CLI stays conversational and doesn't touch files yet.
 */

function logPath(workspacePath: string, roleId: RoleId): string {
  return resolveWorkspacePath(workspacePath, `${META_DIR}/rooms/${roleId}.json`);
}

export async function readRoomLog(workspacePath: string, roleId: RoleId): Promise<ChatMessage[]> {
  return readTranscript(logPath(workspacePath, roleId));
}

async function writeRoomLog(
  workspacePath: string,
  roleId: RoleId,
  messages: ChatMessage[],
): Promise<void> {
  await writeTranscript(logPath(workspacePath, roleId), messages, { roleId });
}

/**
 * Which earlier rooms feed a role's context, so a persona builds on prior
 * sessions instead of starting blind. Monica sees Erlich's pitch; Richard sees
 * both, so he can pick up the founder's answers and drive the tech decisions.
 */
const CONTEXT_ROOMS: Partial<Record<RoleId, RoleId[]>> = {
  projectLead: ['stakeholder'],
  architect: ['stakeholder', 'projectLead'],
};

function formatTranscript(messages: ChatMessage[], personaSpeaker: string): string {
  return messages
    .map((m) => `${m.role === 'user' ? 'Founder' : personaSpeaker}: ${m.text}`)
    .join('\n');
}

/** Reads the prior rooms this role draws on and formats them as context. */
async function buildContextBlock(workspacePath: string, roleId: RoleId): Promise<string> {
  const sources = CONTEXT_ROOMS[roleId];
  if (!sources) {
    return '';
  }
  const blocks: string[] = [];
  for (const sourceRole of sources) {
    const log = await readRoomLog(workspacePath, sourceRole);
    if (log.length > 0) {
      const label = ROLE_DEFINITIONS[sourceRole].label;
      // Windowed: cross-room context rides EVERY chat turn — the full persisted log
      // is for one-shot consumers (Richard's plan draft reads it unwindowed).
      blocks.push(`From the ${label} session:\n${formatTranscript(promptWindow(log), label)}`);
    }
  }
  return blocks.length > 0 ? `\n\nContext from earlier sessions:\n\n${blocks.join('\n\n')}` : '';
}

/**
 * Tell the DESIGN roles (Monica + Richard) that a runnable base app was already scaffolded,
 * so they design WITHIN the chosen stack instead of re-picking the framework. Erlich's pitch
 * doesn't need it; the build seats get it via the Bullpen's roleContextBlocks. '' for other
 * roles or when no scaffolder was used (then prompts stay byte-identical).
 */
async function buildScaffoldBlock(workspacePath: string, roleId: RoleId): Promise<string> {
  if (roleId !== 'projectLead' && roleId !== 'architect') {
    return '';
  }
  const info = await readProjectInfo(workspacePath).catch(() => null);
  return scaffoldContextBlock(info?.scaffoldId);
}

/**
 * For the Architect, surface the founder's selected template/archetype AND the
 * composed decision matrix + security rules so Richard guides them WITHIN the chosen
 * shape (its decisions + suggested stack) instead of re-deriving it. Composes overlays
 * EVEN WHEN no base template was chosen (the scaffolder/wizard path, `templateId: null`)
 * so an overlay-only/scaffold project still gets Richard's A/B/C auth & secret questions.
 * Empty for other roles and when nothing composes (no template AND
 * no overlays), keeping those prompts byte-identical. Rendering lives in the pure,
 * unit-tested `architectTemplateBlock`.
 */
async function buildTemplateBlock(workspacePath: string, roleId: RoleId): Promise<string> {
  if (roleId !== 'architect') {
    return '';
  }
  const info = await readProjectInfo(workspacePath);
  const template = info?.templateId ? getTemplateById(info.templateId) : undefined;
  const composed = composeBlueprint(info?.templateId, info?.overlayIds ?? []);
  return architectTemplateBlock(template, composed);
}

/**
 * For the Project Lead (Monica), surface the *critical* intake questions for the
 * composed archetype + overlays so she covers everything the user NEEDS in
 * conversation. Empty for other roles or when no blueprint matches the template.
 */
async function buildIntakeBlock(workspacePath: string, roleId: RoleId): Promise<string> {
  if (roleId !== 'projectLead') {
    return '';
  }
  const info = await readProjectInfo(workspacePath);
  const composed = composeBlueprint(info?.templateId, info?.overlayIds ?? []);
  const critical = composed.intakeQuestions.filter((q: IntakeQuestion) => q.critical);
  if (critical.length === 0) {
    return '';
  }
  return (
    [
      '\n\nNEEDS TO COVER for this kind of product (work through these in conversation,',
      'one or two at a time, in your own voice — do not dump them as a list). Make sure',
      "you have a clear answer for each before handing off to the Architect:",
    ].join(' ') +
    '\n' +
    critical.map((q) => `- ${q.question}`).join('\n')
  );
}

/**
 * For the Project Lead (Monica), surface the archetype's LIKELY NON-GOALS so she
 * confirms what is out of scope for v1 — the data behind her scope-cutting
 * operating principle. Uses the existing blueprint.nonGoals (shown to no one
 * before this). Empty for other roles and for template-less projects (then
 * composeBlueprint yields no non-goals), keeping those prompts byte-identical.
 */
async function buildNonGoalsBlock(workspacePath: string, roleId: RoleId): Promise<string> {
  if (roleId !== 'projectLead') {
    return '';
  }
  const info = await readProjectInfo(workspacePath);
  const composed = composeBlueprint(info?.templateId, info?.overlayIds ?? []);
  if (composed.nonGoals.length === 0) {
    return '';
  }
  return (
    [
      '\n\nLIKELY NON-GOALS for this kind of product — confirm with the founder that each',
      'is genuinely out of scope for v1 (call them out plainly; if they want one IN, note',
      'it and fold it into the brief):',
    ].join(' ') +
    '\n' +
    composed.nonGoals.map((n) => `- ${n}`).join('\n')
  );
}

/**
 * Variables available to a role's custom prompt template in a room turn. Run
 * variables the room doesn't have (task-level, previous-role summary) are left
 * unresolved — renderTemplate keeps unknown placeholders intact.
 */
async function roomVariables(
  workspacePath: string,
  roleId: RoleId,
  team: ProjectTeam,
): Promise<PromptVariableValues> {
  const info = await readProjectInfo(workspacePath);
  const template = info?.templateId ? getTemplateById(info.templateId) : undefined;
  const cfg = team[roleId];
  return {
    project_name: info?.projectName ?? '',
    working_directory: workspacePath,
    target_stack: template?.suggestedStack.join(', ') ?? '',
    execution_mode: cfg?.assignment?.executionMode ?? '',
    review_trigger: cfg?.reviewTrigger ?? '',
  };
}

/** The operator's customized prompt for this role (empty unless edited). */
async function customRoomBlock(
  workspacePath: string,
  roleId: RoleId,
  team: ProjectTeam,
): Promise<string> {
  const vars = await roomVariables(workspacePath, roleId, team);
  return renderCustomRolePrompt(roleId, team[roleId]?.promptTemplate, vars);
}

/**
 * The persona's base room prompt. The stakeholder seat of a "Rip it and Ship It"
 * project uses Erlich's express-lane prompt (reject-but-lend-Dinesh) instead of
 * the normal incubator pitch; every other case is byte-identical to before.
 */
async function effectiveRoomPrompt(workspacePath: string, roleId: RoleId): Promise<string> {
  if (roleId === 'stakeholder') {
    const info = await readProjectInfo(workspacePath).catch(() => null);
    if (info?.ripIt) {
      return RIP_IT_STAKEHOLDER_PROMPT;
    }
  }
  return ROOM_PROMPTS[roleId];
}

/** Resolves the role's CLI and runs one one-shot turn with the given prompt. */
async function invokeRoom(
  roleId: RoleId,
  team: ProjectTeam,
  prompt: string,
): Promise<RoomTurnResult> {
  // Conversational: a tmp cwd and no autopilot flags, so the agentic CLI stays
  // chatty and never touches files. Honors the seat's model/args/env config.
  // Budget scales with the seat's thinking level — ultrathink needs minutes, so a
  // flat 120s used to kill it mid-reasoning (and lose the user's message).
  const result = await invokeCli(team[roleId]?.assignment, {
    prompt,
    cwd: os.tmpdir(),
    timeoutMs: roomTimeoutMsForThinking(
      team[roleId]?.assignment?.defaultThinkingLevel,
      team[roleId]?.assignment?.capabilities?.supportsThinkingLevel ?? false,
    ),
    // The Erlich incubator pitch runs through this same room engine; tag it distinctly
    // so The Garage can tell the pitch apart from the Monica/Richard design rooms.
    surface: roleId === 'stakeholder' ? 'pitch' : 'room',
    role: roleId,
  });
  if (!result.ok || result.output.trim() === '') {
    return { ok: false, reply: '', error: result.error ?? 'No response from the CLI.' };
  }
  return { ok: true, reply: result.output.trim() };
}

export async function runRoomTurn(
  workspacePath: string,
  roleId: RoleId,
  team: ProjectTeam,
  messages: ChatMessage[],
  _namingMode: NamingMode,
): Promise<RoomTurnResult> {
  const clean = sanitizeChatMessages(messages);
  if (clean.length === 0) {
    return { ok: false, reply: '', error: 'No message to send.' };
  }
  const context = await buildContextBlock(workspacePath, roleId);
  const templateBlock = await buildTemplateBlock(workspacePath, roleId);
  const scaffoldBlock = await buildScaffoldBlock(workspacePath, roleId);
  const intakeBlock = await buildIntakeBlock(workspacePath, roleId);
  const nonGoals = await buildNonGoalsBlock(workspacePath, roleId);
  const custom = await customRoomBlock(workspacePath, roleId, team);
  // Senior reasoning, appended after the operator's custom edits so those still
  // outrank the baseline. '' for any role not enabled in PRINCIPLES_ENABLED.
  const principles = operatingPrinciplesBlock(roleId);
  const pitfalls = await pitfallsSuffix(workspacePath, roleId);
  const references = await referencesPromptBlock(workspacePath);
  const secrets = await secretsRoomBlock(workspacePath, roleId);
  const basePrompt = await effectiveRoomPrompt(workspacePath, roleId);
  const voice = jianYangTakeoverActive() ? JIAN_YANG_TAKEOVER : '';
  const prompt = `${voice}${basePrompt}${custom}${principles}${templateBlock}${scaffoldBlock}${intakeBlock}${nonGoals}${pitfalls}${references}${secrets}${context}\n\nConversation so far:\n${formatTranscript(
    promptWindow(clean),
    'You',
  )}\n\nReply with your next message only, in character.`;
  const result = await invokeRoom(roleId, team, prompt);
  if (!result.ok) {
    return result;
  }
  await writeRoomLog(workspacePath, roleId, [...clean, { role: 'persona', text: result.reply }]);
  return result;
}

/**
 * Opening turn: the persona speaks first. Generates and persists a single
 * opening message drawing on earlier rooms. No-op (ok with empty reply) if the
 * room already has messages, so it is safe to call on every page open.
 */
export async function runRoomKickoff(
  workspacePath: string,
  roleId: RoleId,
  team: ProjectTeam,
  _namingMode: NamingMode,
): Promise<RoomTurnResult> {
  const existing = await readRoomLog(workspacePath, roleId);
  if (existing.length > 0) {
    return { ok: true, reply: '' };
  }
  const info = await readProjectInfo(workspacePath).catch(() => null);
  // Rip-it projects let Erlich open the express-lane chat; otherwise only the
  // roles with an OPENING_PROMPT speak first.
  const opening =
    roleId === 'stakeholder' && info?.ripIt ? RIP_IT_STAKEHOLDER_OPENING : OPENING_PROMPTS[roleId];
  if (!opening) {
    return { ok: false, reply: '', error: 'This role does not open the conversation.' };
  }
  const context = await buildContextBlock(workspacePath, roleId);
  const templateBlock = await buildTemplateBlock(workspacePath, roleId);
  const scaffoldBlock = await buildScaffoldBlock(workspacePath, roleId);
  const intakeBlock = await buildIntakeBlock(workspacePath, roleId);
  const nonGoals = await buildNonGoalsBlock(workspacePath, roleId);
  const custom = await customRoomBlock(workspacePath, roleId, team);
  // Senior reasoning, appended after the operator's custom edits so those still
  // outrank the baseline. '' for any role not enabled in PRINCIPLES_ENABLED.
  const principles = operatingPrinciplesBlock(roleId);
  const pitfalls = await pitfallsSuffix(workspacePath, roleId);
  const references = await referencesPromptBlock(workspacePath);
  const secrets = await secretsRoomBlock(workspacePath, roleId);
  const basePrompt = await effectiveRoomPrompt(workspacePath, roleId);
  const voice = jianYangTakeoverActive() ? JIAN_YANG_TAKEOVER : '';
  const prompt = `${voice}${basePrompt}${custom}${principles}${templateBlock}${scaffoldBlock}${intakeBlock}${nonGoals}${pitfalls}${references}${secrets}${context}\n\n${opening}`;
  const result = await invokeRoom(roleId, team, prompt);
  if (!result.ok) {
    return result;
  }
  await writeRoomLog(workspacePath, roleId, [{ role: 'persona', text: result.reply }]);
  return result;
}
