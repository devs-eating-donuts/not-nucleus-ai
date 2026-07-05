interface PipeyMarkProps {
  /** Rendered width in px; height follows the 96:130 aspect. */
  size?: number;
}

/**
 * Pipey — the original Nucleus-AI pipe-character helper. A legally-distinct
 * riff in the Pied Piper palette: teal beanie with a pom-pom (no feathered
 * hat), mitten hands, no tongue. He is the always-visible trigger for the
 * trivia hunt (shared/easterEggs.ts), so this art must stay original — never
 * show art.
 */
export function PipeyMark({ size = 44 }: PipeyMarkProps) {
  return (
    <svg
      width={size}
      height={Math.round((size * 130) / 96)}
      viewBox="0 -2 96 130"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Pipey"
    >
      {/* floating notes */}
      <g stroke="#2cc5b8" strokeWidth="2" strokeLinecap="round" fill="#2cc5b8">
        <ellipse cx="14" cy="26" rx="3.2" ry="2.4" transform="rotate(-20 14 26)" />
        <path d="M17 25 L17 12" fill="none" />
        <path d="M17 12 Q23 14 21.5 19" fill="none" />
      </g>
      <g stroke="#5fd07c" strokeWidth="1.6" strokeLinecap="round" fill="#5fd07c">
        <ellipse cx="26" cy="12" rx="2.4" ry="1.8" transform="rotate(-20 26 12)" />
        <path d="M28.2 11.2 L28.2 3.5" fill="none" />
      </g>

      {/* body: slim pipe with a flared bell foot */}
      <path
        d="M39 18
           C39 11 43 8.5 48 8.5
           C53 8.5 57 11 57 18
           L57 92
           C57 99 61 104 63 109
           C64.5 112.5 62 115.5 58.5 115.5
           L37.5 115.5
           C34 115.5 31.5 112.5 33 109
           C35 104 39 99 39 92
           Z"
        fill="#f1e9d2"
        stroke="#24352c"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      {/* soft body shading stripe */}
      <path d="M53 16 L53 94 C53 99 55 104 57 108" stroke="#ddd0ac" strokeWidth="3" strokeLinecap="round" />

      {/* sound holes */}
      <circle cx="48" cy="62" r="2.6" fill="#2a3d33" />
      <circle cx="48" cy="72" r="2.6" fill="#2a3d33" />
      <circle cx="48" cy="82" r="2.6" fill="#2a3d33" />
      <circle cx="48" cy="92" r="2.2" fill="#2a3d33" />

      {/* arms + mitten hands */}
      <path d="M39 54 C30 52 24 46 22 38" stroke="#077068" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="21" cy="35.5" r="4.6" fill="#309e4a" stroke="#24352c" strokeWidth="2" />
      <path d="M57 56 C66 58 70 63 71.5 69" stroke="#077068" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="72.5" cy="71.5" r="4.6" fill="#309e4a" stroke="#24352c" strokeWidth="2" />

      {/* googly eyes (bulging past the body on purpose) */}
      <circle cx="42" cy="31" r="5.6" fill="#ffffff" stroke="#24352c" strokeWidth="2" />
      <circle cx="54.5" cy="29.5" r="6.2" fill="#ffffff" stroke="#24352c" strokeWidth="2" />
      <circle cx="43.6" cy="32" r="2.4" fill="#24352c" />
      <circle cx="56" cy="30.8" r="2.6" fill="#24352c" />

      {/* smile */}
      <path d="M43.5 44 Q48 48.5 52.5 44" stroke="#24352c" strokeWidth="2.2" strokeLinecap="round" fill="none" />

      {/* teal beanie, tilted, with a pom-pom */}
      <g transform="rotate(-8 48 10)">
        <path
          d="M37 13 C37 4.5 59 4.5 59 13 L59 14 L37 14 Z"
          fill="#077068"
          stroke="#24352c"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <rect x="34.5" y="12.5" width="27" height="6.5" rx="3.2" fill="#065a54" stroke="#24352c" strokeWidth="2" />
        <circle cx="48" cy="4" r="3.6" fill="#5fd07c" stroke="#24352c" strokeWidth="2" />
      </g>
    </svg>
  );
}
