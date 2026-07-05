import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TEMPLATES,
  activeTemplates,
  disabledTemplates,
  getTemplateById,
} from './templates';

describe('templates', () => {
  it('the active templates are the two lean options (deep blueprints parked)', () => {
    expect(activeTemplates().map((t) => t.id)).toEqual(['static-site', 'poc']);
  });

  it('active + disabled partition the full catalog with no overlap', () => {
    const active = activeTemplates();
    const disabled = disabledTemplates();
    expect(active.length + disabled.length).toBe(BUILT_IN_TEMPLATES.length);
    const ids = new Set([...active, ...disabled].map((t) => t.id));
    expect(ids.size).toBe(BUILT_IN_TEMPLATES.length);
    expect(disabled.every((t) => t.disabled)).toBe(true);
    expect(active.every((t) => !t.disabled)).toBe(true);
  });

  it('active order preserves the catalog order', () => {
    const catalogOrder = BUILT_IN_TEMPLATES.filter((t) => !t.disabled).map((t) => t.id);
    expect(activeTemplates().map((t) => t.id)).toEqual(catalogOrder);
  });

  it('getTemplateById still resolves a disabled template (existing projects keep working)', () => {
    const dash = getTemplateById('dashboard');
    expect(dash?.disabled).toBe(true);
    expect(dash?.name).toBe('Internal Dashboard / CRUD Tool');
  });
});
