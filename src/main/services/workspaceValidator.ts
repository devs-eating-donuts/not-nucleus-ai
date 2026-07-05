import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CURRENT_STATE_MAX_LINES,
  HANDOFF_MAX_LINES,
  META_FILES,
  WORKSPACE_DIRS,
  WORKSPACE_FILES,
} from '../../shared/markdown';
import type { WorkspaceFinding, WorkspaceHealthReport } from '../../shared/markdown';
import { parseEscalationHeaders } from '../../shared/escalations';
import { parseTaskFile } from '../../shared/taskfile';
import { PUSH_SCRIPT_PATH, isValueShaped } from '../../shared/secrets';
import { resolveWorkspacePath } from './markdownWorkspace';

/**
 * Workspace contract validator — a planning linter. The run engine calls this
 * before and after role steps; the UI shows it after project creation. Errors
 * mean the contract is broken; warnings mean hygiene is slipping.
 */

const TASK_FILE_PATTERN = /^task-\d+\.md$/;

/** Handoff pair files are optional until their roles first write them. */
const REQUIRED_FILES: string[] = [
  WORKSPACE_FILES.vision,
  WORKSPACE_FILES.architecture,
  WORKSPACE_FILES.techStack,
  WORKSPACE_FILES.features,
  WORKSPACE_FILES.backlog,
  WORKSPACE_FILES.sprintBoard,
  WORKSPACE_FILES.qaReview,
  WORKSPACE_FILES.securityReview,
  WORKSPACE_FILES.driftReview,
  WORKSPACE_FILES.currentState,
  WORKSPACE_FILES.handoff,
  WORKSPACE_FILES.doneLog,
  WORKSPACE_FILES.escalations,
  META_FILES.settings,
  META_FILES.runHistory,
  META_FILES.currentRun,
];

async function readIfExists(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, 'utf8');
  } catch {
    return null;
  }
}

function lineCount(content: string): number {
  // A trailing newline does not count as an extra line.
  return content.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

/* ----- governance: secret-like files + path portability ----- */

// Heavy / generated dirs we never walk for the secret scan.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.nucleus', 'dist', 'build', 'out', '.next', '.astro',
  '.nuxt', 'coverage', 'vendor', '.venv', 'venv', '__pycache__', '.turbo', '.cache',
]);

/** A filename that looks like a real secret/credential (not an example). */
function looksLikeSecretFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (/^\.env($|\.)/.test(lower) && !/\.(example|sample|template|dist)$/.test(lower)) {
    return true;
  }
  if (
    ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'credentials', 'credentials.json',
      '.npmrc', '.netrc', '.pgpass', 'secrets.json', 'secrets.yaml', 'secrets.yml'].includes(lower)
  ) {
    return true;
  }
  return /\.(pem|key|pfx|p12|keystore|jks)$/.test(lower);
}

/**
 * The names-only secrets manifest must contain NAMES, never values. Read it
 * directly (the secret-file scan skips .nucleus/) and flag any entry whose
 * label/note field looks value-shaped — turning the names-only invariant into a
 * checkable gate. Absent manifest = healthy (no secrets yet).
 */
async function scanSecretsManifest(
  root: string,
  flag: (file: string, message: string) => void,
): Promise<void> {
  const rel = META_FILES.secretsManifest;
  let raw: string;
  try {
    raw = await fs.readFile(resolveWorkspacePath(root, rel), 'utf8');
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    flag(rel, 'Secrets manifest is not valid JSON.');
    return;
  }
  const list = (parsed as { secrets?: unknown })?.secrets;
  if (!Array.isArray(list)) {
    return;
  }
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const r = item as Record<string, unknown>;
    const offending = ['name', 'description', 'consumedBy', 'acquireHint'].find((k) =>
      isValueShaped(r[k]),
    );
    if (offending) {
      const env = typeof r.envVar === 'string' ? r.envVar : '(unknown)';
      flag(
        rel,
        `Secrets manifest entry "${env}" has a value-shaped "${offending}" field — the manifest is NAMES ONLY; never store a real secret value in it.`,
      );
    }
  }
}

// Argv value-delivery forms in a push script — the value leaks via the process
// list / shell history (and the script is committed). The app's generated skeleton
// never uses these; this catches a hand-written/edited one.
const PUSH_ARGV_VALUE_FORMS = [
  /--(?:body|value|secret-string)\s+["']?\$/,
  /\bsecrets?\s+set\s+[A-Z][A-Z0-9_]*=/,
];

/** Flag a committed push script that passes a secret value on the command line. */
async function scanPushScript(
  root: string,
  flag: (file: string, message: string) => void,
): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(resolveWorkspacePath(root, PUSH_SCRIPT_PATH), 'utf8');
  } catch {
    return;
  }
  let flagged = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    if (PUSH_ARGV_VALUE_FORMS.some((re) => re.test(line))) {
      flag(
        PUSH_SCRIPT_PATH,
        'A secret value is passed on the command line — it leaks via the process list and shell history, and this script is committed. Pipe the value over stdin instead (e.g. `printf %s "$v" | gh secret set NAME`).',
      );
      if (++flagged >= 5) {
        return;
      }
    }
  }
}

/**
 * The names-only manifest and .env.example should carry the same names (the manifest
 * is secrets-only, so it must be a subset). Warn on a manifest name missing from
 * .env.example. Names only — no value is ever read. Skipped until .env.example exists
 * (it's generated during the build).
 */
async function scanManifestEnvDrift(
  root: string,
  warn: (file: string, message: string) => void,
): Promise<void> {
  let envExample: string;
  try {
    envExample = await fs.readFile(resolveWorkspacePath(root, '.env.example'), 'utf8');
  } catch {
    return;
  }
  let manifestRaw: string;
  try {
    manifestRaw = await fs.readFile(resolveWorkspacePath(root, META_FILES.secretsManifest), 'utf8');
  } catch {
    return;
  }
  let names: string[];
  try {
    const parsed = JSON.parse(manifestRaw) as { secrets?: Array<{ envVar?: unknown }> };
    names = Array.isArray(parsed.secrets)
      ? parsed.secrets.map((s) => s?.envVar).filter((e): e is string => typeof e === 'string')
      : [];
  } catch {
    return;
  }
  const exampleNames = new Set(
    envExample
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1])
      .filter((n): n is string => typeof n === 'string'),
  );
  let flagged = 0;
  for (const name of names) {
    if (!exampleNames.has(name)) {
      warn(
        '.env.example',
        `Secret "${name}" is in the manifest but missing from .env.example — keep the names in sync (names only, never values).`,
      );
      if (++flagged >= 5) {
        return;
      }
    }
  }
}

/** Walk the project (skipping heavy dirs), bounded, flagging secret-like files. */
async function scanForSecretFiles(
  root: string,
  warn: (file: string, message: string) => void,
): Promise<void> {
  let scanned = 0;
  let flagged = 0;
  const MAX_FILES = 4000;
  const MAX_FLAGS = 10;
  async function rec(dir: string, depth: number): Promise<void> {
    if (depth > 6 || scanned >= MAX_FILES || flagged >= MAX_FLAGS) {
      return;
    }
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (scanned >= MAX_FILES || flagged >= MAX_FLAGS) {
        return;
      }
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) {
          await rec(path.join(dir, e.name), depth + 1);
        }
      } else if (e.isFile()) {
        scanned++;
        if (looksLikeSecretFile(e.name)) {
          flagged++;
          const rel = path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/');
          warn(rel, 'Looks like a secret/credential file — keep it out of version control and never share the workspace with it present.');
        }
      }
    }
  }
  await rec(root, 0);
}

// A single-letter drive path (C:\…) or a UNC path (\\server\…). Forward-slash
// drive paths are skipped to avoid matching URLs like https://….
const WIN_DRIVE_PATH = /(?:^|[^A-Za-z0-9])[A-Za-z]:\\/;
const UNC_PATH = /\\\\[A-Za-z0-9_.$-]+\\/;

/** First non-portable Windows path on any line, or null. */
function findNonPortablePath(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    if (WIN_DRIVE_PATH.test(line) || UNC_PATH.test(line)) {
      return line.trim().slice(0, 120);
    }
  }
  return null;
}

/** Flag generated Markdown that hard-codes a non-portable Windows path. */
async function scanForNonPortablePaths(
  root: string,
  warn: (file: string, message: string) => void,
): Promise<void> {
  const files: string[] = [
    WORKSPACE_FILES.currentState,
    WORKSPACE_FILES.handoff,
    WORKSPACE_FILES.doneLog,
    WORKSPACE_FILES.escalations,
  ];
  for (const dir of ['docs', 'planning', 'tasks', 'reviews', 'handoffs']) {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(resolveWorkspacePath(root, dir));
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.toLowerCase().endsWith('.md')) {
        files.push(`${dir}/${e}`);
      }
    }
  }
  let flagged = 0;
  for (const rel of files) {
    if (flagged >= 10) {
      break;
    }
    const content = await readIfExists(resolveWorkspacePath(root, rel));
    if (content === null) {
      continue;
    }
    const hit = findNonPortablePath(content);
    if (hit) {
      flagged++;
      warn(
        rel,
        `Contains a non-portable Windows path ("${hit}") — generated content should use relative or forward-slash paths so the project works on macOS/Linux too.`,
      );
    }
  }
}

export async function validateWorkspace(workspacePath: string): Promise<WorkspaceHealthReport> {
  const root = path.resolve(workspacePath);
  const findings: WorkspaceFinding[] = [];
  const error = (file: string, message: string): void => {
    findings.push({ severity: 'error', file, message });
  };
  const warning = (file: string, message: string): void => {
    findings.push({ severity: 'warning', file, message });
  };

  /* Directories. */
  for (const dir of WORKSPACE_DIRS) {
    // references/ is OPTIONAL — it's created lazily on the first upload, so a
    // project (or an older one) without it is healthy, not broken.
    const optional = dir === 'references';
    try {
      const stat = await fs.stat(resolveWorkspacePath(root, dir));
      if (!stat.isDirectory()) {
        error(dir, 'Expected a directory');
      }
    } catch {
      if (!optional) {
        error(dir, 'Required directory is missing');
      }
    }
  }

  /* Required files. */
  for (const file of REQUIRED_FILES) {
    try {
      await fs.access(resolveWorkspacePath(root, file));
    } catch {
      error(file, 'Required file is missing');
    }
  }

  /* Baton line caps. */
  const currentState = await readIfExists(resolveWorkspacePath(root, WORKSPACE_FILES.currentState));
  if (currentState !== null && lineCount(currentState) > CURRENT_STATE_MAX_LINES) {
    warning(
      WORKSPACE_FILES.currentState,
      `Over the ${CURRENT_STATE_MAX_LINES}-line cap (${lineCount(currentState)} lines) — compact into DONE_LOG.md`,
    );
  }
  const handoff = await readIfExists(resolveWorkspacePath(root, WORKSPACE_FILES.handoff));
  if (handoff !== null && lineCount(handoff) > HANDOFF_MAX_LINES) {
    warning(
      WORKSPACE_FILES.handoff,
      `Over the ${HANDOFF_MAX_LINES}-line cap (${lineCount(handoff)} lines) — it is a baton, not a diary`,
    );
  }

  /* Task files. */
  let taskCount = 0;
  const taskIds = new Map<string, string>(); // id → file
  const allPrerequisites: Array<{ file: string; prereq: string }> = [];
  let taskEntries: string[] = [];
  try {
    taskEntries = await fs.readdir(resolveWorkspacePath(root, 'tasks'));
  } catch {
    // Missing tasks dir already reported above.
  }
  for (const entry of taskEntries.sort()) {
    const relPath = `tasks/${entry}`;
    if (!entry.toLowerCase().endsWith('.md')) {
      continue;
    }
    if (!TASK_FILE_PATTERN.test(entry)) {
      warning(relPath, 'File name does not match task-NNN.md');
      continue;
    }
    taskCount++;
    const content = await readIfExists(resolveWorkspacePath(root, relPath));
    if (content === null) {
      error(relPath, 'Task file could not be read');
      continue;
    }
    const parsed = parseTaskFile(content);
    for (const problem of parsed.problems) {
      error(relPath, problem);
    }
    for (const soft of parsed.warnings) {
      warning(relPath, soft);
    }
    const expectedId = entry.replace(/\.md$/i, '');
    if (parsed.id && parsed.id !== expectedId) {
      warning(relPath, `H1 id "${parsed.id}" does not match file name "${expectedId}"`);
    }
    const effectiveId = parsed.id ?? expectedId;
    const existing = taskIds.get(effectiveId);
    if (existing) {
      error(relPath, `Duplicate task id "${effectiveId}" (also in ${existing})`);
    } else {
      taskIds.set(effectiveId, relPath);
    }
    for (const prereq of parsed.prerequisites) {
      allPrerequisites.push({ file: relPath, prereq });
    }
  }
  for (const { file, prereq } of allPrerequisites) {
    if (!taskIds.has(prereq)) {
      warning(file, `Prerequisite "${prereq}" does not exist`);
    }
  }

  /* Escalations. */
  let openEscalations = 0;
  const escalations = await readIfExists(resolveWorkspacePath(root, WORKSPACE_FILES.escalations));
  if (escalations !== null) {
    const headers = parseEscalationHeaders(escalations);
    const seen = new Set<string>();
    for (const header of headers) {
      if (seen.has(header.id)) {
        error(WORKSPACE_FILES.escalations, `Duplicate escalation id "${header.id}"`);
      }
      seen.add(header.id);
      // Missing status counts as open: an unresolved record needs eyes.
      if (header.status !== 'resolved') {
        openEscalations++;
      }
    }
  }

  /* Governance: committed secrets + non-portable paths (both warnings). */
  await scanForSecretFiles(root, warning);
  await scanForNonPortablePaths(root, warning);
  // A value in the names-only secrets manifest is a real leak — error severity.
  await scanSecretsManifest(root, error);
  // A push script that puts a value on argv is a committed leak — error severity.
  await scanPushScript(root, error);
  // Manifest ↔ .env.example name drift (names only) — warning.
  await scanManifestEnvDrift(root, warning);

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.length - errorCount;
  return {
    workspacePath: root,
    checkedAt: new Date().toISOString(),
    ok: errorCount === 0,
    errorCount,
    warningCount,
    findings,
    taskCount,
    openEscalations,
  };
}
