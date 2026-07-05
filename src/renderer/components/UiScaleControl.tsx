import { UI_SCALE_OPTIONS } from '../../shared/theme';
import { useAppStore } from '../state/appStore';

export function UiScaleControl() {
  const uiScale = useAppStore((s) => s.uiScale);
  const setUiScale = useAppStore((s) => s.setUiScale);

  // A custom-clamped value (e.g. hand-edited settings.json) still renders:
  // show it as an extra option instead of silently snapping the select.
  const isKnown = UI_SCALE_OPTIONS.some((o) => o.value === uiScale);

  return (
    <select
      aria-label="UI scale"
      title="UI scale"
      value={String(uiScale)}
      onChange={(e) => setUiScale(Number.parseFloat(e.target.value))}
    >
      {!isKnown && <option value={String(uiScale)}>{Math.round(uiScale * 100)}%</option>}
      {UI_SCALE_OPTIONS.map((o) => (
        <option key={o.value} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
