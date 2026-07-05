import { spawn } from 'node:child_process';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { META_FILES } from '../../shared/markdown';
import {
  MAX_ARCHIVE_BYTES,
  MAX_EXTRACTED_BYTES,
  MAX_EXTRACTED_ENTRIES,
  MAX_REFERENCE_BYTES,
  MAX_REFERENCE_FILES,
  REFERENCES_DIR,
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
} from '../../shared/references';
import type { ArchiveFormat, ReferenceFile } from '../../shared/references';
import { resolveWorkspacePath } from './markdownWorkspace';
import { writeJsonAtomic } from './atomicWrite';

/**
 * Founder reference uploads, on disk. The files live in the workspace
 * `references/` folder (the local CLIs read them from cwd); the per-file notes
 * live in app metadata (.nucleus/references.json). All paths resolve through
 * resolveWorkspacePath, so nothing here can touch a file outside the workspace.
 *
 * The canonical list is derived from the FILES actually present in references/
 * (so a file the user drops in by hand still shows up), merged with the notes
 * map. Adding copies a file in; main owns the byte I/O, never the renderer.
 */

const REFERENCES_ABS = (workspacePath: string): string =>
  resolveWorkspacePath(workspacePath, REFERENCES_DIR);

/** Notes map { fileName: note }, persisted in .nucleus/references.json. */
async function readNotes(workspacePath: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(resolveWorkspacePath(workspacePath, META_FILES.references), 'utf8');
    const parsed = JSON.parse(raw) as { notes?: unknown };
    const out: Record<string, string> = {};
    if (parsed.notes && typeof parsed.notes === 'object') {
      for (const [k, v] of Object.entries(parsed.notes as Record<string, unknown>)) {
        if (typeof v === 'string') {
          out[k] = v;
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function writeNotes(workspacePath: string, notes: Record<string, string>): Promise<void> {
  await writeJsonAtomic(resolveWorkspacePath(workspacePath, META_FILES.references), {
    schemaVersion: 1,
    notes,
  });
}

/**
 * The reference files actually present in references/, merged with their notes.
 * Sorted by name. Skips disallowed extensions so the list always reflects what
 * the personas are told about.
 */
export async function listReferences(workspacePath: string): Promise<ReferenceFile[]> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(REFERENCES_ABS(workspacePath), { withFileTypes: true });
  } catch {
    return [];
  }
  const notes = await readNotes(workspacePath);
  const refs: ReferenceFile[] = [];
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = ent.name;
    if (name.startsWith('.') || name.toLowerCase() === 'readme.md') {
      continue;
    }
    // An extracted-archive folder is surfaced as ONE 'archive' reference the team
    // can explore (the build CLIs run with cwd = the workspace and read it).
    if (ent.isDirectory()) {
      const sizeBytes = await dirSizeBounded(
        resolveWorkspacePath(workspacePath, `${REFERENCES_DIR}/${name}`),
      );
      refs.push({ fileName: name, note: notes[name] ?? '', sizeBytes, kind: 'archive' });
      continue;
    }
    if (!isAllowedReferenceExt(name)) {
      continue;
    }
    let sizeBytes = 0;
    try {
      const st = await fs.stat(resolveWorkspacePath(workspacePath, `${REFERENCES_DIR}/${name}`));
      if (!st.isFile()) {
        continue;
      }
      sizeBytes = st.size;
    } catch {
      continue;
    }
    refs.push({ fileName: name, note: notes[name] ?? '', sizeBytes, kind: referenceKindOf(name) });
  }
  return refs;
}

export interface AddReferencesResult {
  added: string[];
  /** Per-source rejections, e.g. "logo.exe: file type not allowed". */
  rejected: string[];
  references: ReferenceFile[];
}

/**
 * Copy the given absolute source files into references/, validating each
 * (extension allow-list, size cap, total count) and de-duplicating names. Main
 * supplies the paths (from a native file dialog); never the renderer. Returns
 * what landed, what was rejected and why, and the refreshed list.
 */
export async function addReferences(
  workspacePath: string,
  sourcePaths: string[],
): Promise<AddReferencesResult> {
  const dir = REFERENCES_ABS(workspacePath);
  await fs.mkdir(dir, { recursive: true });

  const existing = await listReferences(workspacePath);
  const taken = new Set(existing.map((r) => r.fileName));
  const added: string[] = [];
  const rejected: string[] = [];

  for (const src of sourcePaths) {
    const srcName = path.basename(src);
    if (taken.size >= MAX_REFERENCE_FILES) {
      rejected.push(`${srcName}: reference limit (${MAX_REFERENCE_FILES}) reached`);
      continue;
    }
    if (isSecretBearingFileName(srcName)) {
      rejected.push(`${srcName}: looks like a secret/credential file — never upload real secrets (the build CLIs can read this folder)`);
      continue;
    }
    // An archive (.zip/.7z/.tar/.tgz) is EXTRACTED into references/<stem>/ — the raw
    // archive is never kept, and secret/executable/dep files inside are skipped.
    if (isArchiveReferenceExt(srcName)) {
      const res = await importArchive(workspacePath, src, srcName, taken);
      if (res.ok) {
        taken.add(res.folder);
        added.push(res.folder);
      } else {
        rejected.push(`${srcName}: ${res.reason}`);
      }
      continue;
    }
    if (!isAllowedReferenceExt(srcName)) {
      rejected.push(`${srcName}: file type not allowed`);
      continue;
    }
    let bytes: Buffer;
    try {
      const st = await fs.stat(src);
      if (!st.isFile()) {
        rejected.push(`${srcName}: not a file`);
        continue;
      }
      if (st.size > MAX_REFERENCE_BYTES) {
        rejected.push(`${srcName}: larger than ${Math.round(MAX_REFERENCE_BYTES / (1024 * 1024))} MB`);
        continue;
      }
      bytes = await fs.readFile(src);
    } catch {
      rejected.push(`${srcName}: could not read the file`);
      continue;
    }
    const safe = sanitizeReferenceFileName(srcName);
    if (safe === '' || !isAllowedReferenceExt(safe)) {
      rejected.push(`${srcName}: unusable filename`);
      continue;
    }
    const finalName = uniqueReferenceFileName(safe, taken);
    try {
      // resolveWorkspacePath guarantees the destination stays inside references/.
      await fs.writeFile(resolveWorkspacePath(workspacePath, `${REFERENCES_DIR}/${finalName}`), bytes);
      taken.add(finalName);
      added.push(finalName);
    } catch {
      rejected.push(`${srcName}: could not save into the project`);
    }
  }

  return { added, rejected, references: await listReferences(workspacePath) };
}

/**
 * Resolve a renderer-supplied name to the EXACT file currently in references/.
 * We match against the real directory listing (whose names are safe base names
 * from readdir) rather than re-sanitizing the input — sanitizing is lossy and
 * would mangle a valid on-disk name like "logo (2).png" (created by the
 * dedupe suffix) or any hand-dropped file with parentheses/special characters,
 * leaving its file un-removable and its note un-saveable. Returns null when no
 * such reference exists, so callers no-op safely.
 */
async function matchReference(workspacePath: string, fileName: string): Promise<string | null> {
  const refs = await listReferences(workspacePath);
  return refs.find((r) => r.fileName === fileName)?.fileName ?? null;
}

/** Set (or clear) the founder's note for one reference file. */
export async function setReferenceNote(
  workspacePath: string,
  fileName: string,
  note: string,
): Promise<ReferenceFile[]> {
  const name = await matchReference(workspacePath, fileName);
  if (name !== null) {
    const notes = await readNotes(workspacePath);
    const trimmed = note.trim().slice(0, 280);
    if (trimmed === '') {
      delete notes[name];
    } else {
      notes[name] = trimmed;
    }
    await writeNotes(workspacePath, notes);
  }
  return listReferences(workspacePath);
}

/** Delete one reference file and drop its note. */
export async function removeReference(
  workspacePath: string,
  fileName: string,
): Promise<ReferenceFile[]> {
  const name = await matchReference(workspacePath, fileName);
  if (name !== null) {
    // name is a real base name from references/; resolveWorkspacePath still
    // guards the join. force:true so a concurrent delete isn't an error;
    // recursive:true so an extracted-archive FOLDER is removed too.
    await fs
      .rm(resolveWorkspacePath(workspacePath, `${REFERENCES_DIR}/${name}`), {
        force: true,
        recursive: true,
      })
      .catch(() => undefined);
    const notes = await readNotes(workspacePath);
    if (name in notes) {
      delete notes[name];
      await writeNotes(workspacePath, notes);
    }
  }
  return listReferences(workspacePath);
}

/**
 * The "Reference material" block for a persona's prompt, or '' when the project
 * has no references (so existing prompts stay byte-identical). Best-effort — a
 * read hiccup yields '' and never breaks a turn. Used by the room, whiteboard,
 * and Bullpen engines.
 */
export async function referencesPromptBlock(workspacePath: string): Promise<string> {
  try {
    const refs = await listReferences(workspacePath);
    return buildReferencesPromptBlock(refs, REFERENCES_ABS(workspacePath));
  } catch {
    return '';
  }
}

/* ----- archive extraction (proof-of-concept uploads) ----- */

/** Bounded total byte size of a directory tree (stops at the extracted-entry cap). */
async function dirSizeBounded(absDir: string): Promise<number> {
  let total = 0;
  let count = 0;
  const stack = [absDir];
  while (stack.length > 0 && count < MAX_EXTRACTED_ENTRIES) {
    const cur = stack.pop() as string;
    let ents: Dirent[];
    try {
      ents = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      count++;
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.isFile()) {
        try {
          total += (await fs.stat(p)).size;
        } catch {
          /* ignore an unreadable entry */
        }
      }
    }
  }
  return total;
}

/** Resolve a tool (tar/unzip/7z) to an absolute path via PATH (+ PATHEXT on Windows). */
async function resolveExecutable(name: string): Promise<string | null> {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if ((await fs.stat(candidate)).isFile()) {
          return candidate;
        }
      } catch {
        /* not in this dir */
      }
    }
  }
  return null;
}

/** Run an extraction tool with array args (never a shell string), time-bounded. */
async function runTool(name: string, args: string[]): Promise<{ ok: boolean; missing: boolean }> {
  const exe = await resolveExecutable(name);
  if (exe === null) {
    return { ok: false, missing: true };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ ok, missing: false });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, { windowsHide: true, stdio: 'ignore' });
    } catch {
      resolve({ ok: false, missing: false });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(false);
    }, 120_000);
    child.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });
}

/** Run a listing tool and capture stdout (bounded), for the pre-scan. */
async function runToolCapture(
  name: string,
  args: string[],
): Promise<{ ok: boolean; output: string }> {
  const exe = await resolveExecutable(name);
  if (exe === null) {
    return { ok: false, output: '' };
  }
  return new Promise((resolve) => {
    let settled = false;
    let out = '';
    const finish = (ok: boolean): void => {
      if (!settled) {
        settled = true;
        resolve({ ok, output: out });
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve({ ok: false, output: '' });
      return;
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      if (out.length < 4_000_000) {
        out += chunk.toString('utf8');
      }
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(false);
    }, 60_000);
    child.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });
}

/**
 * Best-effort zip-bomb guard: reject an archive whose LISTING already exceeds the
 * entry/byte caps BEFORE anything is extracted — the post-copy caps still apply, but
 * they used to run only AFTER a full extraction could balloon into the temp dir.
 * tar -tvf covers tar/tgz everywhere and zip via bsdtar (Windows 10+/macOS); an
 * unavailable or unparseable listing returns ok (never a false rejection — the
 * existing post-extract caps remain the backstop).
 */
async function preScanArchive(
  format: ArchiveFormat,
  srcAbs: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (format === '7z') {
    return { ok: true }; // no reliable cross-platform 7z listing parse — post-caps apply
  }
  const r = await runToolCapture('tar', ['-tvf', srcAbs]);
  if (!r.ok || r.output.trim() === '') {
    return { ok: true };
  }
  const lines = r.output.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length > MAX_EXTRACTED_ENTRIES) {
    return { ok: false, reason: `archive has more than ${MAX_EXTRACTED_ENTRIES} files` };
  }
  // tar -tv column 3 (GNU: size; bsdtar: size) — sum what parses as a number.
  let total = 0;
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    const size = Number(cols[2]);
    if (Number.isFinite(size) && size > 0) {
      total += size;
    }
  }
  if (total > MAX_EXTRACTED_BYTES) {
    return {
      ok: false,
      reason: `archive unpacks to more than ${Math.round(MAX_EXTRACTED_BYTES / (1024 * 1024))} MB`,
    };
  }
  return { ok: true };
}

/** Extract the archive into destDir using the platform's tools. */
async function runExtract(
  format: ArchiveFormat,
  srcAbs: string,
  destDir: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (format === 'tar') {
    const r = await runTool('tar', ['-xf', srcAbs, '-C', destDir]);
    return r.ok
      ? { ok: true }
      : {
          ok: false,
          reason: r.missing ? 'tar is not available on this machine' : 'could not extract the tar archive',
        };
  }
  if (format === 'zip') {
    // bsdtar (Windows 10+/macOS) reads zip; GNU tar (Linux) does not — fall back to unzip.
    if ((await runTool('tar', ['-xf', srcAbs, '-C', destDir])).ok) {
      return { ok: true };
    }
    if ((await runTool('unzip', ['-o', '-q', srcAbs, '-d', destDir])).ok) {
      return { ok: true };
    }
    return { ok: false, reason: 'could not extract the zip (need a working tar or unzip)' };
  }
  // 7z — needs a 7-Zip binary on PATH.
  for (const bin of ['7z', '7za', '7zr']) {
    const r = await runTool(bin, ['x', '-y', `-o${destDir}`, srcAbs]);
    if (r.ok) {
      return { ok: true };
    }
    if (!r.missing) {
      return { ok: false, reason: 'could not extract the 7z archive' };
    }
  }
  return { ok: false, reason: 'install 7-Zip (put 7z on PATH) to upload .7z, or re-zip as .zip/.tar' };
}

/**
 * Extract an uploaded archive into references/<stem>/, keeping only safe files
 * (secrets, executables, and dep/build/VCS folders are skipped), under strict size +
 * count caps. The raw archive is never kept. Extraction runs in a throwaway temp dir
 * first; only files whose destination resolves INSIDE references/ are copied
 * (resolveWorkspacePath re-guards every path, defeating zip-slip), and symlinks are
 * never copied. Returns the created folder name, or a reason it was rejected.
 */
async function importArchive(
  workspacePath: string,
  srcAbs: string,
  srcName: string,
  taken: Set<string>,
): Promise<{ ok: true; folder: string } | { ok: false; reason: string }> {
  const format = archiveFormatOf(srcName);
  if (format === null) {
    return { ok: false, reason: 'unsupported archive type' };
  }
  try {
    const st = await fs.stat(srcAbs);
    if (!st.isFile()) {
      return { ok: false, reason: 'not a file' };
    }
    if (st.size > MAX_ARCHIVE_BYTES) {
      return { ok: false, reason: `archive larger than ${Math.round(MAX_ARCHIVE_BYTES / (1024 * 1024))} MB` };
    }
  } catch {
    return { ok: false, reason: 'could not read the archive' };
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nucleus-ref-'));
  const stem = sanitizeReferenceFileName(archiveStemOf(srcName)) || 'archive';
  const folder = uniqueReferenceFileName(stem, taken);
  const destRoot = resolveWorkspacePath(workspacePath, `${REFERENCES_DIR}/${folder}`);
  const cleanupDest = (): Promise<unknown> =>
    fs.rm(destRoot, { recursive: true, force: true }).catch(() => undefined);
  try {
    // Zip-bomb guard: check the DECLARED entry count + total size before extracting —
    // the post-copy caps below only ran after a bomb could balloon into the temp dir.
    const scan = await preScanArchive(format, srcAbs);
    if (!scan.ok) {
      return { ok: false, reason: scan.reason };
    }
    const extracted = await runExtract(format, srcAbs, tmpRoot);
    if (!extracted.ok) {
      return { ok: false, reason: extracted.reason };
    }

    let totalBytes = 0;
    let kept = 0;
    const stack: string[] = [tmpRoot];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      let ents: Dirent[];
      try {
        ents = await fs.readdir(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of ents) {
        const abs = path.join(cur, e.name);
        const rel = path.relative(tmpRoot, abs).split(path.sep).join('/');
        if (e.isSymbolicLink()) {
          continue; // never follow/copy a symlink — it could point outside
        }
        if (e.isDirectory()) {
          if (shouldKeepExtractedDir(rel)) {
            stack.push(abs);
          }
          continue;
        }
        if (!e.isFile() || !shouldKeepExtractedFile(rel)) {
          continue;
        }
        if (kept >= MAX_EXTRACTED_ENTRIES) {
          await cleanupDest();
          return { ok: false, reason: `archive has more than ${MAX_EXTRACTED_ENTRIES} files` };
        }
        let size = 0;
        try {
          size = (await fs.stat(abs)).size;
        } catch {
          continue;
        }
        if (totalBytes + size > MAX_EXTRACTED_BYTES) {
          await cleanupDest();
          return {
            ok: false,
            reason: `archive unpacks to more than ${Math.round(MAX_EXTRACTED_BYTES / (1024 * 1024))} MB`,
          };
        }
        let destAbs: string;
        try {
          destAbs = resolveWorkspacePath(workspacePath, `${REFERENCES_DIR}/${folder}/${rel}`);
        } catch {
          continue; // a path that would escape references/ — skip it
        }
        try {
          await fs.mkdir(path.dirname(destAbs), { recursive: true });
          await fs.copyFile(abs, destAbs);
          totalBytes += size;
          kept += 1;
        } catch {
          /* skip a file we couldn't copy */
        }
      }
    }

    if (kept === 0) {
      await cleanupDest();
      return { ok: false, reason: 'no usable files after filtering (binaries/secrets/dep folders skipped)' };
    }
    return { ok: true, folder };
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
