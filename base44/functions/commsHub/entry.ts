// Communication Hub — the Business Communication control plane.
//
// Provider-agnostic by design: business logic talks to adapter objects from the
// shared comms provider catalog. Version 1 is email; the same action surface
// (enableProvider / provisionMailbox / send / sync / ai) is reused by future
// channels (whatsapp, sms, voice, internal, push) — they just register their
// own adapters under the same catalog.
//
// CONTRACTS:
//   • No SMTP / IMAP / email server. Adapters return provider-shaped, offline
//     responses; production wiring replaces them with live API calls + secrets.
//   • No direct AI provider calls — every AI capability goes through the
//     AI Orchestration Engine (versioned Prompt registry + Knowledge Graph).
//   • No embedded prompts — referenced by id, seeded idempotently.
//   • Reuses Domain Engine (read-only) and the Knowledge Graph (markStale).
//   • All telemetry → CommunicationLog. All cross-module signals → Event Bus.
//   • Tenant isolation via RLS on every entity; IDs are never trusted from input.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { orchestrate } from '../../shared/orchestration/engine.ts';
import { ensureCommsPrompts } from '../../shared/comms/prompts.ts';
import { buildDnsRecords, validateDns, tlsStatusFor } from '../../shared/comms/dns.ts';
import { getProvider, listProviders } from '../../shared/comms/providers.ts';
import { defaultMailboxSet, MAILBOX_TO_CATEGORY } from '../../shared/comms/mailboxTemplates.ts';
import { markStale } from '../../shared/knowledge-graph/index.ts';
import { bus } from '../../shared/events/bus.ts';

const actorName = (u: any) => (u && (u.full_name || u.email)) || (u && u.id) || 'system';

async function logTelemetry(svc: any, p: {
  tenant_id: string; business_id?: string; channel?: string; provider_id?: string; mailbox_id?: string;
  kind: string; status: string; latency_ms?: number; sync_duration_ms?: number; storage_mb?: number;
  messages_processed?: number; tokens?: number; ai_cost?: number; error_message?: string; retry_count?: number;
  actor?: string; metadata?: any;
}) {
  try {
    await svc.entities.CommunicationLog.create({
      tenant_id: p.tenant_id, business_id: p.business_id || '', channel: p.channel || 'email',
      provider_id: p.provider_id || '', mailbox_id: p.mailbox_id || '', kind: p.kind as any, status: p.status as any,
      latency_ms: p.latency_ms || 0, sync_duration_ms: p.sync_duration_ms || 0, storage_mb: p.storage_mb || 0,
      messages_processed: p.messages_processed || 0, tokens: p.tokens || 0, ai_cost: p.ai_cost || 0,
      error_message: p.error_message || '', retry_count: p.retry_count || 0, actor: p.actor || 'system',
      metadata: p.metadata || {},
    });
  } catch {}
}

async function audit(svc: any, p: { tenant_id: string; business_id: string; mailbox_id?: string; actor: string; action: string; metadata?: any }) {
  await logTelemetry(svc, { tenant_id: p.tenant_id, business_id: p.business_id, mailbox_id: p.mailbox_id, kind: 'audit', status: 'info', actor: p.actor, metadata: { action: p.action, ...p.metadata || {} } });
}

async function dispatch(type: any, payload: any) { try { await bus.dispatch(type, payload); } catch {} }

const now = () => new Date().toISOString();
const dedupe = (arr: any[], key: string) => arr.filter((v: any, i: number, a: any[]) => a.findIndex((x: any) => x[key] === v[key]) === i);

async function getBusiness(svc: any, base44: any, businessId: string) {
  const b: any = await base44.entities.Business.get(businessId);
  return { business: b, tenant_id: b.tenant_id, business_id: businessId };
}

// Enforce that the caller owns the target mailbox before any mutation or send.
// Mailboxes are fetched with the service role (RLS-bypassing), so a user-supplied
// mailbox_id from another tenant would otherwise let a caller send, alter, or
// delete a victim's mailbox. Admins bypass the tenant check.
function assertMailboxOwner(user: any, m: any): void {
  if (user?.role === "admin") return;
  if (!m) throw Object.assign(new Error("Mailbox not found"), { code: "NOT_FOUND" });
  const tenantId = user?.data?.tenant_id;
  if (tenantId && m.tenant_id !== tenantId) throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
}
function ownerErr(e: any): Response {
  return Response.json({ error: e?.message || "Forbidden" }, { status: e?.code === "NOT_FOUND" ? 404 : 403 });
}

async function defaultProviderConfig(svc: any, businessId: string): Promise<any | null> {
  const rows = await svc.entities.EmailProviderConfig.filter({ business_id: businessId });
  return rows.find((p: any) => p.is_default && p.is_active) || rows.find((p: any) => p.is_active) || rows[0] || null;
}

async function findDomain(svc: any, businessId: string): Promise<any | null> {
  const rows = await svc.entities.Domain.filter({ business_id: businessId });
  return rows.find((d: any) => d.status === 'registered' || d.status === 'active') || rows[0] || null;
}

async function findDomainConfig(svc: any, businessId: string, domainName: string): Promise<any | null> {
  const rows = await svc.entities.EmailDomainConfig.filter({ business_id: businessId, domain_name: domainName });
  return rows[0] || null;
}

function industryFromBlueprint(business: any, ctx: any): string {
  const ind = ctx?.blueprint?.industry || ctx?.business?.industry || business?.industry || '';
  const s = String(ind || '').toLowerCase();
  if (/dental|dent|ortho|clin/i.test(s)) return 'dental';
  if (/gym|fitness|train|yoga|wellness|nutrition/i.test(s)) return 'gym';
  if (/manufact|factor|industr|wholesale|dispatch/i.test(s)) return 'manufacturer';
  if (/hotel|hospital|resort|restaurant|cafe|catering/i.test(s)) return 'hospitality';
  if (/retail|shop|store|ecommerce|e-commerce/i.test(s)) return 'retail';
  if (/legal|law|attorney|solicitor/i.test(s)) return 'legal';
  return 'standard';
}

// ---------- inbound routing automation ----------
async function applyAutomations(svc: any, message: any, businessId: string, tenantId: string, actor: string): Promise<void> {
  const rules = (await svc.entities.EmailAutomationRule.filter({ business_id: businessId })).filter((r: any) => r.enabled && (!r.mailbox_scope?.length || r.mailbox_scope.includes(message.mailbox_id)));
  rules.sort((a: any, b: any) => (a.priority || 0) - (b.priority || 0));
  if (!rules.length) return;
  const sub = String(message.subject || '').toLowerCase(); const from = String(message.from_addr || '').toLowerCase(); const cat = String(message.ai_category || '').toLowerCase();
  let triggered = 0;
  for (const rule of rules) {
    let matched = false;
    if (rule.trigger === 'subject_contains') matched = rule.conditions?.some((c: any) => sub.includes(String(c.value || '').toLowerCase()));
    else if (rule.trigger === 'from_contains') matched = rule.conditions?.some((c: any) => from.includes(String(c.value || '').toLowerCase()));
    else if (rule.trigger === 'category_is' || rule.trigger === 'ai_category_is') matched = rule.conditions?.some((c: any) => cat === String(c.value || '').toLowerCase());
    else if (rule.trigger === 'has_invoice') matched = /invoice|receipt|billing|payment|remittance/i.test(sub);
    else if (rule.trigger === 'has_complaint') matched = /complaint|issue|problem|broken|not working|refund/i.test(sub);
    else if (rule.trigger === 'has_lead') matched = /quote|quotation|pricing|interested|inquiry|demo|enquiry/i.test(sub);
    else if (rule.trigger === 'vip_customer') matched = rule.conditions?.some((c: any) => from.includes(String(c.value || '').toLowerCase())) || /vip|priority/.test(sub);
    else if (rule.trigger === 'importance_is') matched = message.importance && String(message.importance) === String(rule.conditions?.[0]?.value);
    if (!matched) continue;
    triggered++;
    const labels = new Set<string>(message.labels || []);
    for (const a of rule.actions || []) {
      if (a.type === 'label' && a.value) labels.add(String(a.value).toLowerCase());
      if (a.type === 'set_category' && a.value) message.ai_category = a.value;
      if (a.type === 'assign' && a.value) { message.assigned_user_id = a.value; }
      if (a.type === 'create_ticket' && a.value) message.tags = [...(message.tags || []), 'ticket-pending'];
    }
    message.labels = [...labels];
  }
  if (triggered) {
    dispatch('EmailCategorized', { tenantId, businessId: businessId, actor, payload: { message_id: message.id, mailbox_id: message.mailbox_id, rules_matched: triggered, labels: message.labels } });
  }
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const actor = actorName(user);

    // ---------- STATUS ----------
    if (action === 'getStatus') {
      const { business_id } = body; if (!business_id) return Response.json({ error: 'business_id required' }, { status: 400 });
      const [providers, domainConfigs, mailboxes, automations, templates, logs, channelConfigs] = await Promise.all([
        svc.entities.EmailProviderConfig.filter({ business_id }),
        svc.entities.EmailDomainConfig.filter({ business_id }),
        svc.entities.EmailMailbox.filter({ business_id }),
        svc.entities.EmailAutomationRule.filter({ business_id }),
        svc.entities.EmailTemplate.filter({ business_id }),
        svc.entities.CommunicationLog.filter({ business_id }, '-created_date', 30),
        svc.entities.CommunicationChannelConfig.filter({ business_id }),
      ]);
      const messagesCount = await countMessages(svc, business_id);
      const activeProvider = providers.find((p: any) => p.is_default && p.is_active) || providers.find((p: any) => p.is_active) || null;
      return Response.json({
        providers: { catalog: listProviders(), active: providers },
        domainConfigs, mailboxes,
        automations: automations.sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0)),
        templates: templates.sort((a: any, b: any) => (b.version || 0) - (a.version || 0)),
        channelConfigs,
        activeProvider,
        mailboxHealth: await mailboxHealthSummary(svc, mailboxes),
        recentActivity: logs.slice(0, 30),
        counts: messagesCount,
      });
    }

    // ---------- LIST PROVIDERS ----------
    if (action === 'listProviders') return Response.json({ providers: listProviders() });

    // ---------- ENABLE PROVIDER ----------
    if (action === 'enableProvider') {
      const { business_id, provider_id, is_default } = body; if (!business_id || !provider_id) return Response.json({ error: 'business_id and provider_id required' }, { status: 400 });
      const { business, tenant_id } = await getBusiness(svc, base44, business_id);
      const adapter = getProvider(provider_id);
      await ensureCommsPrompts(svc, tenant_id);
      const existing = await svc.entities.EmailProviderConfig.filter({ business_id, provider_id, channel: 'email' });
      let pc: any;
      const payload = {
        is_active: true, is_default: !!is_default || existing.length === 0,
        capabilities: adapter.capabilities, security: adapter.security, transport: adapter.transport,
        provisioning_state: 'provisioned', default_from_domain: business.domain_name || '', updated: now(),
      };
      if (existing[0]) pc = await svc.entities.EmailProviderConfig.update(existing[0].id, payload as any);
      else pc = await base44.entities.EmailProviderConfig.create({ tenant_id, business_id, channel: 'email', provider_id, name: adapter.name, created_by: actor, provenance: { module: 'communication_hub' }, ...payload } as any);
      if (pc.is_default) {
        const others = await svc.entities.EmailProviderConfig.filter({ business_id });
        for (const o of others) if (o.id !== pc.id && o.is_default) await svc.entities.EmailProviderConfig.update(o.id, { is_default: false } as any);
      }
      // Auto-prepare DNS records if a registered/active domain exists.
      let dnsConfig: any = null;
      const domain = await findDomain(svc, business_id);
      if (domain) {
        dnsConfig = await prepareDnsInternal(svc, base44, business_id, tenant_id, domain, pc, actor);
      }
      await logTelemetry(svc, { tenant_id, business_id, provider_id, kind: 'provision', status: 'success', actor, metadata: { provider_id, auto_dns: !!dnsConfig } });
      return Response.json({ providerConfig: pc, dnsConfig });
    }

    // ---------- PREPARE DOMAIN DNS ----------
    if (action === 'prepareDomainDns') {
      const { business_id, provider_config_id } = body; if (!business_id) return Response.json({ error: 'business_id required' }, { status: 400 });
      const { business, tenant_id } = await getBusiness(svc, base44, business_id);
      const domain = await findDomain(svc, business_id);
      if (!domain) return Response.json({ error: 'No registered domain found for this business. Register or connect a domain via the Domain Engine first.' }, { status: 409 });
      const pc = provider_config_id ? await svc.entities.EmailProviderConfig.get(provider_config_id) : await defaultProviderConfig(svc, business_id);
      if (!pc) return Response.json({ error: 'Enable an email provider before preparing DNS.' }, { status: 409 });
      const dnsConfig = await prepareDnsInternal(svc, base44, business_id, tenant_id, domain, pc, actor);
      return Response.json({ dnsConfig });
    }

    // ---------- RECOMMEND MAILBOXES (AI, preview) ----------
    if (action === 'recommendMailboxes') {
      const { business_id } = body; if (!business_id) return Response.json({ error: 'business_id required' }, { status: 400 });
      const { business, tenant_id } = await getBusiness(svc, base44, business_id);
      await ensureCommsPrompts(svc, tenant_id);
      const res = await orchestrate(base44, { capability: 'EmailGeneration', moduleId: 'email', promptId: 'email.mailbox_recommendation', businessId: business_id, tenantId: tenant_id, actor, stage: 'email.mailbox_recommendation' });
      let recs: any[] = [];
      if (res.ok && Array.isArray(res.data?.mailboxes)) {
        recs = res.data.mailboxes.map((m: any, i: number) => ({
          local_part: String(m.local_part || '').toLowerCase().replace(/[^a-z0-9._-]/g, ''),
          label: m.label || m.local_part, purpose: m.purpose || '', category: m.category || 'general', is_primary: !!m.is_primary || i === 0, ai_recommended: true,
        })).filter((m: any) => m.local_part);
      }
      if (!recs.length) {
        // Deterministic fallback grounded in the business industry.
        const { getBusinessContext } = await import('../../shared/knowledge-graph/index.ts');
        let ctx: any = null; try { ctx = await getBusinessContext(svc, business_id); } catch {}
        const ind = industryFromBlueprint(business, ctx);
        recs = defaultMailboxSet(ind).map((m: any) => ({ local_part: m.local_part, label: m.label, purpose: m.purpose, category: MAILBOX_TO_CATEGORY[m.local_part] || 'general', is_primary: m.local_part === 'info', ai_recommended: true }));
      }
      return Response.json({ mailboxes: dedupe(recs, 'local_part'), rationale: res.data?.rationale || 'Grounded in your approved Business Blueprint.', ai_used: res.ok, fallback: !res.ok });
    }

    // ---------- APPROVE MAILBOXES ----------
    if (action === 'approveMailboxes') {
      const { business_id, mailboxes } = body; if (!business_id || !Array.isArray(mailboxes)) return Response.json({ error: 'business_id and mailboxes[] required' }, { status: 400 });
      const { business, tenant_id } = await getBusiness(svc, base44, business_id);
      await ensureCommsPrompts(svc, tenant_id);
      const pc = await defaultProviderConfig(svc, business_id);
      if (!pc) return Response.json({ error: 'Enable an email provider first.' }, { status: 409 });
      const domain = await findDomain(svc, business_id);
      if (!domain) return Response.json({ error: 'No registered domain — register or connect one before creating mailboxes.' }, { status: 409 });
      const domainConfig = await findDomainConfig(svc, business_id, domain.domain_name);
      const existingMailboxes = await svc.entities.EmailMailbox.filter({ business_id });
      const used = new Set(existingMailboxes.map((m: any) => m.email_address));
      const toCreate = [];
      const adapter = getProvider(pc.provider_id);
      for (const m of mailboxes) {
        const local = String(m.local_part || '').toLowerCase().replace(/[^a-z0-9._-]/g, ''); if (!local) continue;
        const email = `${local}@${domain.domain_name}`;
        if (used.has(email)) continue; used.add(email);
        const prov = adapter.provisionMailbox(local, domain.domain_name, { catch_all: !!m.catch_all });
        toCreate.push({
          tenant_id, business_id, domain_config_id: domainConfig?.id || '', provider_config_id: pc.id,
          local_part: local, email_address: email, label: m.label || local, purpose: m.purpose || '',
          industry: m.industry || 'standard', status: 'active', approval_state: 'approved', ai_recommended: true,
          quota_mb: pc.capabilities?.quota_mb_max || 5120, used_mb: 0, has_catch_all: !!m.catch_all, aliases: [], forwarding: [],
          auto_reply: { enabled: false }, auth: { two_factor_enabled: false, oauth_enabled: false, app_password_enabled: false },
          sync_status: 'idle', messages_count: 0, unread_count: 0, created_by: actor, created_at: now(),
          provenance: { module: 'communication_hub', provider: pc.provider_id, offline: prov.offline, provider_message_id: prov.provider_message_id },
        });
      }
      const created = await base44.entities.EmailMailbox.bulkCreate(toCreate);
      for (const m of created) {
        await audit(svc, { tenant_id, business_id: business_id, mailbox_id: m.id, actor, action: 'mailbox.approved', metadata: { email: m.email_address } });
        dispatch('MailboxCreated', { tenantId: tenant_id, businessId: business_id, actor, payload: { mailbox_id: m.id, email: m.email_address, ai_recommended: true, provider: pc.provider_id } });
      }
      await logTelemetry(svc, { tenant_id, business_id, provider_id: pc.provider_id, kind: 'provision', status: 'success', messages_processed: created.length, actor, metadata: { created: created.length } });
      return Response.json({ mailboxes: created });
    }

    // ---------- CREATE MAILBOX (custom / shared) ----------
    if (action === 'createMailbox') {
      const { business_id, local_part, label, purpose, is_shared, member_user_ids, catch_all, aliases, forwarding, auto_reply, quota_mb, industry } = body;
      if (!business_id || !local_part) return Response.json({ error: 'business_id and local_part required' }, { status: 400 });
      const { business, tenant_id } = await getBusiness(svc, base44, business_id);
      const pc = await defaultProviderConfig(svc, business_id); if (!pc) return Response.json({ error: 'Enable an email provider first.' }, { status: 409 });
      const domain = await findDomain(svc, business_id); if (!domain) return Response.json({ error: 'No registered domain — register or connect one first.' }, { status: 409 });
      const domainConfig = await findDomainConfig(svc, business_id, domain.domain_name);
      const local = String(local_part).toLowerCase().replace(/[^a-z0-9._-]/g, '');
      const email = `${local}@${domain.domain_name}`;
      const adapter = getProvider(pc.provider_id);
      const prov = adapter.provisionMailbox(local, domain.domain_name, { catch_all });
      const m = await base44.entities.EmailMailbox.create({
        tenant_id, business_id, domain_config_id: domainConfig?.id || '', provider_config_id: pc.id,
        local_part: local, email_address: email, label: label || local, purpose: purpose || '', industry: industry || 'standard',
        status: 'active', approval_state: 'custom', ai_recommended: false, is_shared: !!is_shared, member_user_ids: member_user_ids || [],
        quota_mb: quota_mb || (pc.capabilities?.quota_mb_max || 5120), used_mb: 0, has_catch_all: !!catch_all, aliases: aliases || [], forwarding: forwarding || [],
        auto_reply: auto_reply || { enabled: false }, auth: { two_factor_enabled: false, oauth_enabled: false, app_password_enabled: false },
        sync_status: 'idle', messages_count: 0, unread_count: 0, created_by: actor, created_at: now(),
        provenance: { module: 'communication_hub', provider: pc.provider_id, offline: prov.offline, provider_message_id: prov.provider_message_id },
      } as any);
      await audit(svc, { tenant_id, business_id, mailbox_id: m.id, actor, action: 'mailbox.created', metadata: { email, custom: true } });
      dispatch('MailboxCreated', { tenantId: tenant_id, businessId: business_id, actor, payload: { mailbox_id: m.id, email, custom: true, shared: !!is_shared, provider: pc.provider_id } });
      return Response.json({ mailbox: m });
    }

    // ---------- UPDATE MAILBOX (aliases/forwarding/auto-reply/catch-all/quota/members) ----------
    if (action === 'updateMailbox') {
      const { mailbox_id, patch } = body; if (!mailbox_id || !patch) return Response.json({ error: 'mailbox_id and patch required' }, { status: 400 });
      const m: any = await svc.entities.EmailMailbox.get(mailbox_id).catch(() => null);
      try { assertMailboxOwner(user, m); } catch (e: any) { return ownerErr(e); }
      const updated = await svc.entities.EmailMailbox.update(mailbox_id, { ...patch } as any);
      await audit(svc, { tenant_id: m.tenant_id, business_id: m.business_id, mailbox_id, actor, action: 'mailbox.updated', metadata: { fields: Object.keys(patch || {}) } });
      return Response.json({ mailbox: updated });
    }

    if (action === 'suspendMailbox') {
      const { mailbox_id, resume } = body; const m: any = await svc.entities.EmailMailbox.get(mailbox_id).catch(() => null);
      try { assertMailboxOwner(user, m); } catch (e: any) { return ownerErr(e); }
      const updated = await svc.entities.EmailMailbox.update(mailbox_id, { status: resume ? 'active' : 'suspended' } as any);
      await audit(svc, { tenant_id: m.tenant_id, business_id: m.business_id, mailbox_id, actor, action: resume ? 'mailbox.resumed' : 'mailbox.suspended' });
      return Response.json({ mailbox: updated });
    }

    if (action === 'resetMailboxPassword') {
      const { mailbox_id } = body; const m: any = await svc.entities.EmailMailbox.get(mailbox_id).catch(() => null);
      try { assertMailboxOwner(user, m); } catch (e: any) { return ownerErr(e); }
      await svc.entities.EmailMailbox.update(mailbox_id, { auth: { ...(m.auth || {}), app_password_enabled: true } } as any);
      await audit(svc, { tenant_id: m.tenant_id, business_id: m.business_id, mailbox_id, actor, action: 'mailbox.password_reset' });
      await logTelemetry(svc, { tenant_id: m.tenant_id, business_id: m.business_id, mailbox_id, kind: 'security', status: 'success', actor, metadata: { action: 'password_reset' } });
      return Response.json({ ok: true, note: 'Provisioning request recorded (offline mode — no live provider password set).' });
    }

    if (action === 'deleteMailbox') {
      const { mailbox_id } = body; const m: any = await svc.entities.EmailMailbox.get(mailbox_id).catch(() => null);
      try { assertMailboxOwner(user, m); } catch (e: any) { return ownerErr(e); }
      const updated = await svc.entities.EmailMailbox.update(mailbox_id, { status: 'deleted' } as any);
      await audit(svc, { tenant_id: m.tenant_id, business_id: m.business_id, mailbox_id, actor, action: 'mailbox.deleted' });
      dispatch('MailboxDeleted', { tenantId: m.tenant_id, businessId: m.business_id, actor, payload: { mailbox_id, email: m.email_address } });
      return Response.json({ mailbox: updated });
    }

    // ---------- SYNC MAILBOX ----------
    if (action === 'syncMailbox') {
      const { mailbox_id } = body; if (!mailbox_id) return Response.json({ error: 'mailbox_id required' }, { status: 400 });
      const m: any = await svc.entities.EmailMailbox.get(mailbox_id).catch(() => null);
      try { assertMailboxOwner(user, m); } catch (e: any) { return ownerErr(e); }
      if (m.status !== 'active') return Response.json({ error: `Mailbox is ${m.status}; cannot sync.` }, { status: 409 });
      const pc: any = await svc.entities.EmailProviderConfig.get(m.provider_config_id);
      const adapter = getProvider(pc?.provider_id || 'generic_imap_smtp');
      const t0 = Date.now();
      await svc.entities.EmailMailbox.update(mailbox_id, { sync_status: 'syncing' } as any);
      const stubs = adapter.listMessages({ mailbox: m.email_address, since: m.last_synced_at, max: 8 });
      let created = 0; const messages: any[] = [];
      for (const stub of stubs) {
        const exists = await svc.entities.EmailMessage.filter({ business_id: m.business_id, provider_message_id: stub.provider_message_id });
        if (exists?.length) continue;
        const thread = await upsertThread(svc, m, stub.subject, stub.from_addr);
        const msg = await base44.entities.EmailMessage.create({
          tenant_id: m.tenant_id, business_id: m.business_id, mailbox_id, thread_id: thread.id,
          message_id: stub.provider_message_id, in_reply_to: '',
          from_addr: stub.from_addr, to_addr: stub.to_addr, cc: [], bcc: [], subject: stub.subject, body_text: stub.body_text, body_html: '',
          folder: 'inbox', is_unread: true, is_starred: false, needs_reply: false, ai_category: 'unknown', ai_urgency: stub.importance || 'normal',
          labels: [MAILBOX_TO_CATEGORY[m.local_part] || 'general'], tags: [], has_attachments: false, attachments: [], importance: stub.importance || 'normal',
          received_at: stub.received_at, provider_message_id: stub.provider_message_id, sync_id: mailbox_id, token_count: 0,
        } as any);
        messages.push(msg); created++;
        dispatch('EmailReceived', { tenantId: m.tenant_id, businessId: m.business_id, actor, payload: { message_id: msg.id, mailbox_id, thread_id: thread.id, from: stub.from_addr, subject: stub.subject } });
      }
      const dur = Date.now() - t0;
      const updated = await svc.entities.EmailMailbox.update(mailbox_id, { last_synced_at: now(), sync_status: 'ok', sync_error: '', messages_count: (m.messages_count || 0) + created, unread_count: (m.unread_count || 0) + created } as any);
      // Apply routing automations to newly received messages.
      for (const msg of messages) { try { await applyAutomations(svc, msg, m.business_id, m.tenant_id, actor); if (msg.labels?.length || msg.ai_category !== 'unknown' || msg.assigned_user_id) await svc.entities.EmailMessage.update(msg.id, { labels: msg.labels, ai_category: msg.ai_category, assigned_user_id: msg.assigned_user_id } as any); } catch {} }
      dispatch('MailboxSynced', { tenantId: m.tenant_id, businessId: m.business_id, actor, payload: { mailbox_id, messages: created, duration_ms: dur } });
      await logTelemetry(svc, { tenant_id: m.tenant_id, business_id: m.business_id, provider_id: pc?.provider_id, mailbox_id, kind: 'sync', status: 'success', sync_duration_ms: dur, messages_processed: created, actor, metadata: { provider: pc?.provider_id } });
      return Response.json({ mailbox: updated, messages: messages, received: created, duration_ms: dur });
    }

    // ---------- SEND MESSAGE ----------
    if (action === 'sendMessage') {
      const { business_id, mailbox_id, to_addr, cc, subject, body: text, attachments, draft, scheduled_at } = body;
      if (!business_id || !mailbox_id || !Array.isArray(to_addr) || !subject) return Response.json({ error: 'business_id, mailbox_id, to_addr[], subject required' }, { status: 400 });
      const m: any = await svc.entities.EmailMailbox.get(mailbox_id).catch(() => null);
      try { assertMailboxOwner(user, m); } catch (e: any) { return ownerErr(e); }
      if (m.business_id !== business_id) return Response.json({ error: 'Mailbox does not belong to this business' }, { status: 403 });
      const pc: any = await svc.entities.EmailProviderConfig.get(m.provider_config_id);
      const adapter = getProvider(pc?.provider_id || 'generic_imap_smtp');
      const t0 = Date.now();
      let msg: any;
      const thread = await upsertThread(svc, m, subject, m.email_address, true);
      if (draft) {
        msg = await base44.entities.EmailMessage.create({
          tenant_id: m.tenant_id, business_id, mailbox_id, thread_id: thread.id, message_id: '', in_reply_to: '',
          from_addr: m.email_address, to_addr, cc: cc || [], bcc: [], subject, body_text: text || '', body_html: '', folder: 'drafts',
          is_unread: false, is_starred: false, needs_reply: false, labels: ['drafts'], tags: [], has_attachments: !!(attachments?.length), attachments: attachments || [], importance: 'normal',
          draft_at: now(), provider_message_id: '', sync_id: mailbox_id,
        } as any);
        return Response.json({ message: msg, draft: true });
      }
      const sendRes = adapter.send({ from_addr: m.email_address, to_addr, subject, body_text: text || '' });
      msg = await base44.entities.EmailMessage.create({
        tenant_id: m.tenant_id, business_id, mailbox_id, thread_id: thread.id, message_id: sendRes.provider_message_id, in_reply_to: '',
        from_addr: m.email_address, to_addr, cc: cc || [], bcc: [], subject, body_text: text || '', body_html: '', folder: scheduled_at ? 'scheduled' : 'sent',
        is_unread: false, is_starred: false, needs_reply: false, labels: [scheduled_at ? 'scheduled' : 'sent'], tags: [], has_attachments: !!(attachments?.length), attachments: attachments || [], importance: 'normal',
        sent_at: scheduled_at ? undefined : now(), scheduled_at: scheduled_at || undefined, provider_message_id: sendRes.provider_message_id, sync_id: mailbox_id,
        provenance: undefined as any,
      } as any);
      await svc.entities.EmailThread.update(thread.id, { message_count: (thread.message_count || 0) + 1, last_message_at: now(), status: 'open', participants: [...new Set([...(thread.participants || []), m.email_address, ...to_addr])] } as any).catch(() => {});
      dispatch('EmailSent', { tenantId: m.tenant_id, businessId: business_id, actor, payload: { message_id: msg.id, mailbox_id, thread_id: thread.id, to: to_addr, subject, offline: sendRes.offline } });
      await logTelemetry(svc, { tenant_id: m.tenant_id, business_id, provider_id: pc?.provider_id, mailbox_id, kind: 'send', status: 'success', latency_ms: Date.now() - t0, actor, metadata: { provider: pc?.provider_id, offline: sendRes.offline } });
      return Response.json({ message: msg, sent: true, offline: sendRes.offline, note: sendRes.note });
    }

    // ---------- AI ACTION ----------
    if (action === 'aiAction') {
      const { message_id, ai_action: aiAction, tone, target_language } = body; if (!message_id || !aiAction) return Response.json({ error: 'message_id and action required' }, { status: 400 });
      const m: any = await svc.entities.EmailMessage.get(message_id);
      await ensureCommsPrompts(svc, m.tenant_id);
      const promptIdMap: Record<string, string> = {
        summarize: 'email.summarize', draft_reply: 'email.draft_reply', rewrite: 'email.rewrite', translate: 'email.translate',
        categorize: 'email.categorize', extract_action_items: 'email.extract_action_items', extract_lead: 'email.extract_lead', suggest_next_action: 'email.suggest_next_action',
      };
      const promptId = promptIdMap[aiAction];
      if (!promptId) return Response.json({ error: `Unknown AI action: ${aiAction}` }, { status: 400 });
      const treadId = m.thread_id || '';
      const thread: any = treadId ? await svc.entities.EmailThread.get(treadId).catch(() => null) : null;
      const res = await orchestrate(base44, {
        capability: 'EmailAIAssist', moduleId: 'email', promptId, businessId: m.business_id, tenantId: m.tenant_id, actor,
        variables: { from_addr: m.from_addr || '', subject: m.subject || '', body: (m.body_text || '').slice(0, 8000), draft: body.draft || m.body_text || '', tone: tone || 'professional concise', target_language: target_language || 'English', status: thread?.status || 'open', ai_category: m.ai_category || '', snippet: (m.body_text || '').slice(0, 400) },
        stage: `email.${aiAction}`,
      });
      if (!res.ok) return Response.json({ error: res.error || 'AI action failed', fallback: true }, { status: 502 });
      const data = res.data || {};
      // Persist the relevant AI output on the message + dispatch events.
      const patch: any = {};
      if (aiAction === 'summarize') { patch.ai_summary = data.summary || ''; patch.ai_urgency = data.urgency || m.ai_urgency; patch.needs_reply = !!data.needs_reply; if (data.suggested_category) patch.ai_category = data.suggested_category; dispatch('EmailSummarized', { tenantId: m.tenant_id, businessId: m.business_id, actor, payload: { message_id, summary: patch.ai_summary } }); }
      if (aiAction === 'categorize') { patch.ai_category = data.ai_category || m.ai_category; patch.ai_urgency = data.ai_urgency || m.ai_urgency; dispatch('EmailCategorized', { tenantId: m.tenant_id, businessId: m.business_id, actor, payload: { message_id, category: patch.ai_category, urgency: patch.ai_urgency, confidence: data.confidence } }); }
      if (aiAction === 'extract_action_items') { patch.ai_action_items = Array.isArray(data.action_items) ? data.action_items.map((a: any) => a.task || JSON.stringify(a)) : []; }
      if (aiAction === 'suggest_next_action') { patch.ai_suggested_action = data.next_action || ''; }
      const updated = Object.keys(patch).length ? await svc.entities.EmailMessage.update(message_id, patch as any) : m;
      // CRM integration: extract_lead + create Ticket.
      let crmResult: any = null;
      if (aiAction === 'extract_lead' && data.is_lead) {
        try {
          const lead: any = await base44.entities.Lead.create({ tenant_id: m.tenant_id, business_id: m.business_id, name: data.name || m.from_addr || 'Email Lead', email: data.email || m.from_addr || '', phone: data.phone || '', service: data.service_interest || '', message: m.body_text?.slice(0, 600) || '', source: 'email', status: 'new', notes: data.notes || (thread ? `Thread: ${thread.subject}` : '') } as any);
          let contact: any = null;
          if (data.email || m.from_addr) contact = await base44.entities.Contact.create({ tenant_id: m.tenant_id, business_id: m.business_id, lead_id: lead.id, name: lead.name, email: lead.email, phone: lead.phone, company: data.company || '', tags: ['from-email'] } as any).catch(() => null);
          await svc.entities.EmailMessage.update(message_id, { crm_lead_id: lead.id, crm_contact_id: contact?.id || '' } as any);
          await svc.entities.EmailThread.update(thread.id, { crm_link: lead.id } as any).catch(() => {});
          dispatch('LeadCreatedFromEmail', { tenantId: m.tenant_id, businessId: m.business_id, actor, payload: { message_id, lead_id: lead.id, contact_id: contact?.id || null, name: lead.name } });
          try { await markStale(svc, m.business_id, 'lead_created_from_email'); } catch {}
          crmResult = { lead_id: lead.id, contact_id: contact?.id || null };
        } catch (e: any) { crmResult = { lead_creation_failed: e?.message || String(e) }; }
      }
      await logTelemetry(svc, { tenant_id: m.tenant_id, business_id: m.business_id, mailbox_id: m.mailbox_id, kind: 'ai', status: 'success', latency_ms: res.latencyMs, tokens: 0, ai_cost: res.estimatedCost || 0, actor, metadata: { ai_action: aiAction, prompt_id: promptId, provider: res.provider, model: res.model } });
      return Response.json({ result: data, message: updated, crm: crmResult, ai: { provider: res.provider, model: res.model, latency_ms: res.latencyMs, cost: res.estimatedCost, execution_id: res.executionId } });
    }

    // ---------- CREATE TICKET FROM EMAIL ----------
    if (action === 'createTicketFromEmail') {
      const { message_id } = body; if (!message_id) return Response.json({ error: 'message_id required' }, { status: 400 });
      const m: any = await svc.entities.EmailMessage.get(message_id);
      const ticketNo = `TKT-${Date.now().toString(36).toUpperCase()}`;
      const ticket: any = await base44.entities.Ticket.create({ tenant_id: m.tenant_id, business_id: m.business_id, ticket_number: ticketNo, customer_name: m.from_addr || 'Unknown', customer_email: m.from_addr || '', subject: m.subject || 'Email escalated to ticket', description: (m.body_text || '').slice(0, 2000), category: m.ai_category || 'general', priority: m.ai_urgency || 'normal', status: 'open', conversation_id: m.thread_id || '' } as any);
      await svc.entities.EmailMessage.update(message_id, { ticket_id: ticket.id, tags: [...(m.tags || []), 'ticket'] } as any);
      if (m.thread_id) await svc.entities.EmailThread.update(m.thread_id, { ticket_link: ticket.id, status: 'pending' } as any).catch(() => {});
      dispatch('TicketCreatedFromEmail', { tenantId: m.tenant_id, businessId: m.business_id, actor, payload: { message_id, ticket_id: ticket.id, subject: ticket.subject } });
      try { await markStale(svc, m.business_id, 'ticket_created_from_email'); } catch {}
      await audit(svc, { tenant_id: m.tenant_id, business_id: m.business_id, mailbox_id: m.mailbox_id, actor, action: 'ticket.created_from_email', metadata: { ticket_id: ticket.id } });
      return Response.json({ ticket });
    }

    // ---------- ASSIGN MESSAGE ----------
    if (action === 'assignMessage') {
      const { message_id, user_id } = body; if (!message_id) return Response.json({ error: 'message_id required' }, { status: 400 });
      const m: any = await svc.entities.EmailMessage.get(message_id);
      const updated = await svc.entities.EmailMessage.update(message_id, { assigned_user_id: user_id || '' } as any);
      if (m.thread_id) await svc.entities.EmailThread.update(m.thread_id, { assigned_user_id: user_id || '' } as any).catch(() => {});
      dispatch('EmailAssigned', { tenantId: m.tenant_id, businessId: m.business_id, actor, payload: { message_id, user_id } });
      return Response.json({ message: updated });
    }

    if (action === 'markMessage') {
      const { message_id, patch } = body; if (!message_id) return Response.json({ error: 'message_id required' }, { status: 400 });
      const m: any = await svc.entities.EmailMessage.get(message_id);
      const updated = await svc.entities.EmailMessage.update(message_id, patch as any);
      if (patch?.needs_reply && m.thread_id) await svc.entities.EmailThread.update(m.thread_id, { status: 'awaiting_customer' } as any).catch(() => {});
      dispatch('EmailReplied', { tenantId: m.tenant_id, businessId: m.business_id, actor, payload: { message_id, status: 'updated' } });
      return Response.json({ message: updated });
    }

    // ---------- INBOX / THREADS ----------
    if (action === 'listMessages') {
      const { business_id, folder, mailbox_id, view, limit } = body; if (!business_id) return Response.json({ error: 'business_id required' }, { status: 400 });
      let rows = await svc.entities.EmailMessage.filter({ business_id }, '-received_at', limit || 100);
      if (mailbox_id) rows = rows.filter((m: any) => m.mailbox_id === mailbox_id);
      if (folder && folder !== 'all') rows = rows.filter((m: any) => m.folder === folder);
      if (view === 'unread') rows = rows.filter((m: any) => m.is_unread);
      if (view === 'starred') rows = rows.filter((m: any) => m.is_starred);
      if (view === 'needs_reply') rows = rows.filter((m: any) => m.needs_reply);
      if (view === 'ai_suggested') rows = rows.filter((m: any) => !!m.ai_suggested_action);
      return Response.json({ messages: rows });
    }

    if (action === 'getThread') {
      const { thread_id } = body; if (!thread_id) return Response.json({ error: 'thread_id required' }, { status: 400 });
      const thread = await svc.entities.EmailThread.get(thread_id);
      const messages = (await svc.entities.EmailMessage.filter({ thread_id })).sort((a: any, b: any) => String(a.received_at || a.sent_at || a.created_date || '').localeCompare(String(b.received_at || b.sent_at || b.created_date || '')));
      return Response.json({ thread, messages });
    }

    if (action === 'listThreads') {
      const { business_id, mailbox_id, status } = body; if (!business_id) return Response.json({ error: 'business_id required' }, { status: 400 });
      let rows = await svc.entities.EmailThread.filter({ business_id }, '-updated_date', 100);
      if (mailbox_id) rows = rows.filter((t: any) => t.mailbox_id === mailbox_id);
      if (status) rows = rows.filter((t: any) => t.status === status);
      return Response.json({ threads: rows });
    }

    // ---------- SEARCH (unified) ----------
    if (action === 'search') {
      const { business_id, query } = body; if (!business_id || !query) return Response.json({ error: 'business_id and query required' }, { status: 400 });
      const q = String(query).toLowerCase();
      const [msgs, threads, leads, contacts] = await Promise.all([
        svc.entities.EmailMessage.filter({ business_id }, '-received_at', 100),
        svc.entities.EmailThread.filter({ business_id }, '-updated_date', 100),
        svc.entities.Lead.filter({ business_id }).catch(() => []),
        svc.entities.Contact.filter({ business_id }).catch(() => []),
      ]);
      const match = (s: any) => s && String(s).toLowerCase().includes(q);
      return Response.json({
        query,
        results: {
          messages: msgs.filter((m: any) => match(m.subject) || match(m.body_text) || match(m.from_addr)).slice(0, 20).map((m: any) => ({ id: m.id, type: 'message', mailbox_id: m.mailbox_id, from: m.from_addr, subject: m.subject, snippet: (m.body_text || '').slice(0, 120) })),
          threads: threads.filter((t: any) => match(t.subject) || match(t.snippet)).slice(0, 20).map((t: any) => ({ id: t.id, type: 'thread', subject: t.subject, snippet: t.snippet, status: t.status })),
          leads: leads.filter((l: any) => match(l.name) || match(l.email) || match(l.service)).slice(0, 10).map((l: any) => ({ id: l.id, type: 'lead', name: l.name, email: l.email, service: l.service })),
          contacts: contacts.filter((c: any) => match(c.name) || match(c.email) || match(c.company)).slice(0, 10).map((c: any) => ({ id: c.id, type: 'contact', name: c.name, email: c.email, company: c.company })),
        },
      });
    }

    // ---------- TEMPLATES CRUD ----------
    if (action === 'saveTemplate') {
      const { business_id, key, name, subject, body: text, category, owner_role } = body; if (!business_id || !key || !name || !subject) return Response.json({ error: 'business_id, key, name, subject required' }, { status: 400 });
      const { business, tenant_id } = await getBusiness(svc, base44, business_id);
      const latest = (await svc.entities.EmailTemplate.filter({ business_id, key })).sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0];
      const version = (latest?.version || 0) + 1;
      if (latest) try { await svc.entities.EmailTemplate.update(latest.id, { status: 'superseded' } as any); } catch {}
      const tpl = await base44.entities.EmailTemplate.create({ tenant_id, business_id, key, name, subject, body: text || '', category: category || 'general', channel: 'email', version, status: 'published', owner_role: owner_role || '', is_system: false, created_by: actor, provenance: { module: 'communication_hub' } } as any);
      return Response.json({ template: tpl });
    }
    if (action === 'listTemplates') { const { business_id } = body; const rows = await svc.entities.EmailTemplate.filter({ business_id }); const latest = new Map<string, any>(); for (const t of rows.sort((a: any, b: any) => (b.version || 0) - (a.version || 0))) if (!latest.has(t.key) && t.status !== 'superseded') latest.set(t.key, t); return Response.json({ templates: [...latest.values()] }); }
    if (action === 'deleteTemplate') { const { template_id } = body; await svc.entities.EmailTemplate.update(template_id, { status: 'superseded' } as any); return Response.json({ ok: true }); }

    // ---------- AUTOMATIONS CRUD ----------
    if (action === 'saveAutomation') {
      const { business_id, name, trigger, conditions, actions, action_target_module, mailbox_scope, priority } = body;
      if (!business_id || !name || !trigger || !Array.isArray(actions)) return Response.json({ error: 'business_id, name, trigger, actions[] required' }, { status: 400 });
      const { business, tenant_id } = await getBusiness(svc, base44, business_id);
      const rule = await base44.entities.EmailAutomationRule.create({ tenant_id, business_id, name, trigger, conditions: conditions || [], actions, action_target_module: action_target_module || 'none', mailbox_scope: mailbox_scope || [], enabled: true, priority: priority || 50, provenance: { module: 'communication_hub' } } as any);
      return Response.json({ automation: rule });
    }
    if (action === 'listAutomations') { const { business_id } = body; const rows = await svc.entities.EmailAutomationRule.filter({ business_id }); return Response.json({ automations: rows.sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0)) }); }
    if (action === 'updateAutomation') { const { automation_id, patch } = body; const r = await svc.entities.EmailAutomationRule.update(automation_id, patch as any); return Response.json({ automation: r }); }
    if (action === 'deleteAutomation') { const { automation_id } = body; await svc.entities.EmailAutomationRule.delete(automation_id); return Response.json({ ok: true }); }

    // ---------- TELEMETRY ----------
    if (action === 'telemetry') {
      const { business_id } = body; if (!business_id) return Response.json({ error: 'business_id required' }, { status: 400 });
      const logs = await svc.entities.CommunicationLog.filter({ business_id }, '-created_date', 500);
      const byKind: Record<string, number> = {}; const byStatus: Record<string, number> = {}; let totalLatency = 0, totalMessages = 0, totalTokens = 0, totalCost = 0, errors = 0;
      for (const l of logs) { byKind[l.kind] = (byKind[l.kind] || 0) + 1; byStatus[l.status] = (byStatus[l.status] || 0) + 1; totalLatency += l.latency_ms || 0; totalMessages += l.messages_processed || 0; totalTokens += l.tokens || 0; totalCost += l.ai_cost || 0; if (l.status === 'failure') errors++; }
      const mailboxHealth = await mailboxHealthSummary(svc, await svc.entities.EmailMailbox.filter({ business_id }));
      return Response.json({ totals: { events: logs.length, by_kind: byKind, by_status: byStatus, latency_ms: totalLatency, messages_processed: totalMessages, tokens: totalTokens, ai_cost: +totalCost.toFixed(4), errors }, mailboxHealth, recent: logs.slice(0, 25) });
    }

    // ---------- WHITE LABEL (channel subdomain) ----------
    if (action === 'setChannelConfig') {
      const { business_id, channel, provider_id, name, config, white_label_subdomain } = body; if (!business_id || !channel) return Response.json({ error: 'business_id and channel required' }, { status: 400 });
      const { business, tenant_id } = await getBusiness(svc, base44, business_id);
      const existing = await svc.entities.CommunicationChannelConfig.filter({ business_id, channel });
      const payload = { provider_id: provider_id || '', name: name || channel, config: config || {}, capabilities: { inbound: true, outbound: true, templated: true, rich_media: false, ai_assist: true, scheduling: false }, is_active: true, provisioning_state: 'provisioned', white_label_subdomain: white_label_subdomain || (channel === 'email' ? 'mail' : channel) };
      const row = existing[0] ? await svc.entities.CommunicationChannelConfig.update(existing[0].id, payload as any) : await base44.entities.CommunicationChannelConfig.create({ tenant_id, business_id, channel, ...payload, created_by: actor, provenance: { module: 'communication_hub' } } as any);
      return Response.json({ channelConfig: row });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as any)?.message || String(error) }, { status: 500 });
  }
}

// ---------- helpers ----------
async function prepareDnsInternal(svc: any, base44: any, businessId: string, tenantId: string, domain: any, pc: any, actor: string) {
  const records = buildDnsRecords(pc.provider_id, domain.domain_name, '');
  const health = validateDns(records);
  const status = health.score >= 90 ? 'healthy' : health.score >= 50 ? 'configured' : 'partial';
  const existing = await findDomainConfig(svc, businessId, domain.domain_name);
  const payload = { domain_id: domain.id, domain_name: domain.domain_name, provider_config_id: pc.id, records, status, health, provisioning_state: 'configured', updated: now(), provenance: { module: 'communication_hub', provider: pc.provider_id, prepared_by: actor } };
  const dns = existing ? await svc.entities.EmailDomainConfig.update(existing.id, payload as any) : await base44.entities.EmailDomainConfig.create({ tenant_id: tenantId, business_id: businessId, created_by: actor, ...payload } as any);
  await logTelemetry(svc, { tenant_id: tenantId, business_id: businessId, provider_id: pc.provider_id, kind: 'dns', status: 'success', actor, metadata: { domain: domain.domain_name, score: health.score } });
  return dns;
}

async function upsertThread(svc: any, mailbox: any, subject: string, counterpart: string, outgoing = false): Promise<any> {
  const rows = await svc.entities.EmailThread.filter({ mailbox_id: mailbox.id, subject: subject || '' });
  if (rows.length) return rows[0];
  return await svc.entities.EmailThread.create({
    tenant_id: mailbox.tenant_id, business_id: mailbox.business_id, mailbox_id: mailbox.id, subject: subject || '(no subject)',
    snippet: counterpart, participants: [counterpart], participant_count: 1, message_count: 0, last_message_at: now(),
    status: 'open', labels: [], tags: [], internal_notes_count: 0, created_at: now(), updated_at: now(),
  } as any);
}

async function countMessages(svc: any, businessId: string) {
  const rows = await svc.entities.EmailMessage.filter({ business_id: businessId }, '-created_date', 500);
  return { total: rows.length, unread: rows.filter((m: any) => m.is_unread).length, needs_reply: rows.filter((m: any) => m.needs_reply).length, ai_summarized: rows.filter((m: any) => !!m.ai_summary).length };
}

async function mailboxHealthSummary(svc: any, mailboxes: any[]) {
  const active = mailboxes.filter((m: any) => m.status === 'active').length;
  const suspended = mailboxes.filter((m: any) => m.status === 'suspended').length;
  const syncing = mailboxes.filter((m: any) => m.sync_status === 'ok').length;
  const errors = mailboxes.filter((m: any) => m.sync_status === 'error').length;
  const shared = mailboxes.filter((m: any) => m.is_shared).length;
  const totalUsed = mailboxes.reduce((s: number, m: any) => s + (m.used_mb || 0), 0);
  const totalQuota = mailboxes.reduce((s: number, m: any) => s + (m.quota_mb || 0), 0);
  return { mailboxes: mailboxes.length, active, suspended, synced_ok: syncing, sync_errors: errors, shared, storage_used_mb: totalUsed, storage_quota_mb: totalQuota, storage_pct: totalQuota ? Math.round((totalUsed / totalQuota) * 100) : 0, health_score: mailboxes.length ? Math.round(((active + syncing) / (mailboxes.length * 2)) * 100) : 0 };
}