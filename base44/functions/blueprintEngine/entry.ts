import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getActiveBlueprint, blueprintContextSlice, detectIndustry } from '../../shared/industries/engine.ts';

// The Business Blueprint is the single source of truth for every downstream
// engine (website, seo, crm, email, phone, ai agent, marketing). It is derived
// from the existing planner_profile — the customer is never re-asked anything —
// then presented editable, and frozen as a versioned record on approval.
// Future edits fork a new version (v2, v3...); prior versions are never lost.

const str = { type: 'string' };
const arrStr = { type: 'array', items: { type: 'string' } };

// Provenance metadata — so 18 months later we can explain why a website looked
// the way it did (which model, which prompt, which planner produced this blueprint).
const BP_PROMPT_VERSION = 'bp-prompt-v1';
const BP_AI_MODEL = 'automatic';
const BP_AI_PROVIDER = 'base44-core';
const BP_PLANNER_VERSION_DEFAULT = 'planner-v1';
const actorName = (u: any) => (u && (u.full_name || u.email)) || (u && u.id) || 'system';

const BLUEPRINT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    business_profile: {
      type: 'object', additionalProperties: true,
      properties: { business_name: str, industry: str, business_category: str, business_description: str, mission: str, vision: str, usp: str, brand_position: str },
      required: ['business_name', 'industry', 'business_description'],
    },
    target_audience: {
      type: 'object', additionalProperties: true,
      properties: {
        primary_audience: str, secondary_audience: str,
        customer_personas: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { name: str, age_range: str, description: str } } },
        customer_problems: arrStr, customer_goals: arrStr,
      },
      required: ['primary_audience'],
    },
    branding: {
      type: 'object', additionalProperties: true,
      properties: {
        brand_tone: str, brand_personality: str, brand_voice: str,
        suggested_colors: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { name: str, hex: str } } },
        suggested_font_style: str, cta_style: str,
      },
    },
    services: {
      type: 'array',
      items: { type: 'object', additionalProperties: true, properties: { name: str, short_description: str, long_description: str, benefits: arrStr, cta: str } },
    },
    website_blueprint: {
      type: 'object', additionalProperties: true,
      properties: { pages: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { title: str, page_type: str, parent: str, purpose: str } } } },
    },
    seo_blueprint: {
      type: 'object', additionalProperties: true,
      properties: {
        primary_keywords: arrStr, secondary_keywords: arrStr, long_tail_keywords: arrStr,
        topic_clusters: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { topic: str, supporting_keywords: arrStr } } },
        blog_categories: arrStr, location_strategy: str, internal_linking_strategy: str, content_pillars: arrStr,
      },
    },
    crm_blueprint: {
      type: 'object', additionalProperties: true,
      properties: {
        lead_stages: arrStr, lead_sources: arrStr, contact_fields: arrStr,
        required_forms: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { name: str, fields: arrStr } } },
        follow_up_pipeline: str, appointment_requirements: str,
      },
    },
    email_blueprint: {
      type: 'object', additionalProperties: true,
      properties: { mailboxes: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { address: str, purpose: str } } } },
    },
    phone_blueprint: {
      type: 'object', additionalProperties: true,
      properties: { numbers: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { label: str, type: str, purpose: str } } } },
    },
    ai_agent_blueprint: {
      type: 'object', additionalProperties: true,
      properties: {
        agents: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { role: str, purpose: str, tools: arrStr } } },
        knowledge_sources: arrStr, escalation_rules: arrStr,
      },
    },
    build_estimate: {
      type: 'object', additionalProperties: true,
      properties: { website_pages: { type: 'number' }, blog_categories: { type: 'number' }, seo_pages: { type: 'number' }, expected_build_time: str, estimated_monthly_infrastructure_cost: str },
    },
  },
  required: ['business_profile', 'target_audience', 'branding', 'services', 'website_blueprint', 'seo_blueprint', 'crm_blueprint', 'email_blueprint', 'phone_blueprint', 'ai_agent_blueprint', 'build_estimate'],
};

function humanize(k: string) { return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

function normalize(bp: any, profile: any): any {
  const root: any = bp && typeof bp === 'object' ? bp : {};
  const out: any = {};
  for (const key of Object.keys(BLUEPRINT_SCHEMA.properties)) {
    const v = root[key];
    if (v === undefined) {
      out[key] = BLUEPRINT_SCHEMA.properties[key].type === 'array' ? [] : {};
    } else {
      out[key] = v;
    }
  }
  // Ensure the business_profile reflects the source business if the LLM dropped it.
  if (out.business_profile && !out.business_profile.business_name && profile?.tagline) out.business_profile.business_name = '';
  return out;
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const tenantId = (user.data && user.data.tenant_id) || undefined;
    const businessId = body.business_id;

    const listVersions = async (bid: string) => {
      const all = await svc.entities.BusinessBlueprint.filter({ business_id: bid });
      return (all || []).sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
    };
    const nextVersion = (all: any[]) => (all.reduce((m: number, r: any) => Math.max(m, r.version || 0), 0)) + 1;

    // GENERATE — derive the full blueprint from the existing planner_profile.
    if (action === 'generate') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const business: any = await base44.entities.Business.get(businessId);
      const profile = business.planner_profile || body.profile || null;
      if (!profile || !profile.industry) return Response.json({ error: 'Run the AI Business Planner first — no planner_profile found on this business.' }, { status: 400 });

      // Industry Intelligence (Phase 13): load the active Industry Blueprint for this
      // business and feed it to the generator so the Business Blueprint is
      // industry-aware — without re-asking the customer anything.
      let industrySlice: any = null;
      try {
        const key = business.industry_key || (await detectIndustry(svc, { name: business.name, description: business.description, industry: business.industry })).industry_key;
        if (key) { const ib = await getActiveBlueprint(svc, key, business.tenant_id); if (ib) industrySlice = blueprintContextSlice(ib); }
      } catch {}

      const ctx = `PLANNER PROFILE (the seed — do NOT re-ask the customer anything):
${JSON.stringify(profile)}

BUSINESS INFO:
Name: ${business.name}
Industry: ${business.industry}
Description: ${business.description || '(none provided)'}
Country / City: ${business.country || ''} / ${business.city || ''}
Known services: ${(business.services_products || []).join(', ') || '(derive from planner)'}
Target customers: ${business.target_customers || '(derive from planner)'}

This Business Blueprint is the SINGLE SOURCE OF TRUTH for every downstream engine (website, SEO, CRM, email, phone, AI agents). Be specific, grounded and complete — no placeholders, no "TBD", no commentary. Return ONLY the JSON object. Stay consistent with the brand tone and the planner profile throughout.

INDUSTRY BLUEPRINT (industry-standard best practices for this vertical — incorporate and tailor to THIS specific business; if a field is empty or absent, infer from the business, do NOT copy blindly):
${industrySlice ? JSON.stringify(industrySlice) : '(none available — proceed from the planner profile)'}`;

      const slice = (keys: string[]) => ({ type: 'object', additionalProperties: true, properties: Object.fromEntries(keys.map((k) => [k, BLUEPRINT_SCHEMA.properties[k]])), required: keys });
      const parts: { keys: string[]; brief: string }[] = [
        { keys: ['business_profile', 'target_audience', 'branding', 'services'], brief: `business_profile (business_name, industry, business_category, business_description 2-3 sentences, mission, vision, usp, brand_position); target_audience (primary_audience, secondary_audience, customer_personas 3-4 {name, age_range, description}, customer_problems list, customer_goals list); branding (brand_tone, brand_personality, brand_voice, suggested_colors 4-6 {name, hex}, suggested_font_style, cta_style); services (array, each: name, short_description, long_description, benefits list, cta — use the planner's services).` },
        { keys: ['website_blueprint', 'seo_blueprint', 'crm_blueprint'], brief: `website_blueprint.pages (ordered array {title, page_type, parent, purpose} — include Home, About, Services overview, one page per service, Pricing, FAQ, Reviews, Gallery, Contact, Blog, Privacy, Terms, plus relevant location/industry pages); seo_blueprint (primary_keywords, secondary_keywords, long_tail_keywords, topic_clusters 3-5 {topic, supporting_keywords}, blog_categories, location_strategy, internal_linking_strategy, content_pillars); crm_blueprint (lead_stages, lead_sources, contact_fields, required_forms array {name, fields}, follow_up_pipeline, appointment_requirements).` },
        { keys: ['email_blueprint', 'phone_blueprint', 'ai_agent_blueprint', 'build_estimate'], brief: `email_blueprint.mailboxes (array {address, purpose} — info@, sales@, support@, billing@, hello@, careers@ plus any others appropriate); phone_blueprint.numbers (array {label, type, purpose} — Business, Sales, Support, WhatsApp, Toll-Free as relevant); ai_agent_blueprint (agents array {role, purpose, tools} covering Sales, Support, Billing, Receptionist, Lead Qualification; knowledge_sources list, escalation_rules list); build_estimate (website_pages number = pages count, blog_categories number, seo_pages number, expected_build_time e.g. "3-4 days", estimated_monthly_infrastructure_cost e.g. "$45/month" USD).` },
      ];
      const results: any[] = await Promise.all(parts.map((p) =>
        svc.integrations.Core.InvokeLLM({ prompt: `You are a senior business strategist and launch planner. ${ctx}\n\nProduce ONLY these top-level sections as JSON: ${p.brief}`, response_json_schema: slice(p.keys) })
      ));
      const raw: any = Object.assign({}, ...results);
      const filled = Object.keys(raw).filter((k) => raw[k] && JSON.stringify(raw[k]) !== '{}').length;
      if (filled < 9) return Response.json({ error: 'The blueprint generator returned an incomplete result. Please try again.', partial: raw }, { status: 502 });
      const blueprint = normalize(raw, profile);

      const all = await listVersions(businessId);
      const rec = await base44.entities.BusinessBlueprint.create({
        tenant_id: business.tenant_id, business_id: businessId, version: nextVersion(all), status: 'draft',
        blueprint, source_profile: profile,
        generated_by: actorName(user), generated_at: new Date().toISOString(),
        ai_model: BP_AI_MODEL, ai_provider: BP_AI_PROVIDER, prompt_version: BP_PROMPT_VERSION,
        planner_version: (profile && (profile.planner_version || profile.version)) || BP_PLANNER_VERSION_DEFAULT,
      });
      return Response.json({ blueprint: rec });
    }

    // UPDATE — persist edits to a draft only.
    if (action === 'update') {
      const { version_id, blueprint } = body;
      if (!version_id || !blueprint) return Response.json({ error: 'version_id and blueprint are required' }, { status: 400 });
      const rec: any = await base44.entities.BusinessBlueprint.get(version_id);
      if (rec.status !== 'draft') return Response.json({ error: 'Only draft blueprints are editable. Fork a new version to make changes.' }, { status: 409 });
      const updated = await base44.entities.BusinessBlueprint.update(version_id, { blueprint: normalize(blueprint, rec.source_profile) });
      return Response.json({ blueprint: updated });
    }

    // APPROVE — freeze the current draft as the active version; supersede priors.
    if (action === 'approve') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const all = await listVersions(businessId);
      const blueprint = body.blueprint;
      let draft = all.find((r: any) => r.status === 'draft') || null;
      if (!draft && !blueprint) return Response.json({ error: 'No draft blueprint to approve. Run generate or fork first, or pass a blueprint.' }, { status: 400 });
      if (!draft) {
        const biz: any = await base44.entities.Business.get(businessId);
        draft = await base44.entities.BusinessBlueprint.create({
          tenant_id: biz.tenant_id, business_id: businessId, version: nextVersion(all), status: 'draft',
          blueprint: normalize(blueprint, null), source_profile: null,
          generated_by: actorName(user), generated_at: new Date().toISOString(),
          ai_model: 'manual', ai_provider: 'manual', prompt_version: BP_PROMPT_VERSION,
          planner_version: BP_PLANNER_VERSION_DEFAULT,
        });
      } else if (blueprint) {
        draft = await base44.entities.BusinessBlueprint.update(draft.id, { blueprint: normalize(blueprint, draft.source_profile) });
      }
      for (const r of all) if (r.status === 'approved' && r.id !== draft.id) {
        await svc.entities.BusinessBlueprint.update(r.id, { status: 'superseded' });
      }
      const approved = await base44.entities.BusinessBlueprint.update(draft.id, { status: 'approved', approved_at: new Date().toISOString(), approved_by: actorName(user) });
      return Response.json({ blueprint: approved, superseded_count: all.filter((r: any) => r.status === 'approved' && r.id !== draft.id).length });
    }

    // FORK — start a new editable version from an existing (approved) blueprint.
    if (action === 'fork') {
      const { version_id } = body;
      if (!version_id) return Response.json({ error: 'version_id is required' }, { status: 400 });
      const src: any = await base44.entities.BusinessBlueprint.get(version_id);
      const all = await listVersions(src.business_id);
      const rec = await base44.entities.BusinessBlueprint.create({
        tenant_id: src.tenant_id, business_id: src.business_id, version: nextVersion(all), status: 'draft',
        blueprint: src.blueprint, source_profile: src.source_profile,
        generated_by: actorName(user), generated_at: new Date().toISOString(),
        ai_model: src.ai_model || BP_AI_MODEL, ai_provider: src.ai_provider || BP_AI_PROVIDER, prompt_version: BP_PROMPT_VERSION,
        planner_version: src.planner_version || BP_PLANNER_VERSION_DEFAULT,
      });
      return Response.json({ blueprint: rec });
    }

    // GET — the active approved blueprint for a business (else the latest draft), for the review page.
    if (action === 'get') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const all = await listVersions(businessId);
      const approved = all.find((r: any) => r.status === 'approved') || null;
      const latest = approved || all[0] || null;
      return Response.json({ blueprint: latest, versions: all.map((r: any) => ({ id: r.id, version: r.version, status: r.status, approved_at: r.approved_at })) });
    }

    // LOAD — the active approved blueprint, for downstream engines to consume.
    if (action === 'load') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const all = await listVersions(businessId);
      const approved = all.find((r: any) => r.status === 'approved') || null;
      if (!approved) return Response.json({ error: 'No approved Business Blueprint yet. Approve a blueprint first.' }, { status: 404 });
      return Response.json({ blueprint: approved });
    }

    if (action === 'list') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      return Response.json({ versions: (await listVersions(businessId)).map((r: any) => ({ id: r.id, version: r.version, status: r.status, approved_at: r.approved_at })) });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as any).message }, { status: 500 });
  }
}