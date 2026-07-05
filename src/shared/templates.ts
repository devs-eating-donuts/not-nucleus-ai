import type { ReviewTrigger, RoleId } from './roles';

/** Built-in starter templates. Editable template library lands in V2. */
export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  suggestedStack: string[];
  suggestedStructure: string[];
  defaultEnabledRoles: RoleId[];
  defaultReviewTriggers: Partial<Record<RoleId, ReviewTrigger>>;
  /** Starter text prepended to the Stakeholder's product brief. */
  promptStarter: string;
  /**
   * Disabled = parked, not deleted. Disabled templates are hidden from the New
   * Project picker and shown name-only under "Disabled templates" on the
   * Templates page, so their definition + blueprint depth survive and we can
   * re-enable them one at a time (e.g. as their build-prerequisite CLI tooling
   * lands). `getTemplateById` / `getBlueprint` still resolve them, so a project
   * already created from a now-disabled template keeps working.
   */
  disabled?: boolean;
}

// Templates are archetypes (product shapes), not framework/cloud permutations.
// Posture: opinionated, TypeScript-first web, Azure-first hosting with
// cloud-agnostic Terraform, managed auth + object storage + Postgres as the
// mainstream baseline. The Architect varies the proven decisions inside each.
const CORE_CHAIN: RoleId[] = ['stakeholder', 'architect', 'developer', 'qa', 'security'];
const FULL_TEAM: RoleId[] = [
  'stakeholder',
  'projectLead',
  'architect',
  'developer',
  'qa',
  'security',
];

export const BUILT_IN_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'static-site',
    name: 'Make the World a Better Place',
    description:
      'Static marketing or docs site — mostly public content, SEO-friendly, ships almost no client JS. Forms post to a small serverless function; no database, no login. Makes your pre-revenue startup sound inevitable.',
    suggestedStack: [
      'Astro',
      'TypeScript',
      'Azure Static Web Apps or Cloudflare Pages',
      'a transactional email API',
      'Cloudflare Turnstile',
    ],
    suggestedStructure: ['site', 'api/contact', 'docs'],
    defaultEnabledRoles: FULL_TEAM,
    defaultReviewTriggers: { qa: 'afterEachFeature', security: 'endOfProject' },
    promptStarter:
      'A fast, SEO-friendly static marketing or documentation site. Mostly public content; any forms (contact, waitlist) post to a small serverless function with spam protection (Turnstile). No accounts or database unless the brief clearly needs editors. Make it fast, accessible, and look funded.',
  },
  {
    id: 'poc',
    name: 'Proof of Concept (POC)',
    description:
      'A throwaway demo to prove ONE idea works — the smallest thing that runs and convinces. No accounts, no infra, no production hardening; just the core idea, runnable locally, fast. The thing you build the night before the demo.',
    suggestedStack: [
      'Vite + React + TypeScript (or plain HTML/CSS/JS if even lighter)',
      'in-memory data, or SQLite only if persistence is unavoidable',
      'no auth, no cloud, no CI/CD — unless the idea IS one of those',
      'runs locally with a single command',
    ],
    suggestedStructure: ['src', 'README.md'],
    // Lean on purpose: pitch the idea, a quick plan, build it, does-it-work check.
    // No projectLead/security/ops overhead for a throwaway.
    defaultEnabledRoles: ['stakeholder', 'architect', 'developer', 'qa'],
    defaultReviewTriggers: { qa: 'endOfProject' },
    promptStarter:
      'A proof of concept: the smallest possible build that proves the core idea works. Skip auth, databases, cloud, and CI/CD unless the idea itself requires them. One app, runs locally with a single command, fastest path to a working demo. Throwaway quality is fine — "does it work" over polish.',
  },
  {
    id: 'dashboard',
    disabled: true,
    name: 'Internal Dashboard / CRUD Tool',
    description:
      'An authenticated internal workflow tool: records, role-based access, audit logging. Boring on purpose — reliability over flash.',
    suggestedStack: [
      'React + Vite',
      'TypeScript',
      'NestJS or ASP.NET Core Minimal API',
      'PostgreSQL',
      'managed auth (Entra ID for internal)',
      'Azure Container Apps',
    ],
    suggestedStructure: ['apps/web', 'apps/api', 'infra', 'docs'],
    defaultEnabledRoles: FULL_TEAM,
    defaultReviewTriggers: { qa: 'afterEachTask', security: 'afterEachFeature' },
    promptStarter:
      'An authenticated internal dashboard / CRUD tool with role-based access, audit logging, and bulk operations over a clean relational data model.',
  },
  {
    id: 'fullstack-web',
    disabled: true,
    name: 'Full-Stack Customer Web App',
    description:
      'A customer-facing web product with accounts, forms, and server logic — portals, marketplaces, booking apps. SEO + dynamic routes + authenticated areas.',
    suggestedStack: [
      'Next.js',
      'TypeScript',
      'PostgreSQL',
      'managed auth (Auth.js or Clerk)',
      'Azure App Service or Container Apps',
    ],
    suggestedStructure: ['app', 'app/api', 'infra', 'docs'],
    defaultEnabledRoles: FULL_TEAM,
    defaultReviewTriggers: { qa: 'afterEachFeature', security: 'endOfProject' },
    promptStarter:
      'A full-stack customer web app (portal, marketplace, or booking-style product) with user accounts, server logic, and both public and authenticated areas.',
  },
  {
    id: 'saas',
    disabled: true,
    name: 'B2B Multi-Tenant SaaS',
    description:
      'Workspaces/organizations, role-based access, billing, and tenant isolation from day one. The "we are pre-revenue but inevitable" special.',
    suggestedStack: [
      'Next.js',
      'TypeScript',
      'PostgreSQL',
      'org-aware managed auth (Clerk Organizations / Entra External ID)',
      'Stripe Billing',
      'Azure Container Apps',
      'Terraform',
    ],
    suggestedStructure: ['apps/web', 'apps/api', 'packages/shared', 'infra', 'docs'],
    defaultEnabledRoles: FULL_TEAM,
    defaultReviewTriggers: { qa: 'afterEachFeature', security: 'afterEachFeature' },
    promptStarter:
      'A B2B multi-tenant SaaS with organizations/workspaces, role-based access, subscription billing, and strict tenant isolation. Auth, billing, and an admin area are core from the start, not afterthoughts.',
  },
  {
    id: 'saas-ai-budget',
    disabled: true,
    name: 'AI SaaS on a Budget',
    description:
      'An AI product where the browser never touches the model. A Cloudflare + Supabase web stack brokers every AI call through a policy gate to a managed RunPod serverless GPU endpoint that scales to zero when idle — no always-on GPU bill, per-second pricing only while a request runs. For founders who want AI features without the AI-platform invoice.',
    suggestedStack: [
      'Cloudflare Pages (+ WAF / Turnstile)',
      'Supabase (Auth + Postgres/RLS + Storage + Edge Functions)',
      'Stripe Billing',
      'RunPod Serverless GPU endpoint (scale-to-zero) running vLLM/Ollama',
      'TypeScript',
    ],
    suggestedStructure: ['apps/web', 'supabase/functions', 'ai-worker', 'infra', 'docs'],
    defaultEnabledRoles: FULL_TEAM,
    defaultReviewTriggers: { qa: 'afterEachFeature', security: 'afterEachFeature' },
    promptStarter:
      'A budget-conscious AI SaaS: a Cloudflare Pages + Supabase web app where the browser NEVER calls the AI directly. Every AI request is brokered server-side through a Supabase Edge Function and an AI policy gate (auth, tenant, subscription, model allow-list, quotas), then sent to a managed RunPod serverless GPU endpoint via a restricted, endpoint-scoped API key kept only in server secrets. The endpoint scales to zero when idle (workersMin=0) with a workersMax cap, so you pay per-second GPU only while a request runs. Multi-tenant with Supabase RLS, Stripe billing for entitlements, and audit/cost metadata only (never raw prompts).',
  },
  {
    id: 'personal-finance',
    disabled: true,
    name: 'Financial Data Operating System',
    description:
      'A product-grade financial data operating system: connect every money source, ingest the RAW provider payloads unchanged, normalize them into ONE canonical ledger, reconcile transfers so nothing double-counts, derive net-worth / cash-flow / income / debt / investment / tax views, and preserve PROVENANCE on every number (source, timestamp, confidence, observed/inferred/user-entered/calculated). Plaid is the PRIMARY consumer-finance source (transactions via /transactions/sync with a cursor, balances, auth/routing, liabilities, investments, income, statements, recurring); Stripe is a first-class BUSINESS/revenue source (balance transactions, charges, refunds, disputes, fees, payouts, invoices, subscriptions, Stripe Tax) — including reconciling a Stripe payout to its LATER bank deposit seen via Plaid. Money is EXACT DECIMAL/NUMERIC, never float. Runs locally for the owner first (PostgreSQL in Docker on Windows, Plaid Sandbox + Stripe Test) but is architected multi-tenant, RBAC’d, MFA-gated, vaulted-token, and cloud-deployable from day one. Read-only: it organizes money, it never moves it.',
    suggestedStack: [
      'Next.js (App Router) + TypeScript — ONE service serving the UI, the API route handlers, and the Plaid/Stripe webhook receivers (the server-side trust boundary; runs at localhost first, cloud-deployable later)',
      'Prisma (ORM + migrations) on PostgreSQL 16 — Prisma Decimal maps to NUMERIC(19,4) so money stays exact; first-class migrations that re-run from empty; strong Windows support',
      'PostgreSQL 16 in docker-compose (DATABASE_URL) — JSONB RAW provider layer + the CANONICAL graph + DERIVED materialized views, with row-level tenant scoping',
      'decimal.js / Prisma Decimal -> NUMERIC(19,4) in ONE shared lib/money module with a defined rounding mode — never a JS float for money',
      'Managed auth + RBAC + sessions + MFA (Auth.js over the local Postgres for dev, swappable for Clerk / Entra External ID) — multi-tenant identity from day one',
      'Field-level token vault: AES-256-GCM under a KMS-backed key (TOKEN_ENCRYPTION_KEY) — provider access tokens encrypted at rest, decrypted server-side only, rotatable',
      'BullMQ worker on Redis (REDIS_URL) — webhook-driven incremental Plaid /transactions/sync (cursor) + idempotent Stripe event processing, off the request path',
      'MinIO (S3-compatible, STORAGE_*) for documents — statements, paystubs, tax forms, receipts, invoices; private bucket + short-lived signed URLs',
      'Plaid Node SDK (Sandbox) + Stripe Node SDK & Stripe CLI (Test mode, `stripe listen` for signed webhooks)',
      'lib/normalize — provider->canonical sign conversion (incl. the Plaid-income exception) + classification at the ingestion edge',
      'lib/reconcile — the transfer-matching engine (amount + date window + account + counterparty + description + source IDs)',
      'Vitest + Playwright — Windows-friendly gates against Plaid Sandbox + Stripe Test + seeded fixtures',
    ],
    suggestedStructure: ['app', 'app/api', 'app/api/webhooks/plaid', 'app/api/webhooks/stripe', 'prisma', 'lib/money', 'lib/normalize', 'lib/reconcile', 'lib/provenance', 'lib/vault', 'providers/plaid', 'providers/stripe', 'worker', 'docker-compose.yml', 'scripts', 'docs'],
    defaultEnabledRoles: FULL_TEAM,
    defaultReviewTriggers: { qa: 'afterEachFeature', security: 'afterEachFeature' },
    promptStarter: `Build a product-grade FINANCIAL DATA OPERATING SYSTEM — not a budgeting toy. THESIS: connect every money source -> ingest the RAW provider data UNCHANGED -> normalize into ONE canonical ledger -> reconcile transfers so nothing double-counts -> derive net worth / cash flow / income / debt / investment / tax views -> keep PROVENANCE on every number (source, timestamp, confidence, and whether the value is OBSERVED / INFERRED / USER-ENTERED / CALCULATED). NEVER trust a single source as complete.

DATA SOURCES. PLAID is the PRIMARY consumer-finance source: transactions via /transactions/sync with a stored CURSOR (adds/modifies/removes) + the SYNC_UPDATES_AVAILABLE webhook, plus balances, auth/routing, liabilities, investments, income, statements, assets, identity, recurring. STRIPE is the first-class BUSINESS/revenue source: balance transactions, charges, refunds, disputes, fees, payouts, invoices, subscriptions, Stripe Tax — and you RECONCILE a Stripe payout to its LATER bank deposit seen via Plaid. (Stripe Financial Connections can also read balances/ownership/transactions but is narrower than Plaid — use Plaid as the bank source.)

THREE DATA LAYERS. (1) RAW provider store: persist every Plaid/Stripe API response and webhook payload UNCHANGED (provider, provider_object_id, api_version, fetched_at, payload_hash, payload_json, user_id, connection_id) for audit/debug/reprocess/schema-upgrade — represented by a generic object_type-discriminated raw entity per provider + a webhook/idempotency entity, NOT 15 raw tables. (2) CANONICAL financial graph: users/households, connections, institutions, accounts (store BOTH the provider account_id AND your own stable canonical id — a Plaid account_id can change on reconnect/token recreation and accounts can close), timestamped balance snapshots, a transactions ledger, transfer groups, categories, merchants, recurring streams, liabilities, investments/securities, income, tax, documents, manual assets/liabilities, per-field provenance, audit log. (3) DERIVED analytics: net_worth_daily, cash_flow_monthly, spend_by_category, income_by_source, recurring_calendar, debt_dashboard, investment_allocation, tax_summary_yearly, data_quality_status (materialized/computed views).

SIGN CONVENTION (the single most error-prone rule). canonical_amount is POSITIVE when money increases the user's wealth/cash and NEGATIVE when it decreases it. Convert each provider's sign at the ingestion edge: PLAID's convention is the OPPOSITE of accounting for MOST products (positive = money OUT, negative = money IN) — BUT the Plaid INCOME endpoints are an EXCEPTION (do NOT invert them). STRIPE balance transactions: positive = funds charged to another party, negative = funds sent to another party. STORE BOTH the raw provider amount AND the canonical amount. Unit-test the conversion per provider/product, including the Plaid-income exception.

TRANSFER RECONCILIATION (one of the hardest parts). A $2,000 paycheck can appear as payroll income, a bank deposit, a Stripe payout, OR a transfer; a card payment is an outflow from checking AND a payment on the card; a Stripe payout appears in Stripe then later as a bank deposit via Plaid. Build a transfer-matching engine on amount + date window + account + counterparty + description + source IDs, keeping DISTINCT concepts: true income, internal transfer, debt payment, refund/reversal, fee, investment trade, contribution, tax payment. Separate money MOVEMENT (transaction_type) from financial MEANING (classification_intent). Never auto-merge a low-confidence match — surface it for user confirmation.

MONEY IS EXACT DECIMAL/NUMERIC(19,4), NEVER FLOAT — one shared money module with a defined rounding mode (round half-up to the currency's minor unit). A float money column or a JS-number money computation is a defect.

PRODUCT-GRADE SECURITY FROM DAY ONE: managed auth + RBAC + sessions + MFA; multi-tenant ROW-LEVEL authorization (every query scoped to user/household — a user can NEVER read another tenant's data); token VAULTING with field-level encryption of provider access tokens under a KMS-backed key (rotation), server-side only, never sent to the client; immutable audit logs; VERIFY every webhook signature (Plaid JWT public-key flow; Stripe signature) + idempotency keyed on the provider event id, and treat webhook content as ADVISORY (re-fetch authoritative data server-side); PII minimization (last-4 mask only, never full numbers, never log tokens/payloads); PCI scope minimization (NEVER store raw card PANs — Stripe handles cardholder data); FTC Safeguards info-security program; an FCRA fence (records/organizes only — makes NO eligibility decisions); a user-facing data EXPORT + DELETION flow; private document storage via short-lived signed URLs.

DEV: built / run / tested on WINDOWS against a local DOCKER Postgres, with Plaid SANDBOX + Stripe TEST mode, throwaway creds in a gitignored .env.local, services bound to localhost.

BUILD IN THIS 12-STEP MVP ORDER. v1 = steps 1-7 (shippable); PHASE 8-12 later. 1 Connections + token vault (Plaid Link, Stripe auth, encrypted token storage, consent). 2 Raw ingestion (store raw unchanged, signed + idempotent webhooks). 3 Canonical accounts + balance snapshots + credit limits + types. 4 Transactions ledger (Plaid + Stripe balance txns, sign normalization incl. the Plaid-income exception, pending/posted lifecycle). 5 Transfer reconciliation (internal transfers, card payments, Stripe payout->bank). 6 Categories + merchants (provider + user override + normalization). 7 Dashboards (net worth, spending, cash flow, income, recurring). 8 Liabilities (APRs, min payments, due dates, utilization, payoff). 9 Investments/retirement (holdings, securities, allocation, dividends, contributions). 10 Income/payroll/tax docs. 11 Data-quality system (stale/broken/missing/confidence). 12 Advanced planning (forecasts, retirement projections, tax estimates, anomaly detection).

MODEL WHAT YOU CANNOT RELIABLY GET as NULLABLE + manual/inferred + confidence (never assume): deposit APY/savings rate, card rewards/points, full credit report/score (bureau + FCRA), exact tax liability, equity comp (RSU/options/ESPP), property values, insurance policies, cash/collectibles/private investments, complete cost basis/tax lots. A missing value renders 'unknown', never 0.

READ-ONLY: this app records and organizes the user's own money; it NEVER initiates a transfer, trades, pays a bill, moves money, or files taxes. Everything must build, run, and test on Windows against the Docker Postgres.`,
  },
  {
    id: 'api-service',
    disabled: true,
    name: 'API / Backend Service',
    description:
      'A public or internal API. Language-first: pick the runtime the team knows. Serverless for spiky traffic, containers for long-running.',
    suggestedStack: [
      'NestJS (TS) or ASP.NET Core Minimal API; FastAPI for Python teams',
      'PostgreSQL',
      'Azure Functions (event-driven) or Container Apps (long-running)',
      'Terraform',
    ],
    suggestedStructure: ['src', 'tests', 'infra', 'docs'],
    defaultEnabledRoles: ['stakeholder', 'architect', 'developer', 'qa', 'security'],
    defaultReviewTriggers: { qa: 'afterEachTask', security: 'afterEachFeature' },
    promptStarter:
      'A well-documented API / backend service with clear resources, auth, and tests. Choose serverless vs container hosting by traffic shape; add an API gateway only if external developers consume it.',
  },
  {
    id: 'file-workflow',
    disabled: true,
    name: 'File / Media / Document Workflow',
    description:
      'Uploads, processing, and serving of files or media — resumes, invoices, image libraries. Direct-to-storage uploads, metadata in the database, processing in the background.',
    suggestedStack: [
      'Next.js or React + Vite',
      'TypeScript',
      'object storage (Azure Blob / S3 / R2) with SAS or presigned direct upload',
      'PostgreSQL for metadata',
      'background jobs on Azure Functions',
      'Terraform',
    ],
    suggestedStructure: ['apps/web', 'apps/api', 'workers', 'infra', 'docs'],
    defaultEnabledRoles: FULL_TEAM,
    defaultReviewTriggers: { qa: 'afterEachFeature', security: 'afterEachFeature' },
    promptStarter:
      'A file/media/document workflow app: users upload directly to object storage via signed URLs, file metadata lives in the database, and processing runs in the background. Never stuff blobs in the DB.',
  },
  {
    id: 'realtime',
    disabled: true,
    name: 'Real-Time / Collaboration App',
    description:
      'Live presence, chat, notifications, or concurrent editing. The real-time pattern (notifications vs presence vs chat vs co-editing) drives the stack — so it asks that first.',
    suggestedStack: [
      'Next.js or React + Vite',
      'TypeScript',
      'real-time layer (Socket.IO / Supabase Realtime / Liveblocks for co-editing)',
      'PostgreSQL',
      'managed auth',
      'Azure Container Apps',
    ],
    suggestedStructure: ['apps/web', 'apps/realtime', 'infra', 'docs'],
    defaultEnabledRoles: FULL_TEAM,
    defaultReviewTriggers: { qa: 'afterEachFeature', security: 'afterEachFeature' },
    promptStarter:
      'A real-time app. First decide the pattern — notifications, presence, chat, or concurrent edits — because they need different layers. Assume auth is required.',
  },
  {
    id: 'mobile-app',
    disabled: true,
    name: 'Mobile App',
    description:
      'iOS/Android from one codebase. Reuses an API/SaaS backend rather than inventing a mobile-only one; Firebase/Supabase as an accelerated backend when speed matters.',
    suggestedStack: [
      'React Native + Expo (TypeScript)',
      'or Flutter',
      'a shared API backend (reuse the API/SaaS template)',
      'Supabase or Firebase for accelerated auth/storage/realtime',
    ],
    suggestedStructure: ['app', 'app/src', 'docs'],
    defaultEnabledRoles: ['stakeholder', 'projectLead', 'architect', 'developer', 'qa'],
    defaultReviewTriggers: { qa: 'afterEachFeature' },
    promptStarter:
      'A cross-platform mobile app (iOS + Android) from one codebase. Reuse a shared API backend; use an accelerated backend (Supabase/Firebase) if the brief is about speed, not bespoke architecture.',
  },
  {
    id: 'desktop-app',
    disabled: true,
    name: 'Desktop Utility',
    description:
      'A cross-platform, local-first desktop app: local storage, file-system access, OS integration, optional cloud sync later. (Yes, like the app you are using right now.)',
    suggestedStack: [
      'Electron + React + TypeScript',
      'or Tauri (smaller binaries, Rust core)',
      'local-first storage (SQLite)',
      'typed IPC',
    ],
    suggestedStructure: ['src/main', 'src/preload', 'src/renderer', 'src/shared'],
    defaultEnabledRoles: CORE_CHAIN,
    defaultReviewTriggers: { qa: 'afterEachFeature', security: 'afterEachFeature' },
    promptStarter:
      'A cross-platform desktop utility. Start local-first (local storage, file access, OS conventions, minimal main-process surface, typed IPC); add cloud sync only if the brief needs cross-device or accounts.',
  },
  {
    id: 'cli-tool',
    disabled: true,
    name: 'CLI / Dev Automation Tool',
    description:
      'A focused command-line tool with good --help, exit codes, and machine-readable output. Single-binary distribution, multi-platform release pipeline.',
    suggestedStack: [
      'Go + Cobra (single binary)',
      'or Python + Typer',
      'or .NET System.CommandLine',
      'GitHub Actions multi-platform release',
    ],
    suggestedStructure: ['cmd', 'internal', '.github/workflows', 'docs'],
    defaultEnabledRoles: ['architect', 'developer', 'qa'],
    defaultReviewTriggers: { qa: 'afterEachTask' },
    promptStarter:
      'A command-line tool with clear subcommands, helpful errors, machine-readable output flags, exit codes, and a multi-platform build/release pipeline. Usually no login or database.',
  },
];

export function getTemplateById(id: string): ProjectTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}

/** Templates offered to the founder at project creation (order preserved). */
export function activeTemplates(): ProjectTemplate[] {
  return BUILT_IN_TEMPLATES.filter((t) => !t.disabled);
}

/** Parked templates — kept for re-enabling one at a time, shown name-only. */
export function disabledTemplates(): ProjectTemplate[] {
  return BUILT_IN_TEMPLATES.filter((t) => t.disabled);
}
