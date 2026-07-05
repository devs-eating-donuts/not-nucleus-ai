const OUTLINE = '#24352c';

/** One plumeria-ish blossom: five petals around a small center. */
function Blossom({ cx, cy, r, petal, center }: { cx: number; cy: number; r: number; petal: string; center: string }) {
  const petals = Array.from({ length: 5 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    return (
      <ellipse
        key={i}
        cx={cx + Math.cos(a) * r * 0.75}
        cy={cy + Math.sin(a) * r * 0.75}
        rx={r * 0.62}
        ry={r * 0.45}
        transform={`rotate(${(a * 180) / Math.PI} ${cx + Math.cos(a) * r * 0.75} ${cy + Math.sin(a) * r * 0.75})`}
        fill={petal}
        stroke={OUTLINE}
        strokeWidth="1.6"
      />
    );
  });
  return (
    <g>
      {petals}
      <circle cx={cx} cy={cy} r={r * 0.34} fill={center} stroke={OUTLINE} strokeWidth="1.4" />
    </g>
  );
}

/**
 * A lei — the Hawaiian flower garland, hung somewhere in the incubator after
 * the first crack (Bachmanity Insanity was a luau; see shared/easterEggs.ts).
 * Original art in the Pipey flat-outline house style.
 */
export function LeiMark({ size = 40 }: { size?: number }) {
  // Blossoms strung along a draped U-curve, alternating colors like a real lei.
  const spots = [
    { x: 14, y: 22 },
    { x: 20, y: 40 },
    { x: 31, y: 54 },
    { x: 48, y: 60 },
    { x: 65, y: 54 },
    { x: 76, y: 40 },
    { x: 82, y: 22 },
  ];
  const colors = [
    { petal: '#e88bb0', center: '#f2c230' },
    { petal: '#f1e9d2', center: '#e88bb0' },
    { petal: '#c46be0', center: '#f2c230' },
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 84"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A lei"
    >
      {/* string */}
      <path d="M14 22 C22 52 36 62 48 62 C60 62 74 52 82 22" stroke="#69a6a1" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      {/* leaves tucked between blossoms */}
      <ellipse cx="26" cy="30" rx="6" ry="3" transform="rotate(55 26 30)" fill="#309e4a" stroke={OUTLINE} strokeWidth="1.4" />
      <ellipse cx="40" cy="58" rx="6" ry="3" transform="rotate(10 40 58)" fill="#309e4a" stroke={OUTLINE} strokeWidth="1.4" />
      <ellipse cx="58" cy="58" rx="6" ry="3" transform="rotate(-10 58 58)" fill="#309e4a" stroke={OUTLINE} strokeWidth="1.4" />
      <ellipse cx="71" cy="30" rx="6" ry="3" transform="rotate(-55 71 30)" fill="#309e4a" stroke={OUTLINE} strokeWidth="1.4" />
      {spots.map((s, i) => (
        <Blossom key={i} cx={s.x} cy={s.y} r={8.5} petal={colors[i % 3].petal} center={colors[i % 3].center} />
      ))}
    </svg>
  );
}
