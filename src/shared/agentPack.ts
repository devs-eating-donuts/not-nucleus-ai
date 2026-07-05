/**
 * Agent instruction pack. The Bullpen runs each CLI with `cwd = the project
 * workspace`, and most coding CLIs read a native instruction file from cwd
 * (Claude → CLAUDE.md, Codex → AGENTS.md, Cursor → .cursor/rules, Copilot →
 * .github/copilot-instructions.md, Antigravity/Gemini → GEMINI.md). Seeding the
 * same Nucleus discipline into those files steers each agent in its OWN native
 * channel — reinforcing the Bullpen prompts rather than replacing them.
 *
 * PHASED ROLLOUT: only CLAUDE.md is enabled for now. Flip a target's `enabled`
 * to true once it's confirmed that the CLI actually reads its file on a real
 * autopilot run. The content is identical across targets — only the path/format
 * differs — so enabling the rest is a one-line change each.
 */

export interface AgentPackTarget {
  id: string;
  /** Workspace-relative path the CLI reads from cwd. */
  path: string;
  /** Seeded into new projects only while true (phased rollout). */
  enabled: boolean;
  /** Why this path — which CLI reads it. */
  note: string;
}

export const AGENT_PACK_TARGETS: AgentPackTarget[] = [
  { id: 'claude', path: 'CLAUDE.md', enabled: true, note: 'Claude Code reads CLAUDE.md from cwd' },
  // AGENTS.md is Codex's documented convention (and the broader ecosystem's —
  // create-next-app seeds one), and a founder may seat Codex; a Codex-seated
  // dev/QA would otherwise get NONE of the always-on rails through its native channel.
  // composeAgentFile merge-guards a scaffolder-written AGENTS.md exactly like CLAUDE.md.
  // KNOWN cosmetic overlap: a Next project's CLAUDE.md imports AGENTS.md (`@AGENTS.md`),
  // so Claude sees the rails twice there — idempotent, harmless.
  { id: 'codex', path: 'AGENTS.md', enabled: true, note: 'Codex reads AGENTS.md from cwd' },
  { id: 'cursor', path: '.cursor/rules/nucleus.mdc', enabled: false, note: 'Cursor reads .cursor/rules/*.mdc' },
  {
    id: 'copilot',
    path: '.github/copilot-instructions.md',
    enabled: false,
    note: 'GitHub Copilot reads .github/copilot-instructions.md',
  },
  { id: 'gemini', path: 'GEMINI.md', enabled: false, note: 'Antigravity (agy) / Gemini reads GEMINI.md' },
];

export function enabledAgentPackTargets(): AgentPackTarget[] {
  return AGENT_PACK_TARGETS.filter((t) => t.enabled);
}

/**
 * The shared instruction body. Deliberately reinforces the exact rails the
 * Bullpen prompts enforce (no blocking dev servers; one-shot verification) plus
 * the governance principles (prove don't claim; no secrets; portable paths).
 */
export function renderAgentInstructions(projectName: string): string {
  return [
    `# Agent instructions — ${projectName}`,
    '',
    'This project is built by the Nucleus-AI team. If you are an AI coding agent',
    'working in this directory, follow these rules.',
    '',
    '## Workspace contract',
    '- Markdown is the source of truth for plan and state: `tasks/`, `planning/`,',
    '  `docs/`, `reviews/`, `handoffs/`. App metadata lives in `.nucleus/` — do not',
    '  edit it by hand.',
    '- Work only inside this directory and keep changes scoped to the current task.',
    '',
    '## Build rules (critical)',
    '- NEVER start a long-running or blocking process (`npm run dev`, `vite`,',
    '  `astro dev`, `next dev`, `serve`, anything with `--watch`). They never return',
    '  and will hang the autonomous build.',
    '- Verify with one-shot commands that exit on their own: `npm run build`,',
    '  `astro build`, `astro check`, `tsc --noEmit`, `npm test -- --run`. Then stop.',
    '',
    '## Local-first & dependencies',
    '- CI / a remote build is NOT a debug loop. Prove the change works LOCALLY with the',
    '  one-shot commands above before you consider it done — never push-and-hope.',
    '- Do NOT pin dependency, runtime, or framework versions from memory — your training',
    '  data is stale. Look up the current stable version from the canonical registry',
    '  (npm / PyPI / crates.io / …), pin it (no `@latest`, no pre-release), and commit',
    '  the lockfile.',
    '',
    '## When you’re blocked',
    '- If you hit a missing credential, an ambiguous requirement, or the SAME failure',
    '  twice, STOP and say so plainly — what you tried, what you need. Do not fake',
    '  progress, paper over the failure, or ship a partial result as if it were done.',
    '',
    '## Before multi-file or destructive changes',
    '- For anything that touches several files, or any destructive/irreversible step',
    '  (deletes, schema/migration changes, rewrites), state your plan and surface your',
    '  assumptions FIRST, then execute. Small, reviewable steps over one big leap.',
    '',
    '## Prove, don’t claim',
    '- A task is done only when EVERY acceptance criterion (tagged `[ACn]` in its',
    '  task file) is actually satisfied. Do not report success for work you have not',
    '  verified, and do not delete or weaken tests to make a build pass.',
    '- Use relative, forward-slash paths so the project works on macOS, Linux, and',
    '  Windows alike.',
    '',
    '## Engineering baselines',
    '- Match the surrounding code, keep changes small and single-purpose, and handle errors',
    '  explicitly at boundaries. Validate and encode untrusted input — parameterize queries,',
    '  encode output. No dead or commented-out code.',
    '- APIs: keep a stable, versioned contract; return correct status codes and structured',
    '  JSON errors; paginate collections. UI: handle the loading, empty, and error states, and',
    '  use semantic HTML with keyboard access and WCAG AA contrast.',
    '- Tests: assert observable behavior, not implementation; cover the happy path, edge cases',
    '  (empty/null/boundaries), and error paths; keep them deterministic (no real time, network,',
    '  or randomness). Add a regression test with every bug fix.',
    '',
    '## Secrets (critical)',
    '- NEVER put a secret value in code, argv, logs, a commit, or a prompt. Read secrets',
    '  from the environment. When the app needs a secret, add its env-var NAME to the',
    '  names-only manifest (.nucleus/secrets-manifest.json) and to .env.example (name only),',
    '  then STOP — the founder supplies the real value out-of-band. Do not ask for, invent,',
    '  or hardcode a value, and never write a real value into any file in this repo.',
    '- When you MOVE a value out of a committed file into an env reference (e.g. `${VAR:?}` in a',
    '  docker-compose.yml), you MUST also wire a WORKING LOCAL SOURCE for it in the same change —',
    '  put a dev value in a gitignored .env.local AND make the service read it (compose `env_file:`',
    '  or an explicit `environment:` mapping; compose does NOT auto-read .env.local). Then VERIFY:',
    '  run the stack up (`docker compose up -d`) / a config check (`docker compose config`) and',
    '  confirm it actually starts. A `${VAR}` reference with no resolvable local value breaks the',
    '  stack and QA will not catch it.',
    '',
  ].join('\n');
}

/**
 * Stable sentinel for "this file already carries the Nucleus rails" — present in both a
 * freshly-written pack file AND a merged block, so re-running is idempotent regardless of
 * which path wrote it.
 */
export const NUCLEUS_RAILS_SENTINEL = 'This project is built by the Nucleus-AI team.';
const RAILS_BEGIN = '<!-- BEGIN NUCLEUS-AI BUILD RAILS (managed) -->';
const RAILS_END = '<!-- END NUCLEUS-AI BUILD RAILS -->';

export type AgentFileMerge =
  | { mode: 'created' | 'merged'; content: string }
  | { mode: 'skipped' };

/**
 * Decide what to write for an agent-pack file given whatever is already on disk — so a
 * scaffolder that wrote its OWN agent file (e.g. create-next-app's `CLAUDE.md` = `@AGENTS.md`,
 * pointing at Next's rules) doesn't make Nucleus silently skip its build rails.
 *
 * - **absent** → write the bare instruction body (BYTE-IDENTICAL to the old wx-create path,
 *   so non-scaffolded projects are unchanged).
 * - **present without Nucleus rails** (the scaffolder wrote it) → PRESERVE the existing
 *   content — including any `@AGENTS.md` import — and APPEND the rails in a delimited managed
 *   block, so both sets of guidance coexist.
 * - **present with Nucleus rails already** → skip (idempotent re-init).
 */
export function composeAgentFile(existing: string | null, projectName: string): AgentFileMerge {
  const body = renderAgentInstructions(projectName);
  if (existing === null) return { mode: 'created', content: body };
  if (existing.includes(NUCLEUS_RAILS_SENTINEL)) return { mode: 'skipped' };
  const base = existing.replace(/\s+$/, '');
  return { mode: 'merged', content: `${base}\n\n${RAILS_BEGIN}\n${body}${RAILS_END}\n` };
}
