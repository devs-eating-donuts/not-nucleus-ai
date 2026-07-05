import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { RoleId } from '../../shared/roles';
import type { TerminalMode } from '../../shared/terminal';
import type { ThemeId } from '../../shared/theme';

interface TerminalViewProps {
  projectId: string;
  roleId: RoleId;
  mode: TerminalMode;
  /** Active app theme — recolors the terminal without a restart. */
  themeId: ThemeId;
  /** Changing this remounts a fresh PTY session (the Restart button bumps it). */
  sessionKey: number;
  onStatus?: (status: 'running' | 'exited' | 'failed', detail?: string) => void;
}

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Map the active app theme tokens onto xterm's surface colors. The 16 ANSI
 * colors are fixed so colored CLI output reads correctly in any theme. */
function buildTheme(): ITheme {
  return {
    background: token('--bg-app', '#0a100e'),
    foreground: token('--text-primary', '#f1f8f4'),
    cursor: token('--accent', '#3ab558'),
    cursorAccent: token('--bg-app', '#0a100e'),
    selectionBackground: token('--accent-soft', 'rgba(48,158,74,0.3)'),
    black: '#10141c',
    red: '#ff6b6b',
    green: '#8cff4d',
    yellow: '#ffd166',
    blue: '#4ea8ff',
    magenta: '#c792ea',
    cyan: '#56e1e1',
    white: '#d7e0f0',
    brightBlack: '#5a6680',
    brightRed: '#ff8787',
    brightGreen: '#b6ff8c',
    brightYellow: '#ffe39b',
    brightBlue: '#7cc0ff',
    brightMagenta: '#e0b0ff',
    brightCyan: '#9bf0f0',
    brightWhite: '#ffffff',
  };
}

/**
 * A live PTY-backed terminal. Owns one session for its lifetime: starts on
 * mount, streams output in, sends keystrokes back, refits on resize, and kills
 * the session on unmount. Remount (sessionKey change) gives a fresh session.
 */
export function TerminalView({
  projectId,
  roleId,
  mode,
  themeId,
  sessionKey,
  onStatus,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window.nucleus === 'undefined') {
      return;
    }

    const term = new Terminal({
      fontSize: 13,
      fontFamily: token('--font-mono', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'),
      cursorBlink: true,
      scrollback: 5000,
      theme: buildTheme(),
      allowProposedApi: true,
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      fit.fit();
    } catch {
      /* container not laid out yet — ResizeObserver will refit */
    }

    let sessionId: string | null = null;
    let disposed = false;

    const offData = window.nucleus.terminal.onData((e) => {
      if (e.sessionId === sessionId) {
        term.write(e.data);
      }
    });
    const offExit = window.nucleus.terminal.onExit((e) => {
      if (e.sessionId === sessionId) {
        term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
        onStatusRef.current?.('exited');
      }
    });
    const inputDisposable = term.onData((d) => {
      if (sessionId) {
        window.nucleus.terminal.input(sessionId, d);
      }
    });

    void window.nucleus.terminal
      .start({ projectId, roleId, mode, cols: term.cols, rows: term.rows })
      .then((res) => {
        if (disposed) {
          // Unmounted before start resolved (e.g. React strict-mode double
          // mount) — kill the orphan we just created.
          if (res.ok && res.descriptor) {
            window.nucleus.terminal.kill(res.descriptor.id);
          }
          return;
        }
        if (!res.ok || !res.descriptor) {
          term.write(`\x1b[31m${res.error ?? 'Failed to start terminal.'}\x1b[0m\r\n`);
          onStatusRef.current?.('failed', res.error);
          return;
        }
        sessionId = res.descriptor.id;
        onStatusRef.current?.('running');
        term.focus();
      });

    const resizeObs = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore transient layout */
      }
      if (sessionId) {
        window.nucleus.terminal.resize(sessionId, term.cols, term.rows);
      }
    });
    resizeObs.observe(container);

    return () => {
      disposed = true;
      resizeObs.disconnect();
      offData();
      offExit();
      inputDisposable.dispose();
      if (sessionId) {
        window.nucleus.terminal.kill(sessionId);
      }
      term.dispose();
      termRef.current = null;
    };
  }, [projectId, roleId, mode, sessionKey]);

  // Recolor live when the app theme changes.
  useEffect(() => {
    void themeId;
    if (termRef.current) {
      termRef.current.options.theme = buildTheme();
    }
  }, [themeId]);

  return <div className="terminal-host" ref={containerRef} />;
}
