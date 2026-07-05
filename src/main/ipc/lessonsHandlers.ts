import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { Lesson, LessonStatus } from '../../shared/lessons';
import { lessonsStore } from '../services/lessonsStore';

/**
 * Lessons-memory IPC. The store is cross-project (userData/lessons.json), so these
 * take no project id. Read-only list for the ledger + a curation `setStatus` (the Mute
 * escape hatch). Inputs are validated here — the renderer is untrusted.
 */

const VALID_STATUS: LessonStatus[] = ['candidate', 'confirmed', 'muted'];

export function registerLessonsHandlers(): void {
  ipcMain.handle(IpcChannels.lessonsList, (): Promise<Lesson[]> => lessonsStore.list());

  ipcMain.handle(
    IpcChannels.lessonsSetStatus,
    (_event, value: unknown): Promise<Lesson | null> => {
      const { id, status } = (value ?? {}) as { id?: unknown; status?: unknown };
      if (typeof id !== 'string' || !VALID_STATUS.includes(status as LessonStatus)) {
        return Promise.resolve(null);
      }
      return lessonsStore.setStatus(id, status as LessonStatus);
    },
  );
}
