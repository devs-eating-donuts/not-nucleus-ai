/**
 * Image vault — the locked-cast persona portraits (show likenesses) ship ONLY as
 * AES-GCM ciphertext. The decryption key is derived from the scavenger-hunt answer
 * for that tier (the answer IS the key), so:
 *   - the public repo contains no viewable likeness, only opaque `.enc` blobs;
 *   - the app reveals a tier's art only after its clue is cracked.
 *
 * The answers are never stored in the repo (only their SHA-256 hashes are, for
 * verification — see easterEggs.ts). This turns the old soft gate (hides the
 * answer, not the assets) into a real vault (assets undecryptable without the
 * answer). Pure Web Crypto — the SAME code runs in the renderer AND in the Node
 * build tool (scripts/vault-tool.ts), so encryption and decryption can never drift.
 *
 * HONEST LIMIT: the answers are short, low-entropy trivia phrases, so a determined
 * attacker could brute-force the KDF. This is strong against casual browsing and
 * automated scanners (the real exposure concern) — it is not a hard vault against
 * someone truly motivated (who can watch the show anyway). The slow KDF raises the
 * cost. See docs/design/character-modes.md.
 */
import type { NamingMode } from './naming';
import { normalizeAnswer } from './easterEggs';

/** The three lockable tiers (everything except the always-open `pete`). */
export type VaultTier = Exclude<NamingMode, 'pete'>;

/**
 * Public, per-tier salt — the SECRET is the answer, never the salt. Fixed strings
 * so the encrypt tool and the runtime derive identical keys. A distinct salt per
 * tier means cracking one tier's answer can only decrypt that tier.
 */
const TIER_SALT: Record<VaultTier, string> = {
  distinct: 'nucleus-ai.vault.distinct.v1',
  cover: 'nucleus-ai.vault.cover.v1',
  canon: 'nucleus-ai.vault.canon.v1',
};

const PBKDF2_ITERATIONS = 200_000;
const IV_BYTES = 12; // AES-GCM standard nonce length.

const textEncoder = new TextEncoder();

/** Derive a tier's AES-GCM key from its normalized trivia answer. */
export async function deriveTierKey(tier: VaultTier, answer: string): Promise<CryptoKey> {
  const normalized = normalizeAnswer(answer);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(normalized),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: textEncoder.encode(TIER_SALT[tier]),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt plaintext bytes → a self-contained `iv || ciphertext+tag` blob. */
export async function encryptBytes(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext as BufferSource),
  );
  const blob = new Uint8Array(iv.length + cipher.length);
  blob.set(iv, 0);
  blob.set(cipher, iv.length);
  return blob;
}

/**
 * Decrypt an `iv || ciphertext+tag` blob → plaintext bytes. Throws on a wrong key
 * or tampered data (the GCM auth tag fails), which the runtime treats as "this
 * answer/blob didn't work" — no image is shown.
 */
export async function decryptBytes(key: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
  const iv = blob.subarray(0, IV_BYTES) as BufferSource;
  const cipher = blob.subarray(IV_BYTES) as BufferSource;
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
}

/**
 * The vault manifest committed alongside the `.enc` blobs. Safe to commit — it is
 * only filenames + which tier decrypts them, never any secret. `key` matches the
 * PersonaAvatar portrait lookup key (`<id>`, `cartoons/<id>`, `distinct/<id>`);
 * `path` is the blob's location relative to the vault asset dir.
 */
export interface VaultManifestEntry {
  key: string;
  path: string;
  tier: VaultTier;
}
export interface VaultManifest {
  schemaVersion: 1;
  entries: VaultManifestEntry[];
}
