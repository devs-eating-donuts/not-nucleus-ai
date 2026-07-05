import { describe, expect, it } from 'vitest';
import {
  NO_SCAFFOLD,
  SCAFFOLDERS,
  WIZARD_WORKLOADS,
  getScaffolder,
  isScaffolderId,
  scaffoldContextBlock,
  scaffoldPlanNote,
  scaffoldersByWorkload,
  wizardWorkloads,
} from './scaffold';

describe('scaffold catalog', () => {
  it('has the verified vite-react-ts scaffolder with a fixed, free-text-free argv', () => {
    const s = SCAFFOLDERS['vite-react-ts'];
    expect(s).toBeDefined();
    expect(s.tool).toBe('npm');
    expect(s.subdir).toBe('.'); // scaffolds in place at the project root
    expect(s.verifyFile).toBe('package.json');
    expect(s.args).toEqual(['create', 'vite@latest', '.', '--', '--template', 'react-ts']);
  });

  it('every catalog entry is a fixed, traversal-free spawn (no free-text)', () => {
    for (const s of Object.values(SCAFFOLDERS)) {
      // '.' (project root) or a simple name — no slashes, no '..', no drive letters.
      expect(s.subdir).toMatch(/^(\.|[a-z0-9-]+)$/);
      // The dir the scaffolder actually targets must be that same subdir.
      expect(s.args).toContain(s.subdir);
      // The verify marker is a plain filename (no path), checked after a "successful" run.
      expect(s.verifyFile).toMatch(/^[A-Za-z0-9.-]+$/);
      // Only the tools we resolve + safely spawn.
      expect(['npm', 'npx', 'dotnet']).toContain(s.tool);
      expect(s.workload).not.toBe('');
      // Every entry carries a fixed install command (run as a separate step after scaffold).
      expect(['npm', 'npx', 'dotnet']).toContain(s.install.tool);
      expect(s.install.args.length).toBeGreaterThan(0);
      // No argument may carry user free-text — every arg is a fixed flag/template id.
      for (const arg of s.args) {
        expect(typeof arg).toBe('string');
      }
      // Any fixed env override is a flat string map (no free-text), used only to silence
      // a first-run prompt. Flatten <=> a named subdir (in-place entries never flatten).
      if (s.env) {
        for (const v of Object.values(s.env)) expect(typeof v).toBe('string');
      }
      if (s.flatten) {
        expect(s.subdir).not.toBe('.');
      } else {
        expect(s.subdir).toBe('.');
      }
    }
  });

  it('covers the verified framework set and groups it by workload', () => {
    expect(Object.keys(SCAFFOLDERS)).toEqual(
      expect.arrayContaining([
        'vite-react-ts',
        'vite-vue-ts',
        'vite-svelte-ts',
        'vite-solid-ts',
        'vite-preact-ts',
        'vite-vanilla-ts',
        'next',
        'express',
        'angular',
        'oclif',
        'dotnet-console',
        'dotnet-webapi',
        'dotnet-mvc',
        'dotnet-blazor',
        'dotnet-wpf',
        'dotnet-winforms',
      ]),
    );
    const groups = scaffoldersByWorkload();
    const workloads = groups.map((g) => g.workload);
    // The v1 wizard workloads (React/Angular/Express → Node.js; dotnet → web + desktop).
    expect(workloads).toContain('Node.js development');
    expect(workloads).toContain('ASP.NET and web development');
    expect(workloads).toContain('.NET desktop development');
    // Off-wizard but still resolvable for existing projects + the build-context blocks.
    expect(workloads).toContain('Frontend app');
    expect(workloads).toContain('Full-stack web');
    // Every scaffolder lands in exactly one group.
    const grouped = groups.reduce((n, g) => n + g.items.length, 0);
    expect(grouped).toBe(Object.keys(SCAFFOLDERS).length);
  });

  it('wizardWorkloads exposes only the 3 active workloads, in order, with their templates', () => {
    const wiz = wizardWorkloads();
    expect(wiz.map((g) => g.workload)).toEqual([...WIZARD_WORKLOADS]);
    const ids = (w: string) => wiz.find((g) => g.workload === w)?.items.map((s) => s.id) ?? [];
    expect(ids('Node.js development')).toEqual(
      expect.arrayContaining(['vite-react-ts', 'angular', 'express']),
    );
    expect(ids('ASP.NET and web development')).toEqual(
      expect.arrayContaining(['dotnet-webapi', 'dotnet-mvc', 'dotnet-blazor']),
    );
    expect(ids('.NET desktop development')).toEqual(
      expect.arrayContaining(['dotnet-wpf', 'dotnet-winforms']),
    );
  });

  it('the named-subdir scaffolders flatten an "app" subdir; dotnet is in-place', () => {
    expect(SCAFFOLDERS['angular']).toMatchObject({ subdir: 'app', flatten: true });
    expect(SCAFFOLDERS['angular'].env).toEqual({ NG_CLI_ANALYTICS: 'false' });
    expect(SCAFFOLDERS['angular'].args).toContain('app'); // `ng new app`
    expect(SCAFFOLDERS['oclif']).toMatchObject({ subdir: 'app', flatten: true });
    // dotnet scaffolds in place via `-o .`; the project name is the fixed `App` constant.
    const dn = SCAFFOLDERS['dotnet-webapi'];
    expect(dn).toMatchObject({ tool: 'dotnet', subdir: '.', verifyFile: 'App.csproj' });
    expect(dn.args).toEqual(['new', 'webapi', '-n', 'App', '-o', '.', '--no-restore']);
    expect(dn.install).toEqual({ tool: 'dotnet', args: ['restore'] });
  });

  it('has the Astro scaffolder — fixed "app" subdir + flatten, --no-ai avoids the agent-file collision', () => {
    const s = SCAFFOLDERS['astro'];
    expect(s).toBeDefined();
    expect(s).toMatchObject({ tool: 'npm', subdir: 'app', flatten: true, verifyFile: 'package.json' });
    expect(s.workload).toBe('Node.js development'); // surfaces in the wizard
    expect(s.args).toEqual([
      'create', 'astro@latest', 'app', '--',
      '--template', 'minimal', '--no-install', '--no-git', '--no-ai', '--skip-houston', '--yes',
    ]);
    // --no-ai skips Astro's own agent files, so the Nucleus agent-pack overlay lands cleanly
    // (no create-next-app-style CLAUDE.md/AGENTS.md collision).
    expect(s.args).toContain('--no-ai');
  });

  it('getScaffolder resolves known ids and rejects everything else', () => {
    expect(getScaffolder('vite-react-ts')?.id).toBe('vite-react-ts');
    expect(getScaffolder('nope')).toBeNull();
    expect(getScaffolder(null)).toBeNull();
    expect(getScaffolder(undefined)).toBeNull();
  });

  it('isScaffolderId is the IPC sanitization gate (rejects junk + non-strings)', () => {
    expect(isScaffolderId('vite-react-ts')).toBe(true);
    expect(isScaffolderId('rm -rf /')).toBe(false);
    expect(isScaffolderId('toString')).toBe(false); // prototype keys must not pass
    expect(isScaffolderId(42)).toBe(false);
    expect(isScaffolderId(null)).toBe(false);
  });

  it('NO_SCAFFOLD is the inert no-op outcome', () => {
    expect(NO_SCAFFOLD).toMatchObject({ attempted: false, ok: false, id: null });
  });
});

describe('scaffold context blocks (wire the base into the lifecycle)', () => {
  it('are empty (byte-identical prompts) when the project had no scaffolder', () => {
    for (const id of [null, undefined, '', 'nope']) {
      expect(scaffoldContextBlock(id)).toBe('');
      expect(scaffoldPlanNote(id)).toBe('');
    }
  });

  it('build block tells the team to build ON the generated base (npm framework)', () => {
    const b = scaffoldContextBlock('vite-react-ts');
    expect(b).toContain('BUILD ON IT');
    expect(b).toContain('React (Vite + TypeScript)');
    expect(b).toMatch(/do not re-scaffold|Do NOT re-scaffold/i);
    expect(b).toContain('package.json'); // npm framework → package.json marker
    expect(b).toContain('npm run build');
    expect(b.startsWith('\n\n')).toBe(true); // own leading blank line for concatenation
  });

  it('build block uses dotnet commands + project files for a .NET base', () => {
    const b = scaffoldContextBlock('dotnet-webapi');
    expect(b).toContain('Web API (.NET)');
    expect(b).toContain('.csproj');
    expect(b).toContain('dotnet build');
    expect(b).not.toContain('npm run build');
  });

  it('plan note forbids a "set up the framework" phase and stays one-shot', () => {
    const p = scaffoldPlanNote('next');
    expect(p).toMatch(/already exists/i);
    expect(p).toMatch(/do NOT add a phase or task to scaffold/i);
    expect(p).toMatch(/never a dev server/i);
    expect(p).toContain('Next.js (TypeScript)');
  });
});
