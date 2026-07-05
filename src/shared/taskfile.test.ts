import { describe, expect, it } from 'vitest';
import {
  createTaskFileContent,
  extractAcceptanceCriteria,
  getTaskSectionBody,
  incrementTaskIterations,
  parseTaskFile,
  setTaskStatus,
} from './taskfile';

describe('extractAcceptanceCriteria', () => {
  it('assigns stable [ACn] ids in createTaskFileContent and reads them back', () => {
    const md = createTaskFileContent({
      number: 1, title: 'X', owner: 'developer', goal: 'g',
      acceptanceCriteria: ['builds clean', 'tests pass'],
    });
    expect(extractAcceptanceCriteria(md)).toEqual([
      { id: 'AC1', text: 'builds clean' },
      { id: 'AC2', text: 'tests pass' },
    ]);
  });
  it('assigns ids by order to legacy criteria with no explicit [ACn]', () => {
    const md = '# task-001 — X\n\n## Acceptance Criteria\n\n- [ ] first\n- [x] second\n';
    expect(extractAcceptanceCriteria(md)).toEqual([
      { id: 'AC1', text: 'first' },
      { id: 'AC2', text: 'second' },
    ]);
  });
});

describe('createTaskFileContent + parseTaskFile', () => {
  it('round-trips a normal build task with defaults', () => {
    const md = createTaskFileContent({
      number: 2,
      title: 'Build the contact form',
      owner: 'developer',
      goal: 'A working contact form.',
      acceptanceCriteria: ['Form posts', 'Email arrives'],
    });
    const p = parseTaskFile(md);
    expect(p.id).toBe('task-002');
    expect(p.status).toBe('todo');
    expect(p.kind).toBe('build');
    expect(p.owner).toBe('developer');
    expect(p.problems).toEqual([]);
    expect(md).not.toMatch(/\*\*Kind:\*\*/);
    expect(getTaskSectionBody(md, 'Manual Steps')).toBe('');
  });

  it('round-trips a human-setup task with a Manual Steps checklist', () => {
    const md = createTaskFileContent({
      number: 1,
      title: 'Bootstrap Terraform Cloud + Azure SP',
      owner: 'ops',
      feature: 'Infra',
      goal: 'Provision cloud bootstrap.',
      acceptanceCriteria: ['Workspace exists'],
      kind: 'human-setup',
      manualSteps: ['Run `az login`.', 'Create the service principal.'],
    });
    const p = parseTaskFile(md);
    expect(p.kind).toBe('human-setup');
    expect(p.problems).toEqual([]);
    const steps = getTaskSectionBody(md, 'Manual Steps');
    expect(steps).toMatch(/az login/);
    expect(steps).toMatch(/service principal/);
  });

  it('defaults missing Kind to build', () => {
    const md = createTaskFileContent({
      number: 3,
      title: 'X',
      owner: 'developer',
      goal: 'g',
      acceptanceCriteria: ['a'],
    });
    expect(parseTaskFile(md).kind).toBe('build');
  });

  it('round-trips the Remediation marker (auto-created fix tasks)', () => {
    const md = createTaskFileContent({
      number: 7,
      title: 'Fix (high): missing CSRF token',
      owner: 'developer',
      feature: 'Auth',
      goal: 'g',
      acceptanceCriteria: ['The finding is remediated'],
      remediation: true,
    });
    expect(md).toMatch(/\*\*Remediation:\*\* true/);
    expect(parseTaskFile(md).isRemediation).toBe(true);
  });

  it('a normal task is not remediation and emits no Remediation field', () => {
    const md = createTaskFileContent({
      number: 1, title: 'X', owner: 'developer', goal: 'g', acceptanceCriteria: ['a'],
    });
    expect(md).not.toMatch(/\*\*Remediation:\*\*/);
    expect(parseTaskFile(md).isRemediation).toBe(false);
  });
});

describe('setTaskStatus + incrementTaskIterations', () => {
  const base = createTaskFileContent({
    number: 1,
    title: 'T',
    owner: 'developer',
    goal: 'g',
    acceptanceCriteria: ['a'],
  });

  it('replaces the status field', () => {
    expect(parseTaskFile(setTaskStatus(base, 'verified')).status).toBe('verified');
  });

  it('bumps the used iteration count', () => {
    const once = incrementTaskIterations(base);
    expect(parseTaskFile(once).iterationsUsed).toBe(1);
    expect(parseTaskFile(incrementTaskIterations(once)).iterationsUsed).toBe(2);
  });

  it('throws when there is no Iterations field', () => {
    expect(() => incrementTaskIterations('# task-001 — T\n\nno fields')).toThrow();
  });
});
