import type { CliAssignment } from './cli';
import type { NamingMode } from './naming';
import { DEFAULT_NAMING_MODE } from './naming';
import type { ReviewTrigger, RoleId } from './roles';
import { ALL_ROLE_IDS, ROLE_DEFINITIONS, defaultChainRoles } from './roles';
import { defaultPersonaForRole } from './personas';
import type { ThemeId } from './theme';
import { DEFAULT_THEME, DEFAULT_UI_SCALE } from './theme';

/** Per-role configuration: who sits in the seat and what CLI they drive. */
export interface RoleConfiguration {
  roleId: RoleId;
  /**
   * Explicit user rename for this seat's persona. null means "follow the
   * active naming mode" — see effectivePersonaName in personas.ts.
   */
  personaNameOverride: string | null;
  personaTitle: string;
  /** Whether the role participates in new runs by default. */
  enabled: boolean;
  reviewTrigger: ReviewTrigger;
  /**
   * Role prompt template with {{variable}} placeholders. Seeded from the
   * role's built-in default; user edits persist here.
   */
  promptTemplate: string;
  /** null until the user assigns a CLI on the Team page. */
  assignment: CliAssignment | null;
}

export interface AppSettings {
  schemaVersion: 1;
  theme: ThemeId;
  /** Which naming tier (canon / cover / distinct) the UI renders. */
  namingMode: NamingMode;
  /** Root font-size multiplier (0.8–1.5); the whole UI scales with it. */
  uiScale: number;
  /**
   * Whether the user has completed first-run onboarding (detected/assigned at
   * least one working AI CLI). false on a fresh install gates the app behind the
   * onboarding flow; the settings sanitizer treats an existing CLI assignment as
   * already-onboarded so upgrades never re-onboard.
   */
  onboarded: boolean;
  /**
   * Naming tiers whose easter-egg clue has been cracked via the Pipey trivia
   * hunt (shared/easterEggs.ts). Persisted so a crack survives restarts.
   */
  crackedEggs: NamingMode[];
  /**
   * The Jian Yang company takeover — every portrait, voice, and name becomes
   * his, in any naming mode. Toggled by the status-bar hot dog, which only
   * exists once the whole hunt is cracked (the sanitizer enforces that gate).
   */
  jianYangAwake: boolean;
  /**
   * The trivia answer for each cracked tier — the KEY that decrypts that tier's
   * persona portraits (shared/imageVault.ts). Stored LOCALLY in userData only
   * (never the repo), so a cracked tier's art re-decrypts on the next launch
   * without re-solving. Absent for uncracked tiers.
   */
  crackedAnswers: Partial<Record<NamingMode, string>>;
  roles: Record<RoleId, RoleConfiguration>;
}

export function createDefaultRoleConfiguration(roleId: RoleId): RoleConfiguration {
  const def = ROLE_DEFINITIONS[roleId];
  const persona = defaultPersonaForRole(roleId);
  return {
    roleId,
    personaNameOverride: null,
    personaTitle: persona?.title ?? def.label,
    enabled: def.inDefaultChain,
    reviewTrigger: def.defaultReviewTrigger,
    promptTemplate: def.defaultPromptTemplate,
    assignment: null,
  };
}

/**
 * Lifecycle-chain roles that still have no usable CLI assigned. Empty means the
 * Default Team is ready to seed a new project without dead seats. A role counts as
 * unassigned when its assignment is null or its command is blank. Pure — unit tested.
 */
export function unassignedChainRoles(roles: Record<RoleId, RoleConfiguration>): RoleId[] {
  return defaultChainRoles().filter((id) => {
    const command = roles[id]?.assignment?.command;
    return typeof command !== 'string' || command.trim() === '';
  });
}

/** True when every lifecycle-chain role has a CLI assigned (no dead seats at creation). */
export function isDefaultTeamReady(roles: Record<RoleId, RoleConfiguration>): boolean {
  return unassignedChainRoles(roles).length === 0;
}

/**
 * The two roles "Rip it and Ship It" needs: Erlich (stakeholder) to chat and
 * Dinesh (developer) to build. The express lane skips everyone else, so it has a
 * much lighter readiness bar than the full lifecycle. Returns the unassigned ones
 * (empty = ready). Pure — unit tested.
 */
export const RIP_IT_ROLES: readonly RoleId[] = ['stakeholder', 'developer'];

export function unassignedRipItRoles(roles: Record<RoleId, RoleConfiguration>): RoleId[] {
  return RIP_IT_ROLES.filter((id) => {
    const command = roles[id]?.assignment?.command;
    return typeof command !== 'string' || command.trim() === '';
  });
}

export function isRipItTeamReady(roles: Record<RoleId, RoleConfiguration>): boolean {
  return unassignedRipItRoles(roles).length === 0;
}

export function createDefaultSettings(): AppSettings {
  const roles = {} as Record<RoleId, RoleConfiguration>;
  for (const roleId of ALL_ROLE_IDS) {
    roles[roleId] = createDefaultRoleConfiguration(roleId);
  }
  return {
    schemaVersion: 1,
    theme: DEFAULT_THEME,
    namingMode: DEFAULT_NAMING_MODE,
    uiScale: DEFAULT_UI_SCALE,
    onboarded: false,
    crackedEggs: [],
    jianYangAwake: false,
    crackedAnswers: {},
    roles,
  };
}
