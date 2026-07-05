import { describe, it, expect } from 'vitest';
import { ALL_ROLE_IDS } from './roles';
import type { RoleId } from './roles';
import {
  OPERATING_PRINCIPLES,
  PRINCIPLES_ENABLED,
  operatingPrinciplesBlock,
} from './operatingPrinciples';

const ENABLED: RoleId[] = ['projectLead', 'architect', 'developer', 'qa', 'security', 'ops'];

describe('operatingPrinciplesBlock', () => {
  it('returns a labeled, concatenable block for every enabled role', () => {
    for (const role of ENABLED) {
      const block = operatingPrinciplesBlock(role);
      expect(block, role).not.toBe('');
      // Concatenates like the other room/bullpen blocks (leading blank line).
      expect(block.startsWith('\n\n'), role).toBe(true);
    }
  });

  it('keys exactly the six build roles — the Stakeholder (Erlich) is excluded', () => {
    expect(new Set(PRINCIPLES_ENABLED)).toEqual(new Set(ENABLED));
    expect(PRINCIPLES_ENABLED.has('stakeholder')).toBe(false);
    expect(OPERATING_PRINCIPLES.stakeholder).toBeUndefined();
  });

  it('returns "" for every role not enabled (cross-role byte-identical invariant)', () => {
    for (const role of ALL_ROLE_IDS) {
      if (PRINCIPLES_ENABLED.has(role)) {
        continue;
      }
      // Today that is only the stakeholder, whose prompt must stay byte-identical.
      expect(operatingPrinciplesBlock(role), role).toBe('');
    }
    expect(operatingPrinciplesBlock('stakeholder')).toBe('');
  });

  it('only enables roles that actually have non-blank principle text', () => {
    for (const role of PRINCIPLES_ENABLED) {
      const text = OPERATING_PRINCIPLES[role];
      expect(typeof text === 'string' && text.trim() !== '', role).toBe(true);
    }
  });

  it('carries no persona/company names in any principle block (names route through helpers)', () => {
    const banned = [/Monica/i, /Richard/i, /Dinesh/i, /Gilfoyle/i, /\bBig Head\b/i, /Jared/i, /Erlich/i, /Hendricks/i, /Hooli/i, /Pied Piper/i];
    for (const role of Object.keys(OPERATING_PRINCIPLES) as RoleId[]) {
      const text = OPERATING_PRINCIPLES[role] ?? '';
      for (const re of banned) {
        expect(re.test(text), `${role} contains ${re}`).toBe(false);
      }
    }
  });

  it('keeps every block tight (4–7 principle bullets — no runaway prompt bloat)', () => {
    for (const role of Object.keys(OPERATING_PRINCIPLES) as RoleId[]) {
      const text = OPERATING_PRINCIPLES[role] ?? '';
      const bullets = text.split('\n').filter((l) => l.trim().startsWith('- '));
      expect(bullets.length, `${role} bullet count`).toBeGreaterThanOrEqual(4);
      expect(bullets.length, `${role} bullet count`).toBeLessThanOrEqual(7);
    }
  });

  it('encodes the signature judgment for each role', () => {
    expect(operatingPrinciplesBlock('projectLead')).toContain('SMALLEST v1');
    expect(operatingPrinciplesBlock('architect')).toContain('Size before you pick');
    expect(operatingPrinciplesBlock('developer')).toContain('[ACn] criteria');
    expect(operatingPrinciplesBlock('qa')).toContain('one-shot check actually ran');
    expect(operatingPrinciplesBlock('security')).toContain('Threat-model first');
    expect(operatingPrinciplesBlock('ops')).toContain('clean-clone replay');
  });
});
