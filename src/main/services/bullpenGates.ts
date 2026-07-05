import { appendEscalation, resolveEscalationsByTitle } from '../../shared/escalations';
import { WORKSPACE_FILES } from '../../shared/markdown';
import type { BullpenStepResult } from '../../shared/bullpen';
import type { NamingMode } from '../../shared/naming';
import type { ProjectTeam } from '../../shared/project';
import type { RoleId } from '../../shared/roles';
import { banterFor, captureLesson } from './bullpenContext';
import { readMarkdown, writeMarkdown } from './markdownWorkspace';

/**
 * The Bullpen review gates (security / architect / ops): prove, don't claim. A configured
 * reviewer that fails escalates + pauses (never marks the gate done); an unassigned
 * reviewer is a silent skip; a recovered gate flips its stale escalation to resolved.
 * Extracted from bullpenEngine.
 */

export function hasReviewer(team: ProjectTeam, roleId: RoleId): boolean {
  const a = team[roleId]?.assignment;
  return !!a && a.command.trim() !== '';
}

type GateRole = 'security' | 'architect' | 'ops';

const GATE_NOUN: Record<GateRole, string> = {
  security: 'security',
  architect: 'architecture',
  ops: 'documentation',
};

const GATE_LABEL: Record<GateRole, string> = {
  security: 'Security',
  architect: 'Architecture',
  ops: 'Documentation',
};

export function gateSkippedStep(
  roleId: GateRole,
  phaseName: string,
  taskTitle: string,
): BullpenStepResult {
  const role = GATE_NOUN[roleId];
  return {
    allDone: false, taskId: null, taskTitle, actor: roleId, status: 'review',
    log: `No ${role} reviewer assigned — gate skipped (nothing to prove).`,
    passed: null, escalated: false, iterations: null, error: null, phaseName,
    // A skipped gate is a non-event — drive the loop, but keep it out of the log.
    silent: true,
  };
}

/**
 * A configured reviewer failed or was unavailable. Escalate + pause; the gate
 * stays NOT done, so the build can't advance claiming a review that didn't run.
 */
export async function escalateGate(
  workspacePath: string,
  roleId: GateRole,
  phaseName: string,
  taskTitle: string,
  detail: string,
  namingMode: NamingMode,
): Promise<BullpenStepResult> {
  await captureLesson(workspacePath, 'gate-failure', roleId, roleId, detail);
  const label = GATE_LABEL[roleId];
  const context = `The ${label.toLowerCase()} review for phase "${phaseName}" could not complete: ${detail}. The gate is NOT marked done — the build is paused rather than claim a review that did not run. Assign a working ${roleId} CLI and resume, or re-draft the plan to start fresh.`;
  const escContent = await readMarkdown(workspacePath, WORKSPACE_FILES.escalations).catch(
    () => '# Escalations\n',
  );
  const { content } = appendEscalation(escContent, {
    title: `${label} review — ${phaseName}`,
    from: 'engine',
    task: phaseName,
    reason: 'other',
    context,
    tried: `Ran the ${roleId} agent in autopilot; it failed or was unavailable.`,
    recommendation: `Assign a working ${roleId} CLI and resume, or re-draft to reset the plan.`,
    createdAt: new Date().toISOString(),
  });
  await writeMarkdown(workspacePath, WORKSPACE_FILES.escalations, content);
  return {
    allDone: false, taskId: null, taskTitle, actor: roleId, status: 'human-needed',
    log: context, passed: false, escalated: true, iterations: null, error: detail,
    banter: banterFor(roleId, 'disappointed', namingMode), phaseName,
  };
}

/**
 * When a review gate completes (its done-flag is set), flip any open ESCALATIONS.md record
 * for THIS phase+gate to resolved — a gate that failed on a transient blip (an Overloaded
 * 529, an auth flap) and later passed on resume shouldn't leave a stale "open" audit entry.
 * Keyed on the gate-specific title so it never resolves a sibling gate on the same phase.
 * Best-effort — never breaks a gate step (a stale open record is harmless by comparison).
 */
export async function resolveGateEscalation(
  workspacePath: string,
  roleId: GateRole,
  phaseName: string,
): Promise<void> {
  try {
    const esc = await readMarkdown(workspacePath, WORKSPACE_FILES.escalations).catch(() => null);
    if (esc === null) return;
    const next = resolveEscalationsByTitle(esc, `${GATE_LABEL[roleId]} review — ${phaseName}`);
    if (next !== esc) {
      await writeMarkdown(workspacePath, WORKSPACE_FILES.escalations, next);
    }
  } catch {
    // best-effort
  }
}
