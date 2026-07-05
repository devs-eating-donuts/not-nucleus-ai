import { create } from 'zustand';
import type { ChatMessage } from '../../shared/room';
import { createDefaultSettings } from '../../shared/settings';
import { DEFAULT_NAMING_MODE } from '../../shared/naming';
import { DEFAULT_THEME, DEFAULT_UI_SCALE } from '../../shared/theme';
import type { AppState, ChatTurnCfg, Helpers, StoreCtx } from './appStoreShared';
import { hasBridge } from './appStoreShared';
import { createNavSlice } from './slices/navSlice';
import { createSettingsSlice } from './slices/settingsSlice';
import { createProjectsSlice } from './slices/projectsSlice';
import { createConversationsSlice } from './slices/conversationsSlice';
import { createWhiteboardSlice } from './slices/whiteboardSlice';
import { createBullpenSlice } from './slices/bullpenSlice';

export type { PageId, SettingsSaveState, ActiveProject } from './appStoreShared';

const SAVE_DEBOUNCE_MS = 450;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let projectSaveTimer: ReturnType<typeof setTimeout> | undefined;
// Monotonic revisions so a slow in-flight request can't commit stale state over a
// newer edit. Bumped on each edit. (openProject's token lives in projectsSlice.)
let settingsRev = 0;
let projectSaveRev = 0;

/**
 * The single Zustand store, sliced with the slices pattern (CLAUDE.md: "slice it with
 * the slices pattern rather than adding a second global store"). This composer owns the
 * cross-cutting shared closures (debounced persistence, the dangling-run finisher, and
 * the one chatTurn behind every chat channel) + the initial state; each domain's actions
 * live in a slice file under ./slices and receive { set, get, h } via StoreCtx. All slices
 * share one set/get over the whole AppState, so cross-slice reads/calls just work.
 */
export const useAppStore = create<AppState>((set, get) => {
  /**
   * Optimistic-update model: the store changes immediately, persistence is
   * debounced so typing in the Team page doesn't write JSON per keystroke.
   * The sanitized response is NOT written back into the store — a slow
   * round-trip must never clobber newer local edits.
   */
  const schedulePersist = (): void => {
    if (!hasBridge()) {
      return;
    }
    settingsRev += 1;
    const rev = settingsRev;
    set({ settingsSaveState: 'saving' });
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      window.nucleus.settings
        .update(get().settings)
        // Only report this save's outcome if no newer edit superseded it —
        // a stale resolve must never flip the badge to 'saved' while a newer
        // write is still pending.
        .then(() => {
          if (rev === settingsRev) {
            set({ settingsSaveState: 'saved' });
          }
        })
        .catch(() => {
          if (rev === settingsRev) {
            set({ settingsSaveState: 'error' });
          }
        });
    }, SAVE_DEBOUNCE_MS);
  };

  /**
   * Flush any pending debounced save immediately. Validation reads the
   * persisted settings in the main process, so edits must land first.
   */
  const persistNow = async (): Promise<void> => {
    if (!hasBridge()) {
      return;
    }
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    if (get().settingsSaveState !== 'saving') {
      return;
    }
    settingsRev += 1;
    const rev = settingsRev;
    try {
      await window.nucleus.settings.update(get().settings);
      if (rev === settingsRev) {
        set({ settingsSaveState: 'saved' });
      }
    } catch {
      if (rev === settingsRev) {
        set({ settingsSaveState: 'error' });
      }
    }
  };

  /**
   * Debounced + flushable persistence for the active project's team.
   * The target id + team are SNAPSHOT at schedule time — if the user
   * switches projects before the timer fires, the pending write still
   * lands on the project it belonged to (no silently-dropped edits).
   */
  const scheduleProjectPersist = (): void => {
    if (!hasBridge()) {
      return;
    }
    const active = get().activeProject;
    if (!active) {
      return;
    }
    const id = active.registry.id;
    const team = active.team;
    projectSaveRev += 1;
    const rev = projectSaveRev;
    if (projectSaveTimer !== undefined) {
      clearTimeout(projectSaveTimer);
    }
    projectSaveTimer = setTimeout(() => {
      // A newer scheduled save (possibly for a different project) supersedes
      // this one; skip the stale write so edits can't land out of order.
      if (rev !== projectSaveRev) {
        return;
      }
      void window.nucleus.project.updateTeam(id, team).catch(() => {
        /* best-effort; next edit retries */
      });
    }, SAVE_DEBOUNCE_MS);
  };

  const persistProjectNow = async (): Promise<void> => {
    if (!hasBridge()) {
      return;
    }
    if (projectSaveTimer !== undefined) {
      clearTimeout(projectSaveTimer);
      projectSaveTimer = undefined;
    }
    const active = get().activeProject;
    if (active) {
      await window.nucleus.project.updateTeam(active.registry.id, active.team);
    }
  };

  /**
   * Best-effort: close the OUTGOING project's open (paused manual-mode) run record
   * before a project switch clears `currentRunId` — otherwise that record lingers
   * status 'running' in its Run History forever. When the loop is actually RUNNING
   * it closes its own record on the switch (its finally holds the captured project
   * id), so this only handles the paused case.
   */
  const finishDanglingRun = (): void => {
    const runId = get().currentRunId;
    const owner = get().activeProjectId;
    if (runId && owner && hasBridge() && !get().bullpenRunning) {
      void window.nucleus.run.finish(owner, runId, 'stopped').catch(() => undefined);
    }
  };

  /** Cancel any pending debounced settings save (resetSettings supersedes it). */
  const cancelPendingSave = (): void => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
    }
  };

  /**
   * The one shared turn behind the six chat send/retry actions (design rooms /
   * intervention chats / the Punch List). The channels differ ONLY through cfg —
   * their guards (the asymmetries are intentional: room chats may run during a
   * build because they execute in a temp cwd with no autopilot; the
   * workspace-writing channels must not), their state keys, and their reply
   * follow-ups. Two invariants this codebase has re-learned the hard way are
   * standardized here for every channel: the
   * in-flight flag ALWAYS clears in finally (even after a project switch — the
   * workRequestSending wedge), and EVERY post-await write (reply, error, catch)
   * is guarded on the project that started the turn, so a slow turn can never
   * bleed state into another project's view.
   */
  const chatTurn = async (cfg: ChatTurnCfg): Promise<void> => {
    const active = get().activeProject;
    if (!active || !hasBridge() || (cfg.text !== null && cfg.text.trim() === '')) {
      return;
    }
    if (cfg.busy) {
      if (cfg.busyError) {
        cfg.fail(cfg.busyError);
      }
      return;
    }
    if (cfg.refusal) {
      cfg.fail(cfg.refusal);
      return;
    }
    // A retry re-sends the transcript as-is — only valid when it actually ends
    // with the unanswered user turn.
    const last = cfg.current[cfg.current.length - 1];
    if (cfg.text === null && (!last || last.role !== 'user')) {
      return;
    }
    const target = active.registry.id;
    const sent: ChatMessage[] =
      cfg.text === null ? cfg.current : [...cfg.current, { role: 'user', text: cfg.text.trim() }];
    cfg.begin(sent);
    try {
      const result = await cfg.send(target, sent);
      // The user may have switched/opened a different project mid-turn — never
      // write this project's reply or error into another project's state.
      if (get().activeProjectId !== target) {
        return;
      }
      if (result.ok) {
        await cfg.commit([...sent, { role: 'persona', text: result.reply }], result);
      } else {
        cfg.fail(result.error ?? 'No response.');
      }
    } catch (err) {
      if (get().activeProjectId !== target) {
        return;
      }
      cfg.fail(err instanceof Error ? err.message : String(err));
    } finally {
      // Always clear the in-flight flag, even after a project switch — a
      // conditional clear here once wedged the Punch List + startBullpen forever.
      cfg.end();
    }
  };

  const h: Helpers = {
    schedulePersist,
    persistNow,
    scheduleProjectPersist,
    persistProjectNow,
    finishDanglingRun,
    cancelPendingSave,
    chatTurn,
  };
  const ctx: StoreCtx = { set, get, h };

  return {
    page: 'dashboard',
    hydrated: false,
    bootError: null,
    activeRunId: null,
    startFreshPitch: false,
    pendingNewProject: false,
    justOnboarded: false,
    startRipItFresh: false,
    pendingVenture: null,
    pendingTemplateId: null,
    pendingScaffoldId: null,
    pendingOverlayIds: [],
    theme: DEFAULT_THEME,
    namingMode: DEFAULT_NAMING_MODE,
    uiScale: DEFAULT_UI_SCALE,
    decryptedPortraits: {},
    appInfo: null,
    settings: createDefaultSettings(),
    settingsSaveState: 'idle',
    validationResults: {},
    isValidating: false,
    isValidatingProject: false,
    clis: [],
    isDetectingClis: false,
    cliUpdatingId: null,
    cliUpdateOutputs: {},
    projects: [],
    activeProjectId: null,
    activeProject: null,
    projectValidationResults: {},
    roomConversations: {},
    roomSendingRole: null,
    roomError: null,
    interventionConversations: {},
    interventionContexts: {},
    interventionSendingKey: null,
    interventionError: null,
    workRequestMessages: [],
    workRequestSending: false,
    workRequestError: null,
    whiteboardPlan: null,
    whiteboardDrafting: false,
    whiteboardError: null,
    bullpenCadence: 'afterEachTask',
    bullpenSecurityCadence: 'endOfPhase',
    bullpenOpsCadence: 'endOfProject',
    bullpenMode: 'autopilot',
    bullpenRunning: false,
    bullpenStopRequested: false,
    bullpenSteps: [],
    bullpenComplete: false,
    bullpenEscalated: false,
    bullpenStoppedAtCap: false,
    bullpenInterrupted: null,
    bullpenError: null,
    bullpenActivity: null,
    securityResult: null,
    securityRunning: false,
    garageTelemetry: null,
    garageInvocations: [],
    currentRunId: null,
    resumeFromRunId: null,
    runs: [],
    runsLoading: false,
    dashboardStats: null,
    dashboardStatsLoading: false,
    runDetail: null,
    runDetailLoading: false,

    ...createNavSlice(ctx),
    ...createSettingsSlice(ctx),
    ...createProjectsSlice(ctx),
    ...createConversationsSlice(ctx),
    ...createWhiteboardSlice(ctx),
    ...createBullpenSlice(ctx),
  };
});
