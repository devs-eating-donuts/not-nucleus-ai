import { ipcMain } from 'electron';
import type { InvocationLogRecord } from '../../shared/diagnostics';
import { IpcChannels } from '../../shared/ipc';
import { readRecentInvocations } from '../services/invocationLog';

/**
 * Diagnostics IPC. Read-only: the renderer can list recent CLI invocations for The
 * Garage's activity panel, nothing more. The log is cross-project (userData/logs/),
 * so this takes no project id. The limit is clamped — the renderer is untrusted.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function registerDiagnosticsHandlers(): void {
  ipcMain.handle(
    IpcChannels.diagnosticsRecent,
    (_event, value: unknown): Promise<InvocationLogRecord[]> => {
      const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : DEFAULT_LIMIT;
      const limit = Math.max(1, Math.min(MAX_LIMIT, n));
      return readRecentInvocations(limit);
    },
  );
}
