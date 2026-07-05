interface NucleusMarkProps {
  size?: number;
}

/**
 * Original Nucleus-AI emblem (concept "Refined nucleus"): a geometric nucleus
 * with two crossed electron orbits, doubling as a monogram "N" axis, with a
 * blue and a green electron. Inherits theme colors via CSS variables; the Fever
 * Dream theme adds a glow via --logo-glow. The standalone app-icon version
 * (assets/icon.svg) uses the same geometry with fixed nucleus-night colors.
 */
export function NucleusMark({ size = 28 }: NucleusMarkProps) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Nucleus-AI logo"
    >
      {/* Orbits */}
      <ellipse
        cx="32"
        cy="32"
        rx="26"
        ry="11"
        transform="rotate(-32 32 32)"
        stroke="var(--accent)"
        strokeWidth="2.6"
      />
      <ellipse
        cx="32"
        cy="32"
        rx="26"
        ry="11"
        transform="rotate(32 32 32)"
        stroke="var(--text-secondary)"
        strokeWidth="2.2"
        opacity="0.5"
      />
      {/* Monogram axis — the diagonal stroke of an "N" */}
      <line
        x1="23"
        y1="45"
        x2="41"
        y2="19"
        stroke="var(--text-primary)"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      {/* Nucleus core */}
      <circle cx="32" cy="32" r="6" fill="var(--accent)" />
      <circle cx="32" cy="32" r="2.3" fill="var(--accent-contrast)" />
      {/* Electrons — one accent-strong, one green */}
      <circle cx="12" cy="23" r="2.6" fill="var(--accent-strong)" />
      <circle cx="52" cy="41" r="2.6" fill="var(--accent-2)" />
    </svg>
  );
}
