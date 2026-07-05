import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyThinkingKeyword, CLI_PRESETS, thinkingArgsFor } from '../../shared/cli';
import type { CliAssignment } from '../../shared/cli';
import {
  outputTail,
  promptFirstLine,
  redactPromptArg,
} from '../../shared/diagnostics';
import type { InvocationOutcome, InvocationSurface } from '../../shared/diagnostics';
import { isTransientCliError } from '../../shared/diagnostics';
import { redactSecrets } from '../../shared/secrets';
import type { RoleId } from '../../shared/roles';
import { resolveCommand, resolveNativeExecutable, runResolvedCommand } from './cliValidator';
import { hashPrompt, logInvocation } from './invocationLog';
import { runResolvedCommandPty } from './ptyRunner';

/**
 * The single path for running an assigned role CLI one-shot. Resolves the
 * command (with preset alias fallback), builds the argv honoring the
 * assignment's defaultArgs / model / thinking level / env, optionally adds the
 * preset's autopilot (auto-approve) flags, and runs it with the prompt on
 * stdin. Every engine — rooms, whiteboard, bullpen — goes through here so the
 * configured options actually take effect and resolution lives in one place.
 *
 * Prompt text goes via stdin by default, never argv, so args stay fixed/trusted.
 * The exception is `promptVia: 'arg'` CLIs (copilot, agy) that ignore stdin
 * one-shot: there the prompt IS in argv, so this resolves the CLI to a native
 * executable only — never a Windows .cmd/.bat shim, whose cmd.exe command line
 * can't safely escape untrusted argv (CVE-2024-24576 / "BatBadBut"). If only a
 * shim exists for such a CLI, the run is refused rather than made injectable.
 */

export interface InvokeCliOptions {
  /** Prompt piped to the child's stdin. */
  prompt: string;
  /** Working directory (workspace for autopilot; a tmp dir for chat). */
  cwd: string;
  timeoutMs: number;
  /** Include the preset's auto-approve flags (The Bullpen). Default false. */
  autopilot?: boolean;
  /** Diagnostics: which lifecycle seam made the call (for the invocation log). */
  surface?: InvocationSurface;
  /** Diagnostics: the lifecycle role behind the call, when known. */
  role?: RoleId | null;
  /** Diagnostics: the project id, when the call is project-scoped. */
  projectId?: string | null;
}

export interface CliInvocation {
  ok: boolean;
  output: string;
  durationMs: number;
  /** For telemetry; empty when no CLI is assigned. */
  cliName: string;
  command: string;
  /** Non-null on failure. */
  error: string | null;
  /** True when the run was killed by its timeout (vs. erroring or exiting). */
  timedOut: boolean;
}

function fail(cliName: string, command: string, error: string): CliInvocation {
  return { ok: false, output: '', durationMs: 0, cliName, command, error, timedOut: false };
}

/** E1 — backoff before each transient-error retry (so up to 3 retries: ~1s, 3s, 8s). */
const RETRY_BACKOFF_MS = [1000, 3000, 8000];
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function invokeCli(
  assignment: CliAssignment | null | undefined,
  opts: InvokeCliOptions,
): Promise<CliInvocation> {
  // Configured thinking level, normalized ('default'/unset → null). Drives both the
  // diagnostic log and the sharper timeout message (it's also what sized the budget).
  const rawThinking = assignment?.defaultThinkingLevel?.trim();
  const thinkingLevel = rawThinking && rawThinking !== 'default' ? rawThinking : null;

  // Diagnostics: emit exactly one record per path through here (the single choke
  // point). Best-effort — logInvocation never throws. Prompts are reduced to a
  // length + hash + first line; arg-delivered prompts are redacted from argv.
  const emit = (r: {
    cliName: string;
    command: string;
    args: string[];
    prompt: string;
    durationMs: number;
    outcome: InvocationOutcome;
    exitCode: number | null;
    error: string | null;
    output: string;
  }): void => {
    void logInvocation({
      timestamp: new Date().toISOString(),
      surface: opts.surface ?? 'unknown',
      role: opts.role ?? null,
      projectId: opts.projectId ?? null,
      cliName: r.cliName,
      command: r.command,
      args: redactPromptArg(r.args, r.prompt),
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      thinkingLevel,
      promptChars: r.prompt.length,
      promptHash: hashPrompt(r.prompt),
      // Scrub secret-shaped tokens from the free-text fields before they hit the
      // on-disk log / Garage IPC — a pasted key in CLI output/error never persists.
      promptFirstLine: redactSecrets(promptFirstLine(r.prompt)),
      durationMs: r.durationMs,
      outcome: r.outcome,
      exitCode: r.exitCode,
      error: r.error === null ? null : redactSecrets(r.error),
      // Redact BEFORE tailing: truncating first can bisect a secret token, leaving an
      // unrecognizable fragment the shape-detector no longer matches.
      outputTail: outputTail(redactSecrets(r.output)),
    });
  };

  // A pre-spawn config refusal (no CLI, not installed, shim-only): log it as an
  // error with no run, then return the standard failure shape.
  const refuse = (cliName: string, command: string, error: string): CliInvocation => {
    emit({
      cliName,
      command,
      args: [],
      prompt: opts.prompt,
      durationMs: 0,
      outcome: 'error',
      exitCode: null,
      error,
      output: '',
    });
    return fail(cliName, command, error);
  };

  if (!assignment || assignment.command.trim() === '') {
    return refuse('', '', 'No CLI assigned to this role.');
  }
  const preset = assignment.presetId
    ? CLI_PRESETS.find((p) => p.id === assignment.presetId)
    : undefined;

  // Most CLIs read the prompt from stdin (argv stays fixed/trusted). Some
  // (Copilot, agy) ignore stdin one-shot and need the prompt as an argv item.
  const promptVia = preset?.promptVia ?? 'stdin';
  const candidates = [assignment.command, ...(preset?.commandAliases ?? [])];

  let resolved: string | null = null;
  if (promptVia === 'arg') {
    // The untrusted prompt lands in argv — resolve to a native executable only,
    // never a .cmd/.bat shim (whose cmd.exe line can't safely carry argv). If the
    // only thing installed is a shim, refuse rather than build an injectable line.
    let sawShim = false;
    for (const candidate of candidates) {
      const native = await resolveNativeExecutable(candidate);
      if (native.nativePath) {
        resolved = native.nativePath;
        break;
      }
      sawShim = sawShim || native.shimOnly;
    }
    if (!resolved) {
      return refuse(
        assignment.cliName,
        assignment.command,
        sawShim
          ? `${assignment.cliName} is installed only as a Windows script shim (.cmd/.bat). ` +
              `It receives the prompt as a command-line argument, which can't be passed ` +
              `safely through a shim — point this role at the native executable instead ` +
              `(e.g. the WinGet build).`
          : `${assignment.command} is not installed.`,
      );
    }
  } else {
    // stdin delivery — argv is fixed, trusted flags only, so a .cmd/.bat shim is
    // safe (the prompt never touches the command line).
    for (const candidate of candidates) {
      const hit = await resolveCommand(candidate);
      if (hit) {
        resolved = hit;
        break;
      }
    }
    if (!resolved) {
      return refuse(assignment.cliName, assignment.command, `${assignment.command} is not installed.`);
    }
  }

  const caps = assignment.capabilities;
  const promptArgs = preset?.promptArgs ?? ['-p'];
  const autopilotArgs = opts.autopilot ? (preset?.autopilotArgs ?? []) : [];
  // Honor a configured model / thinking level only when the CLI supports it and
  // the preset knows the flag (best-effort; unset = the CLI's own default).
  const modelArgs =
    preset?.modelFlag && caps.supportsModelSelection && assignment.defaultModel
      ? [preset.modelFlag, assignment.defaultModel]
      : [];
  // Flag/config thinking delivery (Copilot's --reasoning-effort, Codex's -c
  // model_reasoning_effort). Claude's keyword delivery is handled below via the prompt.
  const thinkingArgs = thinkingArgsFor(preset, caps, assignment.defaultThinkingLevel);
  // CLIs whose thinking is a prompt KEYWORD, not a flag (Claude): append the mapped
  // keyword to the prompt. No-op (byte-identical) when the level is unset / 'default'
  // or the CLI uses a thinking flag instead — so non-thinking flows don't change.
  const prompt = caps.supportsThinkingLevel
    ? applyThinkingKeyword(opts.prompt, preset, assignment.defaultThinkingLevel)
    : opts.prompt;
  // Arg-delivery CLIs (resolved to a native executable above) take the prompt as
  // the argv item right after promptArgs, e.g. `copilot -p "<prompt>"`.
  const baseArgs =
    promptVia === 'arg'
      ? [...assignment.defaultArgs, ...promptArgs, prompt, ...autopilotArgs, ...modelArgs, ...thinkingArgs]
      : [...assignment.defaultArgs, ...promptArgs, ...autopilotArgs, ...modelArgs, ...thinkingArgs];

  // Final-message file (Codex): point the CLI's final-answer flag at a per-run
  // temp file and treat that file as the authoritative output. Codex's `exec` can
  // hand stdout to a persistent app-server that holds the pipe open, so stdout is
  // an unreliable transport; the file has the clean answer even if stdout is held
  // or the run timed out mid-way. Pairs with the spawn path settling on the
  // child's 'exit' (not stdio 'close') so a held-open pipe can't hang us.
  let finalMessageDir: string | null = null;
  let finalMessageFile: string | null = null;
  let args = baseArgs;
  if (preset?.finalMessageFileFlag) {
    finalMessageDir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-cli-'));
    finalMessageFile = path.join(finalMessageDir, 'last-message.txt');
    args = [...baseArgs, preset.finalMessageFileFlag, finalMessageFile];
  }

  // CLIs that only emit to a real terminal (agy) run through a pseudo-terminal;
  // everything else uses the plain child_process path. Keyed on the preset's
  // explicit `execVia`, NOT capabilities.requiresPty (a broad UI hint).
  const runner = preset?.execVia === 'pty' ? runResolvedCommandPty : runResolvedCommand;
  const runOptions = {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    stdin: promptVia === 'arg' ? undefined : prompt,
    env: Object.keys(assignment.env).length > 0 ? assignment.env : undefined,
  };
  const start = Date.now();
  let run = await runner(resolved, args, runOptions);
  // Auto-retry a TRANSIENT provider/network failure (Overloaded 529, rate limit,
  // connection reset) with backoff, so an API-congestion blip doesn't escalate an
  // unattended build to a human. A genuine failure
  // (auth / config / a real bug) is not classified transient and is NOT retried; a
  // timeout is not retried either (it would double an already-long wait).
  for (
    let attempt = 0;
    attempt < RETRY_BACKOFF_MS.length && !run.ok && run.timedOut !== true && isTransientCliError(run.output);
    attempt++
  ) {
    await sleep(RETRY_BACKOFF_MS[attempt]);
    run = await runner(resolved, args, runOptions);
  }

  // Prefer the final-message file when present and non-empty — it's the clean
  // model answer even when the run timed out (partial) or stdout was held/garbled.
  let output = run.output;
  if (finalMessageFile) {
    try {
      const fileText = (await readFile(finalMessageFile, 'utf8')).trim();
      if (fileText) {
        output = fileText;
      }
    } catch {
      /* no file written — keep the stdout tail as the diagnostic fallback */
    }
    if (finalMessageDir) {
      await rm(finalMessageDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const durationMs = Date.now() - start;
  const timedOut = run.timedOut === true;
  // A killed-by-budget run gets a message that names the elapsed time, the budget,
  // and the thinking level in effect — so a silent ultrathink timeout reads clearly.
  // Other failures keep the CLI's own output as the diagnostic.
  const thinkingNote = thinkingLevel ? `, thinking level "${thinkingLevel}"` : '';
  // Only suggest lowering the thinking level when one is actually set — at default
  // thinking that advice is a dead end.
  const remedy = thinkingLevel
    ? 'lower the thinking level or simplify the request'
    : 'simplify the request, or try a different CLI on this seat';
  const timeoutError =
    `Timed out after ${Math.round(durationMs / 1000)}s ` +
    `(budget ${Math.round(opts.timeoutMs / 1000)}s${thinkingNote}). ` +
    `The CLI did not respond in time — ${remedy}.`;
  const error = run.ok ? null : timedOut ? timeoutError : output || 'CLI run failed.';

  emit({
    cliName: assignment.cliName,
    command: resolved,
    args,
    prompt,
    durationMs,
    outcome: timedOut ? 'timeout' : run.ok ? 'ok' : 'error',
    exitCode: run.code,
    error,
    output,
  });

  return {
    ok: run.ok,
    output,
    durationMs,
    cliName: assignment.cliName,
    command: assignment.command,
    error,
    timedOut,
  };
}
