import { describe, it, expect } from 'vitest';
import { deriveTierKey, encryptBytes, decryptBytes } from './imageVault';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// Fixture answers are SYNTHETIC — the real trivia answers (the vault keys) are
// deliberately never written into any test or source file. The crypto behaves
// identically for any phrase, so nothing is lost by testing with stand-ins.
describe('imageVault (encrypt-on-answer image vault)', () => {
  it('roundtrips: encrypt then decrypt with the same tier answer yields the original bytes', async () => {
    const key = await deriveTierKey('cover', 'open sesame');
    const blob = await encryptBytes(key, enc('the real photo bytes'));
    expect(dec(await decryptBytes(key, blob))).toBe('the real photo bytes');
  });

  it('a WRONG answer cannot decrypt — the GCM auth tag fails', async () => {
    const good = await deriveTierKey('cover', 'open sesame');
    const wrong = await deriveTierKey('cover', 'definitely not the answer');
    const blob = await encryptBytes(good, enc('secret'));
    await expect(decryptBytes(wrong, blob)).rejects.toBeDefined();
  });

  it('tiers are isolated — one tier cannot decrypt another even with the SAME answer (per-tier salt)', async () => {
    const cover = await deriveTierKey('cover', 'shared-phrase');
    const canon = await deriveTierKey('canon', 'shared-phrase');
    const blob = await encryptBytes(cover, enc('cover-only bytes'));
    await expect(decryptBytes(canon, blob)).rejects.toBeDefined();
  });

  it('normalizes the answer (case / spacing / hyphens all derive the same key)', async () => {
    const k1 = await deriveTierKey('distinct', 'tres commas');
    const blob = await encryptBytes(k1, enc('x'));
    const k2 = await deriveTierKey('distinct', 'Tres-Commas'); // same normalized form
    expect(dec(await decryptBytes(k2, blob))).toBe('x');
  });

  it('a random IV makes two encryptions of the same bytes differ, and both still decrypt', async () => {
    const key = await deriveTierKey('cover', 'open sesame');
    const a = await encryptBytes(key, enc('same'));
    const b = await encryptBytes(key, enc('same'));
    expect(sameBytes(a, b)).toBe(false);
    expect(dec(await decryptBytes(key, a))).toBe('same');
    expect(dec(await decryptBytes(key, b))).toBe('same');
  });

  it('tampering with the ciphertext is detected (auth failure)', async () => {
    const key = await deriveTierKey('canon', 'radio on the internet');
    const blob = await encryptBytes(key, enc('untampered'));
    blob[blob.length - 1] ^= 0xff; // flip a byte in the tag/ciphertext
    await expect(decryptBytes(key, blob)).rejects.toBeDefined();
  });
});
