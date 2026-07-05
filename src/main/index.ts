import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerAppHandlers, clearAttention } from './ipc/appHandlers';
import { registerSettingsHandlers } from './ipc/settingsHandlers';
import { registerValidationHandlers } from './ipc/validationHandlers';
import { registerProjectHandlers } from './ipc/projectHandlers';
import { registerReferencesHandlers } from './ipc/referencesHandlers';
import { registerRipItHandlers } from './ipc/ripItHandlers';
import { registerSecretsHandlers } from './ipc/secretsHandlers';
import { registerCliHandlers } from './ipc/cliHandlers';
import { registerBuildToolsHandlers } from './ipc/buildToolsHandlers';
import { registerRoomHandlers } from './ipc/roomHandlers';
import { registerWhiteboardHandlers } from './ipc/whiteboardHandlers';
import { registerBullpenHandlers } from './ipc/bullpenHandlers';
import { registerRunHandlers } from './ipc/runHandlers';
import { registerTerminalHandlers } from './ipc/terminalHandlers';
import { registerLessonsHandlers } from './ipc/lessonsHandlers';
import { registerDiagnosticsHandlers } from './ipc/diagnosticsHandlers';
import { initInvocationLog } from './services/invocationLog';
import { ensureUserPathEnv } from './services/pathEnv';

// Handle Squirrel.Windows install/update shortcuts.
if (started) {
  app.quit();
}

// Single-instance lock: a SECOND running instance contends for the same Chromium userData
// profile, which can corrupt the renderer's view of state (it bails to "not onboarded" + no
// projects despite valid data on disk). Refuse the duplicate and focus the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) {
        win.restore();
      }
      win.focus();
    }
  });
}

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f17',
    title: 'Nucleus-AI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Returning to the app clears any walk-away attention nudge (taskbar/dock flash + dock badge).
  mainWindow.on('focus', () => clearAttention());

  // Right-click context menu: cut/copy/paste/select-all on any editable field (the
  // chat boxes included — keyboard Ctrl/Cmd+V alone isn't discoverable), and copy on
  // a selection elsewhere. Roles use the OS clipboard; nothing custom touches it.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const { editFlags, isEditable, selectionText } = params;
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (isEditable) {
      items.push(
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' },
      );
    } else if (selectionText.trim() !== '') {
      items.push({ role: 'copy' });
    }
    if (items.length > 0) {
      Menu.buildFromTemplate(items).popup({ window: mainWindow });
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

// Renderer hardening: no popups, no navigating away from the app.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  contents.on('will-navigate', (event, url) => {
    const allowedOrigin = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
      : 'file://';
    if (!url.startsWith(allowedOrigin)) {
      event.preventDefault();
    }
  });
});

app.whenReady().then(async () => {
  // Restore the user's real PATH on a packaged macOS/Linux GUI launch (Finder/Dock give
  // a minimal PATH that omits Homebrew/npm bins) BEFORE any CLI resolution — else every
  // local AI CLI reads as "not installed". No-op on Windows / in dev.
  await ensureUserPathEnv({ packaged: app.isPackaged, platform: process.platform });
  // Windows attributes toast notifications to this AppUserModelID — set it so the walk-away
  // build notifications show under the app, not a generic "electron.app.*" name. No-op elsewhere.
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.nucleus-ai.desktop');
  }
  // Point the diagnostics log at userData before any CLI invocation can fire.
  initInvocationLog(app.getPath('userData'));
  registerAppHandlers();
  registerSettingsHandlers();
  registerValidationHandlers();
  registerProjectHandlers();
  registerReferencesHandlers();
  registerRipItHandlers();
  registerSecretsHandlers();
  registerCliHandlers();
  registerBuildToolsHandlers();
  registerRoomHandlers();
  registerWhiteboardHandlers();
  registerBullpenHandlers();
  registerRunHandlers();
  registerTerminalHandlers();
  registerLessonsHandlers();
  registerDiagnosticsHandlers();
  createMainWindow();

  app.on('activate', () => {
    // macOS: re-create the window when the dock icon is clicked.
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}).catch((err) => {
  // Surface a startup failure clearly instead of as an unhandledRejection.
  console.error('Nucleus-AI failed to start:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
