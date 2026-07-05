import type { CliDetection, CliTestResult, CliUpdateResult } from './cli';
import type { BuildToolStatus } from './buildTools';
import type { InvocationLogRecord } from './diagnostics';
import type { Lesson, LessonStatus } from './lessons';
import type { WorkspaceHealthReport } from './markdown';
import type { ChatMessage, RoomTurnResult, WorkRequestTurnResult } from './room';
import type { InterventionLoadResult } from './intervention';
import type { ProjectPlan, WhiteboardDraftResult } from './whiteboard';
import type {
  BullpenActivity,
  BullpenRunOptions,
  BullpenStepResult,
  SecurityResult,
  TelemetrySummary,
} from './bullpen';
import type { NamingMode } from './naming';
import type { ReferenceFile } from './references';
import type { SecretEntry, SecretsManifest } from './secrets';
import type {
  FactoryResetResult,
  NewProjectInput,
  OpenProjectResult,
  ProjectCreateResult,
  ProjectExportResult,
  ProjectInfo,
  ProjectRegistryEntry,
  ProjectTeam,
} from './project';
import type { RoleId } from './roles';
import type { InstallOutcome } from './scaffold';
import type { RunRecord, RunStartInput, RunStatus, RunSummary } from './run';
import type { AppSettings } from './settings';
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionDescriptor,
  TerminalStartInput,
  TerminalStartResult,
} from './terminal';
import type { RoleValidationResult } from './validation';

/**
 * Typed IPC contract shared by main, preload, and renderer.
 * Channel names live here so they can never drift between layers.
 * This file must stay free of Electron and Node imports.
 */

export const IpcChannels = {
  appGetInfo: 'app:get-info',
  appNotifyAttention: 'app:notify-attention',
  appClearAttention: 'app:clear-attention',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset',
  validationValidateAll: 'validation:validate-all',
  validationValidateRole: 'validation:validate-role',
  cliDetectAll: 'cli:detect-all',
  cliRunUpdate: 'cli:run-update',
  cliTest: 'cli:test',
  buildToolsDetect: 'buildtools:detect',
  workspaceOpenInVscode: 'workspace:open-in-vscode',
  roomGetLog: 'room:get-log',
  roomSend: 'room:send',
  roomKickoff: 'room:kickoff',
  workRequestGetLog: 'work-request:get-log',
  workRequestSend: 'work-request:send',
  interventionLoad: 'intervention:load',
  interventionSend: 'intervention:send',
  whiteboardDraft: 'whiteboard:draft',
  whiteboardGetPlan: 'whiteboard:get-plan',
  whiteboardApprove: 'whiteboard:approve',
  bullpenNextStep: 'bullpen:next-step',
  bullpenActivity: 'bullpen:activity',
  bullpenResolveTask: 'bullpen:resolve-task',
  bullpenRequeueQa: 'bullpen:requeue-qa',
  bullpenSecurity: 'bullpen:security',
  bullpenTelemetry: 'bullpen:telemetry',
  runStart: 'run:start',
  runAppendStep: 'run:append-step',
  runFinish: 'run:finish',
  runList: 'run:list',
  runGet: 'run:get',
  runDelete: 'run:delete',
  runReconcile: 'run:reconcile',
  terminalStart: 'terminal:start',
  terminalInput: 'terminal:input',
  terminalResize: 'terminal:resize',
  terminalKill: 'terminal:kill',
  terminalList: 'terminal:list',
  lessonsList: 'lessons:list',
  lessonsSetStatus: 'lessons:set-status',
  diagnosticsRecent: 'diagnostics:recent',
  /** Event channels (main → renderer via webContents.send). */
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  dialogSelectFolder: 'dialog:select-folder',
  projectCreate: 'project:create',
  projectInstallStatus: 'project:install-status',
  projectList: 'project:list',
  projectOpen: 'project:open',
  projectDelete: 'project:delete',
  projectExport: 'project:export',
  projectFactoryReset: 'project:factory-reset',
  projectUpdateTeam: 'project:update-team',
  projectSetDeploymentPosture: 'project:set-deployment-posture',
  projectValidateTeam: 'project:validate-team',
  projectValidateRole: 'project:validate-role',
  projectAddBacklog: 'project:add-backlog',
  projectReadDoc: 'project:read-doc',
  workspaceValidate: 'workspace:validate',
  referencesList: 'references:list',
  referencesAdd: 'references:add',
  referencesSetNote: 'references:set-note',
  referencesRemove: 'references:remove',
  ripItBuild: 'ripit:build',
  secretsGetManifest: 'secrets:get-manifest',
  secretsSetManifest: 'secrets:set-manifest',
  secretsDeriveFromBlueprint: 'secrets:derive-from-blueprint',
  secretsGeneratePushScript: 'secrets:generate-push-script',
} as const;

export interface AppInfo {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  packaged: boolean;
}

/**
 * The complete surface exposed to the renderer as window.nucleus.
 * The renderer sees nothing else — no Node, no Electron.
 */
export interface NucleusApi {
  app: {
    getInfo(): Promise<AppInfo>;
    /**
     * Nudge the user when a build needs them — an OS notification + taskbar/dock badge,
     * fired ONLY when the window is unfocused (the walk-away payoff). No-op when focused.
     */
    notifyAttention(input: { kind: 'escalated' | 'complete' | 'error'; projectName: string }): Promise<void>;
    /** Clear the attention badge / frame flash (also cleared automatically on window focus). */
    clearAttention(): Promise<void>;
  };
  settings: {
    get(): Promise<AppSettings>;
    /**
     * Persists the given settings. Main sanitizes the payload (the
     * renderer is not trusted) and returns the canonical saved value.
     */
    update(settings: AppSettings): Promise<AppSettings>;
    reset(): Promise<AppSettings>;
  };
  validation: {
    /** Validates every role's persisted configuration. */
    validateAll(): Promise<RoleValidationResult[]>;
    /** Validates a single role's persisted configuration. */
    validateRole(roleId: RoleId): Promise<RoleValidationResult>;
  };
  cli: {
    /** Detects every known CLI's install status + version (alphabetical). */
    detectAll(): Promise<CliDetection[]>;
    /** Runs a CLI's update command and returns its output. */
    runUpdate(id: string): Promise<CliUpdateResult>;
    /** Runs a trivial one-shot prompt to confirm a CLI responds (auth OK). */
    test(presetId: string): Promise<CliTestResult>;
  };
  buildTools: {
    /**
     * Detects the build-prerequisite tools a template+overlays needs (PATH
     * presence + the OS install command for what's missing). The renderer passes
     * the chosen templateId/overlayIds; main composes the blueprint.
     */
    detect(templateId: string | null, overlayIds: string[]): Promise<BuildToolStatus[]>;
    /** Open the project's workspace folder in VS Code (`code <workspace>`). */
    openInVscode(projectId: string): Promise<{ ok: boolean; error?: string }>;
  };
  room: {
    /** Persisted transcript for a project's role room. */
    getLog(projectId: string, roleId: RoleId): Promise<ChatMessage[]>;
    /** Sends the transcript to the role's CLI; persists and returns the reply.
     * namingMode drives the Jian Yang voice takeover (canon + awake). */
    send(
      projectId: string,
      roleId: RoleId,
      messages: ChatMessage[],
      namingMode: NamingMode,
    ): Promise<RoomTurnResult>;
    /**
     * Persona speaks first: generates and persists an opening message (drawing on
     * earlier rooms). No-op with an empty reply if the room already has messages.
     */
    kickoff(projectId: string, roleId: RoleId, namingMode: NamingMode): Promise<RoomTurnResult>;
  };
  workRequest: {
    /** The Punch List transcript (Richard's change-intake chat). */
    getLog(projectId: string): Promise<ChatMessage[]>;
    /**
     * One turn: Richard triages the request and, if he accepts, files a task in
     * the most plausible phase. Returns his reply + any task he filed.
     */
    send(
      projectId: string,
      messages: ChatMessage[],
      namingMode: NamingMode,
    ): Promise<WorkRequestTurnResult>;
  };
  intervention: {
    /**
     * The transcript + seed context (the escalated task + its acceptance criteria
     * + what QA last reported) for a human-in-the-loop chat with a build persona.
     */
    load(projectId: string, roleId: RoleId, taskId: string): Promise<InterventionLoadResult>;
    /**
     * One intervention turn: the seat's CLI runs in the workspace cwd (so it can
     * inspect the code) and replies. namingMode drives the distinct-mode voice.
     */
    send(
      projectId: string,
      roleId: RoleId,
      taskId: string,
      messages: ChatMessage[],
      namingMode: NamingMode,
    ): Promise<RoomTurnResult>;
  };
  whiteboard: {
    /** Richard drafts phases & tasks from the vision + design; writes task files. */
    draft(projectId: string): Promise<WhiteboardDraftResult>;
    /** Reads the project's tasks + approval state. */
    getPlan(projectId: string): Promise<ProjectPlan>;
    /** Sets plan approval and returns the updated plan. */
    approve(projectId: string, approved: boolean): Promise<ProjectPlan>;
  };
  bullpen: {
    /** Runs one build step (dev / QA / security / architect / phase-end). */
    nextStep(projectId: string, opts: BullpenRunOptions): Promise<BullpenStepResult>;
    /** The agent working right now (polled during a run), or null when idle. */
    activity(projectId: string): Promise<BullpenActivity | null>;
    /** Marks a human-needed task complete (→ verified) after the human handled it.
     * The optional founder note is written into the task file so QA + later tasks
     * can SEE the human's outcome (e.g. "tested everything — no issues found"). */
    resolveTask(
      projectId: string,
      taskId: string,
      founderNote?: string,
    ): Promise<{ ok: boolean; error: string | null }>;
    /** Re-queues a QA-escalated task (→ done) so the next step runs QA on it again. */
    requeueQa(projectId: string, taskId: string): Promise<{ ok: boolean; error: string | null }>;
    /** Runs Gilfoyle's security pass after the build is complete. */
    security(projectId: string): Promise<SecurityResult>;
    /** Telemetry for The Garage (CLIs, time, iterations). */
    telemetry(projectId: string): Promise<TelemetrySummary>;
  };
  run: {
    /** Opens a new run record for a Bullpen build session. */
    start(input: RunStartInput): Promise<RunRecord>;
    /** Appends one driven step to a run (fire-and-forget from the loop). */
    appendStep(projectId: string, runId: string, step: BullpenStepResult): Promise<void>;
    /** Closes a run with its terminal status. */
    finish(projectId: string, runId: string, status: RunStatus): Promise<void>;
    /** Run summaries for a project, newest first. */
    list(projectId: string): Promise<RunSummary[]>;
    /** A single run with its full step timeline. */
    get(projectId: string, runId: string): Promise<RunRecord | null>;
    /** Deletes a run record; returns the updated list. */
    delete(projectId: string, runId: string): Promise<RunSummary[]>;
    /**
     * Reconcile stale 'running' records (crash/close left them open) to 'interrupted'.
     * Pass the caller's live run id to spare it; returns the updated list. Call on project
     * open, when no live loop owns a 'running' record.
     */
    reconcile(projectId: string, exceptRunId: string | null): Promise<RunSummary[]>;
  };
  lessons: {
    /** All lessons (newest-seen first) — cross-project; the read-only ledger. */
    list(): Promise<Lesson[]>;
    /** Owner curation: mute (exclude from injection), un-mute, or confirm a lesson. */
    setStatus(id: string, status: LessonStatus): Promise<Lesson | null>;
  };
  diagnostics: {
    /**
     * Recent CLI invocations, newest first (cross-project), for The Garage's
     * activity panel. Sanitized — prompts are reduced to length + hash + first line.
     */
    recentInvocations(limit?: number): Promise<InvocationLogRecord[]>;
  };
  terminal: {
    /** Opens a PTY running the role's CLI ('cli') or the OS shell ('shell'). */
    start(input: TerminalStartInput): Promise<TerminalStartResult>;
    /** Writes user keystrokes to a session's PTY (fire-and-forget). */
    input(sessionId: string, data: string): void;
    /** Resizes a session's PTY to match the xterm viewport. */
    resize(sessionId: string, cols: number, rows: number): void;
    /** Kills a session's PTY. */
    kill(sessionId: string): void;
    /** Live sessions for a project. */
    list(projectId: string): Promise<TerminalSessionDescriptor[]>;
    /** Subscribes to PTY output; returns an unsubscribe function. */
    onData(listener: (event: TerminalDataEvent) => void): () => void;
    /** Subscribes to PTY exit; returns an unsubscribe function. */
    onExit(listener: (event: TerminalExitEvent) => void): () => void;
  };
  project: {
    /** Opens a native directory picker; null when cancelled. */
    selectFolder(): Promise<string | null>;
    /** Creates a project, seeds its team, registers it, and makes it active. */
    create(input: NewProjectInput): Promise<ProjectCreateResult>;
    /**
     * Current state of the BACKGROUND dependency install kicked off by create (the
     * scaffolded app's `npm install` / `dotnet restore`). Poll until `pending` is false.
     * Returns the inert no-op outcome when no install is tracked for this id.
     */
    installStatus(id: string): Promise<InstallOutcome>;
    /** All registered projects plus the active project id. */
    list(): Promise<{ projects: ProjectRegistryEntry[]; activeProjectId: string | null }>;
    /** Opens a project by id (makes it active) and returns its full state. */
    open(id: string): Promise<OpenProjectResult>;
    /**
     * Deletes a project: removes it from the registry and deletes its `.nucleus`
     * app data. When deleteFolder is true the ENTIRE workspace folder (code and
     * all) is permanently deleted — guarded against roots/home/system paths and
     * requires the folder to be a real Nucleus workspace.
     */
    delete(
      id: string,
      deleteFolder: boolean,
    ): Promise<{
      projects: ProjectRegistryEntry[];
      activeProjectId: string | null;
      folderDeleted: boolean;
      /** True when the user dismissed the native confirmation — a no-op. */
      cancelled: boolean;
    }>;
    /**
     * Exports a project's saved conversations (Erlich / Monica / Richard / Punch List)
     * to a Markdown file the user picks via a Save dialog. namingMode sets the persona names.
     */
    export(id: string, namingMode: NamingMode): Promise<ProjectExportResult>;
    /**
     * Nuclear: optionally export the chosen projects (folder picker), then move every
     * project folder to the Trash (guard-permitting) and erase all Nucleus history,
     * resetting to a fresh install. Gated behind an un-fakeable native confirmation.
     */
    factoryReset(
      exportIds: string[],
      namingMode: NamingMode,
    ): Promise<FactoryResetResult>;
    /** Replaces a project's team roster. */
    updateTeam(id: string, roles: ProjectTeam): Promise<ProjectTeam>;
    /**
     * Sets the project's deployment posture (B1) — the lever that calibrates the security
     * review. An empty/unknown value clears it (the team falls back to a strict inferred
     * default). Returns the updated project info.
     */
    setDeploymentPosture(id: string, posture: string): Promise<ProjectInfo>;
    /** Validates the project's persisted team assignments against the machine. */
    validateTeam(id: string): Promise<RoleValidationResult[]>;
    /** Validates a single role of the project's persisted team. */
    validateRole(id: string, roleId: RoleId): Promise<RoleValidationResult>;
    /** Appends an item to a project's backlog. */
    addBacklog(id: string, text: string): Promise<void>;
    /**
     * Read a KNOWN read-only workspace doc by key (allow-list, no free-text path). Used by the
     * findings-backlog / project-backlog panels. Returns null when the doc is absent.
     */
    readDoc(id: string, key: 'findings-backlog' | 'project-backlog'): Promise<string | null>;
    /** Re-validates an existing workspace against the contract. */
    validateWorkspace(workspacePath: string): Promise<WorkspaceHealthReport>;
  };
  references: {
    /** The founder's reference files for a project (screenshots, specs, assets). */
    list(projectId: string): Promise<ReferenceFile[]>;
    /**
     * Opens a native multi-select file picker and copies the chosen files into the
     * project's references/ folder (extension + size validated in main). Returns
     * what landed, what was rejected and why, and the refreshed list.
     */
    add(projectId: string): Promise<{
      added: string[];
      rejected: string[];
      references: ReferenceFile[];
      cancelled: boolean;
    }>;
    /** Sets (or clears, when blank) the founder's note for one reference file. */
    setNote(projectId: string, fileName: string, note: string): Promise<ReferenceFile[]>;
    /** Deletes one reference file. */
    remove(projectId: string, fileName: string): Promise<ReferenceFile[]>;
  };
  ripIt: {
    /**
     * "Rip it and Ship It": synthesize ONE build task from the founder's Erlich chat
     * + uploaded references and approve the plan, so the Bullpen hands it straight to
     * Dinesh. The app writes the task — never the CLI.
     */
    build(projectId: string): Promise<{ ok: boolean; taskId: string | null; error: string | null }>;
  };
  secrets: {
    /**
     * The names-only secrets manifest for a built app (env-var names + stage +
     * destination, NEVER values). Falls back to the blueprint-derived set when the
     * project has no stored manifest yet.
     */
    getManifest(projectId: string): Promise<SecretsManifest>;
    /**
     * Replace the manifest. Every entry is sanitized in main (the untrusted-input
     * boundary) — value-shaped entries are rejected. Returns the persisted manifest
     * plus the env-var names of any entries that were dropped.
     */
    setManifest(
      projectId: string,
      secrets: SecretEntry[],
    ): Promise<{ manifest: SecretsManifest; rejected: string[] }>;
    /** Re-derive names from the project's blueprint and merge with stored (keeps edits). */
    deriveFromBlueprint(projectId: string): Promise<SecretsManifest>;
    /**
     * Write scripts/push-secrets.sh from the current manifest (the app writes it,
     * never the CLI). Names-only, value-on-stdin form — the founder runs it to set
     * each value. Returns the workspace-relative path written.
     */
    generatePushScript(projectId: string): Promise<{ scriptPath: string }>;
  };
}
