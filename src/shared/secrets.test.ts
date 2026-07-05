import { describe, expect, it } from 'vitest';
import type { ComposedBlueprint } from './blueprints';
import {
  ENV_VAR_RE,
  buildPushScript,
  buildSecretsManifestPromptBlock,
  classifySecret,
  deriveSecretsFromBlueprint,
  isValueShaped,
  redactSecrets,
  sanitizeManifest,
  sanitizeSecretEntry,
} from './secrets';

function composed(partial: Partial<ComposedBlueprint>): ComposedBlueprint {
  return {
    intakeQuestions: [],
    decisions: [],
    securityRules: [],
    envVars: [],
    dataEntities: [],
    acceptanceCriteria: [],
    nonGoals: [],
    localServices: [],
    buildTools: [],
    ...partial,
  };
}

describe('ENV_VAR_RE', () => {
  it('accepts UPPER_SNAKE names starting with a letter', () => {
    expect(ENV_VAR_RE.test('STRIPE_SECRET_KEY')).toBe(true);
    expect(ENV_VAR_RE.test('DATABASE_URL')).toBe(true);
    expect(ENV_VAR_RE.test('A')).toBe(true);
  });
  it('rejects lowercase, leading digit, dashes, spaces', () => {
    expect(ENV_VAR_RE.test('stripe_key')).toBe(false);
    expect(ENV_VAR_RE.test('1KEY')).toBe(false);
    expect(ENV_VAR_RE.test('MY-KEY')).toBe(false);
    expect(ENV_VAR_RE.test('MY KEY')).toBe(false);
  });
});

describe('redactSecrets (diagnostic log scrub)', () => {
  it('masks provider key shapes while keeping surrounding prose', () => {
    const key = 'sk_live_' + 'abcdefGH12345678';
    const out = redactSecrets(`error: bad key ${key} returned 401`);
    expect(out).not.toContain(key);
    expect(out).toContain('[redacted]');
    expect(out).toContain('error: bad key');
    expect(out).toContain('returned 401');
  });

  it('masks GitHub tokens, JWTs, and credentials embedded in a URL', () => {
    expect(redactSecrets('token ' + 'ghp_' + '0123456789abcdefghijABCDEFGHIJ012345')).not.toContain('ghp_');
    expect(
      redactSecrets('db: postgres://admin:s3cr3tP4ss@db.example.com/app'),
    ).not.toContain('s3cr3tP4ss');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3.dQw4w9WgXcQsignature';
    const red = redactSecrets(`auth header ${jwt} end`);
    expect(red).not.toContain('eyJzdWIiOiIxMjM0NTY3');
    expect(red).toContain('[redacted]');
  });

  it('masks a bare high-entropy token but leaves ordinary words alone', () => {
    const token = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'; // 32 chars, mixed classes
    expect(redactSecrets(`output ${token} done`)).toBe('output [redacted] done');
    expect(redactSecrets('just a normal sentence with short words')).toBe(
      'just a normal sentence with short words',
    );
  });

  it('is a no-op on empty / non-string input', () => {
    expect(redactSecrets('')).toBe('');
    expect(redactSecrets(undefined)).toBe('');
    expect(redactSecrets(null)).toBe('');
  });
});

describe('isValueShaped', () => {
  it('flags real secret/key shapes', () => {
    expect(isValueShaped('sk_live_' + 'abcdefghijklmnop')).toBe(true);
    expect(isValueShaped('ghp_' + '0123456789abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(isValueShaped('AKIAIOSFODNN7EXAMPLE')).toBe(true);
    expect(isValueShaped('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
    expect(isValueShaped('postgres://app:devpass@localhost:5432/app')).toBe(true);
    expect(isValueShaped('eyJhbGciOi.eyJzdWIiOiIxMjM0NTY.SflKxwRJSMeKKF2QT4')).toBe(true);
    expect(isValueShaped('xoxb-' + '123456789012-abcdefghijklmno')).toBe(true);
    // a bare high-entropy token
    expect(isValueShaped('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0')).toBe(true);
    // previously-bypassing shapes (review-caught): 32-char hex, lower+digit key, UUID
    expect(isValueShaped('d41d8cd98f00b204e9800998ecf8427e')).toBe(true);
    expect(isValueShaped('sk1234567890abcdef1234567890abcd')).toBe(true);
    expect(isValueShaped('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });
  it('does NOT flag ordinary prose / names / dashboard URLs', () => {
    expect(isValueShaped('Stripe secret key')).toBe(false);
    expect(isValueShaped('Server-side Stripe API calls')).toBe(false);
    expect(isValueShaped('Stripe dashboard → Developers → API keys')).toBe(false);
    expect(isValueShaped('https://dashboard.stripe.com/apikeys')).toBe(false);
    expect(isValueShaped('payments service')).toBe(false);
    expect(isValueShaped('')).toBe(false);
  });
});

describe('sanitizeSecretEntry', () => {
  it('rejects a bad env-var name', () => {
    expect(sanitizeSecretEntry({ envVar: 'lower_case' })).toBeNull();
    expect(sanitizeSecretEntry({ envVar: '' })).toBeNull();
    expect(sanitizeSecretEntry({})).toBeNull();
  });
  it('defaults required=true and falls back name→envVar', () => {
    const e = sanitizeSecretEntry({ envVar: 'STRIPE_SECRET_KEY' });
    expect(e).not.toBeNull();
    expect(e?.name).toBe('STRIPE_SECRET_KEY');
    expect(e?.required).toBe(true);
    expect(e?.stages).toEqual(['production']);
    expect(e?.destinations).toEqual([]);
  });
  it('filters stages/destinations to the allow-lists', () => {
    const e = sanitizeSecretEntry({
      envVar: 'DATABASE_URL',
      stages: ['local', 'bogus'],
      destinations: ['env-local', 'evil-store'],
    });
    expect(e?.stages).toEqual(['local']);
    expect(e?.destinations).toEqual(['env-local']);
  });
  it('drops a value-shaped optional field but keeps the entry', () => {
    const e = sanitizeSecretEntry({
      envVar: 'STRIPE_SECRET_KEY',
      description: 'sk_live_' + 'abcdefghijklmnopqrstuv',
      consumedBy: 'payments',
    });
    expect(e).not.toBeNull();
    expect(e?.description).toBeUndefined();
    expect(e?.consumedBy).toBe('payments');
  });
  it('rejects the whole entry when the name itself is a value', () => {
    expect(
      sanitizeSecretEntry({ envVar: 'STRIPE_SECRET_KEY', name: 'sk_live_' + 'abcdefghijklmnopqrstuv' }),
    ).toBeNull();
  });
  it('rejects a value-shaped envVar that still matches ENV_VAR_RE (all-caps key/hex)', () => {
    expect(sanitizeSecretEntry({ envVar: 'AKIAIOSFODNN7EXAMPLE' })).toBeNull();
    expect(sanitizeSecretEntry({ envVar: 'DEADBEEFDEADBEEFDEADBEEFDEADBEEF' })).toBeNull();
  });
});

describe('sanitizeManifest', () => {
  it('dedups by envVar and drops invalid entries', () => {
    const m = sanitizeManifest({
      secrets: [
        { envVar: 'A_KEY' },
        { envVar: 'A_KEY', name: 'dup' },
        { envVar: 'bad' },
        'nonsense',
      ],
    });
    expect(m.secrets.map((s) => s.envVar)).toEqual(['A_KEY']);
  });
  it('returns empty for non-array input', () => {
    expect(sanitizeManifest({}).secrets).toEqual([]);
    expect(sanitizeManifest(null).secrets).toEqual([]);
  });
});

describe('classifySecret', () => {
  it('treats KEY/SECRET/TOKEN/PASSWORD and credential connection strings as secrets', () => {
    expect(classifySecret('STRIPE_SECRET_KEY')).toBe(true);
    expect(classifySecret('AUTH_CLIENT_SECRET')).toBe(true);
    expect(classifySecret('POSTMARK_SERVER_TOKEN')).toBe(true);
    expect(classifySecret('DATABASE_URL')).toBe(true);
    expect(classifySecret('REDIS_URL')).toBe(true);
  });
  it('treats plain config as NOT secret', () => {
    expect(classifySecret('APP_BASE_URL')).toBe(false);
    expect(classifySecret('AUTH_ISSUER')).toBe(false);
    expect(classifySecret('STRIPE_PRICE_ID')).toBe(false);
    expect(classifySecret('ALLOWED_ORIGIN')).toBe(false);
    expect(classifySecret('STORAGE_REGION')).toBe(false);
  });
});

describe('deriveSecretsFromBlueprint', () => {
  it('includes secrets + local connection envs, excludes plain config, dedups', () => {
    const m = deriveSecretsFromBlueprint(
      composed({
        envVars: ['STRIPE_SECRET_KEY', 'APP_BASE_URL', 'DATABASE_URL', 'STRIPE_PRICE_ID'],
        localServices: [
          { service: 'PostgreSQL database', localVia: 'docker-compose', connectionEnv: 'DATABASE_URL' },
        ],
      }),
    );
    const byEnv = Object.fromEntries(m.map((s) => [s.envVar, s]));
    expect(Object.keys(byEnv).sort()).toEqual(['DATABASE_URL', 'STRIPE_SECRET_KEY']);
    // local connection env tagged local / env-local
    expect(byEnv.DATABASE_URL.stages).toEqual(['local']);
    expect(byEnv.DATABASE_URL.destinations).toEqual(['env-local']);
    // a real secret defaults to production / no destination chosen yet
    expect(byEnv.STRIPE_SECRET_KEY.stages).toEqual(['production']);
    expect(byEnv.STRIPE_SECRET_KEY.destinations).toEqual([]);
    expect(byEnv.STRIPE_SECRET_KEY.name).toBe('Stripe secret key');
  });
  it('returns [] for a no-blueprint project (byte-identical prompts)', () => {
    expect(deriveSecretsFromBlueprint(composed({}))).toEqual([]);
  });
});

describe('buildSecretsManifestPromptBlock', () => {
  it('returns empty string when there are no secrets', () => {
    expect(buildSecretsManifestPromptBlock({ schemaVersion: 1, secrets: [] })).toBe('');
  });
  it('lists names + stages + destinations and never asks for a value', () => {
    const block = buildSecretsManifestPromptBlock({
      schemaVersion: 1,
      secrets: [
        { name: 'Stripe', envVar: 'STRIPE_SECRET_KEY', stages: ['production'], destinations: ['github-actions'], required: true },
      ],
    });
    expect(block).toContain('STRIPE_SECRET_KEY');
    expect(block).toContain('NAMES ONLY');
    expect(block.toLowerCase()).not.toContain('paste the value');
  });
});

describe('buildPushScript', () => {
  const script = buildPushScript({
    schemaVersion: 1,
    secrets: [
      { name: 'Stripe', envVar: 'STRIPE_SECRET_KEY', stages: ['production'], destinations: ['github-actions', 'doppler'], required: true },
      { name: 'DB', envVar: 'DATABASE_URL', stages: ['local'], destinations: ['env-local'], required: true },
    ],
  });
  it('delivers values via stdin, never on argv', () => {
    expect(script).toContain('prompt_value "STRIPE_SECRET_KEY" | gh secret set "STRIPE_SECRET_KEY"');
    expect(script).toContain('read -r -s');
    // no argv value-delivery forms anywhere
    expect(script).not.toMatch(/--body\s+["$]/);
    expect(script).not.toMatch(/--value\s+["$]/);
    expect(script).not.toMatch(/--secret-string\s+["$]/);
    expect(script).not.toMatch(/secrets set [A-Z_]+=/);
  });
  it('hardens the shell and documents the never-on-argv rule', () => {
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('umask 077');
    expect(script).toContain('NAMES ONLY');
  });
  it('routes local-only secrets to .env.local, not a cloud store', () => {
    expect(script).toContain('.env.local');
    expect(script).toContain('DATABASE_URL=<your local value>');
  });
});
