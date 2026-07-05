import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_REFERENCE_FILES,
  type ReferenceFile,
  type ReferenceKind,
} from '../../shared/references';
import { IconArchive, IconDocument, IconFile, IconImage } from './icons';

interface ReferencesPanelProps {
  /** The project to attach references to (must already exist). */
  projectId: string;
  /** A short line describing why references help here (context-specific). */
  blurb?: string;
}

function KindIcon({ kind }: { kind: ReferenceKind }) {
  const Glyph =
    kind === 'image'
      ? IconImage
      : kind === 'document'
        ? IconDocument
        : kind === 'archive'
          ? IconArchive
          : IconFile;
  return <Glyph size={18} />;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${bytes} B`;
}

/**
 * Founder reference uploads for a project — screenshots, specs, brand assets. The
 * files live in the workspace `references/` folder where the local CLIs read them;
 * this panel just adds/annotates/removes them. Self-contained (talks to
 * window.nucleus.references directly) so it can drop into the setup page and the
 * Rip-it room alike.
 */
export function ReferencesPanel({ projectId, blurb }: ReferencesPanelProps) {
  const [references, setReferences] = useState<ReferenceFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Local note drafts (controlled), so typing doesn't round-trip per keystroke.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const loadedFor = useRef<string | null>(null);

  const syncDrafts = useCallback((refs: ReferenceFile[]) => {
    setReferences(refs);
    setNoteDrafts((prev) => {
      const next: Record<string, string> = {};
      for (const r of refs) {
        next[r.fileName] = prev[r.fileName] ?? r.note;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    loadedFor.current = projectId;
    void (async () => {
      try {
        syncDrafts(await window.nucleus.references.list(projectId));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [projectId, syncDrafts]);

  const onAdd = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await window.nucleus.references.add(projectId);
      syncDrafts(res.references);
      if (res.rejected.length > 0) {
        setNotice(`Skipped: ${res.rejected.join('; ')}`);
      } else if (res.added.length > 0) {
        setNotice(`Added ${res.added.length} file${res.added.length === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async (fileName: string) => {
    const note = noteDrafts[fileName] ?? '';
    const current = references.find((r) => r.fileName === fileName)?.note ?? '';
    if (note === current) {
      return;
    }
    try {
      syncDrafts(await window.nucleus.references.setNote(projectId, fileName, note));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onRemove = async (fileName: string) => {
    setError(null);
    try {
      syncDrafts(await window.nucleus.references.remove(projectId, fileName));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const atLimit = references.length >= MAX_REFERENCE_FILES;

  return (
    <div className="references-panel">
      <p className="field-hint" style={{ marginTop: 0 }}>
        {blurb ??
          'Add screenshots, wireframes, a spec, or brand assets. The team reads these when designing and building — a one-line note on each tells them what it is.'}
      </p>

      {references.length > 0 && (
        <ul className="references-list">
          {references.map((r) => (
            <li key={r.fileName} className="references-item">
              <span className="references-kind" aria-hidden>
                <KindIcon kind={r.kind} />
              </span>
              <div className="references-meta">
                <div className="references-name" title={r.fileName}>
                  {r.fileName}
                  <span className="references-size">{formatSize(r.sizeBytes)}</span>
                </div>
                <input
                  className="references-note"
                  value={noteDrafts[r.fileName] ?? ''}
                  placeholder="What is this? e.g. homepage I want it to look like"
                  maxLength={280}
                  onChange={(e) =>
                    setNoteDrafts((d) => ({ ...d, [r.fileName]: e.target.value }))
                  }
                  onBlur={() => void saveNote(r.fileName)}
                />
              </div>
              <button
                type="button"
                className="btn references-remove"
                title="Remove this reference"
                onClick={() => void onRemove(r.fileName)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="references-actions">
        <button type="button" className="btn" disabled={busy || atLimit} onClick={() => void onAdd()}>
          {busy ? 'Adding…' : references.length === 0 ? 'Add files…' : 'Add more files…'}
        </button>
        <span className="field-hint" style={{ margin: 0 }}>
          {atLimit
            ? `Reference limit reached (${MAX_REFERENCE_FILES}).`
            : 'Images, documents, and archives (PNG, PDF, MD, CSV… plus ZIP/7z/TAR — archives are unpacked into the project so the team can read them, e.g. a proof of concept).'}
        </span>
      </div>

      {notice && (
        <p className="field-hint" style={{ marginTop: 'var(--space-2)' }}>
          {notice}
        </p>
      )}
      {error && <p className="validation-note err">{error}</p>}
    </div>
  );
}
