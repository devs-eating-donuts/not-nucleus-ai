import banterData from './banter.json';

/**
 * Canned persona banter — short, in-character one-liners dropped into the build
 * log as flavor (one-way; the user only reads them). Data lives in banter.json
 * (20 good / 20 neutral / 20 disappointed per persona); this is the typed
 * surface + a random picker. Keyed by persona id (personas.ts).
 *
 * Moods match the build outcome:
 *   good         — something went well (task passed, build green, phase shipped)
 *   neutral      — work in progress / between phases (no strong outcome)
 *   disappointed — a setback (QA failed, a bug, an escalation, a broken build)
 *
 * To refresh/expand the lines later, see docs/TODO.md.
 */

export type BanterMood = 'good' | 'neutral' | 'disappointed';

export interface PersonaBanter {
  good: string[];
  neutral: string[];
  disappointed: string[];
}

export const PERSONA_BANTER = banterData as Record<string, PersonaBanter>;

/** Persona ids that have banter (e.g. for the random advisory chime-in). */
export const BANTER_PERSONA_IDS = Object.keys(PERSONA_BANTER);

/**
 * A random banter line for a persona + mood. Falls back to the persona's
 * neutral set, then to '' (callers should skip rendering an empty line).
 */
export function pickBanter(personaId: string, mood: BanterMood): string {
  const set = PERSONA_BANTER[personaId];
  if (!set) {
    return '';
  }
  const pool = set[mood]?.length ? set[mood] : set.neutral;
  if (!pool?.length) {
    return '';
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
