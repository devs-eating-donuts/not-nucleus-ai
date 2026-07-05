import type { NamingMode } from './naming';

/**
 * The Silicon Valley scavenger hunt (see docs/design/character-modes.md).
 *
 * Three hidden triggers, each owning one trivia clue: Pipey (About page,
 * always out), a lei (The Pitch — Erlich's incubator — revealed by crack 1),
 * and a hot dog (Hacker Hostel, well hidden, revealed by crack 2). Cracking a
 * clue unlocks its character set in the naming switcher; a cracked trigger
 * stays on its page dispensing canned chatter lines. Answers are stored ONLY
 * as SHA-256 hashes of their normalized form, so they are not readable in the
 * shipped source.
 *
 * Soft gate by design: this keeps the parody out of casual view, it is not a
 * vault. For a public release the locked casts + their assets are stripped at
 * package time via NUCLEUS_PUBLIC_RELEASE.
 */

export interface EasterEggClue {
  /** The naming tier this clue unlocks — the egg id persisted in settings. */
  id: NamingMode;
  /** The dropdown label the crack reveals. */
  modeLabel: string;
  /** The trivia prompt shown in the trigger's dialog. */
  clue: string;
  /** SHA-256 hex of the normalized answer. */
  answerHash: string;
  /** Short reveal line shown on a successful crack. */
  reveal: string;
  /** Real show lore shown with the reveal — the "how deep does this go" beat. */
  insight: string;
  /** Muted one-line tease pointing (vaguely) at the next hidden trigger. */
  tease?: string;
}

/** Hunt order: famous-to-everyone → medium → finale deep-cut. */
export const EASTER_EGG_CLUES: readonly EasterEggClue[] = [
  {
    id: 'distinct',
    modeLabel: 'Lawyers Are Circling',
    clue: 'Not top-down, not bottom-up — Richard’s breakthrough compresses from the ___ ___.',
    answerHash: 'ac11488cde7ed369ef1c64163a757521fa55a41705f4f96c7da535c48d14b5a3',
    reveal: 'A 5.2 Weissman score. The demo nobody believed.',
    insight:
      'The Weissman score is not real math — Stanford researchers invented it FOR the show. Then actual academia started using it. The fiction leaked into reality.',
    tease: 'Pipey heard a party is being planned. Somewhere in this incubator, a garland is already hanging.',
  },
  {
    id: 'cover',
    modeLabel: 'Legally Questionable',
    clue: 'After Big Head’s Hooli payout, he and Erlich incorporated. Name the company that threw the party that sank it.',
    answerHash: '0131dbed0e792b59faab0715f09967501e770a443dae0b36f066a38df1332603',
    reveal: 'Insanity, as a line item.',
    insight:
      'Bachmanity Insanity: one Hawaiian luau on Alcatraz, palm trees flown in, and the company was broke before the leis wilted. The party outlived the business plan.',
    tease: 'Something smells delicious. It has been in the Hostel the whole time.',
  },
  {
    id: 'canon',
    modeLabel: 'No Lawyers Present',
    clue: 'Ten years on, Dinesh and Gilfoyle co-founded the Bay Area’s biggest cyber-security firm. Name it.',
    answerHash: '248edbbce6baac491ab521c1f9e0963f1b00bb07539f77e12f3b9e4020407b57',
    reveal: 'The firm exists. The partnership is the real security risk.',
    insight:
      'Newell Road Strategic Technologies is named after the Hacker Hostel’s real Palo Alto address — 5230 Newell Road. Dinesh and Gilfoyle named the company after the house.',
  },
];

/* ----- the hidden triggers ----- */

/**
 * The hunt is a scavenger chain of three hidden triggers, each owning one
 * clue. A trigger stays hidden until the PREVIOUS clue cracks; once its own
 * clue cracks it stays on its page as a chatter piece dispensing canned lines.
 */
export type EggTriggerId = 'pipey' | 'lei' | 'hotdog';

const PIPEY_LINES: readonly string[] = [
  'How can I help you? That is rhetorical. I am a pipe.',
  'Have you tried compressing the problem? It works middle-out.',
  'Lossless. Unlike your last standup.',
  'Every great company starts with a pipe and a dream.',
  'I do not sleep. I buffer.',
  'Do not trust anyone whose org chart is a conjoined triangle.',
  'The optimal team size is one pipe.',
  'I am legally distinct from every other helpful woodwind.',
  'My hat? Company issue. The pom-pom was a Series B.',
  'You found me. Retention metrics are through the roof.',
  'I knew three secrets. You have most of them now.',
  'Middle-out is not just compression. It is a lifestyle.',
  'Somewhere, a founder just pivoted. I felt it.',
  'I once reviewed a term sheet. I recommended more woodwinds.',
  'Your Weissman score is whatever you believe it is. That is not how math works, but I believe in you.',
  'If you can read this, you are the QA team now.',
  'I have seen things you people would not believe. Mostly checkboxes.',
  'Blow into me and I make a sound. Like feedback, but useful.',
  'Making the world a better place, one modal at a time.',
  'This dialog is my whole product surface. Investors love focus.',
];

const LEI_LINES: readonly string[] = [
  'Bachmanity: the merger of Bachman and money. Mostly the first part.',
  'The luau was on Alcatraz. Nothing says sound investment like renting a prison.',
  'They flew in real palm trees. The trees outlasted the company.',
  'Big Head’s payout survived Hooli. It did not survive Erlich.',
  'Two founders, zero revenue, one very good party.',
  'Aloha means hello and goodbye. Bachmanity managed both in a single fiscal quarter.',
  'The leis were imported. So were the problems.',
  'Bachmanity Insanity: the only launch party that was also a farewell party.',
  'Their burn rate was measured in tiki torches.',
  'Somewhere, a business manager is still crying.',
  'Palapa huts: structurally sound, fiscally fatal.',
  'Nothing sinks an incorporation like an open bar.',
  'Big Head kept the title. The title was the only remaining asset.',
  'You cannot spell Bachmanity without vanity.',
  'The ROI on that party remains under review.',
  'Attendance was excellent. Solvency was not.',
  'In lieu of dividends, guests received leis.',
  'Erlich negotiated hard for his ten percent of nothing.',
  'The catering budget had a catering budget.',
  'Every flower on this garland cost more than the company was worth at the end.',
];

const JIAN_YANG_LINES: readonly string[] = [
  'Not hotdog.',
  'I am very busy. Go away.',
  'This is my house now. It was always my house.',
  'SeeFood. Shazam for food. You want to invest? Too late.',
  'Eight recipes. All octopus.',
  'My app see food. It say hotdog, or not hotdog. Very useful.',
  'I don’t know who is Pipey. I never see him before.',
  'Erlich is not here. He is in Tibet. Very far. Don’t check.',
  'I am not children. I am grown man.',
  'Your company name is bad. I already register better one.',
  'Hot dog is sandwich? No. Hot dog is hot dog.',
  'I wake up when I smell equity.',
  'You find me because I allow it.',
  'My smart fridge learn from your mistake. So do I.',
  'New Pied Piper. New Bachmanity. New everything. All mine.',
  'This app? I make same app in China two years ago. Better.',
  'The shield company is Dinesh and Gilfoyle. They fight every day. Very profitable.',
  'The house is on Newell Road. Now you know where the hunt lives.',
  'I eat your leftovers. It is rent.',
  'Goodbye. Come again. Bring hot dog.',
];

export interface EggTrigger {
  id: EggTriggerId;
  /** The clue this trigger owns. */
  clueId: NamingMode;
  /** Post-crack chatter lines (one shown at random per open). */
  lines: readonly string[];
}

export const EGG_TRIGGERS: Record<EggTriggerId, EggTrigger> = {
  pipey: { id: 'pipey', clueId: 'distinct', lines: PIPEY_LINES },
  lei: { id: 'lei', clueId: 'cover', lines: LEI_LINES },
  hotdog: { id: 'hotdog', clueId: 'canon', lines: JIAN_YANG_LINES },
};

export function clueForTrigger(trigger: EggTriggerId): EasterEggClue {
  const clueId = EGG_TRIGGERS[trigger].clueId;
  return EASTER_EGG_CLUES.find((c) => c.id === clueId)!;
}

/**
 * A trigger hides until the PREVIOUS clue in the hunt cracks (Pipey is always
 * out); once revealed it never disappears again.
 */
export function triggerVisible(trigger: EggTriggerId, cracked: readonly NamingMode[]): boolean {
  const index = EASTER_EGG_CLUES.findIndex((c) => c.id === EGG_TRIGGERS[trigger].clueId);
  return index <= 0 || cracked.includes(EASTER_EGG_CLUES[index - 1].id);
}

/** A random chatter line for a cracked trigger. */
export function randomLine(trigger: EggTriggerId): string {
  const lines = EGG_TRIGGERS[trigger].lines;
  return lines[Math.floor(Math.random() * lines.length)];
}

/**
 * True once every clue has cracked — the gate for the Jian Yang takeover
 * switch (the status-bar hot dog). Enforced in the settings sanitizer too, so
 * a hand-edited jianYangAwake can never precede a finished hunt.
 */
export function huntComplete(cracked: readonly NamingMode[]): boolean {
  return EASTER_EGG_CLUES.every((c) => cracked.includes(c.id));
}

/**
 * Normalize a guess before hashing: lowercase and strip everything that is not
 * a letter or digit, so `Middle-Out`, `middle out`, and `middleout` all match.
 */
export function normalizeAnswer(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** SHA-256 hex via Web Crypto (available in both the renderer and Node ≥ 18). */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** True when a guess cracks the clue. */
export async function checkAnswer(clue: EasterEggClue, guess: string): Promise<boolean> {
  const normalized = normalizeAnswer(guess);
  if (normalized === '') {
    return false;
  }
  return (await sha256Hex(normalized)) === clue.answerHash;
}

/**
 * Sanitize a persisted cracked-eggs list: keep only known egg ids, in hunt
 * order, deduplicated. Anything malformed degrades to "not cracked".
 */
export function sanitizeCrackedEggs(value: unknown): NamingMode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return EASTER_EGG_CLUES.filter((c) => value.includes(c.id)).map((c) => c.id);
}
