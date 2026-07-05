import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { ALLOWED_REFERENCE_EXTENSIONS } from '../../shared/references';
import type { ReferenceFile } from '../../shared/references';
import { projectRegistryStore } from '../services/projectRegistryStore';
import {
  addReferences,
  listReferences,
  removeReference,
  setReferenceNote,
} from '../services/referencesStore';

/**
 * Reference-upload IPC: the founder's screenshots / specs / brand assets. The
 * renderer never reads files or copies bytes — it sends intent; main opens the
 * native picker and main copies the chosen files into the project's references/
 * folder (validated, path-guarded). Workspace is resolved from the registry, not
 * the renderer's claim (trust boundary, like every other project handler).
 */

async function resolveWorkspace(value: unknown): Promise<string> {
  const { id } = (value ?? {}) as { id?: unknown };
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('A project id is required');
  }
  const entry = await projectRegistryStore.get(id);
  if (!entry) {
    throw new Error('Unknown project id');
  }
  return entry.workspacePath;
}

function requireFileName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('A file name is required');
  }
  return value;
}

export function registerReferencesHandlers(): void {
  ipcMain.handle(IpcChannels.referencesList, async (_event, value): Promise<ReferenceFile[]> => {
    return listReferences(await resolveWorkspace(value));
  });

  ipcMain.handle(IpcChannels.referencesAdd, async (event, value) => {
    const workspacePath = await resolveWorkspace(value);
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const opts: Electron.OpenDialogOptions = {
      title: 'Add reference files',
      buttonLabel: 'Add to project',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Reference files (images, docs, archives)',
          // Electron filter extensions carry no leading dot. Archives (.zip/.7z/.tar/.tgz,
          // plus .gz so .tar.gz shows) are EXTRACTED on import by the store.
          extensions: [
            ...ALLOWED_REFERENCE_EXTENSIONS.map((e) => e.replace(/^\./, '')),
            'zip',
            '7z',
            'tar',
            'tgz',
            'gz',
          ],
        },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) {
      return { added: [], rejected: [], references: await listReferences(workspacePath), cancelled: true };
    }
    const result = await addReferences(workspacePath, res.filePaths);
    return { ...result, cancelled: false };
  });

  ipcMain.handle(IpcChannels.referencesSetNote, async (_event, value): Promise<ReferenceFile[]> => {
    const workspacePath = await resolveWorkspace(value);
    const { fileName, note } = (value ?? {}) as { fileName?: unknown; note?: unknown };
    return setReferenceNote(
      workspacePath,
      requireFileName(fileName),
      typeof note === 'string' ? note : '',
    );
  });

  ipcMain.handle(IpcChannels.referencesRemove, async (_event, value): Promise<ReferenceFile[]> => {
    const workspacePath = await resolveWorkspace(value);
    const { fileName } = (value ?? {}) as { fileName?: unknown };
    return removeReference(workspacePath, requireFileName(fileName));
  });
}
