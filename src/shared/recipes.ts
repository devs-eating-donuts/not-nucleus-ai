import type { RoleId } from './roles';

/**
 * Prompt recipes — reusable, named instruction snippets you can drop into a
 * role's prompt template (the "recipe" idea, adapted to the prompt
 * system). A recipe is just text appended to a role's prompt in the editor;
 * because role prompts are now wired into the engines (see renderCustomRolePrompt
 * in prompts.ts), inserting a recipe actually changes how that role behaves on a
 * run. Recipes may use {{variables}} like any template.
 */

export interface PromptRecipe {
  id: string;
  name: string;
  description: string;
  /** Roles this recipe is written for; 'all' = applies to any role. */
  appliesTo: RoleId[] | 'all';
  /** The text inserted into a role's prompt template. */
  body: string;
}

export const PROMPT_RECIPES: PromptRecipe[] = [
  {
    id: 'tdd',
    name: 'Test-Driven',
    description: 'Write the failing test first, then the code that satisfies it.',
    appliesTo: ['developer'],
    body: [
      'TEST-DRIVEN: For every unit of behavior, write a failing test FIRST, then the',
      'minimum code to pass it. Leave the test suite green and runnable with a single',
      'non-blocking command (e.g. `npm test -- --run`). Do not delete tests to make a',
      'build pass.',
    ].join(' '),
  },
  {
    id: 'accessibility',
    name: 'Accessibility-First',
    description: 'Semantic HTML, keyboard paths, and WCAG AA contrast by default.',
    appliesTo: ['developer', 'qa'],
    body: [
      'ACCESSIBILITY: Use semantic HTML and ARIA only where semantics fall short. Every',
      'interactive control must be keyboard-reachable and focus-visible. Meet WCAG 2.1 AA',
      'contrast. Provide alt text and form labels. Treat an inaccessible feature as',
      'incomplete.',
    ].join(' '),
  },
  {
    id: 'security-paranoid',
    name: 'Security-Paranoid',
    description: 'Validate every input, trust nothing, keep secrets out of code.',
    appliesTo: ['developer', 'security'],
    body: [
      'SECURITY POSTURE: Validate and sanitize every external input at the boundary. Never',
      'commit secrets — read them from the environment. Parameterize all queries. Default',
      'to least privilege. Assume any input from the network or filesystem is hostile.',
    ].join(' '),
  },
  {
    id: 'ship-mvp',
    name: 'Ship-Fast MVP',
    description: 'Build the smallest thing that works; defer polish and abstractions.',
    appliesTo: 'all',
    body: [
      'MVP MODE: Build the smallest thing that delivers the core value. Prefer boring,',
      'proven choices. Do not add abstractions, configuration, or features the brief does',
      'not require. Leave clearly-marked TODOs for deferred polish rather than gold-plating.',
    ].join(' '),
  },
  {
    id: 'perf-budget',
    name: 'Performance Budget',
    description: 'Respect a tight bundle/latency budget; measure before optimizing.',
    appliesTo: ['developer', 'qa'],
    body: [
      'PERFORMANCE BUDGET: Keep the initial client bundle lean — lazy-load non-critical',
      'routes and heavy deps. Avoid blocking the main thread. Where a target matters, state',
      'the budget (e.g. < 200KB JS, < 100ms interaction) and measure against it rather than',
      'guessing.',
    ].join(' '),
  },
  {
    id: 'strict-types',
    name: 'Strict Typing',
    description: 'No `any`, exhaustive unions, types at every boundary.',
    appliesTo: ['developer'],
    body: [
      'STRICT TYPING: No `any` and no unchecked casts. Type every public boundary',
      'explicitly. Make illegal states unrepresentable; handle every case of a union',
      'exhaustively. The type-check must pass with the project\'s strict settings.',
    ].join(' '),
  },
  {
    id: 'docs-and-commits',
    name: 'Docs & Clean Commits',
    description: 'Update the README and keep changes small and well-described.',
    appliesTo: ['developer'],
    body: [
      'HYGIENE: Keep changes focused. Update README.md and any affected docs when behavior',
      'changes. Describe what changed and why in clear prose. Do not leave dead code,',
      'commented-out blocks, or debug logging behind.',
    ].join(' '),
  },
  {
    id: 'design-handoff',
    name: 'Crisp Handoff',
    description: 'End with a structured summary the next role can act on cold.',
    appliesTo: ['architect', 'projectLead', 'stakeholder'],
    body: [
      'HANDOFF: End with a structured summary the next role can act on without re-reading',
      'everything: the decisions made, the open questions, and the single most important',
      'next step. Be concrete — names, paths, and choices, not vibes.',
    ].join(' '),
  },
  {
    id: 'debug-root-cause',
    name: 'Root-Cause Debugging',
    description: 'Find the real cause before touching code; lock it with a regression test.',
    appliesTo: ['developer'],
    body: [
      'ROOT-CAUSE FIRST: Reproduce the failure and isolate the smallest failing case before',
      'changing anything. Trace from the symptom to the responsible code and read the ACTUAL',
      'values — do not guess. Make the smallest change that fixes the cause, not the symptom;',
      'never widen a catch or suppress the error to hide it. Add a regression test that fails',
      'before the fix and passes after.',
    ].join(' '),
  },
  {
    id: 'safe-migration',
    name: 'Safe Migration',
    description: 'Map the blast radius first; migrate incrementally, staying green between steps.',
    appliesTo: ['developer'],
    body: [
      'SAFE MIGRATION: Before changing anything, find and list every call site and affected',
      'file — the full blast radius. Prefer an incremental path with a compatibility shim over',
      'a big-bang rewrite, and order the steps so the build stays green between each. Surface',
      'any irreversible step (especially data migrations) and its rollback BEFORE running it.',
      'Verify with a full build and tests after each slice.',
    ].join(' '),
  },
];

/** Recipes applicable to a given role (role-specific first, then 'all'). */
export function recipesForRole(roleId: RoleId): PromptRecipe[] {
  return PROMPT_RECIPES.filter(
    (r) => r.appliesTo === 'all' || r.appliesTo.includes(roleId),
  );
}
