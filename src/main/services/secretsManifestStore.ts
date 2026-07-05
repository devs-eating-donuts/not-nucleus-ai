import fs from 'node:fs/promises';
import path from 'node:path';
import { META_FILES } from '../../shared/markdown';
import { composeBlueprint } from '../../shared/blueprints';
import {
  PUSH_SCRIPT_PATH,
  buildPushScript,
  buildSecretsManifestPromptBlock,
  deriveSecretsFromBlueprint,
  sanitizeManifest,
} from '../../shared/secrets';
import type { SecretEntry, SecretsManifest } from '../../shared/secrets';
import { readProjectInfo, resolveWorkspacePath } from './markdownWorkspace';
import { writeFileAtomic, writeJsonAtomic } from './atomicWrite';

/**
 * The names-only secrets manifest for a built app, on disk at
 * .nucleus/secrets-manifest.json. NAMES ONLY — every read AND write runs through
 * sanitizeManifest, so a value-shaped field a hand-edit smuggled in is neutralized.
 * The store has NO value surface (no getValue/setValue) by design.
 *
 * All paths resolve through resolveWorkspacePath; the manifest is created lazily on
 * first write (no init seed), so its absence is a healthy "no secrets yet" state.
 */

function manifestPath(workspacePath: string): string {
  return resolveWorkspacePath(workspacePath, META_FILES.secretsManifest);
}

export async function readManifest(workspacePath: string): Promise<SecretsManifest> {
  try {
    const raw = await fs.readFile(manifestPath(workspacePath), 'utf8');
    return sanitizeManifest(JSON.parse(raw));
  } catch {
    return { schemaVersion: 1, secrets: [] };
  }
}

export async function writeManifest(
  workspacePath: string,
  manifest: { secrets: SecretEntry[] },
): Promise<SecretsManifest> {
  const clean = sanitizeManifest(manifest);
  await writeJsonAtomic(manifestPath(workspacePath), clean);
  return clean;
}

/**
 * The manifest to ACT on: the stored one if it has entries, otherwise the set
 * derived from the project's blueprint (so the prompt block + push script are
 * useful immediately, before anyone customizes it). Best-effort — never throws.
 */
export async function effectiveManifest(workspacePath: string): Promise<SecretsManifest> {
  const stored = await readManifest(workspacePath);
  if (stored.secrets.length > 0) {
    return stored;
  }
  try {
    const info = await readProjectInfo(workspacePath);
    const composed = composeBlueprint(info?.templateId, info?.overlayIds ?? []);
    return { schemaVersion: 1, secrets: deriveSecretsFromBlueprint(composed) };
  } catch {
    return { schemaVersion: 1, secrets: [] };
  }
}

/** Re-derive from the project's blueprint and MERGE with stored (keep user edits). */
export async function deriveFromBlueprint(workspacePath: string): Promise<SecretsManifest> {
  const stored = await readManifest(workspacePath);
  let derived: SecretEntry[] = [];
  try {
    const info = await readProjectInfo(workspacePath);
    const composed = composeBlueprint(info?.templateId, info?.overlayIds ?? []);
    derived = deriveSecretsFromBlueprint(composed);
  } catch {
    derived = [];
  }
  const byEnv = new Map<string, SecretEntry>();
  for (const d of derived) {
    byEnv.set(d.envVar, d);
  }
  // Stored entries WIN (the user/team refined them); derived ones fill the gaps.
  for (const s of stored.secrets) {
    byEnv.set(s.envVar, s);
  }
  return writeManifest(workspacePath, { secrets: [...byEnv.values()] });
}

/**
 * Write the FIXED push-script skeleton to scripts/push-secrets.sh (Phase 2 entry
 * point). The app writes it (never the CLI); names-only, value-on-stdin form.
 */
export async function generatePushScript(workspacePath: string): Promise<string> {
  const manifest = await effectiveManifest(workspacePath);
  const abs = resolveWorkspacePath(workspacePath, PUSH_SCRIPT_PATH);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await writeFileAtomic(abs, buildPushScript(manifest));
  return PUSH_SCRIPT_PATH;
}

/**
 * The "SECRETS MANIFEST" prompt block for the planning/design personas, or '' when
 * the project has no secrets (so prompts stay byte-identical). Best-effort — a read
 * hiccup yields '' and never breaks a turn. Used by the room, whiteboard, and
 * Bullpen engines, mirroring referencesPromptBlock.
 */
export async function secretsManifestPromptBlock(workspacePath: string): Promise<string> {
  try {
    const manifest = await effectiveManifest(workspacePath);
    return buildSecretsManifestPromptBlock(manifest);
  } catch {
    return '';
  }
}
