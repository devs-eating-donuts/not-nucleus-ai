/**
 * Blueprint depth. Each project archetype (templates.ts) gets a Blueprint: the
 * critical intake questions (what the user NEEDS), the decision matrix
 * (alternatives + a recommended default — "cover all options"), per-archetype
 * security rules / env vars / data entities, and operational acceptance
 * criteria. Capabilities (payments / email / financial) are OVERLAYS that
 * COMPOSE onto a base archetype.
 *
 * Base archetype blueprints. Content is internal prompt material
 * (the Bullpen personas read it); the Silicon Valley UI naming stays in
 * personas.ts/naming.ts. Kept Electron/Node-free — pure data + a merge fn.
 */

import type { ProjectTemplate } from './templates';
import type { DeploymentPosture } from './decisions';

export interface IntakeQuestion {
  id: string;
  question: string;
  /** Must-answer NEEDS vs. nice-to-have. */
  critical: boolean;
  group: 'needs' | 'integrations' | 'launch';
}

export interface DecisionOption {
  key: string; // 'A' | 'B' | …
  label: string;
  /** One-line why / cost, e.g. "Free, then ~$9/mo Standard". */
  note?: string;
}

export interface BlueprintDecision {
  id: string; // 'rendering' | 'auth' | 'hosting' | …
  prompt: string;
  options: DecisionOption[];
  /** The recommended option key. */
  recommend: string;
}

export interface CriteriaPack {
  /** Fuzzy task match, e.g. "contact form", "authentication". */
  forTask: string;
  /** Verifiable, one-shot-testable checks. */
  criteria: string[];
}

export interface DataEntity {
  name: string;
  fields: string[];
}

/**
 * A stateful backing service the app needs that the founder must be able to RUN
 * and TEST locally (database, cache, object storage). Drives the plan's "stand up
 * the local data services" task + the "verify it runs locally" acceptance check.
 */
export interface LocalServiceSpec {
  /** Human label, e.g. "PostgreSQL database". */
  service: string;
  /** The recommended way to stand it up on the founder's machine. */
  localVia: string;
  /** The env var that points the app at the LOCAL instance, e.g. "DATABASE_URL". */
  connectionEnv: string;
}

export interface Blueprint {
  kind: 'base' | 'overlay';
  intakeQuestions: IntakeQuestion[];
  decisions: BlueprintDecision[];
  securityRules: string[];
  envVars: string[];
  dataEntities: DataEntity[];
  acceptanceCriteria: CriteriaPack[];
  nonGoals: string[];
  /** Stateful services that must run locally for the founder to test the app. */
  localServices?: LocalServiceSpec[];
  /**
   * Build-prerequisite tool ids (keys of BUILD_TOOLS in buildTools.ts) the founder
   * needs locally to build/run/test this product. Composes + dedups across base +
   * overlays. Drives the setup-page "Build prerequisites" panel + the plan's
   * human-setup login tasks.
   */
  buildTools?: string[];
  /** Overlay only — base template ids it can compose onto, or 'any'. */
  appliesTo?: 'any' | string[];
  /**
   * Base only — overlay ids whose capability this base already BAKES IN (e.g. a
   * Supabase base provides auth + database + storage). The setup UI shows these as
   * "included" + disabled, and composeBlueprint never re-composes them — so a base
   * whose keys don't match the overlay's (Supabase: SUPABASE_URL, not DATABASE_URL)
   * can't emit redundant or divergent content.
   */
  provides?: string[];
}

/**
 * The local-environment decision shared by every data-service blueprint (DB,
 * cache, storage, and the bases that bake a datastore in). Deduped by id in
 * composeBlueprint, so it surfaces ONCE no matter how many data services apply.
 */
const LOCAL_DEV_DECISION: BlueprintDecision = {
  id: 'local-dev',
  prompt: 'How should the founder run the data services (database / cache / file storage) locally?',
  options: [
    { key: 'A', label: 'docker-compose', note: 'recommended — one `docker compose up` starts every service, versioned in the repo' },
    { key: 'B', label: 'Install on the host', note: 'documented install steps; fewer moving parts if Docker is unavailable' },
    { key: 'C', label: 'Shared cloud dev instance', note: 'only if local is impractical — costs money and needs the network' },
  ],
  recommend: 'A',
};

/** Shared local-dev hygiene rule (deduped by string when several data services apply). */
const LOCAL_DEV_SECURITY_RULE =
  'Local development must use throwaway/dev credentials from a gitignored .env.local (with a committed .env.example) — never production secrets; bind local services to localhost.';

export interface OverlayDef {
  id: string;
  name: string;
  description: string;
  blueprint: Blueprint;
}

/* ----- base archetype blueprints (keyed by templates.ts id) ----- */

const STATIC_SITE: Blueprint = {
  kind: 'base',
  intakeQuestions: [
    { id: 'business', question: 'What is the business or product this site markets?', critical: true, group: 'needs' },
    { id: 'cta', question: 'What is the primary call to action (the one thing a visitor should do)?', critical: true, group: 'needs' },
    { id: 'pages', question: 'What pages or sections does v1 need?', critical: true, group: 'needs' },
    { id: 'contact-to', question: 'Who receives contact-form submissions, and how (email)?', critical: true, group: 'integrations' },
    { id: 'contact-fields', question: 'What fields are required on the contact form?', critical: true, group: 'needs' },
    { id: 'analytics', question: 'Should analytics be included?', critical: false, group: 'launch' },
    { id: 'blog', question: 'Should there be a blog / content section?', critical: false, group: 'needs' },
  ],
  decisions: [
    {
      id: 'framework',
      prompt: 'What framework for the site?',
      options: [
        { key: 'A', label: 'Astro + TypeScript + Tailwind', note: 'content-first; ships mostly static HTML with islands for the interactive bits — the best fit for marketing / portfolio / blog / small-business sites' },
        { key: 'B', label: 'Next.js', note: 'heavier; better when the site is closer to an app (dashboards, auth, lots of React state)' },
        { key: 'C', label: 'Plain HTML/CSS', note: 'only the very simplest sites — you lose reusable layouts, content collections, and a maintainable secure form' },
      ],
      recommend: 'A',
    },
    {
      id: 'data',
      prompt: 'How should the site get its data?',
      options: [
        { key: 'A', label: 'Static at build time (Markdown/MDX content collections)', note: 'rarely-changing, public content — fastest, cheapest; type-safe with Astro content collections' },
        { key: 'B', label: 'API-backed', note: 'when data changes frequently or is private/per-user' },
      ],
      recommend: 'A',
    },
    {
      id: 'form-backend',
      prompt: 'How should the contact form submit?',
      options: [
        { key: 'A', label: 'Server endpoint (Astro API route / Worker handler)', note: 'REQUIRED — the captcha and email secrets must be verified/used server-side' },
        { key: 'B', label: 'Client-only', note: 'only if there are genuinely no secrets and nothing sensitive (rare for a contact form)' },
      ],
      recommend: 'A',
    },
    {
      id: 'hosting',
      prompt: 'Where should it be hosted?',
      options: [
        { key: 'A', label: 'Cloudflare Workers (static assets + the form Worker)', note: 'one deploy for the static pages AND the secure form endpoint; Astro\'s Cloudflare adapter now targets Workers (Pages support was dropped)' },
        { key: 'B', label: 'Azure Static Web Apps', note: 'Free, then ~$9/mo; static hosting + separate managed functions' },
        { key: 'C', label: 'Netlify', note: 'Free, then ~$19/mo Pro' },
      ],
      recommend: 'A',
    },
    {
      id: 'spam',
      prompt: 'How should the form resist spam/bots?',
      options: [
        { key: 'A', label: 'Cloudflare Turnstile', note: 'free, privacy-friendly; MUST be verified server-side (see the security rules)' },
        { key: 'B', label: 'hCaptcha', note: 'free tier; also verified server-side' },
        { key: 'C', label: 'None', note: 'only for very low-traffic internal sites' },
      ],
      recommend: 'A',
    },
    {
      id: 'email',
      prompt: 'How should the contact form send email?',
      options: [
        { key: 'A', label: 'Postmark', note: 'transactional email; called ONLY from the server with the X-Postmark-Server-Token' },
        { key: 'B', label: 'Resend', note: 'developer-friendly transactional email; also server-only' },
        { key: 'C', label: 'Amazon SES', note: 'cheapest at volume, more setup' },
      ],
      recommend: 'A',
    },
  ],
  securityRules: [
    'Never commit secrets — read them from server-side environment bindings (Cloudflare Worker secrets / serverless env). The captcha SECRET key and the email provider token (e.g. Postmark\'s X-Postmark-Server-Token) must NEVER appear in client code, the built browser bundle, or public env vars.',
    'Verify the captcha/Turnstile token SERVER-SIDE with the provider\'s siteverify API BEFORE sending anything — the client widget alone does NOT protect the form. Turnstile tokens expire (~300s) and are single-use, so verification belongs in the form endpoint.',
    'The form endpoint must not reveal secret values or upstream provider error details to the client.',
    'Validate and sanitize every form field server-side, and include a honeypot field.',
    'Rate-limit submissions; duplicate rapid submissions must not send duplicate emails.',
  ],
  // Public config (TURNSTILE_SITE_KEY, ALLOWED_ORIGIN) + genuine server-only secrets
  // (TURNSTILE_SECRET_KEY, POSTMARK_SERVER_TOKEN). The security rules mark which are which.
  envVars: [
    'TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'POSTMARK_SERVER_TOKEN',
    'POSTMARK_FROM_EMAIL',
    'CONTACT_TO_EMAIL',
    'ALLOWED_ORIGIN',
  ],
  dataEntities: [],
  acceptanceCriteria: [
    {
      forTask: 'site / pages',
      criteria: [
        'Visitor can load the site on desktop and mobile.',
        'SEO metadata exists for title, description, canonical URL, and Open Graph sharing.',
        'Accessibility smoke checks pass: keyboard-only use, form labels, visible focus, heading order, and 4.5:1 text contrast.',
      ],
    },
    {
      forTask: 'contact form',
      criteria: [
        'The contact form validates required fields and rejects invalid email addresses.',
        'The form shows distinct success, validation-error, rate-limit, bot-check, and provider-failure states.',
        'The captcha/Turnstile token is verified server-side (siteverify) before any email is sent.',
        'No secret (the captcha secret key, the email provider token) appears in the built client bundle.',
        'Submissions are rate limited and duplicate rapid submissions do not send duplicate emails.',
      ],
    },
  ],
  nonGoals: ['User accounts or a database, unless the brief clearly needs content editors.'],
  buildTools: ['node', 'git', 'wrangler'],
};

const FULLSTACK_WEB: Blueprint = {
  kind: 'base',
  provides: ['authentication', 'database'],
  intakeQuestions: [
    { id: 'users', question: 'Who are the users, and how do they sign in?', critical: true, group: 'needs' },
    { id: 'core-data', question: 'What are the core entities/records users create and work with?', critical: true, group: 'needs' },
    { id: 'screens', question: 'What are the key screens and flows for v1?', critical: true, group: 'needs' },
    { id: 'roles', question: 'What must be authorized — which roles can do what?', critical: true, group: 'needs' },
    { id: 'uploads', question: 'Does v1 need file uploads?', critical: true, group: 'needs' },
    { id: 'integrations', question: 'Any required integrations (payments, bank accounts, email, others)?', critical: true, group: 'integrations' },
    { id: 'launch', question: 'When does it need to launch, and where is it hosted?', critical: false, group: 'launch' },
  ],
  decisions: [
    {
      id: 'framework',
      prompt: 'What application framework?',
      options: [
        { key: 'A', label: 'Next.js + TypeScript', note: 'SSR + built-in auth/routing — recommended for most app+UI products' },
        { key: 'B', label: 'React + Vite + a separate API', note: 'more flexibility if the API grows independently' },
        { key: 'C', label: 'Remix', note: 'edge-friendly, newer team ramp' },
      ],
      recommend: 'A',
    },
    {
      id: 'auth',
      prompt: 'How should sign-in work? (managed, never hand-rolled)',
      options: [
        { key: 'A', label: 'Microsoft Entra External ID', note: 'managed; good for B2B/internal' },
        { key: 'B', label: 'Clerk', note: 'fast to integrate, generous free tier' },
        { key: 'C', label: 'Auth.js (NextAuth)', note: 'self-hosted sessions, more wiring' },
      ],
      recommend: 'A',
    },
    {
      id: 'database',
      prompt: 'What datastore?',
      options: [
        { key: 'A', label: 'PostgreSQL', note: 'the default — relational, well-understood' },
        { key: 'B', label: 'Azure SQL', note: 'if a Microsoft/SQL Server shop' },
        { key: 'C', label: 'Cosmos DB', note: 'only if genuinely document- or edge-shaped' },
      ],
      recommend: 'A',
    },
    {
      id: 'hosting',
      prompt: 'Where should it run?',
      options: [
        { key: 'A', label: 'Azure Container Apps', note: 'managed containers, scales to zero' },
        { key: 'B', label: 'Azure App Service', note: 'simplest PaaS' },
        { key: 'C', label: 'Vercel', note: 'if Next.js and you want zero-config' },
      ],
      recommend: 'A',
    },
    LOCAL_DEV_DECISION,
  ],
  securityRules: [
    'Use managed auth — never hand-roll password storage or sessions.',
    'Authorize every API call by role; never trust a role claim from the client without checking it server-side.',
    'Never log PII, secrets, or tokens.',
    'Store uploaded files in object storage with signed URLs — never as blobs in the database.',
    'Read secrets from the environment / a secret store, never from source.',
    LOCAL_DEV_SECURITY_RULE,
  ],
  envVars: ['DATABASE_URL', 'AUTH_ISSUER', 'AUTH_CLIENT_ID', 'AUTH_CLIENT_SECRET', 'APP_BASE_URL'],
  localServices: [
    { service: 'PostgreSQL database', localVia: 'docker-compose (postgres:16 image)', connectionEnv: 'DATABASE_URL' },
  ],
  dataEntities: [
    { name: 'User', fields: ['id', 'email', 'role', 'created_at', 'updated_at'] },
  ],
  acceptanceCriteria: [
    {
      forTask: 'authentication',
      criteria: [
        'A user can sign in and is returned to the app authenticated.',
        'Sessions renew without forcing a re-login mid-task; logout clears all cookies and local storage.',
        'Every API route enforces the user role; an unauthorized role is rejected.',
        'No plaintext passwords, tokens, or secrets appear in logs or error messages.',
      ],
    },
    {
      forTask: 'data / schema',
      criteria: [
        'Every table has created_at and updated_at timestamps and enforced foreign keys.',
        'Create/read/update/delete works for the core entities with server-side validation.',
      ],
    },
  ],
  nonGoals: ['Payments or financial-account access, unless an overlay is added.'],
};

// Internal Dashboard / CRUD Tool: an authenticated workflow tool over a relational
// model — records, role-based access, audit logging, bulk operations. Distinct from
// FULLSTACK_WEB in its emphasis on authorization depth (RBAC + record-level), an
// immutable audit trail, bounded/paginated queries, and safe bulk operations.
const DASHBOARD: Blueprint = {
  kind: 'base',
  provides: ['authentication', 'database'],
  intakeQuestions: [
    { id: 'users', question: 'Who uses this internally, and how do they sign in (SSO / directory)?', critical: true, group: 'needs' },
    { id: 'records', question: 'What are the core records/entities and their key fields?', critical: true, group: 'needs' },
    { id: 'roles', question: 'What roles exist, and exactly what can each role view and change?', critical: true, group: 'needs' },
    { id: 'screens', question: 'What are the key list and detail screens, and the main workflows over them?', critical: true, group: 'needs' },
    { id: 'audit', question: 'Which actions must be audited (who changed what, when)?', critical: true, group: 'needs' },
    { id: 'bulk', question: 'Are bulk operations needed — and on which records/actions?', critical: false, group: 'needs' },
    { id: 'exports', question: 'Are exports or reports (e.g. CSV) required?', critical: false, group: 'needs' },
    { id: 'launch', question: 'Where does it run, and when does it need to launch?', critical: false, group: 'launch' },
  ],
  decisions: [
    {
      id: 'architecture',
      prompt: 'What application architecture?',
      options: [
        { key: 'A', label: 'React + Vite SPA + a separate API', note: 'recommended — clean web/api split for an internal tool' },
        { key: 'B', label: 'Next.js full-stack', note: 'only if you want one deployable and some SSR' },
        { key: 'C', label: 'Server-rendered admin (Django/Rails admin-style)', note: 'fastest CRUD scaffolding, less custom UX' },
      ],
      recommend: 'A',
    },
    {
      id: 'api-framework',
      prompt: 'What API framework?',
      options: [
        { key: 'A', label: 'NestJS + TypeScript', note: 'recommended for a TS shop — structured, testable' },
        { key: 'B', label: 'ASP.NET Core Minimal API', note: 'if a .NET/SQL Server shop' },
        { key: 'C', label: 'Express + TypeScript', note: 'lighter, but you supply the structure' },
      ],
      recommend: 'A',
    },
    {
      id: 'auth',
      prompt: 'How should internal sign-in work? (managed SSO, never hand-rolled)',
      options: [
        { key: 'A', label: 'Microsoft Entra ID', note: 'recommended for internal/B2B SSO' },
        { key: 'B', label: 'Okta', note: 'if already the org IdP' },
        { key: 'C', label: 'Auth.js (NextAuth)', note: 'self-hosted sessions, more wiring' },
      ],
      recommend: 'A',
    },
    {
      id: 'authorization',
      prompt: 'What authorization model?',
      options: [
        { key: 'A', label: 'Role-based (RBAC)', note: 'recommended — roles → permissions, simplest that fits "who can do what"' },
        { key: 'B', label: 'RBAC + record-level ownership/scoping', note: 'when users may only touch their own/team records' },
        { key: 'C', label: 'Attribute/policy-based (ABAC)', note: 'only if access rules are genuinely complex/conditional' },
      ],
      recommend: 'A',
    },
    {
      id: 'database',
      prompt: 'What datastore?',
      options: [
        { key: 'A', label: 'PostgreSQL', note: 'the default — relational, well-understood' },
        { key: 'B', label: 'Azure SQL', note: 'if a Microsoft/SQL Server shop' },
        { key: 'C', label: 'MySQL', note: 'fine if it is the existing house database' },
      ],
      recommend: 'A',
    },
    {
      id: 'hosting',
      prompt: 'Where should it run?',
      options: [
        { key: 'A', label: 'Azure Container Apps', note: 'managed containers, scales to zero — matches the stack' },
        { key: 'B', label: 'Azure App Service', note: 'simplest PaaS' },
        { key: 'C', label: 'AWS ECS / Fargate', note: 'if an AWS shop' },
      ],
      recommend: 'A',
    },
    LOCAL_DEV_DECISION,
  ],
  securityRules: [
    'Use managed SSO — never hand-roll password storage or sessions.',
    'Authorize EVERY action server-side by role; never trust a role or permission claim sent from the client.',
    'Where records are owned or team-scoped, enforce record-level access on read AND write — not just in the UI.',
    'Write an append-only, immutable audit entry for every create/update/delete (and privileged read): actor, action, entity type + id, timestamp, and before/after where relevant. Audit rows must not be editable or deletable through the app.',
    'Bulk operations must enforce the SAME per-record authorization as single operations — no bulk bypass — and be transactional and idempotent.',
    'Paginate and bound every list query; never return an unbounded result set.',
    'Never log PII, secrets, or tokens; redact sensitive fields in logs and exports.',
    'Read secrets from the environment / a secret store, never from source. Validate every write server-side.',
    LOCAL_DEV_SECURITY_RULE,
  ],
  envVars: ['DATABASE_URL', 'AUTH_ISSUER', 'AUTH_CLIENT_ID', 'AUTH_CLIENT_SECRET', 'APP_BASE_URL'],
  localServices: [
    { service: 'PostgreSQL database', localVia: 'docker-compose (postgres:16 image)', connectionEnv: 'DATABASE_URL' },
  ],
  dataEntities: [
    { name: 'User', fields: ['id', 'email', 'role', 'status', 'last_login_at', 'created_at', 'updated_at'] },
    {
      name: 'AuditLog',
      fields: ['id', 'actor_user_id', 'action', 'entity_type', 'entity_id', 'before', 'after', 'ip_address', 'created_at'],
    },
  ],
  acceptanceCriteria: [
    {
      forTask: 'authentication / access',
      criteria: [
        'A user signs in via SSO and is returned to the app authenticated; logout clears all cookies and local storage.',
        'Every API route enforces the user role; an unauthorized role is rejected with no data leak.',
        'No plaintext passwords, tokens, or secrets appear in logs or error messages.',
      ],
    },
    {
      forTask: 'records / CRUD',
      criteria: [
        'List screens paginate, filter, and sort; queries are bounded (no unbounded result sets).',
        'Create/read/update/delete works for the core records with server-side validation.',
        'Record-level authorization is enforced on both read and write where records are owned/scoped.',
      ],
    },
    {
      forTask: 'audit log',
      criteria: [
        'Every create/update/delete writes an audit entry capturing actor, action, entity type + id, and timestamp.',
        'Audit entries cannot be edited or deleted through the application.',
        'Sensitive fields are redacted in the audit trail and any export.',
      ],
    },
    {
      forTask: 'bulk operations',
      criteria: [
        'A bulk action enforces the same per-record authorization as the single-record action.',
        'A bulk action is transactional (a failure leaves no partial half-applied state) and idempotent.',
        'A partial failure reports which records failed and why, without aborting the audit trail.',
      ],
    },
  ],
  nonGoals: [
    'Public or anonymous access, and SEO — it is an internal, authenticated tool.',
    'A flashy consumer UI; favor reliability, clarity, and dense data over flash.',
    'Payments or financial-account access, unless an overlay is added.',
  ],
};

// B2B Multi-Tenant SaaS on Azure: the production hosting + controls architecture for a
// POOLED multi-tenant product. Distinct from FULLSTACK_WEB in its non-negotiables — strict
// tenant isolation, a public edge (Front Door/WAF) over private-only origins, private-endpoint
// data services, managed-identity + Key Vault secret handling, durable async workers,
// monitoring, backups/PITR, and isolated dev/test/prod. Billing rides the payments overlay
// (now applies to saas); file uploads ride the storage overlay.
const SAAS: Blueprint = {
  kind: 'base',
  provides: ['authentication', 'database'],
  intakeQuestions: [
    { id: 'tenancy', question: 'What is a tenant (organization / workspace), and what data and configuration must stay isolated between tenants?', critical: true, group: 'needs' },
    { id: 'users', question: 'Who are the users and roles within a tenant, and how do they sign in?', critical: true, group: 'needs' },
    { id: 'core-data', question: 'What core entities does each tenant create and work with?', critical: true, group: 'needs' },
    { id: 'billing', question: 'What is the subscription / billing model (plans, per-seat or usage, free trial)?', critical: true, group: 'integrations' },
    { id: 'uploads', question: 'Does v1 store user files or documents?', critical: true, group: 'needs' },
    { id: 'async', question: 'Any background / async work (billing webhooks, file processing, scheduled jobs, notifications)?', critical: false, group: 'needs' },
    { id: 'launch', question: 'Which environments are needed (dev / test / prod), and when does it launch?', critical: false, group: 'launch' },
  ],
  decisions: [
    {
      id: 'auth',
      prompt: 'How should customer sign-in / identity work? (managed + org-aware, never hand-rolled)',
      options: [
        { key: 'A', label: 'Microsoft Entra External ID', note: 'recommended — managed customer identity (CIAM): user flows, MFA, branding' },
        { key: 'B', label: 'Existing Azure AD B2C tenant', note: 'if the org already runs B2C — reuse it rather than standing up a new directory' },
        { key: 'C', label: 'Clerk Organizations', note: 'fastest org/teams modeling; fine if not committed to Entra' },
      ],
      recommend: 'A',
    },
    {
      id: 'hosting',
      prompt: 'Where should the backend API and workers run?',
      options: [
        { key: 'A', label: 'Azure Container Apps', note: 'recommended — managed containers, scale-to-zero, easy workers + jobs' },
        { key: 'B', label: 'Azure App Service', note: 'simplest PaaS if a single web/API process is enough' },
        { key: 'C', label: 'Azure Functions', note: 'event-driven / spiky work (webhooks, file jobs) — pair with a queue' },
      ],
      recommend: 'A',
    },
    {
      id: 'api-edge',
      prompt: 'Put an API gateway (Azure API Management) in front of the backend API?',
      options: [
        { key: 'A', label: 'API Management', note: 'recommended once external/multi-client — central JWT validation, rate limits/quotas, API versioning' },
        { key: 'B', label: 'No gateway yet', note: 'validate the JWT in the backend directly; add APIM when the API is exposed beyond your own client' },
      ],
      recommend: 'A',
    },
    {
      id: 'iac',
      prompt: 'How is the cloud infrastructure provisioned?',
      options: [
        { key: 'A', label: 'Bicep', note: 'recommended for Azure-only — native, no state files to manage' },
        { key: 'B', label: 'Terraform', note: 'if you want one tool across clouds or already standardized on it' },
      ],
      recommend: 'A',
    },
    {
      id: 'database',
      prompt: 'What datastore?',
      options: [
        { key: 'A', label: 'Azure Database for PostgreSQL Flexible Server', note: 'the default — relational, HA, backups, point-in-time restore' },
        { key: 'B', label: 'Azure SQL', note: 'if a Microsoft / SQL Server shop' },
        { key: 'C', label: 'Cosmos DB', note: 'only if genuinely document- or globally-distributed-shaped' },
      ],
      recommend: 'A',
    },
    LOCAL_DEV_DECISION,
  ],
  securityRules: [
    'Tenant isolation is the top invariant: scope EVERY query and write to the caller’s tenant server-side — a user must never read or write another tenant’s data through any endpoint, and the UI is not the enforcement point.',
    'Only the edge is public: terminate TLS and run a WAF at Azure Front Door; the backend, data, and workers are NOT reachable directly from the internet.',
    'The API gateway validates JWTs (issuer, audience, expiry) and enforces rate limits / quotas; the backend still re-checks business authorization and subscription state — never trust the gateway alone.',
    'Use managed identity for all service-to-service access (database, storage, Key Vault, Service Bus) — no connection-string or key secrets in application configuration.',
    'Store every secret (Stripe keys, webhook secret, certs, encryption keys) in Key Vault and fetch it via managed identity — never in code, config, argv, logs, or a commit.',
    'Reach data services (PostgreSQL, Blob, Key Vault) only over private endpoints / VNet integration with Private DNS — disable public network access.',
    'Least-privilege RBAC on every Azure resource; each environment (dev / test / prod) is fully isolated with its own app registrations and its own Stripe keys.',
    'Background work goes through a durable queue (Service Bus) with retries and dead-letter handling — never block a request on long work, and make handlers idempotent.',
    'If the app stores files, use private object storage (no anonymous access) reached over a private endpoint, with malware scanning (Defender for Storage) enabled.',
    LOCAL_DEV_SECURITY_RULE,
  ],
  envVars: [
    'DATABASE_URL',
    'AUTH_ISSUER',
    'AUTH_CLIENT_ID',
    'AUTH_CLIENT_SECRET',
    'APP_BASE_URL',
    'KEY_VAULT_URI',
    'SERVICE_BUS_NAMESPACE',
    'APPLICATIONINSIGHTS_CONNECTION_STRING',
  ],
  localServices: [
    { service: 'PostgreSQL database', localVia: 'docker-compose (postgres:16 image)', connectionEnv: 'DATABASE_URL' },
  ],
  dataEntities: [
    { name: 'Organization', fields: ['id', 'name', 'plan', 'status', 'created_at', 'updated_at'] },
    { name: 'User', fields: ['id', 'email', 'created_at', 'updated_at'] },
    { name: 'Membership', fields: ['id', 'organization_id', 'user_id', 'role', 'created_at'] },
    { name: 'Entitlement', fields: ['id', 'organization_id', 'plan', 'status', 'current_period_end', 'stripe_subscription_id', 'created_at', 'updated_at'] },
  ],
  acceptanceCriteria: [
    {
      forTask: 'tenant isolation / multi-tenancy',
      criteria: [
        'A user in one tenant cannot read or write any other tenant’s data through any endpoint, verified by a test that attempts cross-tenant access and is denied.',
        'Every data query is scoped by tenant server-side; the tenant is derived from the authenticated identity, never from a client-supplied id.',
        'New records are stamped with the caller’s tenant automatically.',
      ],
    },
    {
      forTask: 'authentication / access',
      criteria: [
        'A user signs in via the identity provider and is returned authenticated; logout clears all cookies and local storage.',
        'Protected APIs reject a missing, invalid, or expired JWT; the backend enforces role and subscription checks server-side.',
        'No passwords, tokens, or secrets appear in logs or error messages.',
      ],
    },
    {
      forTask: 'billing / subscriptions',
      criteria: [
        'Entitlements reflect the subscription state from verified provider webhooks; access is granted or revoked when a plan starts, changes, or lapses.',
        'Webhook handling verifies the signature and is idempotent — a duplicate event does not double-apply.',
        'The billing store is the source of truth for what a tenant may access.',
      ],
    },
    {
      forTask: 'production hardening / go-live',
      criteria: [
        'Secrets exist only in Key Vault — none in code, config, or the repo — and are read via managed identity.',
        'The database and storage have no public network access; they are reachable only over private endpoints, and a public-connection attempt fails.',
        'A WAF is enabled at the edge, and Application Insights + Log Analytics collect logs/metrics with at least one alert wired.',
        'PostgreSQL backups and point-in-time restore are enabled, and a restore has been tested.',
        'dev / test / prod are separate with their own app registrations and Stripe keys, and all infrastructure is provisioned from committed IaC.',
      ],
    },
  ],
  nonGoals: [
    'Multi-cloud portability as a v1 goal — this targets Azure (keep the IaC cloud-agnostic only where that is cheap; do not abstract for clouds you are not shipping on).',
    'Single-tenant / per-customer deployments — v1 is pooled multi-tenant with row-level isolation, not a separate stack per customer.',
    'Reimplementing billing — the payments overlay (Stripe) is the source of truth; do not build proration, invoicing, or card handling yourself.',
  ],
  // node/git baseline + docker (local Postgres/Redis for dev) + az/terraform for the Azure
  // IaC + deploy. (This template is parked under "Disabled templates" today; the declaration
  // is ready for when it re-enables — the setup panel + login tasks light up automatically.)
  buildTools: ['node', 'git', 'docker', 'az', 'terraform'],
};

// AI SaaS on a Budget: the "no direct AI exposure" architecture. A Cloudflare Pages +
// Supabase web stack where the BROWSER NEVER CALLS THE AI — every request is brokered
// server-side (Supabase Edge Function), gated (auth/tenant/subscription/model-allow-list/
// quota), then sent to a managed RunPod SERVERLESS GPU endpoint via a RESTRICTED,
// endpoint-scoped RunPod API key kept only in server secrets. Budget lever: RunPod
// serverless scales to ZERO (workersMin=0) and bills per-second GPU only while a worker
// runs, with a workersMax cap — idle costs nothing. Distinct from the Azure SAAS base:
// managed per-second GPU inference (no always-on host to operate) with Supabase RLS tenant
// isolation, and a hard "never expose" list (the RunPod API key / broad account key, the
// service_role key in the frontend, the raw RunPod endpoint as a user-facing API). Billing
// rides the payments overlay. NOTE: this base is keyed to Supabase-native names (SUPABASE_URL,
// "Supabase local stack", private buckets) rather than the overlay-natural keys, so the
// auth/database/storage overlays are declared in `provides` (shown "included"/disabled and
// never re-composed) — Supabase already provides auth + Postgres + storage.
const SAAS_AI_BUDGET: Blueprint = {
  kind: 'base',
  // Supabase already bakes in auth, Postgres, and storage; transactional email (Postmark) is
  // baked into this base too — so those overlays show as "included" (disabled) and are never
  // re-composed (their non-Supabase / contact-form keys would diverge or be irrelevant).
  provides: ['authentication', 'database', 'storage', 'email'],
  intakeQuestions: [
    { id: 'ai-use', question: 'What does the product use AI for (the core AI feature), and what does a user send and get back?', critical: true, group: 'needs' },
    { id: 'tenancy', question: 'What is a tenant (organization / workspace / just individual users), and what must stay isolated between tenants?', critical: true, group: 'needs' },
    { id: 'users', question: 'Who are the users and roles, and how do they sign in?', critical: true, group: 'needs' },
    { id: 'ai-gating', question: 'Which subscription tiers / roles get AI access, and what are the per-user / per-tenant usage limits (quotas)?', critical: true, group: 'needs' },
    { id: 'models', question: 'Which open model(s) should the RunPod worker serve, and what latency is acceptable (serverless cold starts vs an always-on pod)?', critical: true, group: 'integrations' },
    { id: 'billing', question: 'What is the subscription / billing model (plans, per-seat or usage, free trial)?', critical: true, group: 'integrations' },
    { id: 'product-email', question: 'What transactional/product emails does v1 send (billing receipts, usage/quota alerts, invites, notifications) — beyond the signup/password emails Supabase Auth already sends?', critical: true, group: 'integrations' },
    { id: 'uploads', question: 'Does v1 store user files or documents?', critical: true, group: 'needs' },
    { id: 'launch', question: 'Which environments are needed (dev / test / prod), and when does it launch?', critical: false, group: 'launch' },
  ],
  decisions: [
    {
      id: 'auth',
      prompt: 'How should sign-in / identity work? (managed, never hand-rolled)',
      options: [
        { key: 'A', label: 'Supabase Auth', note: 'recommended — already in the stack; issues the JWT the RLS policies and AI gate read; enable MFA at least for admin accounts' },
        { key: 'B', label: 'External IdP federated into Supabase', note: 'Entra / Clerk / Auth0 — only if an org SSO is required; more wiring' },
      ],
      recommend: 'A',
    },
    {
      id: 'database',
      prompt: 'What datastore?',
      options: [
        { key: 'A', label: 'Supabase Postgres (with RLS)', note: 'recommended — the stack default; row-level security is the tenant-isolation mechanism' },
        { key: 'B', label: 'External managed Postgres', note: 'Neon / RDS — only if you outgrow Supabase limits; you re-implement the RLS/auth glue' },
      ],
      recommend: 'A',
    },
    {
      id: 'ai-endpoint',
      prompt: 'How should the RunPod AI inference be hosted?',
      options: [
        { key: 'A', label: 'RunPod Serverless endpoint (workersMin=0)', note: 'recommended for budget — scales to ZERO when idle (pay per-second GPU only while running); set a workersMax cap; accept cold-start latency' },
        { key: 'B', label: 'RunPod Dedicated pod (always-on)', note: 'only if you need low, consistent latency — a fixed 24/7 GPU bill even when idle' },
      ],
      recommend: 'A',
    },
    {
      id: 'ai-runtime',
      prompt: 'What inference runtime runs in the RunPod worker container?',
      options: [
        { key: 'A', label: 'vLLM', note: 'recommended for throughput — fast, OpenAI-compatible serving of open models' },
        { key: 'B', label: 'Ollama (in the container)', note: 'simplest to package; also what you can run locally for dev' },
        { key: 'C', label: 'Hugging Face TGI', note: 'solid alternative; heavier image' },
      ],
      recommend: 'A',
    },
    {
      id: 'ai-models',
      prompt: 'Which model(s) should the worker serve? (every served model must be on an allow-list)',
      options: [
        { key: 'A', label: 'A small/efficient open model on a modest GPU', note: 'recommended for budget — cheaper per-second GPU and faster cold starts; lower quality ceiling' },
        { key: 'B', label: 'A larger open model on a bigger GPU', note: 'better quality; higher per-second cost and slower cold start' },
        { key: 'C', label: 'A small allow-list of several, chosen per request', note: 'flexible, but the gate must reject any model not on the approved list' },
      ],
      recommend: 'A',
    },
    {
      id: 'email-provider',
      prompt: 'Which transactional email provider for product/billing email (receipts, usage alerts, invites)? Supabase Auth already sends the signup/password emails.',
      options: [
        { key: 'A', label: 'Postmark', note: 'recommended — fast, reliable transactional delivery; generous free tier' },
        { key: 'B', label: 'Resend', note: 'developer-friendly, generous free tier' },
        { key: 'C', label: 'Supabase Auth only (no product email yet)', note: 'only if v1 truly sends nothing beyond auth emails' },
      ],
      recommend: 'A',
    },
    LOCAL_DEV_DECISION,
  ],
  securityRules: [
    'The browser NEVER calls the AI directly: every AI request is brokered server-side by a Supabase Edge Function (using the service role); client code and the anon/publishable key never reach RunPod.',
    'Protect the PUBLIC web edge at Cloudflare, not just the AI path: enable WAF + DDoS protection + bot/rate-limit rules on the marketing site and client app (bot traffic burns GPU budget), and serve the Pages app with security headers (CSP, HSTS) plus Turnstile on abuse-prone forms.',
    'Tenant isolation is the top invariant: enable Supabase Row Level Security on every API-exposed table and scope every row to the caller’s tenant/user — the client uses the anon key under RLS, and the service_role key is used ONLY server-side, never shipped to the browser.',
    'Gate every AI request server-side before it leaves: validate the user JWT, tenant/org, role, subscription/entitlement, the requested model against an allow-list, prompt size, and per-user/per-tenant quotas — deny by default (fail closed).',
    'Call RunPod with a RESTRICTED API key scoped to the single inference endpoint, stored ONLY in server secrets (the Edge Function environment) and rotated/usage-monitored — never a broad account key, and never shipped to the browser.',
    'The raw RunPod endpoint is NEVER a user-facing API: only the server-side broker calls it; clients hit your Edge Function, which calls RunPod.',
    'Cap GPU spend in the platform: run the serverless endpoint with workersMin=0 (scale to zero when idle) and a workersMax ceiling, and enforce per-request timeouts and a max prompt/output size on the worker.',
    'The worker persists only approved models on the network volume / model cache — no raw user data on the volume by default; serve ONLY allow-listed models.',
    'Never log raw prompts or model responses; store only AI request metadata (actor, tenant, model, token/seconds counts, status) for audit. The status is a fixed enum (allowed / denied / quota / invalid-model / error), the model is recorded only when it matched the allow-list (otherwise a constant), and no verbatim error string or user content is persisted.',
    'Store uploads in Supabase private buckets (never public buckets); serve them only via short-lived signed URLs or RLS — never a public path.',
    'Keep every secret server-side only — the RunPod restricted API key, the Supabase service_role key, Stripe keys / webhook secret, and the Postmark server token live in server / Edge-Function / CI environment config, never in client code, argv, logs, or a commit.',
    'Send transactional email server-side only (never from the browser): the Postmark token stays in server secrets, sends are idempotent (a duplicate billing/quota event must not re-send), and provider error details are never leaked to the client. In local dev use a Postmark sandbox/test token, never the production server token.',
    LOCAL_DEV_SECURITY_RULE,
  ],
  envVars: [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'RUNPOD_API_KEY',
    'RUNPOD_ENDPOINT_ID',
    'ALLOWED_MODELS',
    'INFERENCE_BASE_URL',
    'APP_BASE_URL',
    'POSTMARK_SERVER_TOKEN',
    'POSTMARK_FROM_EMAIL',
  ],
  localServices: [
    { service: 'Supabase local stack (Auth + Postgres + Storage)', localVia: 'supabase CLI (`supabase start`, Docker-based)', connectionEnv: 'SUPABASE_URL' },
    { service: 'Local model server for dev (e.g. Ollama / the worker image)', localVia: 'docker / podman (ollama image) — pull one small model; avoids burning RunPod GPU while developing', connectionEnv: 'INFERENCE_BASE_URL' },
  ],
  dataEntities: [
    { name: 'Organization', fields: ['id', 'name', 'plan', 'status', 'created_at', 'updated_at'] },
    { name: 'User', fields: ['id', 'email', 'created_at', 'updated_at'] },
    { name: 'Membership', fields: ['id', 'organization_id', 'user_id', 'role', 'created_at'] },
    { name: 'Entitlement', fields: ['id', 'organization_id', 'plan', 'status', 'current_period_end', 'stripe_subscription_id', 'created_at', 'updated_at'] },
    { name: 'AiRequestAudit', fields: ['id', 'organization_id', 'user_id', 'model', 'prompt_tokens', 'completion_tokens', 'status', 'created_at'] },
  ],
  acceptanceCriteria: [
    {
      forTask: 'ai access path / no direct exposure',
      criteria: [
        'The browser cannot reach RunPod directly and never receives the RunPod API key — every AI call goes through the server-side broker, verified by inspecting client network traffic (no RunPod request, no key in the bundle).',
        'A request with a missing subscription/entitlement, an over-quota user, or a non-allow-listed model is denied server-side (fail closed) before any RunPod worker is invoked.',
        'The raw RunPod endpoint is not exposed as a user-facing API; only the Edge Function calls it.',
      ],
    },
    {
      forTask: 'tenant isolation / RLS',
      criteria: [
        'RLS is enabled on every API-exposed table; a user in one tenant cannot read or write another tenant’s rows through the anon key, verified by a cross-tenant access test that is denied.',
        'The service_role key is used only in server-side Edge Functions and never shipped to the browser.',
        'New rows are stamped with the caller’s tenant automatically.',
      ],
    },
    {
      forTask: 'billing / subscriptions',
      criteria: [
        'Entitlements reflect verified Stripe webhook state; AI access is granted or revoked when a plan starts, changes, or lapses.',
        'Webhook handling verifies the signature and is idempotent — a duplicate event does not double-apply.',
      ],
    },
    {
      forTask: 'ai audit / cost control',
      criteria: [
        'Each AI request writes an audit row with actor, tenant, model, token/seconds counts, and status — and NO raw prompt or response text.',
        'The serverless endpoint runs with workersMin=0 and a workersMax cap; budget alerts / caps are configured.',
        'Per-user / per-tenant quotas are enforced and a quota breach is visible in the audit data.',
      ],
    },
    {
      forTask: 'transactional email',
      criteria: [
        'A billing/usage event (e.g. receipt, quota-reached) sends exactly one email to the right recipient via the server-side provider — verified without re-sending on a duplicate event (idempotent).',
        'The Postmark server token is read from the environment and is never in client code, the bundle, or a commit; local dev uses a sandbox/test token.',
        'A provider failure surfaces a distinct, logged error state without leaking provider details to the client, and does not break the originating action (e.g. the subscription still updates).',
      ],
    },
    {
      forTask: 'production hardening / go-live',
      criteria: [
        'All secrets (RunPod restricted key, Supabase service_role, Stripe keys, Postmark token) live only in server / CI environment config — none in client code or the repo — and the RunPod key is endpoint-scoped, not a broad account key.',
        'RLS is on and storage buckets are private; a WAF + rate-limit policy is active at the public Cloudflare edge.',
        'The RunPod endpoint serves only allow-listed models; idle workers scale to zero (workersMin=0) and a workersMax cap is set.',
        'Raw prompts and responses are not logged anywhere.',
      ],
    },
  ],
  nonGoals: [
    'Exposing the RunPod endpoint or its API key to the browser, or as a public user-facing API.',
    'An always-on dedicated GPU you pay for 24/7 — default to RunPod serverless (workersMin=0) and only add a dedicated pod if latency genuinely demands it.',
    'Reimplementing billing — the payments overlay (Stripe) is the source of truth for entitlements.',
    'Long synchronous AI generations that block a serverless invocation past the Edge Function timeout — RunPod serverless has cold starts and long generations, so submit an async RunPod job and poll/stream rather than blocking.',
    'Bulk / marketing email campaigns — transactional product email only (receipts, alerts, invites).',
    'Multi-cloud portability as a v1 goal.',
  ],
  // node/git baseline + docker (Supabase local stack & local model server) +
  // supabase/wrangler/stripe for the Cloudflare+Supabase+Stripe stack. RunPod
  // needs no local CLI (HTTP API + a restricted key set up in the dashboard).
  buildTools: ['node', 'git', 'docker', 'supabase', 'wrangler', 'stripe'],
};

// Personal Finance — a product-grade FINANCIAL DATA OPERATING SYSTEM. Connect every money
// source, ingest the RAW provider payloads unchanged, normalize into ONE canonical ledger,
// reconcile transfers so nothing double-counts, derive net-worth / cash-flow / income / debt /
// investment / tax views, and keep PROVENANCE on every number. PLAID is the PRIMARY consumer
// source; STRIPE is the BUSINESS/revenue source. Built MULTI-TENANT + cloud-deployable from
// day one, but runs locally first (Postgres in Docker on Windows, Plaid Sandbox + Stripe Test).
// READ-ONLY: it organizes money, never moves it. provides:['authentication','database','storage']
// (mirrors saas-ai-budget) — those overlays show "included" + are never re-composed, so the base
// OWNS the auth/database/storage decisions, rules, env vars, entities, and localServices. Lists
// the shared LOCAL_DEV_DECISION + LOCAL_DEV_SECURITY_RULE INLINE (composeBlueprint never injects them).
const PERSONAL_FINANCE: Blueprint = {
  kind: 'base',
  provides: ['authentication', 'database', 'storage'],
  intakeQuestions: [
    { id: 'money-sources', question: 'Which money sources do you want to connect first — personal bank/credit/loan/investment accounts via Plaid, business/revenue via Stripe, or both — and roughly how many institutions/accounts of each?', critical: true, group: 'integrations' },
    { id: 'plaid-products', question: 'Which Plaid products does v1 need: Transactions (the floor), then Auth, Balance, Liabilities, Investments, Income, Statements, Identity, Recurring? Each is a separate Plaid product + consent scope.', critical: true, group: 'integrations' },
    { id: 'stripe-scope', question: 'For Stripe, is it your OWN merchant account (a restricted secret key) or your users’ accounts (Stripe Connect/OAuth)? Which objects matter — charges, refunds, disputes, fees, payouts, invoices, subscriptions, Stripe Tax?', critical: true, group: 'integrations' },
    { id: 'core-questions', question: 'Which questions must the canonical ledger answer on day one — cash on hand, net worth, monthly spend, business income from Stripe, upcoming card payments, retirement allocation, deductible/tax transactions?', critical: true, group: 'needs' },
    { id: 'tenancy', question: 'Is this just you, or a household/entity model (multiple logins, joint accounts, shared categories)? And even for just you, should we keep it multi-tenant + row-level isolated from the start so it can become a product? This sets the isolation boundary.', critical: true, group: 'needs' },
    { id: 'transfer-edge', question: 'Which double-counting cases must be right for you — a paycheck seen as both payroll income and a deposit, checking->savings, a checking->credit-card payment, a Stripe payout that later lands as a bank deposit via Plaid, refunds?', critical: true, group: 'needs' },
    { id: 'manual-data', question: 'Which things you can’t pull from a provider must be tracked by hand (property/home value, cash, collectibles, private investments, insurance policies, equity comp/RSUs, deposit APY)? These are modeled as manual/inferred with confidence, never assumed.', critical: false, group: 'needs' },
    { id: 'documents', question: 'Do you want to store and view source documents (statements, paystubs, tax forms, receipts, invoices) alongside the data, and roughly what volume?', critical: false, group: 'needs' },
    { id: 'auth-mfa', question: 'How should sign-in work, what roles exist (owner / member / read-only / accountant), and is MFA required for everyone or just elevated roles? Managed provider, never hand-rolled.', critical: true, group: 'launch' },
    { id: 'compliance-posture', question: 'This will hold real consumer financial data (FTC Safeguards info-security program) — do you want MFA, audit logging, and a user data export+deletion flow in v1? And do you confirm you will NOT use it for any credit/employment/housing/insurance ELIGIBILITY decision (which would trigger FCRA)?', critical: true, group: 'launch' },
    { id: 'deployment', question: 'v1 runs locally on Windows against Docker Postgres with Plaid Sandbox + Stripe Test. When (if ever) does it deploy to the cloud for real provider data, and to which platform/KMS?', critical: false, group: 'launch' },
  ],
  decisions: [
    {
      id: 'frontend',
      prompt: 'How should the app be built and opened — and what is the recommended default shape?',
      options: [
        { key: 'A', label: 'Single Next.js (App Router) + TypeScript web app at localhost, server-rendered', note: 'recommended — one service to build/typecheck/test on Windows, route handlers are the server-side trust boundary, the same app is cloud-deployable later. Open http://localhost in your browser.' },
        { key: 'B', label: 'React + Vite SPA + a separate Node API (Fastify/Express/Nest)', note: 'cleaner web/api split if the API grows, but two build/test surfaces plus CORS/config glue — more overhead than this needs at v1.' },
        { key: 'C', label: 'Installed desktop app (Electron/Tauri) wrapping the web app', note: 'a true double-click app, but heavier Windows packaging/signing and slower QA gates; cleanest as a LATER add-on around the same local web app, not v1.' },
      ],
      recommend: 'A',
    },
    {
      id: 'api-layer',
      prompt: 'How should the UI and the server logic be organized?',
      options: [
        { key: 'A', label: 'Next.js App Router route handlers (one service) + Prisma', note: 'recommended — ONE process, one build + one test command, the richest typecheck/build/test gates and fewest moving parts; route handlers give typed server calls with no separate API or CORS.' },
        { key: 'B', label: 'Next.js + tRPC', note: 'end-to-end typed RPC with no REST boilerplate; nice DX but extra library surface — the route handlers already give typed server calls.' },
        { key: 'C', label: 'A standalone API service consumed by the UI', note: 'only if the API will be consumed by multiple clients (mobile, third parties) — otherwise it’s two surfaces to build and secure for no v1 benefit.' },
      ],
      recommend: 'A',
    },
    {
      id: 'orm',
      prompt: 'Which ORM / migrations tool over PostgreSQL?',
      options: [
        { key: 'A', label: 'Prisma', note: 'recommended — excellent DX, first-class migrations that re-run from empty, strong Windows support, and a Decimal type that maps to Postgres NUMERIC so money stays exact across the canonical ledger.' },
        { key: 'B', label: 'Drizzle ORM + drizzle-kit', note: 'lighter runtime and more direct SQL for the raw/JSONB and materialized-view work, but you own more migration plumbing and the Decimal/NUMERIC mapping yourself.' },
        { key: 'C', label: 'Raw SQL / a query builder, no ORM', note: 'maximum control over the complex normalization/reconciliation queries, but you give up generated types and managed migrations — more boilerplate and more chances for an unparameterized query.' },
      ],
      recommend: 'A',
    },
    {
      id: 'auth',
      prompt: 'How should sign-in / identity / RBAC / MFA work? (managed, never hand-rolled — this is multi-tenant fintech)',
      options: [
        { key: 'A', label: 'Managed auth (Auth.js over the local Postgres for dev) + RBAC roles + TOTP MFA', note: 'recommended — runs fully local for dev (no cloud IdP bill, testable on Windows), issues the session every row-level query reads, supports RBAC + MFA + session/device management; swap the OIDC provider for a hosted IdP at deploy without re-architecting.' },
        { key: 'B', label: 'Hosted IdP (Clerk / Microsoft Entra External ID)', note: 'less auth code to own and SSO/MFA out of the box, but a cloud dependency + cost in dev and another secret to vault; choose if org SSO is a hard requirement.' },
        { key: 'C', label: 'Hand-rolled email+password sessions', note: 'do NOT — rolling your own auth for financial data is the classic footgun (session fixation, weak MFA, password storage); explicitly out of scope.' },
      ],
      recommend: 'A',
    },
    {
      id: 'database',
      prompt: 'What relational datastore holds the RAW + CANONICAL + DERIVED layers?',
      options: [
        { key: 'A', label: 'PostgreSQL 16 (Docker locally) via DATABASE_URL — JSONB raw, NUMERIC money, materialized views, RLS', note: 'recommended — one engine does all three layers: JSONB keeps raw provider payloads queryable, NUMERIC(19,4) keeps money exact, materialized views serve the dashboards, and row-level security/scoping enforces tenancy. Runs locally in docker-compose now, cloud-deployable later.' },
        { key: 'B', label: 'PostgreSQL + a document store for raw payloads', note: 'only if raw volume explodes — adds a second engine to run and test locally for little v1 benefit; JSONB handles raw fine at this scale.' },
        { key: 'C', label: 'A document store (Cosmos/Mongo) as the primary', note: 'NOT recommended — the financial graph is deeply relational (accounts<->transactions<->transfer groups<->categories) and the reconciliation joins fight a document store.' },
      ],
      recommend: 'A',
    },
    {
      id: 'storage',
      prompt: 'Where do source DOCUMENTS (statements, paystubs, tax forms, receipts, invoices) live?',
      options: [
        { key: 'A', label: 'S3-compatible object storage (MinIO locally, S3/Blob/R2 in cloud) via STORAGE_*', note: 'recommended — documents are blobs: bytes in object storage, metadata in Postgres, upload/download via short-lived tenant-scoped signed URLs, server-generated keys; run MinIO in docker-compose for local dev. Never stuff document blobs in the database.' },
        { key: 'B', label: 'Local filesystem volume (dev only)', note: 'acceptable only for the earliest local build; doesn’t translate to a multi-tenant cloud product and lacks signed-URL access control — you’d migrate to object storage later anyway.' },
      ],
      recommend: 'A',
    },
    {
      id: 'plaid-env',
      prompt: 'Which Plaid environment for the build/test loop?',
      options: [
        { key: 'A', label: 'Plaid SANDBOX (test institutions, /sandbox/item/fire_webhook to drive webhooks)', note: 'recommended for v1 — deterministic test institutions, no real bank, free; fire SYNC_UPDATES_AVAILABLE on demand via /sandbox/item/fire_webhook so the sync pipeline is testable headless on Windows. Production/Development envs are a later, credentialed phase.' },
        { key: 'B', label: 'Plaid Development/Production (real institutions)', note: 'needed only once you connect real accounts — requires real credentials, a reachable webhook endpoint, and the FTC Safeguards program; not a v1 dependency.' },
      ],
      recommend: 'A',
    },
    {
      id: 'stripe-mode',
      prompt: 'Which Stripe mode + connection for reading business/revenue data?',
      options: [
        { key: 'A', label: 'Stripe TEST mode, your OWN account, restricted read key + `stripe listen` for signed webhooks', note: 'recommended for v1 — the owner’s own merchant data, a read-scoped restricted key from the env, signature-verified idempotent webhooks, all testable in Test mode on Windows via the Stripe CLI.' },
        { key: 'B', label: 'Stripe Connect / OAuth so users link their OWN merchant accounts', note: 'needed only when this becomes a product others use — adds Connect onboarding and per-account tokens to vault; defer past v1 unless multi-merchant is the point.' },
        { key: 'C', label: 'Stripe Financial Connections as a bank source', note: 'can read balances/ownership/transactions but is NARROWER than Plaid for personal finance — use Plaid as the bank source; reach for this only to cover a Stripe-native flow.' },
      ],
      recommend: 'A',
    },
    {
      id: 'sync-architecture',
      prompt: 'How does incremental provider sync (Plaid /transactions/sync cursor + Stripe events) run?',
      options: [
        { key: 'A', label: 'Webhook-driven background worker (BullMQ on Redis, REDIS_URL), separate from the web process', note: 'recommended — Plaid sends SYNC_UPDATES_AVAILABLE and Stripe pushes events; the webhook verifies the signature, enqueues, and returns fast (200), and the worker pulls /transactions/sync with the stored cursor (adds/modifies/removes) and processes Stripe events idempotently with retries — off the request path, so a slow provider can’t time out a webhook or wedge the UI. Runs in the same docker-compose locally.' },
        { key: 'B', label: 'Synchronous in-request processing (no worker/Redis)', note: 'fewer moving parts (no Redis), fine at low volume, but a slow provider pull or a burst of webhooks blocks requests and risks webhook timeouts/retries — you’ll outgrow it.' },
        { key: 'C', label: 'Scheduled polling (cron) instead of webhooks', note: 'simplest, no public webhook endpoint, but data is stale between polls and you miss the real-time SYNC_UPDATES_AVAILABLE signal — use only as a fallback alongside webhooks.' },
      ],
      recommend: 'A',
    },
    {
      id: 'token-vault',
      prompt: 'How are long-lived provider access tokens (Plaid access_token, Stripe keys/Connect tokens) protected at rest?',
      options: [
        { key: 'A', label: 'Field-level encryption (AES-256-GCM) under a KMS-backed key referenced by TOKEN_ENCRYPTION_KEY, server-side only, rotatable', note: 'recommended — tokens are sensitive secrets: encrypt the token column at the application layer with a key from a KMS/secret manager (the data key wrapped by a CMK), decrypt only server-side at call time, support rotation by re-wrapping. Local dev uses a throwaway key from .env.local; cloud uses a real KMS. The browser NEVER receives a token.' },
        { key: 'B', label: 'Database-level / disk encryption only', note: 'protects a stolen disk but NOT a DB read — a leaked query or backup exposes plaintext tokens. Insufficient on its own for provider access tokens; use field-level encryption on the token columns.' },
        { key: 'C', label: 'An external secrets/vault service per token', note: 'strongest isolation but heavyweight to run locally and awkward for many per-connection tokens — field-level encryption with a KMS key is the pragmatic product-grade default; graduate to this if scale demands.' },
      ],
      recommend: 'A',
    },
    {
      id: 'reconciliation',
      prompt: 'How is the transfer-matching / double-count-avoidance engine built?',
      options: [
        { key: 'A', label: 'Deterministic rules first (amount + date window + account + counterparty + description + source IDs) with a confidence score and user confirm', note: 'recommended — match offsetting movements into TransferGroups (internal transfer, debt payment, refund/reversal, Stripe-payout->bank) with explicit, testable rules and a confidence; auto-link high-confidence pairs, surface medium-confidence for one-tap confirm, never auto-merge a low-confidence match. Auditable, explainable, and the only safe place to start.' },
        { key: 'B', label: 'Rules + a learned/heuristic classifier for ambiguous cases', note: 'better recall on messy data over time, but it must stay EXPLAINABLE and never auto-merge a low-confidence match — layer it ON TOP of A once the rule engine is solid, never instead of it.' },
        { key: 'C', label: 'Manual-only reconciliation (user merges transfers by hand)', note: 'always correct but doesn’t scale past a handful of accounts — keep manual override as the escape hatch, not the primary mechanism.' },
      ],
      recommend: 'A',
    },
    {
      id: 'money-representation',
      prompt: 'How are money amounts stored and computed across every layer? (the non-negotiable rule)',
      options: [
        { key: 'A', label: 'NUMERIC/DECIMAL(19,4) via Prisma Decimal + one shared lib/money module', note: 'recommended — exact decimal arithmetic mapping to Postgres NUMERIC, all math in ONE module with a defined rounding mode (round half-up to the currency’s minor unit). Stores BOTH the raw provider amount and the canonical signed amount as Decimal.' },
        { key: 'B', label: 'Integer minor units (cents as BIGINT) per currency', note: 'also exact and fast, but needs careful per-currency scaling and formatting across multi-currency holdings — Decimal is friendlier given investments and FX. Whichever you pick, NEVER a JS number/float for money.' },
      ],
      recommend: 'A',
    },
    {
      id: 'hosting',
      prompt: 'Where does it run, and what is the path to production?',
      options: [
        { key: 'A', label: 'Local on Windows via docker-compose (Postgres + Redis + MinIO), Plaid Sandbox + Stripe Test', note: 'recommended for v1 — the whole pipeline is buildable and ONE-SHOT testable on the owner’s machine with sandbox/test creds and throwaway secrets in .env.local; the cloud deploy is a later phase, not a v1 dependency, so no cloud CLI is forced into the build.' },
        { key: 'B', label: 'A container host + managed Postgres/Redis/object-storage + a real KMS on any cloud', note: 'the eventual product target — needs real Plaid/Stripe credentials, a KMS, a public webhook endpoint, and the FTC Safeguards program; architect for it now (multi-tenant, vaulted tokens, env-driven config) but ship local first.' },
      ],
      recommend: 'A',
    },
    LOCAL_DEV_DECISION,
  ],
  securityRules: [
    'MONEY IS DECIMAL, NEVER FLOAT. Store every amount as NUMERIC/DECIMAL (e.g. NUMERIC(19,4)) or integer minor units — never FLOAT/DOUBLE/REAL and never a JS number for money. Store BOTH the raw provider amount AND the canonical signed amount. Do ALL arithmetic with Prisma Decimal / a decimal library in ONE shared money module with a defined rounding mode (round half-up to the currency’s minor unit). Floating-point money is a defect.',
    'Use the canonical SIGN CONVENTION consistently: canonical_amount is POSITIVE when money increases the user’s wealth/cash and NEGATIVE when it decreases it. Convert each provider’s sign at the ingestion edge — PLAID’s convention is the OPPOSITE of accounting for MOST products (positive = money OUT, negative = money IN), BUT the Plaid INCOME endpoints are an EXCEPTION and must NOT be inverted; STRIPE balance transactions: positive = funds charged to another party, negative = funds sent to another party. A sign bug silently corrupts every derived total — unit-test the conversion per provider/product, including the Plaid-income exception.',
    'MULTI-TENANT ROW-LEVEL AUTHORIZATION is the top invariant: every table that holds financial data carries a tenant/user (or household) scope, and EVERY query and write is scoped to the authenticated caller’s tenant — a user can NEVER read or write another tenant’s data through any endpoint. The tenant is derived from the authenticated identity, never a client-supplied id; enforce it at the data-access layer (and Postgres RLS where practical), stamp new rows with the caller’s tenant automatically, and cover it with a cross-tenant denial test.',
    'Provider ACCESS TOKENS are long-lived sensitive secrets: store them server-side ONLY, VAULTED with field-level encryption (AES-256-GCM) under a KMS-backed key (TOKEN_ENCRYPTION_KEY), rotatable; the browser NEVER receives a Plaid access token, a Stripe secret key, or any provider token. Tokens never appear in argv, logs, error output, client bundles, a URL, or a commit, and never inside a persisted raw payload.',
    'Store the RAW provider layer UNCHANGED and IMMUTABLE: persist every Plaid/Stripe API response and webhook payload exactly as received (provider, provider_object_id, api_version, fetched_at, payload_hash, payload_json, user_id, connection_id) for audit, debug, reprocessing, and schema upgrades — normalization reads from raw and writes a SEPARATE canonical layer; never edit a raw row in place (an update/removal is a NEW raw event).',
    'VERIFY EVERY WEBHOOK SIGNATURE before trusting a payload — Plaid via its JWT public-key verification flow, Stripe via the signing-secret signature — and reject anything that fails. Make handling IDEMPOTENT: key an idempotency log on the provider event id so a duplicate/redelivered webhook is processed at most once. Treat webhook content as ADVISORY and re-fetch authoritative data server-side rather than trusting the payload’s numbers.',
    'RECONCILE transfers to avoid double-counting and keep DISTINCT concepts (true income vs internal transfer vs debt payment vs refund/reversal vs fee vs investment trade vs contribution vs tax payment); separate money MOVEMENT (transaction_type) from financial MEANING (classification_intent). Never auto-merge a low-confidence transfer match — surface it for user confirmation and record the match decision (confidence, matched_by, source_ids).',
    'PROVENANCE on every value: track SOURCE, TIMESTAMP, CONFIDENCE, and whether the value is OBSERVED / INFERRED / USER-ENTERED / CALCULATED. Never trust a single source as complete and never present an inferred/stale value as an observed fact; values the providers cannot reliably give (APY, rewards, full credit report/score, exact tax liability, equity comp, property/insurance/collectible values, complete cost basis) are NULLABLE + manual/inferred with confidence — never assumed, and a missing value renders ‘unknown’, not 0.',
    'PII MINIMIZATION + no sensitive logging: store only a last-4 mask for account/card numbers — never the full account/routing number — and never log tokens, raw provider payloads, full numbers, or secrets; redact sensitive values in error output. PCI: NEVER store raw card PANs (Stripe handles cardholder data) — keep the app out of PCI cardholder-data scope.',
    'Use parameterized queries / the ORM query builder for EVERY database access — never build SQL by string concatenation, especially for provider-supplied merchant/description/category fields and any document filename. Guard CSV/document exports against formula-injection (cells starting with =,+,-,@).',
    'Use a MANAGED auth provider with RBAC, MFA, and session/device management — never hand-roll password storage or sessions. Authorize every API route server-side by role; reject a missing/invalid/expired token; session cookies are httpOnly/Secure/SameSite, short-lived, and revocable. Require MFA at least for accounts/roles that can read financial data.',
    'Maintain an IMMUTABLE AUDIT LOG (append-only, tenant-scoped, no secret values or raw payloads) for every security-relevant action: connection add/remove, token create/use/rotate, consent change, sync, manual financial edit, data export, deletion, and role change — the audit trail itself cannot be edited or deleted through the app.',
    'Store uploaded documents in a PRIVATE object-storage bucket with SERVER-GENERATED keys, served only via SHORT-LIVED signed URLs scoped to the owning tenant — never a public bucket/path, never a client-supplied storage key, never a DB blob; validate content-type against an allowlist and enforce a max size server-side, and strip path traversal from any uploaded filename.',
    'Background sync goes through a durable queue (Redis/BullMQ) with retries, dead-lettering, and idempotent handlers — never block a request on a full provider sync; the worker is the only component that decrypts tokens and calls providers.',
    'FTC SAFEGUARDS posture: maintain an information-security program (administrative, technical, and physical safeguards) appropriate to a custodian of consumer financial data — access controls, encryption in transit and at rest, least-privilege non-superuser DB roles, change management, logging/monitoring, vendor diligence, and incident handling. FCRA FENCE: this app records and organizes data; it does NOT make any credit/employment/housing/insurance ELIGIBILITY decision — do not become a consumer-reporting use without counsel.',
    'Provide a user-facing DATA EXPORT and DELETION flow: a user can export ALL of their data (raw + canonical + documents) to a user-chosen location (never committed, with no plaintext tokens or full numbers in the artifact), and a deletion request removes every record and document scoped to the tenant AND revokes/forgets provider connections — both are auditable and complete.',
    'READ-ONLY by design: the app never initiates a transfer, payment, trade, or any money movement — request only read scopes from Plaid/Stripe, and there is no code path that moves money.',
    'Evolve the schema only through committed migrations that re-run reproducibly from EMPTY; connect to Postgres with a least-privilege non-superuser role where practical.',
    LOCAL_DEV_SECURITY_RULE,
  ],
  envVars: [
    'DATABASE_URL', 'REDIS_URL', 'APP_BASE_URL', 'AUTH_SECRET', 'AUTH_ISSUER', 'AUTH_CLIENT_ID',
    'AUTH_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY', 'STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_REGION',
    'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_ENV',
    'PLAID_PRODUCTS', 'PLAID_COUNTRY_CODES', 'PLAID_WEBHOOK_VERIFICATION', 'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_CLIENT_ID',
  ],
  localServices: [
    { service: 'PostgreSQL database (RAW + CANONICAL + DERIVED layers)', localVia: 'docker-compose (postgres:16 image)', connectionEnv: 'DATABASE_URL' },
    { service: 'Sync queue / worker backend (Redis + BullMQ for webhook-driven Plaid/Stripe incremental sync)', localVia: 'docker-compose (redis:7 image)', connectionEnv: 'REDIS_URL' },
    { service: 'Document object storage (statements / paystubs / tax forms / receipts / invoices)', localVia: 'docker-compose (MinIO, S3-compatible)', connectionEnv: 'STORAGE_ENDPOINT' },
  ],
  dataEntities: [
    { name: 'RawPlaidObject', fields: ['id', 'user_id (tenant scope)', 'connection_id (FK)', 'provider (‘plaid’)', 'object_type (item | account | transaction | holding | security | liability | income | statement)', 'provider_object_id', 'event_type (added | modified | removed, nullable)', 'api_version', 'webhook_or_pull (enum)', 'sync_cursor (nullable, for /transactions/sync)', 'fetched_at', 'payload_hash', 'payload_json (JSONB — UNCHANGED Plaid payload)', 'created_at'] },
    { name: 'RawStripeObject', fields: ['id', 'user_id (tenant scope)', 'connection_id (FK)', 'provider (‘stripe’)', 'object_type (event | balance_transaction | charge | refund | dispute | payout | invoice | subscription | tax_transaction)', 'provider_object_id', 'stripe_event_id (nullable, for idempotency)', 'api_version', 'fetched_at', 'payload_hash', 'payload_json (JSONB — UNCHANGED Stripe payload)', 'created_at'] },
    { name: 'WebhookEvent', fields: ['id', 'provider (plaid | stripe)', 'provider_event_id (UNIQUE — idempotency key)', 'event_type', 'signature_verified (bool)', 'received_at', 'processed_at (nullable)', 'status (received | processing | processed | duplicate | failed)', 'raw_ref (FK to RawPlaidObject/RawStripeObject, nullable)', 'error_message (nullable, redacted)', 'user_id (FK, nullable)'] },
    { name: 'Tenant', fields: ['id (household/entity scope for row-level authz)', 'name', 'type (individual | household | entity)', 'base_currency_code', 'created_at', 'updated_at'] },
    { name: 'User', fields: ['id', 'tenant_id (FK)', 'email', 'auth_provider_id', 'role (owner | member | read_only | accountant)', 'mfa_enabled (bool)', 'status', 'last_login_at', 'created_at', 'updated_at'] },
    { name: 'FinancialConnection', fields: ['id', 'user_id (tenant scope)', 'tenant_id (FK)', 'provider (plaid | stripe)', 'institution_id (FK, nullable)', 'provider_item_id (Plaid item_id / Stripe account id)', 'status (good | login_required | error | reauth_required | revoked | disconnected)', 'consent_state', 'consent_scopes (JSON — Plaid products / Stripe scopes)', 'token_vault_id (FK -> ProviderTokenVault)', 'cursor (Plaid /transactions/sync cursor, nullable)', 'last_sync_at', 'last_error (nullable)', 'created_at', 'updated_at'] },
    { name: 'ProviderTokenVault', fields: ['id', 'connection_id (FK)', 'provider', 'encrypted_token (field-level encrypted; CIPHERTEXT only — never plaintext)', 'key_id (KMS/CMK reference for rotation)', 'encryption_alg', 'rotated_at', 'created_at'] },
    { name: 'Institution', fields: ['id (canonical)', 'plaid_institution_id (nullable)', 'stripe_account_id (nullable)', 'display_name', 'country_code', 'logo_ref (nullable)', 'created_at'] },
    { name: 'Account', fields: ['id (canonical, stable)', 'user_id (tenant scope)', 'tenant_id (FK)', 'connection_id (FK)', 'provider_account_id (Plaid account_id / Stripe — MAY change on reconnect; NOT the primary key)', 'type (depository | credit | loan | investment | other)', 'subtype (checking | savings | credit_card | mortgage | student | 401k | ira | brokerage | hsa | crypto | ...)', 'mask (last 4 only — NEVER the full number)', 'name', 'official_name (nullable)', 'currency_code', 'status (open | closed | disconnected)', 'is_manual (bool)', 'is_removed (soft-delete bool)', 'created_at', 'updated_at'] },
    { name: 'AccountCapability', fields: ['id', 'account_id (FK)', 'has_transactions (bool)', 'has_auth (bool)', 'has_balance (bool)', 'has_investments (bool)', 'has_liabilities (bool)', 'has_income (bool)', 'has_statements (bool)', 'has_realtime_balance (bool)'] },
    { name: 'BalanceSnapshot', fields: ['id', 'account_id (FK)', 'current (NUMERIC(19,4))', 'available (NUMERIC(19,4), nullable)', 'limit (NUMERIC(19,4), nullable)', 'currency_code', 'as_of (timestamp — a SNAPSHOT, never overwritten)', 'source', 'confidence', 'is_stale (bool)', 'created_at'] },
    { name: 'Transaction', fields: ['id (canonical)', 'user_id (tenant scope)', 'tenant_id (FK)', 'account_id (FK)', 'provider_amount (NUMERIC(19,4) — raw provider sign)', 'canonical_amount (NUMERIC(19,4) — positive=wealth up, negative=wealth down)', 'currency_code', 'date', 'authorized_date (nullable)', 'status (pending | posted | removed | corrected)', 'merchant_id (FK -> MerchantCounterparty, nullable)', 'counterparty (nullable)', 'name_description', 'provider_category_primary', 'provider_category_detailed', 'provider_category_confidence (very_high | high | medium | low | unknown)', 'user_category_id (FK -> Category, nullable override)', 'tax_category (nullable)', 'business_personal_flag (business | personal | mixed | unknown)', 'deductible_flag (bool, nullable)', 'transaction_type (money MOVEMENT: card_spend | ach | wire | transfer | fee | interest | dividend | payroll | refund | payout | trade | ...)', 'classification_intent (financial MEANING: true_income | internal_transfer | debt_payment | refund_reversal | fee | investment_trade | contribution | tax_payment | spend)', 'transfer_group_id (FK -> TransferGroup, nullable)', 'external_id (provider txn id / OFX FITID — for dedup)', 'review_required (bool)', 'raw_ref (FK)', 'is_removed (soft-delete bool)', 'created_at', 'updated_at'] },
    { name: 'TransactionEvent', fields: ['id', 'transaction_id (FK)', 'event_type (add | update | remove | correct)', 'raw_ref (FK -> RawPlaidObject/RawStripeObject, nullable)', 'changed_fields (JSON)', 'source (plaid_sync | stripe | user | reconcile)', 'occurred_at', 'created_at — state HISTORY, never overwrites'] },
    { name: 'TransferGroup', fields: ['id', 'user_id (tenant scope)', 'tenant_id (FK)', 'kind (internal_transfer | card_payment | stripe_payout_to_bank | refund_reversal | other)', 'outflow_transaction_id (FK, nullable)', 'inflow_transaction_id (FK, nullable)', 'amount (NUMERIC(19,4))', 'match_confidence (NUMERIC 0..1)', 'match_signals (JSON: amount, date_window, accounts, counterparty, description, source_ids)', 'matched_by (rule | user_confirmed | heuristic)', 'status (matched | suggested | rejected)', 'created_at', 'updated_at'] },
    { name: 'Category', fields: ['id', 'user_id (tenant scope, nullable for system)', 'name', 'parent_id (FK, nullable — hierarchy)', 'is_system (bool)', 'is_user_defined (bool)', 'tax_category (nullable)', 'is_archived (bool)', 'sort_order', 'created_at', 'updated_at'] },
    { name: 'MerchantCounterparty', fields: ['id', 'user_id (tenant scope)', 'normalized_name', 'raw_names (JSON aliases/variants seen)', 'logo_ref (nullable)', 'default_category_id (FK, nullable)', 'is_payer (bool)', 'created_at', 'updated_at'] },
    { name: 'RecurringStream', fields: ['id', 'user_id (tenant scope)', 'kind (bill | subscription | income)', 'merchant_id (FK, nullable)', 'account_id (FK, nullable)', 'average_amount (NUMERIC(19,4))', 'last_amount (NUMERIC(19,4), nullable)', 'frequency (weekly | biweekly | monthly | yearly | irregular)', 'next_predicted_date (nullable)', 'status (active | inactive | suspected)', 'source (plaid_recurring | inferred | user)', 'confidence', 'created_at', 'updated_at'] },
    { name: 'Liability', fields: ['id', 'account_id (FK)', 'kind (credit_card | student_loan | mortgage | personal_loan | auto_loan)', 'balance (NUMERIC(19,4))', 'credit_limit (NUMERIC(19,4), nullable)', 'utilization (NUMERIC, nullable)', 'minimum_payment (NUMERIC(19,4), nullable)', 'next_due_date (nullable)', 'last_statement_balance (NUMERIC(19,4), nullable)', 'is_overdue (bool)', 'source', 'confidence', 'created_at', 'updated_at'] },
    { name: 'LiabilityTerm', fields: ['id', 'liability_id (FK)', 'apr_type (purchase | cash_advance | balance_transfer | fixed | variable)', 'apr (NUMERIC, nullable)', 'interest_rate (NUMERIC, nullable)', 'term_months (nullable)', 'origination_date (nullable)', 'maturity_date (nullable)', 'source', 'confidence', 'created_at'] },
    { name: 'Security', fields: ['id (canonical)', 'ticker (nullable)', 'cusip (nullable)', 'isin (nullable)', 'name', 'type (equity | etf | mutual_fund | bond | crypto | cash | other)', 'asset_class (nullable)', 'sector (nullable)', 'close_price (NUMERIC(19,6), nullable)', 'close_price_as_of (nullable)', 'currency_code', 'created_at', 'updated_at'] },
    { name: 'InvestmentHolding', fields: ['id', 'account_id (FK)', 'security_id (FK)', 'quantity (NUMERIC(28,10))', 'price (NUMERIC(19,6), nullable)', 'value (NUMERIC(19,4))', 'cost_basis (NUMERIC(19,4), nullable — often unavailable)', 'currency_code', 'as_of', 'source', 'confidence', 'created_at', 'updated_at'] },
    { name: 'InvestmentTransaction', fields: ['id', 'account_id (FK)', 'security_id (FK, nullable)', 'type (buy | sell | dividend | contribution | fee | transfer | cancel)', 'quantity (NUMERIC(28,10), nullable)', 'price (NUMERIC(19,6), nullable)', 'amount (NUMERIC(19,4))', 'canonical_amount (NUMERIC(19,4))', 'date', 'external_id', 'source', 'raw_ref (FK)', 'is_removed (soft-delete bool)', 'created_at'] },
    { name: 'IncomeRecord', fields: ['id', 'user_id (tenant scope)', 'account_id (FK, nullable)', 'employer_payer (nullable)', 'gross_amount (NUMERIC(19,4), nullable)', 'net_amount (NUMERIC(19,4), nullable)', 'withholdings (JSON, nullable)', 'period_start', 'period_end', 'pay_date', 'source (plaid_income | paystub | inferred | user)', 'confidence', 'raw_ref (FK, nullable)', 'created_at'] },
    { name: 'TaxRecord', fields: ['id', 'user_id (tenant scope)', 'tenant_id (FK)', 'tax_year', 'kind (estimated_payment | withholding | tax_collected | deduction | w2 | form_1099 | sales_tax | vat | gst)', 'amount (NUMERIC(19,4), nullable)', 'jurisdiction (nullable)', 'related_transaction_id (FK, nullable)', 'document_id (FK, nullable)', 'source (stripe_tax | document | plaid | user | calculated)', 'confidence', 'created_at', 'updated_at'] },
    { name: 'Document', fields: ['id', 'user_id (tenant scope)', 'kind (statement | paystub | tax_form | receipt | invoice | other)', 'account_id (FK, nullable)', 'storage_key (object-store key; SERVER-generated)', 'content_type', 'size_bytes', 'linked_entity_type (nullable)', 'linked_entity_id (nullable)', 'source (plaid_statements | upload | provider)', 'as_of (nullable)', 'created_at'] },
    { name: 'ManualAssetLiability', fields: ['id', 'user_id (tenant scope)', 'tenant_id (FK)', 'name', 'kind (property | vehicle | cash | collectible | private_investment | insurance | equity_comp | other_asset | other_liability)', 'value (NUMERIC(19,4))', 'currency_code', 'valuation_method (manual | api | inferred)', 'provenance_method (observed | inferred | user_entered | calculated)', 'confidence', 'as_of', 'notes (nullable)', 'is_removed (soft-delete bool)', 'created_at', 'updated_at'] },
    { name: 'ProvenanceRecord', fields: ['id', 'tenant_id (FK)', 'entity_type (transaction | balance | holding | liability | income | manual | derived | ...)', 'entity_id', 'field', 'source (plaid | stripe | user | calculated)', 'observed_inferred_user_calculated (enum)', 'confidence', 'as_of (timestamp)', 'created_at — the load-bearing per-VALUE provenance principle'] },
    { name: 'AuditLog', fields: ['id', 'actor_user_id (FK, nullable)', 'tenant_id (FK)', 'action', 'entity_type', 'entity_id (nullable)', 'metadata_json (JSON — redacted, no secrets/raw payloads/full numbers)', 'ip_address (nullable)', 'occurred_at (append-only; not editable/deletable)'] },
    { name: 'NetWorthDaily', fields: ['id (DERIVED materialized view)', 'user_id (tenant scope)', 'tenant_id (FK)', 'as_of_date', 'assets_cash (NUMERIC(19,4))', 'assets_investments (NUMERIC(19,4))', 'assets_retirement (NUMERIC(19,4))', 'assets_manual (NUMERIC(19,4))', 'liabilities_cards (NUMERIC(19,4))', 'liabilities_loans (NUMERIC(19,4))', 'liabilities_mortgage (NUMERIC(19,4))', 'taxes_owed (NUMERIC(19,4))', 'net_worth (NUMERIC(19,4))', 'computed_at'] },
    { name: 'CashFlowMonthly', fields: ['id (DERIVED materialized view)', 'user_id (tenant scope)', 'tenant_id (FK)', 'month (first-of-month DATE)', 'income (NUMERIC(19,4))', 'spend (NUMERIC(19,4))', 'transfers_excluded (NUMERIC(19,4))', 'bills (NUMERIC(19,4))', 'refunds_reimbursements (NUMERIC(19,4))', 'business_revenue (NUMERIC(19,4))', 'taxes (NUMERIC(19,4))', 'net (NUMERIC(19,4))', 'computed_at'] },
    { name: 'DerivedView', fields: ['id (DERIVED — materialized/computed; the remaining named views as ONE enum-discriminated entity)', 'user_id (tenant scope)', 'tenant_id (FK)', 'view_type (spend_by_category | income_by_source | recurring_calendar | debt_dashboard | investment_allocation | tax_summary_yearly)', 'period_key (e.g. a DATE or YYYY-MM or tax_year)', 'payload_json (JSON — computed result)', 'source_provenance (observed | inferred | calculated)', 'is_stale (bool)', 'computed_at'] },
    { name: 'DataQualityStatus', fields: ['id (DERIVED/computed — step-11 first-class data-quality model)', 'user_id (tenant scope)', 'connection_id (FK, nullable)', 'account_id (FK, nullable)', 'issue_type (stale | broken_connection | missing_data | low_confidence | reauth_required | unreconciled_transfer)', 'severity', 'detail', 'detected_at', 'resolved_at (nullable)'] },
  ],
  acceptanceCriteria: [
    {
      forTask: 'step 1 — connections + token vault',
      criteria: [
        'A user links a Plaid account via Plaid Link (Sandbox) — public-token -> /item/public_token/exchange -> access_token — and connects Stripe (Test mode) via a restricted read key, producing one FinancialConnection per source with status, consent_state, and the consented scopes recorded.',
        'The provider access token is stored ONLY field-level-encrypted in ProviderTokenVault (token_vault_id column is ciphertext that decrypts solely via the vault module under TOKEN_ENCRYPTION_KEY); a test asserts the serialized client API response for /accounts and /connections contains no field matching the token, and the DB column value is not the plaintext token.',
        'Each connection stores BOTH the provider id (Plaid item_id/account_id, Stripe account id) AND a stable canonical id, and simulating a reconnect that changes a Plaid account_id maps back to the SAME canonical Account (no duplicate, history retained) — proving connected-account != real-world-account.',
        'A round-trip unit test encrypts then decrypts a token under TOKEN_ENCRYPTION_KEY and asserts equality; rotating the key (new key_id) re-wraps an existing token so it still decrypts, with the stored column remaining ciphertext throughout.',
      ],
    },
    {
      forTask: 'step 2 — raw ingestion (immutable, signed, idempotent)',
      criteria: [
        'Every Plaid/Stripe API response and webhook is persisted UNCHANGED in the raw layer with provider, object_type, provider_object_id, api_version, fetched_at, payload_hash, and payload_json (JSONB), and a test asserts the stored payload byte-matches a seeded fixture’s bytes.',
        'A webhook with a missing/invalid signature is REJECTED and not ingested (Plaid JWT verification / Stripe signature), and a verified webhook records a WebhookEvent keyed on provider_event_id (UNIQUE); replaying the SAME provider_event_id twice is processed at most once (idempotent) and creates no duplicate canonical rows.',
        'Reprocessing the canonical layer from the stored raw payloads (clear canonical for a fixture, re-normalize) reproduces the same canonical rows — raw is the reprocessable source of truth — and raw rows are never edited in place (an update/removal is a NEW raw event).',
      ],
    },
    {
      forTask: 'step 3 — canonical accounts + balance snapshots',
      criteria: [
        'Canonical Accounts are created for linked Plaid and Stripe sources with type/subtype, last-4 mask, currency, status, and AccountCapability flags; a schema check confirms no column stores a full account/routing number and a log check finds no full number logged.',
        'Balances are stored as timestamped BalanceSnapshots (a new row per observation, distinct as_of), NOT a single overwritten latest value: two syncs at different times produce two snapshots, querying the balance as-of a past date returns the correct historical snapshot, and a snapshot older than its freshness threshold is flagged is_stale rather than overwritten.',
        'Credit accounts capture credit_limit and the correct sign so utilization can later be computed.',
      ],
    },
    {
      forTask: 'step 4 — transactions ledger + sign normalization',
      criteria: [
        'Each Transaction stores BOTH provider_amount (raw provider sign) and canonical_amount, and a unit test over seeded Plaid + Stripe fixtures asserts: a normal Plaid product OUTFLOW (positive provider amount) becomes a NEGATIVE canonical_amount, a Plaid INCOME-endpoint amount is NOT inverted, and a Stripe balance-transaction sign converts correctly (positive = charged to another party -> appropriate canonical sign).',
        'Pending -> posted lifecycle is preserved as state HISTORY (TransactionEvent rows for add/update/remove/CORRECT): a posted update does NOT overwrite or duplicate the prior pending row, a ‘corrected’ transaction has a matching ‘correct’ event, and a ‘removed’ transaction is marked removed (excluded from totals) but retained, not hard-deleted.',
        'Summing canonical_amount over a seeded fixture of 1000 transactions reconciles to the account balance to the exact cent with ZERO floating-point drift (Decimal math), and amounts of 0.10 + 0.20 sum to exactly 0.30; a schema check confirms no FLOAT/DOUBLE/REAL money column exists.',
      ],
    },
    {
      forTask: 'step 5 — transfer reconciliation (no double-counting)',
      criteria: [
        'A seeded checking->savings internal transfer is matched into ONE TransferGroup (kind=internal_transfer, classification_intent=internal_transfer) on amount + date window + account + counterparty/description + source IDs, and both legs are EXCLUDED from income and spend totals — asserted against expected cash-flow numbers.',
        'A checking->credit-card payment is classified kind=card_payment / classification_intent=debt_payment (reduces the liability, not normal spend), and a Stripe PAYOUT is matched to its LATER Plaid bank deposit into a kind=stripe_payout_to_bank TransferGroup so the same money is counted ONCE (not double-counted as separate income).',
        'A medium/low-confidence match is surfaced as ‘suggested’ for user confirmation and is NOT auto-merged; confirming it links the group and updates totals deterministically; transaction_type (movement) and classification_intent (meaning) are stored separately and a re-classification updates totals correctly.',
      ],
    },
    {
      forTask: 'step 6 — categories + merchants',
      criteria: [
        'Each transaction carries the provider category (primary/detailed) WITH the Plaid confidence (very_high/high/medium/low/unknown) AND supports a user_category override that changes which category derived totals count under WITHOUT mutating the provider category or the system taxonomy.',
        'Merchant/counterparty names are normalized (variants of one payee map to a single MerchantCounterparty) so the same payee under different raw strings aggregates together, and a default category learned from a user override can apply to future matching transactions.',
        'Re-categorizing a transaction or renaming a merchant is reflected in the next spend-by-category computation with exact Decimal sums, excluding transfers and soft-deleted rows.',
      ],
    },
    {
      forTask: 'step 7 — dashboards (net worth / cash flow / income / recurring)',
      criteria: [
        'v1 net worth = exact Decimal sum of (cash/depository balances + MANUAL assets) minus (credit cards + loans + mortgage + manual liabilities + taxes owed), computed from the latest non-stale BalanceSnapshots and EXCLUDING reconciled internal transfers — investments/retirement contribute 0 until phase 9 — asserted to the cent against a fixture.',
        'Cash-flow-monthly separates income, spend, transfers, bills, refunds/reimbursements, business revenue (Stripe), and taxes, and EXCLUDES reconciled internal transfers and card-payment legs from income and spend — asserted to the cent against a fixture.',
        'Spend-by-category, income-by-source, and the recurring calendar render from the derived layer and match the underlying canonical sums for the same period; recurring bills/subscriptions/income surface with a predicted next date and frequency without duplicating the underlying transactions.',
      ],
    },
    {
      forTask: 'provenance + reliability + data quality',
      criteria: [
        'Every displayed financial value can report its provenance — source, timestamp, confidence, and observed/inferred/user-entered/calculated — verified via ProvenanceRecord for at least one OBSERVED (a Plaid balance), one CALCULATED (net worth), one USER-ENTERED (a manual asset), and one INFERRED (an APY inferred from interest transactions) value, and the inferred value is NOT labeled observed.',
        'Fields the providers cannot reliably supply (APY, rewards, full credit score, exact tax liability, equity comp/RSUs, property/insurance/collectible values, complete cost basis) are NULLABLE, accept manual entry, and carry confidence — the app never fabricates them, and a missing value renders ‘unknown’, not 0.',
        'DataQualityStatus flags a stale balance, a broken/reauth-required connection, missing data, low confidence, and an unreconciled transfer, and the issue clears (resolved_at set) when resolved.',
      ],
    },
    {
      forTask: 'tenant isolation + auth + audit',
      criteria: [
        'A cross-tenant access attempt (user A requesting user B’s account/transaction/document/connection) is DENIED at the data-access layer through ANY endpoint — asserted by a test — the tenant is derived from the authenticated identity (never a client-supplied id), and new rows are auto-stamped with the caller’s tenant.',
        'Auth is via the managed provider with RBAC roles and MFA available/required for financial-data access; a missing/invalid/expired token or wrong-role request to a protected route is rejected; logout clears cookies/session; no password, token, or secret appears in logs or errors.',
        'An immutable AuditLog entry is written for connection link/unlink, token create/use/rotate, consent change, manual edit, export, deletion, and role change (no secret values), and the audit trail cannot be edited or deleted through the app.',
      ],
    },
    {
      forTask: 'documents + storage',
      criteria: [
        'A statement/paystub/tax-form/receipt is stored in a PRIVATE object-storage bucket (MinIO locally) with a SERVER-generated key and retrieved only via a short-lived signed URL scoped to the owning tenant — never a public path, never a DB blob, and a client-supplied filename cannot become the storage key (path traversal stripped).',
        'An upload over the size limit or with a content-type outside the allowlist is REJECTED server-side.',
        'A document is not retrievable cross-tenant: another tenant’s signed URL and a direct/public URL both fail.',
      ],
    },
    {
      forTask: 'export + deletion (compliance)',
      criteria: [
        'A user can export ALL of their data (raw + canonical + documents) and a round-trip test confirms the export is complete and consistent; the artifact contains no plaintext token and no full account number and is written to a user-chosen location, never committed.',
        'A deletion request removes every record and document scoped to the user/household AND revokes/forgets provider connections; a post-deletion check finds no residual rows or stored objects for that tenant.',
        'Both export and deletion write immutable AuditLog entries that survive the deletion.',
      ],
    },
    {
      forTask: 'runs locally (Windows + Docker)',
      criteria: [
        '`docker compose up -d` starts PostgreSQL 16, Redis, and MinIO; the app and worker connect via DATABASE_URL / REDIS_URL / STORAGE_ENDPOINT with no step beyond copying .env.example to .env.local (Plaid Sandbox + Stripe Test keys), and every service binds to localhost.',
        'Migrations apply cleanly from an EMPTY database and seed the default category taxonomy; re-running them is a safe no-op; the build/typecheck/test gates pass on Windows.',
        'The pipeline runs against Plaid Sandbox + Stripe Test headless: a SYNC_UPDATES_AVAILABLE webhook driven via /sandbox/item/fire_webhook (and `stripe listen` for Stripe) reaches the receiver, the worker drains the queue and ingests an incremental /transactions/sync (adds/updates/removes) using the stored cursor, the dashboard route returns 200, and stopping/restarting the stack preserves data via named Docker volumes (no loss across `docker compose down` without -v).',
      ],
    },
  ],
  nonGoals: [
    'NO money movement of any kind — this is a READ-ONLY aggregation/analytics system: it connects, ingests, normalizes, reconciles, and reports; it NEVER initiates a transfer, pays a bill, places a trade, or moves money. Request only read scopes from Plaid/Stripe; there is no code path that moves funds.',
    'NOT a tax-FILING or tax-PREPARATION engine — it tags deductible/business transactions, records estimated payments, withholding, Stripe Tax collected, and produces annual summaries and sales-tax/VAT/GST exports, but it does NOT compute or file an income-tax return or claim exact tax liability.',
    'NOT a consumer-reporting agency and makes NO FCRA eligibility decisions — the app RECORDS and ORGANIZES financial data; it does NOT use data to make credit, employment, housing, or insurance ELIGIBILITY decisions. Do not become a consumer-reporting use without counsel.',
    'NEVER store raw card PANs or full bank account/routing numbers — Stripe handles cardholder data; store only a last-4 mask. Keep the app outside PCI cardholder-data scope.',
    '‘A single source is complete/authoritative’ is a NON-GOAL — NEVER trust one provider as the whole truth; always carry provenance (source, timestamp, confidence, observed/inferred/user-entered/calculated) and reconcile across sources.',
    'NOT a full double-entry general-ledger / accounting replacement (no chart-of-accounts journals, T-accounts, trial balances, or GAAP statements) — it is a normalized canonical ledger with transfer reconciliation and derived views, not bookkeeping software.',
    'NO floating-point money — exact DECIMAL/NUMERIC(19,4) (or integer minor units) through ONE shared money module with a defined rounding mode; a float money column or a JS-number money computation is a defect.',
    'Do NOT equate a connected provider account with a real-world account — a Plaid account_id can change on reconnect/token recreation and accounts can close/disappear; always keep BOTH provider ids and your own stable canonical ids, and never key business logic solely on a provider id.',
    'NOT single-tenant-only — it runs locally for the owner first but is architected MULTI-TENANT with row-level isolation so it can become a multi-user product; do NOT hard-wire a single-user assumption.',
    'Live cloud deployment with REAL provider credentials is a LATER phase, not a v1 goal — v1 is buildable and one-shot testable on Windows against Docker Postgres with Plaid Sandbox + Stripe Test mode; architect for the cloud, but ship local first.',
    'Advanced modules (liabilities depth, investments/retirement, income/payroll, tax docs, the data-quality system, and advanced planning/forecasting/anomaly detection) are PHASED — steps 8-12, OUT of the v1 build (steps 1-7); not cut, but not the first slice.',
  ],
  // node/git baseline + docker (local Postgres/Redis/MinIO) + stripe (Stripe CLI `stripe listen`)
  // + gh (CI/CD + Actions secrets). Plaid has no CLI; no cloud CLI since hosting is a decision (local v1).
  buildTools: ['node', 'git', 'docker', 'stripe', 'gh'],
};

export const BLUEPRINTS: Record<string, Blueprint> = {
  'static-site': STATIC_SITE,
  'fullstack-web': FULLSTACK_WEB,
  dashboard: DASHBOARD,
  saas: SAAS,
  'saas-ai-budget': SAAS_AI_BUDGET,
  'personal-finance': PERSONAL_FINANCE,
};

/* ----- capability overlays (compose onto a base) ----- */

const PAYMENTS: Blueprint = {
  kind: 'overlay',
  // Only archetypes that have a base Blueprint here — composing payments onto a
  // template with no base would yield an ungrounded, archetype-less brief.
  // (api-service gets payments once it gains its own base blueprint.)
  appliesTo: ['fullstack-web', 'saas', 'saas-ai-budget'],
  intakeQuestions: [
    { id: 'pay-model', question: 'One-time payments or recurring subscriptions?', critical: true, group: 'integrations' },
    { id: 'pay-product', question: 'What is being sold (products / prices)?', critical: true, group: 'integrations' },
    { id: 'pay-entitlement', question: 'What does a user get access to after paying?', critical: true, group: 'needs' },
  ],
  decisions: [
    {
      id: 'checkout',
      prompt: 'How should checkout work?',
      options: [
        { key: 'A', label: 'Stripe-hosted Checkout', note: 'recommended for v1 — Stripe handles the card form + PCI' },
        { key: 'B', label: 'Custom Stripe Elements', note: 'only if the hosted flow truly cannot fit the UX' },
      ],
      recommend: 'A',
    },
  ],
  securityRules: [
    'Use Stripe-hosted checkout for v1; never store card data locally.',
    'Verify the Stripe webhook signature on every webhook.',
    'Treat webhooks as the source of truth for payment/subscription state.',
    'Make webhook processing idempotent — a duplicate event must not double-apply.',
    'Store only the minimum Stripe ids and status fields needed.',
    'Never expose secret keys to frontend code; use environment-specific keys.',
  ],
  envVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'APP_BASE_URL'],
  dataEntities: [
    { name: 'Customer', fields: ['id', 'user_id', 'stripe_customer_id', 'email', 'created_at', 'updated_at'] },
    {
      name: 'PaymentOrSubscription',
      fields: ['id', 'customer_id', 'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_subscription_id', 'status', 'amount', 'currency', 'created_at', 'updated_at'],
    },
    { name: 'WebhookEvent', fields: ['id', 'stripe_event_id', 'type', 'processed_at', 'processing_status', 'error_message'] },
  ],
  acceptanceCriteria: [
    {
      forTask: 'payments / checkout',
      criteria: [
        'A checkout session can be created and the frontend redirects to Stripe-hosted checkout.',
        'The webhook endpoint verifies the Stripe signature and ignores duplicate events safely.',
        'Payment/subscription state is updated from webhooks; failed payments are handled.',
        'Stripe secrets are never exposed to the frontend or committed.',
        'Tests cover checkout-session creation and webhook handling.',
      ],
    },
  ],
  nonGoals: ['Storing raw card data anywhere in the app.'],
  buildTools: ['stripe'],
};

const EMAIL: Blueprint = {
  kind: 'overlay',
  appliesTo: 'any',
  intakeQuestions: [
    { id: 'email-to', question: 'Who receives the email (recipients)?', critical: true, group: 'integrations' },
    { id: 'email-trigger', question: 'What event triggers it (form submit, receipt, alert)?', critical: true, group: 'integrations' },
  ],
  decisions: [
    {
      id: 'email-provider',
      prompt: 'Which transactional email provider?',
      options: [
        { key: 'A', label: 'Postmark', note: 'recommended — fast, reliable transactional delivery' },
        { key: 'B', label: 'Resend', note: 'developer-friendly, generous free tier' },
        { key: 'C', label: 'SendGrid', note: 'broad features, more setup' },
      ],
      recommend: 'A',
    },
  ],
  securityRules: [
    'Never commit the email provider API token — read it from the environment.',
    'Sending must be idempotent — duplicate rapid submissions must not send duplicate emails.',
    'Never reveal provider error details to the client.',
  ],
  envVars: ['POSTMARK_SERVER_TOKEN', 'POSTMARK_FROM_EMAIL', 'CONTACT_TO_EMAIL', 'CONTACT_REPLY_TO_EMAIL'],
  dataEntities: [],
  acceptanceCriteria: [
    {
      forTask: 'email / notification',
      criteria: [
        'A valid submission triggers exactly one email to the configured recipient.',
        'The email token/secret is not committed to source control.',
        'A provider failure shows a distinct error state without leaking provider details.',
      ],
    },
  ],
  nonGoals: ['Bulk/marketing email campaigns.'],
};

// Database: the app persists data. Composes onto any archetype; its decision/entity/
// envVar keys match the base blueprints (fullstack-web/dashboard) so they DEDUP there
// (base wins) — the overlay's real value is for archetypes without a baked-in datastore.
const DATABASE: Blueprint = {
  kind: 'overlay',
  appliesTo: 'any',
  intakeQuestions: [
    { id: 'core-data', question: 'What core records/entities does it store, and how do they relate?', critical: true, group: 'needs' },
    { id: 'data-scale', question: 'Rough data scale and read/write pattern (mostly reads? heavy writes?)', critical: false, group: 'needs' },
  ],
  decisions: [
    {
      id: 'database',
      prompt: 'What datastore?',
      options: [
        { key: 'A', label: 'PostgreSQL', note: 'the default — relational, well-understood' },
        { key: 'B', label: 'SQLite', note: 'single-node / simple apps — zero-ops, a file' },
        { key: 'C', label: 'MySQL', note: 'fine if it is the existing house database' },
        { key: 'D', label: 'Azure SQL', note: 'if a Microsoft/SQL Server shop' },
      ],
      recommend: 'A',
    },
    LOCAL_DEV_DECISION,
  ],
  securityRules: [
    'Use parameterized queries or a query builder/ORM — NEVER build SQL by string concatenation (injection).',
    'Connect with a least-privilege database user; do not use the admin/owner role at runtime.',
    'Evolve the schema only through committed migrations — no ad-hoc production schema edits.',
    'Never log connection strings, query parameters containing PII, or secrets.',
    'Give tables primary keys, enforce foreign keys, and add created_at / updated_at timestamps.',
    LOCAL_DEV_SECURITY_RULE,
  ],
  envVars: ['DATABASE_URL'],
  localServices: [
    { service: 'PostgreSQL database', localVia: 'docker-compose (postgres:16 image)', connectionEnv: 'DATABASE_URL' },
  ],
  dataEntities: [],
  acceptanceCriteria: [
    {
      forTask: 'database / persistence',
      criteria: [
        'Migrations create the schema reproducibly from empty, and re-running them is safe.',
        'Create/read/update/delete works for the core records with server-side validation.',
        'All queries are parameterized — a value containing quotes cannot alter the query.',
        'Tables have primary keys, enforced foreign keys, and created_at / updated_at.',
      ],
    },
  ],
  nonGoals: ['A bespoke ORM or query layer — use a maintained library.'],
  buildTools: ['docker'],
};

// Cache: a fast in-memory store for sessions, rate limits, or hot reads (Redis &c.).
// Composes onto any archetype. Local-simulatable like the database — runs in a
// container so the founder can test cache-backed behavior on their own machine.
const CACHE: Blueprint = {
  kind: 'overlay',
  appliesTo: 'any',
  intakeQuestions: [
    { id: 'cache-use', question: 'What is cached, and why (sessions, rate limiting, hot reads, queue)?', critical: true, group: 'needs' },
    { id: 'cache-staleness', question: 'How stale can cached data be (the TTL / invalidation rule)?', critical: false, group: 'needs' },
  ],
  decisions: [
    {
      id: 'cache-store',
      prompt: 'What cache?',
      options: [
        { key: 'A', label: 'Redis', note: 'the default — versatile (cache, sessions, rate limits, queues)' },
        { key: 'B', label: 'In-memory (process)', note: 'single-node only — lost on restart, no sharing across instances' },
        { key: 'C', label: 'Memcached', note: 'simple key/value caching only' },
      ],
      recommend: 'A',
    },
    LOCAL_DEV_DECISION,
  ],
  securityRules: [
    'The cache is NEVER the source of truth — the app must work correctly (just slower) if it is flushed or unavailable.',
    'Set an explicit TTL on every cached entry; never cache data indefinitely.',
    'Do not cache secrets, tokens, or unencrypted PII; scope keys per-tenant/user so one user cannot read another’s cached data.',
    'Require auth on the cache (password / network policy) and bind it to localhost in local dev — never expose it unauthenticated.',
    LOCAL_DEV_SECURITY_RULE,
  ],
  envVars: ['REDIS_URL'],
  localServices: [
    { service: 'Redis cache', localVia: 'docker-compose (redis:7 image)', connectionEnv: 'REDIS_URL' },
  ],
  dataEntities: [],
  acceptanceCriteria: [
    {
      forTask: 'cache',
      criteria: [
        'With the cache running locally (docker compose up -d), a cached read is served from the cache and a cache miss recomputes from the source.',
        'The app still returns correct results when the cache is unavailable (graceful degradation, no crash).',
        'Every cached entry has a TTL; no secrets or unencrypted PII are written to the cache.',
      ],
    },
  ],
  nonGoals: ['Using the cache as a primary datastore or the source of truth.'],
  buildTools: ['docker'],
};

// File storage: upload, store, and serve files/blobs via object storage. Composes
// onto any archetype. Local-simulatable with an S3-compatible container (MinIO) so
// uploads/downloads can be tested locally without a cloud bucket.
const STORAGE: Blueprint = {
  kind: 'overlay',
  appliesTo: 'any',
  intakeQuestions: [
    { id: 'storage-what', question: 'What files are stored (type), and how large can they get?', critical: true, group: 'needs' },
    { id: 'storage-access', question: 'Who can access each file — public, or private to a user/role?', critical: true, group: 'needs' },
  ],
  decisions: [
    {
      id: 'storage-backend',
      prompt: 'Where do uploaded files live?',
      options: [
        { key: 'A', label: 'S3-compatible object storage', note: 'the default — S3 / Azure Blob / R2; MinIO for local dev' },
        { key: 'B', label: 'Local filesystem', note: 'single-node / simple apps only — does not scale across instances' },
      ],
      recommend: 'A',
    },
    LOCAL_DEV_DECISION,
  ],
  securityRules: [
    'Store uploads in object storage (a private bucket), NEVER as blobs in the database and never inside the web root.',
    'Serve private files only through short-lived signed URLs — never trust a client-supplied path or key.',
    'Validate every upload server-side: enforce an allowlist of content types and a max size; never execute or inline-serve user uploads.',
    'Generate storage keys server-side (do not use the user-supplied filename as the key); strip path traversal.',
    LOCAL_DEV_SECURITY_RULE,
  ],
  envVars: ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_REGION', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'],
  localServices: [
    { service: 'S3-compatible object storage (MinIO)', localVia: 'docker-compose (minio image)', connectionEnv: 'STORAGE_ENDPOINT' },
  ],
  dataEntities: [
    { name: 'StoredFile', fields: ['id', 'owner_user_id', 'storage_key', 'content_type', 'size_bytes', 'created_at'] },
  ],
  acceptanceCriteria: [
    {
      forTask: 'file storage / uploads',
      criteria: [
        'With storage running locally (docker compose up -d, e.g. MinIO), a file can be uploaded and then retrieved via a signed URL.',
        'Uploads over the size limit or with a disallowed content type are rejected server-side.',
        'Private files are not accessible without a valid signed URL; storage keys are generated server-side.',
      ],
    },
  ],
  nonGoals: ['Storing file bytes in the database, or serving user uploads directly from the app origin without checks.'],
  buildTools: ['docker'],
};

// Authentication: users sign in. Decision/entity/envVar keys match the base blueprints
// so they DEDUP where auth is already baked in (base wins); the overlay supplies auth
// for archetypes that don't have it. Criteria use a distinct forTask to avoid a dup pack.
const AUTHENTICATION: Blueprint = {
  kind: 'overlay',
  appliesTo: 'any',
  intakeQuestions: [
    { id: 'users', question: 'Who are the users, and how do they sign in?', critical: true, group: 'needs' },
    { id: 'roles', question: 'What roles/permissions exist — who can do what?', critical: true, group: 'needs' },
  ],
  decisions: [
    {
      id: 'auth',
      prompt: 'How should sign-in work? (managed, never hand-rolled)',
      options: [
        { key: 'A', label: 'Clerk', note: 'recommended for v1 — fast to integrate, generous free tier' },
        { key: 'B', label: 'Microsoft Entra ID', note: 'managed; good for B2B / internal SSO' },
        { key: 'C', label: 'Auth.js (NextAuth)', note: 'self-hosted sessions, more wiring' },
        { key: 'D', label: 'Auth0 / Okta', note: 'if already the org IdP' },
      ],
      recommend: 'A',
    },
  ],
  securityRules: [
    'Use a managed auth provider — never hand-roll password storage or session handling.',
    'Authorize every request server-side by role; never trust a role/permission claim from the client.',
    'Session cookies must be httpOnly, Secure, and SameSite; sessions expire and can be revoked.',
    'Never log passwords, tokens, or secrets; read auth secrets from the environment.',
    'Rate-limit and lock-out sign-in / token endpoints to resist brute force.',
    "Local dev uses the auth provider's development instance / test keys from a gitignored .env.local — never production credentials.",
  ],
  envVars: ['AUTH_ISSUER', 'AUTH_CLIENT_ID', 'AUTH_CLIENT_SECRET', 'AUTH_SECRET', 'APP_BASE_URL'],
  dataEntities: [{ name: 'User', fields: ['id', 'email', 'role', 'created_at', 'updated_at'] }],
  acceptanceCriteria: [
    {
      forTask: 'sign-in / sessions',
      criteria: [
        'A user can sign in and is returned to the app authenticated; logout clears all cookies and local storage.',
        'Sessions are httpOnly/Secure/SameSite, expire, and survive a normal task without a mid-flow re-login.',
        'Every protected route enforces authentication and the user role server-side.',
        'No passwords, tokens, or secrets appear in logs or error messages.',
      ],
    },
  ],
  nonGoals: ['Hand-rolled password hashing or session storage.'],
};

// Order here is the display order on the setup page (after the always-present Git
// checkbox). The locally-simulatable DATA services lead, grouped together
// (database, cache, file storage), then authentication, email, payments.
export const OVERLAYS: Record<string, OverlayDef> = {
  database: { id: 'database', name: 'Database', description: 'The app stores and queries data (a relational datastore).', blueprint: DATABASE },
  cache: { id: 'cache', name: 'Cache', description: 'A fast store for sessions, rate limits, or hot reads (Redis).', blueprint: CACHE },
  storage: { id: 'storage', name: 'File storage', description: 'Upload, store, and serve files/blobs (object storage).', blueprint: STORAGE },
  authentication: { id: 'authentication', name: 'Authentication', description: 'Users sign in; role-based access (managed auth).', blueprint: AUTHENTICATION },
  email: { id: 'email', name: 'Transactional email', description: 'Send receipts, alerts, or contact-form email.', blueprint: EMAIL },
  payments: { id: 'payments', name: 'Payments', description: 'Take one-time payments or subscriptions (Stripe).', blueprint: PAYMENTS },
};

/* ----- lookup + composition ----- */

export function getBlueprint(templateId?: string | null): Blueprint | undefined {
  return templateId ? BLUEPRINTS[templateId] : undefined;
}

/** Overlays that can compose onto the given base template. */
export function overlaysFor(templateId?: string | null): OverlayDef[] {
  return Object.values(OVERLAYS).filter((o) => {
    const applies = o.blueprint.appliesTo;
    return applies === 'any' || (!!templateId && Array.isArray(applies) && applies.includes(templateId));
  });
}

/**
 * Overlay ids whose capability the base archetype already bakes in — shown as
 * "included" + disabled in the setup UI and skipped by composeBlueprint. Empty for a
 * base that provides none, or for a template with no base blueprint.
 */
export function providedOverlayIds(templateId?: string | null): string[] {
  const base = getBlueprint(templateId);
  return (base?.provides ?? []).filter((id) => id in OVERLAYS);
}

export interface ComposedBlueprint {
  intakeQuestions: IntakeQuestion[];
  decisions: BlueprintDecision[];
  securityRules: string[];
  envVars: string[];
  dataEntities: DataEntity[];
  acceptanceCriteria: CriteriaPack[];
  nonGoals: string[];
  localServices: LocalServiceSpec[];
  buildTools: string[];
}

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

/**
 * Base blueprint + the chosen, applicable overlays, merged. Arrays concatenate
 * (base first), deduped by their natural key so an overlay can't double a base
 * decision/question. Overlays that don't apply to the base are ignored.
 */
export function composeBlueprint(
  templateId: string | null | undefined,
  overlayIds: string[],
): ComposedBlueprint {
  const parts: Blueprint[] = [];
  const base = getBlueprint(templateId);
  if (base) {
    parts.push(base);
  }
  for (const id of overlayIds) {
    // The base already bakes this capability in — never re-compose it (avoids
    // redundant/divergent content for a base with non-overlay-matching keys, e.g. Supabase).
    if (base?.provides?.includes(id)) {
      continue;
    }
    const overlay = OVERLAYS[id];
    if (!overlay) {
      continue;
    }
    const applies = overlay.blueprint.appliesTo;
    if (applies === 'any' || (!!templateId && Array.isArray(applies) && applies.includes(templateId))) {
      parts.push(overlay.blueprint);
    }
  }
  return {
    intakeQuestions: uniqueBy(parts.flatMap((p) => p.intakeQuestions), (q) => q.id),
    decisions: uniqueBy(parts.flatMap((p) => p.decisions), (d) => d.id),
    securityRules: uniqueBy(parts.flatMap((p) => p.securityRules), (s) => s),
    envVars: uniqueBy(parts.flatMap((p) => p.envVars), (e) => e),
    dataEntities: uniqueBy(parts.flatMap((p) => p.dataEntities), (e) => e.name),
    acceptanceCriteria: parts.flatMap((p) => p.acceptanceCriteria),
    nonGoals: uniqueBy(parts.flatMap((p) => p.nonGoals), (n) => n),
    // Dedup by service so Postgres (in a base AND the database overlay) lands once.
    localServices: uniqueBy(parts.flatMap((p) => p.localServices ?? []), (s) => s.service),
    // Dedup by id so a tool a base AND an overlay both need (e.g. stripe) lands once.
    buildTools: uniqueBy(parts.flatMap((p) => p.buildTools ?? []), (id) => id),
  };
}

/* ----- A1: the always-on, posture-gated baseline security/quality floor ----- */

// Env-var names that indicate the app holds a secret/credential (so the baseline
// secret-handling floor applies). Matched case-insensitively against each env name.
const SECRET_ENV_PATTERN =
  /(secret|token|passwd|password|api[_-]?key|private[_-]?key|credential|database_url|_uri$|connection_string)/i;

/** Does the composed app persist user data (has entities or a stateful local service)? */
function hasPersistence(composed: ComposedBlueprint): boolean {
  return composed.dataEntities.length > 0 || composed.localServices.length > 0;
}

/** Does the composed app handle any secret/credential or persist data? */
export function appHandlesDataOrSecrets(composed: ComposedBlueprint): boolean {
  return hasPersistence(composed) || composed.envVars.some((e) => SECRET_ENV_PATTERN.test(e));
}

/**
 * The baseline security floor. `always` rules are POSTURE-INDEPENDENT — data-at-rest,
 * secret handling, and input validation matter on every app that touches data or secrets,
 * so they can never manufacture a false CRITICAL. `networkExposed` / `multiUser` are gated
 * on the deployment posture: a deliberately single-user localhost app is NEVER told to
 * add authentication (which is exactly the false-CRITICAL the plan forbids). Every
 * rule dedups by exact string against the composed rules, so a base/overlay that already
 * states an equivalent rule wins.
 */
export const BASELINE_SECURITY_RULES = {
  /** Apply whenever the app handles data or secrets — regardless of deployment posture. */
  always: [
    'Encrypt third-party tokens, credentials, and other sensitive values AT REST — never persist a bank/API/OAuth token, password, or secret in cleartext in the database, a file, or a log.',
    'Read every secret from the environment / a secret store — never hardcode one in source, and never commit one (.env stays gitignored; commit only a .env.example with placeholder names).',
    'Validate and sanitize all external input (request bodies, query params, headers, uploaded files) server-side before use, using parameterized queries — never build SQL or shell commands by string concatenation.',
    'Never log secrets, tokens, passwords, or full PII.',
  ],
  /** Apply when the app persists data AND is network-reachable (posture !== local-single-user). */
  networkExposed: [
    'Authenticate and authorize every non-public route server-side; the UI is never the enforcement point.',
  ],
  /** Apply when the app persists data AND serves multiple distinct users/tenants. */
  multiUser: [
    'Enforce per-owner access control on every owned resource — a user must not read or write another user’s records; check ownership server-side on read AND write, not just in the UI.',
  ],
};

/**
 * The posture-gated baseline security rules for a composed app. Empty when the app neither
 * persists data nor handles secrets (so a pure static site stays byte-identical). The
 * network/multi-user rules only appear when the app persists data AND the posture admits
 * them — an approved single-user/localhost app gets the data-at-rest floor with NO auth
 * demand. Pure — shared by the plan prompt, the dev/review context, and A5's coverage gate.
 */
export function baselineSecurityRules(
  composed: ComposedBlueprint,
  posture: DeploymentPosture,
): string[] {
  if (!appHandlesDataOrSecrets(composed)) return [];
  const rules = [...BASELINE_SECURITY_RULES.always];
  if (hasPersistence(composed)) {
    if (posture !== 'local-single-user') rules.push(...BASELINE_SECURITY_RULES.networkExposed);
    if (posture === 'public-internet' || posture === 'multi-tenant') {
      rules.push(...BASELINE_SECURITY_RULES.multiUser);
    }
  }
  return rules;
}

/** The baseline acceptance-criteria pack matching the posture-gated baseline rules. */
export function baselineCriteria(
  composed: ComposedBlueprint,
  posture: DeploymentPosture,
): CriteriaPack[] {
  if (!appHandlesDataOrSecrets(composed)) return [];
  const criteria = [
    'Sensitive values (third-party tokens, credentials, secrets) are stored encrypted at rest — none appear in cleartext in the database, files, or logs.',
    'All secrets are read from the environment; none are hardcoded or committed (only .env.example with placeholder names is committed).',
    'External input is validated server-side and queries are parameterized; malformed or hostile input is rejected without crashing or leaking internals.',
  ];
  if (hasPersistence(composed)) {
    if (posture !== 'local-single-user') {
      criteria.push('Non-public routes reject unauthenticated or unauthorized requests server-side.');
    }
    if (posture === 'public-internet' || posture === 'multi-tenant') {
      criteria.push('A user cannot read or write another user’s records — ownership is enforced server-side on read and write.');
    }
  }
  return [{ forTask: 'security baseline', criteria }];
}

/**
 * Compose the base+overlays, then fold in the posture-gated baseline floor. This is
 * how a scaffolder/wizard project (`templateId: null`) still gets the
 * non-negotiable controls its thin overlay set lacked. Baseline rules/criteria append after
 * the archetype's own (deduped), and are '' when the app touches no data or secrets — so a
 * from-scratch or pure-static project's composed blueprint is byte-identical to composeBlueprint.
 */
export function withBaseline(
  composed: ComposedBlueprint,
  posture: DeploymentPosture,
): ComposedBlueprint {
  const extraRules = baselineSecurityRules(composed, posture);
  const extraCriteria = baselineCriteria(composed, posture);
  if (extraRules.length === 0 && extraCriteria.length === 0) return composed;
  return {
    ...composed,
    securityRules: uniqueBy([...composed.securityRules, ...extraRules], (s) => s),
    acceptanceCriteria: [...composed.acceptanceCriteria, ...extraCriteria],
  };
}

/** Renders one blueprint decision as a labeled option list with the recommended key marked. */
function renderDecision(d: BlueprintDecision): string {
  const opts = d.options
    .map((o) => {
      const note = o.note ? ` — ${o.note}` : '';
      const mark = o.key === d.recommend ? '  [recommended]' : '';
      return `    ${o.key}) ${o.label}${note}${mark}`;
    })
    .join('\n');
  return `- ${d.prompt}\n${opts}`;
}

/**
 * The Architect's (Richard's) template/archetype guidance block for a room turn:
 * the selected-template head (ONLY when a template was chosen) plus the composed
 * decision matrix + non-negotiable security rules.
 *
 * Crucially it renders the composed decisions + rules EVEN WHEN there is no base
 * template (the scaffolder/wizard path, `templateId: null`) — an overlay-only or
 * scaffold-only project still drives Richard's A/B/C auth & secret-handling
 * questions instead of leaving his chat empty. Returns '' when
 * there is genuinely nothing to say (no template AND no composed decisions/rules),
 * so template-less/overlay-less prompts stay byte-identical. Pure — no Node/Electron,
 * so the room engine and its tests share one source of truth.
 */
export function architectTemplateBlock(
  template: ProjectTemplate | undefined,
  composed: ComposedBlueprint,
): string {
  const parts: string[] = [];
  if (template) {
    parts.push(
      [
        '\n\nSELECTED TEMPLATE / ARCHETYPE (the founder chose this at project creation):',
        `${template.name} — ${template.description}`,
        `Recommended default stack for this archetype: ${template.suggestedStack.join(', ')}.`,
        'You ALREADY know the product shape from this — do NOT re-ask the shape-discovery',
        'questions. Briefly confirm it fits what Monica described, then guide the founder',
        'through the build decisions for this archetype as A/B/C/D, using this stack as your',
        'recommended defaults (and offering alternatives with costs).',
      ].join(' '),
    );
  }
  if (composed.decisions.length > 0) {
    parts.push(
      [
        '\n\nDECISIONS TO COVER (ask these as your A/B/C questions, one or two at a time;',
        'recommend the option marked [recommended], but always present the alternatives',
        'with their costs so the founder can choose):',
      ].join(' ') + '\n' + composed.decisions.map(renderDecision).join('\n'),
    );
  }
  if (composed.securityRules.length > 0) {
    parts.push(
      '\n\nNON-NEGOTIABLE SECURITY RULES for this archetype (make sure the plan reflects them):\n' +
        composed.securityRules.map((r) => `- ${r}`).join('\n'),
    );
  }
  return parts.join('');
}

/**
 * The build/review context block naming the project's composed security rules, so the
 * DEV seat (and the QA/security/architect/ops reviewers) are TOLD the controls at build
 * time — dev cannot satisfy a rule it was never given, which is how an early build shipped a
 * finance backend with no token-at-rest encryption / no ownership until the security
 * review manufactured it as remediation. '' when there are no rules (no blueprint AND no
 * overlays), keeping from-scratch prompts byte-identical. Pure — the Bullpen engine and
 * its tests share one source of truth. (The baseline-rules layer composes
 * into `securityRules` and flows through this same block automatically.)
 */
export function securityRulesContextBlock(securityRules: string[]): string {
  if (securityRules.length === 0) {
    return '';
  }
  return (
    '\n\nSECURITY & QUALITY RULES for this project (these are REQUIREMENTS for the code you ' +
    'write — satisfy them now; do NOT wait for a security review to add them):\n' +
    securityRules.map((r) => `- ${r}`).join('\n')
  );
}

/**
 * Renders the "stand up the local data services" guidance for Richard's plan
 * prompt — empty string when the product has no stateful services (so a static
 * site's plan is unaffected). Tells him to make standing up the services an
 * EARLY task (so the app is locally runnable/testable), wire the connection env
 * to the local instance, and attach a one-shot "verify it runs locally" check.
 * Pure — no Node/Electron, so the engines and tests share one source of truth.
 */
export function localServicesPlanNote(localServices: LocalServiceSpec[]): string {
  if (localServices.length === 0) {
    return '';
  }
  const list = localServices
    .map((s) => `${s.service} (connect via ${s.connectionEnv}; run locally with ${s.localVia})`)
    .join('; ');
  return [
    'LOCAL DEV ENVIRONMENT (the founder MUST be able to run and test the whole app on their own machine before any cloud deploy):',
    `This product depends on these stateful services: ${list}.`,
    '- Include an EARLY task (in the first phase) that stands these up locally — a committed docker-compose.yml (STRONGLY preferred) or a documented host-install — so the app is fully runnable and testable with NO cloud account.',
    '- Bring the stack up DETACHED (`docker compose up -d`) so it KEEPS RUNNING for the rest of the build. The local services stay up across every dev, QA, and security step — later tasks and QA check against the ALREADY-RUNNING stack rather than cold-booting it each time (which is slow and stalls one-shot QA). Test isolation between runs is the test command\'s job (a fast data reset / migrate), NOT a container restart.',
    '- Wire each connection env var to the LOCAL instance through a committed .env.example (real values in a gitignored .env.local). The very same task should ensure those values resolve, so `docker compose up` actually starts — never leave a `${VAR:?}` reference with no working local source.',
    '- These LOCAL services are NOT the cloud/production infrastructure: they belong EARLY, never in the final infra/hosting phase. Only the PRODUCTION provisioning (managed database, hosting, DNS, IaC) goes last.',
    '- That early task MUST carry a one-shot "verify it runs locally" acceptance criterion, e.g. "with the services running (docker compose up -d), migrations apply and a connection smoke test passes" — phrased as a one-shot check, never a blocking dev server.',
  ].join('\n');
}
