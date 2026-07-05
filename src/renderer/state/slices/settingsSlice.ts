import { clampUiScale } from '../../../shared/theme';
import { ALL_ROLE_IDS, ROLE_DEFINITIONS } from '../../../shared/roles';
import type { RoleId } from '../../../shared/roles';
import { assignmentFromPreset } from '../../../shared/cliAssignment';
import type { AppSettings } from '../../../shared/settings';
import type { RoleValidationResult } from '../../../shared/validation';
import type { AppState, StoreCtx } from '../appStoreShared';
import { applyThemeToDocument, applyUiScaleToDocument, hasBridge } from '../appStoreShared';
import { unlockTier as unlockVaultTierService } from '../../services/personaVault';

type SettingsSlice = Pick<
  AppState,
  | 'setTheme'
  | 'setNamingMode'
  | 'crackEgg'
  | 'unlockVaultTier'
  | 'setJianYangAwake'
  | 'setUiScale'
  | 'updateRoleConfig'
  | 'resetSettings'
  | 'validateTeam'
  | 'validateRole'
  | 'detectClis'
  | 'runCliUpdate'
  | 'seedRosterWithCli'
  | 'completeOnboarding'
  | 'finishOnboardingToTeam'
  | 'hydrate'
>;

/** Global settings (theme / naming / scale / roster), team validation, CLI tooling,
 *  onboarding, and the boot hydrate. */
export function createSettingsSlice({ set, get, h }: StoreCtx): SettingsSlice {
  const { schedulePersist, persistNow, cancelPendingSave } = h;
  return {
    detectClis: async () => {
      if (!hasBridge()) {
        return;
      }
      set({ isDetectingClis: true });
      try {
        const clis = await window.nucleus.cli.detectAll();
        set({ clis });
      } finally {
        set({ isDetectingClis: false });
      }
    },

    runCliUpdate: async (id) => {
      if (!hasBridge()) {
        return;
      }
      set({ cliUpdatingId: id });
      try {
        const result = await window.nucleus.cli.runUpdate(id);
        set({
          cliUpdateOutputs: {
            ...get().cliUpdateOutputs,
            [id]: { ok: result.ok, output: result.output },
          },
        });
        // Refresh the version after a successful update.
        const clis = await window.nucleus.cli.detectAll();
        set({ clis });
      } finally {
        set({ cliUpdatingId: null });
      }
    },

    seedRosterWithCli: async (presetId) => {
      const settings = get().settings;
      const roles = { ...settings.roles };
      // Seed every lifecycle-chain role (all of inDefaultChain, ops included) so a
      // single-CLI onboard fills the whole chain — which is also what
      // keeps "New Project" from gating a freshly-onboarded user (isDefaultTeamReady).
      // Each gets its own fresh assignment object — assignmentFromPreset clones per call.
      for (const roleId of ALL_ROLE_IDS) {
        if (ROLE_DEFINITIONS[roleId].inDefaultChain) {
          roles[roleId] = { ...roles[roleId], assignment: assignmentFromPreset(presetId) };
        }
      }
      // Persist FIRST, flip in-memory only on success — a swallowed write failure
      // here used to seed the roster only in memory (gone on restart) with no signal.
      const next: AppSettings = { ...settings, roles };
      try {
        await window.nucleus.settings.update(next);
        set({ settings: next });
        return true;
      } catch {
        return false;
      }
    },

    completeOnboarding: async () => {
      // Persist FIRST — flipping `onboarded` only in memory silently re-onboards
      // the user on the next launch. On failure the screen stays up with an error.
      const next: AppSettings = { ...get().settings, onboarded: true };
      try {
        await window.nucleus.settings.update(next);
        set({ settings: next });
        return true;
      } catch {
        return false;
      }
    },

    finishOnboardingToTeam: () =>
      set({ justOnboarded: true, page: 'team', activeRunId: null }),

    setTheme: (theme) => {
      applyThemeToDocument(theme);
      set({ theme, settings: { ...get().settings, theme } });
      schedulePersist();
    },

    setNamingMode: (namingMode) => {
      set({ namingMode, settings: { ...get().settings, namingMode } });
      schedulePersist();
    },

    crackEgg: (mode, answer) => {
      const settings = get().settings;
      const next: AppSettings = {
        ...settings,
        crackedEggs: settings.crackedEggs.includes(mode)
          ? settings.crackedEggs
          : [...settings.crackedEggs, mode],
        // Store the answer (the vault key) LOCALLY so the tier re-decrypts on the
        // next launch without re-solving — userData only, never the repo.
        crackedAnswers: { ...settings.crackedAnswers, [mode]: answer },
      };
      set({ settings: next });
      schedulePersist();
      // pete is always-open and has no vault; the three locked tiers decrypt now.
      if (mode !== 'pete') {
        void get().unlockVaultTier(mode, answer);
      }
    },

    unlockVaultTier: async (tier, answer) => {
      try {
        const urls = await unlockVaultTierService(tier, answer);
        if (Object.keys(urls).length > 0) {
          set({ decryptedPortraits: { ...get().decryptedPortraits, ...urls } });
        }
      } catch {
        // Best-effort: a wrong answer / missing blob just leaves initials.
      }
    },

    setJianYangAwake: (awake) => {
      set({ settings: { ...get().settings, jianYangAwake: awake } });
      schedulePersist();
    },

    setUiScale: (scale) => {
      const uiScale = clampUiScale(scale);
      applyUiScaleToDocument(uiScale);
      set({ uiScale, settings: { ...get().settings, uiScale } });
      schedulePersist();
    },

    updateRoleConfig: (roleId, patch) => {
      const settings = get().settings;
      const next: AppSettings = {
        ...settings,
        roles: {
          ...settings.roles,
          [roleId]: { ...settings.roles[roleId], ...patch },
        },
      };
      set({ settings: next });
      // Changing the assignment makes its last validation stale.
      if ('assignment' in patch) {
        const validationResults = { ...get().validationResults };
        delete validationResults[roleId];
        set({ validationResults });
      }
      schedulePersist();
    },

    resetSettings: async () => {
      if (!hasBridge()) {
        return;
      }
      cancelPendingSave();
      const settings = await window.nucleus.settings.reset();
      applyThemeToDocument(settings.theme);
      applyUiScaleToDocument(settings.uiScale);
      set({
        settings,
        theme: settings.theme,
        namingMode: settings.namingMode,
        uiScale: settings.uiScale,
        settingsSaveState: 'saved',
        validationResults: {},
      });
    },

    validateTeam: async () => {
      if (!hasBridge()) {
        return;
      }
      set({ isValidating: true });
      try {
        await persistNow();
        const results = await window.nucleus.validation.validateAll();
        const validationResults: Partial<Record<RoleId, RoleValidationResult>> = {};
        for (const result of results) {
          validationResults[result.roleId] = result;
        }
        set({ validationResults });
      } finally {
        set({ isValidating: false });
      }
    },

    validateRole: async (roleId) => {
      if (!hasBridge()) {
        return;
      }
      set({ isValidating: true });
      try {
        await persistNow();
        const result = await window.nucleus.validation.validateRole(roleId);
        set({ validationResults: { ...get().validationResults, [roleId]: result } });
      } finally {
        set({ isValidating: false });
      }
    },

    hydrate: async () => {
      if (!hasBridge()) {
        // No Electron bridge (tests / non-Electron context): nothing to load.
        set({ hydrated: true });
        return;
      }
      // Retry transient boot-read failures with backoff. A messy launch (the main
      // process mid-restart, a brief file lock from AV/cloud-sync, a Vite reconnect)
      // can make the first IPC call reject. Without a retry, hydrate() left `settings`
      // at the default `onboarded: false` and the app silently dropped an onboarded
      // user onto the OnboardingScreen with their projects hidden — the exact
      // "no project on startup" bug. Main is the source of truth and self-heals, so
      // we simply try again; only after exhausting retries do we surface a recoverable
      // error rather than presenting a failed read as a fresh install.
      const withRetry = async <T>(fn: () => Promise<T>, attempts = 6): Promise<T> => {
        let lastErr: unknown;
        for (let i = 0; i < attempts; i++) {
          try {
            return await fn();
          } catch (err) {
            lastErr = err;
            await new Promise((resolve) => setTimeout(resolve, 120 * (i + 1)));
          }
        }
        throw lastErr;
      };
      try {
        const settings = await withRetry(() => window.nucleus.settings.get());
        applyThemeToDocument(settings.theme);
        applyUiScaleToDocument(settings.uiScale);
        set({
          settings,
          theme: settings.theme,
          namingMode: settings.namingMode,
          uiScale: settings.uiScale,
        });
        // Re-open the image vault for any already-cracked tier (its answer is stored
        // locally), so previously-unlocked portrait art reappears without re-solving.
        // Fire-and-forget + best-effort — never blocks the boot.
        for (const mode of settings.crackedEggs) {
          const answer = settings.crackedAnswers?.[mode];
          if (answer && mode !== 'pete') {
            void get().unlockVaultTier(mode, answer);
          }
        }
        // appInfo is cosmetic (version string in the footer) — never let it block the
        // onboarding/shell decision; its own failure must not hide the project list.
        try {
          set({ appInfo: await window.nucleus.app.getInfo() });
        } catch {
          /* non-fatal */
        }
        // Boot clean: load the project list (so the Projects page + "Load a project"
        // on the home screen can show them) but do NOT auto-open the last-active
        // project. Only the app settings + Default Team roster persist across
        // restarts; the active project is chosen each session via "Load a project".
        // Auto-restoring the last project caused stale-state issues on launch.
        const { projects } = await withRetry(() => window.nucleus.project.list());
        set({ projects, activeProject: null, activeProjectId: null, bootError: null });
      } catch (err) {
        // All retries exhausted: do NOT silently present onboarding/empty over real
        // data. Surface a recoverable error so the user can retry instead of being
        // re-onboarded on top of an existing, healthy profile.
        set({ bootError: err instanceof Error ? err.message : String(err) });
      } finally {
        // Always resolve the boot splash (App.tsx gates first paint on this) so we
        // never hang on a blank splash.
        set({ hydrated: true });
      }
    },
  };
}
