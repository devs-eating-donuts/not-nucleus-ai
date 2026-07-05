import type { StoreApi } from 'zustand';
import type { CliDetection } from '../../shared/cli';
import type { AppInfo } from '../../shared/ipc';
import type { WorkspaceHealthReport } from '../../shared/markdown';
import type {
  FactoryResetResult,
  NewProjectInput,
  ProjectCreateResult,
  ProjectExportResult,
  ProjectInfo,
  ProjectRegistryEntry,
  ProjectTeam,
} from '../../shared/project';
import type { ChatMessage } from '../../shared/room';
import type { InterventionContext } from '../../shared/intervention';
import type { InvocationLogRecord } from '../../shared/diagnostics';
import type { ProjectPlan } from '../../shared/whiteboard';
import type {
  BullpenActivity,
  BullpenStepResult,
  OpsCadence,
  SecurityResult,
  TelemetrySummary,
  TestingCadence,
} from '../../shared/bullpen';
import type { RoleId } from '../../shared/roles';
import type { RunRecord, RunSummary } from '../../shared/run';
import type { AppSettings, RoleConfiguration } from '../../shared/settings';
import type { NamingMode } from '../../shared/naming';
import type { VaultTier } from '../../shared/imageVault';
import type { ThemeId } from '../../shared/theme';
import type { RoleValidationResult } from '../../shared/validation';

export type PageId =
  | 'dashboard'
  | 'projects'
  | 'project'
  | 'investor-pitch'
  | 'whiteboard'
  | 'bullpen'
  | 'punch-list'
  | 'vault'
  | 'garage'
  | 'lessons'
  | 'terminals'
  | 'team'
  | 'clis'
  | 'new-build'
  | 'new-run'
  | 'rip-it'
  | 'history'
  | 'run-detail'
  | 'templates'
  | 'about';

export type SettingsSaveState = 'idle' | 'saving' | 'saved' | 'error';

/** The opened project whose team and backlog the Project page edits. */
export interface ActiveProject {
  registry: ProjectRegistryEntry;
  info: ProjectInfo;
  team: ProjectTeam;
  validation: WorkspaceHealthReport;
}

export interface AppState {
  page: PageId;
  /**
   * False until hydrate() has loaded the persisted settings. The boot render is
   * gated on this so we don't flash the OnboardingScreen (and spin up its embedded
   * shell terminal) on the first paint, before the real `onboarded` value arrives.
   */
  hydrated: boolean;
  /**
   * Set when hydrate() exhausted its retries and could NOT load the persisted
   * settings/registry from the main process. The boot gate shows a recoverable
   * error (with Retry) instead of silently falling through to the OnboardingScreen
   * over real data — a failed read must never look like a fresh install.
   */
  bootError: string | null;
  /** Selected run when viewing run-detail. */
  activeRunId: string | null;
  /**
   * Set by an explicit "New Project" action so The Pitch opens a blank, editable
   * form even when a project is active (which otherwise restores it read-only).
   * NewRunPage consumes and clears it on mount.
   */
  startFreshPitch: boolean;
  /**
   * Set when "New Project" was blocked because the Default Team has dead seats: it
   * routes the user to the Team page to set up + validate, where a "Continue to New
   * Project" CTA appears. Cleared once they proceed to a fresh pitch.
   */
  pendingNewProject: boolean;
  /**
   * Set when the user finishes onboarding via the multi-CLI path (which lands on the
   * Default Team page to assign per role): a "Continue to Hacker Hostel" CTA appears
   * there. Cleared as soon as they navigate away from the Team page (see navigate).
   */
  justOnboarded: boolean;
  /**
   * Set by "Rip it and Ship It" so the express page opens a blank create form even
   * when a project is active. RipItPage consumes and clears it on mount.
   */
  startRipItFresh: boolean;
  /**
   * Set when "A bigger product, in pieces" is chosen on the New-build chooser: the
   * Venture this pitch's first project belongs to (a lightweight grouping tag). The
   * pitch passes it into createProject; cleared on create success / project switch.
   */
  pendingVenture: { id: string; name: string } | null;
  /**
   * The starting point chosen on the "Define your project" step (a template id, or
   * null for "describe it myself"). NewRunPage pre-applies it on a fresh pitch;
   * cleared on create success / project switch.
   */
  pendingTemplateId: string | null;
  /**
   * The starter-code scaffolder chosen on the "Define your project" step (a known
   * SCAFFOLDERS id, or null). NewRunPage captures it once on a fresh pitch and passes
   * it into createProject so the team builds on a generated base app.
   */
  pendingScaffoldId: string | null;
  /**
   * Capability overlays chosen in the wizard's Features step. NewRunPage pre-fills the
   * pitch's overlay selection from these on a fresh pitch.
   */
  pendingOverlayIds: string[];
  theme: ThemeId;
  namingMode: NamingMode;
  uiScale: number;
  /**
   * Decrypted persona portrait object URLs, keyed by the PersonaAvatar lookup key
   * ("<id>" / "cartoons/<id>" / "distinct/<id>"). Populated by unlockVaultTier when a
   * tier's clue is cracked (the answer IS the decryption key — shared/imageVault.ts);
   * empty for uncracked tiers, so those personas show initials. Transient (not persisted).
   */
  decryptedPortraits: Record<string, string>;
  appInfo: AppInfo | null;
  /** Mirror of the persisted settings; main process owns the canonical copy. */
  settings: AppSettings;
  settingsSaveState: SettingsSaveState;
  /**
   * Validation state, deliberately separate from settings: results
   * describe the machine at check time and never overwrite user edits.
   */
  validationResults: Partial<Record<RoleId, RoleValidationResult>>;
  isValidating: boolean;
  /** Separate in-flight flag for the active project's team validation. */
  isValidatingProject: boolean;
  /** AI CLI catalog: install status/version for every known CLI. */
  clis: CliDetection[];
  isDetectingClis: boolean;
  /** CLI id currently running its update command, or null. */
  cliUpdatingId: string | null;
  /** Last update output per CLI id. */
  cliUpdateOutputs: Record<string, { ok: boolean; output: string } | undefined>;
  /** All registered projects + which is active (mirrors the registry). */
  projects: ProjectRegistryEntry[];
  activeProjectId: string | null;
  /** The opened project (team/backlog/validation), or null. */
  activeProject: ActiveProject | null;
  /** Validation of the active project's own team assignments. */
  projectValidationResults: Partial<Record<RoleId, RoleValidationResult>>;
  /** Lifecycle-room conversations for the active project, keyed by role. */
  roomConversations: Partial<Record<RoleId, ChatMessage[]>>;
  roomSendingRole: RoleId | null;
  /**
   * The last failed room turn, scoped to the role it belongs to — so a timed-out
   * architect turn can't surface (or arm Retry) under Monica's chat when the user
   * navigates between rooms (all room surfaces share this one field).
   */
  roomError: { roleId: RoleId; message: string } | null;
  /**
   * Intervention chats (Big Head / Dinesh / Gilfoyle) — human-in-the-loop
   * conversations about an escalated build task. Keyed by `${roleId}:${taskId}`
   * so each persona keeps a separate thread about the same task. Reset on project
   * switch (task ids collide across projects).
   */
  interventionConversations: Partial<Record<string, ChatMessage[]>>;
  interventionContexts: Partial<Record<string, InterventionContext>>;
  interventionSendingKey: string | null;
  interventionError: { key: string; message: string } | null;
  /** The Punch List (Richard's change-intake chat) for the active project. */
  workRequestMessages: ChatMessage[];
  workRequestSending: boolean;
  workRequestError: string | null;
  /** The Whiteboard: active project's drafted plan (tasks + approval). */
  whiteboardPlan: ProjectPlan | null;
  whiteboardDrafting: boolean;
  whiteboardError: string | null;
  /** The Bullpen build loop state. */
  bullpenCadence: TestingCadence;
  bullpenSecurityCadence: TestingCadence;
  bullpenOpsCadence: OpsCadence;
  /** autopilot runs the whole build; manual advances one step per click. */
  bullpenMode: 'autopilot' | 'manual';
  bullpenRunning: boolean;
  bullpenStopRequested: boolean;
  bullpenSteps: BullpenStepResult[];
  bullpenComplete: boolean;
  bullpenEscalated: boolean;
  /** True when autopilot stopped at the per-run step cap (not complete/escalated). */
  bullpenStoppedAtCap: boolean;
  /**
   * The most recent run for the active project that was INTERRUPTED (a crash / close left it
   * 'running'; reconciled on Bullpen entry). Drives a "your last build was interrupted — Resume"
   * banner. null when the last run ended cleanly or there are no runs. Cleared on resume/switch.
   */
  bullpenInterrupted: RunSummary | null;
  /** Set when a Bullpen step ends in an error (or the loop throws); null otherwise. */
  bullpenError: string | null;
  /** Who's working right now (polled during a run); null when idle. */
  bullpenActivity: BullpenActivity | null;
  securityResult: SecurityResult | null;
  securityRunning: boolean;
  /** The Garage: telemetry for the active project. */
  garageTelemetry: TelemetrySummary | null;
  /** The Garage: recent CLI invocations (cross-project, newest first) for the activity panel. */
  garageInvocations: InvocationLogRecord[];
  /** Run history (Step 8): the open run record being driven, plus list/detail. */
  currentRunId: string | null;
  /** Set by a "Resume" affordance; consumed by the next startBullpen. */
  resumeFromRunId: string | null;
  runs: RunSummary[];
  runsLoading: boolean;
  /** Cross-project Hacker Hostel stats: completed-project count + recent runs (last 10). */
  dashboardStats: { completedProjects: number; recentRuns: RunSummary[] } | null;
  dashboardStatsLoading: boolean;
  runDetail: RunRecord | null;
  runDetailLoading: boolean;
  navigate: (page: PageId, runId?: string) => void;
  /** "New Project": open the "What are you building?" chooser (single app vs Venture). */
  beginNewProject: () => void;
  /**
   * "Define your project" → a starting point was chosen: open the Erlich pitch with
   * the template (or null = describe-it-yourself) and the optional Venture tag preset.
   */
  startBuildPitch: (opts: {
    venture: { id: string; name: string } | null;
    templateId: string | null;
    scaffoldId: string | null;
    overlayIds: string[];
  }) => void;
  /** Venture overview → "Add a project": open the define step preset to that Venture. */
  addProjectToVenture: (ventureId: string, ventureName: string) => void;
  /** "Rip it and Ship It": open the express page on a fresh, blank create form. */
  beginRipItProject: () => void;
  /** NewRunPage clears the fresh-pitch flag once it has consumed it. */
  setStartFreshPitch: (value: boolean) => void;
  /** RipItPage clears the express fresh flag once it has consumed it. */
  setStartRipItFresh: (value: boolean) => void;
  /**
   * Rip-it: synthesize the build task from Erlich's chat + references, force the
   * express cadences (QA/security/ops off, autopilot), and start the build.
   */
  handToDinesh: () => Promise<{ ok: boolean; taskId: string | null; error: string | null }>;
  createProject: (input: NewProjectInput) => Promise<ProjectCreateResult>;
  loadProjects: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  /** Deletes a project's data (and optionally its whole folder) + unregisters it. */
  deleteProject: (id: string, deleteFolder: boolean) => Promise<{ folderDeleted: boolean }>;
  /** Export a project's conversations to a Markdown file (Save dialog). */
  exportProject: (id: string) => Promise<ProjectExportResult>;
  /** Nuclear reset: optionally export chosen projects, then wipe everything to a fresh install. */
  factoryReset: (exportIds: string[]) => Promise<FactoryResetResult>;
  updateProjectRoleConfig: (roleId: RoleId, patch: Partial<RoleConfiguration>) => void;
  addBacklogItem: (text: string) => Promise<void>;
  validateActiveProjectTeam: () => Promise<void>;
  validateActiveProjectRole: (roleId: RoleId) => Promise<void>;
  loadRoom: (roleId: RoleId) => Promise<void>;
  sendRoomMessage: (roleId: RoleId, text: string) => Promise<void>;
  /** Re-send the last unanswered user turn after a failure/timeout (no new message appended). */
  retryRoomMessage: (roleId: RoleId) => Promise<void>;
  /** Load a persona's intervention transcript + seed context for an escalated task. */
  loadIntervention: (roleId: RoleId, taskId: string) => Promise<void>;
  /** Send a turn in a persona's intervention chat (the seat's CLI runs in the workspace). */
  sendInterventionMessage: (roleId: RoleId, taskId: string, text: string) => Promise<void>;
  /** Re-send the last unanswered intervention turn after a failure/timeout. */
  retryInterventionMessage: (roleId: RoleId, taskId: string) => Promise<void>;
  /** Has the persona open the conversation if the room is still empty. */
  kickoffRoom: (roleId: RoleId) => Promise<void>;
  loadWhiteboardPlan: () => Promise<void>;
  draftWhiteboardPlan: () => Promise<void>;
  /** Resolves true when the approve/send-back landed (callers gate navigation on it). */
  approveWhiteboardPlan: (approved: boolean) => Promise<boolean>;
  /** Set the active project's deployment posture (B1) — '' clears it (strict inferred default). */
  setDeploymentPosture: (posture: string) => Promise<void>;
  setBullpenCadence: (cadence: TestingCadence) => void;
  setBullpenSecurityCadence: (cadence: TestingCadence) => void;
  setBullpenOpsCadence: (cadence: OpsCadence) => void;
  setBullpenMode: (mode: 'autopilot' | 'manual') => void;
  startBullpen: () => Promise<void>;
  stopBullpen: () => void;
  resolveSetupTask: (taskId: string, founderNote?: string) => Promise<void>;
  /** Re-run QA on a QA-escalated task: re-queue it (→ done) and run the loop. */
  redoQa: (taskId: string) => Promise<void>;
  /** The Punch List: load Richard's change-intake transcript for the active project. */
  loadWorkRequest: () => Promise<void>;
  /** Send a change request to Richard; he triages and may file a task. */
  sendWorkRequest: (text: string) => Promise<void>;
  /** Re-send the last unanswered Punch List turn after a failure/timeout. */
  retryWorkRequest: () => Promise<void>;
  runBullpenSecurity: () => Promise<void>;
  loadGarageTelemetry: () => Promise<void>;
  /** The Garage: load recent CLI invocations for the activity panel. */
  loadGarageInvocations: () => Promise<void>;
  /** Restore the build log from the latest run record when re-entering the Bullpen. */
  hydrateBullpenLog: () => Promise<void>;
  loadRuns: () => Promise<void>;
  /** Aggregate run history across ALL projects for the Hacker Hostel dashboard. */
  loadDashboardStats: () => Promise<void>;
  openRunDetail: (runId: string) => Promise<void>;
  deleteRunRecord: (runId: string) => Promise<void>;
  /** Re-enter the Bullpen to continue a stopped/escalated run from task state. */
  resumeRun: (runId: string) => Promise<void>;
  /**
   * Flip any stale 'running' run records (a crash left them open) to 'interrupted' and set
   * bullpenInterrupted when the latest run is one. Call on Bullpen entry when not running.
   */
  reconcileInterruptedRuns: () => Promise<void>;
  detectClis: () => Promise<void>;
  runCliUpdate: (id: string) => Promise<void>;
  /** Assign a CLI preset to every default-chain role (first-run seeding). */
  /** Resolves false when the settings write failed (the roster only lives in memory). */
  seedRosterWithCli: (presetId: string) => Promise<boolean>;
  /** Mark first-run onboarding complete and flush it to disk. */
  /** Resolves false when the settings write failed (onboarded would not survive a restart). */
  completeOnboarding: () => Promise<boolean>;
  /** After multi-CLI onboarding: land on Default Team with the post-onboarding CTA. */
  finishOnboardingToTeam: () => void;
  setTheme: (theme: ThemeId) => void;
  setNamingMode: (mode: NamingMode) => void;
  /**
   * Record a cracked Pipey trivia clue + its answer (the vault key) and decrypt that
   * tier's portrait art. Persisted — see shared/easterEggs.ts + shared/imageVault.ts.
   */
  crackEgg: (mode: NamingMode, answer: string) => void;
  /** Decrypt a tier's persona portraits with its answer into decryptedPortraits. */
  unlockVaultTier: (tier: VaultTier, answer: string) => Promise<void>;
  /** Wake / sleep the Jian Yang takeover (canon-mode gag; persisted). */
  setJianYangAwake: (awake: boolean) => void;
  setUiScale: (scale: number) => void;
  updateRoleConfig: (roleId: RoleId, patch: Partial<RoleConfiguration>) => void;
  resetSettings: () => Promise<void>;
  validateTeam: () => Promise<void>;
  validateRole: (roleId: RoleId) => Promise<void>;
  hydrate: () => Promise<void>;
}

/** The optimistic result shape a chatTurn `send` round-trip returns. */
interface ChatTurnResult {
  ok: boolean;
  reply: string;
  error?: string | null;
  createdTaskId?: string | null;
}

/** The per-channel configuration for the one shared chat turn (see chatTurn). */
export interface ChatTurnCfg {
  /** New user text (a send), or null for a retry of the trailing user turn. */
  text: string | null;
  /** The channel's transcript at turn start. */
  current: ChatMessage[];
  /** True while a turn on this channel is already in flight (overlap guard). */
  busy: boolean;
  /** Surface an overlapping send as this channel error instead of a silent drop. */
  busyError?: string;
  /** When set, refuse the turn with this surfaced error (e.g. "the build is running"). */
  refusal?: string | null;
  /** Apply the optimistic transcript + set the in-flight flag + clear the channel error. */
  begin: (messages: ChatMessage[]) => void;
  /** The CLI round-trip for this channel. */
  send: (projectId: string, messages: ChatMessage[]) => Promise<ChatTurnResult>;
  /** Persist the successful reply (plus any per-channel follow-up). */
  commit: (messages: ChatMessage[], result: { createdTaskId?: string | null }) => Promise<void> | void;
  /** Surface a failure on this channel. */
  fail: (message: string) => void;
  /** Clear the in-flight flag. Runs unconditionally in finally. */
  end: () => void;
}

/** The shared closures the slices receive (created once in the store composer). */
export interface Helpers {
  schedulePersist: () => void;
  persistNow: () => Promise<void>;
  scheduleProjectPersist: () => void;
  persistProjectNow: () => Promise<void>;
  finishDanglingRun: () => void;
  /** Cancel any pending debounced settings save (resetSettings supersedes it). */
  cancelPendingSave: () => void;
  chatTurn: (cfg: ChatTurnCfg) => Promise<void>;
}

/** What every slice creator receives: the store's set/get + the shared helpers. */
export interface StoreCtx {
  set: StoreApi<AppState>['setState'];
  get: StoreApi<AppState>['getState'];
  h: Helpers;
}

export function applyThemeToDocument(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
}

export function applyUiScaleToDocument(scale: number): void {
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

/** Bridge is absent outside Electron (e.g. bare Vite preview). */
export function hasBridge(): boolean {
  return typeof window.nucleus !== 'undefined';
}

/**
 * The active project's derived working state, reset to empty. Spread into every action
 * that switches/creates/closes a project (createProject, openProject, deleteProject,
 * factoryReset) so a new per-project field is cleared in ONE place — previously this
 * ~17-key literal was hand-copied across four sites and had already DRIFTED
 * (deleteProject/factoryReset omitted bullpenStoppedAtCap/bullpenError, leaking a stale
 * "paused at cap" / error banner from the just-closed project onto the next view).
 *
 * DELIBERATELY NOT HERE: the chat in-flight flags (roomSendingRole /
 * interventionSendingKey / workRequestSending). chatTurn's unconditional
 * finally-clear is safe precisely because no new turn can start while a stale
 * turn holds the flag — resetting them on a project switch would let a new
 * project's turn begin and then be flag-cleared by the OLD turn's finally.
 */
export const CLEARED_PROJECT_STATE = {
  projectValidationResults: {},
  roomConversations: {},
  roomError: null,
  interventionConversations: {},
  interventionContexts: {},
  interventionError: null,
  workRequestMessages: [],
  workRequestError: null,
  whiteboardPlan: null,
  whiteboardError: null,
  bullpenSteps: [],
  bullpenComplete: false,
  bullpenEscalated: false,
  bullpenStoppedAtCap: false,
  bullpenInterrupted: null,
  bullpenError: null,
  securityResult: null,
  garageTelemetry: null,
  // The open-run handle is per-project: carrying project A's paused manual run id
  // into project B made every appendStep/finish for B a silent no-op (B's whole
  // manual session missing from Run History) while A's record dangled 'running'.
  currentRunId: null,
  resumeFromRunId: null,
} satisfies Partial<AppState>;
