export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
}

export type ThemeId = 'nucleus-night' | 'clarity-cloud' | 'series-b-fever-dream';

export const THEMES: ThemeDefinition[] = [
  {
    id: 'nucleus-night',
    name: 'Nucleus Night',
    tagline: 'Default. Dark. Demo-ready.',
  },
  {
    id: 'clarity-cloud',
    name: 'Clarity Cloud',
    tagline: 'Light theme for daylight standups.',
  },
  {
    id: 'series-b-fever-dream',
    name: 'Series B Fever Dream',
    tagline: 'Scaling confidence beyond evidence.',
  },
];

export const DEFAULT_THEME: ThemeId = 'nucleus-night';

/** Global UI scale (multiplies the root font size; all rem sizes follow). */
export const UI_SCALE_OPTIONS = [
  { value: 0.9, label: '90%' },
  { value: 1, label: '100%' },
  { value: 1.1, label: '110%' },
  { value: 1.25, label: '125%' },
] as const;

export const DEFAULT_UI_SCALE = 1;
export const MIN_UI_SCALE = 0.8;
export const MAX_UI_SCALE = 1.5;

/** Clamp any persisted/IPC value to a sane scale; bad input → default. */
export function clampUiScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_UI_SCALE;
  }
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, value));
}

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === 'string' &&
    THEMES.some((t) => t.id === value)
  );
}
