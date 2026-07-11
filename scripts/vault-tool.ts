/**
 * vault-tool — (re)generate the encrypted persona image vault from plaintext
 * source rasters. The locked-cast portraits (show likenesses) ship ONLY as
 * AES-GCM ciphertext under src/renderer/assets/vault/ — the scavenger-hunt
 * trivia answer for a tier IS its decryption key (shared/imageVault.ts owns the
 * crypto; this tool and the renderer share that one implementation so encrypt
 * and decrypt can never drift).
 *
 * Run from the repo root:
 *   npx esbuild scripts/vault-tool.ts --bundle --platform=node --outfile=scratch/vault-tool.cjs
 *   NUCLEUS_VAULT_ANSWER_DISTINCT='…' \
 *   NUCLEUS_VAULT_ANSWER_COVER='…' \
 *   NUCLEUS_VAULT_ANSWER_CANON='…' node scratch/vault-tool.cjs
 *
 * The answers come from env ONLY — never write them into any file. Each answer is
 * verified against its clue's SHA-256 hash (shared/easterEggs.ts) BEFORE anything
 * is encrypted, so a typo cannot produce a vault the runtime can never open. Every
 * written blob is decrypted back and byte-compared against its source raster.
 *
 * Source rasters are read from art/personas-src/ — they are NOT part of this
 * repo (the committed vault ships only ciphertext; the private build environment
 * supplies the plaintext sources):
 *   art/personas-src/<id>.<ext>          → tier `cover`  · key `<id>`
 *     (the real-face photo set — shown by BOTH the cover and canon modes)
 *   art/personas-src/cartoons/<id>.<ext> → tier `distinct` · key `cartoons/<id>`
 *   art/personas-src/distinct/<id>.<ext> → tier `canon`  · key `distinct/<id>`
 *     (the Jian Yang takeover art — locked behind the FINAL clue)
 * The folder names follow PersonaAvatar's historical portrait keys, which is why
 * the `distinct` FOLDER encrypts under the `canon` TIER.
 *
 * Optional: NUCLEUS_VAULT_OUT overrides the output dir (default
 * src/renderer/assets/vault) — useful for a dry-run regeneration to diff against
 * the committed vault.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EASTER_EGG_CLUES, checkAnswer } from '../src/shared/easterEggs';
import { deriveTierKey, encryptBytes, decryptBytes } from '../src/shared/imageVault';
import type { VaultTier, VaultManifest, VaultManifestEntry } from '../src/shared/imageVault';

const SRC_DIR = path.join(process.cwd(), 'art', 'personas-src');
const OUT_DIR =
  process.env.NUCLEUS_VAULT_OUT ?? path.join(process.cwd(), 'src', 'renderer', 'assets', 'vault');

const IMAGE_RE = /\.(webp|png|jpe?g)$/i;

interface TierSpec {
  tier: VaultTier;
  /** Subdir of art/personas-src ('' = the root photo set). */
  srcSubdir: string;
  /** Prefix that turns a file stem into the PersonaAvatar portrait key. */
  keyPrefix: string;
  envVar: string;
}

/** Manifest order matches the shipped vault: distinct → cover → canon. */
const TIERS: TierSpec[] = [
  { tier: 'distinct', srcSubdir: 'cartoons', keyPrefix: 'cartoons/', envVar: 'NUCLEUS_VAULT_ANSWER_DISTINCT' },
  { tier: 'cover', srcSubdir: '', keyPrefix: '', envVar: 'NUCLEUS_VAULT_ANSWER_COVER' },
  { tier: 'canon', srcSubdir: 'distinct', keyPrefix: 'distinct/', envVar: 'NUCLEUS_VAULT_ANSWER_CANON' },
];

async function main(): Promise<void> {
  // 1. Collect + verify the answers before touching anything.
  const answers = new Map<VaultTier, string>();
  const problems: string[] = [];
  for (const spec of TIERS) {
    const answer = process.env[spec.envVar];
    if (!answer || answer.trim() === '') {
      problems.push(`${spec.envVar} is not set (the ${spec.tier}-tier answer)`);
      continue;
    }
    const clue = EASTER_EGG_CLUES.find((c) => c.id === spec.tier);
    if (!clue) {
      problems.push(`no clue found for tier "${spec.tier}" — easterEggs.ts changed shape?`);
      continue;
    }
    if (!(await checkAnswer(clue, answer))) {
      problems.push(
        `${spec.envVar} does not match the ${spec.tier} clue's answer hash — ` +
          'a mistyped answer would produce a vault the app can never decrypt',
      );
      continue;
    }
    answers.set(spec.tier, answer);
  }
  if (problems.length > 0) {
    console.error('vault-tool: refusing to run:');
    for (const p of problems) {
      console.error(`  - ${p}`);
    }
    process.exitCode = 1;
    return;
  }

  // 2. Encrypt every raster; decrypt each written blob back and byte-compare.
  const entries: VaultManifestEntry[] = [];
  let written = 0;
  for (const spec of TIERS) {
    const srcDir = path.join(SRC_DIR, spec.srcSubdir);
    const key = await deriveTierKey(spec.tier, answers.get(spec.tier)!);
    const outTierDir = path.join(OUT_DIR, spec.tier);
    await mkdir(outTierDir, { recursive: true });

    const files = (await readdir(srcDir, { withFileTypes: true }))
      .filter((d) => d.isFile() && IMAGE_RE.test(d.name))
      .map((d) => d.name)
      .sort();
    if (files.length === 0) {
      throw new Error(`no source rasters found in ${srcDir} — run from the repo root`);
    }

    for (const name of files) {
      const plain = new Uint8Array(await readFile(path.join(srcDir, name)));
      const blob = await encryptBytes(key, plain);

      const roundTrip = await decryptBytes(key, blob);
      if (Buffer.compare(Buffer.from(roundTrip), Buffer.from(plain)) !== 0) {
        throw new Error(`round-trip mismatch for ${spec.tier}/${name} — aborting`);
      }

      await writeFile(path.join(outTierDir, `${name}.enc`), blob);
      entries.push({
        key: `${spec.keyPrefix}${name.replace(IMAGE_RE, '')}`,
        path: `${spec.tier}/${name}.enc`,
        tier: spec.tier,
      });
      written += 1;
    }
  }

  // 3. The manifest (filenames + tiers only — safe to commit).
  const manifest: VaultManifest = { schemaVersion: 1, entries };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`vault-tool: wrote ${written} blobs + manifest.json to ${OUT_DIR}`);
  console.log('vault-tool: every blob decrypted back to its source bytes (round-trip verified).');
}

void main().catch((err) => {
  console.error('vault-tool: failed:', err);
  process.exitCode = 1;
});
