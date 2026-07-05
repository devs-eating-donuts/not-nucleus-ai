import { describe, expect, it } from 'vitest';
import {
  BUILD_TOOLS,
  buildToolById,
  buildToolsPlanNote,
  installCommandForTool,
} from './buildTools';

describe('buildTools', () => {
  it('every catalog entry has an id matching its key, a detect name, and at least one install command', () => {
    for (const [key, tool] of Object.entries(BUILD_TOOLS)) {
      expect(tool.id).toBe(key);
      expect(tool.detect.trim().length).toBeGreaterThan(0);
      expect(Object.keys(tool.install).length).toBeGreaterThan(0);
    }
  });

  it('installCommandForTool returns the OS-specific command, null for unknown', () => {
    expect(installCommandForTool('docker', 'darwin')).toMatch(/docker/i);
    expect(installCommandForTool('docker', 'win32')).toMatch(/winget|docker/i);
    expect(installCommandForTool('nope', 'darwin')).toBeNull();
  });

  it('buildToolById resolves known tools', () => {
    expect(buildToolById('supabase')?.name).toBe('Supabase CLI');
    expect(buildToolById('nope')).toBeUndefined();
  });

  it('buildToolsPlanNote is empty for no tools (byte-identical plans for tool-less archetypes)', () => {
    expect(buildToolsPlanNote([])).toBe('');
    expect(buildToolsPlanNote(['not-a-tool'])).toBe('');
  });

  it('buildToolsPlanNote lists tools and only the login-bearing ones as human-setup commands', () => {
    const note = buildToolsPlanNote(['node', 'git', 'supabase', 'stripe']);
    expect(note).toContain('Supabase CLI');
    // node/git have no login — they must not appear in the login section's command list.
    expect(note).toContain('`supabase login`');
    expect(note).toContain('`stripe login`');
    expect(note).not.toContain('`node`');
    expect(note).not.toContain('node login');
  });

  it('login-bearing cloud tools (az) become login tasks; loginless ones (terraform) do not', () => {
    const note = buildToolsPlanNote(['az', 'terraform']);
    expect(note).toContain('Azure CLI');
    expect(note).toContain('Terraform');
    expect(note).toContain('`az login`'); // az needs an interactive login
    expect(note).not.toContain('terraform login'); // terraform auths via the cloud CLI, no login
  });
});
