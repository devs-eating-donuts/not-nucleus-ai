import { activeTemplates, disabledTemplates } from '../../shared/templates';
import { PROMPT_RECIPES } from '../../shared/recipes';
import { ROLE_DEFINITIONS } from '../../shared/roles';
import type { RoleId } from '../../shared/roles';
import { StatusBadge } from '../components/StatusBadge';

function roleLabels(roles: RoleId[]): string {
  return roles.map((r) => ROLE_DEFINITIONS[r].label).join(', ');
}

export function TemplatesPage() {
  const disabled = disabledTemplates();
  return (
    <div className="section">
      <div className="section-heading">
        <h2>Project archetypes</h2>
        <span className="section-note">Starter shapes the founder picks at project creation</span>
      </div>
      <div className="card-grid">
        {activeTemplates().map((t) => (
          <div key={t.id} className="card template-card">
            <div className="role-card-top">
              <div className="role-persona">{t.name}</div>
              <StatusBadge tone="info" label="Built-in" dot={false} />
            </div>
            <p style={{ marginTop: 6 }}>{t.description}</p>
            <div className="template-stack">
              {t.suggestedStack.map((s) => (
                <code key={s}>{s}</code>
              ))}
            </div>
            <div className="role-meta" style={{ marginTop: 10 }}>
              <span>Default team: {roleLabels(t.defaultEnabledRoles)}</span>
            </div>
          </div>
        ))}
      </div>

      {disabled.length > 0 && (
        <>
          <div className="section-heading" style={{ marginTop: 'var(--space-5)' }}>
            <h2>Disabled templates</h2>
            <span className="section-note">
              Parked, not deleted — their definitions and blueprint depth are kept. Hidden from
              the New Project picker for now; re-enable them one at a time as their tooling lands.
            </span>
          </div>
          <div className="disabled-template-grid">
            {disabled.map((t) => (
              <div key={t.id} className="card disabled-template-card" title={t.description}>
                <span className="disabled-template-name">{t.name}</span>
                <StatusBadge tone="neutral" label="Disabled" dot={false} />
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-heading" style={{ marginTop: 'var(--space-5)' }}>
        <h2>Prompt recipes</h2>
        <span className="section-note">
          Reusable instruction snippets — insert them into a role’s prompt from the team editor
        </span>
      </div>
      <div className="card-grid">
        {PROMPT_RECIPES.map((r) => (
          <div key={r.id} className="card template-card">
            <div className="role-card-top">
              <div className="role-persona">{r.name}</div>
              <StatusBadge tone="info" label="Recipe" dot={false} />
            </div>
            <p style={{ marginTop: 6 }}>{r.description}</p>
            <div className="role-meta" style={{ marginTop: 10 }}>
              <span>
                For: {r.appliesTo === 'all' ? 'Any role' : roleLabels(r.appliesTo)}
              </span>
            </div>
            <details className="recipe-body-wrap">
              <summary>Preview</summary>
              <p className="recipe-body">{r.body}</p>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
