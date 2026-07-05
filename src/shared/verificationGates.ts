/**
 * Code-enforced verification gates (C1) — the pure detector half. See
 * docs/design/verification-gates.md. The OBJECTIVE quality checks (typecheck / build /
 * test / lint / secret-scan) belong to the harness, not the QA CLI's self-report: the engine
 * runs deterministic, self-terminating commands and reads their real exit codes, so a stall
 * or a hallucinated "VERDICT: PASS" can't fake correctness. This module derives the applicable
 * gates from the project's OWN package.json scripts + present config files — nothing hand-
 * authored per project. A project with no detectable gates (a static HTML site) → [] → no-op.
 *
 * Pure — no Node/Electron — so the detector (incl. the load-bearing one-shot guard) is
 * trivially unit-testable with fixture manifests + file lists. The I/O half (running the
 * gates) lives in verificationRunner.ts.
 */

export type GateId = 'typecheck' | 'build' | 'test' | 'lint' | 'secret-scan';

export interface VerificationGate {
  id: GateId;
  label: string;
  /** The command to spawn — 'npm' | 'npx' | 'gitleaks'. Resolved + run by the runner. */
  command: string;
  /** ONE-SHOT args only — e.g. ['run', 'build'], ['tsc', '--noEmit']. Never dev/watch/serve. */
  args: string[];
  /** typecheck/build/secret-scan/test(when present) = required; lint = advisory. */
  required: boolean;
}

export interface PackageJsonLike {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * The single load-bearing safety rule (Decision #4): a script whose BODY runs a long-lived
 * process (a dev server / watcher / multiplexer) must NEVER be selected — it never returns and
 * would hang the whole build until timeout. This DENYLIST catches the obvious offenders
 * (incl. short-form `-w` and `concurrently`/`npm-run-all` multiplexers). It is NOT trusted
 * alone for the build/typecheck gates — those are ALSO gated on a positive allow-list below,
 * because a denylist can't enumerate every launcher (a bare `vite`/`next`/`node server.js`
 * has no dev/serve keyword yet starts a server).
 */
const LONG_RUNNER =
  /\b(dev|start|serve|preview|watch|nodemon|pm2|foreman|forever|supervisor|concurrently)\b|npm-run-all|\brun-[ps]\b|--watch|(^|\s)-w(\s|$)|-b\s+-w/i;

/**
 * ALLOW-LIST of one-shot BUILD invocations (H3/M1): a `build` script is only selected when
 * its body clearly names a build — the word "build" (framework builds always say `vite build`
 * / `next build` / `astro build`) OR a known one-shot bundler/compiler. An unrecognized body
 * is SKIPPED (a false skip is safe; a false select hangs). Deliberately excludes bare
 * `vite`/`next`/`parcel`/`node` (those start servers).
 */
const BUILD_ONESHOT = /\bbuild\b|\b(tsc|vue-tsc|webpack|rollup|esbuild|rspack|swc|babel|tsup)\b/i;

/** ALLOW-LIST of one-shot type-checkers for a `typecheck` script. */
const TYPECHECK_ONESHOT = /\b(tsc|vue-tsc|svelte-check|tsgo)\b|astro check/i;

/**
 * Whether a parsed tsconfig.json is Vite's SOLUTION-STYLE shape: project `references`
 * with no files of its own (`files: []` / no `include`). On that shape a bare
 * `tsc --noEmit` checks ZERO files and exits 0 in half a second — a vacuous ✓ that renders
 * as real verification on every gate run. Such projects must be
 * checked with `tsc -b` (build mode follows the references; Vite templates' referenced
 * configs set noEmit, so it is check-only — it's what their own build script runs). Pure.
 */
export function isSolutionStyleTsconfig(tsconfig: unknown): boolean {
  if (tsconfig === null || typeof tsconfig !== 'object') return false;
  const t = tsconfig as { references?: unknown; files?: unknown; include?: unknown };
  if (!Array.isArray(t.references) || t.references.length === 0) return false;
  const noFiles = t.files === undefined || (Array.isArray(t.files) && t.files.length === 0);
  const noInclude = t.include === undefined || (Array.isArray(t.include) && t.include.length === 0);
  return noFiles && noInclude;
}

/**
 * Derive the applicable gates from the manifest + the files present at the workspace root.
 * Pure. Does NOT emit `secret-scan` — that depends on whether `gitleaks` is on PATH (I/O),
 * so the runner adds it. Build/typecheck gates are allow-listed one-shot commands; test/lint
 * trust the project's own (CI-safe) script but are still denylist-guarded. `tsconfig` is the
 * parsed tsconfig.json content when present (drives the solution-style `tsc -b` selection).
 */
export function detectGates(
  pkg: PackageJsonLike | null,
  presentFiles: string[],
  tsconfig?: unknown,
): VerificationGate[] {
  const gates: VerificationGate[] = [];
  const scripts = pkg?.scripts ?? {};
  const body = (name: string): string =>
    typeof scripts[name] === 'string' ? scripts[name] : '';
  // A script is safe to run only if it exists AND is not a known long-runner.
  const notLongRunner = (name: string): boolean => body(name).trim() !== '' && !LONG_RUNNER.test(body(name));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const files = new Set(presentFiles.map((f) => f.toLowerCase()));

  // typecheck — a recognized one-shot type-checker script, else tsc for a TS project. A
  // solution-style tsconfig (Vite: references + files:[]) needs `tsc -b` — a bare
  // `tsc --noEmit` on that shape checks ZERO files and renders a vacuous ✓ (R3).
  if (notLongRunner('typecheck') && TYPECHECK_ONESHOT.test(body('typecheck'))) {
    gates.push({ id: 'typecheck', label: 'typecheck', command: 'npm', args: ['run', 'typecheck'], required: true });
  } else if (files.has('tsconfig.json') && 'typescript' in deps) {
    const args = isSolutionStyleTsconfig(tsconfig) ? ['tsc', '-b'] : ['tsc', '--noEmit'];
    gates.push({ id: 'typecheck', label: 'typecheck', command: 'npx', args, required: true });
  }

  // build — only a recognized one-shot build (allow-list); an unrecognized body is skipped.
  if (notLongRunner('build') && BUILD_ONESHOT.test(body('build'))) {
    gates.push({ id: 'build', label: 'build', command: 'npm', args: ['run', 'build'], required: true });
  }

  // test — required WHEN present; trust the project's (CI-safe) script and add ONLY vitest's
  // non-watch flag (H1 — `--run` is vitest-specific and errors on Jest/Mocha/node:test).
  if (notLongRunner('test')) {
    const args = /\bvitest\b/i.test(body('test')) ? ['test', '--', '--run'] : ['test'];
    gates.push({ id: 'test', label: 'test', command: 'npm', args, required: true });
  }

  // lint — advisory: a lint failure annotates but does NOT bounce the task.
  if (notLongRunner('lint')) {
    gates.push({ id: 'lint', label: 'lint', command: 'npm', args: ['run', 'lint'], required: false });
  }

  return gates;
}

/**
 * P1 (repro-backed findings) — the one-shot command to run a SINGLE test file, so the engine
 * can execute a reviewer-written repro test for a `defect` finding and read its exit code.
 * Picks the runner from the project's own deps / `test` script (vitest / jest / node:test),
 * always a self-terminating, single-file invocation. Returns null when no recognized runner is
 * present — the caller then treats the finding as UNPROVEN (conservative: keeps it a task) rather
 * than guessing a launcher that might hang. Pure. `reproPath` is validated by the caller.
 */
export function reproTestCommand(
  pkg: PackageJsonLike | null,
  reproPath: string,
): { command: string; args: string[] } | null {
  const scripts = pkg?.scripts ?? {};
  const testBody = typeof scripts.test === 'string' ? scripts.test : '';
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const has = (name: string): boolean => name in deps || new RegExp(`\\b${name}\\b`).test(testBody);
  // vitest run <file> / jest --runTestsByPath <file> / node --test <file> are all one-shot.
  if (has('vitest')) return { command: 'npx', args: ['vitest', 'run', reproPath] };
  if (has('jest')) return { command: 'npx', args: ['jest', '--runTestsByPath', reproPath] };
  if (/\bnode\s+--test\b/.test(testBody)) return { command: 'node', args: ['--test', reproPath] };
  return null;
}
