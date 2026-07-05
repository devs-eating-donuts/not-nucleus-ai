import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CliAssignment, CliCapabilities } from '../../shared/cli';
import { isExecutionMode } from '../../shared/cli';
import type { RoleId } from '../../shared/roles';
import { ALL_ROLE_IDS, isReviewTrigger } from '../../shared/roles';
import type { AppSettings, RoleConfiguration } from '../../shared/settings';
import { createDefaultRoleConfiguration, createDefaultSettings } from '../../shared/settings';
import { DEFAULT_NAMING_MODE, isLockedNamingMode, isNamingMode } from '../../shared/naming';
import { huntComplete, sanitizeCrackedEggs } from '../../shared/easterEggs';
import { DEFAULT_THEME, clampUiScale, isThemeId } from '../../shared/theme';

/**
 * Persistent app settings (theme + role/CLI configuration) as JSON in
 * userData. Everything arriving over IPC is sanitized field-by-field:
 * the renderer is not a trusted source, and a hand-edited settings.json
 * must never crash the app.
 */

/* ----- field sanitizers ----- */

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = sanitizeStringArray(value);
  return items.length > 0 ? items : undefined;
}

/**
 * Env var names that can hijack process execution — a compromised renderer
 * could otherwise smuggle arbitrary code into a spawned CLI through them, so
 * they're stripped from any assignment env (matched case-insensitively).
 * NOTE: this only filters the per-role ASSIGNMENT env; the inherited
 * `process.env` still flows to the child untouched, so the CLI's normal tool
 * resolution keeps working — we only block renderer-supplied OVERRIDES.
 *  - NODE_OPTIONS / *_OPTIONS — inject `--require` (node) / tool flags (e.g.
 *    JAVA_TOOL_OPTIONS) into the runtime.
 *  - ELECTRON_RUN_AS_NODE — turn a child into a Node runtime.
 *  - *PRELOAD / LD_* / DYLD_* — dynamic-loader preload/redirect.
 *  - PATH / PATHEXT / *PATH — binary + module resolution hijack (planted
 *    git/node/sh, or a malicious PYTHONPATH/CLASSPATH module).
 */
const BLOCKED_ENV_EXACT = new Set(
  [
    'NODE_OPTIONS',
    'ELECTRON_RUN_AS_NODE',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'LD_AUDIT',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
    'DYLD_FRAMEWORK_PATH',
    'DYLD_FALLBACK_LIBRARY_PATH',
    'PATH',
    'PATHEXT',
  ].map((k) => k.toLowerCase()),
);
// Suffix families (case-insensitive) that the exact list might miss: binary /
// module resolution (*PATH) and runtime-flag injection (*PRELOAD, *_OPTIONS).
const BLOCKED_ENV_PATTERNS = [/path$/i, /preload$/i, /_options$/i];

function isBlockedEnvKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  return BLOCKED_ENV_EXACT.has(k) || BLOCKED_ENV_PATTERNS.some((re) => re.test(k));
}

function sanitizeEnv(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val !== 'string' || key.trim() === '') {
      continue;
    }
    if (isBlockedEnvKey(key)) {
      continue;
    }
    env[key] = val;
  }
  return env;
}

/* ----- model sanitizers ----- */

function sanitizeCapabilities(value: unknown): CliCapabilities {
  const c = (value ?? {}) as Partial<CliCapabilities>;
  return {
    supportsModelSelection: sanitizeBoolean(c.supportsModelSelection, false),
    supportsThinkingLevel: sanitizeBoolean(c.supportsThinkingLevel, false),
    supportedModels: optionalStringArray(c.supportedModels),
    supportedThinkingLevels: optionalStringArray(c.supportedThinkingLevels),
    requiresPty: sanitizeBoolean(c.requiresPty, false),
    supportsStreaming: sanitizeBoolean(c.supportsStreaming, true),
    supportsAutopilot: sanitizeBoolean(c.supportsAutopilot, false),
    supportsPromptedMode: sanitizeBoolean(c.supportsPromptedMode, true),
  };
}

function sanitizeAssignment(value: unknown): CliAssignment | null {
  if (value === null || value === undefined || typeof value !== 'object') {
    return null;
  }
  const a = value as Partial<CliAssignment>;
  return {
    presetId: optionalString(a.presetId),
    cliName: nonEmptyString(a.cliName, 'Custom CLI'),
    command: typeof a.command === 'string' ? a.command.trim() : '',
    defaultArgs: sanitizeStringArray(a.defaultArgs),
    env: sanitizeEnv(a.env),
    defaultModel: optionalString(a.defaultModel),
    defaultThinkingLevel: optionalString(a.defaultThinkingLevel),
    capabilities: sanitizeCapabilities(a.capabilities),
    executionMode: isExecutionMode(a.executionMode) ? a.executionMode : 'prompted',
  };
}

export function sanitizeRoleConfiguration(value: unknown, roleId: RoleId): RoleConfiguration {
  const fallback = createDefaultRoleConfiguration(roleId);
  const c = (value ?? {}) as Partial<RoleConfiguration>;
  return {
    roleId,
    personaNameOverride: nullableString(c.personaNameOverride),
    personaTitle: nonEmptyString(c.personaTitle, fallback.personaTitle),
    enabled: sanitizeBoolean(c.enabled, fallback.enabled),
    reviewTrigger: isReviewTrigger(c.reviewTrigger) ? c.reviewTrigger : fallback.reviewTrigger,
    promptTemplate: nonEmptyString(c.promptTemplate, fallback.promptTemplate),
    assignment: sanitizeAssignment(c.assignment),
  };
}

/** Sanitize a full role map (used for the global roster and project teams). */
export function sanitizeTeam(value: unknown): Record<RoleId, RoleConfiguration> {
  const source = (value ?? {}) as Record<string, unknown>;
  const roles = {} as Record<RoleId, RoleConfiguration>;
  for (const roleId of ALL_ROLE_IDS) {
    roles[roleId] = sanitizeRoleConfiguration(source[roleId], roleId);
  }
  return roles;
}

export function sanitizeSettings(value: unknown): AppSettings {
  const c = (value ?? {}) as Partial<AppSettings> & { roles?: Record<string, unknown> };
  const roles = sanitizeTeam(c.roles);
  // Default `onboarded` so an upgrade never re-onboards an existing user: a saved
  // settings.json written before this field existed has no `onboarded` key, but if
  // it already carries any CLI assignment the user is plainly past onboarding.
  const onboarded =
    typeof c.onboarded === 'boolean'
      ? c.onboarded
      : ALL_ROLE_IDS.some((roleId) => roles[roleId].assignment !== null);
  const namingMode = isNamingMode(c.namingMode) ? c.namingMode : DEFAULT_NAMING_MODE;
  // Grandfather clause: a settings file persisted before the locked tiers
  // existed can carry a locked namingMode with no crack recorded. The user
  // plainly had that tier — record the crack rather than locking them out.
  const crackedEggs = sanitizeCrackedEggs(c.crackedEggs);
  if (isLockedNamingMode(namingMode) && !crackedEggs.includes(namingMode)) {
    crackedEggs.push(namingMode);
  }
  // Per-tier image-vault answers (the decryption keys). Kept ONLY for tiers that
  // are actually cracked, strings only. Local userData — never in the repo.
  const crackedAnswers: Record<string, string> = {};
  const rawAnswers = (c.crackedAnswers ?? {}) as Record<string, unknown>;
  for (const mode of crackedEggs) {
    const answer = rawAnswers[mode];
    if (typeof answer === 'string' && answer.trim() !== '') {
      crackedAnswers[mode] = answer;
    }
  }
  return {
    schemaVersion: 1,
    theme: isThemeId(c.theme) ? c.theme : DEFAULT_THEME,
    namingMode,
    uiScale: clampUiScale(c.uiScale),
    onboarded,
    crackedEggs,
    // The takeover switch only exists once the whole hunt is cracked; enforce
    // the same gate on the persisted flag.
    jianYangAwake: sanitizeBoolean(c.jianYangAwake, false) && huntComplete(crackedEggs),
    crackedAnswers,
    roles,
  };
}

/* ----- store ----- */

class SettingsStore {
  private cache: AppSettings | null = null;

  private get filePath(): string {
    return path.join(app.getPath('userData'), 'settings.json');
  }

  /** Step-1 theme file; read once as a migration seed, never written again. */
  private get legacyPreferencesPath(): string {
    return path.join(app.getPath('userData'), 'preferences.json');
  }

  async get(): Promise<AppSettings> {
    if (this.cache) {
      return this.cache;
    }
    // A transient read failure (a brief file lock during a messy restart, AV / cloud-sync, a
    // second instance) must NOT masquerade as a fresh install — that would drop an onboarded
    // user back to onboarding and hide their projects. So: only treat a GENUINELY-ABSENT file
    // as fresh; on a lock-style error retry with backoff; on give-up, return defaults WITHOUT
    // caching them, so a later read can still recover the real settings.
    for (let attempt = 0; ; attempt++) {
      try {
        const raw = await fs.readFile(this.filePath, 'utf8');
        this.cache = sanitizeSettings(JSON.parse(raw));
        return this.cache;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          this.cache = await this.defaultsWithLegacyTheme();
          return this.cache;
        }
        if (err instanceof SyntaxError || attempt >= 4) {
          return this.defaultsWithLegacyTheme();
        }
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }

  /**
   * Re-read settings.json from disk, ignoring the in-memory cache. Used where a
   * stale cache would cause real harm — e.g. seeding a NEW project's team from
   * the global roster: the cache can lag a renderer edit and seed empty CLIs.
   */
  async getFresh(): Promise<AppSettings> {
    this.cache = null;
    return this.get();
  }

  /**
   * The in-memory cache, synchronously — null until the first get(). For
   * cosmetic reads inside sync code paths (e.g. the Jian Yang takeover check)
   * where an async read can't be threaded and a stale/absent value is harmless.
   */
  peek(): AppSettings | null {
    return this.cache;
  }

  async update(value: unknown): Promise<AppSettings> {
    const settings = sanitizeSettings(value);
    await this.save(settings);
    return settings;
  }

  async reset(): Promise<AppSettings> {
    const settings = createDefaultSettings();
    await this.save(settings);
    return settings;
  }

  private async defaultsWithLegacyTheme(): Promise<AppSettings> {
    const defaults = createDefaultSettings();
    try {
      const raw = await fs.readFile(this.legacyPreferencesPath, 'utf8');
      const parsed = JSON.parse(raw) as { theme?: unknown };
      if (isThemeId(parsed.theme)) {
        defaults.theme = parsed.theme;
      }
    } catch {
      // No legacy file — nothing to migrate.
    }
    return defaults;
  }

  private async save(settings: AppSettings): Promise<void> {
    this.cache = settings;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // Atomic-ish write: temp file then rename, so a crash never truncates.
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }
}

export const settingsStore = new SettingsStore();

/**
 * Whether the Jian Yang company takeover applies — settings.jianYangAwake,
 * toggled by the status-bar hot dog once the whole hunt is cracked (the
 * sanitizer enforces that gate). Applies in EVERY naming mode. Sync via the
 * cache: pre-boot or in tests the cache is null and this is simply false,
 * which is the safe answer (cosmetic gag, never load-bearing).
 */
export function jianYangTakeoverActive(): boolean {
  return settingsStore.peek()?.jianYangAwake ?? false;
}
