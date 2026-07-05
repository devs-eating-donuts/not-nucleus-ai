import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAMING_MODE,
  brandName,
  isLockedNamingMode,
  isNamingMode,
  resolveName,
} from './naming';

const v = { canon: 'Hooli', distinct: 'Hoolisoft' };

describe('resolveName', () => {
  it('canon returns the show name', () => expect(resolveName(v, 'canon')).toBe('Hooli'));
  it('cover prefixes NOT', () => expect(resolveName(v, 'cover')).toBe('NOT Hooli'));
  it('distinct returns the distinct name', () => expect(resolveName(v, 'distinct')).toBe('Hoolisoft'));
  it('pete shares the distinct riff names', () => expect(resolveName(v, 'pete')).toBe('Hoolisoft'));
});

describe('brandName', () => {
  it('resolves a brand per mode', () => {
    expect(brandName('createdBy', 'canon')).toBe('Pied Piper');
    expect(brandName('createdBy', 'distinct')).toBe('Pipeline Labs');
  });
});

describe('mode locking', () => {
  it('pete is always open; the three show-flavored tiers are locked', () => {
    expect(isLockedNamingMode('pete')).toBe(false);
    expect(isLockedNamingMode('distinct')).toBe(true);
    expect(isLockedNamingMode('cover')).toBe(true);
    expect(isLockedNamingMode('canon')).toBe(true);
  });
});

describe('release naming-mode guard', () => {
  it('the shipped default is always a valid mode', () => {
    expect(isNamingMode(DEFAULT_NAMING_MODE)).toBe(true);
  });

  // Mirrors the forge.config.ts packaging preflight: a public/distributed build must
  // default to a public-safe cast — 'pete' (the original cast, the shipped default)
  // or 'distinct' (the original riff names). Under NUCLEUS_PUBLIC_RELEASE=1 this
  // FAILS the build/test on a show-name default, so a missed flip can never ship
  // show names silently.
  it('public release builds must default to a public-safe cast', () => {
    if (process.env.NUCLEUS_PUBLIC_RELEASE === '1') {
      expect(['pete', 'distinct']).toContain(DEFAULT_NAMING_MODE);
    } else {
      expect(isNamingMode(DEFAULT_NAMING_MODE)).toBe(true);
    }
  });
});
