import { describe, expect, it } from 'vitest';
import {
  EASTER_EGG_CLUES,
  EGG_TRIGGERS,
  checkAnswer,
  clueForTrigger,
  huntComplete,
  normalizeAnswer,
  randomLine,
  sanitizeCrackedEggs,
  triggerVisible,
} from './easterEggs';

const [circling, questionable, noLawyers] = EASTER_EGG_CLUES;

describe('normalizeAnswer', () => {
  it('lowercases and strips spaces, hyphens, and punctuation', () => {
    expect(normalizeAnswer('Middle-Out')).toBe('middleout');
    expect(normalizeAnswer('  middle out ')).toBe('middleout');
    expect(normalizeAnswer("Newell Road, Strategic Technologies!")).toBe(
      'newellroadstrategictechnologies',
    );
    expect(normalizeAnswer('BACHMANITY')).toBe('bachmanity');
  });

  it('keeps digits', () => {
    expect(normalizeAnswer('5.2 Weissman')).toBe('52weissman');
  });
});

describe('checkAnswer (against the stored hashes)', () => {
  it('accepts the real answers in any reasonable typing', async () => {
    expect(await checkAnswer(circling, 'middle out')).toBe(true);
    expect(await checkAnswer(circling, 'Middle-Out')).toBe(true);
    expect(await checkAnswer(questionable, 'Bachmanity')).toBe(true);
    expect(await checkAnswer(noLawyers, 'Newell Road Strategic Technologies')).toBe(true);
    expect(await checkAnswer(noLawyers, 'newell-road strategic technologies.')).toBe(true);
  });

  it('rejects wrong and empty guesses', async () => {
    expect(await checkAnswer(circling, 'bottom up')).toBe(false);
    expect(await checkAnswer(questionable, 'Aviato')).toBe(false);
    expect(await checkAnswer(circling, '')).toBe(false);
    expect(await checkAnswer(circling, '   ')).toBe(false);
  });

  it('does not accept one clue’s answer for another', async () => {
    expect(await checkAnswer(questionable, 'middle out')).toBe(false);
    expect(await checkAnswer(noLawyers, 'bachmanity')).toBe(false);
  });
});

describe('triggers', () => {
  it('each trigger owns the right clue', () => {
    expect(clueForTrigger('pipey').id).toBe('distinct');
    expect(clueForTrigger('lei').id).toBe('cover');
    expect(clueForTrigger('hotdog').id).toBe('canon');
  });

  it('a trigger hides until the previous clue cracks, then stays forever', () => {
    // Fresh hunt: only Pipey is out.
    expect(triggerVisible('pipey', [])).toBe(true);
    expect(triggerVisible('lei', [])).toBe(false);
    expect(triggerVisible('hotdog', [])).toBe(false);
    // Crack 1 reveals the lei but not the hot dog.
    expect(triggerVisible('lei', ['distinct'])).toBe(true);
    expect(triggerVisible('hotdog', ['distinct'])).toBe(false);
    // Crack 2 reveals the hot dog.
    expect(triggerVisible('hotdog', ['distinct', 'cover'])).toBe(true);
    // Hunt complete: everything stays out (the chatter pieces).
    for (const t of ['pipey', 'lei', 'hotdog'] as const) {
      expect(triggerVisible(t, ['distinct', 'cover', 'canon'])).toBe(true);
    }
  });

  it('every trigger carries at least 20 chatter lines and serves one of them', () => {
    for (const t of ['pipey', 'lei', 'hotdog'] as const) {
      expect(EGG_TRIGGERS[t].lines.length).toBeGreaterThanOrEqual(20);
      expect(EGG_TRIGGERS[t].lines).toContain(randomLine(t));
    }
  });

  it('every clue ships lore, and the non-final clues tease the next trigger', () => {
    for (const clue of EASTER_EGG_CLUES) {
      expect(clue.insight.length).toBeGreaterThan(20);
    }
    expect(EASTER_EGG_CLUES[0].tease).toBeTruthy();
    expect(EASTER_EGG_CLUES[1].tease).toBeTruthy();
  });
});

describe('huntComplete', () => {
  it('requires every clue cracked (the takeover-switch gate)', () => {
    expect(huntComplete([])).toBe(false);
    expect(huntComplete(['distinct', 'cover'])).toBe(false);
    expect(huntComplete(['distinct', 'cover', 'canon'])).toBe(true);
  });
});

describe('sanitizeCrackedEggs', () => {
  it('degrades malformed input to empty', () => {
    expect(sanitizeCrackedEggs(undefined)).toEqual([]);
    expect(sanitizeCrackedEggs('distinct')).toEqual([]);
    expect(sanitizeCrackedEggs({ distinct: true })).toEqual([]);
  });

  it('keeps only known ids, deduplicated, in hunt order', () => {
    expect(sanitizeCrackedEggs(['canon', 'nope', 'distinct', 'distinct', 42])).toEqual([
      'distinct',
      'canon',
    ]);
  });
});
