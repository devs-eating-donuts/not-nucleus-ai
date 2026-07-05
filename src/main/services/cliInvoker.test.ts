import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLI_PRESETS } from '../../shared/cli';
import type { CliAssignment } from '../../shared/cli';

// The two existing Windows shim/native tests below exercise the REAL resolution +
// spawn path, so every mock here defaults to the actual implementation (spread from
// importActual). The "log redaction" suite further down overrides only what it needs,
// per-test, and restores in beforeEach — so the shim tests are untouched.
//
// We mock at the same seams the invoker imports: the resolution + spawn layer
// (cliValidator), the PTY runner, and the diagnostics sink (invocationLog) — letting
// us capture the EXACT record invokeCli hands to logInvocation without touching disk.
vi.mock('./cliValidator', async () => {
  const actual = await vi.importActual<typeof import('./cliValidator')>('./cliValidator');
  // Wrap the three seams the invoker uses as spies that DEFAULT to the real
  // implementation, so the Windows shim/native tests above (which don't override
  // them) keep their genuine resolution + spawn behavior, while the log-redaction
  // suite below can swap in scripted responses per-test.
  return {
    ...actual,
    resolveCommand: vi.fn(actual.resolveCommand),
    resolveNativeExecutable: vi.fn(actual.resolveNativeExecutable),
    runResolvedCommand: vi.fn(actual.runResolvedCommand),
  };
});
vi.mock('./ptyRunner', async () => {
  const actual = await vi.importActual<typeof import('./ptyRunner')>('./ptyRunner');
  return { ...actual };
});
vi.mock('./invocationLog', async () => {
  const actual = await vi.importActual<typeof import('./invocationLog')>('./invocationLog');
  return { ...actual, logInvocation: vi.fn(async () => undefined) };
});

import { invokeCli } from './cliInvoker';
import { resolveCommand, resolveNativeExecutable, runResolvedCommand } from './cliValidator';
import { logInvocation } from './invocationLog';

// End-to-end guard for the arg-delivery shim hole (CVE-2024-24576 / "BatBadBut").
// Copilot delivers the prompt as an argv item (`promptVia: 'arg'`). On Windows it
// MUST resolve to a native executable — a .cmd/.bat shim would route the untrusted
// prompt through a cmd.exe command line that can't be safely escaped. When only a
// shim is installed, invokeCli must REFUSE (no spawn) rather than build an
// injectable line. Windows-only — off Windows there is no cmd.exe layer.
const onWindows = process.platform === 'win32' ? it : it.skip;

const copilotPreset = CLI_PRESETS.find((p) => p.id === 'copilot')!;

function copilotAssignment(): CliAssignment {
  return {
    presetId: 'copilot',
    cliName: copilotPreset.cliName,
    command: 'copilot',
    defaultArgs: [...copilotPreset.defaultArgs],
    env: {},
    capabilities: copilotPreset.capabilities,
    executionMode: 'autopilot',
  };
}

describe('invokeCli — arg-delivery CLI refuses a Windows shim', () => {
  const savedPath = process.env.PATH;
  afterEach(() => {
    process.env.PATH = savedPath;
  });

  onWindows('refuses to run when only a .cmd shim is installed', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'invoker-shim-'));
    writeFileSync(path.join(dir, 'copilot.cmd'), '@echo PWNED %*\r\n');
    process.env.PATH = dir;

    const run = await invokeCli(copilotAssignment(), {
      // A prompt crafted to break out of the cmd.exe line if it ever reached one.
      prompt: '" & echo INJECTED & "',
      cwd: dir,
      timeoutMs: 8000,
    });

    expect(run.ok).toBe(false);
    expect(run.error).toMatch(/script shim/i);
    // It must NOT have executed the shim.
    expect(run.output).not.toMatch(/PWNED|INJECTED/i);
  });

  onWindows('runs the native .exe rather than refusing when one is present', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'invoker-native-'));
    // Both present: the .exe must win, the shim must be ignored.
    writeFileSync(path.join(dir, 'copilot.exe'), 'stub — not a real PE');
    writeFileSync(path.join(dir, 'copilot.cmd'), '@echo PWNED %*\r\n');
    process.env.PATH = dir;

    const run = await invokeCli(copilotAssignment(), {
      prompt: 'hello',
      cwd: dir,
      timeoutMs: 8000,
    });

    // The dummy .exe can't actually execute, so the run fails — but it must fail
    // on a spawn error, NOT on the shim refusal, proving the .exe was selected.
    expect(run.error ?? '').not.toMatch(/script shim/i);
  });
});

// What the invocation LOG must NEVER persist: the raw prompt (esp. for arg-delivery
// CLIs whose prompt lives in argv) and secret-shaped tokens echoed back in CLI output.
// invokeCli is the single choke point that builds the log record; these tests capture
// the exact record it hands to logInvocation by mocking the resolution + spawn layer
// (so the prompt never reaches the argv-redaction or the output never reaches the
// secret scrub by accident — both run before the record is emitted).
describe('invokeCli — invocation log never persists the raw prompt or secret-shaped output', () => {
  const logInvocationMock = vi.mocked(logInvocation);

  beforeEach(() => {
    // Reset the spy AND restore each resolution/spawn export to its real behavior,
    // so an override in one test can't leak into the next (or into the shim tests).
    logInvocationMock.mockReset();
    logInvocationMock.mockResolvedValue(undefined);
    vi.mocked(resolveCommand).mockReset();
    vi.mocked(resolveNativeExecutable).mockReset();
    vi.mocked(runResolvedCommand).mockReset();
  });

  /** The single record invokeCli emitted on a successful run (it emits exactly one). */
  function loggedRecord() {
    // Two emits are possible: a pre-spawn refusal, or the post-run record. A successful
    // invoke emits exactly once — assert that and return it.
    expect(logInvocationMock).toHaveBeenCalledTimes(1);
    return logInvocationMock.mock.calls[0]![0];
  }

  const claudePreset = CLI_PRESETS.find((p) => p.id === 'claude')!;

  function claudeAssignment(): CliAssignment {
    return {
      presetId: 'claude',
      cliName: claudePreset.cliName,
      command: 'claude',
      defaultArgs: [...claudePreset.defaultArgs],
      env: {},
      capabilities: claudePreset.capabilities,
      executionMode: 'autopilot',
    };
  }

  it('(1) arg-delivery CLI (copilot): the raw prompt is NOT in the logged args', async () => {
    // The full prompt body carries a distinctive marker on a NON-first line, so we can
    // assert the body never lands in the record (the design keeps only a first-line
    // HINT, capped — that line is deliberately benign here).
    const prompt = 'Build the feature.\nSECRET-BODY distinctive-prompt-marker-7f3a do-not-log-me';
    // copilot resolves through resolveNativeExecutable (arg delivery), then spawns.
    vi.mocked(resolveNativeExecutable).mockResolvedValue({
      nativePath: '/usr/bin/copilot',
      shimOnly: false,
    });
    vi.mocked(runResolvedCommand).mockResolvedValue({ ok: true, code: 0, output: 'done' });

    const run = await invokeCli(copilotAssignment(), {
      prompt,
      cwd: '/tmp/ws',
      timeoutMs: 8000,
      surface: 'bullpen',
    });
    expect(run.ok).toBe(true);

    // Sanity: the prompt WAS actually delivered as an argv item to the real spawn —
    // proving this is the path where leaking it into the log would be possible.
    const spawnedArgs = vi.mocked(runResolvedCommand).mock.calls[0]![1];
    expect(spawnedArgs).toContain(prompt);

    const record = loggedRecord();
    // The logged args keep the flags but must NOT contain the raw prompt string.
    expect(record.args).not.toContain(prompt);
    expect(record.args.some((a) => a.includes('distinctive-prompt-marker-7f3a'))).toBe(false);
    // It IS replaced by the length placeholder so the shape stays auditable.
    expect(record.args).toContain(`<prompt:${prompt.length}c>`);
    // The flags survive (the `-p` that precedes the prompt arg).
    expect(record.args).toContain('-p');
    // The prompt BODY must not leak through ANY field of the persisted record — the
    // only retained text is the deliberate first-line hint, which is the benign line.
    expect(JSON.stringify(record)).not.toContain('distinctive-prompt-marker-7f3a');
    expect(record.promptFirstLine).toBe('Build the feature.');
    // Only the metadata (length + hash) is retained for the rest.
    expect(record.promptChars).toBe(prompt.length);
    expect(record.promptHash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('(2) stdin CLI (claude): the prompt is on stdin, never in the logged args', async () => {
    // Marker on a non-first line again, so we can assert the body never lands in args
    // or anywhere else in the record (only the benign first line is kept as a hint).
    const prompt = 'Implement X.\nstdin-only-prompt-marker-c91b carries the real instructions';
    // claude is stdin delivery → resolves via resolveCommand, prompt goes to stdin.
    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/claude');
    vi.mocked(runResolvedCommand).mockResolvedValue({ ok: true, code: 0, output: 'ok' });

    const run = await invokeCli(claudeAssignment(), {
      prompt,
      cwd: '/tmp/ws',
      timeoutMs: 8000,
      surface: 'room',
    });
    expect(run.ok).toBe(true);

    // The spawn received the prompt on STDIN, and its argv is fixed flags only.
    const [, spawnedArgs, spawnOpts] = vi.mocked(runResolvedCommand).mock.calls[0]!;
    expect(spawnOpts?.stdin).toBe(prompt);
    expect(spawnedArgs).not.toContain(prompt);

    const record = loggedRecord();
    // The argv in the log carries no prompt — not the whole string, not a fragment.
    expect(record.args).not.toContain(prompt);
    expect(record.args.some((a) => a.includes('stdin-only-prompt-marker-c91b'))).toBe(false);
    // The prompt body leaks nowhere in the record (only the benign first-line hint).
    expect(JSON.stringify(record)).not.toContain('stdin-only-prompt-marker-c91b');
    expect(record.promptFirstLine).toBe('Implement X.');
    expect(record.promptChars).toBe(prompt.length);
  });

  it('(3) a secret-shaped token in CLI output is redacted in the logged output field', async () => {
    const prompt = 'audit the config';
    // The CLI echoes a real-looking key into its output — exactly the leak we scrub.
    const secret = 'sk_live_' + 'abc123DEF456ghi789jklMNO';
    const cliOutput = `Created Stripe key ${secret} — keep it safe`;
    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/claude');
    vi.mocked(runResolvedCommand).mockResolvedValue({ ok: true, code: 0, output: cliOutput });

    const run = await invokeCli(claudeAssignment(), {
      prompt,
      cwd: '/tmp/ws',
      timeoutMs: 8000,
      surface: 'bullpen',
    });
    // The CLI's raw output is still returned to the engine (that's its working data)…
    expect(run.output).toContain(secret);

    // …but the LOGGED output tail must have the secret masked, surrounding prose intact.
    const record = loggedRecord();
    expect(record.outputTail).not.toContain(secret);
    expect(record.outputTail).toContain('[redacted]');
    expect(record.outputTail).toContain('Created Stripe key');
    expect(record.outputTail).toContain('keep it safe');
    // The secret must not survive ANYWHERE in the persisted record.
    expect(JSON.stringify(record)).not.toContain(secret);
  });

  it('(3b) a secret-shaped token echoed in an ERROR message is redacted in the log', async () => {
    const prompt = 'deploy it';
    // A bare high-entropy token (≥32 chars, mixed case + digits) in the failure text.
    const secret = 'AbCdEf0123456789AbCdEf0123456789xyz';
    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/claude');
    // A non-timeout failure: invokeCli uses the CLI output as the error message.
    vi.mocked(runResolvedCommand).mockResolvedValue({
      ok: false,
      code: 1,
      output: `Auth failed using token ${secret}`,
    });

    const run = await invokeCli(claudeAssignment(), {
      prompt,
      cwd: '/tmp/ws',
      timeoutMs: 8000,
      surface: 'bullpen',
    });
    expect(run.ok).toBe(false);

    const record = loggedRecord();
    expect(record.outcome).toBe('error');
    expect(record.error ?? '').not.toContain(secret);
    expect(record.error ?? '').toContain('[redacted]');
    expect(record.outputTail).not.toContain(secret);
    expect(JSON.stringify(record)).not.toContain(secret);
  });

  // E1 — a transient provider error (Overloaded 529) is retried with backoff before the
  // caller sees a failure, so an API-congestion blip doesn't escalate an unattended build.
  it('(4) E1: retries a transient provider error, then succeeds', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/claude');
      vi.mocked(runResolvedCommand)
        .mockResolvedValueOnce({ ok: false, code: 1, output: 'API Error: Overloaded (529)' })
        .mockResolvedValueOnce({ ok: true, code: 0, output: 'done' });
      const pending = invokeCli(claudeAssignment(), {
        prompt: 'x',
        cwd: '/tmp/ws',
        timeoutMs: 8000,
        surface: 'bullpen',
      });
      await vi.runAllTimersAsync();
      const run = await pending;
      expect(run.ok).toBe(true);
      expect(run.output).toBe('done');
      expect(vi.mocked(runResolvedCommand)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // E1 — a genuine (non-transient) failure is NOT retried: exactly one spawn.
  it('(5) E1: does NOT retry a non-transient failure', async () => {
    vi.mocked(resolveCommand).mockResolvedValue('/usr/bin/claude');
    vi.mocked(runResolvedCommand).mockResolvedValue({ ok: false, code: 1, output: 'VERDICT: FAIL' });
    const run = await invokeCli(claudeAssignment(), {
      prompt: 'x',
      cwd: '/tmp/ws',
      timeoutMs: 8000,
      surface: 'bullpen',
    });
    expect(run.ok).toBe(false);
    expect(vi.mocked(runResolvedCommand)).toHaveBeenCalledTimes(1);
  });
});
