import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Public-release guardrail: the DEFAULT ("Pete") naming mode must never leak canon Silicon Valley
 * show names into the UI. Persona + company names always route through effectivePersonaName /
 * brandName, so the CANON names live ONLY as data in shared/naming.ts + shared/personas.ts — never
 * hardcoded in a renderer file. This scans the renderer source (comments stripped) for
 * canon-EXCLUSIVE tokens (the ones that differ from the distinct riff names the default mode ships:
 * Pipeline Labs, Hoolisoft, Bachlund, Henderstack, Chugbyte, Bignetti). A hit means a name was
 * hardcoded and would show regardless of the naming switcher — route it through the naming system.
 * (Comments are fine; they're stripped at build time and never render.)
 */

// Canon-exclusive tokens, word-boundaried so they do NOT match the distinct names the default mode
// actually ships (Bachlund / Henderstack / Chugbyte / Bignetti / Pipeline Labs / Hoolisoft).
const CANON_TOKENS: RegExp[] = [
  /Pied Piper/i,
  /\bHooli\b/, // company — "Hoolisoft" is NOT matched by \bHooli\b
  /\bBachman\b/, // Erlich (distinct: Bachlund; \b excludes "Bachmanity")
  /\bHendricks\b/, // Richard (distinct: Henderstack)
  /\bChugtai\b/, // Dinesh (distinct: Chugbyte)
  /Bighetti/, // Big Head (distinct: Bignetti)
];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block + JSDoc + JSX comments
    .replace(/(?<!:)\/\/[^\n]*/g, ' '); // line comments (the (?<!:) spares URLs like https://)
}

function rendererSourceFiles(): string[] {
  const root = path.resolve('src/renderer');
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
    .map((f) => path.join(root, f));
}

describe('renderer never hardcodes canon show names (public-release guardrail)', () => {
  it('scans a non-trivial number of renderer files', () => {
    // Guard the guard: if the glob silently returns nothing, the test would pass vacuously.
    expect(rendererSourceFiles().length).toBeGreaterThan(20);
  });

  it('has zero canon persona/company name literals in rendered code (comments excluded)', () => {
    const leaks: string[] = [];
    for (const file of rendererSourceFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const token of CANON_TOKENS) {
        if (token.test(code)) {
          leaks.push(`${path.relative(process.cwd(), file)} matches ${token}`);
        }
      }
    }
    // A leak = a canon name that would render regardless of the naming switcher. Route it through
    // effectivePersonaName / brandName (personas.ts / naming.ts) instead of hardcoding the literal.
    expect(leaks).toEqual([]);
  });
});
