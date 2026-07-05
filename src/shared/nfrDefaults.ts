/**
 * nfrDefaults — the template-independent QUALITY baseline for web-frontend builds, exactly
 * analogous to the posture-gated *security* baseline but for non-functional requirements.
 *
 * The gap it closes: the scaffolder/wizard path creates projects with
 * `templateId: null`, so NO blueprint composes — and while the static-site *template* carries
 * SEO/a11y acceptance criteria, a scaffolded React app got none (the drafted plan lacked a
 * sitemap + JSON-LD until hand-added in review). This module gives ANY web-frontend scaffold
 * the floor a public web page needs: SEO, accessibility, async UI states, responsiveness.
 *
 * Scope discipline: applies ONLY when (a) the project was scaffolded with a WEB-FRONTEND
 * framework and (b) there is NO base blueprint (a template's blueprint owns its own depth —
 * composing both would duplicate criteria). APIs (express, dotnet-webapi), CLIs (oclif,
 * dotnet-console), and desktop apps (wpf/winforms) get nothing — '' everywhere, so every
 * other path stays byte-identical. Pure — no Node/Electron.
 */

import { SCAFFOLDERS } from './scaffold';
import { getBlueprint } from './blueprints';

/** Scaffolders that produce a WEB PAGE UI (SEO + a11y + page states apply). */
const WEB_FRONTEND_SCAFFOLD_IDS = new Set([
  'vite-react-ts',
  'vite-vue-ts',
  'vite-svelte-ts',
  'vite-solid-ts',
  'vite-preact-ts',
  'vite-vanilla-ts',
  'next',
  'angular',
  'dotnet-mvc',
  'dotnet-blazor',
]);

export function isWebFrontendScaffold(scaffoldId?: string | null): boolean {
  return !!scaffoldId && WEB_FRONTEND_SCAFFOLD_IDS.has(scaffoldId) && scaffoldId in SCAFFOLDERS;
}

/** True when the quality baseline applies: a web-frontend scaffold with no base blueprint. */
export function nfrApplies(scaffoldId?: string | null, templateId?: string | null): boolean {
  return isWebFrontendScaffold(scaffoldId) && !getBlueprint(templateId);
}

/**
 * The SEO half serves CRAWLERS — meaningless for an app only its owner's laptop will
 * ever see. Posture-gated like the auth rules: included unless the founder EXPLICITLY
 * chose `local-single-user` (an unset/inferred posture stays strict and keeps SEO —
 * a guess must never relax the baseline). Otherwise a localhost tool can grow a
 * sitemap generator serving no crawler, ever.
 */
export const NFR_SEO_RULES = [
  'SEO: every page ships a unique <title>, meta description, and Open Graph/Twitter card tags in the served HTML; generate a sitemap.xml at build time; add schema.org JSON-LD structured data where the content type has a natural shape (articles, products, episodes, events).',
] as const;

/** The posture-independent rules — a11y, UI states, responsiveness matter on EVERY machine. */
export const NFR_UNIVERSAL_RULES = [
  'Accessibility (WCAG AA): full keyboard operability, labels on every control, visible focus states, a logical heading order, and 4.5:1 text contrast.',
  'Async UI states: every surface that loads data or media has a real loading state (a skeleton, never a frozen control), an empty state, and a calm error state with a way forward — no dead ends, no raw error dumps.',
  'Responsive: layouts work from a small phone through desktop; no horizontal scroll at mobile widths.',
] as const;

/** The full baseline (kept for callers/tests that want the complete list). */
export const NFR_BASELINE_RULES = [...NFR_SEO_RULES, ...NFR_UNIVERSAL_RULES] as const;

function rulesFor(deploymentPosture?: string | null): readonly string[] {
  return deploymentPosture === 'local-single-user'
    ? NFR_UNIVERSAL_RULES
    : NFR_BASELINE_RULES;
}

/**
 * The plan-prompt section: makes the baseline a REQUIREMENT the drafted tasks must carry
 * (mirrors renderBlueprintForPlan's tone). '' when the baseline does not apply.
 */
export function nfrPlanBlock(
  scaffoldId?: string | null,
  templateId?: string | null,
  deploymentPosture?: string | null,
): string {
  if (!nfrApplies(scaffoldId, templateId)) {
    return '';
  }
  const local = deploymentPosture === 'local-single-user';
  return (
    `\n\nQUALITY BASELINE (non-functional requirements for a ${local ? 'local' : 'public'} web frontend — the plan MUST honor these):\n` +
    rulesFor(deploymentPosture)
      .map((r) => `- ${r}`)
      .join('\n') +
    '\nFold these into the matching tasks as acceptance criteria (the' +
    (local ? '' : ' SEO items belong with the page/routing work, the') +
    ' state items with each data-loading surface) — do not add a separate' +
    ' catch-all "quality" phase.'
  );
}

/**
 * The build/review context block for the Bullpen seats (mirrors securityRulesContextBlock):
 * dev is TOLD the quality floor up front; reviewers judge against the same list. '' when the
 * baseline does not apply — byte-identical for APIs/CLIs/desktop/template projects.
 */
export function nfrContextBlock(
  scaffoldId?: string | null,
  templateId?: string | null,
  deploymentPosture?: string | null,
): string {
  if (!nfrApplies(scaffoldId, templateId)) {
    return '';
  }
  return (
    '\n\nQUALITY BASELINE for this web frontend (REQUIREMENTS for the pages you write — satisfy' +
    ' them now, not after a review flags them):\n' +
    rulesFor(deploymentPosture)
      .map((r) => `- ${r}`)
      .join('\n')
  );
}
