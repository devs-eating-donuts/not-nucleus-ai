import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OVERLAYS } from '../../shared/blueprints';
import { DEFAULT_NAMING_MODE } from '../../shared/naming';
import {
  assertSafeWorkspaceRoot,
  docPathForKey,
  optionalString,
  requireProjectId,
  requireString,
  sanitizeNamingMode,
  sanitizeNewProjectInput,
} from './projectInputValidation';

describe('docPathForKey (project:read-doc allow-list)', () => {
  it('maps the two known keys to their fixed workspace paths', () => {
    expect(docPathForKey('findings-backlog')).toBe('reviews/findings-backlog.md');
    expect(docPathForKey('project-backlog')).toBe('planning/backlog.md');
  });
  it('returns null for unknown / traversal / prototype / non-string keys (never an arbitrary path)', () => {
    expect(docPathForKey('reviews/security-review.md')).toBeNull(); // a real file, but not allow-listed
    expect(docPathForKey('../../etc/passwd')).toBeNull();
    expect(docPathForKey('toString')).toBeNull(); // prototype keys must not pass
    expect(docPathForKey('constructor')).toBeNull();
    expect(docPathForKey(42)).toBeNull();
    expect(docPathForKey(null)).toBeNull();
    expect(docPathForKey(undefined)).toBeNull();
  });
});

// An absolute path on whatever OS the test runs on (Windows CI included).
const ABS = path.resolve('some', 'project', 'folder');
const knownOverlay = Object.keys(OVERLAYS)[0]; // catalog isn't empty

function baseInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectName: 'My App',
    productIdea: 'A thing that does stuff.',
    workspacePath: ABS,
    ...over,
  };
}

describe('requireString', () => {
  it('trims and returns a valid string', () => {
    expect(requireString('  hi  ', 'X', 10)).toBe('hi');
  });
  it('throws on a non-string or empty/whitespace', () => {
    expect(() => requireString(undefined, 'Name', 10)).toThrow(/Name is required/);
    expect(() => requireString('   ', 'Name', 10)).toThrow(/Name is required/);
    expect(() => requireString(42, 'Name', 10)).toThrow(/Name is required/);
  });
  it('throws when over the length cap', () => {
    expect(() => requireString('x'.repeat(11), 'Name', 10)).toThrow(/exceeds 10/);
  });
});

describe('optionalString', () => {
  it('coerces non-strings to empty', () => {
    expect(optionalString(undefined, 10)).toBe('');
    expect(optionalString(null, 10)).toBe('');
    expect(optionalString(7, 10)).toBe('');
  });
  it('trims and clamps to the cap', () => {
    expect(optionalString('  hello  ', 10)).toBe('hello');
    expect(optionalString('abcdefghij... long', 5)).toBe('abcde');
  });
});

describe('requireProjectId', () => {
  it('returns a non-empty id', () => {
    expect(requireProjectId('proj-123')).toBe('proj-123');
  });
  it('throws on empty / non-string', () => {
    expect(() => requireProjectId('')).toThrow(/project id is required/);
    expect(() => requireProjectId(null)).toThrow(/project id is required/);
  });
});

describe('sanitizeNamingMode', () => {
  it('passes through every known mode and defaults the rest to the shipped default', () => {
    expect(sanitizeNamingMode('pete')).toBe('pete');
    expect(sanitizeNamingMode('cover')).toBe('cover');
    expect(sanitizeNamingMode('distinct')).toBe('distinct');
    expect(sanitizeNamingMode('canon')).toBe('canon');
    expect(sanitizeNamingMode('garbage')).toBe(DEFAULT_NAMING_MODE);
    expect(sanitizeNamingMode(undefined)).toBe(DEFAULT_NAMING_MODE);
  });
});

describe('sanitizeNewProjectInput', () => {
  it('accepts a valid payload and applies defaults', () => {
    const out = sanitizeNewProjectInput(baseInput());
    expect(out.projectName).toBe('My App');
    expect(out.productIdea).toBe('A thing that does stuff.');
    expect(out.workspacePath).toBe(ABS);
    expect(out.gitTracking).toBe(true); // default ON
    expect(out.verificationGates).toBe(true); // default ON
    expect(out.reproBackedFindings).toBe(false); // default OFF (opt-in)
    expect(out.ripIt).toBe(false); // default OFF
    expect(out.enabledRoles).toEqual([]);
    expect(out.overlayIds).toEqual([]);
    expect(out.templateId).toBeNull();
  });

  it('throws on a non-object payload', () => {
    expect(() => sanitizeNewProjectInput(null)).toThrow(/expects a project input object/);
    expect(() => sanitizeNewProjectInput('nope')).toThrow(/expects a project input object/);
  });

  it('REJECTS a relative workspace path (the trust-boundary guard)', () => {
    expect(() => sanitizeNewProjectInput(baseInput({ workspacePath: 'relative/path' }))).toThrow(
      /absolute path/,
    );
    expect(() => sanitizeNewProjectInput(baseInput({ workspacePath: './x' }))).toThrow(
      /absolute path/,
    );
  });

  it('requires a name and an idea', () => {
    expect(() => sanitizeNewProjectInput(baseInput({ projectName: '' }))).toThrow(/Project name/);
    expect(() => sanitizeNewProjectInput(baseInput({ productIdea: '   ' }))).toThrow(/Product idea/);
  });

  it('filters enabledRoles to known RoleIds and de-dupes', () => {
    const out = sanitizeNewProjectInput(
      baseInput({ enabledRoles: ['developer', 'developer', 'qa', 'notarole', 42] }),
    );
    expect(out.enabledRoles).toEqual(['developer', 'qa']);
  });

  it('filters overlayIds to the known catalog and drops junk', () => {
    const out = sanitizeNewProjectInput(
      baseInput({ overlayIds: [knownOverlay, knownOverlay, 'definitely-not-an-overlay', 99] }),
    );
    expect(out.overlayIds).toEqual([knownOverlay]);
  });

  it('honors explicit gitTracking=false and ripIt=true', () => {
    const out = sanitizeNewProjectInput(baseInput({ gitTracking: false, ripIt: true }));
    expect(out.gitTracking).toBe(false);
    expect(out.ripIt).toBe(true);
  });

  it('honors explicit verificationGates=false', () => {
    expect(sanitizeNewProjectInput(baseInput({ verificationGates: false })).verificationGates).toBe(false);
  });

  it('honors explicit reproBackedFindings=true (opt-in), else stays false', () => {
    expect(sanitizeNewProjectInput(baseInput({ reproBackedFindings: true })).reproBackedFindings).toBe(true);
    expect(sanitizeNewProjectInput(baseInput({ reproBackedFindings: 'yes' })).reproBackedFindings).toBe(false);
  });

  it('keeps a known scaffoldId and drops an unknown/junk one (no arbitrary commands)', () => {
    expect(sanitizeNewProjectInput(baseInput({ scaffoldId: 'vite-react-ts' })).scaffoldId).toBe(
      'vite-react-ts',
    );
    expect(sanitizeNewProjectInput(baseInput({ scaffoldId: 'rm -rf /' })).scaffoldId).toBeUndefined();
    expect(sanitizeNewProjectInput(baseInput({ scaffoldId: 42 })).scaffoldId).toBeUndefined();
    expect(sanitizeNewProjectInput(baseInput()).scaffoldId).toBeUndefined();
  });

  it('clamps deploymentPosture to the known enum; junk/absent → undefined (strict default later)', () => {
    expect(
      sanitizeNewProjectInput(baseInput({ deploymentPosture: 'local-single-user' })).deploymentPosture,
    ).toBe('local-single-user');
    expect(
      sanitizeNewProjectInput(baseInput({ deploymentPosture: 'multi-tenant' })).deploymentPosture,
    ).toBe('multi-tenant');
    expect(
      sanitizeNewProjectInput(baseInput({ deploymentPosture: 'production' })).deploymentPosture,
    ).toBeUndefined();
    expect(
      sanitizeNewProjectInput(baseInput({ deploymentPosture: 42 })).deploymentPosture,
    ).toBeUndefined();
    expect(sanitizeNewProjectInput(baseInput()).deploymentPosture).toBeUndefined();
  });
});

describe('assertSafeWorkspaceRoot (catastrophic-root guard)', () => {
  const home = path.resolve(path.sep, 'Users', 'tester');

  it('refuses the home directory, its parents, and the filesystem root', () => {
    expect(() => assertSafeWorkspaceRoot(home, home)).toThrow(/home directory/);
    expect(() => assertSafeWorkspaceRoot(path.dirname(home), home)).toThrow(/contains your home/);
    expect(() => assertSafeWorkspaceRoot(path.parse(home).root, home)).toThrow(/filesystem root/);
  });

  it('refuses the catch-all containers themselves but allows their subfolders', () => {
    expect(() => assertSafeWorkspaceRoot(path.join(home, 'Documents'), home)).toThrow(/Documents/);
    expect(() => assertSafeWorkspaceRoot(path.join(home, 'Desktop'), home)).toThrow(/Desktop/);
    expect(() =>
      assertSafeWorkspaceRoot(path.join(home, 'Documents', 'my-app'), home),
    ).not.toThrow();
    expect(() => assertSafeWorkspaceRoot(path.join(home, 'repos', 'my-app'), home)).not.toThrow();
  });

  it('is wired into sanitizeNewProjectInput (the create boundary)', () => {
    // git tracking would `git add -A` the whole folder — home itself must never pass.
    expect(() =>
      sanitizeNewProjectInput(baseInput({ workspacePath: require('node:os').homedir() })),
    ).toThrow(/not usable/);
  });
});

describe('overlay catalog filtering — own properties only', () => {
  it('drops prototype-chain keys (toString/constructor) that pass `in` but crash composeBlueprint', () => {
    const input = baseInput({ overlayIds: ['toString', 'constructor', knownOverlay] });
    expect(sanitizeNewProjectInput(input).overlayIds).toEqual([knownOverlay]);
  });
});
