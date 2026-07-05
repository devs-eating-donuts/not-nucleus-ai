import fs from 'node:fs/promises';
import { composeBlueprint, securityRulesContextBlock, withBaseline } from '../../shared/blueprints';
import {
  inferDeploymentPosture,
  renderDecisionsBlock,
  sanitizeDecisions,
} from '../../shared/decisions';
import type { Decisions } from '../../shared/decisions';
import { scaffoldContextBlock } from '../../shared/scaffold';
import { nfrContextBlock } from '../../shared/nfrDefaults';
import type { LessonSignal } from '../../shared/lessons';
import { lessonsStore } from './lessonsStore';
import { loadTechContext, pitfallsSuffix } from './lessonsContext';
import { jianYangTakeoverActive } from './settingsStore';
import { META_DIR } from '../../shared/markdown';
import type { RoleId } from '../../shared/roles';
import { DEFAULT_PERSONAS, defaultPersonaForRole } from '../../shared/personas';
import type { NamingMode } from '../../shared/naming';
import { pickBanter } from '../../shared/banter';
import type { BanterMood } from '../../shared/banter';
import { referencesPromptBlock } from './referencesStore';
import { secretsManifestPromptBlock } from './secretsManifestStore';
import { readProjectInfo, resolveWorkspacePath } from './markdownWorkspace';

/**
 * The ambient context every Bullpen seat is given: the per-role prompt blocks
 * (scaffold / security rules / nfr / approved-scope / references / secrets / pitfalls),
 * the approved-scope (decisions.json) reader the remediation gate also uses, the
 * lessons-memory capture helper, and the persona/banter helpers. Extracted from
 * bullpenEngine; each block is '' when its feature is unused so prompts stay
 * byte-identical for projects without it.
 */

/**
 * The shared per-role context blocks appended after each persona prompt: the "build on
 * the scaffolded base" note, the composed SECURITY & QUALITY RULES, the uploaded
 * references (absolute paths), the names-only secrets manifest, and any confirmed
 * lessons-memory pitfalls. Centralized so EVERY build and review seat sees the same
 * context — previously only dev/QA got references + secrets, so the security, architect,
 * and ops reviewers judged without the uploaded spec/wireframes or the secrets manifest,
 * and NO seat was ever told the blueprint's security rules — so dev built
 * insecurely and the review then manufactured the whole remediation tail.
 * Each block is '' when its feature is unused, so prompts stay byte-identical for projects
 * with no scaffold / no blueprint rules / no decisions artifact / no references / no secrets /
 * no confirmed lessons.
 */
export async function roleContextBlocks(workspacePath: string, roleId: RoleId): Promise<string> {
  return (
    (await scaffoldContextPromptBlock(workspacePath)) +
    (await securityRulesPromptBlock(workspacePath)) +
    (await nfrContextPromptBlock(workspacePath)) +
    (await decisionsPromptBlock(workspacePath)) +
    (await referencesPromptBlock(workspacePath)) +
    (await secretsManifestPromptBlock(workspacePath)) +
    (await pitfallsSuffix(workspacePath, roleId))
  );
}

/**
 * The web-frontend QUALITY baseline (nfrDefaults) for the build/review seats — dev is told
 * the SEO/a11y/async-state floor up front, reviewers judge against the same list. '' for
 * APIs/CLIs/desktop apps/template projects (byte-identical). Best-effort.
 */
async function nfrContextPromptBlock(workspacePath: string): Promise<string> {
  const info = await readProjectInfo(workspacePath).catch(() => null);
  return nfrContextBlock(info?.scaffoldId, info?.templateId, info?.deploymentPosture);
}

/** The approved-scope artifact (B1) — posture + chosen decisions the reviewers judge against. */
const DECISIONS_PATH = `${META_DIR}/decisions.json`;

/** Read + validate .nucleus/decisions.json; null when absent/malformed (best-effort). */
export async function readDecisions(workspacePath: string): Promise<Decisions | null> {
  try {
    const raw = await fs.readFile(resolveWorkspacePath(workspacePath, DECISIONS_PATH), 'utf8');
    return sanitizeDecisions(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * The APPROVED SCOPE & DEPLOYMENT POSTURE block: so every build/review seat judges
 * findings against the posture the founder + architect settled — not a production threat
 * model they were never given (a false-CRITICAL root cause). '' when there's no
 * decisions artifact (from-scratch), keeping prompts byte-identical. Best-effort.
 * This is the SOFT guidance to the model; the HARD gate is partitionFindings in remediation.
 */
async function decisionsPromptBlock(workspacePath: string): Promise<string> {
  return renderDecisionsBlock(await readDecisions(workspacePath));
}

/**
 * The composed blueprint's SECURITY & QUALITY RULES, so dev is told the controls it must
 * satisfy up front (and the reviewers judge against them). Reads the project's persisted
 * templateId + overlayIds. '' when nothing composes rules — byte-identical for from-scratch
 * projects. Best-effort (never breaks a step). Pure rendering in securityRulesContextBlock.
 */
async function securityRulesPromptBlock(workspacePath: string): Promise<string> {
  const info = await readProjectInfo(workspacePath).catch(() => null);
  // Posture from the approved-scope artifact (authoritative — what draftPlan actually
  // recorded); fall back to the project's choice / a strict inferred default. This gates
  // the A1 baseline floor so a single-user/localhost app is never told to add auth.
  const decisions = await readDecisions(workspacePath);
  const posture =
    decisions?.deploymentPosture ??
    info?.deploymentPosture ??
    inferDeploymentPosture({ templateId: info?.templateId, ripIt: info?.ripIt });
  const composed = withBaseline(composeBlueprint(info?.templateId, info?.overlayIds ?? []), posture);
  return securityRulesContextBlock(composed.securityRules);
}

/**
 * "Build ON the generated base app" block for the build/review seats — read from the
 * project's persisted scaffoldId. '' when the project was created without a scaffolder, so
 * the prompts stay byte-identical for from-scratch projects. Best-effort.
 */
async function scaffoldContextPromptBlock(workspacePath: string): Promise<string> {
  const info = await readProjectInfo(workspacePath).catch(() => null);
  return scaffoldContextBlock(info?.scaffoldId);
}

/** Record a Bullpen failure as a lesson observation. Best-effort — never breaks a step. */
export async function captureLesson(
  workspacePath: string,
  signal: LessonSignal,
  roleId: RoleId,
  normalizedKey: string,
  detail?: string,
): Promise<void> {
  try {
    const tc = await loadTechContext(workspacePath);
    await lessonsStore.recordObservation({
      signal,
      archetype: tc.archetype,
      stack: tc.stack,
      roleId,
      normalizedKey,
      projectId: tc.projectId,
      detail,
    });
  } catch {
    // Capture is advisory; a store hiccup must never fail the build.
  }
}

/* ----- banter (canned one-liners; Jian Yang takes over once the switch flips) ----- */

export const ADVISORY_PERSONA_IDS = DEFAULT_PERSONAS.filter((p) => p.flavorOnly).map((p) => p.id);

/** The persona whose canned lines an actor speaks (Jian Yang when he's taken over). */
function bullpenPersonaId(roleId: RoleId): string {
  if (jianYangTakeoverActive()) {
    return 'jian-yang';
  }
  return defaultPersonaForRole(roleId)?.id ?? '';
}

/** The takeover is mode-independent now; the namingMode param is kept for
 * call-site stability (and future per-mode banter, if ever). */
export function banterFor(roleId: RoleId, mood: BanterMood, _namingMode: NamingMode): string {
  return pickBanter(bullpenPersonaId(roleId), mood);
}
