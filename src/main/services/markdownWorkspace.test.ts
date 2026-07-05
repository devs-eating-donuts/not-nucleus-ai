import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NUCLEUS_RAILS_SENTINEL } from '../../shared/agentPack';
import {
  META_FILES,
  WORKSPACE_DIRS,
  WORKSPACE_FILES,
  WORKSPACE_MARKER_KIND,
} from '../../shared/markdown';
import type { NewProjectInput } from '../../shared/project';
import { SCAFFOLDERS } from '../../shared/scaffold';
import {
  initializeWorkspace,
  readProjectInfo,
  readWorkspaceMarker,
  resolveWorkspacePath,
} from './markdownWorkspace';

// resolveWorkspacePath is the security boundary for ALL file access — every read/
// write in the workspace goes through it, and the renderer is untrusted. These
// tests pin the traversal guard so a regression can't silently open the FS up.
describe('resolveWorkspacePath', () => {
  const root = path.resolve('ws', 'proj');

  it('resolves a simple relative path inside the workspace', () => {
    expect(resolveWorkspacePath(root, 'tasks/task-001.md')).toBe(
      path.resolve(root, 'tasks/task-001.md'),
    );
  });

  it('resolves nested subdirectories', () => {
    expect(resolveWorkspacePath(root, 'reviews/security/findings.md')).toBe(
      path.resolve(root, 'reviews/security/findings.md'),
    );
  });

  it('normalizes an interior ".." that stays inside the root', () => {
    expect(resolveWorkspacePath(root, 'tasks/../docs/vision.md')).toBe(
      path.resolve(root, 'docs/vision.md'),
    );
  });

  it('allows the root itself ("" and ".")', () => {
    expect(resolveWorkspacePath(root, '')).toBe(root);
    expect(resolveWorkspacePath(root, '.')).toBe(root);
  });

  it('rejects a leading ".." that escapes the root', () => {
    expect(() => resolveWorkspacePath(root, '../evil.md')).toThrow(/escapes the workspace/);
  });

  it('rejects a deep traversal that climbs out', () => {
    expect(() => resolveWorkspacePath(root, 'a/b/../../../escape.md')).toThrow(
      /escapes the workspace/,
    );
  });

  it('rejects an absolute path outside the workspace', () => {
    const outside = path.resolve(root, '..', '..', 'somewhere-else');
    expect(() => resolveWorkspacePath(root, outside)).toThrow(/escapes the workspace/);
  });

  it('rejects climbing to the exact parent of the root', () => {
    expect(() => resolveWorkspacePath(root, '..')).toThrow(/escapes the workspace/);
  });

  it('handles backslash separators the same way', () => {
    // On any platform, an interior backslash path that escapes must still throw on
    // Windows; on POSIX the backslash is a literal filename char (stays inside).
    const fn = () => resolveWorkspacePath(root, '..\\..\\evil');
    if (process.platform === 'win32') {
      expect(fn).toThrow(/escapes the workspace/);
    } else {
      // Treated as a single weird filename inside root — must NOT throw.
      expect(fn()).toBe(path.resolve(root, '..\\..\\evil'));
    }
  });
});

// The win32 isAbsolute branch of resolveWorkspacePath is never exercised on
// non-Windows CI: the function uses the platform-default 'node:path', so on
// POSIX runners 'C:\\...' and 'D:evil' read as ordinary relative filenames and
// the Windows boundary logic is dead. We force win32 semantics by mocking
// 'node:path' with path.win32 and re-importing the module, so a refactor of the
// drive-letter / drive-relative rejection regresses a real test regardless of
// host OS. (The function detects absoluteness via path.isAbsolute(path.relative
// (root, resolved)) — pure 'node:path', no process.platform read — so swapping
// the path implementation is sufficient.)
describe('resolveWorkspacePath — win32 boundary (forced path.win32 semantics)', () => {
  const winRoot = path.win32.resolve('C:\\ws\\proj');

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('node:path');
  });

  async function loadWin32(): Promise<typeof resolveWorkspacePath> {
    vi.resetModules();
    // Make the module-under-test see Windows path semantics on any host OS.
    vi.doMock('node:path', () => ({ default: path.win32, ...path.win32 }));
    const mod = await import('./markdownWorkspace');
    return mod.resolveWorkspacePath;
  }

  it('rejects a Windows absolute path that escapes the workspace', async () => {
    const resolve = await loadWin32();
    expect(() => resolve(winRoot, 'C:\\Windows\\System32\\evil.dll')).toThrow(
      /escapes the workspace/,
    );
  });

  it('rejects a drive-relative path on a different drive than the root', async () => {
    // 'D:evil' is drive-relative to D:, which differs from the C: root, so it
    // resolves OUT to D:\evil — an absolute escape the guard must reject.
    const resolve = await loadWin32();
    expect(() => resolve(winRoot, 'D:evil')).toThrow(/escapes the workspace/);
  });

  it('rejects a same-drive drive-relative path that climbs out of the root', async () => {
    // 'C:..\\..\\evil' is on the root's own drive but steps up past it.
    const resolve = await loadWin32();
    expect(() => resolve(winRoot, 'C:..\\..\\evil')).toThrow(/escapes the workspace/);
  });

  it('rejects a UNC absolute path', async () => {
    const resolve = await loadWin32();
    expect(() => resolve(winRoot, '\\\\server\\share\\evil')).toThrow(
      /escapes the workspace/,
    );
  });

  it('resolves a normal relative subpath INSIDE the workspace (forward or back slashes)', async () => {
    const resolve = await loadWin32();
    expect(resolve(winRoot, 'tasks/task-001.md')).toBe(
      path.win32.resolve(winRoot, 'tasks\\task-001.md'),
    );
    expect(resolve(winRoot, 'tasks\\task-001.md')).toBe(
      path.win32.resolve(winRoot, 'tasks\\task-001.md'),
    );
  });

  it('allows a same-drive drive-relative path that stays inside the root', () => {
    // 'C:evil' is drive-relative to the SAME drive as the root, so it lands at
    // <root>\\evil — a genuine in-bounds resolution that must NOT be rejected.
    // (Asserted with the host path under win32 semantics for completeness; this
    // documents that not every "C:"-prefixed input is an escape.)
    const winResolved = path.win32.resolve(winRoot, 'C:evil');
    expect(path.win32.isAbsolute(path.win32.relative(winRoot, winResolved))).toBe(false);
  });
});

/* ----- initializeWorkspace / readProjectInfo (real temp workspaces) ----- */

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nucleus-mdws-'));
  tempDirs.push(dir);
  return dir;
}

function newInput(workspacePath: string, overrides: Partial<NewProjectInput> = {}): NewProjectInput {
  return {
    projectName: 'Aviato Redux',
    productIdea: 'A compression-adjacent site that makes the world a better place.',
    targetPlatform: 'web',
    targetStack: '',
    constraints: '',
    workspacePath,
    enabledRoles: ['stakeholder', 'architect', 'developer', 'qa'],
    ...overrides,
  };
}

async function readWs(root: string, rel: string): Promise<string> {
  return fs.readFile(path.join(root, rel), 'utf8');
}

// initializeWorkspace seeds the project's whole on-disk contract (the Markdown
// tree IS the source of truth) and readProjectInfo is the on-read sanitizer
// feeding the security-rules / posture prompts — both are asserted against a
// REAL temp directory, on disk state, not mocks.
describe('initializeWorkspace', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a non-absolute workspace path', async () => {
    await expect(initializeWorkspace(newInput(path.join('relative', 'path')))).rejects.toThrow(
      /absolute/,
    );
  });

  it('seeds the full workspace tree on an empty directory', async () => {
    const dir = await makeTempDir();
    const report = await initializeWorkspace(newInput(dir));

    // Every contract directory exists — .nucleus, docs, planning, tasks, reviews,
    // handoffs, references.
    for (const d of WORKSPACE_DIRS) {
      const st = await fs.stat(path.join(dir, d));
      expect(st.isDirectory(), `${d} should be a directory`).toBe(true);
    }

    // Seeded Markdown carries the project identity.
    const vision = await readWs(dir, WORKSPACE_FILES.vision);
    expect(vision).toContain('# Vision — Aviato Redux');
    expect(vision).toContain('A compression-adjacent site that makes the world a better place.');
    expect(await readWs(dir, WORKSPACE_FILES.escalations)).toContain('# Escalations');
    expect(await readWs(dir, 'references/README.md')).toContain('# References');

    // .gitignore carries the secrets + churn rules (exact-line membership).
    const gitignoreLines = (await readWs(dir, '.gitignore')).split('\n');
    for (const rule of [
      'node_modules/',
      '.env',
      '.env.*',
      '!.env.example',
      '*.pem',
      '.nucleus/telemetry.json',
      '.nucleus/bullpen-activity.json',
    ]) {
      expect(gitignoreLines, `.gitignore should carry "${rule}"`).toContain(rule);
    }

    // Agent pack: BOTH enabled targets (CLAUDE.md + AGENTS.md) are
    // written as the bare body — identical content, no managed-block markers.
    const claudeMd = await readWs(dir, 'CLAUDE.md');
    const agentsMd = await readWs(dir, 'AGENTS.md');
    expect(claudeMd).toContain('# Agent instructions — Aviato Redux');
    expect(claudeMd).toContain(NUCLEUS_RAILS_SENTINEL);
    expect(agentsMd).toBe(claudeMd);
    expect(claudeMd).not.toContain('BEGIN NUCLEUS-AI BUILD RAILS');

    // The report is honest about what happened on a fresh dir.
    for (const rel of [
      WORKSPACE_FILES.vision,
      WORKSPACE_FILES.escalations,
      '.gitignore',
      'CLAUDE.md',
      'AGENTS.md',
      META_FILES.currentRun,
      META_FILES.marker,
    ]) {
      expect(report.createdFiles, `${rel} should be reported created`).toContain(rel);
    }
    expect(report.skippedFiles).toEqual([]);
    expect(report.updatedFiles).toEqual([]);

    // The returned ProjectInfo carries the defaults.
    expect(report.project.projectName).toBe('Aviato Redux');
    expect(report.project.workspacePath).toBe(path.resolve(dir));
    expect(report.project.templateId).toBeNull();
    expect(report.project.overlayIds).toEqual([]);
    expect(report.project.gitTracking).toBe(true);
    expect(report.project.verificationGates).toBe(true);
    expect(report.project.ripIt).toBe(false);

    // current-run.json reflects the initialization; the marker proves origin.
    const currentRun = JSON.parse(await readWs(dir, META_FILES.currentRun)) as Record<string, unknown>;
    expect(currentRun.status).toBe('initialized');
    expect(currentRun.run).toBeNull();
    expect(currentRun.projectName).toBe('Aviato Redux');
    const marker = await readWorkspaceMarker(dir);
    expect(marker).not.toBeNull();
    expect(marker!.kind).toBe(WORKSPACE_MARKER_KIND);
    expect(marker!.id).not.toBe('');
    expect(marker!.projectName).toBe('Aviato Redux');
  });

  it('re-init is idempotent: seeds skipped, marker id preserved', async () => {
    const dir = await makeTempDir();
    await initializeWorkspace(newInput(dir));
    const firstMarker = await readWorkspaceMarker(dir);
    const claudeBefore = await readWs(dir, 'CLAUDE.md');

    const second = await initializeWorkspace(newInput(dir));

    // Existing seeds (incl. both agent-pack files — sentinel present — and the
    // already-complete .gitignore) are left untouched.
    expect(second.skippedFiles).toContain(WORKSPACE_FILES.vision);
    expect(second.skippedFiles).toContain('CLAUDE.md');
    expect(second.skippedFiles).toContain('AGENTS.md');
    expect(second.skippedFiles).toContain('.gitignore');
    expect(await readWs(dir, 'CLAUDE.md')).toBe(claudeBefore);
    // App-managed metadata refreshes instead.
    expect(second.updatedFiles).toContain(META_FILES.currentRun);
    expect(second.updatedFiles).toContain(META_FILES.marker);
    // The workspace's identity (marker id + createdAt) survives re-init.
    const secondMarker = await readWorkspaceMarker(dir);
    expect(secondMarker!.id).toBe(firstMarker!.id);
    expect(secondMarker!.createdAt).toBe(firstMarker!.createdAt);
  });

  it('MERGES a scaffolder-written CLAUDE.md — import preserved, rails appended in the managed block', async () => {
    const dir = await makeTempDir();
    // create-next-app's shape: CLAUDE.md is just an @AGENTS.md import.
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n', 'utf8');

    const report = await initializeWorkspace(newInput(dir));

    const merged = await readWs(dir, 'CLAUDE.md');
    // The scaffolder's content leads, verbatim; the rails follow in the block.
    expect(merged.startsWith('@AGENTS.md\n\n<!-- BEGIN NUCLEUS-AI BUILD RAILS (managed) -->')).toBe(
      true,
    );
    expect(merged).toContain(NUCLEUS_RAILS_SENTINEL);
    expect(merged).toContain('# Agent instructions — Aviato Redux');
    expect(merged.trimEnd().endsWith('<!-- END NUCLEUS-AI BUILD RAILS -->')).toBe(true);
    // Reported as an update, not a create; the absent AGENTS.md is created bare.
    expect(report.updatedFiles).toContain('CLAUDE.md');
    expect(report.createdFiles).toContain('AGENTS.md');
    expect(await readWs(dir, 'AGENTS.md')).not.toContain('BEGIN NUCLEUS-AI BUILD RAILS');

    // Re-init after the merge skips (the sentinel now lives in the block).
    const again = await initializeWorkspace(newInput(dir));
    expect(again.skippedFiles).toContain('CLAUDE.md');
    expect(await readWs(dir, 'CLAUDE.md')).toBe(merged);
  });

  it('MERGES a scaffolder-written .gitignore instead of clobbering or skipping it', async () => {
    const dir = await makeTempDir();
    const scaffolderIgnore = '# created by a scaffolder\nnode_modules/\ndist/\n*.log\n';
    await fs.writeFile(path.join(dir, '.gitignore'), scaffolderIgnore, 'utf8');

    const report = await initializeWorkspace(newInput(dir));
    expect(report.updatedFiles).toContain('.gitignore');

    const merged = await readWs(dir, '.gitignore');
    // The scaffolder's file survives at the top…
    expect(merged.startsWith('# created by a scaffolder')).toBe(true);
    // …with the missing Nucleus rules appended under the labeled block.
    expect(merged).toContain('# Nucleus-AI');
    const lines = merged.split('\n').map((l) => l.trim());
    for (const rule of ['.env', '.env.*', '!.env.example', '.nucleus/telemetry.json']) {
      expect(lines, `merged .gitignore should gain "${rule}"`).toContain(rule);
    }
    // Rules the scaffolder already had are NOT duplicated.
    for (const already of ['node_modules/', 'dist/', '*.log']) {
      expect(lines.filter((l) => l === already)).toHaveLength(1);
    }
  });
});

describe('readProjectInfo — on-read sanitization of a hand-editable current-run.json', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function writeCurrentRun(dir: string, payload: Record<string, unknown>): Promise<void> {
    await fs.mkdir(path.join(dir, '.nucleus'), { recursive: true });
    await fs.writeFile(
      path.join(dir, META_FILES.currentRun),
      JSON.stringify(payload, null, 2),
      'utf8',
    );
  }

  it('drops/normalizes junk fields — out-of-catalog overlays, bad posture, non-string templateId', async () => {
    const dir = await makeTempDir();
    await writeCurrentRun(dir, {
      schemaVersion: 1,
      projectName: 'Hand Edited',
      createdAt: '2020-01-01T00:00:00.000Z',
      templateId: 42, // non-string → null
      overlayIds: ['database', 'not-a-real-overlay', 7, 'database'], // catalog-filtered + deduped
      deploymentPosture: 'yolo-prod', // invalid → undefined (strict default downstream)
      scaffoldId: 'not-a-scaffolder', // unknown id → undefined
      ventureId: '   ', // blank → undefined
      ventureName: '', // blank → undefined
      gitTracking: false, // explicit false survives
      ripIt: 'yes', // truthy-but-not-true → false
    });

    const info = await readProjectInfo(dir);
    expect(info).not.toBeNull();
    expect(info!.projectName).toBe('Hand Edited');
    expect(info!.workspacePath).toBe(path.resolve(dir));
    expect(info!.templateId).toBeNull();
    expect(info!.overlayIds).toEqual(['database']);
    expect(info!.deploymentPosture).toBeUndefined();
    expect(info!.scaffoldId).toBeUndefined();
    expect(info!.ventureId).toBeUndefined();
    expect(info!.ventureName).toBeUndefined();
    expect(info!.gitTracking).toBe(false);
    expect(info!.verificationGates).toBe(true); // absent → default true
    expect(info!.ripIt).toBe(false);
  });

  it('drops prototype-chain overlay keys — own catalog properties only', async () => {
    // 'toString'/'constructor' pass an `in` check via the prototype chain, then crash
    // composeBlueprint/overlaysFor downstream (OVERLAYS['toString'] has no .blueprint).
    const dir = await makeTempDir();
    await writeCurrentRun(dir, {
      schemaVersion: 1,
      projectName: 'Proto Keys',
      createdAt: '2020-01-01T00:00:00.000Z',
      overlayIds: ['toString', 'constructor', 'database'],
    });

    const info = await readProjectInfo(dir);
    expect(info).not.toBeNull();
    expect(info!.overlayIds).toEqual(['database']);
  });

  it('preserves valid values untouched (no over-sanitization)', async () => {
    const dir = await makeTempDir();
    const realScaffoldId = Object.keys(SCAFFOLDERS)[0];
    await writeCurrentRun(dir, {
      schemaVersion: 1,
      projectName: 'Legit',
      createdAt: '2020-01-01T00:00:00.000Z',
      templateId: 'static-site',
      overlayIds: ['email', 'database'],
      deploymentPosture: 'internal',
      scaffoldId: realScaffoldId,
      ventureId: 'v-1',
      ventureName: 'Pied Piper Platform',
      verificationGates: false,
    });

    const info = await readProjectInfo(dir);
    expect(info).not.toBeNull();
    expect(info!.templateId).toBe('static-site');
    expect(info!.overlayIds).toEqual(['email', 'database']);
    expect(info!.deploymentPosture).toBe('internal');
    expect(info!.scaffoldId).toBe(realScaffoldId);
    expect(info!.ventureId).toBe('v-1');
    expect(info!.ventureName).toBe('Pied Piper Platform');
    expect(info!.verificationGates).toBe(false);
  });

  it('returns null for a foreign folder (no .nucleus/current-run.json) and for a record missing its identity', async () => {
    // A plain folder Nucleus never touched → null (never a fabricated ProjectInfo).
    const foreign = await makeTempDir();
    expect(await readProjectInfo(foreign)).toBeNull();
    // …and the marker guard reads it as not-provably-app-created too.
    expect(await readWorkspaceMarker(foreign)).toBeNull();

    // current-run.json present but missing projectName/createdAt → null.
    const broken = await makeTempDir();
    await writeCurrentRun(broken, { schemaVersion: 1, templateId: 'static-site' });
    expect(await readProjectInfo(broken)).toBeNull();

    // Malformed JSON → null, never a throw.
    const malformed = await makeTempDir();
    await fs.mkdir(path.join(malformed, '.nucleus'), { recursive: true });
    await fs.writeFile(path.join(malformed, META_FILES.currentRun), '{not json', 'utf8');
    expect(await readProjectInfo(malformed)).toBeNull();
  });

  it('readWorkspaceMarker rejects a marker of the wrong kind (foreign-folder guard)', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, '.nucleus'), { recursive: true });
    await fs.writeFile(
      path.join(dir, META_FILES.marker),
      JSON.stringify({ schemaVersion: 1, kind: 'someone-elses-marker', id: 'abc' }),
      'utf8',
    );
    expect(await readWorkspaceMarker(dir)).toBeNull();
  });
});
