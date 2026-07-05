import type { ComposedBlueprint } from './blueprints';
import type { SecurityFinding } from './bullpenPlan';

/**
 * The approved-scope artifact. An early build produced a large remediation tail
 * because the reviewers ran a production/multi-tenant threat model with NO knowledge of
 * the team's explicitly-approved "single-user, localhost, no-auth" design — so Gilfoyle
 * flagged the APPROVED descope as CRITICAL. This module captures the
 * chosen options + accepted descopes + a deployment posture, and classifies each review
 * finding against them so a posture-contradicting finding becomes an ADVISORY note (routed
 * to the findings backlog) instead of a manufactured remediation task.
 *
 * Pure — no Node/Electron — so the whiteboard emit, the Bullpen gate, and their tests all
 * share one source of truth. The classification is deliberately CONSERVATIVE: it only
 * downgrades to advisory when the posture is a human-chosen permissive one AND the finding
 * clearly belongs to a network/multi-user threat model the posture excludes; anything
 * touching data-at-rest, secrets, injection, or input validation — or anything uncertain —
 * stays a real remediation task, so a genuine vulnerability is never silenced.
 */

/** How/where the built app is deployed — the primary lever that calibrates a review. */
export type DeploymentPosture =
  | 'local-single-user'
  | 'internal'
  | 'public-internet'
  | 'multi-tenant';

export const DEPLOYMENT_POSTURES: DeploymentPosture[] = [
  'local-single-user',
  'internal',
  'public-internet',
  'multi-tenant',
];

/**
 * The default when nothing is inferred or chosen. Deliberately the STRICT end:
 * `public-internet` reproduces today's no-gate behavior (every finding remediates), so a
 * missing/ambiguous posture can never SUPPRESS a finding — a permissive posture is only
 * ever reached by an explicit human choice (or a rip-it throwaway).
 */
export const DEFAULT_DEPLOYMENT_POSTURE: DeploymentPosture = 'public-internet';

/** One-line gloss per posture, shown to the reviewers so they judge against the right model. */
export const POSTURE_DESCRIPTIONS: Record<DeploymentPosture, string> = {
  'local-single-user':
    "runs only on the founder's own machine, one user, not exposed to any network",
  internal: 'deployed inside a trusted/internal network, not reachable from the public internet',
  'public-internet': 'reachable from the public internet by untrusted users',
  'multi-tenant':
    'public, serving multiple tenants/customers whose data MUST stay isolated from each other',
};

/** Short human labels for the posture selector (the Whiteboard control). */
export const POSTURE_LABELS: Record<DeploymentPosture, string> = {
  'local-single-user': 'Local · single-user (localhost only, no login)',
  internal: 'Internal (trusted network, not public)',
  'public-internet': 'Public internet (untrusted users)',
  'multi-tenant': 'Multi-tenant SaaS (isolated customers)',
};

/** Postures whose threat model excludes network / multi-user attackers. */
const PERMISSIVE_POSTURES: DeploymentPosture[] = ['local-single-user', 'internal'];

export function isDeploymentPosture(value: unknown): value is DeploymentPosture {
  return typeof value === 'string' && (DEPLOYMENT_POSTURES as string[]).includes(value);
}

/** One recorded architecture decision (chosen option per blueprint decision). */
export interface DecisionRecord {
  id: string;
  /** The chosen option key (defaults to the blueprint's recommended key). */
  chosen: string;
  /** The decision prompt, for human/reviewer readability. */
  prompt?: string;
}

/** The `.nucleus/decisions.json` artifact — safe to commit (no secrets, names only). */
export interface Decisions {
  schemaVersion: 1;
  deploymentPosture: DeploymentPosture;
  decisions: DecisionRecord[];
  /** Things consciously dropped/out-of-scope the reviewers must NOT re-flag as problems. */
  acceptedDescopes: string[];
}

/**
 * Seed a default posture from what the project already declares. Only a rip-it throwaway
 * infers a permissive posture; every real project defaults to the strict end and requires
 * an explicit human downgrade — so inference can never silently weaken a review.
 */
export function inferDeploymentPosture(opts: {
  templateId?: string | null;
  ripIt?: boolean;
}): DeploymentPosture {
  if (opts.ripIt) return 'local-single-user'; // express, unreviewed-by-design throwaway
  if (MULTI_TENANT_ARCHETYPES.includes(opts.templateId ?? '')) return 'multi-tenant';
  return DEFAULT_DEPLOYMENT_POSTURE;
}

const MULTI_TENANT_ARCHETYPES = ['saas', 'saas-ai-budget', 'personal-finance'];

/** The posture-implied descopes the reviewers must treat as approved (not new problems). */
function deriveDescopes(posture: DeploymentPosture): string[] {
  if (posture === 'local-single-user') {
    return [
      'Network authentication/login and multi-user access control are out of scope ' +
        '(single-user, localhost-only — an approved design choice, not a gap).',
    ];
  }
  if (posture === 'internal') {
    return [
      'Public-internet hardening is out of scope (internal/trusted-network deployment).',
    ];
  }
  return [];
}

/**
 * Build the decisions artifact from the composed blueprint + the chosen posture. Chosen
 * options default to each decision's recommended key — reconciling a literal mid-chat
 * override that diverges from the recommendation is deliberately deferred; the posture +
 * the blueprint defaults are the part that prevents the false-CRITICAL failure.
 */
export function deriveDecisionsFromBlueprint(
  composed: ComposedBlueprint,
  posture: DeploymentPosture,
): Decisions {
  return {
    schemaVersion: 1,
    deploymentPosture: posture,
    decisions: composed.decisions.map((d) => ({ id: d.id, chosen: d.recommend, prompt: d.prompt })),
    acceptedDescopes: deriveDescopes(posture),
  };
}

/**
 * Validate a parsed `.nucleus/decisions.json` back into a Decisions, or null if it is
 * malformed / an unknown schema — so a hand-edited or corrupt file degrades to "no scope
 * artifact" (findings never suppressed) rather than throwing or trusting junk.
 */
export function sanitizeDecisions(raw: unknown): Decisions | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Partial<Decisions>;
  if (r.schemaVersion !== 1) return null;
  if (!isDeploymentPosture(r.deploymentPosture)) return null;
  const decisions: DecisionRecord[] = Array.isArray(r.decisions)
    ? r.decisions
        .filter(
          (d): d is DecisionRecord =>
            !!d && typeof d === 'object' && typeof (d as DecisionRecord).id === 'string',
        )
        .map((d) => ({
          id: String(d.id),
          chosen: typeof d.chosen === 'string' ? d.chosen : '',
          prompt: typeof d.prompt === 'string' ? d.prompt : undefined,
        }))
    : [];
  const acceptedDescopes: string[] = Array.isArray(r.acceptedDescopes)
    ? r.acceptedDescopes.filter((d): d is string => typeof d === 'string')
    : [];
  return { schemaVersion: 1, deploymentPosture: r.deploymentPosture, decisions, acceptedDescopes };
}

export type FindingDisposition = 'remediate' | 'advisory';

// Findings that presuppose a NETWORK / MULTI-USER threat model — the class a permissive
// posture legitimately excludes. Matched as lowercase substrings of the finding text.
const NETWORK_THREAT_MODEL = [
  'auth', // authentication / authorization / unauthenticated / unauthorized
  'login',
  'session',
  'idor',
  'insecure direct object',
  'access control',
  'access-control',
  'csrf',
  'cors',
  'rate limit',
  'rate-limit',
  'rate limiting',
  'jwt',
  'multi-tenant',
  'multitenant',
  'tenant isolation',
  'rbac',
  'privilege',
  'account takeover',
  'brute force',
  'brute-force',
];

// Classes that matter REGARDLESS of posture — never downgraded. Checked FIRST, so a finding
// that is both (e.g. "auth token stored in cleartext") stays a remediation task. Over-matching
// here is harmless: it only ever prevents a downgrade (the conservative direction).
const POSTURE_INDEPENDENT = [
  'encrypt',
  'at rest',
  'at-rest',
  'plaintext',
  'cleartext',
  'in the clear',
  'secret',
  'credential',
  'private key',
  'api key',
  'api-key',
  'injection',
  'xss',
  'cross-site scripting',
  'traversal',
  'ssrf',
  'deserializ',
  'sanitiz',
  'input validation',
  'validate input',
  'sql',
  'dependency',
  'cve',
  'hardcoded',
];

// The permissive posture's own guard being VIOLATED in code — the app is actually exposed,
// so a "network" finding is real after all. Checked before the network-threat-model downgrade.
const EXPOSURE_VIOLATION = [
  '0.0.0.0',
  'bind to all',
  'binds to all',
  'listens on all',
  'all interfaces',
  'public interface',
  'publicly accessible',
  'exposed to the network',
  'exposed to the internet',
  'externally accessible',
  'internet-facing',
];

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/**
 * Decide whether a review finding is a real remediation task or an advisory note that
 * contradicts the approved scope. Conservative by construction — see the module doc.
 */
export function classifyFinding(
  finding: SecurityFinding,
  decisions: Decisions | null,
): FindingDisposition {
  // No approved-scope artifact → never suppress anything.
  if (!decisions) return 'remediate';
  // Strict postures: a public / multi-tenant app must satisfy every finding.
  if (!PERMISSIVE_POSTURES.includes(decisions.deploymentPosture)) return 'remediate';
  const text = finding.description.toLowerCase();
  // Posture-independent classes and actual-exposure violations always remediate.
  if (matchesAny(text, POSTURE_INDEPENDENT)) return 'remediate';
  if (matchesAny(text, EXPOSURE_VIOLATION)) return 'remediate';
  // A pure network/multi-user finding under an approved permissive posture is advisory.
  if (matchesAny(text, NETWORK_THREAT_MODEL)) return 'advisory';
  // Uncertain → remediate (never silence an unclassified finding).
  return 'remediate';
}

/** Partition parsed findings into the ones to remediate and the posture-descoped advisories. */
export function partitionFindings(
  findings: SecurityFinding[],
  decisions: Decisions | null,
): { remediate: SecurityFinding[]; advisory: SecurityFinding[] } {
  const remediate: SecurityFinding[] = [];
  const advisory: SecurityFinding[] = [];
  for (const f of findings) {
    (classifyFinding(f, decisions) === 'advisory' ? advisory : remediate).push(f);
  }
  return { remediate, advisory };
}

/**
 * The authoritative APPROVED-SCOPE context block appended to every build/review seat's
 * prompt (via roleContextBlocks). '' when there is no decisions artifact — so pre-B1 and
 * from-scratch projects keep byte-identical prompts. Soft guidance to the model; the hard
 * gate is classifyFinding in code (belt and suspenders).
 */
export function renderDecisionsBlock(decisions: Decisions | null): string {
  if (!decisions) return '';
  const lines: string[] = [
    '',
    '',
    'APPROVED SCOPE & DEPLOYMENT POSTURE (authoritative — the founder and architect settled this):',
    `Deployment posture: ${decisions.deploymentPosture} — ${POSTURE_DESCRIPTIONS[decisions.deploymentPosture]}.`,
  ];
  if (decisions.acceptedDescopes.length > 0) {
    lines.push('Consciously accepted descopes (do NOT flag these as new problems):');
    for (const d of decisions.acceptedDescopes) lines.push(`- ${d}`);
  }
  lines.push(
    'Judge findings AGAINST this posture: an issue that only matters under a threat model this',
    'posture excludes (e.g. network authentication/login on a single-user localhost app) is an',
    "ADVISORY note, not a blocking defect — UNLESS the posture's own guard is actually violated",
    'in code (e.g. the server binds to a public interface). Data-at-rest, secret handling,',
    'injection, and input-validation issues ALWAYS matter regardless of posture. Calibrate',
    'severity to the posture.',
  );
  return lines.join('\n');
}
