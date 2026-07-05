import { ipcRenderer } from 'electron';
import type { CliDetection, CliTestResult, CliUpdateResult } from '../shared/cli';
import type { BuildToolStatus } from '../shared/buildTools';
import type { AppInfo, NucleusApi } from '../shared/ipc';
import type { ChatMessage, RoomTurnResult, WorkRequestTurnResult } from '../shared/room';
import type { InterventionLoadResult } from '../shared/intervention';
import type { ProjectPlan, WhiteboardDraftResult } from '../shared/whiteboard';
import type {
  BullpenActivity,
  BullpenRunOptions,
  BullpenStepResult,
  SecurityResult,
  TelemetrySummary,
} from '../shared/bullpen';
import type { InvocationLogRecord } from '../shared/diagnostics';
import type { Lesson, LessonStatus } from '../shared/lessons';
import type { NamingMode } from '../shared/naming';
import type { ReferenceFile } from '../shared/references';
import type { SecretEntry, SecretsManifest } from '../shared/secrets';
import { IpcChannels } from '../shared/ipc';
import type { WorkspaceHealthReport } from '../shared/markdown';
import type {
  FactoryResetResult,
  NewProjectInput,
  OpenProjectResult,
  ProjectCreateResult,
  ProjectExportResult,
  ProjectInfo,
  ProjectRegistryEntry,
  ProjectTeam,
} from '../shared/project';
import type { RoleId } from '../shared/roles';
import type { InstallOutcome } from '../shared/scaffold';
import type { RunRecord, RunStartInput, RunStatus, RunSummary } from '../shared/run';
import type { AppSettings } from '../shared/settings';
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionDescriptor,
  TerminalStartInput,
  TerminalStartResult,
} from '../shared/terminal';
import type { RoleValidationResult } from '../shared/validation';

/**
 * The single object exposed to the renderer. Each method maps to exactly
 * one validated ipcMain.handle in the main process. No generic
 * "invoke any channel" escape hatch is exposed — the surface is closed.
 */
export const nucleusApi: NucleusApi = {
  app: {
    getInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IpcChannels.appGetInfo),
    notifyAttention: (input: {
      kind: 'escalated' | 'complete' | 'error';
      projectName: string;
    }): Promise<void> => ipcRenderer.invoke(IpcChannels.appNotifyAttention, input),
    clearAttention: (): Promise<void> => ipcRenderer.invoke(IpcChannels.appClearAttention),
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IpcChannels.settingsGet),
    update: (settings: AppSettings): Promise<AppSettings> =>
      ipcRenderer.invoke(IpcChannels.settingsUpdate, settings),
    reset: (): Promise<AppSettings> => ipcRenderer.invoke(IpcChannels.settingsReset),
  },
  validation: {
    validateAll: (): Promise<RoleValidationResult[]> =>
      ipcRenderer.invoke(IpcChannels.validationValidateAll),
    validateRole: (roleId: RoleId): Promise<RoleValidationResult> =>
      ipcRenderer.invoke(IpcChannels.validationValidateRole, roleId),
  },
  cli: {
    detectAll: (): Promise<CliDetection[]> => ipcRenderer.invoke(IpcChannels.cliDetectAll),
    runUpdate: (id: string): Promise<CliUpdateResult> =>
      ipcRenderer.invoke(IpcChannels.cliRunUpdate, id),
    test: (presetId: string): Promise<CliTestResult> =>
      ipcRenderer.invoke(IpcChannels.cliTest, presetId),
  },
  buildTools: {
    detect: (templateId: string | null, overlayIds: string[]): Promise<BuildToolStatus[]> =>
      ipcRenderer.invoke(IpcChannels.buildToolsDetect, templateId, overlayIds),
    openInVscode: (projectId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.workspaceOpenInVscode, projectId),
  },
  room: {
    getLog: (projectId: string, roleId: RoleId): Promise<ChatMessage[]> =>
      ipcRenderer.invoke(IpcChannels.roomGetLog, { id: projectId, roleId }),
    send: (
      projectId: string,
      roleId: RoleId,
      messages: ChatMessage[],
      namingMode: NamingMode,
    ): Promise<RoomTurnResult> =>
      ipcRenderer.invoke(IpcChannels.roomSend, { id: projectId, roleId, messages, namingMode }),
    kickoff: (projectId: string, roleId: RoleId, namingMode: NamingMode): Promise<RoomTurnResult> =>
      ipcRenderer.invoke(IpcChannels.roomKickoff, { id: projectId, roleId, namingMode }),
  },
  workRequest: {
    getLog: (projectId: string): Promise<ChatMessage[]> =>
      ipcRenderer.invoke(IpcChannels.workRequestGetLog, { id: projectId }),
    send: (
      projectId: string,
      messages: ChatMessage[],
      namingMode: NamingMode,
    ): Promise<WorkRequestTurnResult> =>
      ipcRenderer.invoke(IpcChannels.workRequestSend, { id: projectId, messages, namingMode }),
  },
  intervention: {
    load: (projectId: string, roleId: RoleId, taskId: string): Promise<InterventionLoadResult> =>
      ipcRenderer.invoke(IpcChannels.interventionLoad, { id: projectId, roleId, taskId }),
    send: (
      projectId: string,
      roleId: RoleId,
      taskId: string,
      messages: ChatMessage[],
      namingMode: NamingMode,
    ): Promise<RoomTurnResult> =>
      ipcRenderer.invoke(IpcChannels.interventionSend, {
        id: projectId,
        roleId,
        taskId,
        messages,
        namingMode,
      }),
  },
  whiteboard: {
    draft: (projectId: string): Promise<WhiteboardDraftResult> =>
      ipcRenderer.invoke(IpcChannels.whiteboardDraft, projectId),
    getPlan: (projectId: string): Promise<ProjectPlan> =>
      ipcRenderer.invoke(IpcChannels.whiteboardGetPlan, projectId),
    approve: (projectId: string, approved: boolean): Promise<ProjectPlan> =>
      ipcRenderer.invoke(IpcChannels.whiteboardApprove, { id: projectId, approved }),
  },
  bullpen: {
    nextStep: (projectId: string, opts: BullpenRunOptions): Promise<BullpenStepResult> =>
      ipcRenderer.invoke(IpcChannels.bullpenNextStep, { id: projectId, ...opts }),
    activity: (projectId: string): Promise<BullpenActivity | null> =>
      ipcRenderer.invoke(IpcChannels.bullpenActivity, projectId),
    resolveTask: (
      projectId: string,
      taskId: string,
      founderNote?: string,
    ): Promise<{ ok: boolean; error: string | null }> =>
      ipcRenderer.invoke(IpcChannels.bullpenResolveTask, { id: projectId, taskId, founderNote }),
    requeueQa: (
      projectId: string,
      taskId: string,
    ): Promise<{ ok: boolean; error: string | null }> =>
      ipcRenderer.invoke(IpcChannels.bullpenRequeueQa, { id: projectId, taskId }),
    security: (projectId: string): Promise<SecurityResult> =>
      ipcRenderer.invoke(IpcChannels.bullpenSecurity, projectId),
    telemetry: (projectId: string): Promise<TelemetrySummary> =>
      ipcRenderer.invoke(IpcChannels.bullpenTelemetry, projectId),
  },
  run: {
    start: (input: RunStartInput): Promise<RunRecord> =>
      ipcRenderer.invoke(IpcChannels.runStart, input),
    appendStep: (projectId: string, runId: string, step: BullpenStepResult): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.runAppendStep, { projectId, runId, step }),
    finish: (projectId: string, runId: string, status: RunStatus): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.runFinish, { projectId, runId, status }),
    list: (projectId: string): Promise<RunSummary[]> =>
      ipcRenderer.invoke(IpcChannels.runList, projectId),
    get: (projectId: string, runId: string): Promise<RunRecord | null> =>
      ipcRenderer.invoke(IpcChannels.runGet, { projectId, runId }),
    delete: (projectId: string, runId: string): Promise<RunSummary[]> =>
      ipcRenderer.invoke(IpcChannels.runDelete, { projectId, runId }),
    reconcile: (projectId: string, exceptRunId: string | null): Promise<RunSummary[]> =>
      ipcRenderer.invoke(IpcChannels.runReconcile, { projectId, exceptRunId }),
  },
  lessons: {
    list: (): Promise<Lesson[]> => ipcRenderer.invoke(IpcChannels.lessonsList),
    setStatus: (id: string, status: LessonStatus): Promise<Lesson | null> =>
      ipcRenderer.invoke(IpcChannels.lessonsSetStatus, { id, status }),
  },
  diagnostics: {
    recentInvocations: (limit?: number): Promise<InvocationLogRecord[]> =>
      ipcRenderer.invoke(IpcChannels.diagnosticsRecent, limit),
  },
  terminal: {
    start: (input: TerminalStartInput): Promise<TerminalStartResult> =>
      ipcRenderer.invoke(IpcChannels.terminalStart, input),
    input: (sessionId: string, data: string): void => {
      // Fire-and-forget for low-latency keystrokes (send, not invoke).
      ipcRenderer.send(IpcChannels.terminalInput, { sessionId, data });
    },
    resize: (sessionId: string, cols: number, rows: number): void => {
      ipcRenderer.send(IpcChannels.terminalResize, { sessionId, cols, rows });
    },
    kill: (sessionId: string): void => {
      ipcRenderer.send(IpcChannels.terminalKill, { sessionId });
    },
    list: (projectId: string): Promise<TerminalSessionDescriptor[]> =>
      ipcRenderer.invoke(IpcChannels.terminalList, projectId),
    onData: (listener: (event: TerminalDataEvent) => void): (() => void) => {
      const handler = (_e: unknown, payload: TerminalDataEvent): void => listener(payload);
      ipcRenderer.on(IpcChannels.terminalData, handler);
      return () => ipcRenderer.removeListener(IpcChannels.terminalData, handler);
    },
    onExit: (listener: (event: TerminalExitEvent) => void): (() => void) => {
      const handler = (_e: unknown, payload: TerminalExitEvent): void => listener(payload);
      ipcRenderer.on(IpcChannels.terminalExit, handler);
      return () => ipcRenderer.removeListener(IpcChannels.terminalExit, handler);
    },
  },
  project: {
    selectFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.dialogSelectFolder),
    create: (input: NewProjectInput): Promise<ProjectCreateResult> =>
      ipcRenderer.invoke(IpcChannels.projectCreate, input),
    installStatus: (id: string): Promise<InstallOutcome> =>
      ipcRenderer.invoke(IpcChannels.projectInstallStatus, id),
    list: (): Promise<{ projects: ProjectRegistryEntry[]; activeProjectId: string | null }> =>
      ipcRenderer.invoke(IpcChannels.projectList),
    open: (id: string): Promise<OpenProjectResult> =>
      ipcRenderer.invoke(IpcChannels.projectOpen, id),
    delete: (
      id: string,
      deleteFolder: boolean,
    ): Promise<{
      projects: ProjectRegistryEntry[];
      activeProjectId: string | null;
      folderDeleted: boolean;
      cancelled: boolean;
    }> => ipcRenderer.invoke(IpcChannels.projectDelete, { id, deleteFolder }),
    export: (id: string, namingMode: NamingMode): Promise<ProjectExportResult> =>
      ipcRenderer.invoke(IpcChannels.projectExport, { id, namingMode }),
    factoryReset: (exportIds: string[], namingMode: NamingMode): Promise<FactoryResetResult> =>
      ipcRenderer.invoke(IpcChannels.projectFactoryReset, { exportIds, namingMode }),
    updateTeam: (id: string, roles: ProjectTeam): Promise<ProjectTeam> =>
      ipcRenderer.invoke(IpcChannels.projectUpdateTeam, { id, roles }),
    setDeploymentPosture: (id: string, posture: string): Promise<ProjectInfo> =>
      ipcRenderer.invoke(IpcChannels.projectSetDeploymentPosture, { id, posture }),
    validateTeam: (id: string): Promise<RoleValidationResult[]> =>
      ipcRenderer.invoke(IpcChannels.projectValidateTeam, id),
    validateRole: (id: string, roleId: RoleId): Promise<RoleValidationResult> =>
      ipcRenderer.invoke(IpcChannels.projectValidateRole, { id, roleId }),
    addBacklog: (id: string, text: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.projectAddBacklog, { id, text }),
    readDoc: (id: string, key: 'findings-backlog' | 'project-backlog'): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.projectReadDoc, { id, key }),
    validateWorkspace: (workspacePath: string): Promise<WorkspaceHealthReport> =>
      ipcRenderer.invoke(IpcChannels.workspaceValidate, workspacePath),
  },
  references: {
    list: (projectId: string): Promise<ReferenceFile[]> =>
      ipcRenderer.invoke(IpcChannels.referencesList, { id: projectId }),
    add: (
      projectId: string,
    ): Promise<{ added: string[]; rejected: string[]; references: ReferenceFile[]; cancelled: boolean }> =>
      ipcRenderer.invoke(IpcChannels.referencesAdd, { id: projectId }),
    setNote: (projectId: string, fileName: string, note: string): Promise<ReferenceFile[]> =>
      ipcRenderer.invoke(IpcChannels.referencesSetNote, { id: projectId, fileName, note }),
    remove: (projectId: string, fileName: string): Promise<ReferenceFile[]> =>
      ipcRenderer.invoke(IpcChannels.referencesRemove, { id: projectId, fileName }),
  },
  ripIt: {
    build: (
      projectId: string,
    ): Promise<{ ok: boolean; taskId: string | null; error: string | null }> =>
      ipcRenderer.invoke(IpcChannels.ripItBuild, { id: projectId }),
  },
  secrets: {
    getManifest: (projectId: string): Promise<SecretsManifest> =>
      ipcRenderer.invoke(IpcChannels.secretsGetManifest, { id: projectId }),
    setManifest: (
      projectId: string,
      secrets: SecretEntry[],
    ): Promise<{ manifest: SecretsManifest; rejected: string[] }> =>
      ipcRenderer.invoke(IpcChannels.secretsSetManifest, { id: projectId, secrets }),
    deriveFromBlueprint: (projectId: string): Promise<SecretsManifest> =>
      ipcRenderer.invoke(IpcChannels.secretsDeriveFromBlueprint, { id: projectId }),
    generatePushScript: (projectId: string): Promise<{ scriptPath: string }> =>
      ipcRenderer.invoke(IpcChannels.secretsGeneratePushScript, { id: projectId }),
  },
};
