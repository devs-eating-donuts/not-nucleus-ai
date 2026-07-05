import { describe, expect, it } from 'vitest';
import {
  archiveFormatOf,
  archiveStemOf,
  buildReferencesPromptBlock,
  isAllowedReferenceExt,
  isArchiveReferenceExt,
  isSecretBearingFileName,
  referenceKindOf,
  sanitizeReferenceFileName,
  shouldKeepExtractedDir,
  shouldKeepExtractedFile,
  uniqueReferenceFileName,
  type ReferenceFile,
} from './references';

describe('referenceKindOf', () => {
  it('classifies images, documents, and other', () => {
    expect(referenceKindOf('mock.png')).toBe('image');
    expect(referenceKindOf('LOGO.SVG')).toBe('image');
    expect(referenceKindOf('spec.md')).toBe('document');
    expect(referenceKindOf('data.csv')).toBe('document');
    expect(referenceKindOf('weird.xyz')).toBe('other');
    expect(referenceKindOf('noext')).toBe('other');
  });
});

describe('isAllowedReferenceExt', () => {
  it('allows the catalog and rejects executables/archives', () => {
    expect(isAllowedReferenceExt('home.png')).toBe(true);
    expect(isAllowedReferenceExt('notes.PDF')).toBe(true);
    expect(isAllowedReferenceExt('evil.exe')).toBe(false);
    expect(isAllowedReferenceExt('payload.zip')).toBe(false);
    expect(isAllowedReferenceExt('script.sh')).toBe(false);
  });
});

describe('sanitizeReferenceFileName', () => {
  it('strips path traversal and separators to a bare base name', () => {
    expect(sanitizeReferenceFileName('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(sanitizeReferenceFileName('C:\\Windows\\system32\\a.png')).toBe('a.png');
    expect(sanitizeReferenceFileName('sub/dir/shot.jpg')).toBe('shot.jpg');
  });

  it('replaces unsafe characters and trims leading/trailing dots and spaces', () => {
    expect(sanitizeReferenceFileName('  .hidden.png  ')).toBe('hidden.png');
    expect(sanitizeReferenceFileName('my shot*?.png')).toBe('my shot__.png');
  });

  it('returns empty for an unusable name', () => {
    expect(sanitizeReferenceFileName('...')).toBe('');
    expect(sanitizeReferenceFileName('/')).toBe('');
  });
});

describe('uniqueReferenceFileName', () => {
  it('returns the name when free', () => {
    expect(uniqueReferenceFileName('a.png', new Set())).toBe('a.png');
  });

  it('suffixes " (n)" before the extension on collision', () => {
    const taken = new Set(['a.png', 'a (2).png']);
    expect(uniqueReferenceFileName('a.png', taken)).toBe('a (3).png');
  });

  it('handles extensionless names', () => {
    expect(uniqueReferenceFileName('readme', new Set(['readme']))).toBe('readme (2)');
  });
});

describe('buildReferencesPromptBlock', () => {
  const refs: ReferenceFile[] = [
    { fileName: 'home.png', note: 'the look I want', sizeBytes: 100, kind: 'image' },
    { fileName: 'spec.md', note: '', sizeBytes: 50, kind: 'document' },
  ];

  it('returns empty string with no references (prompts stay byte-identical)', () => {
    expect(buildReferencesPromptBlock([], '/ws/references')).toBe('');
  });

  it('lists absolute paths with notes, joining with the dir separator', () => {
    const block = buildReferencesPromptBlock(refs, '/ws/references');
    expect(block).toContain('/ws/references/home.png (image) — the look I want');
    // No note → no trailing dash.
    expect(block).toContain('/ws/references/spec.md (document)');
    expect(block).not.toContain('spec.md (document) —');
    expect(block.startsWith('\n\n')).toBe(true);
  });

  it('uses backslash joins for a Windows-style directory', () => {
    const block = buildReferencesPromptBlock(refs, 'C:\\ws\\references');
    expect(block).toContain('C:\\ws\\references\\home.png (image) — the look I want');
  });

  it('renders an extracted-archive folder entry distinctly', () => {
    const block = buildReferencesPromptBlock(
      [{ fileName: 'my-poc', note: 'prior prototype', sizeBytes: 4096, kind: 'archive' }],
      '/ws/references',
    );
    expect(block).toContain('/ws/references/my-poc/ (extracted archive');
    expect(block).toContain('— prior prototype');
  });
});

describe('archive helpers', () => {
  it('archiveFormatOf maps extensions (incl. .tar.gz) and rejects non-archives', () => {
    expect(archiveFormatOf('poc.zip')).toBe('zip');
    expect(archiveFormatOf('POC.ZIP')).toBe('zip');
    expect(archiveFormatOf('bundle.7z')).toBe('7z');
    expect(archiveFormatOf('src.tar')).toBe('tar');
    expect(archiveFormatOf('src.tar.gz')).toBe('tar');
    expect(archiveFormatOf('src.tgz')).toBe('tar');
    expect(archiveFormatOf('notes.pdf')).toBeNull();
    expect(archiveFormatOf('data.gz')).toBeNull(); // bare .gz is not a supported archive
  });

  it('isArchiveReferenceExt agrees with archiveFormatOf', () => {
    expect(isArchiveReferenceExt('poc.zip')).toBe(true);
    expect(isArchiveReferenceExt('a.tar.gz')).toBe(true);
    expect(isArchiveReferenceExt('a.png')).toBe(false);
  });

  it('archiveStemOf strips the archive extension, handling .tar.gz', () => {
    expect(archiveStemOf('my-poc.zip')).toBe('my-poc');
    expect(archiveStemOf('proj.tar.gz')).toBe('proj');
    expect(archiveStemOf('proj.tgz')).toBe('proj');
    expect(archiveStemOf('/tmp/sub/code.7z')).toBe('code');
  });

  it('archives are NOT in the direct upload allow-list (they are extracted, not stored raw)', () => {
    expect(isAllowedReferenceExt('poc.zip')).toBe(false);
    expect(isAllowedReferenceExt('poc.tar')).toBe(false);
  });
});

describe('isSecretBearingFileName', () => {
  it('rejects real secret/credential files (the upload guard)', () => {
    // dotenv family
    expect(isSecretBearingFileName('.env')).toBe(true);
    expect(isSecretBearingFileName('.env.local')).toBe(true);
    expect(isSecretBearingFileName('.env.production')).toBe(true);
    // SSH private keys
    expect(isSecretBearingFileName('id_rsa')).toBe(true);
    expect(isSecretBearingFileName('id_ed25519')).toBe(true);
    // package/auth dotfiles
    expect(isSecretBearingFileName('.npmrc')).toBe(true);
    expect(isSecretBearingFileName('.netrc')).toBe(true);
    expect(isSecretBearingFileName('.pgpass')).toBe(true);
    // credential bundles + key/cert extensions
    expect(isSecretBearingFileName('credentials.json')).toBe(true);
    expect(isSecretBearingFileName('server.pem')).toBe(true);
    expect(isSecretBearingFileName('private.key')).toBe(true);
    expect(isSecretBearingFileName('cert.pfx')).toBe(true);
  });

  it('is case-insensitive and defeats path prefixes', () => {
    expect(isSecretBearingFileName('.ENV')).toBe(true);
    expect(isSecretBearingFileName('ID_RSA')).toBe(true);
    expect(isSecretBearingFileName('SERVER.PEM')).toBe(true);
    expect(isSecretBearingFileName('Cert.PFX')).toBe(true);
    // only the base name matters — a separator can't smuggle a secret past it
    expect(isSecretBearingFileName('config/.env')).toBe(true);
    expect(isSecretBearingFileName('C:\\keys\\id_rsa')).toBe(true);
  });

  it('allows example/template scaffolding and ordinary docs/assets', () => {
    expect(isSecretBearingFileName('.env.example')).toBe(false);
    expect(isSecretBearingFileName('.env.sample')).toBe(false);
    expect(isSecretBearingFileName('.env.template')).toBe(false);
    expect(isSecretBearingFileName('README.md')).toBe(false);
    expect(isSecretBearingFileName('logo.png')).toBe(false);
  });
});

describe('extraction filters', () => {
  it('keeps source and doc files', () => {
    expect(shouldKeepExtractedFile('src/index.ts')).toBe(true);
    expect(shouldKeepExtractedFile('README.md')).toBe(true);
    expect(shouldKeepExtractedFile('app/.gitignore')).toBe(true);
  });

  it('skips secrets, executables, nested archives, and dep/build/VCS folders', () => {
    expect(shouldKeepExtractedFile('.env')).toBe(false);
    expect(shouldKeepExtractedFile('config/id_rsa')).toBe(false);
    expect(shouldKeepExtractedFile('tools/tool.exe')).toBe(false);
    expect(shouldKeepExtractedFile('run.sh')).toBe(false);
    expect(shouldKeepExtractedFile('nested/inner.zip')).toBe(false);
    expect(shouldKeepExtractedFile('node_modules/left-pad/index.js')).toBe(false);
    expect(shouldKeepExtractedFile('.git/config')).toBe(false);
    expect(shouldKeepExtractedFile('dist/bundle.js')).toBe(false);
  });

  it('shouldKeepExtractedDir prunes dep/build/VCS dirs', () => {
    expect(shouldKeepExtractedDir('src')).toBe(true);
    expect(shouldKeepExtractedDir('src/components')).toBe(true);
    expect(shouldKeepExtractedDir('node_modules')).toBe(false);
    expect(shouldKeepExtractedDir('a/.git')).toBe(false);
  });
});
