/**
 * Naming modes — the character-set switcher (docs/design/character-modes.md).
 * Like the theme switcher, but for the names/cast of personas, companies, and
 * products. Four tiers, dropdown-ordered safe → spicy:
 *
 *   pete     "Pete Monahan Representing" — DEFAULT, always open: the original
 *            riff names + (once produced) the 13 original avatars
 *   distinct "Lawyers Are Circling"      — riff names + existing art  🔒
 *   cover    "Legally Questionable"      — show names with a "NOT " fig-leaf  🔒
 *   canon    "No Lawyers Present"        — names exactly as aired, plus the
 *            Jian Yang takeover once he wakes (the secret-within-a-secret)  🔒
 *
 * The three locked tiers are hidden until their Pipey trivia clue is cracked
 * (shared/easterEggs.ts — a soft gate by design). Nucleus-AI is an unofficial
 * fan-tribute parody (see README). The active mode lives in the user's LOCAL
 * settings, never the repo; the repo's static files (README, package.json,
 * Forge config) always use the distinct names so a public clone stays
 * defensible.
 */

export type NamingMode = 'pete' | 'canon' | 'cover' | 'distinct';

/** The shipped default — the fully-original, public-safe cast. */
export const DEFAULT_NAMING_MODE: NamingMode = 'pete';

export interface NamingModeDefinition {
  id: NamingMode;
  label: string;
  tagline: string;
}

/** Dropdown order: safe → spicy. */
export const NAMING_MODES: NamingModeDefinition[] = [
  {
    id: 'pete',
    label: 'Pete Monahan Representing',
    tagline: 'Wholly original cast. Counsel has reviewed and approves.',
  },
  {
    id: 'distinct',
    label: 'Lawyers Are Circling',
    tagline: 'Wholly original, legally-distinct names.',
  },
  {
    id: 'cover',
    label: 'Legally Questionable',
    tagline: 'The same names, now with a fig-leaf "NOT".',
  },
  { id: 'canon', label: 'No Lawyers Present', tagline: 'Names exactly as aired.' },
];

export function isNamingMode(value: unknown): value is NamingMode {
  return value === 'pete' || value === 'canon' || value === 'cover' || value === 'distinct';
}

/**
 * Locked tiers hide in the switcher until their easter-egg clue is cracked
 * (settings.crackedEggs). Pete — the original cast — is always open.
 */
export function isLockedNamingMode(mode: NamingMode): boolean {
  return mode !== 'pete';
}

/*
 * The Jian Yang company takeover (every portrait, voice, banter line, and
 * bullpen name becomes his) is driven by settings.jianYangAwake — toggled by
 * the status-bar hot dog, which only exists once the whole scavenger hunt is
 * cracked (easterEggs.huntComplete; the settings sanitizer enforces the gate).
 * When awake he takes over in EVERY naming mode: the company is his.
 */

/** Two stored variants per named entity; the "cover" tier is derived. */
export interface NameVariants {
  /** The name as it appears in the show. */
  canon: string;
  /** Our original, legally-distinct riff. */
  distinct: string;
}

export const COVER_PREFIX = 'NOT ';

/** Resolve a named entity for the active mode. */
export function resolveName(variants: NameVariants, mode: NamingMode): string {
  switch (mode) {
    case 'canon':
      return variants.canon;
    case 'cover':
      return `${COVER_PREFIX}${variants.canon}`;
    // Pete shares the legally-distinct riff names; his cast differs in art,
    // not names (the 13 original avatars — see character-modes.md).
    case 'pete':
    case 'distinct':
      return variants.distinct;
  }
}

/** Brand/company names that appear in the app chrome. */
export type BrandKey = 'poweredBy' | 'createdBy';

export const BRANDS: Record<BrandKey, NameVariants> = {
  poweredBy: { canon: 'Hooli', distinct: 'Hoolisoft' },
  createdBy: { canon: 'Pied Piper', distinct: 'Pipeline Labs' },
};

export function brandName(key: BrandKey, mode: NamingMode): string {
  return resolveName(BRANDS[key], mode);
}
