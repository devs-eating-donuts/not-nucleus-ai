import type { RoleId } from './roles';

/**
 * Terminal session contract for role terminals (xterm.js in the renderer,
 * node-pty in the main process). A session is a live pseudo-terminal running
 * either a role's assigned CLI in its native interactive mode ('cli') or the
 * OS default shell ('shell'), with the project workspace as the cwd.
 *
 * Unlike the rest of the IPC surface (request/response invoke), terminals also
 * use a streaming channel: the main process pushes `terminal:data` /
 * `terminal:exit` events to the renderer via webContents.send.
 */

export type TerminalSessionStatus = 'starting' | 'running' | 'exited' | 'failed';

/** What a terminal runs: the role's interactive CLI, or a plain OS shell. */
export type TerminalMode = 'cli' | 'shell';

export interface TerminalSessionDescriptor {
  id: string;
  roleId: RoleId;
  mode: TerminalMode;
  title: string;
  /** The resolved executable (or shell) the PTY launched. */
  command: string;
  cwd: string;
  cols: number;
  rows: number;
  status: TerminalSessionStatus;
  startedAt: string;
  exitCode?: number;
}

/** Renderer → main: open a new PTY session. */
export interface TerminalStartInput {
  projectId: string;
  roleId: RoleId;
  mode: TerminalMode;
  cols: number;
  rows: number;
}

export interface TerminalStartResult {
  ok: boolean;
  descriptor?: TerminalSessionDescriptor;
  error?: string;
}

/** Main → renderer: a chunk of PTY output. */
export interface TerminalDataEvent {
  sessionId: string;
  data: string;
}

/** Main → renderer: the PTY exited (or failed to start cleanly). */
export interface TerminalExitEvent {
  sessionId: string;
  exitCode: number | null;
  status: TerminalSessionStatus;
}
