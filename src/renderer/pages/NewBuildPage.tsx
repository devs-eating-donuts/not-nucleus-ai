import { useState } from 'react';
import { overlaysFor } from '../../shared/blueprints';
import { brandName } from '../../shared/naming';
import { effectivePersonaName } from '../../shared/personas';
import { SCAFFOLDERS, wizardWorkloads, type ScaffoldSpec } from '../../shared/scaffold';
import { activeTemplates } from '../../shared/templates';
import { useAppStore } from '../state/appStore';

type Step = 'start' | 'workload' | 'framework' | 'features' | 'review';
const WIZARD_STEPS: Array<{ id: Step; label: string }> = [
  { id: 'workload', label: 'Workload' },
  { id: 'framework', label: 'Template' },
  { id: 'features', label: 'Features' },
  { id: 'review', label: 'Review' },
];

/** The base toolchain a template's scaffolder needs — surfaced on the template card. */
const prereqHint = (s: ScaffoldSpec): string =>
  s.install.tool === 'dotnet' ? 'Requires the .NET SDK.' : 'Requires Node.js.';

/**
 * The "Define your project" front door. WHAT (single Project vs a Venture) + quick-start
 * templates sit on the first screen; choosing "set up a framework" runs a Visual-Studio-
 * style wizard — workload → framework → features → review → scaffold a real base app the
 * AI team then builds ON. Reused for "Add a project to a Venture" (the kind chooser is
 * hidden when a Venture is preset).
 */
export function NewBuildPage() {
  const startBuildPitch = useAppStore((s) => s.startBuildPitch);
  const navigate = useAppStore((s) => s.navigate);
  const settings = useAppStore((s) => s.settings);
  const namingMode = useAppStore((s) => s.namingMode);
  const presetVenture = useAppStore((s) => s.pendingVenture);

  const [step, setStep] = useState<Step>('start');
  const [kind, setKind] = useState<'single' | 'venture'>('single');
  const [ventureName, setVentureName] = useState('');
  const [workload, setWorkload] = useState<string | null>(null);
  const [scaffoldId, setScaffoldId] = useState<string | null>(null);
  const [overlayIds, setOverlayIds] = useState<string[]>([]);

  // Never hardcode persona/brand names — route through the naming mode (canon/cover/distinct).
  const erlichName = effectivePersonaName(
    'stakeholder',
    settings.roles.stakeholder.personaNameOverride,
    namingMode,
  );
  const monicaName = effectivePersonaName(
    'projectLead',
    settings.roles.projectLead.personaNameOverride,
    namingMode,
  );
  const richardName = effectivePersonaName(
    'architect',
    settings.roles.architect.personaNameOverride,
    namingMode,
  );

  const templates = activeTemplates();
  const workloadGroups = wizardWorkloads();
  const features = overlaysFor(null);

  const needsName = !presetVenture && kind === 'venture' && ventureName.trim() === '';

  const cardStyle = (selected: boolean, disabled = false) => ({
    cursor: disabled ? 'not-allowed' : 'pointer',
    textAlign: 'left' as const,
    width: '100%',
    display: 'block',
    opacity: disabled ? 0.5 : 1,
    border: selected ? '1px solid var(--accent)' : undefined,
  });
  const cta = { color: 'var(--accent)', fontSize: 'var(--font-size-sm)' };

  const resolveVenture = (): { id: string; name: string } | null =>
    presetVenture
      ? presetVenture
      : kind === 'venture' && ventureName.trim() !== ''
        ? { id: crypto.randomUUID(), name: ventureName.trim() }
        : null;

  // Quick-start: a template skips the framework wizard and goes straight to the pitch.
  const pickTemplate = (templateId: string | null) => {
    if (needsName) {
      return;
    }
    startBuildPitch({ venture: resolveVenture(), templateId, scaffoldId: null, overlayIds: [] });
  };

  const finishWizard = () =>
    startBuildPitch({ venture: resolveVenture(), templateId: null, scaffoldId, overlayIds });

  const toggleOverlay = (id: string) =>
    setOverlayIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const frameworks = workloadGroups.find((g) => g.workload === workload)?.items ?? [];

  // Visited steps (index <= current) are clickable to jump back — going back is always
  // safe (selections are preserved); forward steps stay inert until you reach them.
  const currentIndex = WIZARD_STEPS.findIndex((s) => s.id === step);
  const stepper = (
    <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
      {WIZARD_STEPS.map((s, i) => {
        const active = s.id === step;
        const visited = i <= currentIndex;
        return (
          <button
            key={s.id}
            type="button"
            className="field-tag"
            disabled={!visited}
            onClick={() => visited && setStep(s.id)}
            style={{
              background: 'transparent',
              cursor: visited && !active ? 'pointer' : 'default',
              opacity: active ? 1 : visited ? 0.8 : 0.4,
              borderColor: active ? 'var(--accent)' : undefined,
            }}
          >
            {i + 1}. {s.label}
          </button>
        );
      })}
    </div>
  );

  const backBtn = (to: Step) => (
    <button type="button" className="btn" style={{ marginTop: 'var(--space-4)' }} onClick={() => setStep(to)}>
      ← Back
    </button>
  );

  // ---- Step: start (kind + quick-start templates) -------------------------------------
  if (step === 'start') {
    return (
      <div className="section">
        {!presetVenture && (
          <div className="card">
            <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>What are you building?</div>
            <p className="field-hint" style={{ marginBottom: 'var(--space-4)' }}>
              {erlichName}’s incubator holds one bright idea — or a whole empire. Start small;
              you can always add more pieces later.
            </p>
            <div className="card-grid">
              <button
                type="button"
                className="card choose-card"
                style={cardStyle(false)}
                onClick={() => {
                  setKind('single');
                  setStep('workload');
                }}
              >
                <div className="card-title" style={{ marginBottom: 'var(--space-1)' }}>A single app</div>
                <p className="role-flavor">
                  A site, a tool, a quick build. One thing, start to finish — pick a framework next.
                </p>
                <span style={cta}>Build it →</span>
              </button>
              <button type="button" className="card choose-card" style={cardStyle(kind === 'venture')} onClick={() => setKind('venture')}>
                <div className="card-title" style={{ marginBottom: 'var(--space-1)' }}>A bigger product, in pieces</div>
                <p className="role-flavor">Like a SaaS: a site, an API, and more — built one piece at a time.</p>
              </button>
            </div>
            {kind === 'venture' && (
              <div className="field" style={{ marginTop: 'var(--space-4)' }}>
                <label htmlFor="venture-name">Venture name</label>
                <input
                  id="venture-name"
                  value={ventureName}
                  placeholder={`e.g. ${brandName('createdBy', namingMode)}`}
                  autoFocus
                  onChange={(e) => setVentureName(e.target.value)}
                />
                <span className="field-hint">The product as a whole. Name it, then build its first piece.</span>
                <button
                  type="button"
                  className="btn primary"
                  style={{ marginTop: 'var(--space-3)', alignSelf: 'flex-start' }}
                  disabled={needsName}
                  onClick={() => setStep('workload')}
                >
                  Continue →
                </button>
              </div>
            )}
          </div>
        )}

        <div className="card">
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>
            {presetVenture ? `Add a project to ${presetVenture.name}` : 'Or start from a template'}
          </div>
          <p className="field-hint" style={{ marginBottom: 'var(--space-4)' }}>
            {presetVenture
              ? 'Start fast from a template, describe it yourself, or set up a framework.'
              : 'Prefer a ready-made shape? Start fast from a template, or describe it yourself.'}
          </p>
          {needsName && (
            <p className="field-hint" style={{ marginBottom: 'var(--space-3)', color: 'var(--warn)' }}>
              Name your Venture above first.
            </p>
          )}

          <div className="card-grid">
            {templates.map((t) => (
              <button key={t.id} type="button" className="card choose-card" style={cardStyle(false, needsName)} disabled={needsName} onClick={() => pickTemplate(t.id)}>
                <div className="card-title" style={{ marginBottom: 'var(--space-1)' }}>{t.name}</div>
                <p className="role-flavor">{t.description}</p>
                <span style={cta}>Use this →</span>
              </button>
            ))}
            <button type="button" className="card choose-card" style={cardStyle(false, needsName)} disabled={needsName} onClick={() => pickTemplate(null)}>
              <div className="card-title" style={{ marginBottom: 'var(--space-1)' }}>Describe it myself</div>
              <p className="role-flavor">
                No template — start from a blank pitch and let {erlichName}, {monicaName} &amp; {richardName} shape it.
              </p>
              <span style={cta}>Describe it →</span>
            </button>
          </div>

          {presetVenture && (
            <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn primary" onClick={() => setStep('workload')}>
                Set up a framework →
              </button>
              <button type="button" className="btn" onClick={() => navigate('projects')}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- Step: workload -----------------------------------------------------------------
  if (step === 'workload') {
    return (
      <div className="section">
        <div className="card">
          {stepper}
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>What kind of app?</div>
          <p className="field-hint" style={{ marginBottom: 'var(--space-4)' }}>
            Pick the workload — it narrows the frameworks on the next step.
          </p>
          <div className="card-grid">
            {workloadGroups.map((g) => (
              <button
                key={g.workload}
                type="button"
                className="card choose-card"
                style={cardStyle(workload === g.workload)}
                onClick={() => {
                  setWorkload(g.workload);
                  setStep('framework');
                }}
              >
                <div className="card-title" style={{ marginBottom: 'var(--space-1)' }}>{g.workload}</div>
                <p className="role-flavor">
                  {g.items.length} framework{g.items.length === 1 ? '' : 's'}:{' '}
                  {g.items.map((i) => i.label.replace(/\s*\(.*\)$/, '')).join(', ')}
                </p>
                <span style={cta}>Choose →</span>
              </button>
            ))}
          </div>
          {backBtn('start')}
        </div>
      </div>
    );
  }

  // ---- Step: template (concrete scaffolders within the chosen workload) ----------------
  if (step === 'framework') {
    return (
      <div className="section">
        <div className="card">
          {stepper}
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Pick a template</div>
          <p className="field-hint" style={{ marginBottom: 'var(--space-4)' }}>
            We’ll scaffold a real, runnable starter with this — the team builds on it.
          </p>
          <div className="card-grid">
            {frameworks.map((s) => (
              <button
                key={s.id}
                type="button"
                className="card choose-card"
                style={cardStyle(scaffoldId === s.id)}
                onClick={() => {
                  setScaffoldId(s.id);
                  setStep('features');
                }}
              >
                <div className="card-title" style={{ marginBottom: 'var(--space-1)' }}>{s.label}</div>
                <p className="role-flavor">Real, runnable starter + dependencies installed. {prereqHint(s)}</p>
                <span style={cta}>Use this →</span>
              </button>
            ))}
          </div>
          {backBtn('workload')}
        </div>
      </div>
    );
  }

  // ---- Step: features (capability overlays) -------------------------------------------
  if (step === 'features') {
    return (
      <div className="section">
        <div className="card">
          {stepper}
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Add features</div>
          <p className="field-hint" style={{ marginBottom: 'var(--space-4)' }}>
            Optional — these tell the team what to design in. You can change them on the next screen too.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {features.map((f) => (
              <label key={f.id} className="toggle-row" style={{ alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                <input type="checkbox" checked={overlayIds.includes(f.id)} onChange={() => toggleOverlay(f.id)} />
                <span>
                  <strong>{f.name}</strong>
                  <span className="field-hint" style={{ display: 'block' }}>{f.description}</span>
                </span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" className="btn" onClick={() => setStep('framework')}>← Back</button>
            <button type="button" className="btn primary" onClick={() => setStep('review')}>Review →</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Step: review -------------------------------------------------------------------
  const chosenFramework = scaffoldId ? (SCAFFOLDERS[scaffoldId]?.label ?? scaffoldId) : '—';
  const chosenFeatures = overlayIds
    .map((id) => features.find((f) => f.id === id)?.name ?? id)
    .join(', ');
  const venture = resolveVenture();
  return (
    <div className="section">
      <div className="card">
        {stepper}
        <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>Review</div>
        <div className="role-meta" style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <div><strong>Building:</strong> {venture ? `A piece of "${venture.name}"` : 'A single app'}</div>
          <div><strong>Workload:</strong> {workload}</div>
          <div><strong>Framework:</strong> {chosenFramework}</div>
          <div><strong>Features:</strong> {chosenFeatures || 'none'}</div>
        </div>
        <p className="field-hint" style={{ marginTop: 'var(--space-3)' }}>
          Next you’ll name it, pick a folder, and pitch it to {erlichName} — then we generate the base app.
        </p>
        <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" className="btn" onClick={() => setStep('features')}>← Back</button>
          <button type="button" className="btn primary" onClick={finishWizard}>Continue to the pitch →</button>
        </div>
      </div>
    </div>
  );
}
