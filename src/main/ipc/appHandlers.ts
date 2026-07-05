import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import process from 'node:process';
import type { AppInfo } from '../../shared/ipc';
import { IpcChannels } from '../../shared/ipc';

type AttentionKind = 'escalated' | 'complete' | 'error';

function mainWin(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

/**
 * Clear any pending attention state — the taskbar/dock flash and (macOS) the dock badge.
 * Safe on every platform (`app.dock` is undefined off macOS). Also called from the window's
 * 'focus' handler so returning to the app clears the nudge.
 */
export function clearAttention(): void {
  app.dock?.setBadge('');
  mainWin()?.flashFrame(false);
}

const MESSAGES: Record<AttentionKind, (project: string) => { title: string; body: string; badge: string }> = {
  escalated: (p) => ({ title: 'The Bullpen needs you', body: `${p}: the build paused for your input.`, badge: '!' }),
  complete: (p) => ({ title: 'Build complete', body: `${p}: the Bullpen finished the build.`, badge: '✓' }),
  error: (p) => ({ title: 'The build stopped', body: `${p}: the Bullpen hit an error and paused.`, badge: '!' }),
};

/** App-level IPC: runtime/version info + the walk-away attention nudge (notification + badge). */
export function registerAppHandlers(): void {
  ipcMain.handle(IpcChannels.appGetInfo, (): AppInfo => {
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown',
      nodeVersion: process.versions.node ?? 'unknown',
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
    };
  });

  // Fired by the Bullpen loop when a build escalates / completes / errors. It ONLY nudges when
  // the window is unfocused — if the user is already looking, the in-app banner covers it. This
  // is the walk-away payoff: an autopilot build that pauses for you pings you (an unattended build
  // can otherwise idle for a long time before anyone notices it stopped). Best-effort, never throws.
  ipcMain.handle(IpcChannels.appNotifyAttention, (_event, value: unknown): void => {
    const { kind, projectName } = (value ?? {}) as { kind?: unknown; projectName?: unknown };
    const k: AttentionKind = kind === 'complete' ? 'complete' : kind === 'error' ? 'error' : 'escalated';
    const win = mainWin();
    if (!win || win.isFocused()) {
      return;
    }
    const project =
      typeof projectName === 'string' && projectName.trim() !== '' ? projectName.slice(0, 100) : 'Your project';
    const { title, body, badge } = MESSAGES[k](project);
    // Taskbar flash (Windows) / dock bounce (macOS) / urgency hint (Linux) + the macOS dock badge.
    win.flashFrame(true);
    app.dock?.setBadge(badge);
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body });
      notification.on('click', () => {
        clearAttention();
        if (win.isMinimized()) {
          win.restore();
        }
        win.focus();
      });
      notification.show();
    }
  });

  ipcMain.handle(IpcChannels.appClearAttention, (): void => {
    clearAttention();
  });
}
