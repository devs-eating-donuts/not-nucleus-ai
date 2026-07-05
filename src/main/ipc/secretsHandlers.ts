import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { ENV_VAR_RE } from '../../shared/secrets';
import type { SecretsManifest } from '../../shared/secrets';
import { projectRegistryStore } from '../services/projectRegistryStore';
import {
  deriveFromBlueprint,
  effectiveManifest,
  generatePushScript,
  writeManifest,
} from '../services/secretsManifestStore';

/**
 * Secrets-manifest IPC. NAMES ONLY — there is deliberately no get/set VALUE
 * channel. The renderer sends only a project id + names-only payloads; main
 * resolves the workspace from the registry (never the renderer's claim) and every
 * entry is sanitized in the store (value-shaped entries rejected). Pushing actual
 * values to a store is a founder-run script, not an IPC call (see the design doc).
 */

async function resolveWorkspace(value: unknown): Promise<string> {
  const { id } = (value ?? {}) as { id?: unknown };
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('A project id is required');
  }
  const entry = await projectRegistryStore.get(id);
  if (!entry) {
    throw new Error('Unknown project id');
  }
  return entry.workspacePath;
}

export function registerSecretsHandlers(): void {
  ipcMain.handle(IpcChannels.secretsGetManifest, async (_event, value): Promise<SecretsManifest> => {
    // Falls back to the blueprint-derived set when nothing is stored yet.
    return effectiveManifest(await resolveWorkspace(value));
  });

  ipcMain.handle(IpcChannels.secretsSetManifest, async (_event, value) => {
    const workspacePath = await resolveWorkspace(value);
    const { secrets } = (value ?? {}) as { secrets?: unknown };
    const incoming = Array.isArray(secrets) ? secrets : [];
    const manifest = await writeManifest(workspacePath, { secrets: incoming as never[] });
    // Report every dropped entry so the renderer can surface it rather than silently
    // shrinking the list — including ones rejected for a bad/missing env-var name
    // (which never make it into the kept set), not just value-shaped ones.
    const kept = new Set(manifest.secrets.map((s) => s.envVar));
    const rejected: string[] = [];
    const seen = new Set<string>();
    for (const item of incoming) {
      const env = item && typeof item === 'object' ? (item as { envVar?: unknown }).envVar : undefined;
      const validName = typeof env === 'string' && ENV_VAR_RE.test(env);
      const label = validName ? (env as string) : '(invalid env-var name)';
      if (validName && kept.has(env as string)) {
        continue; // accepted
      }
      if (label === '(invalid env-var name)' || !seen.has(label)) {
        rejected.push(label);
        seen.add(label);
      }
    }
    return { manifest, rejected };
  });

  ipcMain.handle(IpcChannels.secretsDeriveFromBlueprint, async (_event, value): Promise<SecretsManifest> => {
    return deriveFromBlueprint(await resolveWorkspace(value));
  });

  ipcMain.handle(IpcChannels.secretsGeneratePushScript, async (_event, value) => {
    const scriptPath = await generatePushScript(await resolveWorkspace(value));
    return { scriptPath };
  });
}
