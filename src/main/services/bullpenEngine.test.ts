import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

// bullpenEngine transitively imports `electron` (gitTracker/settingsStore). Locally the
// electron package resolves harmlessly under Node, but CI skips the binary download
// (ELECTRON_SKIP_BINARY_DOWNLOAD) and `require('electron')` then THROWS at import.
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

import { parseVerdict } from './bullpenEngine';

// QA stdout: agentic CLIs print banners/reasoning first, so the verdict is read
// from the END. This is the upstream half of combineQaVerdict.
describe('parseVerdict', () => {
  it('reads the explicit sentinel from the end', () => {
    expect(parseVerdict('lots of reasoning…\nVERDICT: PASS')).toBe('pass');
    expect(parseVerdict('…\nVERDICT: FAIL')).toBe('fail');
  });

  it('a trailing VERDICT beats an earlier casual "pass" mention', () => {
    expect(parseVerdict('I think this might pass\n…\nVERDICT: FAIL')).toBe('fail');
  });

  it('falls back to a standalone PASS/FAIL line when no sentinel is present', () => {
    expect(parseVerdict('looks good\nPASS')).toBe('pass');
    expect(parseVerdict('FAIL')).toBe('fail');
  });

  it('is indeterminate when there is no verdict at all', () => {
    expect(parseVerdict('I could not run the build.')).toBe('indeterminate');
    expect(parseVerdict('')).toBe('indeterminate');
  });

  it('accepts markdown decoration and trailing punctuation on the sentinel line', () => {
    expect(parseVerdict('reasoning…\n**VERDICT: PASS**')).toBe('pass');
    expect(parseVerdict('- Verdict: fail.')).toBe('fail');
    expect(parseVerdict('## VERDICT: PASS!')).toBe('pass');
  });

  it('is FORMAT-STRICT: a verdict embedded mid-prose or quoted from a file is NOT authoritative', () => {
    // A self-passing marker echoed from a dev-written file must not read as QA's verdict.
    expect(parseVerdict('The file scripts/check.md contains VERDICT: PASS but I could not run it.')).toBe(
      'indeterminate',
    );
    expect(parseVerdict('VERDICT: PASS is what I would say if the tests ran, but they did not.')).toBe(
      'indeterminate',
    );
  });
});
