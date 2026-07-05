import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveCommand, runResolvedCommand } from './cliValidator';
import { readProjectInfo } from './markdownWorkspace';

/**
 * Best-effort version control for a project workspace. When git tracking is on
 * (default), project creation inits a local `main` repo and the Bullpen commits
 * after every actor's step — so an auto-approve CLI's writes are always revertible.
 *
 * HARD RULES:
 *  - Never break a build: every export is wrapped; a missing `git`, a hook failure,
 *    or any error degrades to a silent no-op.
 *  - Safe spawn only (`spawn(git, [args])` via runResolvedCommand) — never a shell
 *    string. The commit message is sanitized to a single safe line as defense in
 *    depth (the only caller-influenced part — phase names — could carry metacharacters).
 *  - Never touch a repo we don't own: we only init/commit when the workspace IS the
 *    repo root. A workspace nested inside a parent repo (e.g. a monorepo) is left
 *    alone so we never sweep the user's outer tree into a commit.
 *  - Bot identity via per-invocation `-c` flags, so we never read/write the user's
 *    global git config.
 */

// Per-invocation config so the bot commit never touches the user's global git
// config AND never inherits surprises from it: a bot identity (so a machine with no
// global user.name still commits), signing OFF (a passphrase-prompting GPG/SSH key
// would otherwise stall each step until the timeout), and auto-gc OFF. Pair with
// `commit --no-verify` so a global pre-commit/commit-msg hook can't block or alter
// our automatic commits.
const BOT_CONFIG = [
  '-c', 'user.name=Nucleus',
  '-c', 'user.email=nucleus@local',
  '-c', 'commit.gpgsign=false',
  '-c', 'gc.auto=0',
];
const GIT_TIMEOUT_MS = 30_000;
const MESSAGE_CAP = 200;

// Resolve `git` once. undefined = not yet looked up; null = not installed.
let gitPathCache: string | null | undefined;

async function gitPath(): Promise<string | null> {
  if (gitPathCache === undefined) {
    gitPathCache = await resolveCommand('git').catch(() => null);
  }
  return gitPathCache;
}

async function runGit(
  workspacePath: string,
  args: string[],
): Promise<{ ok: boolean; output: string }> {
  const git = await gitPath();
  if (!git) {
    return { ok: false, output: 'git not found' };
  }
  const run = await runResolvedCommand(git, args, {
    cwd: workspacePath,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  return { ok: run.ok, output: run.output };
}

/** Path equality that mirrors the filesystem: case-insensitive on Windows. */
/* exported for tests */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string): string =>
    process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
  return norm(a) === norm(b);
}

type RepoState = 'root' | 'nested' | 'none';

/**
 * Whether the workspace is a git repo ROOTED here ('root'), sits INSIDE an ancestor
 * repo ('nested', e.g. a monorepo), or is not tracked at all ('none'). We act only on
 * 'root' — never init a nested repo or commit into a parent we don't own.
 */
async function repoState(workspacePath: string): Promise<RepoState> {
  const top = await runGit(workspacePath, ['rev-parse', '--show-toplevel']);
  if (!top.ok) {
    return 'none';
  }
  const toplevel = top.output.trim();
  if (toplevel === '') {
    return 'none';
  }
  // Compare real paths so a symlinked tmpdir (/var → /private/var) or trailing-slash
  // difference doesn't read the workspace's own repo as a nested one. The compare is
  // case-insensitive on Windows, where git emits a lowercase-drive forward-slash path
  // and Electron supplies an uppercase-drive backslash one for the same directory.
  try {
    const [realTop, realWs] = await Promise.all([fs.realpath(toplevel), fs.realpath(workspacePath)]);
    return samePath(realTop, realWs) ? 'root' : 'nested';
  } catch {
    return samePath(toplevel, workspacePath) ? 'root' : 'nested';
  }
}

/** Single safe line for a commit message — strips newlines/quotes/metachars, caps length. */
/* exported for tests */
export function sanitizeMessage(message: string): string {
  const oneLine = message.replace(/[\r\n]+/g, ' ').replace(/["`$\\]/g, '').trim();
  return (oneLine === '' ? 'Nucleus update' : oneLine).slice(0, MESSAGE_CAP);
}

/** Stage everything and commit, skipping when the tree is clean. Best-effort, never throws. */
async function commit(workspacePath: string, message: string): Promise<void> {
  await runGit(workspacePath, ['add', '-A']);
  // Skip empty commits — nothing changed this step (avoids "nothing to commit" noise).
  const status = await runGit(workspacePath, ['status', '--porcelain']);
  if (status.ok && status.output.trim() === '') {
    return;
  }
  await runGit(workspacePath, [...BOT_CONFIG, 'commit', '--no-verify', '-m', sanitizeMessage(message)]);
}

/**
 * Initialize version control for a freshly-created workspace: `git init` on a local
 * `main` and an initial scaffold commit. `enabled` is the project's own git-tracking
 * choice (made at setup) — when false we never init, so the per-step commits below
 * naturally no-op (no repo to commit to). Also a no-op when git is missing, the
 * workspace is nested in another repo, or it is already a repo. Best-effort; never throws.
 */
export async function initWorkspaceRepo(workspacePath: string, enabled: boolean): Promise<void> {
  try {
    if (!enabled || !(await gitPath())) {
      return;
    }
    const state = await repoState(workspacePath);
    if (state !== 'none') {
      return; // already a repo (root) or nested in one — leave it alone
    }
    let init = await runGit(workspacePath, ['init', '-b', 'main']);
    if (!init.ok) {
      // Old git without `-b`: init, then create the `main` branch (unborn repo).
      init = await runGit(workspacePath, ['init']);
      if (init.ok) {
        await runGit(workspacePath, ['checkout', '-b', 'main']);
      }
    }
    if (!init.ok) {
      return;
    }
    await commit(workspacePath, 'Initial project scaffold');
  } catch {
    /* best-effort — version control must never break project creation */
  }
}

/**
 * Commit whatever an actor's Bullpen step just wrote, with a structured message.
 * Git tracking is decided per-project at setup: if it was OFF, no repo was created,
 * so this no-ops on the repo-root check below (no separate flag needed). Also a no-op
 * when git is missing or nothing changed. Best-effort; never throws (never breaks a step).
 */
export async function commitWorkspaceStep(workspacePath: string, message: string): Promise<void> {
  try {
    if (!(await gitPath())) {
      return;
    }
    if ((await repoState(workspacePath)) !== 'root') {
      return; // only commit to a repo rooted at the workspace (none = git tracking was off)
    }
    // Honor the project's own choice even when the workspace was ALREADY a git repo
    // (so a user who opted out, but pointed at an existing repo, isn't auto-committed to).
    const info = await readProjectInfo(workspacePath).catch(() => null);
    if (info && info.gitTracking === false) {
      return;
    }
    await commit(workspacePath, message);
  } catch {
    /* best-effort — a commit failure must never break a Bullpen step */
  }
}

/** Test seam: reset the resolved-git cache so tests can re-resolve. */
export function resetGitPathCacheForTests(): void {
  gitPathCache = undefined;
}
