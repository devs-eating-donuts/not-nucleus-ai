import { useState } from 'react';
import type { CliAssignment } from '../../shared/cli';
import { CLI_PRESETS, qaSeatReliabilityHint, seatThinkingAdvice } from '../../shared/cli';
import { assignmentFromPreset } from '../../shared/cliAssignment';
import { COVER_PREFIX } from '../../shared/naming';
import { defaultPersonaForRole, effectivePersonaName } from '../../shared/personas';
import { ROLE_DEFINITIONS } from '../../shared/roles';
import type { RoleConfiguration } from '../../shared/settings';
import type { RoleValidationResult } from '../../shared/validation';
import { VALIDATION_STATUS_LABELS } from '../../shared/validation';
import { useAppStore } from '../state/appStore';
import { PersonaAvatar } from './PersonaAvatar';
import { PromptEditor } from './PromptEditor';
import { StatusBadge } from './StatusBadge';

interface RoleConfigCardProps {
  config: RoleConfiguration;
  /** Apply a change to this role (writes to the global or project team). */
  onPatch: (patch: Partial<RoleConfiguration>) => void;
  /** Latest validation result for this role, if any. */
  validation: RoleValidationResult | undefined;
  /** Validate just this role. */
  onValidate: () => void;
  /** Whether a validation is currently running. */
  isValidating: boolean;
}

/**
 * One role as a full-width collapsible "roster card with a headshot"
 * (owner-designed layout, v1 sign-off S15/S16): the header carries chevron ·
 * role title · status badge; the body splits into a portrait column (large
 * mode-aware avatar + editable persona name) and a config column (the three
 * primary dropdowns in one horizontal row, then the actions row).
 *
 * Primary fields (Assigned CLI / Model / Thinking level) are always shown; the
 * power-user fields (Executable / Default arguments) live behind "Advanced
 * settings". The review-trigger and execution-mode controls were removed — they
 * were never wired into the lifecycle (the per-run cadence knobs are the real
 * control), so showing them only misled.
 */
export function RoleConfigCard({
  config,
  onPatch,
  validation,
  onValidate,
  isValidating,
}: RoleConfigCardProps) {
  const namingMode = useAppStore((s) => s.namingMode);
  const def = ROLE_DEFINITIONS[config.roleId];
  const persona = defaultPersonaForRole(config.roleId);
  const assignment = config.assignment;
  // Shown in the rename field: the override if set, else the naming-mode name.
  // Clearing the field reverts to following the mode (override → null).
  const displayName = effectivePersonaName(config.roleId, config.personaNameOverride, namingMode);
  // "Legally Questionable" names ("NOT Richard Hendricks") overflow the portrait
  // column — split the fig-leaf onto its own line above the name. Typing a rename
  // replaces the whole name (override), which drops the eyebrow: consistent.
  const notPrefixed = displayName.startsWith(COVER_PREFIX);
  const nameFieldValue = notPrefixed ? displayName.slice(COVER_PREFIX.length) : displayName;

  const [open, setOpen] = useState(true);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Local text for args: splitting on every keystroke would eat the
  // separator spaces while typing. Store stays the source of truth on save.
  const [argsText, setArgsText] = useState(assignment?.defaultArgs.join(' ') ?? '');

  const patchRole = (patch: Partial<RoleConfiguration>) => onPatch(patch);

  const patchAssignment = (patch: Partial<CliAssignment>) => {
    if (assignment) {
      patchRole({ assignment: { ...assignment, ...patch } });
    }
  };

  const onPresetChange = (presetId: string) => {
    if (presetId === '') {
      patchRole({ assignment: null });
      setArgsText('');
      return;
    }
    const next = assignmentFromPreset(presetId);
    patchRole({ assignment: next });
    setArgsText(next?.defaultArgs.join(' ') ?? '');
  };

  const onArgsChange = (text: string) => {
    setArgsText(text);
    const trimmed = text.trim();
    patchAssignment({ defaultArgs: trimmed === '' ? [] : trimmed.split(/\s+/) });
  };

  // A live validation result wins over the static configured/unconfigured
  // badge; an 'unverified' result (nothing to validate) falls through.
  let statusBadge = <StatusBadge tone="warn" label="Not assigned" />;
  if (assignment) {
    statusBadge =
      assignment.command.trim() === '' ? (
        <StatusBadge tone="error" label="No executable" />
      ) : (
        <StatusBadge tone="info" label="Configured · unverified" />
      );
  }
  if (validation && validation.status !== 'unverified') {
    statusBadge = (
      <StatusBadge
        tone={validation.status === 'ready' ? 'ok' : 'error'}
        label={VALIDATION_STATUS_LABELS[validation.status]}
      />
    );
  }

  const noteTone =
    validation?.status === 'ready' ? 'ok' : validation?.status === 'unverified' ? 'muted' : 'err';

  const selectedPresetId = assignment ? (assignment.presetId ?? 'custom') : '';

  // The assignment stores a CLONE of the preset's capabilities from assign time and is
  // never re-synced — prefer the live preset's model/thinking lists so a catalog update
  // (e.g. Codex gaining minimal/xhigh) reaches existing seats without re-picking the CLI.
  // Mirrors the validation precedence in thinkingArgsFor (cli.ts).
  const livePresetCaps = CLI_PRESETS.find((p) => p.id === assignment?.presetId)?.capabilities;
  const modelOptions = livePresetCaps?.supportedModels ?? assignment?.capabilities.supportedModels;
  const thinkingOptions =
    livePresetCaps?.supportedThinkingLevels ?? assignment?.capabilities.supportedThinkingLevels;
  const fieldId = (suffix: string) => `${config.roleId}-${suffix}`;
  // Advisory: warn when the QA seat uses a stall-prone PTY CLI (agy) — it can background
  // long checks without ever emitting a verdict. Never blocks the choice.
  const qaPreset = assignment ? CLI_PRESETS.find((p) => p.id === selectedPresetId) : undefined;
  const qaHint = config.roleId === 'qa' && qaPreset ? qaSeatReliabilityHint(qaPreset) : '';
  // Advisory: the seat's suggested thinking level for THIS role + CLI, grounded in the live
  // builds' own timing data (deep for autonomous dev, middle for reviews, Default for chat).
  const thinkingAdvice = assignment
    ? seatThinkingAdvice(
        config.roleId,
        qaPreset ?? CLI_PRESETS.find((p) => p.id === selectedPresetId),
        assignment.capabilities,
        assignment.defaultThinkingLevel,
      )
    : null;
  const toggleOpen = () => setOpen((o) => !o);

  return (
    <section className={`role-panel${open ? ' open' : ''}`}>
      <div
        className="role-panel-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggleOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleOpen();
          }
        }}
      >
        <svg
          className="panel-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span className="role-title role-title-header">{def.label}</span>
        <span className="role-panel-spacer" />
        {statusBadge}
      </div>

      {open && (
        <div className="role-panel-body">
          <div className="role-panel-columns">
            <div className="role-portrait-col">
              <PersonaAvatar personaId={persona?.id} name={displayName} size={120} headFocus />
              {notPrefixed && <span className="persona-not-eyebrow">NOT</span>}
              <input
                className="inline-input persona-name-input"
                aria-label={`${def.label} persona name`}
                title="Rename this seat. Clear it to follow the naming mode."
                value={nameFieldValue}
                onChange={(e) =>
                  patchRole({
                    personaNameOverride: e.target.value.trim() === '' ? null : e.target.value,
                  })
                }
              />
            </div>

            <div className="role-config-col">
              {persona && <p className="role-flavor">{persona.flavor}</p>}

              <div className="role-config-row">
                <div className="field">
              <label htmlFor={fieldId('preset')}>Assigned CLI</label>
              <select
                id={fieldId('preset')}
                value={selectedPresetId}
                onChange={(e) => onPresetChange(e.target.value)}
              >
                <option value="">Not assigned</option>
                {CLI_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.cliName}
                  </option>
                ))}
              </select>
              {qaHint && <span className="field-hint qa-reliability-hint">⚠ {qaHint}</span>}
            </div>

            {assignment && (
              <>
                {assignment.capabilities.supportsModelSelection && (
                  <div className="field">
                    <label htmlFor={fieldId('model')}>Model</label>
                    {modelOptions?.length ? (
                      <select
                        id={fieldId('model')}
                        value={assignment.defaultModel ?? ''}
                        onChange={(e) =>
                          patchAssignment({ defaultModel: e.target.value || undefined })
                        }
                      >
                        <option value="">CLI default</option>
                        {modelOptions.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={fieldId('model')}
                        value={assignment.defaultModel ?? ''}
                        placeholder="CLI default"
                        onChange={(e) =>
                          patchAssignment({ defaultModel: e.target.value || undefined })
                        }
                      />
                    )}
                  </div>
                )}

                {assignment.capabilities.supportsThinkingLevel && (
                  <div className="field">
                    <label htmlFor={fieldId('thinking')}>Thinking level</label>
                    {thinkingOptions?.length ? (
                      <select
                        id={fieldId('thinking')}
                        value={assignment.defaultThinkingLevel ?? ''}
                        onChange={(e) =>
                          patchAssignment({
                            defaultThinkingLevel: e.target.value || undefined,
                          })
                        }
                      >
                        <option value="">CLI default</option>
                        {thinkingOptions.map((level) => (
                          <option key={level} value={level}>
                            {level}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={fieldId('thinking')}
                        value={assignment.defaultThinkingLevel ?? ''}
                        placeholder="CLI default"
                        onChange={(e) =>
                          patchAssignment({
                            defaultThinkingLevel: e.target.value || undefined,
                          })
                        }
                      />
                    )}
                    {thinkingAdvice && <span className="field-hint">💡 {thinkingAdvice.why}</span>}
                  </div>
                )}

              </>
            )}
              </div>

              {assignment && showAdvanced && (
                <div className="role-config-row">
                  <div className="field">
                    <label htmlFor={fieldId('command')}>Executable</label>
                    <input
                      id={fieldId('command')}
                      value={assignment.command}
                      placeholder="command or full path"
                      onChange={(e) => patchAssignment({ command: e.target.value })}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor={fieldId('args')}>Default arguments</label>
                    <input
                      id={fieldId('args')}
                      value={argsText}
                      placeholder="space-separated"
                      onChange={(e) => onArgsChange(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {!assignment && (
                <span className="field-hint">
                  Assign a CLI to put {displayName} to work.
                </span>
              )}

              <div className="validation-row">
                {assignment && (
                  <button
                    type="button"
                    className="btn sm"
                    aria-expanded={showAdvanced}
                    onClick={() => setShowAdvanced((s) => !s)}
                  >
                    {showAdvanced ? 'Advanced settings ▾' : 'Advanced settings ▸'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setShowPromptEditor(true)}
                >
                  Edit Prompt
                </button>
                {assignment && (
                  <button
                    type="button"
                    className="btn sm"
                    disabled={isValidating}
                    onClick={() => onValidate()}
                  >
                    Validate
                  </button>
                )}
                {validation && (
                  <span
                    className={`validation-note ${noteTone}`}
                    title={`Checked ${new Date(validation.checkedAt).toLocaleString()}`}
                  >
                    {validation.message}
                    {validation.version ? ` — ${validation.version}` : ''}
                  </span>
                )}
              </div>
            </div>
          </div>

          {showPromptEditor && (
            <PromptEditor
              title={`${displayName} — ${def.label} prompt`}
              subtitle="Filled with {{variables}} at run time; unknown placeholders stay visible."
              value={config.promptTemplate}
              defaultValue={def.defaultPromptTemplate}
              roleId={config.roleId}
              onSave={(promptTemplate) => patchRole({ promptTemplate })}
              onClose={() => setShowPromptEditor(false)}
            />
          )}
        </div>
      )}
    </section>
  );
}
