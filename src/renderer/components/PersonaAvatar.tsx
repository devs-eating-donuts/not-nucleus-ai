import type { NamingMode } from '../../shared/naming';
import { useAppStore } from '../state/appStore';

/**
 * A persona's portrait for the team/chat cards, keyed by persona id and the
 * active naming mode. The public-safe `pete` cast ships as plaintext SVG
 * (glob-imported below). The show-likeness tiers are NOT in the bundle as
 * viewable images — they live in the encrypted image vault and are decrypted
 * into `decryptedPortraits` only once a tier's scavenger-hunt clue is cracked
 * (the answer IS the key — shared/imageVault.ts, services/personaVault.ts):
 *   - pete     → `personas/pete/<id>.svg`          (original avatars, always shown)
 *   - distinct → decryptedPortraits[`cartoons/<id>`]  (cartoon set)
 *   - cover    → decryptedPortraits[`<id>`]           (real photos)
 *   - canon    → decryptedPortraits[`<id>`]           (real photos)
 * Anything not yet decrypted (uncracked tier) falls back to an initials chip.
 */
const portraits = import.meta.glob(
  [
    '../assets/personas/*.{png,jpg,jpeg,webp,svg}',
    '../assets/personas/*/*.{png,jpg,jpeg,webp,svg}',
  ],
  { eager: true, import: 'default' },
) as Record<string, string>;

// Key by the path after `personas/`, minus extension: "richard-henderstack" or
// "cover/richard-henderstack" or "distinct/richard-henderstack".
const PORTRAITS: Record<string, string> = {};
for (const [path, url] of Object.entries(portraits)) {
  const after = path.split('/personas/')[1] ?? '';
  const key = after.replace(/\.(png|jpe?g|webp|svg)$/i, '');
  if (key) {
    PORTRAITS[key] = url;
  }
}

/** Where the face sits in a portrait (as % of the shown cover-crop window),
 * how far to zoom toward it, and — for tall images — where to point the crop
 * window itself (oy: vertical object-position %, default 50 = centered).
 * Sliding the window up via oy costs nothing (no gap risk), so a high face
 * gets centered with a GENTLE zoom instead of a face-cropping one. */
interface PortraitFocus {
  x: number;
  y: number;
  z: number;
  /** Crop-window bias (object-position %, default 50/50 = centered). Free
   * travel with no gap risk — the right tool for off-center faces in wide
   * shots (ox) and high faces in tall shots (oy). */
  ox?: number;
  oy?: number;
}

/** Eyeballed per-photo face framing for the canon stills (they're all
 * composed differently — Jack sits hard left, the five main-team portraits
 * carry high faces, Gilfoyle is near center). Calibrated so the whole head is
 * visible + centered; the good zoom range is ~1.4–1.8 (Big Head's wide office
 * shot is the one legitimate big zoom). */
const CANON_FOCUS: Record<string, PortraitFocus> = {
  'richard-henderstack': { x: 55, y: 30, z: 1.7, oy: 0 },
  'erlich-bachlund': { x: 39, y: 33, z: 1.7, oy: 0 },
  'monica-hallmark': { x: 55, y: 42, z: 1.45, oy: 0 },
  'jared-dunnison': { x: 40, y: 36, z: 1.6, oy: 0 },
  'dinesh-chugbyte': { x: 58, y: 37, z: 1.5, oy: 0 },
  'gilfoyle-zerotrust': { x: 47, y: 40, z: 1.5 },
  'bighead-bignetti': { x: 47, y: 22, z: 2.6 },
  'gavin-belch': { x: 50, y: 30, z: 1.8 },
  'peter-gregorix': { x: 53, y: 43, z: 1.4 },
  'russ-hanneford': { x: 50, y: 40, z: 1.4 },
  'laurie-bramwell': { x: 47, y: 33, z: 1.6 },
  'jack-barkley': { x: 47, y: 42, z: 1.25, ox: 18 },
  'ron-laflambe': { x: 53, y: 38, z: 1.45 },
};

/** The cartoons are uniformly composed (big centered head). */
const CARTOON_FOCUS: PortraitFocus = { x: 50, y: 36, z: 1.4 };

/** The real Jian Yang photo (takeover, photo modes) — a landscape still, face
 * upper-center. Tunable via the same left/right/zoom loop as the cast. */
const JIAN_YANG_PHOTO_FOCUS: PortraitFocus = { x: 48, y: 32, z: 1.55, oy: 0 };

/** Anything unmapped (per-persona distinct art, hand-dropped files). */
const DEFAULT_FOCUS: PortraitFocus = { x: 50, y: 35, z: 1.5 };

interface ResolvedPortrait {
  src: string;
  focus: PortraitFocus;
}

function portraitFor(
  personaId: string,
  mode: NamingMode,
  decrypted: Record<string, string>,
): ResolvedPortrait | undefined {
  if (mode === 'pete') {
    // The public-safe original cast: only its own art (plaintext SVG), never a
    // show likeness. Focus is irrelevant — pete art is pre-framed and never zoomed.
    const src = PORTRAITS[`pete/${personaId}`];
    return src ? { src, focus: DEFAULT_FOCUS } : undefined;
  }
  // Show-likeness tiers: the art is decrypted from the vault (decryptedPortraits)
  // once the tier's clue is cracked — nothing here exists as plaintext in the bundle.
  if (mode === 'distinct') {
    // Per-persona distinct art first (jian-yang), then the cartoon set.
    if (decrypted[`distinct/${personaId}`]) {
      return { src: decrypted[`distinct/${personaId}`], focus: DEFAULT_FOCUS };
    }
    if (decrypted[`cartoons/${personaId}`]) {
      return { src: decrypted[`cartoons/${personaId}`], focus: CARTOON_FOCUS };
    }
  }
  // The real photo (decrypted under the cover tier) — canon and cover both wear
  // the real faces, and it is the fallback for any gap in the other sets.
  const src = decrypted[personaId];
  return src ? { src, focus: CANON_FOCUS[personaId] ?? DEFAULT_FOCUS } : undefined;
}

/**
 * The Jian Yang takeover face for the active mode: the real photo in the photo
 * modes (cover / canon) — so he matches the real cast around him — and the
 * cartoon in the drawn modes (pete stickers / distinct cartoons). Falls back to
 * whichever asset exists; undefined only if neither ships (then no takeover).
 */
function takeoverPortrait(
  mode: NamingMode,
  decrypted: Record<string, string>,
): ResolvedPortrait | undefined {
  const photo = decrypted['distinct/jian-yang-photo'];
  const cartoon = decrypted['distinct/jian-yang'];
  const wantsPhoto = mode === 'cover' || mode === 'canon';
  if (wantsPhoto && photo) {
    return { src: photo, focus: JIAN_YANG_PHOTO_FOCUS };
  }
  if (cartoon) {
    return { src: cartoon, focus: DEFAULT_FOCUS };
  }
  return photo ? { src: photo, focus: JIAN_YANG_PHOTO_FOCUS } : undefined;
}

/**
 * Center the face: with the image cover-cropped at center, the face sits at
 * (x%, y%) of the box; scale(z) translate(d) moves it to dead center. The
 * translate is clamped to the travel the zoom actually affords per axis
 * (±50·(z−1)/z), so an extreme focal point can never drag an image edge into
 * view — worst case the face ends near-center instead of past a gap.
 */
function zoomStyle({ x, y, z, ox, oy }: PortraitFocus): React.CSSProperties {
  const maxShift = (50 * (z - 1)) / z;
  const clamp = (v: number) => Math.max(-maxShift, Math.min(maxShift, v));
  const dx = clamp(50 - x);
  const dy = clamp(50 - y);
  return {
    objectPosition: `${ox ?? 50}% ${oy ?? 50}%`,
    transform: `scale(${z}) translate(${dx}%, ${dy}%)`,
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface PersonaAvatarProps {
  /** Persona id — used to find `<id>.png` in assets/personas. */
  personaId: string | null | undefined;
  /** Display name; drives the initials fallback and the alt text. */
  name: string;
  /** Square pixel size. Defaults to 36. */
  size?: number;
  /**
   * Tighter, head-focused crop for chat surfaces (like a messaging app's
   * sender avatar) — zooms in on the face of the same portrait.
   */
  headFocus?: boolean;
}

export function PersonaAvatar({ personaId, name, size = 36, headFocus = false }: PersonaAvatarProps) {
  const namingMode = useAppStore((s) => s.namingMode);
  const jianYangAwake = useAppStore((s) => s.settings.jianYangAwake);
  // Decrypted show-likeness portraits (empty until a tier's clue is cracked).
  const decrypted = useAppStore((s) => s.decryptedPortraits);
  // The company takeover (the status-bar hot dog, post-hunt): every seat wears
  // Jian Yang's face. It's MODE-AWARE so his face matches the mode's aesthetic —
  // the real photo in the photo modes (cover/canon), the cartoon in the drawn
  // modes (pete stickers / distinct cartoons).
  const takeoverArt = takeoverPortrait(namingMode, decrypted);
  const takeover = jianYangAwake && takeoverArt ? true : false;
  const portrait = personaId
    ? takeover
      ? takeoverArt
      : portraitFor(personaId, namingMode, decrypted)
    : undefined;
  const style = { width: size, height: size, flexShrink: 0 } as const;
  // The pete cast is pre-framed sticker art (its own disc + outline + full
  // composition) — zooming into it would crop the design, so head-focus only
  // applies to raster art (photos, cartoons, and the takeover portrait).
  const zoom = headFocus && (takeover || namingMode !== 'pete');
  // Head-focused image: a clipped circular frame holding a zoomed portrait
  // centered on the photo's actual face, so we show "more head" — dead center —
  // without needing a second, separately-cropped file.
  if (portrait && zoom) {
    return (
      <span className="persona-avatar persona-avatar-frame" style={style} title={name}>
        <img
          className="persona-avatar-zoom"
          src={portrait.src}
          alt={name}
          style={zoomStyle(portrait.focus)}
        />
      </span>
    );
  }
  if (portrait) {
    return <img className="persona-avatar" src={portrait.src} alt={name} style={style} />;
  }
  return (
    <div className="persona-avatar persona-avatar-fallback" style={style} title={name} aria-hidden="true">
      {initials(name)}
    </div>
  );
}
