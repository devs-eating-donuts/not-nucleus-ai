import { describe, expect, it } from 'vitest';
import {
  appHandlesDataOrSecrets,
  architectTemplateBlock,
  baselineCriteria,
  baselineSecurityRules,
  composeBlueprint,
  getBlueprint,
  localServicesPlanNote,
  overlaysFor,
  providedOverlayIds,
  securityRulesContextBlock,
  withBaseline,
} from './blueprints';
import { getTemplateById } from './templates';

describe('blueprints', () => {
  it('getBlueprint returns the base for a known archetype, undefined otherwise', () => {
    expect(getBlueprint('fullstack-web')?.kind).toBe('base');
    expect(getBlueprint('nope')).toBeUndefined();
    expect(getBlueprint(null)).toBeUndefined();
  });

  it('overlaysFor filters by appliesTo', () => {
    const full = overlaysFor('fullstack-web').map((o) => o.id);
    expect(full).toContain('payments'); // appliesTo includes fullstack-web
    expect(full).toContain('email'); // appliesTo 'any'
    const stat = overlaysFor('static-site').map((o) => o.id);
    expect(stat).toContain('email');
    expect(stat).not.toContain('payments'); // not applicable to static-site
  });

  it('composeBlueprint(base) returns just the base content', () => {
    const c = composeBlueprint('fullstack-web', []);
    expect(c.decisions.some((d) => d.id === 'framework')).toBe(true);
    expect(c.dataEntities.some((e) => e.name === 'User')).toBe(true);
    expect(c.dataEntities.some((e) => e.name === 'WebhookEvent')).toBe(false);
  });

  it('merges an applicable overlay (payments → fullstack-web)', () => {
    const c = composeBlueprint('fullstack-web', ['payments']);
    expect(c.dataEntities.some((e) => e.name === 'WebhookEvent')).toBe(true);
    expect(c.envVars).toContain('STRIPE_SECRET_KEY');
    expect(c.securityRules.some((s) => /webhook signature/i.test(s))).toBe(true);
    expect(c.acceptanceCriteria.some((p) => p.forTask.includes('payments'))).toBe(true);
    expect(c.decisions.some((d) => d.id === 'framework')).toBe(true); // base still present
  });

  it('ignores an overlay that does not apply to the base', () => {
    const c = composeBlueprint('static-site', ['payments']);
    expect(c.envVars).not.toContain('STRIPE_SECRET_KEY');
    expect(c.dataEntities.some((e) => e.name === 'WebhookEvent')).toBe(false);
  });

  it('dedups merged arrays and ignores unknown overlay ids', () => {
    const c = composeBlueprint('fullstack-web', ['payments', 'payments', 'does-not-exist']);
    expect(c.dataEntities.filter((e) => e.name === 'WebhookEvent')).toHaveLength(1);
  });

  it('does not offer payments for a template that has no base blueprint', () => {
    // api-service is a real template with no Blueprint yet — payments must not be
    // offered there, or it would compose with no archetype grounding.
    expect(overlaysFor('api-service').map((o) => o.id)).not.toContain('payments');
    // composing it anyway (defensive) returns no orphaned payments content.
    expect(composeBlueprint('api-service', ['payments']).envVars).not.toContain('STRIPE_SECRET_KEY');
  });

  it('saas has full depth — multi-tenant isolation + Azure production controls, and payments composes', () => {
    const bp = getBlueprint('saas');
    expect(bp?.kind).toBe('base');
    const c = composeBlueprint('saas', []);
    expect(c.decisions.map((d) => d.id)).toEqual(
      expect.arrayContaining(['auth', 'hosting', 'api-edge', 'iac', 'database']),
    );
    expect(c.dataEntities.map((e) => e.name)).toEqual(
      expect.arrayContaining(['Organization', 'Membership', 'Entitlement']),
    );
    expect(c.securityRules.some((r) => /tenant isolation/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /private endpoint/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /managed identity/i.test(r))).toBe(true);
    expect(c.acceptanceCriteria.map((p) => p.forTask)).toContain('production hardening / go-live');
    // It depends on Postgres locally, so the shared local-dev decision is present once.
    expect(c.decisions.filter((d) => d.id === 'local-dev')).toHaveLength(1);
    // payments now composes onto saas (it has a base) and adds the Stripe content.
    expect(overlaysFor('saas').map((o) => o.id)).toContain('payments');
    const withPay = composeBlueprint('saas', ['payments']);
    expect(withPay.envVars).toContain('STRIPE_SECRET_KEY');
    expect(withPay.dataEntities.some((e) => e.name === 'WebhookEvent')).toBe(true);
    // Azure toolchain declared (ready for when this parked template re-enables).
    expect(c.buildTools).toEqual(expect.arrayContaining(['node', 'git', 'docker', 'az', 'terraform']));
  });

  it('saas-ai-budget has full depth — no-direct-AI-exposure + RunPod serverless, and payments composes', () => {
    const bp = getBlueprint('saas-ai-budget');
    expect(bp?.kind).toBe('base');
    const c = composeBlueprint('saas-ai-budget', []);
    // Its AI-specific decision matrix is present (endpoint / runtime / models) alongside auth + db.
    expect(c.decisions.map((d) => d.id)).toEqual(
      expect.arrayContaining(['auth', 'database', 'ai-endpoint', 'ai-runtime', 'ai-models']),
    );
    // RunPod serverless (scale-to-zero) is the recommended default ("on a budget").
    const aiEndpoint = c.decisions.find((d) => d.id === 'ai-endpoint');
    expect(aiEndpoint?.recommend).toBe('A');
    expect(aiEndpoint?.options.find((o) => o.key === 'A')?.label).toMatch(/serverless/i);
    // Defining RunPod security invariants are encoded.
    expect(c.securityRules.some((r) => /never calls the AI directly/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /row level security|RLS/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /RunPod/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /restricted .*key|endpoint-scoped/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /workersMin|scale to zero/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /never log raw prompts/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /WAF/i.test(r))).toBe(true);
    // The RunPod key is a named env var; the old Ollama/CF-tunnel vars are gone.
    expect(c.envVars).toEqual(expect.arrayContaining(['RUNPOD_API_KEY', 'RUNPOD_ENDPOINT_ID']));
    expect(c.envVars).not.toContain('OLLAMA_BASE_URL');
    expect(c.envVars).not.toContain('CF_ACCESS_CLIENT_ID');
    // Audit entity carries NO raw-prompt field (metadata only).
    const audit = c.dataEntities.find((e) => e.name === 'AiRequestAudit');
    expect(audit).toBeDefined();
    expect(audit?.fields).not.toEqual(expect.arrayContaining(['prompt', 'response']));
    expect(c.acceptanceCriteria.map((p) => p.forTask)).toContain('ai access path / no direct exposure');
    // Transactional email (Postmark) is baked into the base — not left to the optional overlay.
    expect(c.decisions.some((d) => d.id === 'email-provider')).toBe(true);
    expect(c.envVars).toEqual(expect.arrayContaining(['POSTMARK_SERVER_TOKEN', 'POSTMARK_FROM_EMAIL']));
    expect(c.securityRules.some((r) => /Postmark/i.test(r))).toBe(true);
    expect(c.acceptanceCriteria.map((p) => p.forTask)).toContain('transactional email');
    // Local dev stands up Supabase and a local model server, asked once.
    expect(c.decisions.filter((d) => d.id === 'local-dev')).toHaveLength(1);
    expect(c.localServices.some((s) => /supabase/i.test(s.service))).toBe(true);
    expect(c.localServices.some((s) => /model server|ollama/i.test(s.service))).toBe(true);
    // payments composes onto it (Stripe billing is part of the architecture).
    expect(overlaysFor('saas-ai-budget').map((o) => o.id)).toContain('payments');
    const withPay = composeBlueprint('saas-ai-budget', ['payments']);
    expect(withPay.envVars).toContain('STRIPE_SECRET_KEY');
    expect(withPay.dataEntities.some((e) => e.name === 'WebhookEvent')).toBe(true);
  });

  it('personal-finance is a product-grade FDOS — Plaid+Stripe, 3-layer, multi-tenant, money-is-decimal', () => {
    const bp = getBlueprint('personal-finance');
    expect(bp?.kind).toBe('base');
    const c = composeBlueprint('personal-finance', []);
    // The FDOS decision matrix (frontend/api/orm/auth/db/storage/plaid/stripe/sync/vault/reconcile/money/hosting)
    // plus the shared local-dev decision appended exactly once.
    expect(c.decisions.map((d) => d.id)).toEqual(
      expect.arrayContaining([
        'frontend', 'api-layer', 'orm', 'auth', 'database', 'storage',
        'plaid-env', 'stripe-mode', 'sync-architecture', 'token-vault',
        'reconciliation', 'money-representation', 'hosting',
      ]),
    );
    expect(c.decisions.find((d) => d.id === 'frontend')?.recommend).toBe('A');
    expect(c.decisions.filter((d) => d.id === 'local-dev')).toHaveLength(1);
    // The 3-layer model: raw provider store + canonical graph + provenance.
    expect(c.dataEntities.map((e) => e.name)).toEqual(
      expect.arrayContaining([
        'RawPlaidObject', 'RawStripeObject', 'WebhookEvent',
        'Account', 'BalanceSnapshot', 'Transaction', 'TransferGroup', 'ProvenanceRecord',
      ]),
    );
    // Transaction carries BOTH provider + canonical amount (sign normalization).
    const txn = c.dataEntities.find((e) => e.name === 'Transaction');
    expect(txn?.fields.some((f) => /provider_amount/.test(f))).toBe(true);
    expect(txn?.fields.some((f) => /canonical_amount/.test(f))).toBe(true);
    // Load-bearing fintech rules.
    expect(c.securityRules.some((r) => /money is decimal, never float/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /row-level authorization/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /verify every webhook signature/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /idempotent/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /field-level encryption|vaulted/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /read-only by design/i.test(r))).toBe(true);
    // Phased acceptance packs (v1 = steps 1-7 + runs-locally).
    expect(c.acceptanceCriteria.map((p) => p.forTask)).toEqual(
      expect.arrayContaining([
        'step 1 — connections + token vault',
        'step 4 — transactions ledger + sign normalization',
        'step 5 — transfer reconciliation (no double-counting)',
        'tenant isolation + auth + audit',
        'runs locally (Windows + Docker)',
      ]),
    );
    // nonGoals are now INVERTED — multi-tenant is a GOAL; read-only + FCRA/PCI fences instead.
    expect(c.nonGoals.some((n) => /single-tenant-only/i.test(n))).toBe(true);
    expect(c.nonGoals.some((n) => /money movement/i.test(n))).toBe(true);
    expect(c.nonGoals.some((n) => /FCRA/i.test(n))).toBe(true);
    // Auth + DB + storage baked in; full product toolchain (incl. stripe + gh).
    expect(providedOverlayIds('personal-finance').sort()).toEqual(['authentication', 'database', 'storage']);
    expect(c.buildTools).toEqual(['node', 'git', 'docker', 'stripe', 'gh']);
    // Local stack: Postgres + Redis (sync worker) + MinIO (documents).
    expect(c.localServices.filter((s) => /postgres/i.test(s.service))).toHaveLength(1);
    expect(c.localServices.some((s) => /redis/i.test(s.localVia))).toBe(true);
    expect(c.localServices.some((s) => /minio/i.test(s.localVia))).toBe(true);
  });

  it('personal-finance SKIPS the auth/database/storage overlays it provides; payments not offered, email is', () => {
    // Ticking Auth/Database/Storage must NOT re-compose them (provides skips them — no divergent content).
    const c = composeBlueprint('personal-finance', ['authentication', 'database', 'storage']);
    expect(c.decisions.filter((d) => d.id === 'auth')).toHaveLength(1); // the base's own, not doubled by the overlay
    expect(c.decisions.filter((d) => d.id === 'database')).toHaveLength(1);
    expect(c.decisions.filter((d) => d.id === 'storage')).toHaveLength(1);
    expect(c.localServices.filter((s) => /postgresql database/i.test(s.service))).toHaveLength(1);
    // Stripe here is a DATA SOURCE, not billing, so payments stays un-offered; email ('any') still composes.
    expect(overlaysFor('personal-finance').map((o) => o.id)).not.toContain('payments');
    expect(overlaysFor('personal-finance').map((o) => o.id)).toContain('email');
  });

  it('a base declares the capabilities it bakes in via provides()', () => {
    // Supabase base bakes in auth + db + storage; the Azure/web bases bake auth + db.
    expect(providedOverlayIds('saas-ai-budget').sort()).toEqual(['authentication', 'database', 'email', 'storage']);
    expect(providedOverlayIds('saas').sort()).toEqual(['authentication', 'database']);
    expect(providedOverlayIds('fullstack-web').sort()).toEqual(['authentication', 'database']);
    expect(providedOverlayIds('static-site')).toEqual([]); // bakes in nothing
    expect(providedOverlayIds('api-service')).toEqual([]); // no base blueprint
  });

  it('composeBlueprint SKIPS an overlay the base already provides (no redundant/divergent content)', () => {
    // Ticking Database/Storage on the Supabase base must NOT add the overlay's non-Supabase
    // keys (DATABASE_URL / PostgreSQL docker service / S3 MinIO / StoredFile).
    const c = composeBlueprint('saas-ai-budget', ['database', 'storage', 'authentication']);
    expect(c.envVars).not.toContain('DATABASE_URL');
    expect(c.envVars).not.toContain('AUTH_SECRET');
    expect(c.envVars).not.toEqual(expect.arrayContaining(['STORAGE_BUCKET']));
    expect(c.localServices.some((s) => /postgresql database/i.test(s.service))).toBe(false);
    expect(c.localServices.some((s) => /minio/i.test(s.localVia))).toBe(false);
    expect(c.dataEntities.some((e) => e.name === 'StoredFile')).toBe(false);
    // The base's own Supabase services are still present.
    expect(c.envVars).toContain('SUPABASE_URL');
    expect(c.localServices.some((s) => /supabase/i.test(s.service))).toBe(true);
    // A non-provided overlay (payments) still composes.
    expect(composeBlueprint('saas-ai-budget', ['payments']).envVars).toContain('STRIPE_SECRET_KEY');
  });

  it('empty/unknown template yields empty base; "any" overlays still compose', () => {
    expect(composeBlueprint(null, []).decisions).toEqual([]);
    const c = composeBlueprint(null, ['email']); // email is appliesTo:'any'
    expect(c.envVars).toContain('POSTMARK_SERVER_TOKEN');
  });

  it('buildTools compose + dedup across base and overlays', () => {
    // The static site's toolchain: node + git + wrangler (Cloudflare Workers deploy).
    expect(composeBlueprint('static-site', []).buildTools).toEqual(['node', 'git', 'wrangler']);
    // The AI-SaaS base declares its full toolchain (incl. stripe).
    const ai = composeBlueprint('saas-ai-budget', []).buildTools;
    expect(ai).toEqual(expect.arrayContaining(['node', 'git', 'docker', 'supabase', 'wrangler', 'stripe']));
    // Adding payments (which also needs stripe) does not duplicate it.
    const aiPay = composeBlueprint('saas-ai-budget', ['payments']).buildTools;
    expect(aiPay.filter((t) => t === 'stripe')).toHaveLength(1);
    // A base-less project with the database overlay still needs docker (local services).
    expect(composeBlueprint(null, ['database']).buildTools).toContain('docker');
    // Empty when no base and no tool-bearing overlay.
    expect(composeBlueprint(null, []).buildTools).toEqual([]);
  });

  it('dashboard has full depth — RBAC, an audit trail, and bounded queries', () => {
    const bp = getBlueprint('dashboard');
    expect(bp?.kind).toBe('base');
    const c = composeBlueprint('dashboard', []);
    // Its decision matrix and a few archetype-defining rules/entities are present.
    expect(c.decisions.map((d) => d.id)).toEqual(
      expect.arrayContaining(['architecture', 'auth', 'authorization', 'database', 'hosting']),
    );
    expect(c.dataEntities.map((e) => e.name)).toContain('AuditLog');
    expect(c.securityRules.some((r) => /audit/i.test(r))).toBe(true);
    expect(c.securityRules.some((r) => /authoriz/i.test(r))).toBe(true);
    expect(c.acceptanceCriteria.map((p) => p.forTask)).toContain('audit log');
  });

  it('the email overlay composes onto dashboard (appliesTo: any), payments does not', () => {
    expect(overlaysFor('dashboard').map((o) => o.id)).toContain('email');
    expect(overlaysFor('dashboard').map((o) => o.id)).not.toContain('payments');
    expect(composeBlueprint('dashboard', ['email']).envVars).toContain('POSTMARK_SERVER_TOKEN');
  });

  it('overlays apply to any archetype, in setup-page order (data services lead)', () => {
    // The setup page shows the Git checkbox first, then these overlays in this order:
    // the locally-simulatable data services (database, cache, storage) grouped first.
    expect(overlaysFor('fullstack-web').map((o) => o.id)).toEqual([
      'database',
      'cache',
      'storage',
      'authentication',
      'email',
      'payments',
    ]);
    // The 'any' overlays apply even to a base-less archetype; payments does not.
    expect(overlaysFor('api-service').map((o) => o.id)).toEqual([
      'database',
      'cache',
      'storage',
      'authentication',
      'email',
    ]);
  });

  it('database / authentication overlays supply content for a base-less archetype', () => {
    const c = composeBlueprint('api-service', ['database', 'authentication']);
    expect(c.decisions.map((d) => d.id)).toEqual(expect.arrayContaining(['database', 'auth']));
    expect(c.envVars).toEqual(expect.arrayContaining(['DATABASE_URL', 'AUTH_SECRET']));
    expect(c.dataEntities.some((e) => e.name === 'User')).toBe(true);
    expect(c.securityRules.some((r) => /parameterized queries/i.test(r))).toBe(true);
  });

  it('an auth/database overlay does NOT duplicate a base that already covers them (dedup, base wins)', () => {
    const c = composeBlueprint('fullstack-web', ['database', 'authentication']);
    // Single 'auth' and 'database' decision (base's), not doubled by the overlay.
    expect(c.decisions.filter((d) => d.id === 'auth')).toHaveLength(1);
    expect(c.decisions.filter((d) => d.id === 'database')).toHaveLength(1);
    // Single User entity, single DATABASE_URL env var.
    expect(c.dataEntities.filter((e) => e.name === 'User')).toHaveLength(1);
    expect(c.envVars.filter((e) => e === 'DATABASE_URL')).toHaveLength(1);
  });

  it('the cache overlay supplies Redis, a local service, and graceful-degradation rules', () => {
    const c = composeBlueprint('fullstack-web', ['cache']);
    expect(c.envVars).toContain('REDIS_URL');
    expect(c.decisions.some((d) => d.id === 'cache-store')).toBe(true);
    expect(c.localServices.some((s) => /redis/i.test(s.service))).toBe(true);
    expect(c.securityRules.some((r) => /source of truth/i.test(r))).toBe(true);
    expect(c.acceptanceCriteria.some((p) => p.forTask === 'cache')).toBe(true);
  });

  it('the storage overlay supplies object storage, MinIO local sim, and signed-URL rules', () => {
    const c = composeBlueprint('fullstack-web', ['storage']);
    expect(c.envVars).toEqual(expect.arrayContaining(['STORAGE_BUCKET', 'STORAGE_ENDPOINT']));
    expect(c.decisions.some((d) => d.id === 'storage-backend')).toBe(true);
    expect(c.localServices.some((s) => /minio/i.test(s.localVia))).toBe(true);
    expect(c.dataEntities.some((e) => e.name === 'StoredFile')).toBe(true);
    expect(c.securityRules.some((r) => /signed url/i.test(r))).toBe(true);
  });

  it('a data-service blueprint carries the shared local-dev decision exactly once', () => {
    // fullstack-web bakes in a DB; adding the database + cache overlays must not
    // multiply the shared local-dev decision — it dedups by id to a single ask.
    const c = composeBlueprint('fullstack-web', ['database', 'cache', 'storage']);
    expect(c.decisions.filter((d) => d.id === 'local-dev')).toHaveLength(1);
    // Postgres lands once even though both the base and the database overlay add it.
    expect(c.localServices.filter((s) => /postgres/i.test(s.service))).toHaveLength(1);
  });

  it('a static site has no local data services (note stays empty)', () => {
    const c = composeBlueprint('static-site', []);
    expect(c.localServices).toEqual([]);
    expect(localServicesPlanNote(c.localServices)).toBe('');
    expect(c.decisions.some((d) => d.id === 'local-dev')).toBe(false);
  });

  it('localServicesPlanNote renders an early-task + verify-locally instruction', () => {
    const c = composeBlueprint('fullstack-web', ['cache', 'storage']);
    const note = localServicesPlanNote(c.localServices);
    expect(note).toMatch(/LOCAL DEV ENVIRONMENT/);
    expect(note).toMatch(/EARLY task/);
    expect(note).toMatch(/verify it runs locally/i);
    // It names each service's connection env so the wiring is explicit.
    expect(note).toMatch(/DATABASE_URL/);
    expect(note).toMatch(/REDIS_URL/);
    expect(note).toMatch(/STORAGE_ENDPOINT/);
  });

  // architectTemplateBlock — the Richard-chat guidance block. A prior bug was
  // that the old buildTemplateBlock early-returned '' when templateId was null, so a
  // scaffolder/wizard project (overlays only, no base template) gave Richard nothing.
  describe('architectTemplateBlock (Richard chat guidance)', () => {
    it('composes overlay decisions + security rules with NO base template', () => {
      // Pre-condition: the database overlay actually carries this depth.
      const composed = composeBlueprint(null, ['database']);
      expect(composed.decisions.length).toBeGreaterThan(0);
      expect(composed.securityRules.length).toBeGreaterThan(0);

      const block = architectTemplateBlock(undefined, composed);
      // The fix: it is no longer empty on the templateId:null path...
      expect(block).not.toBe('');
      expect(block).toMatch(/DECISIONS TO COVER/);
      expect(block).toMatch(/NON-NEGOTIABLE SECURITY RULES/);
      // ...but there is no "SELECTED TEMPLATE" head, since no base archetype was chosen.
      expect(block).not.toMatch(/SELECTED TEMPLATE \/ ARCHETYPE/);
    });

    it('returns "" when there is no template AND nothing composes (byte-identical to before)', () => {
      expect(architectTemplateBlock(undefined, composeBlueprint(null, []))).toBe('');
    });

    it('renders the template head + composed decisions + security when a base template is chosen', () => {
      const template = getTemplateById('saas-ai-budget');
      expect(template).toBeDefined();
      const composed = composeBlueprint('saas-ai-budget', []);
      const block = architectTemplateBlock(template, composed);
      expect(block).toMatch(/SELECTED TEMPLATE \/ ARCHETYPE/);
      expect(block).toContain(template!.name);
      expect(block).toContain(template!.suggestedStack.join(', '));
      expect(block).toMatch(/DECISIONS TO COVER/);
      expect(block).toMatch(/NON-NEGOTIABLE SECURITY RULES/);
    });

    it('renders the head alone when a template is chosen but nothing composes', () => {
      const template = getTemplateById('static-site');
      const block = architectTemplateBlock(template, composeBlueprint(null, []));
      expect(block).toMatch(/SELECTED TEMPLATE \/ ARCHETYPE/);
      expect(block).not.toMatch(/DECISIONS TO COVER/);
      expect(block).not.toMatch(/NON-NEGOTIABLE SECURITY RULES/);
    });
  });

  // securityRulesContextBlock — B2: the build/review seats are TOLD the rules at build
  // time (previously roleContextBlocks never included them, so dev built insecurely).
  describe('securityRulesContextBlock (dev/review context)', () => {
    it('returns "" for no rules (byte-identical for from-scratch projects)', () => {
      expect(securityRulesContextBlock([])).toBe('');
    });

    it('renders the composed rules as a labeled requirements block', () => {
      const rules = composeBlueprint(null, ['database']).securityRules;
      expect(rules.length).toBeGreaterThan(0);
      const block = securityRulesContextBlock(rules);
      expect(block).toMatch(/SECURITY & QUALITY RULES/);
      expect(block).toMatch(/REQUIREMENTS/);
      // every composed rule is present as a bullet
      for (const r of rules) {
        expect(block).toContain(`- ${r}`);
      }
    });
  });

  it('static-site encodes the secure contact-form stack (Astro / Workers / Turnstile / Postmark)', () => {
    const c = composeBlueprint('static-site', []);
    const decisionIds = c.decisions.map((d) => d.id);
    expect(decisionIds).toEqual(expect.arrayContaining(['framework', 'hosting', 'spam', 'email']));
    // The framework decision recommends Astro; the email decision recommends Postmark.
    const framework = c.decisions.find((d) => d.id === 'framework');
    expect(framework?.options.find((o) => o.key === framework.recommend)?.label).toMatch(/Astro/i);
    const email = c.decisions.find((d) => d.id === 'email');
    expect(email?.options.find((o) => o.key === email.recommend)?.label).toMatch(/Postmark/i);
    // The load-bearing security invariants: Turnstile verified SERVER-SIDE; email token never client-side.
    const rules = c.securityRules.join('\n');
    expect(rules).toMatch(/verify the captcha\/turnstile token server-side/i);
    expect(rules).toMatch(/never appear in client code/i);
    // The secrets surface feeds the secrets manifest.
    expect(c.envVars).toEqual(expect.arrayContaining(['TURNSTILE_SECRET_KEY', 'POSTMARK_SERVER_TOKEN']));
    // A contact-form AC asserts server-side verification + no-secret-in-bundle.
    const formPack = c.acceptanceCriteria.find((p) => p.forTask === 'contact form');
    expect(formPack?.criteria.some((cr) => /verified server-side/i.test(cr))).toBe(true);
    expect(formPack?.criteria.some((cr) => /client bundle/i.test(cr))).toBe(true);
  });

  // The always-on, posture-gated baseline security floor.
  describe('baseline security floor', () => {
    it('appHandlesDataOrSecrets: true for a data app OR a secrets app; false only for from-scratch', () => {
      // A scaffolder/wizard project with data overlays → has persistence.
      expect(appHandlesDataOrSecrets(composeBlueprint(null, ['database', 'cache']))).toBe(true);
      // The static marketing site now carries the contact-form secrets (Turnstile secret key,
      // Postmark server token) → handles secrets (still no persistence — see the floor test below).
      expect(appHandlesDataOrSecrets(composeBlueprint('static-site', []))).toBe(true);
      // A from-scratch project → nothing composes.
      expect(appHandlesDataOrSecrets(composeBlueprint(null, []))).toBe(false);
      // An email overlay carries a secret token but no persistence.
      expect(appHandlesDataOrSecrets(composeBlueprint(null, ['email']))).toBe(true);
    });

    it('returns [] when the app touches no data or secrets (byte-identical for from-scratch)', () => {
      expect(baselineSecurityRules(composeBlueprint(null, []), 'public-internet')).toEqual([]);
      expect(baselineCriteria(composeBlueprint(null, []), 'public-internet')).toEqual([]);
    });

    it('a static marketing site with form secrets gets the always-floor but NEVER auth (no persistence)', () => {
      // Turnstile secret + Postmark token → the always-on floor (read-secrets-from-env, validation),
      // but no persistence → no auth/ownership demand even under a public-internet posture (a
      // brochure site is never told to add authentication).
      const rules = baselineSecurityRules(composeBlueprint('static-site', []), 'public-internet');
      expect(rules.some((r) => /read every secret/i.test(r))).toBe(true);
      expect(rules.some((r) => /validate.*input/i.test(r))).toBe(true);
      expect(rules.some((r) => /authenticate/i.test(r))).toBe(false);
      expect(rules.some((r) => /another user’s records/i.test(r))).toBe(false);
    });

    it('a single-user/localhost data app gets the data-at-rest floor but NO auth demand', () => {
      const composed = composeBlueprint(null, ['database']);
      const rules = baselineSecurityRules(composed, 'local-single-user');
      // The always-on floor is present…
      expect(rules.some((r) => /encrypt.*at rest/i.test(r))).toBe(true);
      expect(rules.some((r) => /validate.*input/i.test(r))).toBe(true);
      // …but NEVER an authentication requirement (the false-CRITICAL guard).
      expect(rules.some((r) => /authenticate/i.test(r))).toBe(false);
      expect(rules.some((r) => /another user’s records/i.test(r))).toBe(false);
    });

    it('a public-internet data app gets auth AND ownership on top of the always floor', () => {
      const rules = baselineSecurityRules(composeBlueprint(null, ['database']), 'public-internet');
      expect(rules.some((r) => /authenticate.*non-public route/i.test(r))).toBe(true);
      expect(rules.some((r) => /another user’s records/i.test(r))).toBe(true);
    });

    it('an internal data app gets auth but NOT cross-user ownership', () => {
      const rules = baselineSecurityRules(composeBlueprint(null, ['database']), 'internal');
      expect(rules.some((r) => /authenticate/i.test(r))).toBe(true);
      expect(rules.some((r) => /another user’s records/i.test(r))).toBe(false);
    });

    it('multi-tenant gets both auth and ownership', () => {
      const rules = baselineSecurityRules(composeBlueprint(null, ['database']), 'multi-tenant');
      expect(rules.some((r) => /authenticate/i.test(r))).toBe(true);
      expect(rules.some((r) => /another user’s records/i.test(r))).toBe(true);
    });

    it('a secrets-only app (email, no persistence) never gets auth even under public-internet', () => {
      const rules = baselineSecurityRules(composeBlueprint(null, ['email']), 'public-internet');
      expect(rules.some((r) => /encrypt|read every secret/i.test(r))).toBe(true);
      expect(rules.some((r) => /authenticate/i.test(r))).toBe(false);
    });

    it('withBaseline returns the SAME object when nothing composes (byte-identical)', () => {
      // A from-scratch project (no data, no secrets) → the floor is empty → same object.
      const composed = composeBlueprint(null, []);
      expect(withBaseline(composed, 'public-internet')).toBe(composed);
    });

    it('withBaseline appends baseline rules + a criteria pack for a data app, deduped', () => {
      const base = composeBlueprint(null, ['database']);
      const composed = withBaseline(base, 'public-internet');
      expect(composed.securityRules.length).toBeGreaterThan(base.securityRules.length);
      // No duplicate rule strings.
      expect(new Set(composed.securityRules).size).toBe(composed.securityRules.length);
      // The baseline AC pack landed.
      expect(composed.acceptanceCriteria.some((p) => p.forTask === 'security baseline')).toBe(true);
    });
  });
});
