import { describe, expect, it } from 'vitest';
import type { ComposedBlueprint } from './blueprints';
import type { SecurityFinding } from './bullpenPlan';
import {
  classifyFinding,
  deriveDecisionsFromBlueprint,
  inferDeploymentPosture,
  partitionFindings,
  renderDecisionsBlock,
  sanitizeDecisions,
  type Decisions,
} from './decisions';

const composed: ComposedBlueprint = {
  intakeQuestions: [],
  decisions: [
    { id: 'auth', prompt: 'Which auth provider?', options: [{ key: 'A', label: 'Clerk' }], recommend: 'A' },
    { id: 'db', prompt: 'Which database?', options: [{ key: 'B', label: 'Postgres' }], recommend: 'B' },
  ],
  securityRules: [],
  envVars: [],
  dataEntities: [],
  acceptanceCriteria: [],
  nonGoals: [],
  localServices: [],
  buildTools: [],
};

const finding = (severity: SecurityFinding['severity'], description: string): SecurityFinding => ({
  severity,
  description,
});

const local: Decisions = {
  schemaVersion: 1,
  deploymentPosture: 'local-single-user',
  decisions: [],
  acceptedDescopes: [],
};
const publicPosture: Decisions = { ...local, deploymentPosture: 'public-internet' };
const multiTenant: Decisions = { ...local, deploymentPosture: 'multi-tenant' };

describe('inferDeploymentPosture', () => {
  it('infers a permissive posture ONLY for a rip-it throwaway', () => {
    expect(inferDeploymentPosture({ ripIt: true })).toBe('local-single-user');
  });
  it('infers multi-tenant for the multi-tenant SaaS archetypes', () => {
    expect(inferDeploymentPosture({ templateId: 'saas' })).toBe('multi-tenant');
    expect(inferDeploymentPosture({ templateId: 'saas-ai-budget' })).toBe('multi-tenant');
    expect(inferDeploymentPosture({ templateId: 'personal-finance' })).toBe('multi-tenant');
  });
  it('defaults every other project to the STRICT end (never silently permissive)', () => {
    // a scaffolder/wizard project is templateId:null → must default strict, so an un-set
    // posture never suppresses a finding; the founder downgrades explicitly.
    expect(inferDeploymentPosture({ templateId: null })).toBe('public-internet');
    expect(inferDeploymentPosture({ templateId: 'static-site' })).toBe('public-internet');
    expect(inferDeploymentPosture({})).toBe('public-internet');
  });
});

describe('deriveDecisionsFromBlueprint', () => {
  it('records each decision at its recommended option + the posture + descopes', () => {
    const d = deriveDecisionsFromBlueprint(composed, 'local-single-user');
    expect(d.schemaVersion).toBe(1);
    expect(d.deploymentPosture).toBe('local-single-user');
    expect(d.decisions).toEqual([
      { id: 'auth', chosen: 'A', prompt: 'Which auth provider?' },
      { id: 'db', chosen: 'B', prompt: 'Which database?' },
    ]);
    expect(d.acceptedDescopes[0]).toMatch(/single-user, localhost/i);
  });
  it('has no descopes for a strict posture', () => {
    expect(deriveDecisionsFromBlueprint(composed, 'public-internet').acceptedDescopes).toEqual([]);
  });
});

describe('sanitizeDecisions', () => {
  it('round-trips a valid artifact', () => {
    const d = deriveDecisionsFromBlueprint(composed, 'multi-tenant');
    expect(sanitizeDecisions(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
  it('rejects an unknown schema, a bad posture, and non-objects', () => {
    expect(sanitizeDecisions({ schemaVersion: 2, deploymentPosture: 'local-single-user' })).toBeNull();
    expect(sanitizeDecisions({ schemaVersion: 1, deploymentPosture: 'nonsense' })).toBeNull();
    expect(sanitizeDecisions(null)).toBeNull();
    expect(sanitizeDecisions('x')).toBeNull();
  });
  it('filters junk decision rows without throwing', () => {
    const out = sanitizeDecisions({
      schemaVersion: 1,
      deploymentPosture: 'internal',
      decisions: [{ id: 'auth', chosen: 'A' }, { chosen: 'B' }, 42, null],
      acceptedDescopes: ['keep', 5],
    });
    expect(out?.decisions).toEqual([{ id: 'auth', chosen: 'A', prompt: undefined }]);
    expect(out?.acceptedDescopes).toEqual(['keep']);
  });
});

// The heart of the posture gate: does a finding become advisory or a real remediation task?
// These pin the exact cases the classifier is meant to handle.
describe('classifyFinding', () => {
  it('advisory: network-auth findings under an approved local-single-user posture', () => {
    expect(classifyFinding(finding('critical', 'The API has zero authentication — anyone can call it'), local)).toBe('advisory');
    expect(classifyFinding(finding('high', 'No frontend auth guard on the dashboard route'), local)).toBe('advisory');
    expect(classifyFinding(finding('high', 'Possible IDOR: /accounts/:id has no ownership check'), local)).toBe('advisory');
  });

  it('REMEDIATE: data-at-rest / secret / injection findings ALWAYS, even under local posture', () => {
    // task-024 (the REAL gap) — cleartext Plaid token must stay a remediation task.
    expect(classifyFinding(finding('critical', 'Plaid access token stored in cleartext in the DB'), local)).toBe('remediate');
    expect(classifyFinding(finding('high', 'Hardcoded API key in config.ts'), local)).toBe('remediate');
    expect(classifyFinding(finding('high', 'SQL injection in the search endpoint'), local)).toBe('remediate');
    expect(classifyFinding(finding('medium', 'Missing input validation on the upload form'), local)).toBe('remediate');
  });

  it('REMEDIATE: an auth finding that is ALSO a data-at-rest issue (posture-independent wins)', () => {
    expect(classifyFinding(finding('critical', 'JWT signing secret stored in cleartext'), local)).toBe('remediate');
  });

  it('REMEDIATE: the local posture guard is actually violated (app is network-exposed)', () => {
    expect(classifyFinding(finding('critical', 'Server binds to 0.0.0.0, exposing the unauthenticated API to the network'), local)).toBe('remediate');
  });

  it('REMEDIATE: strict postures never suppress an auth finding', () => {
    expect(classifyFinding(finding('critical', 'The API has zero authentication'), publicPosture)).toBe('remediate');
    expect(classifyFinding(finding('critical', 'Missing tenant isolation between customers'), multiTenant)).toBe('remediate');
  });

  it('REMEDIATE: no decisions artifact → never suppress', () => {
    expect(classifyFinding(finding('critical', 'zero authentication'), null)).toBe('remediate');
  });

  it('REMEDIATE: an unclassifiable finding under local posture (conservative default)', () => {
    expect(classifyFinding(finding('low', 'Inconsistent variable naming in utils'), local)).toBe('remediate');
  });
});

describe('partitionFindings', () => {
  it('splits advisories from real remediation work', () => {
    const findings = [
      finding('critical', 'zero authentication on the API'), // advisory (local)
      finding('critical', 'Plaid token in cleartext'), // remediate
      finding('low', 'add a session timeout'), // advisory (local, 'session')
    ];
    const { remediate, advisory } = partitionFindings(findings, local);
    expect(remediate.map((f) => f.description)).toEqual(['Plaid token in cleartext']);
    expect(advisory).toHaveLength(2);
  });
  it('under a strict posture, nothing is advisory', () => {
    const findings = [finding('critical', 'zero authentication'), finding('high', 'no rate limiting')];
    const { remediate, advisory } = partitionFindings(findings, publicPosture);
    expect(remediate).toHaveLength(2);
    expect(advisory).toHaveLength(0);
  });
});

describe('renderDecisionsBlock', () => {
  it("is '' with no artifact (byte-identical prompts for pre-B1 projects)", () => {
    expect(renderDecisionsBlock(null)).toBe('');
  });
  it('states the posture + accepted descopes + the judge-against-posture rule', () => {
    const d = deriveDecisionsFromBlueprint(composed, 'local-single-user');
    const block = renderDecisionsBlock(d);
    expect(block).toContain('APPROVED SCOPE & DEPLOYMENT POSTURE');
    expect(block).toContain('local-single-user');
    expect(block).toContain('single-user, localhost');
    expect(block).toMatch(/ADVISORY note, not a blocking defect/);
  });
});
