import type { TaskState } from './markdown';
import { TASK_REQUIRED_SECTIONS, isTaskState } from './markdown';
import type { RoleId } from './roles';
import { isRoleId } from './roles';

/** Per-task dev↔QA iteration budget before escalating to a human (POC: 5). */
export const DEFAULT_ITERATION_BUDGET = 5;

/**
 * What kind of work a task is. 'build' is the default: the developer agent
 * implements it autonomously. 'human-setup' is hands-on work the headless
 * build can't do (interactive logins, cloud accounts, secrets) — the Bullpen
 * hands these to the human with a checklist instead of running an agent.
 */
export type TaskKind = 'build' | 'human-setup';

export function isTaskKind(value: unknown): value is TaskKind {
  return value === 'build' || value === 'human-setup';
}

/**
 * Task file format (tasks/task-NNN.md). Pure string parsing/serialization —
 * no filesystem access here; the main process owns I/O.
 *
 * Canonical shape:
 *
 *   # task-001 — Title
 *
 *   - **Status:** todo
 *   - **Owner:** developer
 *   - **Feature:** Authentication
 *   - **Iterations:** 0/3
 *
 *   ## Goal
 *   ## Prerequisites
 *   ## Acceptance Criteria
 *   ## Verification
 *   ## Notes & Decisions
 *   ## Changed Files
 */

export interface ParsedTaskFile {
  /** e.g. "task-001"; null when the H1 is missing/malformed. */
  id: string | null;
  title: string | null;
  status: TaskState | null;
  owner: RoleId | null;
  feature: string | null;
  /** 'build' (agent implements) or 'human-setup' (Bullpen hands to the human). */
  kind: TaskKind;
  /**
   * True when this task was auto-created to fix a security finding or an
   * exhausted-budget QA gap. Reviewing/failing a remediation task never spawns
   * further remediation — the one-level guard against runaway fix loops.
   */
  isRemediation: boolean;
  iterationsUsed: number;
  iterationBudget: number;
  /** Task ids referenced in the Prerequisites section. */
  prerequisites: string[];
  /** All H2 section names found, in order. */
  sections: string[];
  /** Contract violations (treated as errors by the validator). */
  problems: string[];
  /** Soft issues (treated as warnings by the validator). */
  warnings: string[];
}

const H1_PATTERN = /^#\s+(task-\d+)\s*[—–-]\s*(.+?)\s*$/m;

function fieldPattern(name: string): RegExp {
  return new RegExp(String.raw`^[-*]\s+\*\*${name}:\*\*\s*(.+?)\s*$`, 'im');
}

/** Map of H2 section name → body text (excluding the heading line). */
function sectionMap(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  let current: string | null = null;
  let body: string[] = [];
  const flush = (): void => {
    if (current !== null) {
      map.set(current, body.join('\n').trim());
    }
  };
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1];
      body = [];
    } else if (current !== null) {
      body.push(line);
    }
  }
  flush();
  return map;
}

export function parseTaskFile(content: string): ParsedTaskFile {
  const problems: string[] = [];
  const warnings: string[] = [];

  const h1 = content.match(H1_PATTERN);
  if (!h1) {
    problems.push('Missing or malformed H1 (expected "# task-NNN — Title")');
  }
  const id = h1?.[1] ?? null;
  const title = h1?.[2] ?? null;

  const statusRaw = content.match(fieldPattern('Status'))?.[1]?.trim().toLowerCase() ?? null;
  let status: TaskState | null = null;
  if (statusRaw === null) {
    problems.push('Missing Status field');
  } else if (!isTaskState(statusRaw)) {
    problems.push(`Invalid status "${statusRaw}"`);
  } else {
    status = statusRaw;
  }

  const ownerRaw = content.match(fieldPattern('Owner'))?.[1]?.trim() ?? null;
  let owner: RoleId | null = null;
  if (ownerRaw === null) {
    warnings.push('Missing Owner field');
  } else if (!isRoleId(ownerRaw)) {
    warnings.push(`Owner "${ownerRaw}" is not a known role id`);
  } else {
    owner = ownerRaw;
  }

  const feature = content.match(fieldPattern('Feature'))?.[1]?.trim() ?? null;

  // 'Kind' is optional; absent means a normal build task.
  const kindRaw = content.match(fieldPattern('Kind'))?.[1]?.trim().toLowerCase() ?? null;
  const kind: TaskKind = isTaskKind(kindRaw) ? kindRaw : 'build';

  // 'Remediation' is optional; present-and-true marks an auto-created fix task.
  const isRemediation =
    (content.match(fieldPattern('Remediation'))?.[1]?.trim().toLowerCase() ?? '') === 'true';

  let iterationsUsed = 0;
  let iterationBudget = DEFAULT_ITERATION_BUDGET;
  const iterationsRaw = content.match(fieldPattern('Iterations'))?.[1] ?? null;
  if (iterationsRaw === null) {
    warnings.push(`Missing Iterations field (assuming 0/${DEFAULT_ITERATION_BUDGET})`);
  } else {
    const parsed = iterationsRaw.match(/(\d+)\s*\/\s*(\d+)/);
    if (parsed) {
      iterationsUsed = Number.parseInt(parsed[1], 10);
      iterationBudget = Number.parseInt(parsed[2], 10);
    } else {
      warnings.push(`Unreadable Iterations value "${iterationsRaw}" (assuming 0/${DEFAULT_ITERATION_BUDGET})`);
    }
  }

  const sectionsMap = sectionMap(content);
  const sections = [...sectionsMap.keys()];
  for (const required of TASK_REQUIRED_SECTIONS) {
    if (!sectionsMap.has(required)) {
      problems.push(`Missing required section "## ${required}"`);
    }
  }

  const prerequisitesBody = sectionsMap.get('Prerequisites') ?? '';
  const prerequisites = [...new Set(prerequisitesBody.match(/task-\d+/g) ?? [])];

  return {
    id,
    title,
    status,
    owner,
    feature,
    kind,
    isRemediation,
    iterationsUsed,
    iterationBudget,
    prerequisites,
    sections,
    problems,
    warnings,
  };
}

function taskIdFromNumber(taskNumber: number): string {
  return `task-${String(taskNumber).padStart(3, '0')}`;
}

/** Body text of a single H2 section (e.g. "Manual Steps"), or '' if absent. */
export function getTaskSectionBody(content: string, section: string): string {
  return sectionMap(content).get(section) ?? '';
}

export interface AcceptanceCriterion {
  /** Stable id, e.g. "AC1" — explicit when present, else assigned by order. */
  id: string;
  text: string;
}

/**
 * Acceptance criteria from a task file, each with a stable [ACn] id (legacy
 * criteria with no explicit id get one assigned by order). QA verdicts each id
 * individually so a task "pass" means every criterion was actually checked.
 */
export function extractAcceptanceCriteria(content: string): AcceptanceCriterion[] {
  const body = getTaskSectionBody(content, 'Acceptance Criteria');
  const out: AcceptanceCriterion[] = [];
  let auto = 0;
  for (const line of body.split(/\r?\n/)) {
    const item = line.match(/^\s*[-*]\s+\[[ xX]?\]\s+(.*)$/);
    if (!item) {
      continue;
    }
    auto += 1;
    const rest = item[1].trim();
    const idMatch = rest.match(/^\*{0,2}\[(AC\d+)\]\*{0,2}\s*(.*)$/i);
    const id = idMatch ? idMatch[1].toUpperCase() : `AC${auto}`;
    const text = (idMatch ? idMatch[2] : rest).trim();
    if (text !== '') {
      out.push({ id, text });
    }
  }
  return out;
}

export interface CreateTaskInput {
  number: number;
  title: string;
  owner: RoleId;
  feature?: string;
  goal: string;
  /** Task ids this task depends on; empty means "none". */
  prerequisites?: string[];
  acceptanceCriteria: string[];
  verification?: string;
  iterationBudget?: number;
  /** Defaults to 'build'. 'human-setup' tasks are handed to the human. */
  kind?: TaskKind;
  /** Ordered manual commands/steps for a 'human-setup' task. */
  manualSteps?: string[];
  /** Marks an auto-created fix task (security finding / exhausted QA gap). */
  remediation?: boolean;
}

export function createTaskFileContent(input: CreateTaskInput): string {
  const id = taskIdFromNumber(input.number);
  const prereqLines =
    input.prerequisites && input.prerequisites.length > 0
      ? input.prerequisites.map((p) => `- ${p}`)
      : ['- none'];
  // Stable [ACn] ids so QA can verdict each criterion individually (covered /
  // gap / n-a) instead of one PASS/FAIL for the whole task.
  const criteria =
    input.acceptanceCriteria.length > 0
      ? input.acceptanceCriteria.map((c, i) => `- [ ] **[AC${i + 1}]** ${c}`)
      : ['- [ ] **[AC1]** _To be defined._'];
  const kind: TaskKind = input.kind ?? 'build';
  // A human-setup task carries the ordered checklist the person runs by hand.
  const manualStepsBlock =
    kind === 'human-setup'
      ? [
          '## Manual Steps',
          '',
          'Hands-on setup the autonomous build can\'t do — run these yourself, then mark the task done:',
          '',
          ...(input.manualSteps && input.manualSteps.length > 0
            ? input.manualSteps.map((s, i) => `${i + 1}. ${s}`)
            : ['1. _Steps to be defined._']),
          '',
        ]
      : [];
  return [
    `# ${id} — ${input.title}`,
    '',
    `- **Status:** todo`,
    `- **Owner:** ${input.owner}`,
    ...(input.feature ? [`- **Feature:** ${input.feature}`] : []),
    ...(kind === 'human-setup' ? [`- **Kind:** human-setup`] : []),
    ...(input.remediation ? [`- **Remediation:** true`] : []),
    `- **Iterations:** 0/${input.iterationBudget ?? DEFAULT_ITERATION_BUDGET}`,
    '',
    '## Goal',
    '',
    input.goal,
    '',
    ...manualStepsBlock,
    '## Prerequisites',
    '',
    ...prereqLines,
    '',
    '## Acceptance Criteria',
    '',
    ...criteria,
    '',
    '## Verification',
    '',
    input.verification ?? '_How to prove the acceptance criteria are met._',
    '',
    '## Notes & Decisions',
    '',
    '_Updated by the owner while working._',
    '',
    '## Changed Files',
    '',
    '_None yet._',
    '',
  ].join('\n');
}

/** Surgical status replacement; throws if the file has no Status field. */
export function setTaskStatus(content: string, status: TaskState): string {
  const pattern = fieldPattern('Status');
  if (!pattern.test(content)) {
    throw new Error('Task file has no Status field to update');
  }
  return content.replace(pattern, `- **Status:** ${status}`);
}

/** Bump the used-iteration counter; throws if the field is missing. */
export function incrementTaskIterations(content: string): string {
  const pattern = fieldPattern('Iterations');
  const match = content.match(pattern);
  const counts = match?.[1]?.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match || !counts) {
    throw new Error('Task file has no readable Iterations field');
  }
  const used = Number.parseInt(counts[1], 10) + 1;
  return content.replace(pattern, `- **Iterations:** ${used}/${counts[2]}`);
}
