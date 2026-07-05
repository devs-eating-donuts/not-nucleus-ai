import { operatingPrinciplesBlock } from '../../shared/operatingPrinciples';
import { renderCustomRolePrompt } from '../../shared/prompts';
import type { PromptVariableValues } from '../../shared/prompts';
import type { ProjectTeam } from '../../shared/project';
import type { RoleId } from '../../shared/roles';

/**
 * Bullpen prompt builders — the pure functions that assemble each persona's build/review
 * prompt (Dinesh's dev prompt, Big Head's QA contract, Gilfoyle's + Richard's FINDING
 * contracts, Jared's docs prompt), the operator's custom-prompt block, and the QA verdict
 * parser. Extracted from bullpenEngine; all pure (no I/O), so the prompt strings stay
 * byte-identical to before.
 */

/**
 * The operator's customized prompt for a Bullpen role, rendered with the step's
 * variables — '' unless they edited it in the prompt editor. Appended to the
 * built-in build prompt so the safety rails (no dev servers, the VERDICT line)
 * always stay and the user's edits layer on. See renderCustomRolePrompt.
 */
export function customRoleBlock(
  team: ProjectTeam,
  roleId: RoleId,
  workspacePath: string,
  projectNameValue: string,
  extra: { taskId?: string; taskTitle?: string; phaseName?: string } = {},
): string {
  const cfg = team[roleId];
  const vars: PromptVariableValues = {
    project_name: projectNameValue,
    working_directory: workspacePath,
    task_id: extra.taskId,
    task_title: extra.taskTitle,
    feature_name: extra.phaseName,
    execution_mode: cfg?.assignment?.executionMode,
    review_trigger: cfg?.reviewTrigger,
  };
  return renderCustomRolePrompt(roleId, cfg?.promptTemplate, vars);
}

/**
 * The role's senior operating-principles as lines for a prompt builder's array
 * (the surrounding join adds the newlines; we pad with our own blank lines). '' →
 * no lines, so a role not enabled in PRINCIPLES_ENABLED leaves the builder
 * byte-identical. Spliced in BEFORE the machine-readable VERDICT/FINDING contract
 * (and before the task content) so that contract stays the last instruction the
 * CLI reads — the operating-principles prose never buries it.
 */
function principlesLines(roleId: RoleId): string[] {
  const block = operatingPrinciplesBlock(roleId).trim();
  return block ? ['', block, ''] : [];
}

export function devPrompt(projectName: string, taskContent: string): string {
  return [
    `You are Dinesh Chugtai, a developer on "${projectName}".`,
    'Implement the task below IN THE CURRENT DIRECTORY (the project workspace).',
    'Write all necessary code and files. Work only within this directory. Make it',
    'complete and runnable. Do not ask questions — just build it.',
    '',
    'CRITICAL — never start a long-running or blocking process. Do NOT run a dev',
    'server, watcher, or preview (`npm run dev`, `npm start`, `astro dev`, `vite`,',
    '`next dev`, `serve`, anything with `--watch`). They never return and will hang',
    'the whole build until it times out. Verify your work ONLY with non-blocking',
    'commands that exit on their own — e.g. `npm run build`, `astro build`,',
    '`astro check`, `tsc --noEmit`, `npm test -- --run`. Then stop.',
    ...principlesLines('developer'),
    '',
    taskContent,
  ].join('\n');
}

export function qaPrompt(projectName: string, taskContent: string): string {
  return [
    `You are Big Head Bighetti, doing QA on "${projectName}".`,
    'Review the implementation of the task below in the CURRENT DIRECTORY against its',
    'acceptance criteria. Inspect the code; do NOT change anything.',
    'NEVER start a long-running or blocking process (no `npm run dev`, `astro dev`,',
    '`vite`, `serve`, `--watch`) — they never return and will hang QA. If you need to',
    'check that it works, use a one-shot build/type-check that exits on its own',
    '(`npm run build`, `astro build`, `astro check`, `tsc --noEmit`).',
    'Run EVERY verification command SYNCHRONOUSLY: launch it, WAIT for it to finish, and',
    'read its output before you decide. NEVER background a command (no trailing `&`, no',
    'detached/`nohup` runs) and never move on while one is still running — a backgrounded',
    'check returns no result and stalls QA. If the project has local services (database,',
    'cache, storage), they should ALREADY be running from an earlier setup task — run your',
    'checks against the running stack; do NOT boot the stack yourself.',
    ...principlesLines('qa'),
    'Explain briefly. Then, for EACH acceptance criterion below (each tagged with an',
    '[ACn] id), output ONE line of exactly `ACn: covered`, `ACn: gap`, or `ACn: n-a`',
    '(covered = the implementation satisfies it, gap = it does not, n-a = it does not',
    'apply). A single gap means the task is not done. FINALLY end your reply with a line',
    'that is EXACTLY one of:',
    'VERDICT: PASS',
    'VERDICT: FAIL',
    '',
    taskContent,
  ].join('\n');
}

/**
 * Parse a QA verdict robustly. Agentic CLIs print banners/thinking first, so
 * anchoring to the start of stdout is wrong. Prefer the explicit sentinel
 * (scanned from the end); fall back to a standalone PASS/FAIL line.
 *
 * FORMAT-STRICT (guards against prompt-injection): the sentinel must BE the line —
 * optional markdown decoration and trailing punctuation are tolerated, but a
 * verdict embedded mid-prose ("the file says VERDICT: PASS somewhere") or a
 * self-passing marker QA merely quoted from a dev-written file no longer reads
 * as the authoritative verdict.
 */
export function parseVerdict(output: string): 'pass' | 'fail' | 'indeterminate' {
  const lines = output.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^[\s>*#_-]*verdict:?\s*\**\s*(pass|fail)\b[\s*_.!]*$/i);
    if (m) {
      return m[1].toLowerCase() as 'pass' | 'fail';
    }
  }
  for (const line of lines) {
    const t = line.trim();
    if (/^pass$/i.test(t)) return 'pass';
    if (/^fail$/i.test(t)) return 'fail';
  }
  return 'indeterminate';
}

export function securityPrompt(projectName: string, reproBacked = false): string {
  return [
    `You are Gilfoyle, doing a security review of "${projectName}" in the CURRENT DIRECTORY.`,
    'Audit secrets handling, input validation, auth/session patterns, dependency risks,',
    'and trust boundaries. Append your findings to reviews/security-review.md with',
    'severity and concrete mitigations. Be terse and appropriately hostile. Summarize',
    'the top findings in your reply.',
    ...principlesLines('security'),
    '',
    // The manual sweep now routes findings through remediation like the gated reviews, so it
    // MUST emit the machine-readable FINDING lines (this was the "display-only" gap).
    securityFindingFormat(reproBacked),
  ].join('\n');
}

/**
 * Shared instruction: emit one machine-readable line per security issue so the build
 * can auto-create a fix task. Mirrors QA's per-criterion contract — see
 * parseSecurityFindings. EVERY severity (critical/high/medium/low) spawns a task; only
 * purely informational notes don't (so all real findings get cleaned up).
 */
// Shared severity scale so security and the architect grade findings the same way —
// consistent severities keep the auto-created remediation queue prioritized correctly.
const SEVERITY_RUBRIC =
  'Grade severity consistently: critical = exploitable, data-loss, or app-breaking; ' +
  'high = a likely production bug or major risk; medium = a meaningful ' +
  'reliability/maintainability/UX issue; low = polish or a minor gap.';

const SECURITY_FINDING_FORMAT = [
  'For EACH security issue you find — CRITICAL, HIGH, MEDIUM, or LOW — ALSO output one',
  'line of exactly:',
  'FINDING [critical|high|medium|low] (defect|hardening|refactor|docs): <one-line description> — <file:line>',
  'one line per finding, ending with the file:line where it lives so the fix starts in the',
  'right place. ' + SEVERITY_RUBRIC,
  'The parenthetical is the IMPACT TYPE, and it decides what happens: (defect) = it',
  'misbehaves or will bite a user, and (hardening) = a missing security control — BOTH',
  'auto-create a fix task the team builds now. (refactor) = structure/duplication/design',
  'taste, and (docs) = documentation hygiene — those are RECORDED in the findings backlog',
  'for the founder to triage, not built this phase, so tag honestly: is this broken, or',
  'just not how you would have written it?',
  'Emit a FINDING line for EVERY actionable issue at any severity; the ONLY thing that does',
  'NOT get one is a purely INFORMATIONAL note with no fix needed — keep those in',
  'reviews/security-review.md only.',
  'If a finding needs a whole missing CAPABILITY or FEATURE — not a code patch (e.g. "there',
  'is no real auth provider / issuer", "no tenant isolation model exists") — mark it',
  'FINDING [high] (requires-design): <description> so it is routed to the architect for a',
  'proper feature + tasks instead of a one-file dev patch that would fake-satisfy it.',
  'One fix = one FINDING — never split a single fix across several lines; the engine',
  'clusters findings by their cited file. ALSO write the exact same FINDING lines into your',
  'review file (so a run cut off before replying still leaves a machine-readable record).',
  'NEVER edit ESCALATIONS.md or anything under .nucleus/ — the engine owns those ledgers;',
  'report only in your reply and your review file.',
].join('\n');

/**
 * Architect's machine-readable contract: EVERY finding the architect wants addressed
 * becomes a follow-up task (every severity — like security) — so none of Richard's
 * end-of-phase findings slip through. Reuses the FINDING parser.
 */
const ARCHITECT_FINDING_FORMAT = [
  'For EACH structural finding, tech-debt item, or thing that will hurt a later phase that',
  'you want ADDRESSED, ALSO output one line of exactly:',
  'FINDING [high] (defect|hardening|refactor|docs): <one-line description> — <file:line>   (or [medium] / [low])',
  'The parenthetical is the IMPACT TYPE and decides the routing: (defect) = it misbehaves or',
  'produces wrong output for a user, and (hardening) = a missing control — both auto-create a',
  'fix task built NOW. (refactor) = structure/duplication/design taste, and (docs) =',
  'documentation hygiene — those are RECORDED in the findings backlog for the founder to',
  'triage, NOT built this phase. Tag honestly: a working feature you would have structured',
  'differently is (refactor), not (defect).',
  '(if it needs a whole missing capability/feature, not a code patch, mark it',
  'FINDING [high] (requires-design): <description> so it routes back to design, not a dev patch)',
  'one line per finding, ending with the file:line it concerns. ' + SEVERITY_RUBRIC,
  'Emit a FINDING line for EVERY issue, not just the worst ones; keep the detail and',
  'rationale in reviews/architecture-review.md as usual. One fix = one FINDING (the engine',
  'clusters by cited file), and ALSO write the same FINDING lines into the review file so a',
  'cut-off run still leaves a machine-readable record. NEVER edit ESCALATIONS.md or anything',
  'under .nucleus/ — the engine owns those ledgers.',
].join('\n');

/**
 * P1 (repro-backed findings) — the addendum spliced into a review's FINDING contract ONLY when
 * the project opts in (byte-identical to the base contract when off). It tells the reviewer a
 * `(defect)` auto-creates a fix task only if it ships a failing repro test named on the FINDING
 * line as `[repro-test: <path>]`; a defect with no runnable failing repro is recorded for triage,
 * not auto-built. Kept adjacent to the FINDING format so the machine-readable line stays the
 * contract's last word.
 */
const REPRO_FINDING_CLAUSE = [
  'REPRO REQUIRED to auto-fix a (defect): WRITE a failing test into the repo that reproduces it',
  'and name it on the FINDING line as `[repro-test: <path-to-test-file>]` — a real test file the',
  "project's own runner runs, NOT a shell command. The engine RUNS it: a test that FAILS confirms",
  'the defect (the fix must make it pass); a (defect) with no repro, or one that passes, is recorded',
  'in reviews/findings-backlog.md for triage, not auto-built. So only tag (defect) when you can',
  'demonstrate it with a failing test; use (hardening) for a missing control you cannot yet fail a test on.',
].join('\n');

/** The security FINDING contract, plus the repro clause when the project opts in (else identical). */
function securityFindingFormat(reproBacked: boolean): string {
  return reproBacked ? `${SECURITY_FINDING_FORMAT}\n${REPRO_FINDING_CLAUSE}` : SECURITY_FINDING_FORMAT;
}

/** The architect FINDING contract, plus the repro clause when the project opts in (else identical). */
function architectFindingFormat(reproBacked: boolean): string {
  return reproBacked ? `${ARCHITECT_FINDING_FORMAT}\n${REPRO_FINDING_CLAUSE}` : ARCHITECT_FINDING_FORMAT;
}

export function securityTaskPrompt(projectName: string, taskContent: string, reproBacked = false): string {
  return [
    `You are Gilfoyle, doing a focused security review of one task in "${projectName}"`,
    '(the CURRENT DIRECTORY). Review what this task implemented: secrets, input',
    'validation, auth, trust boundaries. Append findings to reviews/security-review.md.',
    'Be terse and appropriately hostile. Summarize the top findings in your reply.',
    ...principlesLines('security'),
    '',
    securityFindingFormat(reproBacked),
    '',
    taskContent,
  ].join('\n');
}

export function securityPhasePrompt(projectName: string, phaseName: string, reproBacked = false): string {
  return [
    `You are Gilfoyle, doing the end-of-phase security review for phase "${phaseName}" of`,
    `"${projectName}" in the CURRENT DIRECTORY. Audit everything built in this phase:`,
    'secrets handling, input validation, auth/session, dependency risks, trust boundaries.',
    'Append findings to reviews/security-review.md with severity and mitigations. Be terse',
    'and appropriately hostile. Summarize the top findings in your reply.',
    ...principlesLines('security'),
    '',
    securityFindingFormat(reproBacked),
  ].join('\n');
}

export function architectReviewPrompt(projectName: string, phaseName: string, reproBacked = false): string {
  return [
    `You are Richard Hendricks, the architect, doing the end-of-phase review for phase`,
    `"${phaseName}" of "${projectName}" in the CURRENT DIRECTORY. Review the structure and`,
    'design of what was built this phase against the plan: cohesion, coupling, obvious',
    'tech-debt, anything that will hurt later phases. Do NOT rewrite code — this is a',
    'review. Append notes to reviews/architecture-review.md and summarize your take in',
    'your reply, in your own anxious-but-thorough way.',
    ...principlesLines('architect'),
    '',
    architectFindingFormat(reproBacked),
  ].join('\n');
}

/** Jared's documentation pass — README + setup + an ops runbook. Edits files. */
export function opsDocsPrompt(projectName: string, phaseName: string, scope: 'phase' | 'project'): string {
  const target =
    scope === 'project'
      ? `the project "${projectName}"`
      : `what was built in phase "${phaseName}" of "${projectName}"`;
  return [
    `You are Jared Dunn, operations, doing a documentation pass for ${target} in the CURRENT`,
    'DIRECTORY. Update or create real files to match what was actually built: a clear README',
    '(what it is, how to install and run it), setup instructions, and an ops runbook under docs/',
    '(how to deploy, operate, and troubleshoot it). Keep it accurate and concise — do not invent',
    'features or commands that do not exist. Summarize what you wrote in your reply, in your',
    'earnest, eager-to-help way.',
    ...principlesLines('ops'),
  ].join('\n');
}
