import { describe, expect, it } from 'vitest';
import { assignmentFromPreset } from './cliAssignment';
import { defaultChainRoles } from './roles';
import {
  createDefaultSettings,
  isDefaultTeamReady,
  isRipItTeamReady,
  unassignedChainRoles,
  unassignedRipItRoles,
} from './settings';

const claude = assignmentFromPreset('claude');
if (!claude) {
  throw new Error('expected a claude preset');
}

describe('isDefaultTeamReady / unassignedChainRoles', () => {
  it('a fresh roster (no CLIs) is not ready — every chain role is unassigned', () => {
    const { roles } = createDefaultSettings();
    expect(isDefaultTeamReady(roles)).toBe(false);
    expect(unassignedChainRoles(roles).sort()).toEqual([...defaultChainRoles()].sort());
  });

  it('is ready once every lifecycle-chain role has a CLI assigned', () => {
    const { roles } = createDefaultSettings();
    for (const id of defaultChainRoles()) {
      roles[id] = { ...roles[id], assignment: claude };
    }
    expect(unassignedChainRoles(roles)).toEqual([]);
    expect(isDefaultTeamReady(roles)).toBe(true);
  });

  it('a blank-command assignment still counts as a dead seat', () => {
    const { roles } = createDefaultSettings();
    for (const id of defaultChainRoles()) {
      roles[id] = { ...roles[id], assignment: claude };
    }
    const victim = defaultChainRoles()[2];
    roles[victim] = { ...roles[victim], assignment: { ...claude, command: '   ' } };
    expect(isDefaultTeamReady(roles)).toBe(false);
    expect(unassignedChainRoles(roles)).toEqual([victim]);
  });

  it('ignores non-chain (advisory/ops-excluded) roles — only the lifecycle chain gates', () => {
    const { roles } = createDefaultSettings();
    for (const id of defaultChainRoles()) {
      roles[id] = { ...roles[id], assignment: claude };
    }
    // Chain fully assigned → ready, regardless of any non-chain role's state.
    expect(isDefaultTeamReady(roles)).toBe(true);
  });
});

describe('isRipItTeamReady / unassignedRipItRoles', () => {
  it('needs only stakeholder + developer (the express lane), not the full chain', () => {
    const { roles } = createDefaultSettings();
    roles.stakeholder = { ...roles.stakeholder, assignment: claude };
    roles.developer = { ...roles.developer, assignment: claude };
    // Architect / QA / security / ops all still unassigned…
    expect(isDefaultTeamReady(roles)).toBe(false);
    // …but Rip-it only needs Erlich + Dinesh.
    expect(unassignedRipItRoles(roles)).toEqual([]);
    expect(isRipItTeamReady(roles)).toBe(true);
  });

  it('is not ready when either Erlich or Dinesh is missing', () => {
    const { roles } = createDefaultSettings();
    roles.stakeholder = { ...roles.stakeholder, assignment: claude };
    expect(isRipItTeamReady(roles)).toBe(false);
    expect(unassignedRipItRoles(roles)).toEqual(['developer']);
  });
});
