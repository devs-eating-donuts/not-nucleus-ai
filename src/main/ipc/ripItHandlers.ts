import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { projectRegistryStore } from '../services/projectRegistryStore';
import { readProjectInfo } from '../services/markdownWorkspace';
import { buildRipItTasks } from '../services/ripItEngine';

/**
 * "Rip it and Ship It" IPC: turn the founder's Erlich chat + references into a
 * single approved build task the Bullpen runs. Workspace is resolved from the
 * registry (trust boundary), not the renderer's claim.
 */
export function registerRipItHandlers(): void {
  ipcMain.handle(IpcChannels.ripItBuild, async (_event, value) => {
    const { id } = (value ?? {}) as { id?: unknown };
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('A project id is required');
    }
    const entry = await projectRegistryStore.get(id);
    if (!entry) {
      throw new Error('Unknown project id');
    }
    const info = await readProjectInfo(entry.workspacePath).catch(() => null);
    const projectName = info?.projectName ?? entry.name;
    return buildRipItTasks(entry.workspacePath, projectName);
  });
}
