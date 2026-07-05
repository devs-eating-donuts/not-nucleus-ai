import { useEffect, useState } from 'react';
import { PROMPT_VARIABLES, PROMPT_VARIABLE_DESCRIPTIONS, findUnknownVariables } from '../../shared/prompts';
import { recipesForRole } from '../../shared/recipes';
import type { RoleId } from '../../shared/roles';

interface PromptEditorProps {
  title: string;
  subtitle?: string;
  /** Current saved template. */
  value: string;
  /** Built-in default for "Reset to default". */
  defaultValue: string;
  /** When set, applicable prompt recipes can be inserted. */
  roleId?: RoleId;
  onSave: (next: string) => void;
  onClose: () => void;
}

/**
 * Modal editor for a role prompt template. Edits stay local until Save —
 * nothing writes through while typing, and background updates can never
 * clobber an open draft.
 */
export function PromptEditor({
  title,
  subtitle,
  value,
  defaultValue,
  roleId,
  onSave,
  onClose,
}: PromptEditorProps) {
  const [draft, setDraft] = useState(value);
  const recipes = roleId ? recipesForRole(roleId) : [];

  const insertRecipe = (body: string): void => {
    // Append the recipe to the end of the current draft, separated cleanly.
    setDraft((d) => `${d.replace(/\s+$/, '')}\n\n${body}\n`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const unknown = findUnknownVariables(draft);
  const isDirty = draft !== value;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal prompt-editor"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} prompt template`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="btn sm" onClick={onClose}>
            Close
          </button>
        </div>

        <textarea
          className="prompt-textarea"
          value={draft}
          spellCheck={false}
          aria-label="Prompt template"
          onChange={(e) => setDraft(e.target.value)}
        />

        <div className="prompt-variables">
          {PROMPT_VARIABLES.map((v) => (
            <code key={v} title={PROMPT_VARIABLE_DESCRIPTIONS[v]}>{`{{${v}}}`}</code>
          ))}
        </div>

        {recipes.length > 0 && (
          <div className="prompt-recipes">
            <span className="prompt-recipes-label">Insert recipe:</span>
            {recipes.map((r) => (
              <button
                key={r.id}
                type="button"
                className="recipe-chip"
                title={r.description}
                onClick={() => insertRecipe(r.body)}
              >
                + {r.name}
              </button>
            ))}
          </div>
        )}

        {unknown.length > 0 && (
          <p className="validation-note err">
            Unknown variables: {unknown.map((v) => `{{${v}}}`).join(', ')} — these will not be
            replaced at run time.
          </p>
        )}

        <div className="modal-footer">
          <button type="button" className="btn" onClick={() => setDraft(defaultValue)}>
            Reset to default
          </button>
          <span className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!isDirty}
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
