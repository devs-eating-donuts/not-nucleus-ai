import { describe, expect, it } from 'vitest';
import {
  CLI_INSTALL_GUIDES,
  installCommandFor,
  installGuideFor,
  updateCommandFor,
} from './cliInstall';
import { CLI_PRESETS } from './cli';

describe('cliInstall', () => {
  it('has a guide for every non-custom preset', () => {
    for (const preset of CLI_PRESETS) {
      if (preset.id === 'custom') {
        continue;
      }
      expect(CLI_INSTALL_GUIDES[preset.id], `missing install guide for ${preset.id}`).toBeDefined();
    }
  });

  it('returns the OS-specific command and defaults unknown platforms to darwin', () => {
    expect(installCommandFor('claude', 'win32')).toContain('npm install');
    expect(installCommandFor('claude', 'linux')).toBeTruthy();
    expect(installCommandFor('copilot', 'win32')).toContain('winget');
    expect(installCommandFor('claude', 'plan9')).toBe(installCommandFor('claude', 'darwin'));
  });

  it('has no guide / command for the custom CLI', () => {
    expect(installGuideFor('custom')).toBeUndefined();
    expect(installCommandFor('custom', 'darwin')).toBeNull();
    expect(updateCommandFor('custom', 'darwin')).toBeNull();
  });

  it('uses the official OpenAI installer for codex on every OS (also updates)', () => {
    // Windows: PowerShell script; install == update.
    const win = installCommandFor('codex', 'win32');
    expect(win).toContain('chatgpt.com/codex/install.ps1');
    expect(win).toContain('iex');
    expect(updateCommandFor('codex', 'win32')).toBe(win);
    // macOS: shell script; install == update (no distinct update command).
    expect(installCommandFor('codex', 'darwin')).toContain('chatgpt.com/codex/install.sh');
    expect(updateCommandFor('codex', 'darwin')).toBe(installCommandFor('codex', 'darwin'));
    // Linux: apt prereqs on first install, but update re-runs only the script.
    expect(installCommandFor('codex', 'linux')).toContain('bubblewrap');
    expect(updateCommandFor('codex', 'linux')).toContain('install.sh');
    expect(updateCommandFor('codex', 'linux')).not.toContain('apt');
  });

  it('falls back to the install command for update unless a distinct one exists', () => {
    // npm CLI: reinstalling fetches latest, so update == install.
    expect(updateCommandFor('claude', 'win32')).toBe(installCommandFor('claude', 'win32'));
    // winget CLIs need `upgrade`, not `install`.
    expect(updateCommandFor('copilot', 'win32')).toBe('winget upgrade GitHub.Copilot');
    expect(updateCommandFor('copilot', 'win32')).not.toBe(installCommandFor('copilot', 'win32'));
    // But on macOS the winget CLI has no distinct update → falls back to install (npm).
    expect(updateCommandFor('copilot', 'darwin')).toBe(installCommandFor('copilot', 'darwin'));
  });
});
