import { describe, expect, it } from 'vitest';
import { assignmentFromPreset } from './cliAssignment';
import { CLI_PRESETS } from './cli';
import { ALL_ROLE_IDS, ROLE_DEFINITIONS } from './roles';

describe('assignmentFromPreset', () => {
  it('builds an assignment from a known preset id', () => {
    const a = assignmentFromPreset('claude');
    expect(a).not.toBeNull();
    expect(a?.presetId).toBe('claude');
    expect(a?.command).toBe('claude');
    expect(a?.executionMode).toBe('prompted');
    expect(a?.env).toEqual({});
  });

  it('returns null for an unknown preset id', () => {
    expect(assignmentFromPreset('does-not-exist')).toBeNull();
  });

  it('clones capabilities so an assignment never shares array refs with the preset', () => {
    const preset = CLI_PRESETS.find((p) => p.id === 'claude');
    const a = assignmentFromPreset('claude');
    expect(a?.capabilities).not.toBe(preset?.capabilities);
    if (preset?.capabilities.supportedModels && a) {
      expect(a.capabilities.supportedModels).not.toBe(preset.capabilities.supportedModels);
      expect(a.capabilities.supportedModels).toEqual(preset.capabilities.supportedModels);
    }
  });

  it('returns an independent object each call (seeding must not share refs across roles)', () => {
    const a = assignmentFromPreset('claude');
    const b = assignmentFromPreset('claude');
    expect(a).not.toBe(b);
    expect(a?.defaultArgs).not.toBe(b?.defaultArgs);
  });
});

describe('default-chain seeding target', () => {
  // Onboarding seeds the chosen CLI onto every inDefaultChain role. Jared/Ops is
  // now part of the chain (he runs the end-of-phase/project documentation pass).
  it('includes the build roles and Jared/Ops', () => {
    const chain = ALL_ROLE_IDS.filter((r) => ROLE_DEFINITIONS[r].inDefaultChain);
    expect(chain).toContain('developer');
    expect(chain).toContain('qa');
    expect(chain).toContain('security');
    expect(chain).toContain('ops');
  });
});
