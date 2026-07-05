import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  META_DIR,
  META_FILES,
  WORKSPACE_DIRS,
  WORKSPACE_FILES,
  WORKSPACE_MARKER_KIND,
} from '../../shared/markdown';
import type { NewProjectInput, ProjectInfo, WorkspaceInitReport } from '../../shared/project';
import { composeAgentFile, enabledAgentPackTargets } from '../../shared/agentPack';
import { OVERLAYS } from '../../shared/blueprints';
import { isDeploymentPosture } from '../../shared/decisions';
import { isScaffolderId } from '../../shared/scaffold';
import { writeFileAtomic } from './atomicWrite';
import { fileExists, readFileOrNull } from './fsUtils';

/**
 * Markdown-first workspace management. The project folder on disk is the
 * source of truth; this service initializes its structure and provides
 * the only sanctioned read/write path into it.
 *
 * Every path is resolved through resolveWorkspacePath, which guarantees
 * the result stays inside the workspace root — no traversal, ever.
 */

/* ----- path safety ----- */

/**
 * Resolve a workspace-relative path to an absolute one, rejecting
 * anything that escapes the workspace root ('..', absolute paths,
 * drive-relative tricks). Cross-platform via path.resolve/relative.
 */
export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  // Escapes only when the relative path IS the parent ('..') or steps up
  // through a separator ('../x', or '..\x' on Windows) — not merely when it
  // starts with the two characters "..". A POSIX filename like "..\..\evil"
  // (backslash is a literal char there) is a single weird name that stays
  // inside root; the old `startsWith('..')` wrongly rejected it. Separator-aware
  // so the boundary matches each platform's real path semantics.
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the workspace: ${relativePath}`);
  }
  return resolved;
}

/* ----- low-level file helpers (main process only) ----- */

/** Create a file only if it does not exist ('wx' is atomic about it). */
async function writeFileIfMissing(
  absPath: string,
  content: string,
): Promise<'created' | 'skipped'> {
  try {
    await fs.writeFile(absPath, content, { encoding: 'utf8', flag: 'wx' });
    return 'created';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return 'skipped';
    }
    throw err;
  }
}

/* ----- markdown access (used by later orchestration steps too) ----- */

function assertMarkdownPath(relativePath: string): void {
  if (!/\.md$/i.test(relativePath)) {
    throw new Error(`Not a Markdown file: ${relativePath}`);
  }
}

export async function readMarkdown(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  assertMarkdownPath(relativePath);
  const absPath = resolveWorkspacePath(workspaceRoot, relativePath);
  return fs.readFile(absPath, 'utf8');
}

export async function writeMarkdown(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  assertMarkdownPath(relativePath);
  const absPath = resolveWorkspacePath(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await writeFileAtomic(absPath, content);
}

/* ----- seeded content ----- */

function seedVision(input: NewProjectInput, createdAt: string): string {
  return [
    `# Vision — ${input.projectName}`,
    '',
    `> Drafted at project creation (${createdAt}). The Stakeholder role refines this document.`,
    '',
    '## Product Idea',
    input.productIdea,
    '',
    '## Target Platform',
    input.targetPlatform || '_Not specified._',
    '',
    '## Target Stack',
    input.targetStack || '_Not specified._',
    '',
    '## Constraints',
    input.constraints || '_None recorded._',
    '',
    '## Success Criteria',
    '_To be defined by the Stakeholder role._',
    '',
    '## Non-Goals',
    '_To be defined by the Stakeholder role._',
    '',
  ].join('\n');
}

function seedArchitecture(input: NewProjectInput): string {
  return [
    `# Architecture — ${input.projectName}`,
    '',
    '_To be defined by the Architect role._',
    '',
    '## Overview',
    '',
    '## Components',
    '',
    '## Data Flow',
    '',
    '## Technical Risks',
    '',
  ].join('\n');
}

function seedTechStack(input: NewProjectInput): string {
  return [
    `# Tech Stack — ${input.projectName}`,
    '',
    '## Target Stack',
    input.targetStack || '_Not specified._',
    '',
    '## Decisions',
    '_Recorded by the Architect role as choices are made._',
    '',
  ].join('\n');
}

function seedFeatures(input: NewProjectInput): string {
  return [
    `# Features — ${input.projectName}`,
    '',
    '_The Architect role breaks the product into epics, features, and tasks here._',
    '',
    '## Epics',
    '',
    '## Features',
    '',
  ].join('\n');
}

const SEED_BACKLOG = ['# Backlog', '', '_Unscheduled work, ordered by priority._', ''].join('\n');

const SEED_SPRINT_BOARD = [
  '# Sprint Board',
  '',
  '## To Do',
  '',
  '## In Progress',
  '',
  '## Done',
  '',
].join('\n');

const SEED_QA_REVIEW = [
  '# QA Review Log',
  '',
  '_Validation outcomes recorded per task or feature. PASS/FAIL with reproduction steps._',
  '',
].join('\n');

const SEED_SECURITY_REVIEW = [
  '# Security Review',
  '',
  '_Trust boundaries reviewed with appropriate hostility. Findings include severity and mitigation._',
  '',
  '## Findings',
  '',
].join('\n');

const SEED_DRIFT_REVIEW = [
  '# Architecture Drift Review',
  '',
  '_Differences between the plan and what was actually built, recorded by the Architect._',
  '',
].join('\n');

function seedCurrentState(input: NewProjectInput): string {
  return [
    '# Current State',
    '',
    '> Snapshot, not a transcript. Keep at or under 80 lines — move detail to DONE_LOG.md.',
    '',
    '## Current Phase',
    'Project initialized — awaiting its first run.',
    '',
    '## Current Task',
    'None.',
    '',
    '## What Exists',
    `- Initialized Markdown workspace for ${input.projectName}.`,
    '',
    '## What Works',
    'Nothing has been built yet.',
    '',
    '## What Is Not Built',
    'Everything described in docs/vision.md.',
    '',
    '## Known Problems',
    'None recorded.',
    '',
    '## Next Recommended Action',
    'Run the Stakeholder role to refine docs/vision.md.',
    '',
  ].join('\n');
}

function seedHandoff(input: NewProjectInput, createdAt: string): string {
  return [
    '# Handoff',
    '',
    '> The baton for the next role or session. Keep at or under 50 lines.',
    '',
    '## Summary',
    `Workspace initialized for ${input.projectName} at ${createdAt}.`,
    '',
    '## Last Completed',
    'Project creation.',
    '',
    '## Active Task',
    'None.',
    '',
    '## Next Recommended',
    'Stakeholder: refine docs/vision.md into success criteria and non-goals.',
    '',
    '## Blocked',
    'Nothing.',
    '',
    '## Important Instructions',
    'Work only inside this workspace. Update CURRENT_STATE.md, HANDOFF.md, and',
    'DONE_LOG.md before finishing any step.',
    '',
  ].join('\n');
}

function seedDoneLog(createdAt: string): string {
  return [
    '# Done Log',
    '',
    '> One line per completed task, grouped by date, newest first.',
    '',
    `## ${createdAt.slice(0, 10)}`,
    '- Project workspace initialized.',
    '',
  ].join('\n');
}

const SEED_REFERENCES_README = [
  '# References',
  '',
  'Drop the founder\'s reference material here — screenshots and wireframes that show',
  'the look you want, a spec or notes document, brand assets (logo, colors). The team\'s',
  'AI CLIs read this folder directly when designing and building, so anything you add',
  'here informs the work.',
  '',
  'Add files from inside the app (the "References" panel on the project setup page), or',
  'just copy them into this folder by hand — both work. Add a one-line note per file in',
  'the app so the team knows what each one is for.',
  '',
].join('\n');

const SEED_ESCALATIONS = [
  '# Escalations',
  '',
  '> When a role hits its iteration budget or cannot proceed, it records an',
  '> escalation here and stops. Humans resolve them; resolutions stay on record.',
  '> Format: "## ESC-NNN — Title" with Created / From / Task / Reason / Status',
  '> fields and Context / What was tried / Recommended action sections.',
  '',
].join('\n');

// Seeded into new workspaces so the git-tracked history stays clean: ignore
// dependencies and build output, plus the two high-churn .nucleus run files
// (telemetry / live activity) — the rest of .nucleus/ (tasks, reviews, batons)
// IS the audit trail and stays tracked. writeFileIfMissing never clobbers a
// user's own .gitignore.
const SEED_GITIGNORE = [
  '# Dependencies',
  'node_modules/',
  '',
  '# Build output',
  'dist/',
  'build/',
  'out/',
  '.next/',
  '.astro/',
  '.cache/',
  '.turbo/',
  '',
  '# Secrets — NEVER commit real values. Keep a committed .env.example (names only).',
  '.env',
  '.env.*',
  '!.env.example',
  '# Belt-and-suspenders for value-bearing artifacts a push step might emit. The',
  '# names-only secrets manifest (.nucleus/secrets-manifest.json) IS committable;',
  '# actual values must only ever land in gitignored or out-of-workspace files.',
  '*.key',
  '*.pem',
  '*.pfx',
  '*.p12',
  '*.secret-values',
  'secrets.local.*',
  'id_rsa',
  'id_*.key',
  '.sops/',
  'age.key',
  '',
  '# High-churn Nucleus run state (the rest of .nucleus/ is the audit trail — keep it)',
  '.nucleus/telemetry.json',
  '.nucleus/bullpen-activity.json',
  '',
  '# OS / editor cruft',
  '.DS_Store',
  '*.log',
  '',
].join('\n');

/**
 * Write or MERGE the workspace .gitignore. When a scaffolder created the project root
 * first, it wrote its own .gitignore — append the Nucleus rules it's missing (under a
 * labeled block) instead of skipping ours. No existing file → write SEED_GITIGNORE.
 */
async function mergeGitignore(root: string): Promise<'created' | 'updated' | 'unchanged'> {
  const target = resolveWorkspacePath(root, '.gitignore');
  let existing = '';
  try {
    existing = await fs.readFile(target, 'utf8');
  } catch {
    existing = '';
  }
  if (existing.trim() === '') {
    await writeFileAtomic(target, SEED_GITIGNORE);
    return 'created';
  }
  const present = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== ''),
  );
  // Append only the rules (non-comment, non-blank) not already there.
  const missing = SEED_GITIGNORE.split('\n').filter((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('#') && !present.has(trimmed);
  });
  if (missing.length === 0) {
    return 'unchanged';
  }
  await writeFileAtomic(target, `${existing.replace(/\s*$/, '')}\n\n# Nucleus-AI\n${missing.join('\n')}\n`);
  return 'updated';
}

/* ----- workspace initialization ----- */

export async function initializeWorkspace(
  input: NewProjectInput,
): Promise<WorkspaceInitReport> {
  if (!path.isAbsolute(input.workspacePath)) {
    throw new Error('Workspace path must be absolute.');
  }
  const root = path.resolve(input.workspacePath);
  const createdAt = new Date().toISOString();
  const project: ProjectInfo = {
    projectName: input.projectName,
    workspacePath: root,
    createdAt,
    templateId: input.templateId ?? null,
    overlayIds: input.overlayIds ?? [],
    gitTracking: input.gitTracking !== false,
    verificationGates: input.verificationGates !== false,
    reproBackedFindings: input.reproBackedFindings === true,
    ripIt: input.ripIt === true,
    ventureId: input.ventureId,
    ventureName: input.ventureName,
    scaffoldId: input.scaffoldId,
    deploymentPosture: input.deploymentPosture,
  };

  await fs.mkdir(root, { recursive: true });
  for (const dir of WORKSPACE_DIRS) {
    await fs.mkdir(resolveWorkspacePath(root, dir), { recursive: true });
  }

  const seeds: Array<[string, string]> = [
    // NOTE: .gitignore is handled separately (mergeGitignore) — a scaffolder may have
    // written its own at the root, and we MERGE ours into it rather than skip.
    [WORKSPACE_FILES.vision, seedVision(input, createdAt)],
    [WORKSPACE_FILES.architecture, seedArchitecture(input)],
    [WORKSPACE_FILES.techStack, seedTechStack(input)],
    [WORKSPACE_FILES.features, seedFeatures(input)],
    [WORKSPACE_FILES.backlog, SEED_BACKLOG],
    [WORKSPACE_FILES.sprintBoard, SEED_SPRINT_BOARD],
    [WORKSPACE_FILES.qaReview, SEED_QA_REVIEW],
    [WORKSPACE_FILES.securityReview, SEED_SECURITY_REVIEW],
    [WORKSPACE_FILES.driftReview, SEED_DRIFT_REVIEW],
    [WORKSPACE_FILES.currentState, seedCurrentState(input)],
    [WORKSPACE_FILES.handoff, seedHandoff(input, createdAt)],
    [WORKSPACE_FILES.doneLog, seedDoneLog(createdAt)],
    [WORKSPACE_FILES.escalations, SEED_ESCALATIONS],
    ['references/README.md', SEED_REFERENCES_README],
    [
      META_FILES.settings,
      JSON.stringify(
        {
          schemaVersion: 1,
          projectName: input.projectName,
          createdAt,
          productIdea: input.productIdea,
          targetPlatform: input.targetPlatform,
          targetStack: input.targetStack,
          constraints: input.constraints,
          enabledRoles: input.enabledRoles,
        },
        null,
        2,
      ),
    ],
    [META_FILES.runHistory, JSON.stringify({ schemaVersion: 1, runs: [] }, null, 2)],
  ];

  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];
  for (const [relPath, content] of seeds) {
    const outcome = await writeFileIfMissing(resolveWorkspacePath(root, relPath), content);
    (outcome === 'created' ? createdFiles : skippedFiles).push(relPath);
  }

  // current-run.json always reflects the latest initialization.
  const currentRunPath = resolveWorkspacePath(root, META_FILES.currentRun);
  const existed = await fileExists(currentRunPath);
  await writeFileAtomic(
    currentRunPath,
    JSON.stringify(
      { schemaVersion: 1, ...project, status: 'initialized', run: null },
      null,
      2,
    ),
  );
  const updatedFiles: string[] = [];
  (existed ? updatedFiles : createdFiles).push(META_FILES.currentRun);

  // .gitignore: MERGE rather than skip-if-exists. When a scaffolder created the project
  // root first it wrote its own .gitignore; append the Nucleus rules it lacks (.nucleus
  // churn, .env, secret-bearing files) so both survive. No existing file → write ours.
  const gitignoreOutcome = await mergeGitignore(root);
  if (gitignoreOutcome === 'created') {
    createdFiles.push('.gitignore');
  } else if (gitignoreOutcome === 'updated') {
    updatedFiles.push('.gitignore');
  } else {
    skippedFiles.push('.gitignore');
  }

  // App-created marker — proof Nucleus made this workspace. Its id doubles as
  // the registry id, so full-folder deletion can require a matching marker
  // before anything is trashed. Preserve the id (and createdAt) across re-init
  // so a workspace's identity stays stable.
  const markerPath = resolveWorkspacePath(root, META_FILES.marker);
  const existingMarker = await readWorkspaceMarker(root);
  await writeFileAtomic(
    markerPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: WORKSPACE_MARKER_KIND,
        id: existingMarker?.id ?? randomUUID(),
        projectName: input.projectName,
        createdAt: existingMarker?.createdAt ?? createdAt,
      },
      null,
      2,
    ),
  );
  (existingMarker ? updatedFiles : createdFiles).push(META_FILES.marker);

  // Agent instruction pack: seed the enabled tool-native instruction files so
  // each CLI is steered in its OWN native channel (read from cwd). New projects
  // only. If a scaffolder already wrote the file (e.g. create-next-app's CLAUDE.md
  // = `@AGENTS.md`), MERGE our rails into it rather than skip — composeAgentFile
  // preserves the scaffolder's content and appends a delimited managed block.
  // Byte-identical (bare body) when the file is absent. Phased — see agentPack.ts.
  for (const target of enabledAgentPackTargets()) {
    const abs = resolveWorkspacePath(root, target.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const decision = composeAgentFile(await readFileOrNull(abs), input.projectName);
    if (decision.mode === 'skipped') {
      skippedFiles.push(target.path);
      continue;
    }
    await fs.writeFile(abs, decision.content, 'utf8');
    (decision.mode === 'merged' ? updatedFiles : createdFiles).push(target.path);
  }

  return { project, createdFiles, skippedFiles, updatedFiles };
}

export interface WorkspaceMarker {
  id: string;
  kind: string;
  createdAt?: string;
  projectName?: string;
}

/**
 * Read the app-created proof-of-origin marker (.nucleus/project.json). Returns
 * null when absent or malformed — a workspace without a valid marker is treated
 * as not-provably-app-created by the deletion guard.
 */
export async function readWorkspaceMarker(
  workspacePath: string,
): Promise<WorkspaceMarker | null> {
  try {
    const raw = await fs.readFile(
      resolveWorkspacePath(workspacePath, META_FILES.marker),
      'utf8',
    );
    const parsed = JSON.parse(raw) as Partial<WorkspaceMarker>;
    if (
      parsed &&
      parsed.kind === WORKSPACE_MARKER_KIND &&
      typeof parsed.id === 'string' &&
      parsed.id.trim() !== ''
    ) {
      return {
        id: parsed.id,
        kind: parsed.kind,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
        projectName: typeof parsed.projectName === 'string' ? parsed.projectName : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Read a project's identity back from .nucleus/current-run.json. */
export async function readProjectInfo(workspacePath: string): Promise<ProjectInfo | null> {
  try {
    const raw = await fs.readFile(
      resolveWorkspacePath(workspacePath, META_FILES.currentRun),
      'utf8',
    );
    const parsed = JSON.parse(raw) as Partial<ProjectInfo>;
    if (typeof parsed.projectName !== 'string' || typeof parsed.createdAt !== 'string') {
      return null;
    }
    return {
      projectName: parsed.projectName,
      workspacePath: path.resolve(workspacePath),
      createdAt: parsed.createdAt,
      templateId: typeof parsed.templateId === 'string' ? parsed.templateId : null,
      // current-run.json is hand-editable, so re-validate on read: keep only
      // ids in the known overlay catalog (mirrors the write-side IPC filter).
      // OWN-property check, not `in`: prototype-chain keys ('toString'/'constructor')
      // pass `in` and then crash composeBlueprint/overlaysFor downstream.
      overlayIds: Array.isArray(parsed.overlayIds)
        ? [
            ...new Set(
              parsed.overlayIds.filter(
                (o): o is string =>
                  typeof o === 'string' && Object.prototype.hasOwnProperty.call(OVERLAYS, o),
              ),
            ),
          ]
        : [],
      gitTracking: parsed.gitTracking !== false,
      verificationGates: parsed.verificationGates !== false,
      reproBackedFindings: parsed.reproBackedFindings === true,
      ripIt: parsed.ripIt === true,
      ventureId:
        typeof parsed.ventureId === 'string' && parsed.ventureId.trim() !== ''
          ? parsed.ventureId
          : undefined,
      ventureName:
        typeof parsed.ventureName === 'string' && parsed.ventureName.trim() !== ''
          ? parsed.ventureName
          : undefined,
      // current-run.json is hand-editable: keep only a known scaffolder id.
      scaffoldId: isScaffolderId(parsed.scaffoldId) ? parsed.scaffoldId : undefined,
      // Re-validate the posture on read (hand-editable); junk → undefined (strict default).
      deploymentPosture: isDeploymentPosture(parsed.deploymentPosture)
        ? parsed.deploymentPosture
        : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Merge a partial update into .nucleus/current-run.json and return the re-validated
 * ProjectInfo (null if the file is missing/unreadable). Reads the RAW JSON so app-managed
 * fields (schemaVersion/status/run) survive the merge. Backs the Whiteboard's deployment-
 * posture control. A patch value of `undefined` clears the field (JSON.stringify omits it).
 */
export async function updateProjectInfo(
  workspacePath: string,
  patch: Partial<ProjectInfo>,
): Promise<ProjectInfo | null> {
  const abs = resolveWorkspacePath(workspacePath, META_FILES.currentRun);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await fs.readFile(abs, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  await writeFileAtomic(abs, JSON.stringify({ ...raw, ...patch }, null, 2));
  return readProjectInfo(workspacePath);
}

/** Append an item to planning/backlog.md (lightweight capture for new work). */
export async function appendBacklogItem(
  workspacePath: string,
  text: string,
  addedAt: string,
): Promise<void> {
  const rel = WORKSPACE_FILES.backlog;
  const absPath = resolveWorkspacePath(workspacePath, rel);
  let current = '';
  try {
    current = await fs.readFile(absPath, 'utf8');
  } catch {
    current = SEED_BACKLOG;
  }
  const entry = `- [ ] ${text.trim()}  _(added ${addedAt.slice(0, 10)})_`;
  await writeFileAtomic(absPath, `${current.trimEnd()}\n${entry}\n`);
}

// Re-exported so later steps (orchestration, run engine) share one
// definition of where app metadata lives.
export { META_DIR };
