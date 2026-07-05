import { describe, expect, it } from 'vitest';
import { detectGates, isSolutionStyleTsconfig, reproTestCommand } from './verificationGates';
import type { PackageJsonLike } from './verificationGates';

const pkg = (scripts: Record<string, string>, deps?: Record<string, string>): PackageJsonLike => ({
  scripts,
  devDependencies: deps,
});

describe('detectGates', () => {
  it('returns [] for no package.json / no scripts / no tsconfig (static site → no-op)', () => {
    expect(detectGates(null, [])).toEqual([]);
    expect(detectGates(pkg({}), ['index.html', 'style.css'])).toEqual([]);
  });

  it('maps one-shot scripts to required gates (lint advisory)', () => {
    const gates = detectGates(
      pkg({ typecheck: 'tsc --noEmit', build: 'vite build', test: 'vitest', lint: 'eslint .' }),
      ['package.json', 'tsconfig.json'],
    );
    const byId = Object.fromEntries(gates.map((g) => [g.id, g]));
    expect(byId.typecheck).toMatchObject({ command: 'npm', args: ['run', 'typecheck'], required: true });
    expect(byId.build).toMatchObject({ args: ['run', 'build'], required: true });
    expect(byId.test).toMatchObject({ args: ['test', '--', '--run'], required: true });
    expect(byId.lint).toMatchObject({ args: ['run', 'lint'], required: false }); // advisory
  });

  it('falls back to `tsc --noEmit` when there is no typecheck script but it is a TS project', () => {
    const gates = detectGates(pkg({}, { typescript: '^5' }), ['tsconfig.json']);
    expect(gates.find((g) => g.id === 'typecheck')).toMatchObject({
      command: 'npx',
      args: ['tsc', '--noEmit'],
      required: true,
    });
  });

  it('does NOT add a typecheck fallback without tsconfig OR without typescript in deps', () => {
    expect(detectGates(pkg({}, { typescript: '^5' }), ['package.json'])).toEqual([]); // no tsconfig
    expect(detectGates(pkg({}), ['tsconfig.json'])).toEqual([]); // tsconfig but no typescript dep
  });

  // The load-bearing safety rule (Decision #4): a long-running script must NEVER be selected.
  it('REFUSES a script whose body is a dev server / watcher (would hang the build)', () => {
    // A misnamed "build" that actually starts a dev server, a watch typecheck, a serve test.
    const gates = detectGates(
      pkg({
        build: 'vite dev',
        typecheck: 'tsc --noEmit --watch',
        test: 'vitest --watch',
        lint: 'nodemon lint.js',
      }),
      ['tsconfig.json'],
      // note: typescript NOT in deps, so no tsc fallback masks the rejected typecheck script
    );
    expect(gates).toEqual([]);
  });

  it('accepts a legitimate build/test even though the word appears (vite build, vitest run)', () => {
    const gates = detectGates(pkg({ build: 'astro build', test: 'jest --ci' }), ['package.json']);
    expect(gates.map((g) => g.id).sort()).toEqual(['build', 'test']);
  });

  it('treats a start/serve/preview script as a long-runner and skips it', () => {
    expect(detectGates(pkg({ build: 'react-scripts start' }), [])).toEqual([]);
    expect(detectGates(pkg({ build: 'vite preview' }), [])).toEqual([]);
  });

  // H1 — the vitest-only `--run` flag must not be injected into other test runners.
  it('only appends vitest’s --run; other runners get a bare `npm test`', () => {
    const vitest = detectGates(pkg({ test: 'vitest run' }), []).find((g) => g.id === 'test');
    expect(vitest?.args).toEqual(['test', '--', '--run']);
    for (const t of ['jest --ci', 'mocha', 'node --test', 'playwright test', 'ava']) {
      const gate = detectGates(pkg({ test: t }), []).find((g) => g.id === 'test');
      expect(gate?.args).toEqual(['test']); // no injected flag — trust the CI-safe script
    }
  });

  // H2 — short-form watch flags must be caught (they hang the whole build until timeout).
  it('refuses short-form watchers (tsc -w, tsc -b -w)', () => {
    expect(detectGates(pkg({ typecheck: 'tsc -w' }), ['tsconfig.json'])).toEqual([]);
    expect(detectGates(pkg({ typecheck: 'tsc -b -w' }), ['tsconfig.json'])).toEqual([]);
  });

  // H3 — a bare framework/server "build" (no dev/serve keyword) must NOT be selected as a gate.
  it('refuses a build script that starts a server / bare framework (allow-list, not denylist)', () => {
    for (const b of ['vite', 'next', 'node server.js', 'parcel', 'http-server', 'live-server']) {
      expect(detectGates(pkg({ build: b }), []).find((g) => g.id === 'build')).toBeUndefined();
    }
    // …while real one-shot builds ARE selected.
    for (const b of ['vite build', 'next build', 'astro build', 'webpack', 'rollup -c', 'tsup']) {
      expect(detectGates(pkg({ build: b }), []).find((g) => g.id === 'build')?.args).toEqual([
        'run', 'build',
      ]);
    }
  });

  // M1 — a multiplexer (concurrently / npm-run-all) wrapping a watcher must be refused.
  it('refuses multiplexers (concurrently, npm-run-all)', () => {
    expect(detectGates(pkg({ build: 'concurrently "tsc -w" "vite"' }), ['tsconfig.json'])).toEqual([]);
    expect(detectGates(pkg({ build: 'npm-run-all -p dev build' }), [])).toEqual([]);
  });

  // A Vite solution-style tsconfig must get `tsc -b` (a bare `tsc --noEmit` on that
  // shape checks 0 files and renders a vacuous ✓ on every gate run).
  describe('solution-style tsconfig', () => {
    const solution = { files: [], references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }] };
    const normal = { compilerOptions: { strict: true }, include: ['src'] };

    it('isSolutionStyleTsconfig recognizes the Vite shape and rejects normal/absent configs', () => {
      expect(isSolutionStyleTsconfig(solution)).toBe(true);
      expect(isSolutionStyleTsconfig({ references: [{ path: './a.json' }] })).toBe(true); // no files/include at all
      expect(isSolutionStyleTsconfig(normal)).toBe(false);
      expect(isSolutionStyleTsconfig({ references: [], files: [] })).toBe(false); // empty refs
      expect(isSolutionStyleTsconfig({ references: [{ path: './a.json' }], include: ['src'] })).toBe(false); // has its own files
      expect(isSolutionStyleTsconfig(null)).toBe(false);
      expect(isSolutionStyleTsconfig(undefined)).toBe(false);
    });

    it('typecheck fallback uses `tsc -b` on solution-style, `tsc --noEmit` otherwise', () => {
      const manifest = pkg({}, { typescript: '^5' });
      const onSolution = detectGates(manifest, ['tsconfig.json'], solution).find((g) => g.id === 'typecheck');
      expect(onSolution?.args).toEqual(['tsc', '-b']);
      const onNormal = detectGates(manifest, ['tsconfig.json'], normal).find((g) => g.id === 'typecheck');
      expect(onNormal?.args).toEqual(['tsc', '--noEmit']);
      // No tsconfig content available (unreadable) → the safe classic default.
      const noInfo = detectGates(manifest, ['tsconfig.json']).find((g) => g.id === 'typecheck');
      expect(noInfo?.args).toEqual(['tsc', '--noEmit']);
    });
  });
});

describe('reproTestCommand (P1 — run a single repro test file)', () => {
  it('picks vitest for a vitest project (dep or test script)', () => {
    expect(reproTestCommand(pkg({ test: 'vitest' }), 't/x.test.ts')).toEqual({ command: 'npx', args: ['vitest', 'run', 't/x.test.ts'] });
    expect(reproTestCommand(pkg({}, { vitest: '^3' }), 't/x.test.ts')).toEqual({ command: 'npx', args: ['vitest', 'run', 't/x.test.ts'] });
  });

  it('picks jest for a jest project', () => {
    expect(reproTestCommand(pkg({ test: 'jest' }), 't/x.test.js')).toEqual({ command: 'npx', args: ['jest', '--runTestsByPath', 't/x.test.js'] });
  });

  it('picks node --test when the test script uses it', () => {
    expect(reproTestCommand(pkg({ test: 'node --test' }), 't/x.test.mjs')).toEqual({ command: 'node', args: ['--test', 't/x.test.mjs'] });
  });

  it('returns null with no recognized runner (caller then treats the finding as unproven)', () => {
    expect(reproTestCommand(pkg({ test: 'mocha' }), 't/x.test.js')).toBeNull();
    expect(reproTestCommand(pkg({}), 't/x.test.js')).toBeNull();
    expect(reproTestCommand(null, 't/x.test.js')).toBeNull();
  });
});
