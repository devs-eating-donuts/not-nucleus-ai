/**
 * Build-prerequisite tooling: the local CLIs/tools a blueprint needs so the
 * founder can build, run, and TEST the generated app on their own machine. The
 * sibling of cliInstall.ts (which covers the AI CLIs) — same shape, different
 * subject. BEST-EFFORT install commands per OS; the real source of truth is
 * whether the tool resolves on PATH (the detect IPC) and whether it actually
 * runs. Flagged for owner verification on real Windows / macOS / Linux.
 *
 * Pure data + helpers — no Node/Electron. A blueprint lists tool ids in
 * `buildTools` (blueprints.ts); composeBlueprint merges + dedups them, the setup
 * page detects + shows install commands, and buildToolsPlanNote feeds Richard the
 * exact login commands so he files accurate human-setup tasks.
 *
 * Install vs auth split (the TODO's distinction):
 *   - `install` is automatable (the founder pastes the command).
 *   - `login` is human-only (interactive auth) → becomes a plan human-setup task.
 */

import type { InstallOs } from './cliInstall';

export interface BuildTool {
  /** Stable id, referenced from Blueprint.buildTools. */
  id: string;
  /** Human label, e.g. "Docker". */
  name: string;
  /**
   * The bare executable name to look up on PATH for the presence check. Presence
   * means "installed/resolvable", NOT "running" — e.g. `docker` on PATH does not
   * mean the daemon is up (see `note`).
   */
  detect: string;
  /** Install command per OS. A missing OS means "no canned command — see note". */
  install: Partial<Record<InstallOs, string>>;
  /**
   * Interactive login/auth command, if the tool needs one before use. Human-only
   * (a headless build can't do it) — surfaces as a plan human-setup task.
   */
  login?: string;
  /** Short human note: prerequisites, caveats, daemon-must-run, etc. */
  note?: string;
  /** Docs URL for the tool. */
  docsUrl?: string;
}

const NPM_NODE_NOTE = 'Requires Node.js (npm). ';

export const BUILD_TOOLS: Record<string, BuildTool> = {
  node: {
    id: 'node',
    name: 'Node.js',
    detect: 'node',
    install: {
      darwin: 'brew install node',
      win32: 'winget install OpenJS.NodeJS.LTS',
      linux: 'sudo apt update && sudo apt install -y nodejs npm',
    },
    note: 'The JavaScript runtime + npm — needed to build and run the web app.',
    docsUrl: 'https://nodejs.org/en/download',
  },
  git: {
    id: 'git',
    name: 'Git',
    detect: 'git',
    install: {
      darwin: 'brew install git',
      win32: 'winget install Git.Git',
      linux: 'sudo apt update && sudo apt install -y git',
    },
    note: 'Version control — also how the project tracks every build step.',
    docsUrl: 'https://git-scm.com/downloads',
  },
  docker: {
    id: 'docker',
    name: 'Docker',
    detect: 'docker',
    install: {
      darwin: 'brew install --cask docker',
      win32: 'winget install Docker.DockerDesktop',
      linux: 'curl -fsSL https://get.docker.com | sh',
    },
    note: 'Runs the local Supabase stack + a local model server. The Docker DAEMON must also be RUNNING (start Docker Desktop) — being on PATH is not enough.',
    docsUrl: 'https://docs.docker.com/get-docker/',
  },
  supabase: {
    id: 'supabase',
    name: 'Supabase CLI',
    detect: 'supabase',
    install: {
      darwin: 'brew install supabase/tap/supabase',
      win32: 'scoop install supabase',
      linux: 'npm install -g supabase',
    },
    login: 'supabase login',
    note: 'Runs the local Supabase stack (`supabase start`, Docker-based) and applies migrations. Often added as a project dev-dependency too.',
    docsUrl: 'https://supabase.com/docs/guides/local-development/cli/getting-started',
  },
  wrangler: {
    id: 'wrangler',
    name: 'Wrangler (Cloudflare)',
    detect: 'wrangler',
    install: {
      darwin: 'npm install -g wrangler',
      win32: 'npm install -g wrangler',
      linux: 'npm install -g wrangler',
    },
    login: 'wrangler login',
    note: `${NPM_NODE_NOTE}Cloudflare Pages/Workers CLI. Commonly a project dev-dependency (run via \`npx wrangler\`), so a missing global install is not necessarily a blocker.`,
    docsUrl: 'https://developers.cloudflare.com/workers/wrangler/install-and-update/',
  },
  stripe: {
    id: 'stripe',
    name: 'Stripe CLI',
    detect: 'stripe',
    install: {
      darwin: 'brew install stripe/stripe-cli/stripe',
      win32: 'scoop install stripe',
      linux: 'curl -fsSL https://cli.stripe.com/install.sh | sh',
    },
    login: 'stripe login',
    note: 'Forwards billing webhooks to your local app for testing (`stripe listen`). Only needed if the app has billing.',
    docsUrl: 'https://docs.stripe.com/stripe-cli',
  },
  gh: {
    id: 'gh',
    name: 'GitHub CLI',
    detect: 'gh',
    install: {
      darwin: 'brew install gh',
      win32: 'winget install GitHub.cli',
      linux: 'sudo apt update && sudo apt install -y gh',
    },
    login: 'gh auth login',
    note: 'Creates the GitHub repo + manages Actions secrets for CI/CD. Optional until you push to GitHub.',
    docsUrl: 'https://cli.github.com',
  },
  az: {
    id: 'az',
    name: 'Azure CLI',
    detect: 'az',
    install: {
      darwin: 'brew install azure-cli',
      win32: 'winget install Microsoft.AzureCLI',
      linux: 'curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash',
    },
    login: 'az login',
    note: 'Provisions + deploys Azure resources (also installs Bicep via `az bicep install`). Needed for the Azure-hosted SaaS archetype.',
    docsUrl: 'https://learn.microsoft.com/cli/azure/install-azure-cli',
  },
  terraform: {
    id: 'terraform',
    name: 'Terraform',
    detect: 'terraform',
    install: {
      darwin: 'brew tap hashicorp/tap && brew install hashicorp/tap/terraform',
      win32: 'winget install HashiCorp.Terraform',
      linux: 'sudo apt update && sudo apt install -y terraform',
    },
    note: 'Infrastructure-as-code for cloud provisioning. Cloud auth is via the cloud CLI (az/aws), so no separate login.',
    docsUrl: 'https://developer.hashicorp.com/terraform/install',
  },
  aws: {
    id: 'aws',
    name: 'AWS CLI',
    detect: 'aws',
    install: {
      darwin: 'brew install awscli',
      win32: 'winget install Amazon.AWSCLI',
      linux: 'sudo apt update && sudo apt install -y awscli',
    },
    login: 'aws configure',
    note: 'Provisions + deploys AWS resources. `aws configure` stores credentials/region. Needed for AWS-hosted archetypes.',
    docsUrl: 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html',
  },
};

/**
 * A build tool's detection state for a given project, returned by the
 * `buildtools:detect` IPC. `present` is PATH resolvability — for docker it does
 * NOT mean the daemon is running (see the tool's note).
 */
export interface BuildToolStatus {
  id: string;
  name: string;
  present: boolean;
  resolvedPath: string | null;
  installCommand: string | null;
  login: string | null;
  note?: string;
  docsUrl?: string;
}

/** The build tool for an id, or undefined. */
export function buildToolById(id: string): BuildTool | undefined {
  return BUILD_TOOLS[id];
}

function osKey(platform: string): InstallOs {
  return platform === 'win32' ? 'win32' : platform === 'linux' ? 'linux' : 'darwin';
}

/** The OS-appropriate install command for a build tool, or null when none is canned. */
export function installCommandForTool(id: string, platform: string): string | null {
  const tool = BUILD_TOOLS[id];
  if (!tool) {
    return null;
  }
  return tool.install[osKey(platform)] ?? null;
}

/**
 * Richard's plan-prompt note: the toolchain this product needs + the exact
 * interactive logins to file as human-setup tasks. Empty string when the
 * blueprint declares no build tools (so byte-identical plans for tool-less
 * archetypes). Pure — engines and tests share one source of truth.
 */
export function buildToolsPlanNote(toolIds: string[]): string {
  const tools = toolIds.map((id) => BUILD_TOOLS[id]).filter((t): t is BuildTool => !!t);
  if (tools.length === 0) {
    return '';
  }
  const logins = tools.filter((t) => t.login);
  const lines: string[] = [
    'BUILD TOOLCHAIN (the founder must have these local tools to build, run, and test this product):',
    `Required tools: ${tools.map((t) => t.name).join(', ')}.`,
    '- Assume the founder installs these locally; the plan can note them but should NOT try to install system tools from inside the autonomous build.',
  ];
  if (logins.length > 0) {
    lines.push(
      'These need an interactive login or account the headless build CANNOT perform — file each as a human-setup task (set "setup": true) with the exact command in "manualSteps", placed AFTER the local services are up and with/just-before the work that first needs it:',
      ...logins.map((t) => `  - ${t.name}: \`${t.login}\``),
    );
  }
  return lines.join('\n');
}
