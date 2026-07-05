import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import { WORKSPACE_FILES } from '../../shared/markdown';
import type { ProjectTeam } from '../../shared/project';
import type {
  DraftedPhase,
  DraftedTask,
  ProjectPlan,
  TaskSummary,
  WhiteboardDraftResult,
} from '../../shared/whiteboard';
import { createTaskFileContent } from '../../shared/taskfile';
import { parseTaskFile } from '../../shared/taskfile';
import {
  appHandlesDataOrSecrets,
  composeBlueprint,
  localServicesPlanNote,
  withBaseline,
} from '../../shared/blueprints';
import { nfrPlanBlock } from '../../shared/nfrDefaults';
import { deriveDecisionsFromBlueprint, inferDeploymentPosture } from '../../shared/decisions';
import { scaffoldPlanNote } from '../../shared/scaffold';
import { buildToolsPlanNote } from '../../shared/buildTools';
import type { ComposedBlueprint } from '../../shared/blueprints';
import { invokeCli } from './cliInvoker';
import {
  META_DIR,
  readMarkdown,
  readProjectInfo,
  resolveWorkspacePath,
  writeMarkdown,
} from './markdownWorkspace';
import { readRoomLog } from './roomEngine';
import { referencesPromptBlock } from './referencesStore';
import { secretsManifestPromptBlock } from './secretsManifestStore';
import { writeJsonAtomic } from './atomicWrite';

/**
 * The Whiteboard engine. Richard (the project's Architect CLI) drafts a
 * structured plan from the vision + Monica's design conversation; we write
 * the task files. Reading the generated plan back + approval also live here.
 */

/* ----- structured plan parsing ----- */

export function extractJsonObject(text: string): unknown {
  // Balanced-brace scan (string/escape aware) — the old indexOf('{')→lastIndexOf('}')
  // heuristic glued the first '{' in PROSE (an example snippet, a code fence) to the
  // last '}' anywhere, misparsing realistic replies and surfacing a valid plan as a
  // parse failure. Returns the LAST parseable object: the plan prompt's strict-JSON
  // reminder comes last, so when a reply carries a prose example AND the real answer,
  // the final object is the authoritative one.
  let result: unknown;
  let found = false;
  let from = text.indexOf('{');
  while (from !== -1) {
    let next = from + 1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = from; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
      } else if (inString) {
        if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            result = JSON.parse(text.slice(from, i + 1));
            found = true;
            next = i + 1; // a valid object — keep scanning AFTER it for a later one
          } catch {
            // balanced but not JSON (prose braces) — try the next '{'
          }
          break;
        }
      }
    }
    from = text.indexOf('{', next);
  }
  if (found) {
    return result;
  }
  throw new Error('No JSON object found in the response.');
}

// Plan-size ceilings: an oversized architect reply must not make draftPlan write an
// unbounded number of task files (prompt-injection track). Far above any real plan
// (planSizingNote suggests at most ~3-7 phases × 3-8 tasks).
const MAX_PLAN_PHASES = 15;
const MAX_TASKS_PER_PHASE = 25;

/** Collapse newlines/control chars to spaces. The task-file format is LINE-oriented —
 * an injected "\nStatus: done" in a CLI-supplied title would otherwise become an
 * authoritative field the Bullpen trusts (silently skipping the task). */
function oneLine(value: string): string {
  return value.replace(/[\r\n\u0000-\u001F]+/g, ' ').trim();
}

export function sanitizePlan(value: unknown): DraftedPhase[] {
  const phasesRaw = (value as { phases?: unknown })?.phases;
  if (!Array.isArray(phasesRaw)) {
    return [];
  }
  const phases: DraftedPhase[] = [];
  for (const p of phasesRaw.slice(0, MAX_PLAN_PHASES)) {
    const name =
      typeof (p as DraftedPhase)?.name === 'string' ? oneLine((p as DraftedPhase).name) : '';
    const tasksRaw = (p as { tasks?: unknown })?.tasks;
    const tasks: DraftedTask[] = [];
    if (Array.isArray(tasksRaw)) {
      for (const t of tasksRaw.slice(0, MAX_TASKS_PER_PHASE)) {
        const tt = t as DraftedTask;
        if (typeof tt?.title === 'string' && tt.title.trim() !== '') {
          tasks.push({
            title: oneLine(tt.title.slice(0, 200)),
            goal: typeof tt.goal === 'string' ? tt.goal.slice(0, 2000) : '',
            acceptanceCriteria: Array.isArray(tt.acceptanceCriteria)
              ? tt.acceptanceCriteria
                  .filter((c): c is string => typeof c === 'string')
                  .map((c) => oneLine(c.slice(0, 500)))
                  .slice(0, 12)
              : [],
            setup: tt.setup === true,
            manualSteps: Array.isArray(tt.manualSteps)
              ? tt.manualSteps
                  .filter((c): c is string => typeof c === 'string')
                  .map((c) => oneLine(c.slice(0, 500)))
                  .slice(0, 20)
              : [],
          });
        }
      }
    }
    if (name !== '' && tasks.length > 0) {
      phases.push({ name, tasks });
    }
  }
  return phases;
}

// A5 — a drafted task "covers" secret handling if its title/goal/criteria mention any of
// these. Deliberately broad (avoid a false gap) — a single genuine match suppresses the
// synthesized task.
const SECRET_COVERAGE_PATTERN =
  /secret|token|credential|encrypt|\.env|env var|environment variable|key vault|api[ _-]?key|password/i;

/**
 * Plan-coverage gate (conservative). If the app handles secrets or persists data but
 * NO drafted task addresses secure secret/sensitive-data handling, return ONE synthesized
 * hardening task so the plan is complete rather than leaving a cleartext-token
 * gap for a post-hoc CRITICAL. Scoped to the single unambiguous, POSTURE-INDEPENDENT topic
 * (secrets/data-at-rest) — auth/ownership are posture-gated and fuzzier, left to the plan
 * prompt + review gates. Returns [] when the plan already covers it or the app is
 * secret-free (so static/from-scratch plans are unchanged). Pure — exported for tests.
 */
export function planCoverageGaps(
  phases: DraftedPhase[],
  composed: ComposedBlueprint,
): DraftedTask[] {
  if (!appHandlesDataOrSecrets(composed)) {
    return [];
  }
  const covered = phases.some((p) =>
    p.tasks.some(
      (t) =>
        SECRET_COVERAGE_PATTERN.test(t.title) ||
        SECRET_COVERAGE_PATTERN.test(t.goal) ||
        t.acceptanceCriteria.some((c) => SECRET_COVERAGE_PATTERN.test(c)),
    ),
  );
  if (covered) {
    return [];
  }
  return [
    {
      title: 'Secure handling of secrets and sensitive data',
      goal:
        'Ensure every secret/token is read from the environment and sensitive values are stored ' +
        'encrypted at rest — no cleartext credentials in source, config, the database, or logs.',
      acceptanceCriteria: [
        'All secrets/tokens are read from the environment; none are hardcoded or committed (only .env.example with placeholder names is committed).',
        'Third-party tokens and credentials are stored encrypted at rest — none appear in cleartext in the database, files, or logs.',
        'External input is validated server-side and database queries are parameterized.',
      ],
      setup: false,
      manualSteps: [],
    },
  ];
}

/**
 * A4 — scope-driven plan sizing. Replaces the fixed "1-4 phases, 2-5 tasks/phase" cap with a
 * range scaled to the composed blueprint's requirement surface (entities + AC packs +
 * decisions), so a broad product (a finance/SaaS app with many entities and integrations)
 * isn't squeezed into too few tasks while a lean one isn't padded. Deliberately SOFT
 * ("roughly", "size to the requirements") — a hint, not a hard cap. Returns the ORIGINAL
 * wording for a simple / no-blueprint plan, so from-scratch prompts stay byte-identical. Pure.
 */
export function planSizingNote(composed: ComposedBlueprint): string {
  const score =
    composed.dataEntities.length +
    composed.acceptanceCriteria.length +
    Math.floor(composed.decisions.length / 3);
  if (score < 4) {
    // Simple / no-blueprint — unchanged wording (byte-identical for from-scratch plans).
    return 'Use 1-4 phases and 2-5 tasks per phase.';
  }
  if (score <= 12) {
    return (
      'Size the plan to the requirements below — roughly 2-5 phases and 3-6 tasks per phase; ' +
      'do not pad, but give each capability (auth, data, each integration) real tasks rather than cramming.'
    );
  }
  return (
    'This is a substantial product — size the plan to the requirements below, roughly 3-7 phases and ' +
    '3-8 tasks per phase. Give each capability, entity group, and integration its own tasks rather than ' +
    'compressing a broad product into too few; completeness matters more than a small task count here.'
  );
}

/* ----- drafting ----- */

/**
 * Renders the composed blueprint (archetype + chosen overlays) as a context block
 * for Richard's plan prompt: the non-negotiable security rules, the acceptance
 * criteria that MUST land on the relevant tasks, and the env vars / data entities
 * that shape the build. Empty string when no blueprint matches the template.
 */
function renderBlueprintForPlan(composed: ComposedBlueprint): string {
  const sections: string[] = [];
  if (composed.securityRules.length > 0) {
    sections.push(
      'NON-NEGOTIABLE SECURITY RULES for this kind of product — emit tasks and/or acceptance criteria that enforce every one of them:\n' +
        composed.securityRules.map((r) => `- ${r}`).join('\n'),
    );
  }
  if (composed.acceptanceCriteria.length > 0) {
    const packs = composed.acceptanceCriteria
      .map((p) => `For the ${p.forTask} work, these criteria MUST appear (verbatim or equivalent) on the relevant task's acceptanceCriteria:\n${p.criteria.map((c) => `  - ${c}`).join('\n')}`)
      .join('\n');
    sections.push('REQUIRED ACCEPTANCE CRITERIA (fold these into the matching tasks):\n' + packs);
  }
  if (composed.envVars.length > 0) {
    sections.push(`ENVIRONMENT VARIABLES this product needs (read from the environment, never committed): ${composed.envVars.join(', ')}.`);
  }
  if (composed.dataEntities.length > 0) {
    const entities = composed.dataEntities.map((e) => `${e.name}(${e.fields.join(', ')})`).join('; ');
    sections.push(`CORE DATA ENTITIES to model: ${entities}.`);
  }
  const localNote = localServicesPlanNote(composed.localServices);
  if (localNote) {
    sections.push(localNote);
  }
  const toolsNote = buildToolsPlanNote(composed.buildTools);
  if (toolsNote) {
    sections.push(toolsNote);
  }
  if (sections.length === 0) {
    return '';
  }
  return (
    '\nARCHETYPE REQUIREMENTS (the founder chose this product shape — the plan MUST honor these):\n' +
    sections.join('\n\n')
  );
}

/**
 * When the plan prompt carries archetype/feature DEFAULTS (a composed blueprint or a
 * secrets manifest), the architect's CONVERSATION must be able to override them. The
 * `cache` overlay, say, composes REDIS_URL into the defaults — but the founder + Richard
 * may have explicitly dropped Redis in the chat. This note makes the ARCHITECT NOTES
 * authoritative so a dropped tool/service can't silently reappear in the drafted plan.
 * '' when there are no defaults to reconcile, so blueprint-less, secret-less projects
 * keep a byte-identical prompt. Exported for tests.
 */
export function scopeReconciliationNote(hasDefaults: boolean): string {
  if (!hasDefaults) {
    return '';
  }
  return [
    '',
    '',
    'SCOPE RECONCILIATION (apply this last): the archetype requirements and secrets listed',
    'above are STARTING-POINT defaults from the chosen template + selected features. Your',
    'ARCHITECT NOTES are AUTHORITATIVE over them. If you and the founder explicitly decided to',
    'DROP, remove, or replace any tool, service, capability, or env var in the conversation',
    '(for example deciding you do not need Redis), EXCLUDE it from the plan and every task —',
    'do NOT add tasks, acceptance criteria, env vars, or services the conversation ruled out,',
    'even though they appear above. Only plan what you and the founder actually converged on.',
  ].join('\n');
}

export async function draftPlan(
  workspacePath: string,
  team: ProjectTeam,
): Promise<WhiteboardDraftResult> {
  const assignment = team.architect?.assignment;
  if (!assignment || assignment.command.trim() === '') {
    return { ok: false, phases: [], tasksWritten: 0, error: "The Architect has no CLI assigned on the project's team." };
  }
  const vision = await readMarkdown(workspacePath, WORKSPACE_FILES.vision).catch(() => '');
  const product = (await readRoomLog(workspacePath, 'projectLead'))
    .map((m) => `${m.role === 'user' ? 'Founder' : 'Monica'}: ${m.text}`)
    .join('\n');
  const techNotes = (await readRoomLog(workspacePath, 'architect'))
    .map((m) => `${m.role === 'user' ? 'Founder' : 'Richard'}: ${m.text}`)
    .join('\n');

  // Compose the chosen archetype + overlays into the security rules, required
  // acceptance criteria, env vars, and entities the plan must reflect, then fold in the
  // posture-gated baseline floor so a scaffolder/wizard project (templateId: null) still
  // plans the non-negotiable data-at-rest / validation / ownership
  // controls its thin overlay set lacked. Posture is the founder's explicit choice, else a
  // strict inferred default; the SAME value feeds the decisions artifact below.
  const info = await readProjectInfo(workspacePath);
  const posture =
    info?.deploymentPosture ??
    inferDeploymentPosture({ templateId: info?.templateId, ripIt: info?.ripIt });
  const composed = withBaseline(composeBlueprint(info?.templateId, info?.overlayIds ?? []), posture);
  const blueprintBlock = renderBlueprintForPlan(composed);
  // A4 — size the phase/task budget to the requirement surface (byte-identical wording for a
  // simple / no-blueprint plan).
  const sizing = planSizingNote(composed);

  const basePrompt = [
    'You are Richard Hendricks, a software architect. Output a build plan as raw JSON.',
    'CRITICAL OUTPUT RULE: reply with ONE single JSON object and ABSOLUTELY NOTHING ELSE —',
    'no greeting, no reasoning, no explanation, no markdown, no code fences. The FIRST',
    'character of your reply MUST be "{" and the LAST MUST be "}". Exact shape:',
    '{"phases":[{"name":"Phase name","tasks":[{"title":"Short task title","goal":"One-sentence goal","acceptanceCriteria":["criterion","criterion"],"setup":false,"manualSteps":[]}]}]}',
    'Based on the PRODUCT picture (from Monica) and the ARCHITECT NOTES below, break the work',
    'into realistic phases and tasks; bake your tech choices into the titles and goals. Use',
    'the stack you and the founder converged on in the ARCHITECT NOTES; lean TypeScript-first,',
    'managed auth, object storage (not DB blobs), PostgreSQL, GitHub Actions, Terraform —',
    'never a dead service (Entra External ID not Azure AD B2C; ECS Express Mode not App',
    `Runner). ${sizing} Be concrete and buildable.`,
    'acceptanceCriteria MUST be checkable WITHOUT starting a long-running server: phrase them',
    'as a one-shot build / type-check / unit test (e.g. "npm run build succeeds with zero TS',
    'errors", "astro check passes") — never "the dev server serves the page" or anything that',
    'needs `npm run dev` / a watcher running, which would hang the autonomous build.',
    'human-setup vs dev — apply this rule EXACTLY. WRITING ANY FILE IN THE REPO is ALWAYS a',
    'DEVELOPER task ("setup": false) — no exception: application code, tests, AND all config.',
    'That explicitly includes a CI/CD workflow (.github/workflows/*.yml), a Dockerfile,',
    'docker-compose.yml, .env.example, database migrations, the secrets manifest, wrangler /',
    'terraform / IaC files, and shell scripts. A headless CLI writes files fine, so AUTHORING a',
    'file is NEVER human-setup — even in a deployment phase. Set "setup": true ONLY for the few',
    'things a headless CLI genuinely cannot do: an interactive login, creating a cloud',
    'account/project, entering a REAL secret VALUE, pointing DNS, or clicking a provider',
    'dashboard — put the exact ordered steps in "manualSteps". Otherwise "setup": false and',
    '"manualSteps": []. A human-setup task may reference ONLY files an EARLIER dev task already',
    'created — it runs BEFORE any later dev step, so it must never tell the founder to run or',
    'copy a file no prior task produced. So SPLIT deployment in two: a DEV task WRITES',
    '.github/workflows/deploy.yml + any infra config ("setup": false); a LATER human-setup task',
    'creates the account, adds the real secret values, points DNS, and triggers the deploy.',
    'ORDERING IS CRITICAL — build as much of the APP as possible FIRST (early phases = the',
    'actual app code and features, buildable and testable locally with no cloud or accounts).',
    'Then, BEFORE any CI/CD, hosting, or deployment phase, ALWAYS include a "Local product',
    'testing" phase: one or more human-test tasks (set "setup": true with a concrete checklist',
    'in "manualSteps") where the owner runs the app locally and exercises every key flow/screen,',
    'so they validate it on their own machine before anything ships; issues they find come back',
    'as fix tasks. Put CI/CD, Terraform / infrastructure-as-code, hosting, DNS, and the cloud',
    'human-setup tasks LAST, in the final phase(s) — AFTER that local product testing phase.',
    'Reminder: output ONLY the JSON object — first char "{", last "}".',
    '',
    `PRODUCT (from Monica):\n${product || '(none yet)'}`,
    '',
    `VISION:\n${vision || '(none yet)'}`,
    '',
    `ARCHITECT NOTES (your own discussion, if any):\n${techNotes || '(none yet)'}`,
  ].join('\n');

  // The founder's reference files (screenshots/specs) inform the plan — absolute
  // paths so Richard can read them. '' when the project has none.
  const references = await referencesPromptBlock(workspacePath);
  // Names-only secrets the built app needs (so Richard plans the manifest + push
  // script + asks which store each targets). '' when the project has no secrets.
  const secrets = await secretsManifestPromptBlock(workspacePath);
  // A runnable base app may already be scaffolded at the root — if so the plan must
  // build ON it (no "set up the framework" phase). '' when no scaffolder was used.
  const scaffoldNote = scaffoldPlanNote(info?.scaffoldId);
  // The web-frontend QUALITY baseline (SEO/a11y/async states/responsive) for the scaffolder
  // path, which composes no blueprint — otherwise those projects hit a missing-SEO gap. ''
  // when a base blueprint owns the depth, or the scaffold isn't a web frontend (byte-identical).
  const nfrBlock = nfrPlanBlock(info?.scaffoldId, info?.templateId, info?.deploymentPosture);

  // Append the founder's references + the generated-base note + the archetype
  // requirements (if any) + the secrets manifest, plus a closing JSON reminder, so the
  // strict-output contract stays the final instruction. When there are NO references,
  // NO scaffold, NO secrets, AND the composed blueprint is empty, the prompt is
  // byte-identical to the original basePrompt.
  // The chosen archetype + features may have introduced DEFAULTS (blueprint requirements,
  // env vars, secrets) that the architect chat then OVERRODE — so make the chat authoritative
  // over them. '' (no change) when there are no such defaults to reconcile.
  const reconcile = scopeReconciliationNote(blueprintBlock !== '' || secrets !== '');
  const hasExtras =
    references !== '' ||
    blueprintBlock !== '' ||
    secrets !== '' ||
    scaffoldNote !== '' ||
    nfrBlock !== '';
  const prompt = hasExtras
    ? `${basePrompt}${references}${scaffoldNote}${blueprintBlock ? `\n${blueprintBlock}` : ''}${nfrBlock}${secrets}${reconcile}\n\nFINAL REMINDER: output ONLY the single JSON object — first character "{", last "}", nothing else.`
    : basePrompt;

  const run = await invokeCli(assignment, {
    prompt,
    cwd: os.tmpdir(),
    timeoutMs: 300_000,
    surface: 'whiteboard',
    role: 'architect',
  });
  // A timeout is keyed off the reliable timedOut flag, not a stdout substring: Codex's
  // final-message-file path overwrites run.output with whatever partial JSON landed, so the
  // '[timed out]' marker never appears and the parse below would mislabel a timeout as
  // "couldn't parse the plan" (review failure-UX).
  if (run.timedOut) {
    return {
      ok: false,
      phases: [],
      tasksWritten: 0,
      error: 'The Architect timed out before finishing the plan. Try Draft again, or assign a faster CLI / lighter model to the Architect.',
    };
  }
  if (!run.ok && run.output.trim() === '') {
    return { ok: false, phases: [], tasksWritten: 0, error: run.error ?? 'No response from the Architect CLI.' };
  }

  let phases: DraftedPhase[];
  try {
    phases = sanitizePlan(extractJsonObject(run.output));
  } catch (err) {
    // Surface what the CLI actually returned so a non-JSON reply is diagnosable. (A real
    // timeout already returned above via run.timedOut — the '[timed out]' marker only ever
    // appears with that flag set — so this path is a genuine parse failure, not a timeout.)
    const reason = err instanceof Error ? err.message : String(err);
    const snippet = run.output.trim().replace(/\s+/g, ' ').slice(0, 280);
    return {
      ok: false,
      phases: [],
      tasksWritten: 0,
      error: `Could not parse the Architect's plan (${reason}). He replied: "${snippet}${run.output.trim().length > 280 ? '…' : ''}"`,
    };
  }
  if (phases.length === 0) {
    return { ok: false, phases: [], tasksWritten: 0, error: 'The Architect returned no usable tasks.' };
  }

  // Plan-coverage gate: if the app handles secrets/data but the drafted plan has no
  // task covering secure secret handling, synthesize a hardening task so the plan is
  // complete (rather than surfacing the gap later as a CRITICAL remediation — a cleartext-token
  // miss). '' / no change for plans that already cover it or secret-free apps.
  const coverageTasks = planCoverageGaps(phases, composed);
  if (coverageTasks.length > 0) {
    phases = [...phases, { name: 'Security hardening', tasks: coverageTasks }];
  }

  // Re-draft: remove prior task files so stale higher-numbered tasks from an
  // earlier plan don't linger, and reset approval (a new plan needs a new OK).
  try {
    const existing = await fs.readdir(resolveWorkspacePath(workspacePath, 'tasks'));
    for (const entry of existing) {
      if (/^task-\d+\.md$/.test(entry)) {
        await fs.unlink(resolveWorkspacePath(workspacePath, `tasks/${entry}`));
      }
    }
  } catch {
    // No tasks dir yet — nothing to clear.
  }
  // New plan = new revision. Resets approval AND, via the id, invalidates any
  // Bullpen phase-progress keyed to the OLD plan (so gates don't carry over).
  await resetPlanRevision(workspacePath);

  // Write planning/features.md (the phase outline) and one task file per task.
  const featureLines: string[] = ['# Features & Phases', ''];
  let taskNumber = 0;
  for (const phase of phases) {
    featureLines.push(`## ${phase.name}`, '');
    for (const task of phase.tasks) {
      taskNumber += 1;
      featureLines.push(`- task-${String(taskNumber).padStart(3, '0')} — ${task.title}`);
      const isSetup = task.setup === true;
      const content = createTaskFileContent({
        number: taskNumber,
        title: task.title,
        // Setup tasks are the human's to do; Jared (Ops) shepherds them.
        owner: isSetup ? 'ops' : 'developer',
        feature: phase.name,
        goal: task.goal || task.title,
        acceptanceCriteria: task.acceptanceCriteria,
        kind: isSetup ? 'human-setup' : 'build',
        manualSteps: task.manualSteps,
      });
      await writeMarkdown(workspacePath, `tasks/task-${String(taskNumber).padStart(3, '0')}.md`, content);
    }
    featureLines.push('');
  }
  await writeMarkdown(workspacePath, WORKSPACE_FILES.features, featureLines.join('\n'));

  // Emit the approved-scope artifact so the security/architect reviewers judge findings
  // against the deployment posture + chosen decisions — not a production/multi-tenant threat
  // model they were never given (a false-CRITICAL root cause). Posture is the
  // founder's explicit choice, else a strict inferred default. Best-effort: a failed write
  // just means the reviewers fall back to strict (their prior behavior).
  try {
    await writeJsonAtomic(
      resolveWorkspacePath(workspacePath, DECISIONS_PATH),
      deriveDecisionsFromBlueprint(composed, posture),
    );
  } catch {
    // Never fail a successful plan draft on the scope-artifact write.
  }

  return { ok: true, phases, tasksWritten: taskNumber };
}

/* ----- read back + approval ----- */

const PLAN_FLAG_PATH = `${META_DIR}/plan.json`;
/** The approved-scope artifact (B1) — posture + chosen decisions the reviewers judge against. */
const DECISIONS_PATH = `${META_DIR}/decisions.json`;

export async function readProjectPlan(workspacePath: string): Promise<ProjectPlan> {
  const tasks: TaskSummary[] = [];
  let entries: string[] = [];
  try {
    entries = await fs.readdir(resolveWorkspacePath(workspacePath, 'tasks'));
  } catch {
    entries = [];
  }
  for (const entry of entries.sort()) {
    if (!/^task-\d+\.md$/.test(entry)) {
      continue;
    }
    try {
      const content = await readMarkdown(workspacePath, `tasks/${entry}`);
      const parsed = parseTaskFile(content);
      tasks.push({
        id: parsed.id ?? entry.replace(/\.md$/, ''),
        title: parsed.title ?? entry,
        status: parsed.status ?? 'todo',
        feature: parsed.feature,
      });
    } catch {
      // Skip unreadable task files.
    }
  }

  let approved = false;
  try {
    const raw = await fs.readFile(resolveWorkspacePath(workspacePath, PLAN_FLAG_PATH), 'utf8');
    approved = (JSON.parse(raw) as { approved?: boolean }).approved === true;
  } catch {
    approved = false;
  }
  return { tasks, approved };
}

interface PlanFlag {
  approved: boolean;
  approvedAt: string | null;
  /** Changes on every re-draft; keys Bullpen phase progress to this plan. */
  revisionId: string | null;
}

async function readPlanFlag(workspacePath: string): Promise<PlanFlag> {
  try {
    const raw = await fs.readFile(resolveWorkspacePath(workspacePath, PLAN_FLAG_PATH), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PlanFlag>;
    return {
      approved: parsed.approved === true,
      approvedAt: typeof parsed.approvedAt === 'string' ? parsed.approvedAt : null,
      revisionId: typeof parsed.revisionId === 'string' ? parsed.revisionId : null,
    };
  } catch {
    return { approved: false, approvedAt: null, revisionId: null };
  }
}

async function writePlanFlag(workspacePath: string, flag: PlanFlag): Promise<void> {
  const abs = resolveWorkspacePath(workspacePath, PLAN_FLAG_PATH);
  await writeJsonAtomic(abs, { schemaVersion: 1, ...flag });
}

export async function setPlanApproved(workspacePath: string, approved: boolean): Promise<void> {
  const current = await readPlanFlag(workspacePath);
  await writePlanFlag(workspacePath, {
    ...current,
    approved,
    approvedAt: approved ? new Date().toISOString() : null,
  });
}

/**
 * Approve a freshly synthesized plan in one shot — used by "Rip it and Ship It",
 * which writes the build task directly (no Whiteboard draft/approve round-trip).
 * Assigns a new revision id so Bullpen phase progress keys to this plan.
 */
export async function approveSynthesizedPlan(workspacePath: string): Promise<void> {
  await writePlanFlag(workspacePath, {
    approved: true,
    approvedAt: new Date().toISOString(),
    revisionId: randomUUID(),
  });
}

/** Assign a fresh plan revision (on re-draft) and reset approval. */
async function resetPlanRevision(workspacePath: string): Promise<void> {
  await writePlanFlag(workspacePath, {
    approved: false,
    approvedAt: null,
    revisionId: randomUUID(),
  });
}

/** The current plan's revision id (null for legacy plans without one). */
export async function readPlanRevisionId(workspacePath: string): Promise<string | null> {
  return (await readPlanFlag(workspacePath)).revisionId;
}
