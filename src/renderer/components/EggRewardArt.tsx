/**
 * The secret-image rewards of the Pipey trivia hunt — original art in the
 * Pipey flat-outline house style (docs/design/character-modes.md):
 *   clue 1 → the 5.2 Weissman readout · clue 2 → a small blunt ·
 *   clue 3 → a shield, then Jian Yang wakes, then the 🌭 hot dog.
 * Decoration/reward, never breadcrumbs.
 */

const OUTLINE = '#24352c';

export function Weissman52({ width = 130 }: { width?: number }) {
  return (
    <svg width={width} viewBox="0 0 120 96" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A Weissman score of 5.2">
      <rect x="10" y="6" width="100" height="84" rx="10" fill="#e3eee8" stroke={OUTLINE} strokeWidth="2.4" />
      {/* gauge, pinned past the theoretical limit */}
      <path d="M34 42 A26 26 0 0 1 86 42" stroke="#c2d8cc" strokeWidth="6" strokeLinecap="round" />
      <path d="M63 16.2 A26 26 0 0 1 86 42" stroke="#309e4a" strokeWidth="6" strokeLinecap="round" />
      <line x1="60" y1="42" x2="79" y2="24" stroke={OUTLINE} strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="42" r="3.4" fill={OUTLINE} />
      <text x="60" y="72" textAnchor="middle" fontSize="24" fontWeight="700" fill={OUTLINE}>
        5.2
      </text>
      <text x="60" y="84" textAnchor="middle" fontSize="7.5" letterSpacing="2" fill="#6d8880">
        WEISSMAN
      </text>
    </svg>
  );
}

export function Blunt({ width = 130 }: { width?: number }) {
  return (
    <svg width={width} viewBox="0 0 120 96" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A small blunt">
      {/* smoke */}
      <path d="M90 36 C95 30 86 26 91 19 C94 14.5 90 12 92 8" stroke="#69a6a1" strokeWidth="2.2" strokeLinecap="round" opacity="0.75" />
      <path d="M99 42 C102 38 97 35 100 30" stroke="#69a6a1" strokeWidth="1.8" strokeLinecap="round" opacity="0.55" />
      {/* body, slightly tilted */}
      <g transform="rotate(-14 60 58)">
        <rect x="22" y="52" width="62" height="13" rx="6.5" fill="#8a6b47" stroke={OUTLINE} strokeWidth="2.4" />
        <rect x="40" y="52" width="9" height="13" fill="#a3835c" stroke={OUTLINE} strokeWidth="1.6" />
        {/* ember tip */}
        <ellipse cx="86" cy="58.5" rx="6" ry="6.5" fill="#e8843a" stroke={OUTLINE} strokeWidth="2" />
        <circle cx="86" cy="58.5" r="2.6" fill="#d94f30" />
      </g>
    </svg>
  );
}

export function EggShield({ width = 110 }: { width?: number }) {
  return (
    <svg width={width} viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A shield">
      <path
        d="M48 8 L78 18 L78 46 C78 66 64 79 48 86 C32 79 18 66 18 46 L18 18 Z"
        fill="#077068"
        stroke={OUTLINE}
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      {/* right half in the brand green */}
      <path d="M48 8 L78 18 L78 46 C78 66 64 79 48 86 Z" fill="#309e4a" />
      {/* keyhole */}
      <circle cx="48" cy="40" r="7.5" fill="#f1e9d2" stroke={OUTLINE} strokeWidth="2" />
      <path d="M45 45 L44 60 L52 60 L51 45 Z" fill="#f1e9d2" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function Shrimp({ width = 40 }: { width?: number }) {
  return (
    <svg width={width} viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A shrimp">
      {/* antennae */}
      <path d="M64 34 C74 26 82 26 88 20" stroke="#c65a44" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <path d="M64 38 C76 34 84 36 90 34" stroke="#c65a44" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      {/* curled coral body */}
      <path
        d="M64 34 C44 22 20 34 20 54 C20 72 38 82 56 78 C50 74 44 70 43 62 C56 66 66 60 64 46 C63 40 64 36 64 34 Z"
        fill="#f2937a"
        stroke={OUTLINE}
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path d="M30 52 C31 66 42 74 52 75" stroke="#f7b6a3" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* segment stripes */}
      <path d="M27 40 C31 44 34 47 34 54" stroke={OUTLINE} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M23 48 C28 52 31 55 31 62" stroke={OUTLINE} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M24 60 C29 63 33 66 35 71" stroke={OUTLINE} strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* tail fan */}
      <path d="M56 78 L70 72 L68 82 L60 84 Z" fill="#f2937a" stroke={OUTLINE} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M63 76 L64 83" stroke={OUTLINE} strokeWidth="1.6" strokeLinecap="round" />
      {/* legs + eye */}
      <path d="M46 64 L47 70" stroke="#c65a44" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M51 65 L53 71" stroke="#c65a44" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="58" cy="42" r="2.4" fill={OUTLINE} />
    </svg>
  );
}

export function HotDog({ width = 140 }: { width?: number }) {
  return (
    <svg width={width} viewBox="0 0 120 96" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A hot dog">
      {/* back bun */}
      <rect x="16" y="34" width="88" height="22" rx="11" fill="#e8bc82" stroke={OUTLINE} strokeWidth="2.4" />
      {/* sausage, poking out both ends */}
      <rect x="8" y="44" width="104" height="17" rx="8.5" fill="#bf4f38" stroke={OUTLINE} strokeWidth="2.4" />
      {/* mustard squiggle */}
      <path
        d="M20 52 Q27 44 34 52 T48 52 T62 52 T76 52 T90 52 T100 52"
        stroke="#f2c230"
        strokeWidth="4.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* front bun */}
      <rect x="16" y="60" width="88" height="19" rx="9.5" fill="#dfa96b" stroke={OUTLINE} strokeWidth="2.4" />
    </svg>
  );
}

/** The one show-likeness beat of the hunt: Jian Yang's takeover portrait
 * (already a tracked private-build asset). Resolved via glob so a missing
 * file degrades to nothing instead of breaking the build. */
const jianYangArt = import.meta.glob('../assets/personas/distinct/jian-yang.*', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

export function JianYangWakes({ size = 96 }: { size?: number }) {
  const src = Object.values(jianYangArt)[0];
  if (!src) {
    return null;
  }
  return (
    <img
      className="egg-jian-yang"
      src={src}
      alt="Jian Yang"
      style={{ width: size, height: size }}
    />
  );
}
