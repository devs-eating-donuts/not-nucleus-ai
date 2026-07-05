/**
 * Per-OS install + login guidance for the known AI CLIs, used ONLY by the
 * first-run onboarding flow (display text + a command to run in the embedded
 * terminal). Kept OUT of CliPreset on purpose: CliPreset feeds the invoker /
 * validator / terminal manager and is sanitized into assignments — install
 * metadata has no business there.
 *
 * BEST-EFFORT, NOT VERIFIED ON EVERY OS. The npm package names, winget ids, and
 * install scripts below are starting points the user runs and then confirms with
 * the onboarding "Test" button (which is the real source of truth that an install
 * + login actually worked). Flagged for owner verification on real Windows /
 * macOS / Linux machines — especially the Antigravity package/winget id and the
 * Cursor Windows channel.
 */

export type InstallOs = 'darwin' | 'win32' | 'linux';

export interface CliInstallGuide {
  /** Matches a CLI_PRESETS id (never 'custom'). */
  id: string;
  /** Install command per OS. A missing OS means "no canned command — see note". */
  install: Partial<Record<InstallOs, string>>;
  /**
   * UPDATE command per OS, ONLY when it differs from the install command.
   * npm/script installers fetch latest on reinstall, so they leave this empty
   * and `updateCommandFor` falls back to `install`; winget needs `upgrade`.
   */
  update?: Partial<Record<InstallOs, string>>;
  /** Interactive login/auth command to run after install (in the embedded terminal). */
  login?: string;
  /** Short human note: prerequisites, docs, caveats. */
  note?: string;
}

const NPM_NODE_NOTE = 'Requires Node.js (npm). ';

export const CLI_INSTALL_GUIDES: Record<string, CliInstallGuide> = {
  claude: {
    id: 'claude',
    install: {
      darwin: 'npm install -g @anthropic-ai/claude-code',
      win32: 'npm install -g @anthropic-ai/claude-code',
      linux: 'npm install -g @anthropic-ai/claude-code',
    },
    login: 'claude',
    note: `${NPM_NODE_NOTE}The first \`claude\` run walks you through login.`,
  },
  codex: {
    id: 'codex',
    // OpenAI's official installer on every OS; it also UPDATES (an npm-installed
    // codex can't self-update via `codex update`). Linux first needs curl +
    // bubblewrap; updating later skips that prereq (see `update`).
    install: {
      darwin: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
      win32: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
      linux: 'sudo apt update && sudo apt install -y curl bubblewrap && curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    },
    update: {
      // curl/bubblewrap are already present post-install, so re-running the
      // script alone updates on Linux (no apt prereqs needed).
      linux: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    },
    login: 'codex login',
    note: 'The official OpenAI installer on every OS also updates Codex. Linux (apt) needs curl + bubblewrap first.',
  },
  cursor: {
    id: 'cursor',
    install: {
      darwin: 'curl https://cursor.com/install -fsS | bash',
      linux: 'curl https://cursor.com/install -fsS | bash',
      win32: 'npm install -g cursor-agent',
    },
    login: 'cursor-agent login',
    note: 'Installs `cursor-agent` (also aliased `agent`). Verify the Windows install channel.',
  },
  antigravity: {
    id: 'antigravity',
    install: {
      darwin: 'npm install -g @google/antigravity-cli',
      win32: 'winget install Google.Antigravity',
      linux: 'npm install -g @google/antigravity-cli',
    },
    // winget installs once; updates use `upgrade`.
    update: { win32: 'winget upgrade Google.Antigravity' },
    login: 'agy login',
    note: 'Installs `agy`. Package name / winget id UNVERIFIED — confirm on a real machine.',
  },
  copilot: {
    id: 'copilot',
    install: {
      darwin: 'npm install -g @github/copilot',
      win32: 'winget install GitHub.Copilot',
      linux: 'npm install -g @github/copilot',
    },
    // winget installs once; updates use `upgrade`.
    update: { win32: 'winget upgrade GitHub.Copilot' },
    login: 'copilot',
    note: 'The standalone agentic `copilot` (not `gh copilot`). First run handles GitHub auth.',
  },
};

/** The install guide for a preset id, or undefined (e.g. 'custom'). */
export function installGuideFor(presetId: string): CliInstallGuide | undefined {
  return CLI_INSTALL_GUIDES[presetId];
}

function osKey(platform: string): InstallOs {
  return platform === 'win32' ? 'win32' : platform === 'linux' ? 'linux' : 'darwin';
}

/** The OS-appropriate install command for a CLI, or null when none is canned. */
export function installCommandFor(presetId: string, platform: string): string | null {
  const guide = CLI_INSTALL_GUIDES[presetId];
  if (!guide) {
    return null;
  }
  return guide.install[osKey(platform)] ?? null;
}

/**
 * The OS-appropriate UPDATE command for a CLI, or null. Falls back to the
 * install command where install==update (npm/script installers fetch latest on
 * reinstall); winget CLIs override with `upgrade`.
 */
export function updateCommandFor(presetId: string, platform: string): string | null {
  const guide = CLI_INSTALL_GUIDES[presetId];
  if (!guide) {
    return null;
  }
  const os = osKey(platform);
  return guide.update?.[os] ?? guide.install[os] ?? null;
}
