import type { RoleId } from './roles';

/**
 * CLI validation contract. Results are produced by the main process
 * (cliValidator service) and rendered on the Team page. Validation state
 * is deliberately separate from settings: it describes the machine,
 * not the user's configuration.
 */

export type ValidationStatus =
  /** Executable found and it spawned successfully. */
  | 'ready'
  /** No executable configured, or the command could not be found. */
  | 'missing'
  /** Found on disk but it does not appear to be runnable. */
  | 'invalid'
  /** Validation itself failed unexpectedly. */
  | 'error'
  /** Nothing to validate (no CLI assigned) or not yet checked. */
  | 'unverified';

export interface RoleValidationResult {
  roleId: RoleId;
  personaName: string;
  /** Preset id of the assigned CLI ('custom' when hand-configured); null when unassigned. */
  cliId: string | null;
  /** The command exactly as configured. */
  executable: string;
  status: ValidationStatus;
  /** Human-readable outcome, persona-voiced where appropriate. */
  message: string;
  /** ISO timestamp of when the check ran. */
  checkedAt: string;
  /** Absolute path the command resolved to, when found. */
  resolvedPath?: string;
  /** First line of `--version` output, when the probe captured one. */
  version?: string;
}

export const VALIDATION_STATUS_LABELS: Record<ValidationStatus, string> = {
  ready: 'Ready',
  missing: 'Not found',
  invalid: 'Not runnable',
  error: 'Validation error',
  unverified: 'Unverified',
};
