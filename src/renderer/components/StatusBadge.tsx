export type BadgeTone = 'ok' | 'warn' | 'error' | 'info' | 'neutral';

interface StatusBadgeProps {
  tone: BadgeTone;
  label: string;
  /** Render the little pulse dot before the label. */
  dot?: boolean;
}

export function StatusBadge({ tone, label, dot = true }: StatusBadgeProps) {
  return (
    <span className={`badge tone-${tone}`}>
      {dot && <span className="badge-dot" />}
      {label}
    </span>
  );
}
