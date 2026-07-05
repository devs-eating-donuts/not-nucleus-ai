import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { IpcChannels } from '../../shared/ipc';
import { META_DIR } from '../../shared/markdown';
import type {
  FactoryResetResult,
  OpenProjectResult,
  ProjectCreateResult,
  ProjectExportResult,
  ProjectTeam,
} from '../../shared/project';
import type { ExportRoom } from '../../shared/projectExport';
import {
  buildProjectExportMarkdown,
  safeExportFileName,
  uniqueExportFileName,
} from '../../shared/projectExport';
import { effectivePersonaName } from '../../shared/personas';
import { ALL_ROLE_IDS, isRoleId } from '../../shared/roles';
import {
  NO_INSTALL,
  NO_SCAFFOLD,
  getScaffolder,
  type InstallOutcome,
  type ScaffoldOutcome,
} from '../../shared/scaffold';
import { isDeploymentPosture } from '../../shared/decisions';
import {
  appendBacklogItem,
  initializeWorkspace,
  readMarkdown,
  readProjectInfo,
  readWorkspaceMarker,
  updateProjectInfo,
} from '../services/markdownWorkspace';
import { validateRoleConfiguration } from '../services/cliValidator';
import { initWorkspaceRepo } from '../services/gitTracker';
import { runInstall, runScaffolder } from '../services/scaffolder';
import { clearInstallState, getInstallState, setInstallState } from '../services/installTracker';
import { clearInvocationLog } from '../services/invocationLog';
import { lessonsStore } from '../services/lessonsStore';
import { projectRegistryStore } from '../services/projectRegistryStore';
import { readRoomLog } from '../services/roomEngine';
import { readWorkRequestLog } from '../services/workRequestEngine';
import { readProjectTeam, seedProjectTeam, writeProjectTeam } from '../services/projectTeamStore';
import { assertSafeToDeleteFolder, within } from '../services/projectDeletion';
import { settingsStore } from '../services/settingsStore';
import { validateWorkspace } from '../services/workspaceValidator';
import {
  docPathForKey,
  requireProjectId,
  requireString,
  sanitizeNamingMode,
  sanitizeNewProjectInput,
} from './projectInputValidation';

/**
 * Project IPC: folder selection, workspace creation, and the project
 * registry (list/open/remove) + per-project team. The renderer never
 * touches the filesystem — it sends intent, main validates and acts.
 */


/** Read a project's four lifecycle-room transcripts for export (some may be empty). */
async function readProjectRooms(workspacePath: string): Promise<ExportRoom[]> {
  const [stakeholder, projectLead, architect, punch] = await Promise.all([
    readRoomLog(workspacePath, 'stakeholder'),
    readRoomLog(workspacePath, 'projectLead'),
    readRoomLog(workspacePath, 'architect'),
    readWorkRequestLog(workspacePath),
  ]);
  return [
    { roleId: 'stakeholder', title: 'The Pitch', messages: stakeholder },
    { roleId: 'projectLead', title: 'Investor Pitch', messages: projectLead },
    { roleId: 'architect', title: 'The Whiteboard', messages: architect },
    { roleId: 'architect', title: 'The Punch List', messages: punch },
  ];
}

export function registerProjectHandlers(): void {
  ipcMain.handle(IpcChannels.dialogSelectFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Select Project Folder',
      buttonLabel: 'Use This Folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle(
    IpcChannels.projectCreate,
    async (_event, value: unknown): Promise<ProjectCreateResult> => {
      const input = sanitizeNewProjectInput(value);
      // Scaffold a real, runnable base app into the (empty) project root FIRST, so the
      // app IS the project and Nucleus's files overlay on top (initializeWorkspace is
      // additive and MERGES .gitignore). Best-effort: a cancel/failure is recorded and
      // the project is still created (team builds from scratch). The renderer passes only
      // a known catalog id; the enumerated command comes from SCAFFOLDERS — no renderer
      // free-text on argv. Most scaffolders need an empty dir, so this runs before any seed.
      const scaffolder = getScaffolder(input.scaffoldId);
      let scaffold: ScaffoldOutcome = NO_SCAFFOLD;
      let install: InstallOutcome = NO_INSTALL;
      if (scaffolder) {
        const root = path.resolve(input.workspacePath);
        await fs.mkdir(root, { recursive: true });
        scaffold = await runScaffolder(root, scaffolder);
      }
      const report = await initializeWorkspace(input);
      // Seed this project's team from the global default roster, but apply
      // the wizard's role selection to each role's `enabled` flag so the
      // new project reflects what the user actually chose. Read settings FRESH
      // from disk — a stale main-process cache would seed empty CLI assignments.
      const settings = await settingsStore.getFresh();
      const roster = {} as ProjectTeam;
      for (const roleId of ALL_ROLE_IDS) {
        // "Rip it and Ship It" express projects seat ONLY Erlich (stakeholder) +
        // Dinesh (developer); every other seat is left unassigned so the Bullpen's
        // review gates (architect / security / ops) honestly skip — no Monica,
        // Richard, Big Head, or Gilfoyle on the express lane.
        const blankForRipIt =
          input.ripIt === true && roleId !== 'stakeholder' && roleId !== 'developer';
        roster[roleId] = {
          ...settings.roles[roleId],
          assignment: blankForRipIt ? null : settings.roles[roleId].assignment,
          enabled: blankForRipIt ? false : input.enabledRoles.includes(roleId),
        };
      }
      const team = await seedProjectTeam(report.project.workspacePath, roster);
      // Version-control the project from the start: `git init` on a local `main` +
      // an initial scaffold commit (best-effort; no-op when tracking is off / git is
      // missing / it's already a repo). Runs after the team + agent pack + the generated
      // base app are written so the first commit captures the whole scaffold + overlay.
      await initWorkspaceRepo(report.project.workspacePath, input.gitTracking !== false);
      // Register it and make it active. Use the workspace's app-created marker id
      // as the registry id so deletion can later require a matching marker before
      // trashing the folder (falls back to a fresh uuid if the marker is missing).
      const markerId = (await readWorkspaceMarker(report.project.workspacePath))?.id;
      const entry = await projectRegistryStore.upsert({
        id: markerId ?? randomUUID(),
        name: report.project.projectName,
        workspacePath: report.project.workspacePath,
        createdAt: report.project.createdAt,
        lastOpenedAt: new Date().toISOString(),
        ventureId: report.project.ventureId,
        ventureName: report.project.ventureName,
      });
      await projectRegistryStore.setActive(entry.id);
      // Install the scaffolded app's dependencies in the BACKGROUND (npm install / dotnet
      // restore is 1–3 min) so create returns immediately instead of blocking the pitch
      // spinner. The renderer polls `project:install-status` for the running → done flip.
      // Best-effort: runInstall never throws; the .catch is belt-and-suspenders. Started
      // AFTER the initial git commit so a half-written package-lock can't land in it.
      if (scaffolder && scaffold.ok) {
        install = { attempted: true, ok: false, error: null, pending: true };
        setInstallState(entry.id, install);
        void runInstall(report.project.workspacePath, scaffolder)
          .then((outcome) => setInstallState(entry.id, outcome))
          .catch((err) =>
            setInstallState(entry.id, {
              attempted: true,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              pending: false,
            }),
          );
      }
      const validation = await validateWorkspace(report.project.workspacePath);
      return { ...report, validation, registry: entry, team, scaffold, install };
    },
  );

  // Poll target for the background dependency install (see project:create). Returns the
  // current install state for a project id, or the inert no-op when none is tracked.
  ipcMain.handle(IpcChannels.projectInstallStatus, async (_event, value: unknown): Promise<InstallOutcome> => {
    const id = requireProjectId(value);
    return getInstallState(id) ?? NO_INSTALL;
  });

  ipcMain.handle(IpcChannels.projectList, async () => projectRegistryStore.list());

  ipcMain.handle(
    IpcChannels.projectOpen,
    async (_event, value: unknown): Promise<OpenProjectResult> => {
      const id = requireProjectId(value);
      const entry = await projectRegistryStore.get(id);
      if (!entry) {
        throw new Error(`Unknown project id: ${id}`);
      }
      const touched = await projectRegistryStore.touch(id, new Date().toISOString());
      const info =
        (await readProjectInfo(entry.workspacePath)) ?? {
          projectName: entry.name,
          workspacePath: entry.workspacePath,
          createdAt: entry.createdAt,
        };
      const team = await readProjectTeam(entry.workspacePath);
      const validation = await validateWorkspace(entry.workspacePath);
      return { registry: touched ?? entry, info, team, validation };
    },
  );

  ipcMain.handle(IpcChannels.projectDelete, async (event, value: unknown) => {
    if (value === null || typeof value !== 'object') {
      throw new Error('project:delete expects { id, deleteFolder }');
    }
    const { id, deleteFolder } = value as { id?: unknown; deleteFolder?: unknown };
    const entry = await projectRegistryStore.get(requireProjectId(id));
    if (!entry) {
      throw new Error('Unknown project id');
    }
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;

    if (deleteFolder === true) {
      // 1. Guard (Electron-free, throws if unsafe) keyed to this project's marker.
      await assertSafeToDeleteFolder(entry.workspacePath, entry.id);
      // 2. Un-fakeable native confirmation (a compromised renderer can't skip it).
      const confirmOpts: Electron.MessageBoxOptions = {
        type: 'warning',
        buttons: ['Move to Trash', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Delete project folder',
        message: `Move "${entry.name}" to the Trash?`,
        detail: `This moves the entire project folder — code and all — to your system Trash (recoverable):\n\n${entry.workspacePath}`,
      };
      const confirm = win
        ? await dialog.showMessageBox(win, confirmOpts)
        : await dialog.showMessageBox(confirmOpts);
      if (confirm.response !== 0) {
        const list = await projectRegistryStore.list();
        return { ...list, folderDeleted: false, cancelled: true };
      }
      // 3. Reversible: move to OS trash, never a hard recursive delete.
      await shell.trashItem(path.resolve(entry.workspacePath));
      await projectRegistryStore.remove(entry.id);
      clearInstallState(entry.id);
      const list = await projectRegistryStore.list();
      return { ...list, folderDeleted: true, cancelled: false };
    }

    // Data-only: trash just the .nucleus app data; user files stay on disk.
    await shell.trashItem(path.resolve(entry.workspacePath, META_DIR)).catch(() => undefined);
    await projectRegistryStore.remove(entry.id);
    clearInstallState(entry.id);
    const list = await projectRegistryStore.list();
    return { ...list, folderDeleted: false, cancelled: false };
  });

  // Export a project's saved conversations to a Markdown file the user picks.
  ipcMain.handle(IpcChannels.projectExport, async (event, value): Promise<ProjectExportResult> => {
    const { id, namingMode } = (value ?? {}) as { id?: unknown; namingMode?: unknown };
    const entry = await projectRegistryStore.get(requireProjectId(id));
    if (!entry) {
      throw new Error('Unknown project id');
    }
    const info = await readProjectInfo(entry.workspacePath).catch(() => null);
    const markdown = buildProjectExportMarkdown(
      {
        projectName: entry.name,
        createdAt: entry.createdAt,
        workspacePath: entry.workspacePath,
        templateId: info?.templateId ?? null,
        exportedAt: new Date().toISOString(),
        rooms: await readProjectRooms(entry.workspacePath),
      },
      sanitizeNamingMode(namingMode),
    );
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const saveOpts: Electron.SaveDialogOptions = {
      title: 'Export project conversations',
      // Default OUTSIDE the workspace (Documents) so the export doesn't land in the
      // folder it's meant to survive; fall back to a bare filename if there's no Documents.
      defaultPath: path.join(
        app.getPath('documents') || '',
        `${safeExportFileName(entry.name)}-nucleus-export.md`,
      ),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    };
    const res = win
      ? await dialog.showSaveDialog(win, saveOpts)
      : await dialog.showSaveDialog(saveOpts);
    if (res.canceled || !res.filePath) {
      return { ok: false, path: null, cancelled: true, error: null };
    }
    // Refuse a path inside the project folder — it would be trashed with the folder,
    // silently defeating the export-before-delete promise. Case-insensitive (NTFS) via
    // the shared containment helper, so a differently-cased path can't slip the guard.
    const chosen = path.resolve(res.filePath);
    if (within(entry.workspacePath, chosen)) {
      return {
        ok: false,
        path: null,
        cancelled: false,
        error: 'Save the export OUTSIDE the project folder, so it survives deleting the folder.',
      };
    }
    try {
      await fs.writeFile(chosen, markdown, 'utf8');
      return { ok: true, path: chosen, cancelled: false, error: null };
    } catch (err) {
      return { ok: false, path: null, cancelled: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Factory reset: optionally export chosen projects, then move every project folder
  // to the Trash (guard-permitting) and erase all Nucleus history + settings.
  ipcMain.handle(IpcChannels.projectFactoryReset, async (event, value): Promise<FactoryResetResult> => {
    const { exportIds, namingMode } = (value ?? {}) as { exportIds?: unknown; namingMode?: unknown };
    const ids = Array.isArray(exportIds) ? exportIds.filter((x): x is string => typeof x === 'string') : [];
    const mode = sanitizeNamingMode(namingMode);
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const { projects } = await projectRegistryStore.list();

    // 1. Export the selected projects into a chosen folder. Cancel here aborts the
    // whole reset — nothing is deleted, so the user never loses an un-exported project.
    let exported = 0;
    let exportFailed = 0;
    const toExport = projects.filter((p) => ids.includes(p.id));
    if (toExport.length > 0) {
      const dirRes = win
        ? await dialog.showOpenDialog(win, {
            title: 'Choose a folder to export projects into',
            properties: ['openDirectory', 'createDirectory'],
          })
        : await dialog.showOpenDialog({
            title: 'Choose a folder to export projects into',
            properties: ['openDirectory', 'createDirectory'],
          });
      if (dirRes.canceled || dirRes.filePaths.length === 0) {
        return { ok: false, cancelled: true, report: null, error: null };
      }
      const folder = dirRes.filePaths[0];
      // The export folder must NOT sit inside (or equal) any project workspace — step 3
      // trashes those folders, which would destroy the exports we're writing here. Reject
      // and abort the whole reset (nothing deleted) rather than write doomed exports.
      if (projects.some((p) => within(p.workspacePath, folder))) {
        return {
          ok: false,
          cancelled: false,
          report: null,
          error:
            'Choose an export folder OUTSIDE every project folder — those folders are moved to the Trash by the reset.',
        };
      }
      // De-dup filenames within the chosen folder so projects whose names slug-collide
      // (e.g. "Social Watch" / "social.watch") don't silently overwrite each other.
      // SEED from the folder's existing files so a re-run into the same folder doesn't
      // clobber a prior export either (uniqueExportFileName then suffixes -2/-3…).
      const usedNames = new Set<string>();
      const existing = await fs.readdir(folder).catch(() => [] as string[]);
      for (const f of existing) {
        usedNames.add(f.toLowerCase());
      }
      for (const p of toExport) {
        try {
          const info = await readProjectInfo(p.workspacePath).catch(() => null);
          const markdown = buildProjectExportMarkdown(
            {
              projectName: p.name,
              createdAt: p.createdAt,
              workspacePath: p.workspacePath,
              templateId: info?.templateId ?? null,
              exportedAt: new Date().toISOString(),
              rooms: await readProjectRooms(p.workspacePath),
            },
            mode,
          );
          const fileName = uniqueExportFileName(p.name, usedNames);
          await fs.writeFile(path.join(folder, fileName), markdown, 'utf8');
          exported += 1;
        } catch {
          // A write failure (unwritable/full folder) must not silently let a project be
          // trashed un-exported — count it and warn the user in the confirm below.
          exportFailed += 1;
        }
      }
    }

    // 2. Un-fakeable native confirmation for the nuclear reset. If any requested export
    // FAILED, say so loudly — the user makes the irreversible choice with accurate info.
    const exportLine =
      exportFailed > 0
        ? `\n\n⚠ ${exportFailed} of ${toExport.length} selected project(s) could NOT be exported ` +
          `(the chosen folder may be unwritable). If you continue, they are moved to the Trash anyway.`
        : exported > 0
          ? `\n\n${exported} project(s) were exported first.`
          : '';
    const confirmOpts: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['Factory reset', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Factory reset Nucleus-AI',
      message: 'Reset Nucleus-AI to a fresh install?',
      detail:
        `This moves all ${projects.length} project folder(s) to the Trash (recoverable) and erases ` +
        `all Nucleus history AND settings — your Default Team / CLI assignments included. ` +
        `You will re-onboard like a new install.` +
        exportLine,
    };
    const confirm = win
      ? await dialog.showMessageBox(win, confirmOpts)
      : await dialog.showMessageBox(confirmOpts);
    if (confirm.response !== 0) {
      return { ok: false, cancelled: true, report: null, error: null };
    }

    // 3. Per project: trash the whole folder where the guard allows it; otherwise trash
    // only its .nucleus and leave the folder (it holds user content / lacks a marker).
    // The guard check and the trash are separate so a trash failure isn't misreported
    // as a deliberate "guard refused" keep.
    let foldersTrashed = 0;
    let foldersKept = 0;
    let trashFailed = 0;
    for (const p of projects) {
      let guardAllows = false;
      try {
        await assertSafeToDeleteFolder(p.workspacePath, p.id);
        guardAllows = true;
      } catch {
        guardAllows = false;
      }
      if (guardAllows) {
        try {
          await shell.trashItem(path.resolve(p.workspacePath));
          foldersTrashed += 1;
        } catch {
          // Guard approved, but the OS Trash call failed (e.g. a file is open/locked).
          await shell.trashItem(path.resolve(p.workspacePath, META_DIR)).catch(() => undefined);
          trashFailed += 1;
        }
      } else {
        await shell.trashItem(path.resolve(p.workspacePath, META_DIR)).catch(() => undefined);
        foldersKept += 1;
      }
    }

    // 4. Erase all app history and reset settings to defaults (fresh install → re-onboard).
    await projectRegistryStore.clear();
    await lessonsStore.clear();
    await clearInvocationLog();
    await settingsStore.reset();
    await fs.rm(path.join(app.getPath('userData'), 'preferences.json'), { force: true }).catch(() => undefined);

    return {
      ok: true,
      cancelled: false,
      report: {
        projectsRemoved: projects.length,
        foldersTrashed,
        foldersKept,
        trashFailed,
        exported,
        exportFailed,
        settingsReset: true,
      },
      error: null,
    };
  });

  ipcMain.handle(IpcChannels.projectUpdateTeam, async (_event, value: unknown) => {
    if (value === null || typeof value !== 'object') {
      throw new Error('project:update-team expects { id, roles }');
    }
    const { id, roles } = value as { id?: unknown; roles?: unknown };
    const entry = await projectRegistryStore.get(requireProjectId(id));
    if (!entry) {
      throw new Error('Unknown project id');
    }
    return writeProjectTeam(entry.workspacePath, roles);
  });

  ipcMain.handle(IpcChannels.projectSetDeploymentPosture, async (_event, value: unknown) => {
    if (value === null || typeof value !== 'object') {
      throw new Error('project:set-deployment-posture expects { id, posture }');
    }
    const { id, posture } = value as { id?: unknown; posture?: unknown };
    const entry = await projectRegistryStore.get(requireProjectId(id));
    if (!entry) {
      throw new Error('Unknown project id');
    }
    // Clamp to a known posture; anything else clears it (team falls back to a strict default).
    const clean = isDeploymentPosture(posture) ? posture : undefined;
    const info = await updateProjectInfo(entry.workspacePath, { deploymentPosture: clean });
    if (!info) {
      throw new Error('Could not update the project (its current-run.json is missing).');
    }
    return info;
  });

  ipcMain.handle(IpcChannels.projectAddBacklog, async (_event, value: unknown) => {
    if (value === null || typeof value !== 'object') {
      throw new Error('project:add-backlog expects { id, text }');
    }
    const { id, text } = value as { id?: unknown; text?: unknown };
    const entry = await projectRegistryStore.get(requireProjectId(id));
    if (!entry) {
      throw new Error('Unknown project id');
    }
    await appendBacklogItem(entry.workspacePath, requireString(text, 'Backlog item', 2000), new Date().toISOString());
  });

  // Read a KNOWN workspace doc for a read-only renderer panel. Keyed to a fixed allow-list —
  // no renderer free-text path ever reaches the filesystem (workspace boundary intact). Both
  // of these were write-only until now: the findings backlog (engine-written; the "triage via
  // The Punch List" surface) and the project backlog (the "Add to backlog" form's destination).
  ipcMain.handle(IpcChannels.projectReadDoc, async (_event, value: unknown): Promise<string | null> => {
    if (value === null || typeof value !== 'object') {
      throw new Error('project:read-doc expects { id, key }');
    }
    const { id, key } = value as { id?: unknown; key?: unknown };
    const rel = docPathForKey(key);
    if (!rel) {
      return null; // unknown key → nothing (never an arbitrary path)
    }
    const entry = await projectRegistryStore.get(requireProjectId(id));
    if (!entry) {
      throw new Error('Unknown project id');
    }
    return readMarkdown(entry.workspacePath, rel).catch(() => null);
  });

  ipcMain.handle(IpcChannels.projectValidateTeam, async (_event, value: unknown) => {
    const id = requireProjectId(value);
    const entry = await projectRegistryStore.get(id);
    if (!entry) {
      throw new Error('Unknown project id');
    }
    const team = await readProjectTeam(entry.workspacePath);
    const settings = await settingsStore.get();
    return Promise.all(
      ALL_ROLE_IDS.map((roleId) => {
        const cfg = team[roleId];
        const displayName = effectivePersonaName(roleId, cfg.personaNameOverride, settings.namingMode);
        return validateRoleConfiguration(cfg, displayName);
      }),
    );
  });

  ipcMain.handle(IpcChannels.projectValidateRole, async (_event, value: unknown) => {
    if (value === null || typeof value !== 'object') {
      throw new Error('project:validate-role expects { id, roleId }');
    }
    const { id, roleId } = value as { id?: unknown; roleId?: unknown };
    if (!isRoleId(roleId)) {
      throw new Error(`project:validate-role received an unknown role id: ${String(roleId)}`);
    }
    const entry = await projectRegistryStore.get(requireProjectId(id));
    if (!entry) {
      throw new Error('Unknown project id');
    }
    const team = await readProjectTeam(entry.workspacePath);
    const settings = await settingsStore.get();
    const cfg = team[roleId];
    const displayName = effectivePersonaName(roleId, cfg.personaNameOverride, settings.namingMode);
    return validateRoleConfiguration(cfg, displayName);
  });

  ipcMain.handle(IpcChannels.workspaceValidate, async (_event, value: unknown) => {
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
      throw new Error('workspace:validate expects an absolute workspace path');
    }
    // Only validate workspaces that belong to a registered project — don't let the
    // (untrusted) renderer probe arbitrary directories, matching how every other
    // project handler resolves paths through the registry rather than raw input.
    const { projects } = await projectRegistryStore.list();
    const target = path.resolve(value);
    if (!projects.some((p) => path.resolve(p.workspacePath) === target)) {
      throw new Error('Unknown workspace');
    }
    const stat = await fs.stat(value).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new Error('Workspace path does not exist or is not a directory');
    }
    return validateWorkspace(value);
  });
}
