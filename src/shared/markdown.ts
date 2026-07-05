/**
 * Markdown-first workspace contract. Markdown files in the project folder
 * are the source of truth; the .nucleus JSON layer is app metadata only.
 *
 * The contract absorbs two proven disciplines:
 * - session batons (CURRENT_STATE / HANDOFF / DONE_LOG) with line caps and
 *   end-of-step compaction
 * - a richer task status taxonomy and ESC-NNN escalations
 */

export const META_DIR = '.nucleus';

export const META_FILES = {
  settings: `${META_DIR}/settings.json`,
  runHistory: `${META_DIR}/run-history.json`,
  currentRun: `${META_DIR}/current-run.json`,
  /** App-created proof-of-origin marker — gates safe full-folder deletion. */
  marker: `${META_DIR}/project.json`,
  /** Per-file notes for the founder's reference uploads (files live in references/). */
  references: `${META_DIR}/references.json`,
  /**
   * Names-only secrets manifest for the built app (env-var names + stage +
   * destination — NEVER values). Safe to commit; see src/shared/secrets.ts. NOT
   * named `secrets.json` — that basename trips the workspace validator's
   * secret-file scanner (and `.nucleus/` is skipped by it anyway).
   */
  secretsManifest: `${META_DIR}/secrets-manifest.json`,
} as const;

/** Magic value in the marker file proving Nucleus created this workspace. */
export const WORKSPACE_MARKER_KIND = 'nucleus-workspace';

export const WORKSPACE_DIRS = [
  META_DIR,
  'docs',
  'planning',
  'tasks',
  'reviews',
  'handoffs',
  // Founder-supplied reference material (screenshots, specs, brand assets) the
  // local CLIs read directly from the workspace. See src/shared/references.ts.
  'references',
] as const;

export const WORKSPACE_FILES = {
  vision: 'docs/vision.md',
  architecture: 'docs/architecture.md',
  techStack: 'docs/tech-stack.md',
  features: 'planning/features.md',
  backlog: 'planning/backlog.md',
  sprintBoard: 'planning/sprint-board.md',
  qaReview: 'reviews/qa-review.md',
  securityReview: 'reviews/security-review.md',
  driftReview: 'reviews/drift-review.md',
  /** Session batons (workspace root, like the POCs kept them). */
  currentState: 'CURRENT_STATE.md',
  handoff: 'HANDOFF.md',
  doneLog: 'DONE_LOG.md',
  escalations: 'ESCALATIONS.md',
} as const;

/** Baton line caps — snapshots, not transcripts. Overflow goes to DONE_LOG. */
export const CURRENT_STATE_MAX_LINES = 80;
export const HANDOFF_MAX_LINES = 50;

/**
 * Task lifecycle. 'awaiting-review' and 'human-needed' come from the
 * gating model; 'human-needed' is what an agent sets when
 * an iteration budget is exhausted.
 */
export type TaskState =
  | 'todo'
  | 'in-progress'
  | 'awaiting-review'
  | 'blocked'
  | 'human-needed'
  | 'done'
  | 'verified';

export const TASK_STATES: readonly TaskState[] = [
  'todo',
  'in-progress',
  'awaiting-review',
  'blocked',
  'human-needed',
  'done',
  'verified',
];

export function isTaskState(value: unknown): value is TaskState {
  return typeof value === 'string' && (TASK_STATES as string[]).includes(value);
}

/** Sections every task file must contain (H2 headings). */
export const TASK_REQUIRED_SECTIONS = [
  'Goal',
  'Prerequisites',
  'Acceptance Criteria',
  'Verification',
] as const;

/* ----- workspace health (produced by the main-process validator) ----- */

export interface WorkspaceFinding {
  severity: 'error' | 'warning';
  /** Workspace-relative file (or directory) the finding concerns. */
  file: string;
  message: string;
}

export interface WorkspaceHealthReport {
  workspacePath: string;
  checkedAt: string;
  /** True when there are no error-severity findings (warnings allowed). */
  ok: boolean;
  errorCount: number;
  warningCount: number;
  findings: WorkspaceFinding[];
  taskCount: number;
  openEscalations: number;
}
