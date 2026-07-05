/**
 * CLI assignment model. Capability-aware: the UI and run engine adapt to
 * what each CLI actually supports instead of assuming uniform semantics.
 */

export type ExecutionMode = 'prompted' | 'autopilot' | 'workspace-unrestricted';

export function isExecutionMode(value: unknown): value is ExecutionMode {
  return (
    typeof value === 'string' &&
    ['prompted', 'autopilot', 'workspace-unrestricted'].includes(value)
  );
}

export interface CliCapabilities {
  supportsModelSelection: boolean;
  supportsThinkingLevel: boolean;
  /** Known model ids, if the CLI exposes a fixed set. */
  supportedModels?: string[];
  /** Known thinking levels, if the CLI exposes a fixed set. */
  supportedThinkingLevels?: string[];
  requiresPty: boolean;
  supportsStreaming: boolean;
  supportsAutopilot: boolean;
  supportsPromptedMode: boolean;
}

/** A user-controlled mapping from a role to a local AI CLI setup. */
export interface CliAssignment {
  /** CLI_PRESETS id this assignment was seeded from, if any. UI hint only. */
  presetId?: string;
  /** Display name, e.g. "Claude CLI". */
  cliName: string;
  /** Executable path or command name resolvable on PATH. */
  command: string;
  /** Always passed before per-step args. spawn(command, args) — never shell strings. */
  defaultArgs: string[];
  /** Extra environment variables for the child process. */
  env: Record<string, string>;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  capabilities: CliCapabilities;
  executionMode: ExecutionMode;
}

// Prompt template variables live in prompts.ts; the role's editable
// template lives on RoleConfiguration (settings.ts) — prompts belong to
// the role, not to whichever CLI currently fills the seat.

/**
 * Presets for commonly installed AI CLIs. These are starting points the
 * user can edit — capabilities are conservative defaults, not gospel.
 */
export interface CliPreset {
  id: string;
  cliName: string;
  command: string;
  /**
   * Other names the same tool may be installed as. Validation falls back
   * to these if the primary command is not found — e.g. Cursor ships both
   * `cursor-agent` and `agent`.
   */
  commandAliases?: string[];
  defaultArgs: string[];
  /**
   * Args that check for and install an update (e.g. ['update']). Drives
   * the "Check for updates" button on the AI CLIs page; omit for none.
   */
  updateArgs?: string[];
  /**
   * Args that request one-shot, non-interactive output. Most CLIs use ['-p'];
   * Codex uses ['exec']. Defaults to ['-p'] when omitted. How the prompt TEXT
   * itself reaches the CLI is governed by `promptVia`.
   */
  promptArgs?: string[];
  /**
   * How the prompt text is delivered to the CLI:
   *  - 'stdin' (default): piped to the child's stdin — keeps argv fixed/trusted.
   *    Works for CLIs that read stdin in print mode (Claude, Codex).
   *  - 'arg': passed as the argument immediately after promptArgs (e.g.
   *    `copilot -p "<prompt>"`). Required by CLIs that ignore stdin one-shot
   *    (Copilot, agy). Safe ONLY for direct-spawn native executables (.exe),
   *    never a cmd.exe shim, so a multi-line/metacharacter prompt can't break the
   *    command line. The invoker ENFORCES this: an 'arg' CLI resolves to a native
   *    binary or the run is refused (it never builds a .cmd/.bat cmd.exe line with
   *    the prompt). See `resolveNativeExecutable` / CVE-2024-24576 "BatBadBut".
   */
  promptVia?: 'stdin' | 'arg';
  /**
   * Extra flags for autonomous, auto-approving execution (The Bullpen) so the
   * agent can write files without prompting. Appended after promptArgs — and
   * after the prompt arg for arg-delivery CLIs (stdin-delivery CLIs keep the
   * prompt off argv entirely). The agent runs with cwd set to the project folder
   * — that scopes relative paths, but is NOT a hard filesystem sandbox.
   */
  autopilotArgs?: string[];
  /**
   * Flag that selects a model, e.g. '--model'. When set and the assignment has
   * a defaultModel, the invoker appends `[modelFlag, model]`. Best-effort per
   * CLI; omit for CLIs that don't take a model flag.
   */
  modelFlag?: string;
  /**
   * Flag that sets a reasoning/thinking level, e.g. '--reasoning-effort'. Only
   * for CLIs whose thinking IS a flag (Copilot); CLIs that bake thinking into
   * prompt keywords (Claude) or model variants (Cursor) leave this unset.
   */
  thinkingFlag?: string;
  /**
   * How a configured thinking/reasoning LEVEL reaches the CLI:
   *  - 'flag' (implied when `thinkingFlag` is set): passed as `[thinkingFlag, level]`
   *    in argv — Copilot's `--reasoning-effort`.
   *  - 'prompt': the CLI has no thinking flag; its thinking is triggered by KEYWORDS in
   *    the prompt (Claude: think / think hard / ultrathink). The invoker appends the
   *    keyword from `thinkingPromptKeywords` to the prompt text.
   *  - 'config': the level is a config OVERRIDE, not a plain flag — emitted as
   *    `['-c', '<thinkingConfigKey>=<level>']` (Codex's `-c model_reasoning_effort=high`).
   *    Needed because the value must live inside a `key=value` token, which the
   *    `[flag, level]` shape can't express.
   */
  thinkingVia?: 'flag' | 'prompt' | 'config';
  /**
   * For `thinkingVia: 'prompt'` — maps each thinking level to the prompt keyword to
   * append. A level absent from the map (e.g. 'default') contributes no keyword, so the
   * prompt stays byte-identical to the unset case.
   */
  thinkingPromptKeywords?: Record<string, string>;
  /**
   * For `thinkingVia: 'config'` — the config key a level sets, e.g. Codex's
   * `model_reasoning_effort`. The invoker emits `['-c', '<key>=<level>']`.
   */
  thinkingConfigKey?: string;
  /**
   * How the engine spawns this CLI:
   *  - 'spawn' (default): plain child_process via `runResolvedCommand`. Works for
   *    every CLI that emits to a normal stdout pipe (Claude, Codex, Copilot, …).
   *  - 'pty': run inside a pseudo-terminal (node-pty / Windows ConPTY) via
   *    `runResolvedCommandPty`. Required by CLIs that gate output on a real TTY
   *    (`isatty`) and print NOTHING to a pipe — currently only Antigravity `agy`,
   *    whose `-p/--print` mode drops stdout in non-TTY contexts. Note: this is a
   *    distinct, precise signal from `capabilities.requiresPty`, which is a
   *    conservative UI hint set on most presets; routing keys on THIS field only.
   */
  execVia?: 'spawn' | 'pty';
  /**
   * True when the CLI gives UNRELIABLE one-shot QA verdicts even on the spawn path — e.g.
   * cursor-agent backgrounds its retrieval/agentic work on a real QA workload and stalls out
   * the full timeout without ever emitting a PASS/FAIL.
   * The PTY case is caught by `execVia` alone; this covers the spawn-but-still-stall-prone CLIs.
   * Advisory only: folds into `isReliableForQa` to warn on the QA seat, never to block a choice.
   */
  qaStallsProne?: boolean;
  /**
   * Flag that makes the CLI write its FINAL answer to a file, e.g. Codex's
   * `--output-last-message`. When set, the invoker points it at a per-run temp
   * file and treats that file as the authoritative output (falling back to the
   * stdout tail only if it's missing/empty). This is the reliable transport for
   * Codex, whose `exec` can hand stdout to a persistent app-server that holds the
   * pipe open — the file has the clean answer even when stdout is held or the run
   * timed out mid-way. Value (the temp path) is supplied per-invocation, never
   * baked into the static preset.
   */
  finalMessageFileFlag?: string;
  capabilities: CliCapabilities;
}

/** A known CLI's status on this machine (AI CLIs page). */
export interface CliDetection {
  id: string;
  cliName: string;
  command: string;
  installed: boolean;
  version: string | null;
  resolvedPath: string | null;
  /** Whether an update command is configured for this CLI. */
  canUpdate: boolean;
}

/** Result of running a CLI's update command. */
export interface CliUpdateResult {
  id: string;
  ok: boolean;
  output: string;
}

/**
 * Result of a one-shot "does this CLI actually respond?" test (onboarding's Test
 * button). `ok` means the CLI ran AND a model answered the trivial prompt — an
 * auth-required notice that exits cleanly is `ok: false`, since no model replied.
 */
export interface CliTestResult {
  id: string;
  ok: boolean;
  /** Trimmed model output on success, or the error / auth message on failure. */
  output: string;
  durationMs: number;
}

export const CLI_PRESETS: CliPreset[] = [
  {
    id: 'claude',
    cliName: 'Claude CLI',
    command: 'claude',
    defaultArgs: [],
    updateArgs: ['update'],
    autopilotArgs: ['--dangerously-skip-permissions'],
    modelFlag: '--model',
    // Claude's extended thinking is keyword-driven, not a flag: the invoker appends the
    // mapped keyword to the prompt. 'default' is intentionally absent (= no keyword).
    thinkingVia: 'prompt',
    thinkingPromptKeywords: { think: 'think', 'think-hard': 'think hard', ultrathink: 'ultrathink' },
    capabilities: {
      supportsModelSelection: true,
      supportsThinkingLevel: true,
      supportedModels: ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      supportedThinkingLevels: ['default', 'think', 'think-hard', 'ultrathink'],
      requiresPty: true,
      supportsStreaming: true,
      supportsAutopilot: true,
      supportsPromptedMode: true,
    },
  },
  {
    id: 'codex',
    cliName: 'Codex CLI',
    command: 'codex',
    defaultArgs: [],
    updateArgs: ['update'],
    // `codex exec` is the non-interactive mode (prompt read from stdin, verified).
    // `--skip-git-repo-check` lets it run in Nucleus workspaces that aren't git
    // repos (codex exec otherwise refuses outside a repository). `-c
    // approval_policy=never` is the exec-scoped way to never wait for approval
    // (the global `--ask-for-approval` must precede `exec`); it covers prompted
    // rooms — autopilot additionally bypasses the sandbox below.
    promptArgs: ['exec', '--skip-git-repo-check', '-c', 'approval_policy=never'],
    // Bullpen autopilot: full autonomy incl. network (dev tasks may `npm install`).
    // (A more constrained alternative is `--sandbox workspace-write`, but that
    // blocks network by default — would break dependency-installing dev steps.)
    autopilotArgs: ['--dangerously-bypass-approvals-and-sandbox'],
    // Codex hands stdout to a persistent app-server; the final-message file is the
    // reliable transport. The invoker supplies the per-run temp path.
    finalMessageFileFlag: '--output-last-message',
    modelFlag: '--model',
    // Codex's reasoning effort is a config OVERRIDE, not a flag or a prompt keyword:
    // `-c model_reasoning_effort=<level>` (low/medium/high verified live on codex-cli
    // 0.141.0; the current Codex docs list minimal|low|medium|high|xhigh for headless
    // `codex exec`). The docs show the TOML-quoted form (`model_reasoning_effort="high"`);
    // our bare value works because codex treats a non-TOML `-c` value as a plain string.
    // The invoker emits it as a second `-c` (alongside the approval-policy override in
    // promptArgs). The model rides the shared modelFlag (`--model gpt-5.5`); no fixed
    // supportedModels list on purpose — Codex model ids churn, so the Model box stays
    // free-text and unset means the user's own config.toml default.
    thinkingVia: 'config',
    thinkingConfigKey: 'model_reasoning_effort',
    capabilities: {
      supportsModelSelection: true,
      supportsThinkingLevel: true,
      // Ordered low→high — stepDownThinkingLevel walks this ladder on a timeout retry.
      supportedThinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      requiresPty: true,
      supportsStreaming: true,
      supportsAutopilot: true,
      supportsPromptedMode: true,
    },
  },
  {
    id: 'cursor',
    cliName: 'Cursor CLI',
    // Cursor's headless agent. The standalone install script creates two
    // shims for the same binary — `cursor-agent` (established alias) and
    // `agent` (the name newer docs lead with). Non-interactive via `-p`;
    // thinking is baked into model variants, not a separate flag.
    command: 'cursor-agent',
    commandAliases: ['agent'],
    defaultArgs: [],
    updateArgs: ['update'],
    // `--force` auto-allows commands/edits; `--trust` skips the workspace-trust
    // prompt (a headless-only flag, verified in `cursor-agent --help`);
    // `--approve-mcps` avoids an MCP approval prompt. Together they keep autopilot
    // from blocking on a confirmation it can't answer one-shot.
    autopilotArgs: ['--force', '--trust', '--approve-mcps'],
    modelFlag: '--model',
    // cursor-agent runs via spawn, but under a real QA workload it backgrounds its
    // retrieval/agentic work and stalls out the full timeout without emitting a verdict
    // — so warn on the QA seat even though it isn't a PTY CLI.
    qaStallsProne: true,
    capabilities: {
      supportsModelSelection: true,
      supportsThinkingLevel: false,
      requiresPty: true,
      supportsStreaming: true,
      supportsAutopilot: true,
      supportsPromptedMode: true,
    },
  },
  {
    id: 'antigravity',
    cliName: 'Antigravity CLI',
    // Google ships the Antigravity CLI binary as `agy` (not `antigravity`,
    // which is the IDE). Models: Gemini family plus optional Claude/OSS.
    // `agy -p/--print` takes the prompt as ITS argument (stdin delivery
    // hard-errors "flag needs an argument: -p") AND only flushes output to a real
    // terminal — a plain pipe gets nothing (antigravity-cli#76/#115). So agy runs
    // via the PTY path (`execVia: 'pty'`, node-pty/ConPTY) with arg delivery,
    // which returns clean text incl. multi-line prompts. Do NOT
    // switch this to the plain spawn path — there it would hang or emit nothing.
    command: 'agy',
    defaultArgs: [],
    updateArgs: ['update'],
    promptVia: 'arg',
    execVia: 'pty',
    autopilotArgs: ['--dangerously-skip-permissions'],
    modelFlag: '--model',
    capabilities: {
      supportsModelSelection: true,
      supportsThinkingLevel: false,
      requiresPty: true,
      supportsStreaming: true,
      supportsAutopilot: true,
      supportsPromptedMode: true,
    },
  },
  {
    id: 'copilot',
    cliName: 'GitHub Copilot CLI',
    // The standalone agentic `copilot` (winget GitHub.Copilot / npm
    // @github/copilot) — NOT the deprecated `gh copilot` extension, and
    // NOT Microsoft Copilot. Non-interactive via `-p`; `--model` selects
    // the model; `--reasoning-effort` takes a fixed set of levels.
    command: 'copilot',
    // `-s` (silent): print only the agent's response, no stats banner — cleaner
    // text to capture and parse one-shot (verified in `copilot --help`).
    defaultArgs: ['-s'],
    updateArgs: ['update'],
    // Copilot ignores a piped stdin prompt one-shot — it must be passed as the
    // argument after `-p` (verified: stdin → idle, arg → clean output).
    promptVia: 'arg',
    autopilotArgs: ['--allow-all-tools'],
    modelFlag: '--model',
    thinkingFlag: '--reasoning-effort',
    capabilities: {
      supportsModelSelection: true,
      supportsThinkingLevel: true,
      supportedThinkingLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      requiresPty: true,
      supportsStreaming: true,
      supportsAutopilot: true,
      supportsPromptedMode: true,
    },
  },
  {
    id: 'custom',
    cliName: 'Custom CLI',
    command: '',
    defaultArgs: [],
    capabilities: {
      supportsModelSelection: false,
      supportsThinkingLevel: false,
      requiresPty: false,
      supportsStreaming: true,
      supportsAutopilot: false,
      supportsPromptedMode: true,
    },
  },
];

/**
 * Whether a CLI gives reliable one-shot QA verdicts. Two unreliable classes: PTY-backed
 * CLIs (Antigravity `agy`, `execVia: 'pty'`) that run in a pseudo-terminal and BACKGROUND
 * long checks (`npm test`, `docker compose up`) then return before they finish; and
 * spawn-based CLIs flagged `qaStallsProne` (cursor-agent) that stall out the full timeout
 * on a real QA workload without emitting a PASS/FAIL. Both leave QA with no verdict and the
 * gate stalls (see `reference-bullpen-cli-oneshot-quirks`). Advisory only — used to warn on
 * the QA seat, never to block a choice.
 */
export function isReliableForQa(preset: CliPreset): boolean {
  return preset.execVia !== 'pty' && !preset.qaStallsProne;
}

/** A short hint for the QA seat when its CLI is stall-prone (PTY or agentic); '' otherwise. */
export function qaSeatReliabilityHint(preset: CliPreset): string {
  if (isReliableForQa(preset)) return '';
  return preset.qaStallsProne
    ? `${preset.cliName} tends to background its retrieval/agentic work on a real QA task and stall out without ever reporting a verdict — Claude or Codex give more reliable QA results.`
    : `${preset.cliName} runs in a terminal and can background long QA checks without ever reporting a verdict — Claude or Codex give more reliable QA results.`;
}

/**
 * Per-seat thinking-level advice, grounded in practice:
 * deep reasoning pays off on AUTONOMOUS code steps (Dinesh), reviews finish
 * reliably at a MIDDLE level (a review at the top level can time out repeatedly
 * yet finish quickly one rung down), and heavy thinking
 * on INTERACTIVE chat seats just adds latency (the ultrathink-chat
 * timeout). Explicit per-preset table (ladders differ in shape — Claude's
 * levels are all elevated, Codex's straddle its own default), validated against
 * the LIVE ladder so a catalog change can't surface a stale level. Advisory
 * only — shown on the role card, never blocks a choice.
 */
const SEAT_THINKING_SUGGESTIONS: Record<string, Partial<Record<string, string>>> = {
  claude: { developer: 'think-hard', qa: 'think', security: 'think', architect: 'think' },
  codex: { developer: 'high', qa: 'medium', security: 'medium', architect: 'medium' },
  copilot: { developer: 'high', qa: 'medium', security: 'medium', architect: 'medium' },
};

export interface SeatThinkingAdvice {
  /** The suggested level to apply, or null when the advice is "leave it at Default". */
  level: string | null;
  why: string;
}

export function seatThinkingAdvice(
  roleId: string,
  preset: CliPreset | undefined,
  caps: CliCapabilities | undefined,
  currentLevel: string | undefined | null,
): SeatThinkingAdvice | null {
  if (!preset || !(preset.capabilities.supportsThinkingLevel || caps?.supportsThinkingLevel)) {
    return null;
  }
  // Live-preset ladder first, stored clone as fallback (mirrors thinkingArgsFor).
  const ladder = preset.capabilities.supportedThinkingLevels ?? caps?.supportedThinkingLevels ?? [];
  const current = currentLevel && currentLevel !== 'default' ? currentLevel : null;
  // Interactive chat seats: only speak up when a HEAVY level is set (top two rungs).
  if (roleId === 'stakeholder' || roleId === 'projectLead') {
    if (current && ladder.length >= 2 && ladder.indexOf(current) >= ladder.length - 2) {
      return {
        level: null,
        why: 'Heavy thinking adds latency to interactive chat turns — Default responds fastest for this seat.',
      };
    }
    return null;
  }
  const suggested = SEAT_THINKING_SUGGESTIONS[preset.id]?.[roleId];
  if (!suggested || !ladder.includes(suggested) || current === suggested) {
    return null;
  }
  // Terse by owner request — the level dropdown sits right above the hint.
  return { level: suggested, why: `Recommended: "${suggested}".` };
}

/**
 * The prompt keyword for a preset's thinking level, or '' when none applies. Only
 * 'prompt'-delivery presets (Claude) map a level to a keyword; flag-delivery presets
 * (Copilot) and a missing / unmapped level (e.g. 'default') return ''. Pure — unit tested.
 */
export function resolveThinkingKeyword(
  preset: CliPreset | undefined,
  level: string | undefined | null,
): string {
  if (!preset || preset.thinkingVia !== 'prompt' || !level) {
    return '';
  }
  return preset.thinkingPromptKeywords?.[level] ?? '';
}

/**
 * Append the thinking keyword (if any) to a prompt for prompt-delivery thinking CLIs.
 * Returns `prompt` UNCHANGED when no keyword applies (no level, 'default', or a
 * flag-delivery CLI) — so non-thinking flows stay byte-identical. Claude Code detects
 * the trigger word anywhere in the prompt; we append it on its own trailing line so
 * structured prompts (JSON drafts, QA verdicts) keep their leading instructions intact.
 */
export function applyThinkingKeyword(
  prompt: string,
  preset: CliPreset | undefined,
  level: string | undefined | null,
): string {
  const keyword = resolveThinkingKeyword(preset, level);
  return keyword ? `${prompt}\n\n${keyword}` : prompt;
}

/**
 * Argv contribution for a configured thinking/reasoning LEVEL — the flag/config side of
 * thinking delivery (the prompt-keyword side is applyThinkingKeyword). Returns [] when the
 * CLI has no thinking arg, the level is unset/'default', or the level is not one the CLI
 * advertises — so a stale or free-typed level (e.g. an 'ultrathink' left over from a prior
 * Claude assignment on a Codex seat) can never inject a value the CLI would reject.
 * Validation prefers the PRESET's advertised levels: an assignment stores a CLONE of the
 * capabilities from assign time that is never re-synced, so the live catalog is the source
 * of truth (a Codex seat assigned before minimal/xhigh existed still gets them). The stored
 * capabilities are only the fallback for assignments without a resolvable preset list.
 *   - thinkingFlag set     → [flag, level]         (Copilot: --reasoning-effort high)
 *   - thinkingVia:'config' → ['-c', 'key=level']   (Codex:   -c model_reasoning_effort=high)
 * Prompt-keyword CLIs (Claude) contribute nothing here (their thinking rides the prompt).
 * Pure — unit tested.
 */
export function thinkingArgsFor(
  preset: CliPreset | undefined,
  caps: CliCapabilities | undefined,
  level: string | undefined | null,
): string[] {
  if (!preset || !caps?.supportsThinkingLevel) return [];
  const l = level?.trim();
  if (!l || l === 'default') return [];
  const known = preset.capabilities.supportedThinkingLevels ?? caps.supportedThinkingLevels;
  if (known && !known.includes(l)) return [];
  if (preset.thinkingFlag) return [preset.thinkingFlag, l];
  if (preset.thinkingVia === 'config' && preset.thinkingConfigKey) {
    return ['-c', `${preset.thinkingConfigKey}=${l}`];
  }
  return [];
}

/**
 * The next-LOWER thinking level for a timeout step-down retry, or null when there is
 * no meaningful step down (level unset/'default'/unknown, already the lowest, or the CLI
 * doesn't do thinking). The preset's `supportedThinkingLevels` arrays are ordered low→high,
 * so "one step down" is simply the previous entry (preferring the preset's live list over
 * the assignment's stored clone — same catalog-is-source-of-truth rule as thinkingArgsFor).
 * A review at the top thinking level can time out repeatedly at the wall while the same
 * review at one level lower finishes quickly — so the retry steps the level down. Pure.
 */
export function stepDownThinkingLevel(
  preset: CliPreset | undefined,
  caps: CliCapabilities | undefined,
  level: string | undefined | null,
): string | null {
  if (!preset || !caps?.supportsThinkingLevel) return null;
  const l = level?.trim();
  if (!l || l === 'default') return null;
  const known = preset.capabilities.supportedThinkingLevels ?? caps.supportedThinkingLevels;
  if (!known) return null;
  const idx = known.indexOf(l);
  if (idx <= 0) return null; // unknown level, or already the lowest — nothing to step to
  return known[idx - 1];
}

/**
 * Invocation budget for an interactive chat/room turn, sized to the role's thinking
 * level. The chat rooms used a flat 120s, which silently killed `think hard` /
 * `ultrathink` turns mid-reasoning (the failure was invisible AND lost the user's
 * typed message). `ultrathink` can take minutes, so it gets the Bullpen-grade budget;
 * every other level gets a comfortable 5 minutes (matching the Whiteboard draft).
 * Pure — unit tested. The Bullpen (600s) and Whiteboard draft (300s) set their own.
 */
export const ROOM_TIMEOUT_DEFAULT_MS = 300_000;
export const ROOM_TIMEOUT_DEEP_MS = 600_000;

/**
 * Only grant the deep budget when the seat's CLI actually does extended thinking —
 * a non-thinking CLI (e.g. Cursor) carrying a stale `ultrathink` from a prior Claude
 * assignment would otherwise make a hung turn wait the full 10 minutes for nothing.
 * Mirrors invokeCli, which applies thinking only when `supportsThinkingLevel`.
 */
export function roomTimeoutMsForThinking(
  level: string | undefined | null,
  supportsThinkingLevel = true,
): number {
  return supportsThinkingLevel && level === 'ultrathink'
    ? ROOM_TIMEOUT_DEEP_MS
    : ROOM_TIMEOUT_DEFAULT_MS;
}
