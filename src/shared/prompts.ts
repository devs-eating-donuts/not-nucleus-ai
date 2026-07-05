/**
 * Prompt template system. Templates are plain strings with
 * {{variable}} placeholders, rendered by simple string substitution —
 * no expression evaluation, no code execution, ever.
 */

import { ROLE_DEFINITIONS } from './roles';
import type { RoleId } from './roles';

export const PROMPT_VARIABLES = [
  'project_name',
  'product_idea',
  'feature_name',
  'task_id',
  'task_title',
  'task_description',
  'working_directory',
  'architecture_summary',
  'previous_role_summary',
  'constraints',
  'target_stack',
  'execution_mode',
  'review_trigger',
] as const;

export type PromptVariable = (typeof PROMPT_VARIABLES)[number];

export const PROMPT_VARIABLE_DESCRIPTIONS: Record<PromptVariable, string> = {
  project_name: 'Name of the project being built',
  product_idea: 'The product idea entered for the run',
  feature_name: 'Feature currently in scope, when applicable',
  task_id: 'Task identifier, e.g. task-003',
  task_title: 'Title of the current task',
  task_description: 'Description of the current task',
  working_directory: 'Absolute path of the project workspace',
  architecture_summary: 'Summary of the current architecture docs',
  previous_role_summary: 'Structured summary handed off by the previous role',
  constraints: 'Run constraints entered by the user',
  target_stack: 'Target technology stack for the run',
  execution_mode: 'Execution mode for this role (prompted / autopilot / …)',
  review_trigger: 'When this role re-enters the run to review',
};

/** Map of variable name → value. Missing values leave placeholders intact. */
export type PromptVariableValues = Partial<Record<PromptVariable, string>> &
  Record<string, string | undefined>;

const VARIABLE_PATTERN = String.raw`\{\{\s*([a-zA-Z0-9_]+)\s*\}\}`;

/**
 * Render a template by substituting {{variable}} placeholders.
 * - Pure string replacement; replacement values are never interpreted
 *   (the replacer-function form of String.replace is immune to `$`
 *   substitution patterns in values).
 * - Unknown or missing variables are left as-is so gaps stay visible
 *   instead of silently disappearing.
 */
export function renderTemplate(template: string, variables: PromptVariableValues): string {
  return template.replace(new RegExp(VARIABLE_PATTERN, 'g'), (match, name: string) => {
    const value = variables[name];
    return typeof value === 'string' ? value : match;
  });
}

/** Distinct variable names referenced by a template, in order of first use. */
export function findTemplateVariables(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(new RegExp(VARIABLE_PATTERN, 'g'))) {
    names.add(match[1]);
  }
  return [...names];
}

/** Variables referenced by a template that are not part of the known set. */
export function findUnknownVariables(template: string): string[] {
  const known = new Set<string>(PROMPT_VARIABLES);
  return findTemplateVariables(template).filter((name) => !known.has(name));
}

const CUSTOM_PROMPT_HEADER = 'ADDITIONAL INSTRUCTIONS FOR THIS ROLE (configured by the operator):';

/**
 * The operator's customized prompt for a role, rendered with the run's
 * variables and wrapped as an "additional instructions" block — or '' when the
 * template is blank or still the built-in default.
 *
 * Engines (rooms, whiteboard, bullpen) append this to their own base prompt
 * rather than replacing it: the tuned persona voice and the operational safety
 * rails (output format, "never start a dev server", …) always stay, and the
 * user's edits layer on top. Because an UNEDITED template returns '', default
 * runs are byte-identical to before this was wired in — no behavior change
 * unless the operator actually customized the prompt in the editor.
 */
export function renderCustomRolePrompt(
  roleId: RoleId,
  promptTemplate: string | undefined,
  variables: PromptVariableValues,
): string {
  const tpl = (promptTemplate ?? '').trim();
  if (tpl === '') {
    return '';
  }
  if (tpl === ROLE_DEFINITIONS[roleId].defaultPromptTemplate.trim()) {
    return '';
  }
  const rendered = renderTemplate(promptTemplate as string, variables).trim();
  return rendered === '' ? '' : `\n\n${CUSTOM_PROMPT_HEADER}\n${rendered}`;
}
