/**
 * Reference material the founder supplies to help the team build: screenshots,
 * wireframes, brand assets, a spec they already wrote. The files live in the
 * workspace at `references/` — where the local CLIs (which run with cwd = the
 * workspace) can read them directly — and a NAMES-ONLY note per file is kept in
 * app metadata (.nucleus/references.json). This module is pure (no I/O): types,
 * the allow-list, filename sanitizing, and the prompt block the personas see.
 *
 * The whole point: the CLIs already run in the workspace, so "uploading" is just
 * copying a file to a known folder + telling the personas it's there. No vision
 * pipeline, no byte transfer over IPC — main copies the file; the CLI reads it.
 */

/** Workspace-relative folder the reference files live in. */
export const REFERENCES_DIR = 'references';

/** Per-file size cap — references are inputs, not a media library. */
export const MAX_REFERENCE_BYTES = 15 * 1024 * 1024; // 15 MB

/** How many reference files a single project may hold. */
export const MAX_REFERENCE_FILES = 30;

/**
 * Allowed extensions for a DIRECT file upload (lower-case, with the dot). Images
 * the CLIs can look at, plus the document formats a founder hands over.
 * Deliberately tight — never executables. Archives are handled separately
 * (see archiveFormatOf / isArchiveReferenceExt): they are EXTRACTED on upload into
 * references/<name>/ — the raw archive is never kept, so an auto-approve build is
 * never handed an archive — with secret/credential and executable files inside skipped.
 */
export const ALLOWED_REFERENCE_EXTENSIONS: readonly string[] = [
  // images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  // documents
  '.md',
  '.markdown',
  '.txt',
  '.pdf',
  '.csv',
  '.json',
];

export type ReferenceKind = 'image' | 'document' | 'archive' | 'other';

/** One reference file: the on-disk name, the founder's note, size, and kind. */
export interface ReferenceFile {
  /** Base filename inside references/ (never a path). */
  fileName: string;
  /** The founder's one-line "what this is" note ('' until they add one). */
  note: string;
  sizeBytes: number;
  kind: ReferenceKind;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const DOC_EXTS = new Set(['.md', '.markdown', '.txt', '.pdf', '.csv', '.json']);

/** Lower-cased extension including the leading dot, or '' when there is none. */
export function referenceExtOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

export function referenceKindOf(fileName: string): ReferenceKind {
  const ext = referenceExtOf(fileName);
  if (IMAGE_EXTS.has(ext)) {
    return 'image';
  }
  if (DOC_EXTS.has(ext)) {
    return 'document';
  }
  return 'other';
}

export function isAllowedReferenceExt(fileName: string): boolean {
  return ALLOWED_REFERENCE_EXTENSIONS.includes(referenceExtOf(fileName));
}

/* ----- archive uploads (proof-of-concept code, extracted on import) ----- */

/**
 * Archive formats accepted for upload. NOT part of the direct allow-list above: an
 * uploaded archive is EXTRACTED into references/<name>/ and the raw archive is never
 * kept, so an auto-approve build is never handed an archive to run. Files inside that
 * look like secrets/credentials or executables are skipped on extraction.
 */
export type ArchiveFormat = 'zip' | 'tar' | '7z';

/** Cap on the uploaded archive itself (it unpacks to many files). */
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024; // 100 MB
/** Zip-bomb guards on what a single archive may unpack to. */
export const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_EXTRACTED_ENTRIES = 2000;

/** Which extractor handles this archive name, or null if it isn't a known archive. */
export function archiveFormatOf(fileName: string): ArchiveFormat | null {
  const lower = (fileName.split(/[\\/]/).pop() ?? '').toLowerCase();
  if (lower.endsWith('.zip')) {
    return 'zip';
  }
  if (lower.endsWith('.7z')) {
    return '7z';
  }
  if (lower.endsWith('.tar') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    return 'tar';
  }
  return null;
}

export function isArchiveReferenceExt(fileName: string): boolean {
  return archiveFormatOf(fileName) !== null;
}

/** The base name without its archive extension (handles the double `.tar.gz`). */
export function archiveStemOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const lower = base.toLowerCase();
  for (const ext of ['.tar.gz', '.tgz', '.tar', '.zip', '.7z']) {
    if (lower.endsWith(ext)) {
      return base.slice(0, base.length - ext.length);
    }
  }
  return base;
}

/** Directories never imported from an archive (deps, build output, VCS, IDE noise). */
const SKIP_DIR_SEGMENTS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', 'vendor', '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'bin', 'obj',
  '.gradle', 'target',
]);

/** Executable/binary extensions never imported from an archive. */
const EXECUTABLE_EXTS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.bat', '.cmd', '.sh', '.ps1', '.com', '.msi',
  '.app', '.deb', '.rpm', '.o', '.a', '.class', '.jar', '.node', '.pyc', '.wasm', '.scr',
]);

/** Whether to descend into an extracted directory (relative path, '/'-separated). */
export function shouldKeepExtractedDir(relPath: string): boolean {
  return !relPath.split('/').some((s) => SKIP_DIR_SEGMENTS.has(s.toLowerCase()));
}

/**
 * Whether an extracted FILE (relative path, '/'-separated) should be imported as a
 * reference. Skips anything under a skip-dir, secret/credential files, nested archives,
 * and executables/binaries — so an auto-approve build only ever sees safe source/doc files.
 */
export function shouldKeepExtractedFile(relPath: string): boolean {
  const segments = relPath.split('/').filter((s) => s !== '');
  if (segments.length === 0) {
    return false;
  }
  if (segments.some((s) => SKIP_DIR_SEGMENTS.has(s.toLowerCase()))) {
    return false;
  }
  const base = segments[segments.length - 1];
  if (isSecretBearingFileName(base)) {
    return false;
  }
  if (archiveFormatOf(base) !== null) {
    return false; // a nested archive — don't import it
  }
  return !EXECUTABLE_EXTS.has(referenceExtOf(base));
}

/**
 * Refuse files that look like real credentials (`.env`, `.pem`/`.key`, SSH keys,
 * `.npmrc`/`.netrc`, …). The strict allow-list already blocks these extensions, so
 * this is defense-in-depth + a security-specific rejection message: an autopilot
 * CLI runs with cwd = the workspace, so a credentials file uploaded here would be
 * readable by it. (It can't catch a value pasted into an allowed .txt/.md — that
 * stays a documented warning, not an extension rule.) The `.example`/`.sample`/
 * `.template` early-return matters for callers that scan the project tree (where a
 * legit `.env.example` lives); for reference UPLOADS such a file is rejected anyway
 * by the extension allow-list.
 */
export function isSecretBearingFileName(fileName: string): boolean {
  const base = (fileName.split(/[\\/]/).pop() ?? '').toLowerCase();
  if (/\.(example|sample|template|dist)$/.test(base)) {
    return false;
  }
  if (/^\.env($|\.)/.test(base)) {
    return true;
  }
  if (
    ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'credentials', 'credentials.json',
      '.npmrc', '.netrc', '.pgpass'].includes(base)
  ) {
    return true;
  }
  return /\.(pem|key|pfx|p12|keystore|jks|asc|gpg)$/.test(base);
}

/**
 * Reduce any user-supplied name to a SAFE base filename for references/:
 * strips every path separator and drive/colon trick (so it can never escape the
 * folder), collapses unsafe characters, trims dots/spaces, and bounds the
 * length. Returns '' when nothing usable remains (caller rejects it).
 */
export function sanitizeReferenceFileName(name: string): string {
  // Take the last path-ish segment, defeating "../", "a/b", "C:\x", etc.
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[^A-Za-z0-9._ -]/g, '_') // keep a friendly, safe character set
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '') // no leading dots (hidden) or spaces
    .replace(/[.\s]+$/, '') // no trailing dots/spaces (Windows-hostile)
    .slice(0, 120)
    .trim();
  return cleaned;
}

/**
 * Pick a name that doesn't collide with one already taken, by suffixing
 * " (2)", " (3)", … before the extension. Pure — the caller supplies the set
 * of names already present in references/.
 */
export function uniqueReferenceFileName(fileName: string, taken: Set<string>): string {
  if (!taken.has(fileName)) {
    return fileName;
  }
  const ext = referenceExtOf(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${stem} (${Date.now()})${ext}`;
}

/**
 * The "Reference material" block injected into a persona's prompt so they
 * consult the founder's files. Uses ABSOLUTE paths so it works whether the CLI
 * runs in the workspace (the Bullpen) or a temp cwd (the chat rooms). Returns ''
 * when there are no references, so prompts stay byte-identical for projects
 * without any (no behavior change for the existing flows).
 */
export function buildReferencesPromptBlock(
  references: ReferenceFile[],
  referencesDirAbsolute: string,
): string {
  if (references.length === 0) {
    return '';
  }
  // Use forward slashes in the joined path so the line reads the same on every
  // OS; the CLIs accept forward slashes on Windows too.
  const sep = referencesDirAbsolute.includes('\\') ? '\\' : '/';
  const lines = references.map((r) => {
    const note = r.note.trim() !== '' ? ` — ${r.note.trim()}` : '';
    if (r.kind === 'archive') {
      return `- ${referencesDirAbsolute}${sep}${r.fileName}${sep} (extracted archive — a folder of the founder's reference files, e.g. a proof of concept; open and read what's inside)${note}`;
    }
    return `- ${referencesDirAbsolute}${sep}${r.fileName} (${r.kind})${note}`;
  });
  return [
    '',
    '',
    'REFERENCE MATERIAL the founder provided (read these before designing/building —',
    'screenshots show the look they want, documents carry details/specs; honor them):',
    ...lines,
  ].join('\n');
}
