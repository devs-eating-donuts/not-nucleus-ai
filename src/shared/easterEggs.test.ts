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

const [circling, questionable] = EASTER_EGG_CLUES;

/**
 * The REAL trivia answers are deliberately NOT in this file (or anywhere in the
 * repo) — they are the image-vault decryption keys (shared/imageVault.ts), and
 * committing a plaintext answer would defeat the vault. The accept path is
 * tested against a SYNTHETIC clue whose hash is computed right here.
 */
async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('normalizeAnswer', () => {
  it('lowercases and strips spaces, hyphens, and punctuation', () => {
    expect(normalizeAnswer('Tres-Commas')).toBe('trescommas');
    expect(normalizeAnswer('  tres commas ')).toBe('trescommas');
    expect(normalizeAnswer('Conjoined, Triangles!')).toBe('conjoinedtriangles');
    expect(normalizeAnswer('AVIATO')).toBe('aviato');
  });

  it('keeps digits', () => {
    expect(normalizeAnswer('5.2 Weissman')).toBe('52weissman');
  });
});

describe('checkAnswer (against the stored hashes)', () => {
  it('accepts a correct answer in any reasonable typing (synthetic clue)', async () => {
    const synthetic = { ...circling, answerHash: await sha256Hex('opensesame') };
    expect(await checkAnswer(synthetic, 'open sesame')).toBe(true);
    expect(await checkAnswer(synthetic, 'Open-Sesame')).toBe(true);
    expect(await checkAnswer(synthetic, '  OPEN, sesame!  ')).toBe(true);
  });

  it('rejects wrong and empty guesses against the real clues', async () => {
    expect(await checkAnswer(circling, 'bottom up')).toBe(false);
    expect(await checkAnswer(questionable, 'Aviato')).toBe(false);
    expect(await checkAnswer(circling, '')).toBe(false);
    expect(await checkAnswer(circling, '   ')).toBe(false);
  });

  it('every clue carries a distinct answer hash (no clue accepts another’s answer)', () => {
    const hashes = EASTER_EGG_CLUES.map((c) => c.answerHash);
    expect(new Set(hashes).size).toBe(EASTER_EGG_CLUES.length);
    // 64 lowercase hex chars each — a real SHA-256, not a placeholder.
    for (const h of hashes) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
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
