import { ipcMain } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CLI_PRESETS } from '../../shared/cli';
import type { CliDetection, CliTestResult, CliUpdateResult } from '../../shared/cli';
import { assignmentFromPreset } from '../../shared/cliAssignment';
import { IpcChannels } from '../../shared/ipc';
import { invokeCli } from '../services/cliInvoker';
import { inspectCommand, resolveCommand, runResolvedCommand } from '../services/cliValidator';

/**
 * AI CLI catalog IPC: detect every known CLI's install status/version, and
 * run a CLI's update command. The renderer never spawns anything — it asks
 * main, which knows the safe-spawn rules.
 */
export function registerCliHandlers(): void {
  ipcMain.handle(IpcChannels.cliDetectAll, async (): Promise<CliDetection[]> => {
    const detectable = CLI_PRESETS.filter((p) => p.id !== 'custom');
    const results = await Promise.all(
      detectable.map(async (preset): Promise<CliDetection> => {
        const inspection = await inspectCommand(preset.command, preset.commandAliases ?? []);
        return {
          id: preset.id,
          cliName: preset.cliName,
          command: preset.command,
          installed: inspection.installed,
          version: inspection.version,
          resolvedPath: inspection.resolvedPath,
          canUpdate: Array.isArray(preset.updateArgs) && preset.updateArgs.length > 0,
        };
      }),
    );
    return results.sort((a, b) => a.cliName.localeCompare(b.cliName));
  });

  ipcMain.handle(IpcChannels.cliRunUpdate, async (_event, value: unknown): Promise<CliUpdateResult> => {
    if (typeof value !== 'string') {
      throw new Error('cli:run-update expects a preset id');
    }
    const preset = CLI_PRESETS.find((p) => p.id === value);
    if (!preset) {
      throw new Error(`Unknown CLI id: ${value}`);
    }
    if (!preset.updateArgs || preset.updateArgs.length === 0) {
      throw new Error(`No update command configured for ${preset.cliName}`);
    }
    let resolved = await resolveCommand(preset.command);
    if (!resolved) {
      for (const alias of preset.commandAliases ?? []) {
        const aliasPath = await resolveCommand(alias);
        if (aliasPath) {
          resolved = aliasPath;
          break;
        }
      }
    }
    if (!resolved) {
      return { id: value, ok: false, output: `${preset.command} is not installed.` };
    }
    const run = await runResolvedCommand(resolved, preset.updateArgs);
    return {
      id: value,
      ok: run.ok,
      output: run.output !== '' ? run.output : run.ok ? 'Done.' : 'No output.',
    };
  });

  // Onboarding "Test" button: run a trivial one-shot prompt through the chosen
  // CLI to confirm it actually responds (i.e. install + login worked). We require
  // a sentinel in the reply so an auth-required notice that exits cleanly still
  // reads as a failure — only a real model answer counts as ok.
  ipcMain.handle(IpcChannels.cliTest, async (_event, value: unknown): Promise<CliTestResult> => {
    if (typeof value !== 'string') {
      throw new Error('cli:test expects a preset id');
    }
    const preset = CLI_PRESETS.find((p) => p.id === value);
    if (!preset || preset.id === 'custom') {
      throw new Error(`Unknown CLI id: ${value}`);
    }
    const assignment = assignmentFromPreset(value);
    if (!assignment) {
      return { id: value, ok: false, output: 'No preset for this CLI.', durationMs: 0 };
    }
    const dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-test-'));
    try {
      const res = await invokeCli(assignment, {
        prompt: 'Reply with exactly: NUCLEUS_OK',
        cwd: dir,
        timeoutMs: 60_000,
        autopilot: false,
        surface: 'cli-test',
      });
      return {
        id: value,
        ok: res.ok && res.output.includes('NUCLEUS_OK'),
        output: res.ok ? res.output.trim() || '(empty response)' : (res.error ?? 'No response.'),
        durationMs: res.durationMs,
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
