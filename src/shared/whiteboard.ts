/**
 * The Whiteboard (Richard / Architect): turns the vision + Monica's design
 * into phases and tasks. Richard emits a structured plan; the app writes the
 * canonical task files from it (taskfile.ts), so the workspace format stays
 * consistent and no CLI file permissions are needed.
 */

export interface DraftedTask {
  title: string;
  goal: string;
  acceptanceCriteria: string[];
  /**
   * True when this task needs hands-on human setup the autonomous, headless
   * build can't do — interactive logins (e.g. `az login`), creating cloud
   * accounts, service principals, API tokens, billing, DNS. The Bullpen hands
   * these to the human instead of running the developer agent on them.
   */
  setup?: boolean;
  /** For setup tasks: the exact, ordered commands/steps the human runs. */
  manualSteps?: string[];
}

export interface DraftedPhase {
  name: string;
  tasks: DraftedTask[];
}

export interface WhiteboardDraftResult {
  ok: boolean;
  phases: DraftedPhase[];
  /** Number of task files written. */
  tasksWritten: number;
  error?: string;
}

/** A task as read back from the workspace for display/approval. */
export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  feature: string | null;
}

export interface ProjectPlan {
  tasks: TaskSummary[];
  /** Whether the user has approved the plan (from current-run.json). */
  approved: boolean;
}
