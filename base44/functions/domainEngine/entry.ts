import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { resolveActiveProviderChain } from '../../shared/providers/resolver.ts';
import { getProviderAdapter } from '../../shared/providers/registry.ts';
import { recordUsage } from '../../shared/logging.ts';

const secGet = (n: string): string | undefined => { try { return secrets.get(n); } catch { return undefined; } };

function runtimeFor(svc: any) {
  return {
    invokeLLM: async (prompt: string, opts?: Record<string, unknown>) => { const r = await svc.integrations.Core.InvokeLLM({ prompt, ...(opts || {}) }); return r || ''; },
    fetchExternal: async (url: string, init?: RequestInit) => await fetch(url, init),
  };
}

// ---- Estimated wholesale pricing + scoring (deterministic, no LLM) ----
const TLD_PRICE: Record<string, number> = { com: 12, net: 12, org: 12, io: 35, co: 25, ai: 70, me: 20, online: 3, app: 14, store: 8, shop: 9, xyz: 2, dev: 12, fit: 8, club: 12, live: 24, world: 34, site: 34, blog: 30, health: 60, pro: 16, digital: 35, tech: 48 };
const TLD_WEIGHT: Record<string, number> = { com: 1.0, io: 0.55, co: 0.5, ai: 0.45, me: 0.4, net: 0.5, org: 0.5, app: 0.5, dev: 0.5, fit: 0.6, online: 0.3, xyz: 0.2, store: 0.45, shop: 0.45, pro: 0.5, digital: 0.35, tech: 0.35, world: 0.25, site: 0.25, blog: 0.45, health: 0.45 };
const INDUSTRY_TLDS: Record<string, string[]> = { fitness: ['fit', 'live', 'health'], technology: ['io', 'app', 'dev', 'tech'], health: ['health', 'care'], retail: ['store', 'shop', 'online'] };

function splitTld(full: string) { const i = full.indexOf('.'); if (i < 0) return { sld: full, tld: '' }; return { sld: full.slice(0, i), tld: full.slice(i + 1).toLowerCase() }; }
function clamp(x: number, a: number, b: number) { return Math.max(a, Math.min(b, x)); }

function scoreDomain(full: string, available: boolean | null, price: number | null, profile: any) {
  const { sld, tld } = splitTld(full);
  const len = sld.length;
  if (available === false) return { sld, tld, available: false as const, price: price ?? (TLD_PRICE[tld] ?? 15), is_estimated: price === null, scores: { overall: 0, seo: 0, brandability: 0, length: 0, memorability: 0, extension: 0, price: 0 }, reasons: [], stars: 0 };
  const kw = (profile?.keywords || []).map((k: string) => (k || '').toLowerCase());
  const kwHit = kw.some((k: string) => k && sld.toLowerCase().includes(k));
  const hasHyphen = /-/.test(sld), hasDigit = /\d/.test(sld);
  const vowels = (sld.match(/[aeiou]/gi) || []).length;
  const pronounce = vowels >= 2 && !hasHyphen;
  const lengthScore = clamp(10 - Math.abs(len - 8) * 1.1, 0, 10);
  const memScore = clamp((hasHyphen ? -3 : 0) + (hasDigit ? -2 : 0) + (pronounce ? 4 : 0) + Math.min(4, vowels), 0, 10);
  const seoScore = clamp((kwHit ? 6 : 0) + (tld === 'com' ? 2 : 0) + (len <= 12 ? 2 : 0), 0, 10);
  const brandScore = clamp((!hasHyphen && !hasDigit ? 3 : 0) + (len <= 8 ? 3 : 1) + (kwHit ? 2 : 0), 0, 10);
  const extScore = (TLD_WEIGHT[tld] ?? 0.3) * 10;
  const pr = price ?? (TLD_PRICE[tld] ?? 15);
  const priceScore = clamp(10 - pr / 7, 0, 10);
  const overall = available === true
    ? +(lengthScore * 0.18 + memScore * 0.22 + seoScore * 0.2 + brandScore * 0.2 + extScore * 0.1 + priceScore * 0.1).toFixed(1)
    : 3;
  const reasons: string[] = [];
  if (len <= 8) reasons.push('Short & easy to type');
  if (pronounce && !hasHyphen) reasons.push('Easy to remember');
  if (kwHit) reasons.push('Strong SEO keyword match');
  if (tld === 'com') reasons.push('Trusted .com extension');
  else if (['fit', 'io', 'co', 'app', 'ai', 'health', 'store', 'shop', 'dev'].includes(tld)) reasons.push(`${tld} fits your industry`);
  if (pr < 10) reasons.push('Great wholesale price');
  return { sld, tld, available, price: pr, is_estimated: price === null, scores: { overall, seo: +seoScore.toFixed(1), brandability: +brandScore.toFixed(1), length: +lengthScore.toFixed(1), memorability: +memScore.toFixed(1), extension: +extScore.toFixed(1), price: +priceScore.toFixed(1) }, reasons, stars: +Math.round((overall / 2) * 2) / 2 };
}

// Real public registry availability via RDAP (no provider credentials needed).
async function rdapAvailable(full: string, runtime: any): Promise<boolean | null> {
  try {
    const r = await runtime.fetchExternal(`https://rdap.org/domain/${encodeURIComponent(full)}`, { headers: { 'Accept': 'application/rdap+json' } });
    if (r.status === 404) return true;
    if (r.status >= 200 && r.status < 300) return false;
    return null;
  } catch { return null; }
}

async function batch<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  return out;
}

async function buildCtx(base44: any, svc: any, provider: any) {
  const adapter: any = getProviderAdapter(provider.adapter_key);
  const creds = await svc.entities.ProviderCredential.filter({ provider_id: provider.id });
  const credentials: Record<string, string | undefined> = {};
  for (const c of creds) for (const n of [c.api_key_secret_name, c.api_secret_secret_name]) if (n) { try { credentials[n] = secGet(n); } catch { credentials[n] = undefined; } }
  return { adapter, ctx: { providerId: provider.id, providerKey: provider.key, category: provider.category, environment: provider.environment, adapterConfig: provider.adapter_config || {}, credentials, requestId: crypto.randomUUID() } };
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    industry: { type: 'string' }, tagline: { type: 'string' }, tone: { type: 'string' },
    target_audience: { type: 'string' }, services: { type: 'array', items: { type: 'string' } },
    keywords: { type: 'array', items: { type: 'string' } }, locations: { type: 'array', items: { type: 'string' } },
    name_direction: { type: 'string' }, page_plan: { type: 'array', items: { type: 'string' } },
  },
  required: ['industry', 'tone', 'target_audience', 'keywords', 'name_direction'],
};
const NAMES_SCHEMA = { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] };

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const rt = runtimeFor(svc);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const tenantId = (user.data && user.data.tenant_id) || undefined;

    if (action === 'plan') {
      const seed = (body.seed || '').toString().trim();
      const brief = body.brief || '';
      if (!seed) return Response.json({ error: 'seed (business name) is required' }, { status: 400 });
      const prompt = `You are an expert business strategist. Create a concise launch blueprint for a business named "${seed}". ${brief ? `Context: ${brief}` : ''} Return JSON: industry, tagline, tone (e.g. friendly, premium, bold), target_audience (one sentence), services (3-6), keywords (5-10 SEO + brand keywords typed lowercase no spaces), locations (array, may be empty), name_direction (guidance for naming the brand/domain), page_plan (suggested website pages 4-6). Keep it tight and specific to this business.`;
      const profile = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: PLAN_SCHEMA });
      return Response.json({ profile });
    }

    if (action === 'search') {
      const profile = body.profile || {};
      const base = (body.base || body.seed || '').toString().trim();
      if (!base && !(profile && profile.name_direction)) return Response.json({ error: 'profile or base name is required' }, { status: 400 });
      const namePrompt = `You are a premium domain naming expert. Based on this business blueprint, generate 30 brandable, available-in-spirit domain name candidates across .com, .fit, .io, .co, .app, .ai, .me, .online, .store and the most fitting extension for the industry. Avoid trademarks, hyphens and numbers unless intentional. ${profile.name_direction ? `Naming direction: ${profile.name_direction}` : `Base idea: ${base}`}. ${profile.keywords ? `Keywords to consider: ${(profile.keywords || []).join(', ')}` : ''}. Return JSON { "names": [...] } with exactly the full domain names (e.g. "momentum.fit"), no extra text.`;
      const genRes: any = await svc.integrations.Core.InvokeLLM({ prompt: namePrompt, response_json_schema: NAMES_SCHEMA });
      let names: string[] = (genRes && genRes.names) || [];
      names = Array.from(new Set(names.map((n: string) => n.trim().toLowerCase()).filter((n: string) => /\./.test(n)))).slice(0, 30);
      if (!names.length) return Response.json({ error: 'The name generator returned no candidates. Try again.' }, { status: 502 });

      // Real availability: use the configured domain registrar if present, else RDAP + estimated pricing.
      const resolved = await resolveActiveProviderChain(base44, 'domain', tenantId);
      let availability: any[] = [];
      let usedProvider = false;
      if (resolved.provider) {
        const creds = await svc.entities.ProviderCredential.filter({ provider_id: resolved.provider.id });
        const configured = creds.some((c: any) => Boolean(c.api_key_secret_name));
        if (configured) {
          try {
            const { adapter, ctx } = await buildCtx(base44, svc, resolved.provider);
            if (typeof adapter.checkAvailability === 'function') {
              const res: any = await adapter.checkAvailability(ctx, rt, names);
              if (res.success) { availability = res.data; usedProvider = true; }
            }
          } catch { /* fall through to RDAP */ }
        }
      }
      if (!usedProvider) {
        const avs = await batch(names, 8, async (n: string) => ({ name: n, available: await rdapAvailable(n, rt) }));
        availability = avs.map((a: any) => ({ name: a.name, available: a.available, price: null, currency: 'USD', is_estimated: true }));
      }

      const ranked = availability
        .map((a: any) => scoreDomain(a.name, a.available === null ? true : a.available, a.price, profile))
        .map((s: any, i: number) => ({ ...s, domain: availability[i].name }))
        .filter((s: any) => s.available === true)
        .sort((a: any, b: any) => b.scores.overall - a.scores.overall);
      const best = ranked[0] || null;

      try { await recordUsage(base44, { provider_id: resolved.provider?.id || 'rdap', service: 'domain', operation: 'search', usage_quantity: names.length, usage_unit: 'lookup', success: true, kind: 'production_operation' }); } catch {}

      return Response.json({
        names: ranked,
        best,
        availability_source: usedProvider ? (resolved.provider?.name || 'provider') : 'rdap',
        estimated_pricing: !usedProvider,
        resolved_provider: resolved.provider ? { id: resolved.provider.id, name: resolved.provider.name, level: resolved.level } : null,
      });
    }

    if (action === 'purchase') {
      const businessId = body.business_id;
      const domainName = (body.domain_name || '').toString().toLowerCase().trim();
      if (!businessId || !domainName) return Response.json({ error: 'business_id and domain_name are required' }, { status: 400 });
      const business = await base44.entities.Business.get(businessId);
      const existing = await base44.entities.Domain.filter({ tenant_id: tenantId, business_id: businessId, domain_name: domainName });
      if (existing.length) return Response.json({ error: 'This domain is already on your account.', domain: existing[0] }, { status: 409 });

      const resolved = await resolveActiveProviderChain(base44, 'domain', tenantId);
      let status = 'selected', externalReference = null, registrationPrice = null;
      if (resolved.provider) {
        const creds = await svc.entities.ProviderCredential.filter({ provider_id: resolved.provider.id });
        const configured = creds.some((c: any) => Boolean(c.api_key_secret_name));
        if (configured) {
          try {
            const { adapter, ctx } = await buildCtx(base44, svc, resolved.provider);
            if (typeof adapter.registerDomain === 'function') {
              const reg: any = await adapter.registerDomain(ctx, rt, { name: domainName, years: 1 });
              if (reg.success) { status = 'registered'; externalReference = reg.data.external_reference; }
            }
          } catch { /* keep 'selected' */ }
        }
      }

      const domain = await base44.entities.Domain.create({
        tenant_id: tenantId, business_id: businessId, provider_id: resolved.provider?.id || null,
        domain_name: domainName, status, registration_price: registrationPrice, currency: 'USD',
        registered_at: new Date().toISOString(), auto_renew: false, transfer_lock: true,
        nameservers: [], dns_status: 'pending', external_reference: externalReference,
      });
      await base44.entities.Business.update(businessId, { launch_stage: 'website' });

      try { await recordUsage(base44, { provider_id: resolved.provider?.id || 'manual', service: 'domain', operation: 'purchase', usage_quantity: 1, usage_unit: 'registration', success: true, kind: 'production_operation' }); } catch {}

      return Response.json({ domain, registration_started: status === 'selected', provider_name: resolved.provider?.name || null });
    }

    if (action === 'list') {
      const businessId = body.business_id || undefined;
      const domains = businessId ? await base44.entities.Domain.filter({ tenant_id: tenantId, business_id: businessId }) : await base44.entities.Domain.list('-registered_at');
      return Response.json({ domains });
    }

    if (action === 'updateDns') {
      const { domain_id, nameservers, auto_renew, transfer_lock } = body;
      if (!domain_id) return Response.json({ error: 'domain_id is required' }, { status: 400 });
      const patch: any = {};
      if (Array.isArray(nameservers)) { patch.nameservers = nameservers; patch.dns_status = 'configured'; }
      if (auto_renew !== undefined) patch.auto_renew = Boolean(auto_renew);
      if (transfer_lock !== undefined) patch.transfer_lock = Boolean(transfer_lock);
      const domain = await base44.entities.Domain.update(domain_id, patch);
      return Response.json({ domain });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}