import type { ProjectTeam } from '../../../shared/project';
import type { RoleId } from '../../../shared/roles';
import type { RoleValidationResult } from '../../../shared/validation';
import type { AppState, StoreCtx } from '../appStoreShared';
import { CLEARED_PROJECT_STATE, hasBridge } from '../appStoreShared';

type ProjectsSlice = Pick<
  AppState,
  | 'createProject'
  | 'loadProjects'
  | 'openProject'
  | 'deleteProject'
  | 'exportProject'
  | 'factoryReset'
  | 'updateProjectRoleConfig'
  | 'addBacklogItem'
  | 'validateActiveProjectTeam'
  | 'validateActiveProjectRole'
>;

// Monotonic token so a slow in-flight open() can't commit stale state over a newer
// project switch. Only openProject uses it, so it lives with the slice.
let openToken = 0;

/** The project lifecycle: create / open / delete / export / factory-reset + project-team edits. */
export function createProjectsSlice({ set, get, h }: StoreCtx): ProjectsSlice {
  const { persistProjectNow, scheduleProjectPersist, finishDanglingRun } = h;
  return {
    createProject: async (input) => {
      if (!hasBridge()) {
        throw new Error('Project creation requires the desktop app.');
      }
      await persistProjectNow();
      // The new project seeds its team from the GLOBAL roster in the main
      // process. Flush the roster the user actually sees to disk first, so the
      // project never inherits empty CLI assignments from a stale main cache.
      await window.nucleus.settings.update(get().settings);
      const report = await window.nucleus.project.create(input);
      // Guarantee the project's OWN team carries the CLIs you see on the Default
      // Team. The pitch/rooms read the project team, not the global one — so if
      // the seed came back missing any assignment (stale cache, or an existing
      // empty team.json), write the merged roster to the project.
      let team = report.team;
      const globalRoles = get().settings.roles;
      // For a Rip-it project only the stakeholder + developer seats should carry a
      // CLI — every other seat is deliberately blank so the review gates skip. So the
      // stale-cache repair only ever fills THOSE seats here; merging all of them back
      // would undo the blanking and wake up Richard/Gilfoyle/etc.
      const repairRoles: RoleId[] = input.ripIt
        ? (['stakeholder', 'developer'] as RoleId[])
        : (Object.keys(team) as RoleId[]);
      const missing = repairRoles.some(
        (r) => globalRoles[r].assignment && !team[r].assignment,
      );
      if (missing) {
        const merged = { ...team };
        for (const r of repairRoles) {
          merged[r] = { ...merged[r], assignment: globalRoles[r].assignment };
        }
        team = await window.nucleus.project.updateTeam(report.registry.id, merged);
      }
      finishDanglingRun();
      set({
        activeProject: {
          registry: report.registry,
          info: report.project,
          team,
          validation: report.validation,
        },
        activeProjectId: report.registry.id,
        ...CLEARED_PROJECT_STATE,
        pendingNewProject: false,
        pendingVenture: null,
        pendingTemplateId: null,
        pendingScaffoldId: null,
        pendingOverlayIds: [],
      });
      await get().loadProjects();
      return report;
    },

    loadProjects: async () => {
      if (!hasBridge()) {
        return;
      }
      const { projects, activeProjectId } = await window.nucleus.project.list();
      set({ projects, activeProjectId });
      // Open the active project on first load so the app reflects it.
      if (activeProjectId && get().activeProject?.registry.id !== activeProjectId) {
        await get().openProject(activeProjectId);
      }
    },

    openProject: async (id) => {
      if (!hasBridge()) {
        return;
      }
      // Flush any pending edit to the outgoing project before switching.
      await persistProjectNow();
      openToken += 1;
      const token = openToken;
      const result = await window.nucleus.project.open(id);
      // A newer open() superseded this one (rapid project switching) — drop the
      // stale result so it can't overwrite the project the user actually wants.
      if (token !== openToken) {
        return;
      }
      // Re-opening the ALREADY-ACTIVE project (the Projects page's Open button on the
      // active card) must not sever its paused manual run — no dangling-run finish, and
      // the open-run handle survives the state reset so the next Bullpen click continues
      // the same record instead of splitting the session into two Run History rows.
      const sameProject = result.registry.id === get().activeProjectId;
      if (!sameProject) {
        finishDanglingRun();
      }
      set({
        activeProject: {
          registry: result.registry,
          info: result.info,
          team: result.team,
          validation: result.validation,
        },
        activeProjectId: result.registry.id,
        ...CLEARED_PROJECT_STATE,
        ...(sameProject
          ? { currentRunId: get().currentRunId, resumeFromRunId: get().resumeFromRunId }
          : {}),
        pendingNewProject: false,
        pendingVenture: null,
        pendingTemplateId: null,
        pendingScaffoldId: null,
        pendingOverlayIds: [],
      });
      const { projects, activeProjectId } = await window.nucleus.project.list();
      set({ projects, activeProjectId });
    },

    deleteProject: async (id, deleteFolder) => {
      if (!hasBridge()) {
        return { folderDeleted: false };
      }
      await persistProjectNow();
      const wasActive = get().activeProject?.registry.id === id;
      const { projects, activeProjectId, folderDeleted, cancelled } =
        await window.nucleus.project.delete(id, deleteFolder);
      // The user dismissed the native confirmation — nothing changed on disk.
      if (cancelled) {
        return { folderDeleted: false };
      }
      set({
        projects,
        activeProjectId,
        // If the active project was deleted, wipe all of its derived state.
        ...(wasActive ? { activeProject: null, ...CLEARED_PROJECT_STATE } : {}),
      });
      return { folderDeleted };
    },

    exportProject: async (id) => {
      if (!hasBridge()) {
        return { ok: false, path: null, cancelled: true, error: null };
      }
      return window.nucleus.project.export(id, get().namingMode);
    },

    factoryReset: async (exportIds) => {
      if (!hasBridge()) {
        return { ok: false, cancelled: true, report: null, error: null };
      }
      const result = await window.nucleus.project.factoryReset(exportIds, get().namingMode);
      if (result.ok) {
        // Back to a fresh install: drop all derived project state, then re-hydrate —
        // settings are now defaults (onboarded false → the onboarding screen) and the
        // project list is empty. Land on the home page for when re-onboarding finishes.
        set({
          activeProject: null,
          activeProjectId: null,
          projects: [],
          ...CLEARED_PROJECT_STATE,
          validationResults: {},
          pendingNewProject: false,
          page: 'dashboard',
        });
        await get().hydrate();
      }
      return result;
    },

    updateProjectRoleConfig: (roleId, patch) => {
      const active = get().activeProject;
      if (!active) {
        return;
      }
      const team: ProjectTeam = {
        ...active.team,
        [roleId]: { ...active.team[roleId], ...patch },
      };
      set({ activeProject: { ...active, team } });
      // A changed assignment invalidates that role's last validation.
      if ('assignment' in patch) {
        const projectValidationResults = { ...get().projectValidationResults };
        delete projectValidationResults[roleId];
        set({ projectValidationResults });
      }
      scheduleProjectPersist();
    },

    addBacklogItem: async (text) => {
      const active = get().activeProject;
      if (!active || !hasBridge() || text.trim() === '') {
        return;
      }
      await window.nucleus.project.addBacklog(active.registry.id, text.trim());
    },

    validateActiveProjectTeam: async () => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      const target = active.registry.id;
      set({ isValidatingProject: true });
      try {
        await persistProjectNow();
        const results = await window.nucleus.project.validateTeam(target);
        if (get().activeProjectId !== target) {
          return;
        }
        const projectValidationResults: Partial<Record<RoleId, RoleValidationResult>> = {};
        for (const result of results) {
          projectValidationResults[result.roleId] = result;
        }
        set({ projectValidationResults });
      } finally {
        set({ isValidatingProject: false });
      }
    },

    validateActiveProjectRole: async (roleId) => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      const target = active.registry.id;
      set({ isValidatingProject: true });
      try {
        await persistProjectNow();
        const result = await window.nucleus.project.validateRole(target, roleId);
        if (get().activeProjectId !== target) {
          return;
        }
        set({
          projectValidationResults: { ...get().projectValidationResults, [roleId]: result },
        });
      } finally {
        set({ isValidatingProject: false });
      }
    },
  };
}
