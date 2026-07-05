import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { isRoleId } from '../../shared/roles';
import type {
  TerminalMode,
  TerminalSessionDescriptor,
  TerminalStartInput,
  TerminalStartResult,
} from '../../shared/terminal';
import { projectRegistryStore } from '../services/projectRegistryStore';
import { readProjectTeam } from '../services/projectTeamStore';
import {
  killTerminal,
  listTerminals,
  resizeTerminal,
  resolveAssignment,
  startTerminal,
  writeTerminal,
} from '../services/terminalManager';

/**
 * Terminal IPC. The renderer is untrusted: it names a project id + role + mode,
 * and the main process resolves the real workspace path and CLI command from
 * the registry/team on disk. Keystroke/resize/kill use ipcMain.on (fire-and-
 * forget) for low-latency streaming; start/list use ipcMain.handle.
 */

function asMode(value: unknown): TerminalMode | null {
  return value === 'cli' || value === 'shell' ? value : null;
}

function toInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
}

export function registerTerminalHandlers(): void {
  ipcMain.handle(
    IpcChannels.terminalStart,
    async (event, value: unknown): Promise<TerminalStartResult> => {
      const raw = (value ?? {}) as Partial<TerminalStartInput>;
      const mode = asMode(raw.mode);
      if (!mode) {
        return { ok: false, error: 'A terminal mode (cli | shell) is required.' };
      }
      if (!isRoleId(raw.roleId)) {
        return { ok: false, error: `Unknown role id: ${String(raw.roleId)}` };
      }
      const projectId = typeof raw.projectId === 'string' ? raw.projectId.trim() : '';

      // First-run onboarding has no project yet but needs a shell to run install
      // + login commands. Allow shell mode with an empty project id: it opens the
      // OS shell in the user's home dir, resolves no CLI and reads no project team,
      // so the renderer still can't choose an arbitrary cwd or command.
      if (mode === 'shell' && projectId === '') {
        const onboardingInput: TerminalStartInput = {
          projectId: '',
          roleId: raw.roleId,
          mode,
          cols: toInt(raw.cols, 80),
          rows: toInt(raw.rows, 24),
        };
        return startTerminal(
          onboardingInput,
          {
            workspacePath: app.getPath('home'),
            cliName: '',
            resolvedCommand: null,
            resolveError: null,
            env: {},
          },
          event.sender,
        );
      }

      if (projectId === '') {
        return { ok: false, error: 'A project id is required.' };
      }
      const entry = await projectRegistryStore.get(projectId);
      if (!entry) {
        return { ok: false, error: 'Unknown project id.' };
      }

      const input: TerminalStartInput = {
        projectId,
        roleId: raw.roleId,
        mode,
        cols: toInt(raw.cols, 80),
        rows: toInt(raw.rows, 24),
      };

      // For cli mode, resolve the role's assigned CLI from the team on disk.
      let resolvedCommand: string | null = null;
      let resolveError: string | null = null;
      let cliName = '';
      let env: Record<string, string> = {};
      if (mode === 'cli') {
        const team = await readProjectTeam(entry.workspacePath);
        const assignment = team[input.roleId]?.assignment ?? null;
        cliName = assignment?.cliName ?? '';
        env = assignment?.env ?? {};
        const resolution = await resolveAssignment(assignment);
        resolvedCommand = resolution.resolved;
        resolveError = resolution.error;
      }

      return startTerminal(
        input,
        { workspacePath: entry.workspacePath, cliName, resolvedCommand, resolveError, env },
        event.sender,
      );
    },
  );

  ipcMain.handle(
    IpcChannels.terminalList,
    async (event, projectId: unknown): Promise<TerminalSessionDescriptor[]> => {
      // Scoped to the caller's own sessions in this project — never the global list.
      return typeof projectId === 'string' ? listTerminals(projectId, event.sender) : [];
    },
  );

  // Control verbs pass event.sender so the manager can reject a session the caller
  // doesn't own (a second window / compromised renderer can't drive another's PTY).
  ipcMain.on(IpcChannels.terminalInput, (event, value: unknown) => {
    const { sessionId, data } = (value ?? {}) as { sessionId?: unknown; data?: unknown };
    if (typeof sessionId === 'string' && typeof data === 'string') {
      writeTerminal(sessionId, data, event.sender);
    }
  });

  ipcMain.on(IpcChannels.terminalResize, (event, value: unknown) => {
    const { sessionId, cols, rows } = (value ?? {}) as {
      sessionId?: unknown;
      cols?: unknown;
      rows?: unknown;
    };
    if (typeof sessionId === 'string') {
      resizeTerminal(sessionId, toInt(cols, 80), toInt(rows, 24), event.sender);
    }
  });

  ipcMain.on(IpcChannels.terminalKill, (event, value: unknown) => {
    const { sessionId } = (value ?? {}) as { sessionId?: unknown };
    if (typeof sessionId === 'string') {
      killTerminal(sessionId, event.sender);
    }
  });
}
