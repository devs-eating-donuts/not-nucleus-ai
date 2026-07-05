/**
 * Persona image vault (renderer side). The locked-cast portraits ship ONLY as
 * AES-GCM ciphertext (src/renderer/assets/vault/**.enc + manifest.json). This
 * decrypts a tier's blobs into in-memory object URLs once its scavenger-hunt
 * answer (the key) is supplied — so the plaintext likeness never exists on disk
 * or in the bundle, only after a clue is cracked. See src/shared/imageVault.ts
 * and docs/design/character-modes.md.
 */
import { deriveTierKey, decryptBytes } from '../../shared/imageVault';
import type { VaultTier, VaultManifest } from '../../shared/imageVault';
import manifestJson from '../assets/vault/manifest.json';

const manifest = manifestJson as VaultManifest;

// Build-time URLs of the encrypted blobs, keyed by their path relative to the
// vault dir ("cover/richard-henderstack.webp.enc"). Bytes are fetched + decrypted
// at runtime; the plaintext is never emitted to disk or bundled.
const encUrls = import.meta.glob('../assets/vault/**/*.enc', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const URL_BY_PATH: Record<string, string> = {};
for (const [full, url] of Object.entries(encUrls)) {
  const rel = full.split('/vault/')[1];
  if (rel) {
    URL_BY_PATH[rel] = url;
  }
}

function mimeFor(pathRel: string): string {
  const base = pathRel.replace(/\.enc$/i, '');
  if (/\.webp$/i.test(base)) return 'image/webp';
  if (/\.png$/i.test(base)) return 'image/png';
  return 'image/jpeg';
}

/**
 * Decrypt every portrait of a tier with its trivia answer. Returns a map of
 * PersonaAvatar portrait key -> blob object URL. A wrong answer / tampered blob
 * throws in decrypt (GCM auth) and that entry is skipped — the avatar simply
 * falls back to initials, so a bad key degrades gracefully rather than erroring.
 */
export async function unlockTier(
  tier: VaultTier,
  answer: string,
): Promise<Record<string, string>> {
  const key = await deriveTierKey(tier, answer);
  const out: Record<string, string> = {};
  for (const entry of manifest.entries) {
    if (entry.tier !== tier) {
      continue;
    }
    const url = URL_BY_PATH[entry.path];
    if (!url) {
      continue;
    }
    try {
      const response = await fetch(url);
      const cipher = new Uint8Array(await response.arrayBuffer());
      const plain = await decryptBytes(key, cipher);
      out[entry.key] = URL.createObjectURL(
        new Blob([plain as BlobPart], { type: mimeFor(entry.path) }),
      );
    } catch {
      // wrong key / tampered blob / fetch failure — skip; the avatar shows initials.
    }
  }
  return out;
}
