/**
 * Lifecycle "rooms" — project-scoped interactive sessions with a role's
 * assigned CLI (Investor Pitch / The Whiteboard / The Bullpen / The Garage).
 * Same one-shot mechanism as the Erlich pitch, but bound to the active
 * project's team and persisted in the workspace.
 */

export interface ChatMessage {
  role: 'user' | 'persona';
  text: string;
}

export interface RoomTurnResult {
  ok: boolean;
  reply: string;
  /** Present when ok is false (no CLI assigned, not installed, CLI error). */
  error?: string;
}

/**
 * A turn in The Punch List — the same chat shape as a room, plus the task
 * Richard filed this turn (when he accepted the request) so the renderer can
 * refresh the board.
 */
export interface WorkRequestTurnResult extends RoomTurnResult {
  /** The task id Richard filed this turn, or null if he pushed back / clarified. */
  createdTaskId?: string | null;
  /** The phase the filed task landed in. */
  phaseName?: string | null;
}
