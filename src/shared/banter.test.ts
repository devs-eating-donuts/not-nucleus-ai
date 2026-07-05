import { describe, expect, it } from 'vitest';
import { BANTER_PERSONA_IDS, PERSONA_BANTER, pickBanter } from './banter';

describe('persona banter data', () => {
  it('has exactly 20 good / 20 neutral / 20 disappointed for every persona', () => {
    for (const [id, set] of Object.entries(PERSONA_BANTER)) {
      expect(set.good, `${id} good`).toHaveLength(20);
      expect(set.neutral, `${id} neutral`).toHaveLength(20);
      expect(set.disappointed, `${id} disappointed`).toHaveLength(20);
    }
  });

  it('covers the expected personas including Jian Yang', () => {
    expect(BANTER_PERSONA_IDS).toContain('dinesh-chugbyte');
    expect(BANTER_PERSONA_IDS).toContain('gilfoyle-zerotrust');
    expect(BANTER_PERSONA_IDS).toContain('jian-yang');
    expect(BANTER_PERSONA_IDS.length).toBe(11);
  });

  it('has no empty or duplicate lines within a persona/mood', () => {
    for (const set of Object.values(PERSONA_BANTER)) {
      for (const mood of ['good', 'neutral', 'disappointed'] as const) {
        const lines = set[mood];
        expect(lines.every((l) => l.trim().length > 0)).toBe(true);
        expect(new Set(lines).size).toBe(lines.length);
      }
    }
  });
});

describe('pickBanter', () => {
  it('returns a line from the requested persona + mood', () => {
    const line = pickBanter('gilfoyle-zerotrust', 'good');
    expect(PERSONA_BANTER['gilfoyle-zerotrust'].good).toContain(line);
  });

  it('returns empty string for an unknown persona', () => {
    expect(pickBanter('nobody', 'good')).toBe('');
  });
});
