import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { settingsStore } from '../services/settingsStore';

/**
 * Settings IPC. The store sanitizes every inbound payload, so a malformed
 * or hostile renderer message can degrade a field to its default but can
 * never persist an invalid shape.
 */
export function registerSettingsHandlers(): void {
  ipcMain.handle(IpcChannels.settingsGet, async () => {
    return settingsStore.get();
  });

  ipcMain.handle(IpcChannels.settingsUpdate, async (_event, value: unknown) => {
    if (value === null || typeof value !== 'object') {
      throw new Error('settings:update expects a settings object');
    }
    return settingsStore.update(value);
  });

  ipcMain.handle(IpcChannels.settingsReset, async () => {
    return settingsStore.reset();
  });
}
