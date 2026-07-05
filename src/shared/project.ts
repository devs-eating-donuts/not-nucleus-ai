import type { DeploymentPosture } from './decisions';
import type { WorkspaceHealthReport } from './markdown';
import type { RoleId } from './roles';
import type { InstallOutcome, ScaffoldOutcome } from './scaffold';
import type { RoleConfiguration } from './settings';

/** Input for creating a project and initializing its Markdown workspace. */
export interface NewProjectInput {
  projectName: string;
  productIdea: string;
  targetPlatform: string;
  targetStack: string;
  constraints: string;
  /** Absolute path to the workspace root. All files are created inside it. */
  workspacePath: string;
  enabledRoles: RoleId[];
  /** Selected template/archetype id, if any — the Architect guides within it. */
  templateId?: string | null;
  /** Capability overlays composed onto the archetype (e.g. ['payments']). */
  overlayIds?: string[];
  /** Version-control this project (git init + a commit per Bullpen step). Default true. */
  gitTracking?: boolean;
  /**
   * Run engine-owned verification gates (typecheck/build/test/lint/secret-scan) at QA time,
   * feeding real exit codes into the verdict (C1). Default true; no-op when nothing detectable.
   */
  verificationGates?: boolean;
  /**
   * P1 (repro-backed findings): a `defect` review finding auto-creates a fix task
   * only if it ships a failing repro test the engine runs to confirm it; a defect
   * with no repro (or one that passes) is recorded for triage instead. Default
   * false — opt-in; byte-identical to today when off.
   */
  reproBackedFindings?: boolean;
  /**
   * "Rip it and Ship It" express project: a name + an Erlich-only chat + uploads,
   * then straight to Dinesh to build (no Monica/Richard/QA/security). Seeds only
   * the stakeholder + developer seats so every review gate honestly skips.
   */
  ripIt?: boolean;
  /**
   * Venture grouping — v1 is a lightweight shared TAG, not a nested workspace.
   * When set, this project is the first or an additional piece of a larger product
   * (a "Venture"). `ventureId` + `ventureName` are set together or neither; projects
   * sharing a `ventureId` belong to the same Venture and are grouped in the UI.
   */
  ventureId?: string;
  ventureName?: string;
  /**
   * Optional starter-code scaffolder id (a known SCAFFOLDERS key). When set, the team
   * runs the official scaffolder CLI to generate a real, runnable base app the AI team
   * then builds ON, instead of starting from an empty folder.
   */
  scaffoldId?: string;
  /**
   * How/where the built app is deployed — the lever that calibrates security reviews (B1).
   * Optional; when absent the team infers a strict default (never silently permissive).
   */
  deploymentPosture?: DeploymentPosture;
}

/** The current project, as recorded in .nucleus/current-run.json. */
export interface ProjectInfo {
  projectName: string;
  workspacePath: string;
  createdAt: string;
  /** The archetype the founder chose at creation (null = none / freeform). */
  templateId?: string | null;
  /** Capability overlays composed onto the archetype (e.g. ['payments']). */
  overlayIds?: string[];
  /** Whether this project is git-tracked (chosen at setup). Default true. */
  gitTracking?: boolean;
  /** Whether engine-owned verification gates run at QA time (C1). Default true. */
  verificationGates?: boolean;
  /** P1: a `defect` finding auto-tasks only with a confirmed failing repro test. Default false. */
  reproBackedFindings?: boolean;
  /** "Rip it and Ship It" express project (Erlich-only chat → straight to Dinesh). */
  ripIt?: boolean;
  /** Venture this project belongs to (a lightweight grouping tag). */
  ventureId?: string;
  ventureName?: string;
  /** Starter-code scaffolder used at creation (a known SCAFFOLDERS key), if any. */
  scaffoldId?: string;
  /**
   * Deployment posture (B1) — calibrates the security/architect reviews so an approved
   * descope (e.g. single-user localhost, no auth) isn't re-flagged as a defect. Optional;
   * the team infers a strict default when unset. Set explicitly on the Whiteboard.
   */
  deploymentPosture?: DeploymentPosture;
}

/**
 * A project's own team — independent of the global default roster. Seeded
 * from the default at creation, then editable per project. Stored in the
 * workspace at .nucleus/team.json.
 */
export type ProjectTeam = Record<RoleId, RoleConfiguration>;

/**
 * One row in the app-level project registry (userData/projects.json). The
 * registry is the index of which projects exist and where; each project's
 * detail lives in its own workspace.
 */
export interface ProjectRegistryEntry {
  id: string;
  name: string;
  workspacePath: string;
  createdAt: string;
  /** ISO timestamp of the last time this project was opened/made active. */
  lastOpenedAt: string;
  /** Venture this project belongs to (a lightweight grouping tag); set together or neither. */
  ventureId?: string;
  ventureName?: string;
}

/** What workspace initialization actually did, file by file. */
export interface WorkspaceInitReport {
  project: ProjectInfo;
  /** Files newly created (workspace-relative paths). */
  createdFiles: string[];
  /** Files that already existed and were left untouched. */
  skippedFiles: string[];
  /** App-managed metadata files that were refreshed (e.g. current-run.json). */
  updatedFiles: string[];
}

/** project:create response — init, health check, and the registry entry. */
export interface ProjectCreateResult extends WorkspaceInitReport {
  validation: WorkspaceHealthReport;
  registry: ProjectRegistryEntry;
  team: ProjectTeam;
  /** What the starter-code scaffolder did (a no-op outcome when none was chosen). */
  scaffold: ScaffoldOutcome;
  /** What the post-scaffold dependency install did (a no-op when nothing was scaffolded). */
  install: InstallOutcome;
}

/** project:open response — everything needed to make a project active. */
export interface OpenProjectResult {
  registry: ProjectRegistryEntry;
  info: ProjectInfo;
  team: ProjectTeam;
  validation: WorkspaceHealthReport;
}

/** Result of exporting a project's conversations to a Markdown file. */
export interface ProjectExportResult {
  ok: boolean;
  /** The written file path, or null when cancelled / failed. */
  path: string | null;
  /** True when the user dismissed the save dialog — a no-op. */
  cancelled: boolean;
  error: string | null;
}

/** Result of a factory reset (nuke all projects + history, back to a fresh install). */
export interface FactoryResetResult {
  ok: boolean;
  /** True when the user dismissed the native confirm / export folder pick — a no-op. */
  cancelled: boolean;
  report: {
    /** Projects removed from the registry. */
    projectsRemoved: number;
    /** Whole workspace folders moved to the Trash (guard allowed it). */
    foldersTrashed: number;
    /** Folders left on disk (guard refused) — only their .nucleus was trashed. */
    foldersKept: number;
    /** Folders the guard approved but the OS Trash call failed on (.nucleus trashed instead). */
    trashFailed: number;
    /** Projects exported before the reset. */
    exported: number;
    /** Selected projects whose export write failed (folder unwritable, etc.). */
    exportFailed: number;
    /** Whether settings/Default Team were reset to defaults (re-onboard). */
    settingsReset: boolean;
  } | null;
  error: string | null;
}
