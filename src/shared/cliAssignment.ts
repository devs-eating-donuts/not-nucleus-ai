import type { CliAssignment, CliCapabilities, ExecutionMode } from './cli';
import { CLI_PRESETS } from './cli';

/** Deep-clones a preset's capabilities so an assignment never shares array refs. */
export function cloneCapabilities(caps: CliCapabilities): CliCapabilities {
  return {
    ...caps,
    supportedModels: caps.supportedModels ? [...caps.supportedModels] : undefined,
    supportedThinkingLevels: caps.supportedThinkingLevels
      ? [...caps.supportedThinkingLevels]
      : undefined,
  };
}

/**
 * Builds a fresh `CliAssignment` from a preset id, or null for an unknown id.
 * The single source of truth used wherever a seat is filled from a preset — the
 * Team page (RoleConfigCard), first-run onboarding seeding, and the one-shot
 * CLI test. Defaults to 'prompted' execution when the CLI supports it.
 */
export function assignmentFromPreset(presetId: string): CliAssignment | null {
  const preset = CLI_PRESETS.find((p) => p.id === presetId);
  if (!preset) {
    return null;
  }
  const capabilities = cloneCapabilities(preset.capabilities);
  const executionMode: ExecutionMode = capabilities.supportsPromptedMode
    ? 'prompted'
    : 'workspace-unrestricted';
  return {
    presetId: preset.id,
    cliName: preset.cliName,
    command: preset.command,
    defaultArgs: [...preset.defaultArgs],
    env: {},
    capabilities,
    executionMode,
  };
}
