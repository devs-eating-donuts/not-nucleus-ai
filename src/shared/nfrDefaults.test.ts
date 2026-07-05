import { describe, expect, it } from 'vitest';
import {
  isWebFrontendScaffold,
  nfrApplies,
  nfrContextBlock,
  nfrPlanBlock,
} from './nfrDefaults';

// The quality baseline for web-frontend builds — the missing-SEO gap: the
// scaffolder path (templateId null) composes no blueprint, so a public web page got no
// SEO/a11y/state requirements until a human added them in plan review.
describe('nfrDefaults', () => {
  it('classifies web-frontend scaffolds (pages) vs APIs/CLIs/desktop', () => {
    for (const id of ['vite-react-ts', 'next', 'angular', 'dotnet-blazor', 'dotnet-mvc']) {
      expect(isWebFrontendScaffold(id)).toBe(true);
    }
    for (const id of ['express', 'dotnet-webapi', 'oclif', 'dotnet-console', 'dotnet-wpf', 'dotnet-winforms']) {
      expect(isWebFrontendScaffold(id)).toBe(false);
    }
    expect(isWebFrontendScaffold(null)).toBe(false);
    expect(isWebFrontendScaffold(undefined)).toBe(false);
    expect(isWebFrontendScaffold('not-a-scaffolder')).toBe(false);
  });

  it('applies ONLY on the scaffolder path — a base blueprint owns its own depth', () => {
    expect(nfrApplies('vite-react-ts', null)).toBe(true); // the scaffolder-only shape
    expect(nfrApplies('vite-react-ts', undefined)).toBe(true);
    // A template WITH a blueprint (static-site) already carries SEO/a11y criteria — no double-up.
    expect(nfrApplies('vite-react-ts', 'static-site')).toBe(false);
    // A template with NO blueprint (poc) → the baseline still applies.
    expect(nfrApplies('vite-react-ts', 'poc')).toBe(true);
    expect(nfrApplies('express', null)).toBe(false); // API — no pages
    expect(nfrApplies(null, null)).toBe(false); // from-scratch, no scaffold
  });

  it('plan + context blocks carry the four rule families; empty when not applicable', () => {
    const plan = nfrPlanBlock('vite-react-ts', null);
    expect(plan).toMatch(/QUALITY BASELINE/);
    expect(plan).toMatch(/sitemap\.xml/);
    expect(plan).toMatch(/JSON-LD/);
    expect(plan).toMatch(/WCAG AA/);
    expect(plan).toMatch(/loading state/);
    expect(plan).toMatch(/Responsive/);
    // Folded into matching tasks, never a catch-all quality phase.
    expect(plan).toMatch(/do not add a separate.* catch-all/s);

    const ctx = nfrContextBlock('vite-react-ts', null);
    expect(ctx).toMatch(/QUALITY BASELINE/);
    expect(ctx).toMatch(/satisfy.* them now/s);

    // Byte-identical everywhere it doesn't apply.
    expect(nfrPlanBlock('express', null)).toBe('');
    expect(nfrPlanBlock('vite-react-ts', 'static-site')).toBe('');
    expect(nfrPlanBlock(null, null)).toBe('');
    expect(nfrContextBlock('oclif', null)).toBe('');
  });

  it('SEO is posture-gated: an EXPLICIT local-single-user posture drops it, everything else keeps it', () => {
    // Otherwise a localhost tool grows a sitemap generator serving no crawler.
    const local = nfrPlanBlock('vite-react-ts', null, 'local-single-user');
    expect(local).toMatch(/QUALITY BASELINE/);
    expect(local).not.toMatch(/sitemap\.xml/);
    expect(local).not.toMatch(/JSON-LD/);
    expect(local).toMatch(/WCAG AA/); // a11y + states + responsive matter locally too
    expect(local).toMatch(/loading state/);
    expect(local).toMatch(/Responsive/);

    // An unset/inferred posture stays STRICT — a guess must never relax the baseline.
    expect(nfrPlanBlock('vite-react-ts', null, undefined)).toMatch(/sitemap\.xml/);
    expect(nfrPlanBlock('vite-react-ts', null, 'internal')).toMatch(/sitemap\.xml/);
    expect(nfrPlanBlock('vite-react-ts', null, 'public-internet')).toMatch(/sitemap\.xml/);

    // The Bullpen context block gates the same way.
    expect(nfrContextBlock('vite-react-ts', null, 'local-single-user')).not.toMatch(/sitemap/);
    expect(nfrContextBlock('vite-react-ts', null, 'local-single-user')).toMatch(/WCAG AA/);
    expect(nfrContextBlock('vite-react-ts', null, 'multi-tenant')).toMatch(/sitemap\.xml/);
  });
});
