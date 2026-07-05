/**
 * Functional system roles. A role is what the seat does;
 * a persona (see personas.ts) is who sits in it.
 */
export type RoleId =
  | 'stakeholder'
  | 'architect'
  | 'developer'
  | 'qa'
  | 'security'
  | 'projectLead'
  | 'ops';

// Ordered to follow the run flow: Stakeholder → Project Lead → Architect →
// Developer → QA → Security, then non-chain roles (Ops). Drives the order
// roles render in (enabled-roles list, team cards).
export const ALL_ROLE_IDS: readonly RoleId[] = [
  'stakeholder',
  'projectLead',
  'architect',
  'developer',
  'qa',
  'security',
  'ops',
];

/** When a role re-enters the workflow to review work. */
export type ReviewTrigger =
  | 'afterEachTask'
  | 'afterEachFeature'
  | 'endOfProject'
  | 'manualOnly';

/**
 * Appended to every role's default prompt template. This is the session
 * discipline, addressed to whichever CLI fills the seat: read the
 * batons first, update them last, escalate instead of improvising.
 */
export const WORKSPACE_PROTOCOL = [
  '',
  '',
  'Workspace protocol (applies to every role):',
  '- Before starting, read CURRENT_STATE.md and HANDOFF.md in the workspace root.',
  '- When finished: update CURRENT_STATE.md (max 80 lines), rewrite HANDOFF.md for',
  '  the next role (max 50 lines), and append one line to DONE_LOG.md.',
  '- If you cannot proceed, append an escalation (ESC-NNN) to ESCALATIONS.md, set',
  '  the task status to blocked, and stop. Never work around a blocker silently.',
].join('\n');

export interface RoleDefinition {
  id: RoleId;
  label: string;
  summary: string;
  responsibilities: string[];
  /** Whether the role participates in the default V1 sequential chain. */
  inDefaultChain: boolean;
  /** Position in the default chain (lower runs first). */
  chainOrder: number;
  defaultReviewTrigger: ReviewTrigger;
  defaultPromptTemplate: string;
}

export const ROLE_DEFINITIONS: Record<RoleId, RoleDefinition> = {
  stakeholder: {
    id: 'stakeholder',
    label: 'Stakeholder',
    summary: 'Owns the vision. Translates ambition into a product brief the team can execute.',
    responsibilities: [
      'Clarify the product idea and target users',
      'Define success criteria and non-goals',
      'Produce docs/vision.md for the Project Lead',
      'Keep the narrative investor-safe',
    ],
    inDefaultChain: true,
    chainOrder: 0,
    defaultReviewTrigger: 'endOfProject',
    defaultPromptTemplate: [
      'You are the Stakeholder for the project "{{project_name}}".',
      '',
      'Product idea: {{product_idea}}',
      'Target stack: {{target_stack}}',
      'Constraints: {{constraints}}',
      '',
      'Work ONLY inside {{working_directory}}.',
      'Write or update docs/vision.md with: the problem, the users, the value',
      'proposition, success criteria, explicit non-goals, and open questions.',
      'Be concrete. Avoid filler. End with a short summary for the Project Lead.',
    ].join('\n') + WORKSPACE_PROTOCOL,
  },
  architect: {
    id: 'architect',
    label: 'Architect',
    summary: 'Turns the vision into architecture, epics, features, and tasks with acceptance criteria.',
    responsibilities: [
      'Define architecture and tech stack in docs/',
      'Break work into epics, features, stories, and tasks',
      'Write acceptance criteria per task',
      'Identify technical risks',
      'Re-enter later to check for architecture drift',
    ],
    inDefaultChain: true,
    chainOrder: 2,
    defaultReviewTrigger: 'afterEachFeature',
    defaultPromptTemplate: [
      'You are the Architect for "{{project_name}}".',
      '',
      "Inputs: docs/vision.md, the Project Lead's principal design, and this",
      'summary from the previous role:',
      '{{previous_role_summary}}',
      '',
      'Work ONLY inside {{working_directory}}.',
      'Update docs/architecture.md and docs/tech-stack.md.',
      'Break the product into epics, features, and tasks using agile/scrum',
      'terminology. Write planning/features.md, planning/backlog.md and one',
      'tasks/task-NNN.md per task with: title, description, acceptance',
      'criteria, dependencies, and risk notes.',
      'Target stack: {{target_stack}}. Constraints: {{constraints}}.',
      'End with a handoff summary in handoffs/architect-to-dev.md.',
    ].join('\n') + WORKSPACE_PROTOCOL,
  },
  developer: {
    id: 'developer',
    label: 'Developer',
    summary: 'Implements tasks in the workspace and keeps task Markdown truthful.',
    responsibilities: [
      'Implement tasks inside the project workspace',
      'Update task Markdown state as work progresses',
      'Document changed files, decisions, and blockers',
      'Hand off to QA with clear notes',
    ],
    inDefaultChain: true,
    chainOrder: 3,
    defaultReviewTrigger: 'manualOnly',
    defaultPromptTemplate: [
      'You are the Developer for "{{project_name}}".',
      '',
      'Current task: {{task_id}} — {{task_title}}',
      '{{task_description}}',
      '',
      'Architecture summary: {{architecture_summary}}',
      'Previous role summary: {{previous_role_summary}}',
      '',
      'Work ONLY inside {{working_directory}}.',
      'Implement the task. Update the task file in tasks/ with status,',
      'changed files, decisions made, and any blockers.',
      'When complete, append a handoff entry to handoffs/dev-to-qa.md.',
    ].join('\n') + WORKSPACE_PROTOCOL,
  },
  qa: {
    id: 'qa',
    label: 'QA',
    summary: 'Validates completed work and records pass/fail status with reproducible notes.',
    responsibilities: [
      'Validate tasks or features per the configured trigger',
      'Record bugs, regressions, and validation status',
      'Maintain reviews/qa-review.md',
      'Provide clear pass/fail outcomes',
    ],
    inDefaultChain: true,
    chainOrder: 4,
    defaultReviewTrigger: 'afterEachFeature',
    defaultPromptTemplate: [
      'You are QA for "{{project_name}}". Review trigger: {{review_trigger}}.',
      '',
      'Scope under review: {{feature_name}} {{task_id}}',
      'Developer handoff: {{previous_role_summary}}',
      '',
      'Work ONLY inside {{working_directory}}.',
      'Validate the work against the acceptance criteria in the task files.',
      'Record findings in reviews/qa-review.md with a clear PASS or FAIL',
      'per item, reproduction steps for failures, and severity.',
      'Append a handoff entry to handoffs/qa-to-security.md.',
    ].join('\n') + WORKSPACE_PROTOCOL,
  },
  security: {
    id: 'security',
    label: 'Security',
    summary: 'Reviews trust boundaries with appropriate hostility.',
    responsibilities: [
      'Review secrets handling and configuration',
      'Review auth/session patterns where applicable',
      'Review file access and trust boundaries',
      'Record risks and mitigations in reviews/security-review.md',
    ],
    inDefaultChain: true,
    chainOrder: 5,
    defaultReviewTrigger: 'endOfProject',
    defaultPromptTemplate: [
      'You are the Security reviewer for "{{project_name}}".',
      'Review trigger: {{review_trigger}}.',
      '',
      'QA handoff: {{previous_role_summary}}',
      '',
      'Work ONLY inside {{working_directory}}.',
      'Audit: secrets handling, auth/session patterns if present, file',
      'access boundaries, dependency risks, and trust boundaries.',
      'Assume every input is hostile until proven otherwise.',
      'Record findings in reviews/security-review.md with severity and',
      'concrete mitigations. Do not soften findings.',
    ].join('\n') + WORKSPACE_PROTOCOL,
  },
  projectLead: {
    id: 'projectLead',
    label: 'Project Lead',
    summary: 'Turns the aligned vision into principal design and a phase outline, then hands to the Architect.',
    responsibilities: [
      'Synthesize the Stakeholder vision into a coherent direction',
      'Make principal design decisions and surface open questions',
      'Outline the phases the build will move through',
      'Hand a clear design brief to the Architect',
    ],
    inDefaultChain: true,
    chainOrder: 1,
    defaultReviewTrigger: 'manualOnly',
    defaultPromptTemplate: [
      'You are the Project Lead for "{{project_name}}".',
      '',
      'Stakeholder vision: docs/vision.md',
      'Previous role summary: {{previous_role_summary}}',
      '',
      'Work ONLY inside {{working_directory}}.',
      'Do the ideation and principal design: shape the product direction,',
      'make the key design decisions, and resolve or surface open questions',
      'the Stakeholder may have left. Outline the phases the build will move',
      'through. Record the direction in docs/architecture.md (Overview) and',
      'the phase outline in planning/features.md.',
      'End with a design brief in handoffs/architect-to-dev.md addressed to',
      'the Architect, who will turn it into concrete phases and tasks.',
    ].join('\n') + WORKSPACE_PROTOCOL,
  },
  ops: {
    id: 'ops',
    label: 'Operations',
    summary: 'Coordination and operational stability. Quietly keeps everything running.',
    responsibilities: [
      'Verify workspace structure and hygiene',
      'Track handoff completeness',
      'Maintain run logs and checkpoints',
      'Coordinate between roles without drama',
    ],
    inDefaultChain: true,
    chainOrder: 6,
    defaultReviewTrigger: 'manualOnly',
    defaultPromptTemplate: [
      'You are Operations for "{{project_name}}".',
      '',
      'Work ONLY inside {{working_directory}}.',
      'Verify the workspace structure (docs/, planning/, tasks/, reviews/,',
      'handoffs/) is consistent. Fix broken links between Markdown files,',
      'flag stale task states, and summarize workspace health.',
    ].join('\n') + WORKSPACE_PROTOCOL,
  },
};

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === 'string' && (ALL_ROLE_IDS as string[]).includes(value);
}

export function isReviewTrigger(value: unknown): value is ReviewTrigger {
  return (
    typeof value === 'string' &&
    ['afterEachTask', 'afterEachFeature', 'endOfProject', 'manualOnly'].includes(value)
  );
}

/** Default chain: Stakeholder → Project Lead → Architect → Developer → QA → Security. */
export function defaultChainRoles(): RoleId[] {
  return ALL_ROLE_IDS.filter((id) => ROLE_DEFINITIONS[id].inDefaultChain).sort(
    (a, b) => ROLE_DEFINITIONS[a].chainOrder - ROLE_DEFINITIONS[b].chainOrder,
  );
}
