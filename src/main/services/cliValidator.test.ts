import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveNativeExecutable, runResolvedCommand } from './cliValidator';

// Regression guard for the .cmd-shim quoting bug: `cmd.exe /s` strips the first
// and last quote of the command tail, so with multiple quoted args the path got
// mangled ("X is not recognized") and EVERY .cmd-shim CLI (e.g. cursor-agent.cmd)
// failed through invokeCli. The fix wraps the whole command in an outer quote
// pair. Windows-only (the .cmd path doesn't exist elsewhere).
const onWindows = process.platform === 'win32' ? it : it.skip;

describe('runResolvedCommand — .cmd shim with multiple quoted args', () => {
  onWindows('passes all args through to the .cmd intact', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cmdshim-'));
    const cmd = path.join(dir, 'echoargs.cmd');
    // Echo a marker + all args so we can prove the shim actually ran.
    writeFileSync(cmd, '@echo ARGS:%*\r\n');

    const run = await runResolvedCommand(cmd, ['-p', '--force', '--trust', '--approve-mcps'], {
      cwd: dir,
      timeoutMs: 10_000,
    });

    expect(run.ok).toBe(true);
    expect(run.output).toContain('ARGS:'); // the shim executed (not "not recognized")
    expect(run.output).toContain('--force');
    expect(run.output).toContain('--approve-mcps');
    expect(run.output).not.toMatch(/is not recognized/i);
  });
});

// Security guard for the arg-delivery shim hole (CVE-2024-24576 / "BatBadBut"):
// prompt-as-argument CLIs (copilot, agy) must resolve to a NATIVE executable, never
// a .cmd/.bat shim whose cmd.exe command line can't safely escape untrusted argv.
// Windows-only — off Windows there is no cmd.exe layer and everything is "native".
describe('resolveNativeExecutable — never resolves to a Windows shim', () => {
  const savedPath = process.env.PATH;
  afterEach(() => {
    process.env.PATH = savedPath;
  });

  onWindows('rejects an explicit .cmd path as shim-only', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'native-'));
    const cmd = path.join(dir, 'tool.cmd');
    writeFileSync(cmd, '@echo hi\r\n');

    const res = await resolveNativeExecutable(cmd);
    expect(res.nativePath).toBeNull();
    expect(res.shimOnly).toBe(true);
  });

  onWindows('accepts an explicit native .exe path', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'native-'));
    const exe = path.join(dir, 'tool.exe');
    writeFileSync(exe, 'not a real PE, just a file to stat');

    const res = await resolveNativeExecutable(exe);
    expect(res.nativePath).toBe(exe);
    expect(res.shimOnly).toBe(false);
  });

  onWindows('prefers a native .exe in a later PATH dir over a shim in an earlier one', async () => {
    const shimDir = mkdtempSync(path.join(os.tmpdir(), 'native-shim-'));
    const exeDir = mkdtempSync(path.join(os.tmpdir(), 'native-exe-'));
    writeFileSync(path.join(shimDir, 'nukcli.cmd'), '@echo hi\r\n');
    writeFileSync(path.join(exeDir, 'nukcli.exe'), 'stub');
    // Shim dir FIRST — resolveCommand would stop there; resolveNativeExecutable
    // must scan past it to the .exe.
    process.env.PATH = [shimDir, exeDir].join(path.delimiter);

    const res = await resolveNativeExecutable('nukcli');
    expect(res.nativePath).toBe(path.join(exeDir, 'nukcli.exe'));
    expect(res.shimOnly).toBe(false);
  });

  onWindows('reports shim-only when no native binary exists anywhere on PATH', async () => {
    const shimDir = mkdtempSync(path.join(os.tmpdir(), 'native-only-shim-'));
    writeFileSync(path.join(shimDir, 'nukcli.cmd'), '@echo hi\r\n');
    process.env.PATH = shimDir;

    const res = await resolveNativeExecutable('nukcli');
    expect(res.nativePath).toBeNull();
    expect(res.shimOnly).toBe(true);
  });
});
