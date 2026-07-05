/**
 * Secrets management for the apps the team BUILDS — the pure model (no I/O).
 *
 * The load-bearing invariant: the AI and the app NEVER see, log, or store a
 * secret VALUE. This module deals only in NAMES + metadata — env-var names, which
 * env stage needs them, and where their (production) values get pushed. Values
 * travel founder → store directly, over stdin, never through here.
 *
 * Design: docs/design/secrets-management.md. Mirrors references.ts / blueprints.ts:
 * pure types + validators + a prompt-block builder, plus the FIXED push-script
 * skeleton (the AI fills in names only — it never authors the shell).
 */

import type { ComposedBlueprint } from './blueprints';

/** Where a production/preview value gets pushed. `env-local` = a gitignored local file. */
export const SECRET_DESTINATIONS = [
  'github-actions', // gh secret set
  'azure-keyvault', // az keyvault secret set
  'aws-secrets-manager', // aws secretsmanager put-secret-value
  'doppler', // doppler secrets set
  'sops', // SOPS + age, encrypted-at-rest in the repo
  'env-local', // gitignored .env.local (local dev only)
] as const;
export type SecretDestination = (typeof SECRET_DESTINATIONS)[number];

export const SECRET_STAGES = ['local', 'preview', 'production'] as const;
export type SecretStage = (typeof SECRET_STAGES)[number];

/** Human labels for the UI (the on-disk values stay the slugs above). */
export const SECRET_DESTINATION_LABELS: Record<SecretDestination, string> = {
  'github-actions': 'GitHub Actions',
  'azure-keyvault': 'Azure Key Vault',
  'aws-secrets-manager': 'AWS Secrets Manager',
  doppler: 'Doppler',
  sops: 'SOPS + age (encrypted in git)',
  'env-local': 'Local .env.local',
};

/** One secret the built app needs — NAME + metadata only, never a value. */
export interface SecretEntry {
  /** Human label, e.g. "Stripe secret key". */
  name: string;
  /** The env-var NAME, e.g. STRIPE_SECRET_KEY. */
  envVar: string;
  /** What it's for — NEVER a value. */
  description?: string;
  /** Which env stages need it. */
  stages: SecretStage[];
  /** Where prod/preview values are pushed (may be empty until the founder chooses). */
  destinations: SecretDestination[];
  /** App won't run without it. */
  required: boolean;
  /** Service/component that reads it (free text). */
  consumedBy?: string;
  /** WHERE to get the value (e.g. a dashboard URL) — for an un-provisioned secret. */
  acquireHint?: string;
}

export interface SecretsManifest {
  schemaVersion: 1;
  secrets: SecretEntry[];
}

/** Bounded env-var-name validator (UPPER_SNAKE, starts with a letter). */
export const ENV_VAR_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

// Field length caps — these are labels/notes, never values.
const NAME_MAX = 80;
const DESC_MAX = 200;
const CONSUMED_MAX = 80;
const ACQUIRE_MAX = 200;

/**
 * The value-rejection guard: does this string smell like a real secret value?
 * Used on write AND read so a hand-edited manifest can't smuggle a value into a
 * label/note field. Deliberately conservative on prose (a sentence has spaces, so
 * its longest token stays short) but catches known key shapes and bare high-entropy
 * tokens. It is NOT a substitute for the architecture (no value should ever reach
 * here) — it's a tripwire.
 */
export function isValueShaped(s: unknown): boolean {
  if (typeof s !== 'string') {
    return false;
  }
  const t = s.trim();
  if (t === '') {
    return false;
  }
  // A URL authority with embedded credentials: scheme://user:pass@host
  if (/[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(t)) {
    return true;
  }
  // Known provider key/token shapes.
  if (/(?:^|[^A-Za-z0-9])(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/.test(t)) {
    return true;
  }
  if (/(?:^|[^A-Za-z0-9])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/.test(t)) {
    return true;
  }
  if (/github_pat_[A-Za-z0-9_]{20,}/.test(t)) {
    return true;
  }
  if (/(?:^|[^A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/.test(t)) {
    return true;
  }
  if (/(?:^|[^A-Za-z0-9])AKIA[0-9A-Z]{12,}/.test(t)) {
    return true;
  }
  if (/(?:^|[^A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}/.test(t)) {
    return true;
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t)) {
    return true;
  }
  // A JWT (three base64url segments).
  if (/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/.test(t)) {
    return true;
  }
  // A bare high-entropy token. Prose splits into many short tokens; a pasted key
  // is one long run of secret-ish chars. Check each whitespace-token so a label or
  // a dashboard URL embedded in a sentence doesn't trip it.
  for (const token of t.split(/\s+/)) {
    if (looksLikeBareToken(token)) {
      return true;
    }
  }
  return false;
}

/**
 * Does a single whitespace-delimited token look like a bare secret value? A long
 * hex/base32 run, a UUID, or a multi-class high-entropy string (the API-key
 * signature). Skips URLs (they carry ':' / '://') so a dashboard link isn't flagged.
 */
function looksLikeBareToken(token: string): boolean {
  if (token.length < 24 || token.includes('://')) {
    return false;
  }
  // Only consider "bare" tokens — letters/digits and a few key-safe punctuation
  // chars. A ':' (URLs), spaces, etc. disqualify it.
  if (!/^[A-Za-z0-9+/=_.-]+$/.test(token)) {
    return false;
  }
  // A long single-charset hex run (MD5/SHA/hex key) — incl. UUID once dashes drop.
  const dehyphenated = token.replace(/-/g, '');
  if (dehyphenated.length >= 32 && /^[0-9a-fA-F]+$/.test(dehyphenated)) {
    return true;
  }
  const classes =
    (/[a-z]/.test(token) ? 1 : 0) + (/[A-Z]/.test(token) ? 1 : 0) + (/[0-9]/.test(token) ? 1 : 0);
  // ≥32 chars with ≥2 classes (e.g. lower+digit api keys) or ≥24 chars with ≥3.
  if ((token.length >= 32 && classes >= 2) || (token.length >= 24 && classes >= 3)) {
    return true;
  }
  return false;
}

const REDACTED = '[redacted]';

/** Global-match variants of the known key/token shapes, for masking within free text. */
const SECRET_SHAPE_RES: RegExp[] = [
  /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/gi, // credentials in a URL authority
  /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{12,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g,
];

/**
 * Mask secret-shaped substrings/tokens in FREE TEXT — used to scrub the diagnostic
 * invocation log's fields (the CLI output tail, error text, prompt first-line) so a
 * pasted key in a CLI's output never lands on disk or crosses the Garage IPC. Replaces
 * known provider key/token shapes and bare high-entropy tokens with `[redacted]`,
 * leaving surrounding prose intact so the log stays useful. Pure; never throws.
 */
export function redactSecrets(text: unknown): string {
  if (typeof text !== 'string' || text === '') {
    return typeof text === 'string' ? text : '';
  }
  let out = text;
  for (const re of SECRET_SHAPE_RES) {
    out = out.replace(re, REDACTED);
  }
  // Bare high-entropy tokens, per whitespace-delimited run (the split keeps the
  // whitespace so the rejoin is loss-less); prose tokens are short and untouched.
  return out
    .split(/(\s+)/)
    .map((tok) => (looksLikeBareToken(tok) ? REDACTED : tok))
    .join('');
}

function cleanField(value: unknown, cap: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim().slice(0, cap);
}

function sanitizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T[],
): T[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const out = [...new Set(value.filter((v): v is T => typeof v === 'string' && (allowed as readonly string[]).includes(v)))];
  return out.length > 0 ? out : [...fallback];
}

/**
 * Reduce untrusted input to a safe SecretEntry, or null if it can't be trusted.
 * Validates envVar against ENV_VAR_RE; filters stages/destinations to the
 * allow-lists; and DROPS any optional label/note field that looks value-shaped
 * (rather than failing the whole entry), while rejecting the entry outright if the
 * required name itself looks like a value. Run on both write and read.
 */
export function sanitizeSecretEntry(raw: unknown): SecretEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const envVar = typeof r.envVar === 'string' ? r.envVar.trim() : '';
  if (!ENV_VAR_RE.test(envVar)) {
    return null;
  }
  // ENV_VAR_RE alone accepts all-caps value shapes (AWS key ids, uppercase hex). The
  // envVar is only ever used as a NAME (never transmitted as a value), but a
  // value-shaped one would land in the committed manifest + push script — reject it.
  if (isValueShaped(envVar)) {
    return null;
  }
  const name = cleanField(r.name, NAME_MAX) || envVar;
  if (isValueShaped(name)) {
    return null;
  }
  const entry: SecretEntry = {
    name,
    envVar,
    stages: sanitizeEnum(r.stages, SECRET_STAGES, ['production']),
    destinations: sanitizeEnum(r.destinations, SECRET_DESTINATIONS, []),
    required: r.required !== false,
  };
  const description = cleanField(r.description, DESC_MAX);
  if (description && !isValueShaped(description)) {
    entry.description = description;
  }
  const consumedBy = cleanField(r.consumedBy, CONSUMED_MAX);
  if (consumedBy && !isValueShaped(consumedBy)) {
    entry.consumedBy = consumedBy;
  }
  const acquireHint = cleanField(r.acquireHint, ACQUIRE_MAX);
  if (acquireHint && !isValueShaped(acquireHint)) {
    entry.acquireHint = acquireHint;
  }
  return entry;
}

/** Validate a whole manifest, dropping any entry that can't be trusted. */
export function sanitizeManifest(raw: unknown): SecretsManifest {
  const list = (raw as { secrets?: unknown })?.secrets;
  if (!Array.isArray(list)) {
    return { schemaVersion: 1, secrets: [] };
  }
  const seen = new Set<string>();
  const secrets: SecretEntry[] = [];
  for (const item of list) {
    const entry = sanitizeSecretEntry(item);
    if (entry && !seen.has(entry.envVar)) {
      seen.add(entry.envVar);
      secrets.push(entry);
    }
  }
  return { schemaVersion: 1, secrets };
}

/** Turn `STRIPE_SECRET_KEY` into `Stripe secret key`. */
export function humanizeEnvVar(envVar: string): string {
  const words = envVar.toLowerCase().split('_').filter(Boolean);
  if (words.length === 0) {
    return envVar;
  }
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

const SECRET_NAME_RE = /(SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|API_?KEY)/;
const CONNECTION_ENV_RE = /(DATABASE_URL|DB_URL|DATABASE_URI|REDIS_URL|CONNECTION_STRING|DSN)$/;

/**
 * Heuristic: is this env-var name a SECRET (vs. plain config)? By name only —
 * `STRIPE_SECRET_KEY`/`AUTH_CLIENT_SECRET` yes; `APP_BASE_URL`/`AUTH_ISSUER`/
 * `STRIPE_PRICE_ID` no. Connection strings that embed credentials count.
 */
export function classifySecret(envVar: string): boolean {
  const n = envVar.toUpperCase();
  return SECRET_NAME_RE.test(n) || CONNECTION_ENV_RE.test(n);
}

/**
 * Seed manifest entries from a composed blueprint. Includes only the env-vars that
 * are SECRETS (by name) or a local-service connection env (which carries dev creds)
 * — plain config (base URLs, ids, regions) is excluded. `connectionEnv` is a TAG
 * marking which env-vars are local-stage (it's already a subset of `envVars`, so we
 * never double-count). Pure: the same blueprint always yields the same entries.
 */
export function deriveSecretsFromBlueprint(composed: ComposedBlueprint): SecretEntry[] {
  const localEnvs = new Set(composed.localServices.map((s) => s.connectionEnv));
  const out: SecretEntry[] = [];
  const seen = new Set<string>();
  for (const envVar of composed.envVars) {
    if (!ENV_VAR_RE.test(envVar) || seen.has(envVar)) {
      continue;
    }
    const isLocal = localEnvs.has(envVar);
    if (!isLocal && !classifySecret(envVar)) {
      continue; // plain config, not a secret
    }
    seen.add(envVar);
    out.push({
      name: humanizeEnvVar(envVar),
      envVar,
      stages: isLocal ? ['local'] : ['production'],
      destinations: isLocal ? ['env-local'] : [],
      required: true,
    });
  }
  return out;
}

/**
 * The "SECRETS MANIFEST" block injected into a planning/design persona's prompt.
 * Names-only — lists each secret + stage + destination and instructs the team to
 * keep the names-only manifest, generate the push script, and ASK the founder which
 * store each non-local secret targets. Returns '' when empty so prompts stay
 * byte-identical for projects without secrets.
 */
export function buildSecretsManifestPromptBlock(manifest: SecretsManifest): string {
  if (manifest.secrets.length === 0) {
    return '';
  }
  const lines = manifest.secrets.map((s) => {
    const dest = s.destinations.length > 0 ? s.destinations.join(', ') : 'CHOOSE A STORE WITH THE FOUNDER';
    return `- ${s.envVar} (${s.stages.join('/')}) → ${dest}${s.required ? '' : ' [optional]'}`;
  });
  return [
    '',
    '',
    'SECRETS this product needs (NAMES ONLY — you must NEVER ask for, generate, log, or',
    'commit a real value; the founder supplies values out-of-band at deploy time):',
    ...lines,
    'Plan a setup task to: (1) keep the names-only manifest (.nucleus/secrets-manifest.json),',
    '(2) write .env.example with these names (no values), and (3) generate a push script the',
    'FOUNDER runs to set each value via stdin (never argv/logs). For each non-local secret,',
    'ASK the founder which store it targets (GitHub Actions / Azure Key Vault / AWS Secrets',
    'Manager / Doppler / SOPS). Local-stage secrets go in a gitignored .env.local, not a cloud store.',
  ].join('\n');
}

/* ----- the FIXED push-script skeleton (AI fills NAMES only, never the shell) ----- */

const PUSH_FNS: Partial<Record<SecretDestination, (envVar: string, stage: SecretStage) => string>> = {
  'github-actions': (e, stage) =>
    `  prompt_value "${e}" | gh secret set "${e}"${stage === 'production' ? '' : ` --env "${stage}"`} >/dev/null && ok "${e}" "GitHub Actions (${stage})"`,
  doppler: (e, stage) =>
    `  prompt_value "${e}" | doppler secrets set "${e}" --silent >/dev/null && ok "${e}" "Doppler (${stage})"`,
};

// Destinations whose push needs founder-supplied config (vault/region/key) we don't
// hold — emitted as a SAFE, value-on-stdin/file template the founder completes.
const PUSH_TEMPLATES: Partial<Record<SecretDestination, (envVar: string) => string[]>> = {
  'azure-keyvault': (e) => [
    `  # ${e} → Azure Key Vault: fill in <vault>, then (value via --file, never --value):`,
    `  #   f=$(mktemp); trap 'rm -f "$f"' EXIT; read -r -s -p "value for ${e}: " v; printf %s "$v" >"$f"; echo`,
    `  #   az keyvault secret set --vault-name <vault> --name "${e}" --file "$f" --output none`,
  ],
  'aws-secrets-manager': (e) => [
    `  # ${e} → AWS Secrets Manager (value via a 0600 file, never --secret-string "$v"):`,
    `  #   f=$(mktemp); trap 'rm -f "$f"' EXIT; read -r -s -p "value for ${e}: " v; printf %s "$v" >"$f"; echo`,
    `  #   aws secretsmanager put-secret-value --secret-id "${e}" --secret-string "file://$f"`,
  ],
  sops: (e) => [
    `  # ${e} → SOPS+age: keep the age PRIVATE key out of git; edit encrypted values with:`,
    `  #   sops secrets/${e === e ? 'prod' : 'prod'}.enc.yaml   # opens $EDITOR; commit only the ENCRYPTED file`,
  ],
};

/**
 * Generate `scripts/push-secrets.sh` from the manifest — a FIXED, audited skeleton.
 * The manifest only parameterizes the env-var NAMES + destinations; the shell is a
 * constant template. Every value is read with `read -s` and piped to the store over
 * STDIN — never on argv, never written to a tracked file, never logged. POSIX/bash.
 */
export function buildPushScript(manifest: SecretsManifest): string {
  const cloud = manifest.secrets.filter((s) => s.destinations.some((d) => d !== 'env-local'));
  const local = manifest.secrets.filter((s) => s.destinations.includes('env-local'));
  // The blueprint-derived default for non-local secrets is NO destination — those used
  // to vanish from the script entirely while it claimed "No cloud-pushed secrets".
  const unrouted = manifest.secrets.filter((s) => s.destinations.length === 0);
  const lines: string[] = [
    '#!/usr/bin/env bash',
    '#',
    '# GENERATED by Nucleus-AI from .nucleus/secrets-manifest.json — NAMES ONLY.',
    '# You (the founder) supply the values when you run this. Each value is read',
    '# privately and piped to the store over STDIN — it is never placed on the',
    '# command line (which leaks via `ps` and shell history), never written to a',
    '# file in this repo, and never logged. The AI never sees these values.',
    '#',
    '# Prerequisite: the relevant CLI is installed AND already authenticated by you',
    '# (gh / doppler / az / aws). This script does not handle store auth.',
    '',
    'set -euo pipefail',
    'umask 077',
    '',
    'ok() { echo "  ✓ $1 → $2"; }',
    '# Read a value with no echo; emit it on stdout for a pipe; never store it on disk.',
    'prompt_value() { local __v; read -r -s -p "  value for $1: " __v; echo >&2; printf %s "$__v"; }',
    '',
    'echo "Pushing secrets — values go straight to the store, never to disk or logs."',
    '',
  ];

  if (cloud.length === 0) {
    lines.push(
      unrouted.length > 0
        ? `echo "No destination chosen yet for ${unrouted.length} secret(s) — pick one per secret in The Vault, then regenerate this script."`
        : 'echo "No cloud-pushed secrets in the manifest."',
    );
  }
  if (unrouted.length > 0) {
    lines.push('', '# NO DESTINATION chosen yet — these are in the manifest but pushed NOWHERE.');
    lines.push('# Pick a store per secret in The Vault, then regenerate this script:');
    for (const s of unrouted) {
      lines.push(`#   - ${s.envVar}`);
    }
    lines.push('');
  }
  for (const s of cloud) {
    // Defense-in-depth: even though sanitize rejects value-shaped names/hints, never
    // interpolate one into the committed script — fall back to the env-var name.
    const safeName = isValueShaped(s.name) ? s.envVar : s.name;
    const safeHint = s.acquireHint && !isValueShaped(s.acquireHint) ? s.acquireHint : '';
    lines.push(`# ${safeName}${safeHint ? ` — get it from: ${safeHint}` : ''}`);
    for (const dest of s.destinations) {
      if (dest === 'env-local') {
        continue;
      }
      const fn = PUSH_FNS[dest];
      if (fn) {
        for (const stage of s.stages.filter((st) => st !== 'local')) {
          lines.push(fn(s.envVar, stage));
        }
      } else {
        const tmpl = PUSH_TEMPLATES[dest];
        if (tmpl) {
          lines.push(...tmpl(s.envVar));
        }
      }
    }
    lines.push('');
  }

  if (local.length > 0) {
    lines.push('# Local-only secrets — put these in a gitignored .env.local (NOT a cloud store):');
    for (const s of local) {
      lines.push(`#   ${s.envVar}=<your local value>`);
    }
    lines.push('');
  }

  lines.push('echo "Done. Re-run any time to update a value."');
  lines.push('');
  return lines.join('\n');
}

/** Workspace-relative path the generated push script is written to. */
export const PUSH_SCRIPT_PATH = 'scripts/push-secrets.sh';
