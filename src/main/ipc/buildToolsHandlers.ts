import { ipcMain } from 'electron';
import { composeBlueprint } from '../../shared/blueprints';
import {
  buildToolById,
  installCommandForTool,
  type BuildToolStatus,
} from '../../shared/buildTools';
import { IpcChannels } from '../../shared/ipc';
import { resolveCommand, runResolvedCommand } from '../services/cliValidator';
import { projectRegistryStore } from '../services/projectRegistryStore';

/**
 * Build-prerequisite detection IPC. Given the chosen template + overlays, compose
 * the blueprint, then for each declared build tool report PATH presence + the OS
 * install command for what's missing. The renderer is untrusted: the templateId /
 * overlayIds only steer composeBlueprint (which already filters to the known
 * catalog), and we detect only ids that resolve to a known BUILD_TOOLS entry — so
 * no renderer-supplied string is ever spawned or resolved as a command.
 */
export function registerBuildToolsHandlers(): void {
  ipcMain.handle(
    IpcChannels.buildToolsDetect,
    async (_event, templateId: unknown, overlayIds: unknown): Promise<BuildToolStatus[]> => {
      const tid = typeof templateId === 'string' ? templateId : null;
      const overlays = Array.isArray(overlayIds)
        ? overlayIds.filter((o): o is string => typeof o === 'string').slice(0, 50)
        : [];
      const composed = composeBlueprint(tid, overlays);
      const platform = process.platform;

      const statuses = await Promise.all(
        composed.buildTools.map(async (id): Promise<BuildToolStatus | null> => {
          const tool = buildToolById(id);
          if (!tool) {
            return null;
          }
          // tool.detect is a fixed bare name from the trusted catalog, never renderer input.
          const resolvedPath = await resolveCommand(tool.detect);
          return {
            id: tool.id,
            name: tool.name,
            present: resolvedPath !== null,
            resolvedPath,
            installCommand: installCommandForTool(id, platform),
            login: tool.login ?? null,
            note: tool.note,
            docsUrl: tool.docsUrl,
          };
        }),
      );
      return statuses.filter((s): s is BuildToolStatus => s !== null);
    },
  );

  // Open the project's workspace folder in VS Code. Resolves `code` on PATH (the
  // workspace path comes from the trusted registry, never the renderer), then runs
  // `code <workspace>` via the safe-spawn path (handles the Windows .cmd shim).
  ipcMain.handle(
    IpcChannels.workspaceOpenInVscode,
    async (_event, projectId: unknown): Promise<{ ok: boolean; error?: string }> => {
      if (typeof projectId !== 'string' || projectId.trim() === '') {
        return { ok: false, error: 'A project id is required.' };
      }
      const entry = await projectRegistryStore.get(projectId);
      if (!entry) {
        return { ok: false, error: 'Unknown project id.' };
      }
      // On Windows `code` is a .cmd shim run via cmd.exe, whose arg line is documented
      // "trusted flags only" — a workspace path carrying cmd metacharacters could
      // misbehave there. The path IS registry-trusted, but a user can legally name a
      // folder oddly: refuse those few rather than pass them through cmd.exe.
      if (process.platform === 'win32' && /["%&<>^|]/.test(entry.workspacePath)) {
        return {
          ok: false,
          error:
            'This workspace path contains characters cmd.exe treats specially — open the folder in VS Code manually.',
        };
      }
      const codePath = await resolveCommand('code');
      if (!codePath) {
        return {
          ok: false,
          error:
            "VS Code's `code` command isn't on your PATH. In VS Code, open the Command Palette (Cmd/Ctrl+Shift+P) and run \"Shell Command: Install 'code' command in PATH\", then try again.",
        };
      }
      const run = await runResolvedCommand(codePath, [entry.workspacePath], { timeoutMs: 15_000 });
      return run.ok ? { ok: true } : { ok: false, error: run.output || 'Failed to launch VS Code.' };
    },
  );
}
