import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { settingsStore as SettingsStoreType } from './settingsStore';

// settingsStore imports `app` from electron at module scope; the hoisted holder
// lets the pure-sanitizer tests run with no dir ('') while the store tests point
// userData at a per-test temp dir (the getter re-reads it on every call).
const h = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.dir } }));

import { ALL_ROLE_IDS } from '../../shared/roles';
import { DEFAULT_THEME, clampUiScale } from '../../shared/theme';
import { DEFAULT_NAMING_MODE } from '../../shared/naming';
import { sanitizeRoleConfiguration, sanitizeSettings, sanitizeTeam } from './settingsStore';

// Everything arriving over IPC / hand-edited settings.json is untrusted — these
// pin that the sanitizers coerce garbage to safe values and never throw.
describe('sanitizeSettings', () => {
  it('returns safe defaults for non-object input', () => {
    for (const garbage of [null, undefined, 42, 'nope', []]) {
      const s = sanitizeSettings(garbage);
      expect(s.schemaVersion).toBe(1);
      expect(s.theme).toBe(DEFAULT_THEME);
      expect(s.namingMode).toBe(DEFAULT_NAMING_MODE);
      expect(Object.keys(s.roles).sort()).toEqual([...ALL_ROLE_IDS].sort());
    }
  });

  it('falls back on invalid theme and naming mode', () => {
    const s = sanitizeSettings({ theme: 'chartreuse', namingMode: 'sideways' });
    expect(s.theme).toBe(DEFAULT_THEME);
    expect(s.namingMode).toBe(DEFAULT_NAMING_MODE);
  });

  it('clamps an out-of-range uiScale', () => {
    expect(sanitizeSettings({ uiScale: 999 }).uiScale).toBe(clampUiScale(999));
    expect(sanitizeSettings({ uiScale: -5 }).uiScale).toBe(clampUiScale(-5));
    expect(sanitizeSettings({ uiScale: 'big' }).uiScale).toBe(clampUiScale('big' as unknown as number));
  });

  it('materializes every role even when roles are omitted', () => {
    const s = sanitizeSettings({});
    for (const roleId of ALL_ROLE_IDS) {
      expect(s.roles[roleId].roleId).toBe(roleId);
    }
  });

  // The onboarding gate keys on `onboarded`. A fresh install is false; an upgrade
  // from before the field existed must NOT re-onboard if a CLI is already assigned.
  it('defaults onboarded to false on a fresh/empty settings object', () => {
    expect(sanitizeSettings({}).onboarded).toBe(false);
  });

  it('treats an existing CLI assignment as already onboarded (no re-onboard on upgrade)', () => {
    const s = sanitizeSettings({ roles: { developer: { assignment: { command: 'claude' } } } });
    expect(s.onboarded).toBe(true);
  });

  it('honors an explicit onboarded boolean over the assignment fallback', () => {
    expect(sanitizeSettings({ onboarded: true }).onboarded).toBe(true);
    expect(
      sanitizeSettings({
        onboarded: false,
        roles: { developer: { assignment: { command: 'claude' } } },
      }).onboarded,
    ).toBe(false);
  });

  // The Pipey hunt gates the show-flavored naming tiers, but a settings file
  // persisted BEFORE the gate existed can carry a locked namingMode with no
  // crack recorded — the user plainly had that tier, so the sanitizer records
  // the crack instead of locking them out on upgrade.
  it('grandfathers a persisted locked namingMode into crackedEggs', () => {
    const s = sanitizeSettings({ namingMode: 'canon' });
    expect(s.namingMode).toBe('canon');
    expect(s.crackedEggs).toContain('canon');
  });

  it('does not grandfather the always-open default mode', () => {
    const s = sanitizeSettings({ namingMode: 'pete' });
    expect(s.crackedEggs).toEqual([]);
  });

  it('sanitizes crackedEggs and jianYangAwake', () => {
    const s = sanitizeSettings({ crackedEggs: ['distinct', 'bogus', 42], jianYangAwake: 'yes' });
    expect(s.crackedEggs).toEqual(['distinct']);
    expect(s.jianYangAwake).toBe(false);
  });

  // The takeover switch only exists post-hunt: a persisted (or hand-edited)
  // awake flag must not survive unless every egg is cracked.
  it('gates jianYangAwake on a completed hunt', () => {
    expect(sanitizeSettings({ jianYangAwake: true }).jianYangAwake).toBe(false);
    expect(
      sanitizeSettings({ jianYangAwake: true, crackedEggs: ['distinct', 'cover'] }).jianYangAwake,
    ).toBe(false);
    expect(
      sanitizeSettings({ jianYangAwake: true, crackedEggs: ['distinct', 'cover', 'canon'] })
        .jianYangAwake,
    ).toBe(true);
  });

  // The image-vault keys: an answer is kept ONLY for a tier that is actually
  // cracked (a stray answer for an uncracked tier would leak the trivia), and
  // only when it is a non-empty string.
  it('keeps crackedAnswers only for cracked tiers, strings only', () => {
    const s = sanitizeSettings({
      crackedEggs: ['distinct'],
      crackedAnswers: { distinct: 'some answer', cover: 'not cracked yet', canon: 42, pete: 'x' },
    });
    expect(s.crackedAnswers).toEqual({ distinct: 'some answer' });
  });

  it('defaults crackedAnswers to empty and drops blank/garbage values', () => {
    expect(sanitizeSettings({}).crackedAnswers).toEqual({});
    const s = sanitizeSettings({
      crackedEggs: ['distinct', 'cover'],
      crackedAnswers: { distinct: '   ', cover: { deep: true } },
    });
    expect(s.crackedAnswers).toEqual({});
  });
});

describe('sanitizeRoleConfiguration / assignment', () => {
  it('drops non-string defaultArgs and non-string env values', () => {
    const role = sanitizeRoleConfiguration(
      {
        assignment: {
          command: '  codex  ',
          defaultArgs: ['ok', 5, null, 'fine'],
          env: { GOOD: 'x', BAD: 2, ALSO_BAD: null, '': 'noKey' },
          executionMode: 'autopilot',
        },
      },
      'developer',
    );
    const a = role.assignment;
    expect(a).not.toBeNull();
    expect(a?.command).toBe('codex'); // trimmed
    expect(a?.defaultArgs).toEqual(['ok', 'fine']);
    expect(a?.env).toEqual({ GOOD: 'x' });
    expect(a?.executionMode).toBe('autopilot');
  });

  it('strips process-hijacking env vars (loaders, PATH-family, *_OPTIONS), case-insensitively', () => {
    const role = sanitizeRoleConfiguration(
      {
        assignment: {
          command: 'claude',
          env: {
            SAFE: 'ok',
            API_TOKEN: 'keep-me',
            NODE_OPTIONS: '--require=/tmp/evil.js',
            ld_preload: '/tmp/evil.so',
            DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
            LD_AUDIT: '/tmp/evil.so',
            ELECTRON_RUN_AS_NODE: '1',
            PATH: '/tmp/evil/bin',
            Path: '/tmp/evil/bin',
            PATHEXT: '.EVIL',
            PYTHONPATH: '/tmp/evil',
            JAVA_TOOL_OPTIONS: '-javaagent:/tmp/evil.jar',
          },
          executionMode: 'autopilot',
        },
      },
      'developer',
    );
    // Only the benign vars survive; process.env still flows to the child untouched.
    expect(role.assignment?.env).toEqual({ SAFE: 'ok', API_TOKEN: 'keep-me' });
  });

  it('coerces a missing command to empty string and an invalid executionMode to prompted', () => {
    const role = sanitizeRoleConfiguration({ assignment: { executionMode: 'ludicrous-speed' } }, 'qa');
    expect(role.assignment?.command).toBe('');
    expect(role.assignment?.executionMode).toBe('prompted');
  });

  it('treats a non-object assignment as no assignment', () => {
    expect(sanitizeRoleConfiguration({ assignment: 'codex' }, 'qa').assignment).toBeNull();
    expect(sanitizeRoleConfiguration({ assignment: 7 }, 'qa').assignment).toBeNull();
  });

  it('keeps personaNameOverride null unless a non-empty string', () => {
    expect(sanitizeRoleConfiguration({ personaNameOverride: '   ' }, 'qa').personaNameOverride).toBeNull();
    expect(sanitizeRoleConfiguration({ personaNameOverride: 'Gilfoyle' }, 'security').personaNameOverride).toBe('Gilfoyle');
  });
});

describe('sanitizeTeam', () => {
  it('returns a full roster for garbage input', () => {
    const team = sanitizeTeam('not a team');
    expect(Object.keys(team).sort()).toEqual([...ALL_ROLE_IDS].sort());
  });
});

// Regression guard for the ENV-INJECTION strip in settingsStore (sanitizeEnv,
// reached through sanitizeSettings → sanitizeTeam → sanitizeRoleConfiguration →
// sanitizeAssignment → sanitizeEnv). The renderer is untrusted; a compromised one
// must NOT be able to smuggle process-hijacking env vars onto a spawned CLI's
// assignment env. We drive the real public IPC entry point (sanitizeSettings) so
// the whole untrusted-input path is exercised, not just the leaf helper.
describe('env-injection guard (sanitizeSettings → assignment env)', () => {
  // Pull the assignment env that ends up on a given role after full sanitization.
  function envFor(env: Record<string, unknown>, roleId = 'developer'): Record<string, string> {
    const s = sanitizeSettings({
      roles: { [roleId]: { assignment: { command: 'claude', env } } },
    });
    const assignment = s.roles[roleId as (typeof ALL_ROLE_IDS)[number]].assignment;
    expect(assignment).not.toBeNull();
    return assignment!.env;
  }

  // Every name on the exact block-list must be removed regardless of case. These
  // are the loader-hijack / runtime-as-node / PATH-resolution vectors.
  const EXACT_BLOCKED = [
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
  ];

  it.each(EXACT_BLOCKED)('strips the exact-blocked hijack var %s', (key) => {
    const out = envFor({ KEEP_ME: 'fine', [key]: '/tmp/evil' });
    expect(out).not.toHaveProperty(key);
    expect(out).toEqual({ KEEP_ME: 'fine' });
  });

  it('strips exact-blocked vars regardless of case (lower / mixed)', () => {
    const out = envFor({
      node_options: '--require=/tmp/evil.js',
      Path: 'C:\\evil',
      Dyld_Insert_Libraries: '/tmp/evil.dylib',
      Electron_Run_As_Node: '1',
      OK_VAR: 'stays',
    });
    expect(out).toEqual({ OK_VAR: 'stays' });
  });

  it('strips any PATH-family var (suffix pattern), not just exact PATH', () => {
    const out = envFor({
      PYTHONPATH: '/tmp/evil',
      CLASSPATH: '/tmp/evil.jar',
      GOPATH: '/tmp/evil',
      LD_LIBRARY_PATH: '/tmp/evil', // also exact, still gone
      KEEP: 'x',
    });
    expect(out).toEqual({ KEEP: 'x' });
  });

  it('strips *_OPTIONS pattern matches (e.g. JAVA_TOOL_OPTIONS) not on the exact list', () => {
    const out = envFor({
      JAVA_TOOL_OPTIONS: '-javaagent:/tmp/evil.jar',
      _JAVA_OPTIONS: '-Dfoo=bar',
      MOCHA_OPTIONS: '--require evil',
      SAFE: 'ok',
    });
    expect(out).toEqual({ SAFE: 'ok' });
  });

  it('strips *PRELOAD pattern matches beyond the exact LD_PRELOAD entry', () => {
    const out = envFor({ SOME_PRELOAD: '/tmp/evil.so', LD_PRELOAD: '/tmp/evil.so', KEEP: 'y' });
    expect(out).toEqual({ KEEP: 'y' });
  });

  it('passes a benign token through unchanged', () => {
    expect(envFor({ MY_TOKEN: 'foo' })).toEqual({ MY_TOKEN: 'foo' });
  });

  it('drops non-string / garbage values without throwing, keeping the benign ones', () => {
    let out: Record<string, string> = {};
    expect(() => {
      out = envFor({
        GOOD: 'keep',
        NUM: 42,
        NIL: null,
        OBJ: { nested: 'x' },
        ARR: [1, 2, 3],
        UNDEF: undefined,
        BOOL: true,
        '': 'emptyKeyDropped',
      } as Record<string, unknown>);
    }).not.toThrow();
    expect(out).toEqual({ GOOD: 'keep' });
  });

  it('returns an empty env (never throws) when env itself is not an object', () => {
    for (const garbage of [null, 'PATH=/evil', 42, ['PATH=/evil']]) {
      const s = sanitizeSettings({
        roles: { developer: { assignment: { command: 'claude', env: garbage } } },
      });
      expect(s.roles.developer.assignment?.env).toEqual({});
    }
  });

  it('strips a full hijack payload while preserving every benign var in one pass', () => {
    const out = envFor({
      API_TOKEN: 'keep-me',
      HTTP_PROXY: 'http://corp.proxy:8080',
      MY_TOKEN: 'foo',
      NODE_OPTIONS: '--require=/tmp/evil.js',
      ld_preload: '/tmp/evil.so',
      DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
      LD_AUDIT: '/tmp/evil.so',
      ELECTRON_RUN_AS_NODE: '1',
      PATH: '/tmp/evil/bin',
      PATHEXT: '.EVIL',
      PYTHONPATH: '/tmp/evil',
      JAVA_TOOL_OPTIONS: '-javaagent:/tmp/evil.jar',
    });
    expect(out).toEqual({
      API_TOKEN: 'keep-me',
      HTTP_PROXY: 'http://corp.proxy:8080',
      MY_TOKEN: 'foo',
    });
  });
});

// ---------------------------------------------------------------------------
// settingsStore.get() — boot resilience (the "lost projects on
// startup" guard). A transient read failure on an EXISTING settings.json must
// NOT masquerade as a fresh install: only ENOENT is fresh; a lock-style error
// retries with backoff; give-up returns defaults WITHOUT caching so a later
// read still recovers the real settings (and the onboarded user).
// ---------------------------------------------------------------------------
describe('settingsStore.get() — boot resilience (never masquerade as a fresh install)', () => {
  let store: typeof SettingsStoreType;
  const tmpDirs: string[] = [];

  beforeEach(async () => {
    h.dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-settings-'));
    tmpDirs.push(h.dir);
    // Fresh singleton per test — the in-memory cache must not leak across temp dirs.
    vi.resetModules();
    ({ settingsStore: store } = await import('./settingsStore'));
  });

  afterEach(async () => {
    h.dir = '';
    await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  const settingsPath = () => path.join(h.dir, 'settings.json');

  it('an absent settings.json is a genuine fresh install — full defaults', async () => {
    const s = await store.get();
    expect(s.theme).toBe(DEFAULT_THEME);
    expect(s.namingMode).toBe(DEFAULT_NAMING_MODE);
    expect(s.onboarded).toBe(false);
    for (const roleId of ALL_ROLE_IDS) {
      expect(s.roles[roleId].assignment).toBeNull();
    }
  });

  it('a fresh install seeds the theme from the legacy preferences.json (step-1 migration)', async () => {
    await writeFile(
      path.join(h.dir, 'preferences.json'),
      JSON.stringify({ theme: 'series-b-fever-dream' }),
      'utf8',
    );
    const s = await store.get();
    expect(s.theme).toBe('series-b-fever-dream');
    expect(s.onboarded).toBe(false);
  });

  it('a persisted settings.json round-trips through a fresh store instance', async () => {
    await store.update({
      theme: 'series-b-fever-dream',
      onboarded: true,
      roles: { developer: { assignment: { command: 'claude', cliName: 'Claude Code' } } },
    });
    // New process (no cache) — the read path, not the write cache, must deliver it.
    vi.resetModules();
    ({ settingsStore: store } = await import('./settingsStore'));
    const s = await store.get();
    expect(s.theme).toBe('series-b-fever-dream');
    expect(s.onboarded).toBe(true);
    expect(s.roles.developer.assignment?.command).toBe('claude');
    expect(s.roles.developer.assignment?.cliName).toBe('Claude Code');
  });

  it('corrupt JSON returns defaults WITHOUT caching them — a repaired file is picked up by the SAME instance', async () => {
    await writeFile(settingsPath(), '{ definitely not json', 'utf8');
    const s = await store.get();
    // SyntaxError is unrecoverable data (not a transient lock): defaults, no retry storm.
    expect(s.theme).toBe(DEFAULT_THEME);
    expect(s.onboarded).toBe(false);
    // Repair the file — the give-up was never cached, so the next get() sees the real data.
    await writeFile(
      settingsPath(),
      JSON.stringify({ schemaVersion: 1, theme: 'series-b-fever-dream', onboarded: true }),
      'utf8',
    );
    const recovered = await store.get();
    expect(recovered.theme).toBe('series-b-fever-dream');
    expect(recovered.onboarded).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'a transient unreadable settings.json gives up to defaults WITHOUT caching — the real settings (and onboarding) survive',
    async () => {
      // A real, onboarded user on disk…
      await store.update({ theme: 'series-b-fever-dream', onboarded: true });
      // …read by a fresh process (no cache) while the file is locked (EACCES ≈ AV/cloud-sync/second instance).
      vi.resetModules();
      ({ settingsStore: store } = await import('./settingsStore'));
      await chmod(settingsPath(), 0o000);
      try {
        const during = await store.get();
        // Retries exhausted → defaults returned for THIS read only.
        expect(during.theme).toBe(DEFAULT_THEME);
        expect(during.onboarded).toBe(false);
      } finally {
        await chmod(settingsPath(), 0o644);
      }
      // The wipe/masquerade guard: the give-up default was NEVER cached, so the
      // next read on the same instance recovers the onboarded user's real settings.
      const recovered = await store.get();
      expect(recovered.theme).toBe('series-b-fever-dream');
      expect(recovered.onboarded).toBe(true);
    },
  );
});
