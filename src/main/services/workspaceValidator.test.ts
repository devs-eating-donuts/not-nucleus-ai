import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// workspaceValidator → markdownWorkspace (resolveWorkspacePath) → agentPack/blueprints
// may transitively pull `app` from electron; mock it so the validator runs against a
// plain temp workspace (mirrors referencesStore.test.ts).
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));

import {
  META_DIR,
  META_FILES,
  WORKSPACE_DIRS,
  WORKSPACE_FILES,
} from '../../shared/markdown';
import type { WorkspaceFinding, WorkspaceHealthReport } from '../../shared/markdown';
import { createTaskFileContent } from '../../shared/taskfile';
import { PUSH_SCRIPT_PATH } from '../../shared/secrets';
import { validateWorkspace } from './workspaceValidator';

/**
 * These tests drive the PUBLIC validateWorkspace against real temp workspaces — true
 * end-to-end, no surface widening. The validator is advertised as a security boundary
 * (secret-like committed files, value-shaped secrets-manifest entries, push-script
 * argv leaks, non-portable paths) so the focus is the things that MUST be rejected.
 */

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

/**
 * Build a minimal-but-VALID workspace on disk: every required directory and file
 * present, one well-formed task file. Tests then mutate it to introduce a single
 * defect and assert the validator catches exactly that.
 */
async function makeValidWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nucleus-validator-'));
  tmpDirs.push(root);

  for (const dir of WORKSPACE_DIRS) {
    await mkdir(path.join(root, dir), { recursive: true });
  }

  // Required files — content is irrelevant to the structural checks, but make the
  // baton files small so the line-cap warnings never fire.
  for (const rel of [
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
  ]) {
    await writeFile(path.join(root, rel), '# placeholder\n', 'utf8');
  }

  // One canonical, well-formed task file via the real generator.
  await writeTask(root, 1, 'First task');

  return root;
}

/** Write a canonical task file (tasks/task-NNN.md) using the production generator. */
async function writeTask(
  root: string,
  num: number,
  title: string,
  overrides: { fileName?: string } = {},
): Promise<void> {
  const content = createTaskFileContent({
    number: num,
    title,
    owner: 'developer',
    goal: 'Do the thing.',
    acceptanceCriteria: ['It works.'],
  });
  const fileName = overrides.fileName ?? `task-${String(num).padStart(3, '0')}.md`;
  await writeFile(path.join(root, 'tasks', fileName), content, 'utf8');
}

/** All error-severity finding messages, joined for easy substring assertions. */
function errorText(report: WorkspaceHealthReport): string {
  return report.findings
    .filter((f) => f.severity === 'error')
    .map((f) => f.message)
    .join('\n');
}

/** All warning-severity finding messages, joined for easy substring assertions. */
function warningText(report: WorkspaceHealthReport): string {
  return report.findings
    .filter((f) => f.severity === 'warning')
    .map((f) => f.message)
    .join('\n');
}

function findingsFor(report: WorkspaceHealthReport, file: string): WorkspaceFinding[] {
  return report.findings.filter((f) => f.file === file);
}

describe('validateWorkspace — orchestrator (structure + tasks)', () => {
  it('a minimal valid workspace produces no errors and is ok', async () => {
    const root = await makeValidWorkspace();
    const report = await validateWorkspace(root);
    expect(report.errorCount, errorText(report)).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.taskCount).toBe(1);
  });

  it('flags a missing required directory as an error', async () => {
    const root = await makeValidWorkspace();
    await rm(path.join(root, 'planning'), { recursive: true, force: true });
    const report = await validateWorkspace(root);
    expect(report.ok).toBe(false);
    const planningErrors = findingsFor(report, 'planning').filter((f) => f.severity === 'error');
    expect(planningErrors.length).toBeGreaterThan(0);
    expect(planningErrors[0].message).toMatch(/Required directory is missing/);
  });

  it('does NOT flag the optional references/ directory when it is absent', async () => {
    const root = await makeValidWorkspace();
    await rm(path.join(root, 'references'), { recursive: true, force: true });
    const report = await validateWorkspace(root);
    expect(report.errorCount, errorText(report)).toBe(0);
    expect(findingsFor(report, 'references')).toHaveLength(0);
  });

  it('flags a missing required file as an error', async () => {
    const root = await makeValidWorkspace();
    await rm(path.join(root, WORKSPACE_FILES.vision), { force: true });
    const report = await validateWorkspace(root);
    expect(report.ok).toBe(false);
    const visionErrors = findingsFor(report, WORKSPACE_FILES.vision).filter(
      (f) => f.severity === 'error',
    );
    expect(visionErrors[0].message).toMatch(/Required file is missing/);
  });

  it('flags two task files sharing a task-NNN id as a duplicate', async () => {
    const root = await makeValidWorkspace();
    // task-001.md already exists (id task-001). Add a SECOND file whose H1 id is
    // also task-001 (the file name differs so the file-name uniqueness alone can't
    // save it) — the validator must catch the colliding id.
    const dupContent = createTaskFileContent({
      number: 1, // H1 id => task-001
      title: 'Sneaky duplicate',
      owner: 'developer',
      goal: 'Collide.',
      acceptanceCriteria: ['x'],
    });
    await writeFile(path.join(root, 'tasks', 'task-099.md'), dupContent, 'utf8');
    const report = await validateWorkspace(root);
    expect(report.ok).toBe(false);
    expect(errorText(report)).toMatch(/Duplicate task id/);
  });

  it('warns when a task prerequisite references a non-existent task', async () => {
    const root = await makeValidWorkspace();
    const content = createTaskFileContent({
      number: 2,
      title: 'Depends on a ghost',
      owner: 'developer',
      goal: 'Needs a missing prerequisite.',
      prerequisites: ['task-404'],
      acceptanceCriteria: ['x'],
    });
    await writeFile(path.join(root, 'tasks', 'task-002.md'), content, 'utf8');
    const report = await validateWorkspace(root);
    expect(warningText(report)).toMatch(/Prerequisite "task-404" does not exist/);
  });

  it('warns when CURRENT_STATE.md is over its line cap', async () => {
    const root = await makeValidWorkspace();
    const overLong = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    await writeFile(path.join(root, WORKSPACE_FILES.currentState), overLong, 'utf8');
    const report = await validateWorkspace(root);
    expect(warningText(report)).toMatch(/line cap/);
  });
});

describe('validateWorkspace — secrets manifest (value-shaped entries)', () => {
  /** Write .nucleus/secrets-manifest.json with the given secrets array. */
  async function writeManifest(root: string, secrets: unknown[]): Promise<void> {
    await mkdir(path.join(root, META_DIR), { recursive: true });
    await writeFile(
      path.join(root, META_FILES.secretsManifest),
      JSON.stringify({ schemaVersion: 1, secrets }, null, 2),
      'utf8',
    );
  }

  it('a NAMES-ONLY manifest is clean (no errors)', async () => {
    const root = await makeValidWorkspace();
    await writeManifest(root, [
      {
        name: 'Stripe secret key',
        envVar: 'STRIPE_SECRET_KEY',
        description: 'Server-side Stripe API key',
        stages: ['production'],
        destinations: ['github-actions'],
        required: true,
      },
    ]);
    const report = await validateWorkspace(root);
    expect(report.errorCount, errorText(report)).toBe(0);
  });

  it('flags a value-shaped manifest entry as an ERROR (a real leak)', async () => {
    const root = await makeValidWorkspace();
    await writeManifest(root, [
      {
        name: 'Stripe secret key',
        envVar: 'STRIPE_SECRET_KEY',
        // The forbidden thing: an actual Stripe-shaped value smuggled into a note field.
        description: 'sk_live_' + 'abcdEFGH1234ijklMNOP5678qrst',
        stages: ['production'],
        destinations: ['github-actions'],
        required: true,
      },
    ]);
    const report = await validateWorkspace(root);
    expect(report.ok).toBe(false);
    const manifestErrors = findingsFor(report, META_FILES.secretsManifest).filter(
      (f) => f.severity === 'error',
    );
    expect(manifestErrors.length).toBeGreaterThan(0);
    expect(manifestErrors[0].message).toMatch(/value-shaped/);
    expect(manifestErrors[0].message).toMatch(/STRIPE_SECRET_KEY/);
  });

  it('flags invalid manifest JSON as an error', async () => {
    const root = await makeValidWorkspace();
    await mkdir(path.join(root, META_DIR), { recursive: true });
    await writeFile(path.join(root, META_FILES.secretsManifest), '{ not json', 'utf8');
    const report = await validateWorkspace(root);
    expect(errorText(report)).toMatch(/not valid JSON/);
  });
});

describe('validateWorkspace — non-portable Windows paths in generated Markdown', () => {
  it("flags a 'C:\\Users\\...' drive path in CURRENT_STATE.md", async () => {
    const root = await makeValidWorkspace();
    await writeFile(
      path.join(root, WORKSPACE_FILES.currentState),
      'Build output lives at C:\\Users\\dev\\project\\dist\n',
      'utf8',
    );
    const report = await validateWorkspace(root);
    const w = findingsFor(report, WORKSPACE_FILES.currentState).filter(
      (f) => f.severity === 'warning',
    );
    expect(w.length).toBeGreaterThan(0);
    expect(w[0].message).toMatch(/non-portable Windows path/);
  });

  it('flags a UNC path (\\\\server\\share) in a generated docs/*.md', async () => {
    const root = await makeValidWorkspace();
    await writeFile(
      path.join(root, 'docs', 'notes.md'),
      'See the share at \\\\fileserver\\builds for artifacts.\n',
      'utf8',
    );
    const report = await validateWorkspace(root);
    expect(warningText(report)).toMatch(/non-portable Windows path/);
  });

  it('does NOT flag forward-slash paths or https:// URLs', async () => {
    const root = await makeValidWorkspace();
    await writeFile(
      path.join(root, WORKSPACE_FILES.handoff),
      [
        'Outputs at ./dist and src/main/index.ts',
        'Docs: https://example.com/some/deep/path',
        'Relative: ../sibling/thing is fine in prose',
      ].join('\n'),
      'utf8',
    );
    const report = await validateWorkspace(root);
    const portability = report.findings.filter((f) =>
      /non-portable Windows path/.test(f.message),
    );
    expect(portability).toHaveLength(0);
  });
});

describe('validateWorkspace — secret-like committed files', () => {
  it('flags a committed .env file', async () => {
    const root = await makeValidWorkspace();
    await writeFile(path.join(root, '.env'), 'API_KEY=whatever\n', 'utf8');
    const report = await validateWorkspace(root);
    const hit = report.findings.find((f) => f.file === '.env');
    expect(hit, 'expected an .env finding').toBeDefined();
    expect(hit?.severity).toBe('warning');
    expect(hit?.message).toMatch(/secret\/credential file/);
  });

  it('flags an id_rsa private key', async () => {
    const root = await makeValidWorkspace();
    await writeFile(path.join(root, 'id_rsa'), 'private-key-bytes\n', 'utf8');
    const report = await validateWorkspace(root);
    expect(report.findings.some((f) => f.file === 'id_rsa')).toBe(true);
  });

  it('flags credentials.json', async () => {
    const root = await makeValidWorkspace();
    await writeFile(path.join(root, 'credentials.json'), '{}\n', 'utf8');
    const report = await validateWorkspace(root);
    expect(report.findings.some((f) => f.file === 'credentials.json')).toBe(true);
  });

  it('does NOT flag .env.example', async () => {
    const root = await makeValidWorkspace();
    await writeFile(path.join(root, '.env.example'), 'API_KEY=\n', 'utf8');
    const report = await validateWorkspace(root);
    expect(report.findings.some((f) => f.file === '.env.example')).toBe(false);
  });

  it('does NOT walk into node_modules/.git when scanning for secrets', async () => {
    const root = await makeValidWorkspace();
    // A secret-looking file buried in a skipped dir must NOT be flagged.
    await mkdir(path.join(root, 'node_modules', 'somepkg'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'somepkg', '.env'), 'X=1\n', 'utf8');
    const report = await validateWorkspace(root);
    expect(
      report.findings.some((f) => f.file.includes('node_modules')),
      'node_modules must be skipped',
    ).toBe(false);
  });
});

describe('validateWorkspace — push-script argv leaks', () => {
  /** Write scripts/push-secrets.sh with the given body. */
  async function writePushScript(root: string, body: string): Promise<void> {
    await mkdir(path.join(root, path.dirname(PUSH_SCRIPT_PATH)), { recursive: true });
    await writeFile(path.join(root, PUSH_SCRIPT_PATH), body, 'utf8');
  }

  it('flags a push script that puts a value on argv (gh secret set FOO=$BAR)', async () => {
    const root = await makeValidWorkspace();
    await writePushScript(
      root,
      ['#!/usr/bin/env bash', 'set -euo pipefail', 'gh secret set FOO=$BAR', ''].join('\n'),
    );
    const report = await validateWorkspace(root);
    const hit = findingsFor(report, PUSH_SCRIPT_PATH).filter((f) => f.severity === 'error');
    expect(hit.length, errorText(report)).toBeGreaterThan(0);
    expect(hit[0].message).toMatch(/passed on the command line/);
  });

  it("flags a --body \"$VALUE\" argv form", async () => {
    const root = await makeValidWorkspace();
    await writePushScript(
      root,
      ['#!/usr/bin/env bash', 'curl -X POST --body "$SECRET" https://store/api', ''].join('\n'),
    );
    const report = await validateWorkspace(root);
    expect(
      findingsFor(report, PUSH_SCRIPT_PATH).filter((f) => f.severity === 'error').length,
    ).toBeGreaterThan(0);
  });

  it('a stdin-piped push script is clean (no error)', async () => {
    const root = await makeValidWorkspace();
    await writePushScript(
      root,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        '# gh secret set FOO=$BAR  <- a commented-out leak must NOT be flagged',
        'printf %s "$v" | gh secret set FOO',
        '',
      ].join('\n'),
    );
    const report = await validateWorkspace(root);
    const hit = findingsFor(report, PUSH_SCRIPT_PATH).filter((f) => f.severity === 'error');
    expect(hit, errorText(report)).toHaveLength(0);
  });
});

describe('validateWorkspace — manifest ↔ .env.example drift', () => {
  it('warns when a manifest name is missing from .env.example', async () => {
    const root = await makeValidWorkspace();
    await mkdir(path.join(root, META_DIR), { recursive: true });
    await writeFile(
      path.join(root, META_FILES.secretsManifest),
      JSON.stringify({
        schemaVersion: 1,
        secrets: [{ name: 'A', envVar: 'STRIPE_SECRET_KEY', stages: ['production'], destinations: [], required: true }],
      }),
      'utf8',
    );
    // .env.example exists but is MISSING the manifest's name.
    await writeFile(path.join(root, '.env.example'), 'OTHER_VAR=\n', 'utf8');
    const report = await validateWorkspace(root);
    expect(warningText(report)).toMatch(/missing from \.env\.example/);
  });

  it('is clean when the names are in sync', async () => {
    const root = await makeValidWorkspace();
    await mkdir(path.join(root, META_DIR), { recursive: true });
    await writeFile(
      path.join(root, META_FILES.secretsManifest),
      JSON.stringify({
        schemaVersion: 1,
        secrets: [{ name: 'A', envVar: 'STRIPE_SECRET_KEY', stages: ['production'], destinations: [], required: true }],
      }),
      'utf8',
    );
    await writeFile(path.join(root, '.env.example'), 'STRIPE_SECRET_KEY=\n', 'utf8');
    const report = await validateWorkspace(root);
    expect(warningText(report)).not.toMatch(/missing from \.env\.example/);
  });
});
