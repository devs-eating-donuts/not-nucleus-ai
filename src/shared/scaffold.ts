/**
 * Scaffolder catalog — the New-build wizard generates a REAL, runnable base app by
 * INVOKING the official, installed scaffolder CLI non-interactively, never by bundling
 * template files (license-clean, always current, broad). The renderer only ever passes
 * a catalog ID; main sanitizes it to this map and builds the FIXED argv from here, so
 * no renderer free-text ever reaches the spawned command line (keeps the Windows .cmd
 * shim path safe — CVE-2024-24576 class — and the workspace boundary intact).
 *
 * v1 (slice 1): one verified, prompt-free scaffolder. The team then builds the product
 * ON the generated base instead of from an empty folder. See docs/design/scaffolding-wizard.md.
 */
export interface ScaffoldSpec {
  id: string;
  /** Human label for the wizard / the build log. */
  label: string;
  /** Workload group for the wizard's first step (e.g. 'Frontend app', 'Backend API'). */
  workload: string;
  /** The CLI to resolve + spawn (e.g. 'npm'); resolved via resolveCommand (PATHEXT-aware). */
  tool: string;
  /**
   * Fully-enumerated argv — FIXED flags only, NEVER user free-text. The project name
   * does not go here; the target is the fixed subdir. This is what keeps the .cmd shim
   * path safe and the spawn deterministic.
   */
  args: string[];
  /**
   * Workspace-relative dir the scaffolder PHYSICALLY writes into, as it appears in argv.
   * '.' = in place at the project ROOT (most scaffolders — the app IS the project; Nucleus's
   * files overlay on top). A simple name (e.g. 'app') = the scaffolder INSISTS on creating a
   * named subdir (Angular `ng new app`, oclif `generate app`) and offers no in-place mode; in
   * that case `flatten` is set so runScaffolder moves the subdir's contents up to the root
   * afterwards, so the app always ends up at the project root regardless. The scaffolder runs
   * FIRST on the empty folder, before Nucleus seeds anything.
   */
  subdir: string;
  /**
   * Set when the scaffolder can only write into a NAMED subdir (`subdir` ≠ '.'). After a
   * verified scaffold, runScaffolder FLATTENS that subdir's contents (dotfiles + nested dirs
   * included) up to the project root and removes the now-empty subdir — never clobbering an
   * existing root file. End state matches the in-place scaffolders: the app at the root.
   */
  flatten?: boolean;
  /**
   * Extra env merged over the parent for the scaffold spawn — used only to suppress a
   * first-run interactive prompt that would otherwise hang under no-TTY (e.g. Angular's
   * `NG_CLI_ANALYTICS=false` usage-data prompt). Fixed values only, never user free-text.
   */
  env?: Record<string, string>;
  /**
   * A file the scaffolder MUST produce on success, RELATIVE TO `subdir` (checked before any
   * flatten). create-vite exits 0 even when it cancels on a non-empty dir (writing nothing),
   * so a real existence check of this marker — not just exit code 0 — is what confirms the
   * app was actually generated.
   */
  verifyFile: string;
  /**
   * The dependency-install command run as a SEPARATE step after a successful scaffold
   * (scaffolders only write files; this fetches deps so the app actually runs). Most entries
   * are npm-based; the dotnet entries use `dotnet restore`. (A scaffolder that self-installs,
   * like oclif, just re-runs this idempotently — harmless.)
   */
  install: InstallSpec;
  /** True when the FIRST run needs network (to fetch the scaffolder package itself). */
  needsNetwork: boolean;
}

/** A fixed dependency-install command (no user free-text), run after a scaffold. */
export interface InstallSpec {
  tool: string;
  args: string[];
}

const NPM_INSTALL: InstallSpec = { tool: 'npm', args: ['install'] };
const DOTNET_RESTORE: InstallSpec = { tool: 'dotnet', args: ['restore'] };

/**
 * A .NET scaffolder. `dotnet new` is the best-behaved family — offline (templates ship in
 * the SDK), non-interactive by design, and scaffolds IN PLACE via `-o .`. The project name
 * is the FIXED constant `App` (`-n App`), never user free-text, so the marker is a stable
 * `App.csproj` and the spawn argv stays free-text-free. `--no-restore` defers deps to the
 * separate install step (`dotnet restore`), matching the JS scaffolders' `--skip-install`.
 */
const dotnet = (id: string, framework: string, template: string, workload: string): ScaffoldSpec => ({
  id,
  label: `${framework} (.NET)`,
  workload,
  tool: 'dotnet',
  args: ['new', template, '-n', 'App', '-o', '.', '--no-restore'],
  subdir: '.',
  verifyFile: 'App.csproj',
  install: DOTNET_RESTORE,
  needsNetwork: false,
});

/**
 * Every entry below was VERIFIED to scaffold non-interactively with stdin closed (no TTY).
 * Most go IN PLACE at the project root ('.'); the named-subdir ones (Angular, oclif) write
 * into a fixed 'app' subdir that runScaffolder flattens up to the root. The `--`/flag shapes
 * are load-bearing: omitting a template id or a confirm flag makes some of these prompt and
 * hang. Each produces its `verifyFile` (a real scaffold, vs create-vite's silent exit-0
 * cancel on a non-empty dir).
 */
const vite = (
  id: string,
  framework: string,
  template: string,
  workload = 'Frontend app',
): ScaffoldSpec => ({
  id,
  label: `${framework} (Vite + TypeScript)`,
  workload,
  tool: 'npm',
  args: ['create', 'vite@latest', '.', '--', '--template', template],
  subdir: '.',
  verifyFile: 'package.json',
  install: NPM_INSTALL,
  needsNetwork: true,
});

export const SCAFFOLDERS: Record<string, ScaffoldSpec> = {
  'vite-react-ts': vite('vite-react-ts', 'React', 'react-ts', 'Node.js development'),
  'vite-vue-ts': vite('vite-vue-ts', 'Vue', 'vue-ts'),
  'vite-svelte-ts': vite('vite-svelte-ts', 'Svelte', 'svelte-ts'),
  'vite-solid-ts': vite('vite-solid-ts', 'Solid', 'solid-ts'),
  'vite-preact-ts': vite('vite-preact-ts', 'Preact', 'preact-ts'),
  'vite-vanilla-ts': vite('vite-vanilla-ts', 'Vanilla TS', 'vanilla-ts'),
  // Astro — the content-first framework for marketing / personal / static sites (the
  // `static-site` archetype). create-astro IGNORES a `.` positional under no-TTY + `--yes`
  // (it generates a RANDOM project name), so — like Angular/oclif — it targets a FIXED 'app'
  // subdir that runScaffolder flattens to the root. `--no-ai` skips its agent-file creation
  // (so the Nucleus agent-pack overlay lands cleanly — no create-next-app-style collision).
  // With stdin closed: `app/package.json` created, exit 0.
  astro: {
    id: 'astro',
    label: 'Astro (TypeScript)',
    workload: 'Node.js development',
    tool: 'npm',
    args: [
      'create', 'astro@latest', 'app', '--',
      '--template', 'minimal', '--no-install', '--no-git', '--no-ai', '--skip-houston', '--yes',
    ],
    subdir: 'app',
    flatten: true,
    verifyFile: 'package.json',
    install: NPM_INSTALL,
    needsNetwork: true,
  },
  next: {
    id: 'next',
    label: 'Next.js (TypeScript)',
    workload: 'Full-stack web',
    tool: 'npx',
    // create-next-app accepts every choice as a flag + `--yes` for the rest → no prompts.
    // --skip-install (install is its own step) + --disable-git (gitTracker owns the repo).
    args: ['create-next-app@latest', '.', '--ts', '--app', '--use-npm', '--skip-install', '--disable-git', '--yes'],
    subdir: '.',
    verifyFile: 'package.json',
    install: NPM_INSTALL,
    needsNetwork: true,
  },
  express: {
    id: 'express',
    label: 'Express (Node API)',
    workload: 'Node.js development',
    tool: 'npx',
    // `-f` forces generation into a (here always-empty) dir without the not-empty prompt;
    // --no-view = a JSON API, not a templating server.
    args: ['express-generator@latest', '--no-view', '--git', '-f', '.'],
    subdir: '.',
    verifyFile: 'package.json',
    install: NPM_INSTALL,
    needsNetwork: true,
  },
  // Named-subdir scaffolders — these offer NO in-place mode, so they write into a fixed
  // 'app' subdir that runScaffolder then FLATTENS up to the project root (with stdin
  // closed both create `app/` with dotfiles + nested dirs, exit 0).
  angular: {
    id: 'angular',
    label: 'Angular (TypeScript)',
    workload: 'Node.js development',
    tool: 'npx',
    // --defaults skips the routing/style/SSR prompts; --skip-install (install is its own
    // step) + --skip-git (gitTracker owns the repo). NG_CLI_ANALYTICS=false (env, below)
    // suppresses the first-run usage-data prompt that would otherwise hang under no-TTY.
    args: ['--yes', '@angular/cli@latest', 'new', 'app', '--defaults', '--skip-install', '--skip-git'],
    subdir: 'app',
    flatten: true,
    env: { NG_CLI_ANALYTICS: 'false' },
    verifyFile: 'package.json',
    install: NPM_INSTALL,
    needsNetwork: true,
  },
  oclif: {
    id: 'oclif',
    label: 'oclif (Node CLI, TypeScript)',
    workload: 'Node CLI',
    tool: 'npx',
    // --yes accepts the generator defaults (MANDATORY under no-TTY, else it prompts).
    // oclif self-installs + builds during generate (no --skip-install flag exists); the
    // separate install step below just re-runs `npm install` idempotently.
    args: ['--yes', 'oclif', 'generate', 'app', '--yes', '--package-manager', 'npm', '--module-type', 'ESM'],
    subdir: 'app',
    flatten: true,
    verifyFile: 'package.json',
    install: NPM_INSTALL,
    needsNetwork: true,
  },
  // .NET (`dotnet new`) — offline, prompt-free, in place via `-o .` (no flatten needed).
  'dotnet-console': dotnet('dotnet-console', 'Console app', 'console', 'Console / CLI'),
  'dotnet-webapi': dotnet('dotnet-webapi', 'Web API', 'webapi', 'ASP.NET and web development'),
  'dotnet-mvc': dotnet('dotnet-mvc', 'MVC', 'mvc', 'ASP.NET and web development'),
  'dotnet-blazor': dotnet('dotnet-blazor', 'Blazor Web App', 'blazor', 'ASP.NET and web development'),
  'dotnet-wpf': dotnet('dotnet-wpf', 'WPF App', 'wpf', '.NET desktop development'),
  'dotnet-winforms': dotnet('dotnet-winforms', 'Windows Forms App', 'winforms', '.NET desktop development'),
};

/** Scaffolders grouped by workload, for the wizard's first step (insertion order kept). */
export function scaffoldersByWorkload(): Array<{ workload: string; items: ScaffoldSpec[] }> {
  const groups: Array<{ workload: string; items: ScaffoldSpec[] }> = [];
  for (const spec of Object.values(SCAFFOLDERS)) {
    let group = groups.find((g) => g.workload === spec.workload);
    if (!group) {
      group = { workload: spec.workload, items: [] };
      groups.push(group);
    }
    group.items.push(spec);
  }
  return groups;
}

/**
 * The workloads the New Project wizard offers, in display order. Other catalog entries
 * (Vue/Svelte/Next/oclif/console, etc.) stay RESOLVABLE for existing projects + the build
 * context blocks, but are off the wizard. Python + Azure/AI are staged (no scaffolder yet).
 */
export const WIZARD_WORKLOADS = [
  'ASP.NET and web development',
  '.NET desktop development',
  'Node.js development',
] as const;

/** The wizard's workload groups, filtered + ordered to WIZARD_WORKLOADS. */
export function wizardWorkloads(): Array<{ workload: string; items: ScaffoldSpec[] }> {
  const all = scaffoldersByWorkload();
  return WIZARD_WORKLOADS.map((w) => all.find((g) => g.workload === w)).filter(
    (g): g is { workload: string; items: ScaffoldSpec[] } => g !== undefined,
  );
}

/** Resolve a renderer-supplied id to a known spec, or null (unknown / absent). */
export function getScaffolder(id: string | null | undefined): ScaffoldSpec | null {
  return isScaffolderId(id) ? SCAFFOLDERS[id] : null;
}

/**
 * True only for ids in the known catalog — the IPC sanitization gate. Uses an OWN-property
 * check, not `in`: `in` walks the prototype chain, so `'toString'`/`'constructor'` would
 * wrongly pass and resolve to an Object.prototype member.
 */
export function isScaffolderId(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCAFFOLDERS, value);
}

/** Outcome of a scaffold attempt, surfaced in the project:create result. */
export interface ScaffoldOutcome {
  /** The scaffolder requested (null when none was chosen). */
  id: string | null;
  label: string | null;
  /** Whether a scaffold was attempted at all. */
  attempted: boolean;
  /** True only when the base app was generated successfully. */
  ok: boolean;
  /** Workspace-relative subdir the app landed in (when ok). */
  subdir: string | null;
  /** Failure reason — best-effort: a scaffold failure NEVER blocks project creation. */
  error: string | null;
}

/** The no-op outcome for a project created without a scaffolder. */
export const NO_SCAFFOLD: ScaffoldOutcome = {
  id: null,
  label: null,
  attempted: false,
  ok: false,
  subdir: null,
  error: null,
};

/** Outcome of the post-scaffold dependency install, surfaced in the create result. */
export interface InstallOutcome {
  /** Whether an install was attempted (only after a successful scaffold). */
  attempted: boolean;
  /** True when dependencies installed cleanly. */
  ok: boolean;
  /** Failure reason — best-effort: a failed install never blocks project creation. */
  error: string | null;
  /**
   * True while the install is still running in the BACKGROUND. `project:create` returns
   * immediately with `pending: true` (instead of blocking 1–3 min on npm install); the
   * renderer polls `project:install-status` until this flips to false (ok / error).
   */
  pending: boolean;
}

/** The no-op install outcome (no scaffolder, or the scaffold itself failed). */
export const NO_INSTALL: InstallOutcome = { attempted: false, ok: false, error: null, pending: false };

/** Framework-shaped facts used to phrase the scaffold-context prompt blocks. */
function scaffoldFacts(
  scaffoldId: string | null | undefined,
): { label: string; projectFiles: string; verify: string; install: string } | null {
  const spec = getScaffolder(scaffoldId);
  if (!spec) return null;
  const isDotnet = spec.install.tool === 'dotnet';
  return {
    label: spec.label,
    projectFiles: isDotnet
      ? 'the `.csproj`, `Program.cs`, and project files'
      : '`package.json`, the entry points, and the build/tooling config',
    verify: isDotnet
      ? '`dotnet build` / `dotnet test`'
      : '`npm run build` (and `npm test` if the base defines one)',
    install: isDotnet ? 'run `dotnet restore`' : 'run `npm install`',
  };
}

/**
 * BUILD-seat context: a runnable base app of this framework was ALREADY generated at the
 * project root (deps installed), so the build/review personas extend it instead of starting
 * from an empty folder or re-scaffolding. '' when the project had no scaffolder — prompts
 * stay byte-identical for those. Carries its own leading blank line for clean concatenation.
 */
export function scaffoldContextBlock(scaffoldId: string | null | undefined): string {
  const f = scaffoldFacts(scaffoldId);
  if (!f) return '';
  return [
    '',
    '',
    '## Generated base app — BUILD ON IT',
    `A working **${f.label}** starter app was already generated at the project ROOT and its`,
    'dependencies were installed (the install runs in the background at project creation —',
    `if it failed or is still finishing, ${f.install} yourself before verifying). This project`,
    'is NOT an empty folder — build the product by EXTENDING this base, not by starting over:',
    `- Do NOT re-scaffold, re-initialize the framework, or recreate the build/tooling setup —`,
    `  ${f.projectFiles} already exist. READ them first, then follow their structure + conventions.`,
    '- Add and edit real files in place; reuse the existing entry points, routing, and config.',
    `- Verify with the base's OWN one-shot commands (${f.verify}) — never a blocking dev server.`,
  ].join('\n');
}

/**
 * PLANNING context for the Architect's plan: the base already exists, so the plan must NOT
 * include a "scaffold / set up the framework" phase — phase 1 starts on real features. '' when
 * no scaffolder. Carries its own leading blank line.
 */
export function scaffoldPlanNote(scaffoldId: string | null | undefined): string {
  const f = scaffoldFacts(scaffoldId);
  if (!f) return '';
  return [
    '',
    '',
    `GENERATED BASE APP — a working ${f.label} starter app ALREADY EXISTS at the project root`,
    '(generated and dependencies installed). Do NOT add a phase or task to scaffold, initialize,',
    'or set up the framework / build tooling — that is already done. The EARLY phases must start',
    `building the actual product features ON this base. Phrase verify criteria as ${f.verify}`,
    '(one-shot — never a dev server).',
  ].join('\n');
}
