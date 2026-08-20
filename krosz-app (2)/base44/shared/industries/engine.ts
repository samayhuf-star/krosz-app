// Industry Intelligence Engine (Phase 13).
//
// Industry-aware intelligence over the existing platform — NO existing engine is
// redesigned. This module:
//   - detects the industry from a free-text business description (closed catalog)
//   - manages a versioned Industry Blueprint library (system tenant; never overwrites)
//   - personalizes a Business: assign industry + load active blueprint + gather
//     cross-industry patterns + benchmarks → a single context object consumed by
//     the Business Blueprint Engine, AI Executives and the Knowledge Graph
//   - self-improves blueprints from successful launches / approved recommendations
//     (always a NEW version; history is immutable)
//   - stores transferable cross-industry business patterns
//
// State lives entirely in entities: IndustryBlueprint, IndustryBenchmark,
// BusinessPattern, and assignment fields on Business.

import { INDUSTRIES, INDUSTRY_KEYS, findIndustry, categoryLabel, IndustryEntry } from "./catalog.ts";
import { CURATED, curatedBlueprint, curatedFallback } from "./curated.ts";

const DAY = 86400000;

// ----------------------------------------------------------------
// CATALOG
// ----------------------------------------------------------------
export function listCatalog(): any[] {
  return INDUSTRIES.map((i) => ({ ...i, category_label: categoryLabel(i.category) }));
}
export function listCategories(): string[] {
  return Array.from(new Set(INDUSTRIES.map((i) => i.category)));
}

// ----------------------------------------------------------------
// DETECTION
// ----------------------------------------------------------------
// Classify a business description against the closed catalog using InvokeLLM.
// Returns { industry_key, confidence, alternatives[], ai_generated }.
export async function detectIndustry(svc: any, input: {
  name?: string; description?: string; goal?: string; industry?: string;
}): Promise<any> {
  const haystack = [input.name, input.industry, input.description, input.goal].filter(Boolean).join(" ").trim();
  // Fast path: an exact / strong textual match against known keys/labels.
  const direct = directMatch(haystack);
  const options = INDUSTRIES.map((i) => `${i.key} (${i.label})`).join(", ");
  const schema = {
    type: "object",
    properties: {
      industry_key: { type: "string", enum: INDUSTRY_KEYS as any },
      confidence: { type: "number" },
      alternatives: { type: "array", items: { type: "string" } },
      rationale: { type: "string" },
    },
    required: ["industry_key", "confidence"],
  };
  const prompt = `You classify a business into ONE industry from a fixed catalog.
Return the best matching catalog key (industry_key), a confidence 0-1, up to 3 alternative keys, and a one-line rationale.
If the description does not clearly map, pick the closest key and set a low confidence.

CATALOG: ${options}

BUSINESS:
Name: ${input.name || "(unknown)"}
Industry hint: ${input.industry || "(none)"}
Description / Goal: ${input.description || input.goal || "(none)"}`;
  let result: any;
  try {
    result = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema });
  } catch {
    result = direct ? { industry_key: direct.key, confidence: 0.6, alternatives: [], rationale: "Textual match fallback." } : { industry_key: "consultant", confidence: 0.3, alternatives: [], rationale: "Defaulted to consultant." };
  }
  // Prefer a strong direct match over a low-confidence LLM answer.
  if (direct && (result.confidence == null || result.confidence < 0.7)) {
    result = { ...result, industry_key: direct.key, confidence: Math.max(0.75, result.confidence ?? 0.6), rationale: result.rationale || "Direct catalog match." };
  }
  if (!INDUSTRY_KEYS.includes(result.industry_key)) result.industry_key = direct?.key || "consultant";
  return {
    industry_key: result.industry_key,
    confidence: Math.max(0, Math.min(1, result.confidence ?? (direct ? 0.6 : 0.3))),
    alternatives: (result.alternatives || []).filter((k: string) => INDUSTRY_KEYS.includes(k) && k !== result.industry_key).slice(0, 3),
    rationale: result.rationale || "",
    ai_generated: true,
    detected_at: new Date().toISOString(),
  };
}

function directMatch(text: string): IndustryEntry | null {
  const t = text.toLowerCase();
  if (!t) return null;
  // Exact label/key hits first.
  for (const i of INDUSTRIES) {
    if (t.includes(i.key) || t.includes(i.label.toLowerCase())) return i;
  }
  return null;
}

// ----------------------------------------------------------------
// LIBRARY
// ----------------------------------------------------------------
// Active blueprint for an industry: tenant override wins, else system library.
export async function getActiveBlueprint(svc: any, industryKey: string, tenantId?: string): Promise<any | null> {
  if (tenantId) {
    const rows: any[] = await svc.entities.IndustryBlueprint.filter({ tenant_id: tenantId, industry_key: industryKey, status: "active" }).catch(() => []);
    if (rows && rows.length) return rows.sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0];
  }
  const sys: any[] = await svc.entities.IndustryBlueprint.filter({ tenant_id: "system", industry_key: industryKey, status: "active" }).catch(() => []);
  return (sys && sys.sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0]) || null;
}

export async function listVersions(svc: any, industryKey: string, tenantId?: string): Promise<any[]> {
  const rows: any[] = await svc.entities.IndustryBlueprint.filter({ tenant_id: "system", industry_key: industryKey }).catch(() => []);
  let all = rows || [];
  if (tenantId) {
    const tr: any[] = await svc.entities.IndustryBlueprint.filter({ tenant_id: tenantId, industry_key: industryKey }).catch(() => []);
    all = [...(tr || []), ...all];
  }
  return all.sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
}

export async function nextVersion(svc: any, industryKey: string, tenantId = "system"): Promise<number> {
  const rows = await listVersions(svc, industryKey, tenantId);
  return (rows.reduce((m: number, r: any) => Math.max(m, r.version || 0), 0)) + 1;
}

export async function listActiveBlueprints(svc: any): Promise<any[]> {
  const rows: any[] = await svc.entities.IndustryBlueprint.filter({ tenant_id: "system", status: "active" }).catch(() => []);
  return (rows || []).sort((a: any, b: any) => a.industry_label.localeCompare(b.industry_label));
}

export async function allBlueprints(svc: any, status?: string): Promise<any[]> {
  const rows: any[] = await svc.entities.IndustryBlueprint.filter({ tenant_id: "system", ...(status ? { status } : {}) }, "-version", 200).catch(() => []);
  return rows || [];
}

// Publish a draft: it becomes the active version; the previous active is superseded.
// History is never overwritten — the prior version row remains with status=superseded.
export async function publishVersion(svc: any, versionId: string, actor: string): Promise<any> {
  const draft: any = await svc.entities.IndustryBlueprint.get(versionId);
  if (!draft) throw Object.assign(new Error("Blueprint version not found"), { code: "NOT_FOUND" });
  if (draft.status === "active") return draft;
  // Supersede the current active (same tenant + industry_key).
  const same: any[] = await svc.entities.IndustryBlueprint.filter({ tenant_id: draft.tenant_id, industry_key: draft.industry_key, status: "active" }).catch(() => []);
  for (const r of same) if (r.id !== draft.id) await svc.entities.IndustryBlueprint.update(r.id, { status: "superseded" }).catch(() => {});
  const updated = await svc.entities.IndustryBlueprint.update(versionId, {
    status: "active", human_verified: true, last_updated: new Date().toISOString(),
    provenance: { ...(draft.provenance || {}), published_by: actor, published_at: new Date().toISOString() },
  });
  return updated;
}

export async function archiveVersion(svc: any, versionId: string): Promise<any> {
  return await svc.entities.IndustryBlueprint.update(versionId, { status: "archived", last_updated: new Date().toISOString() }).catch(() => null);
}

export async function bumpUsage(svc: any, industryKey: string): Promise<void> {
  const active = await getActiveBlueprint(svc, industryKey, "system");
  if (!active) return;
  await svc.entities.IndustryBlueprint.update(active.id, { usage_count: (active.usage_count || 0) + 1 }).catch(() => {});
}

export async function recordSuccess(svc: any, industryKey: string, metric: string): Promise<void> {
  const active = await getActiveBlueprint(svc, industryKey, "system");
  if (!active) return;
  const sm = active.success_metrics || {};
  sm[metric] = (sm[metric] || 0) + 1;
  await svc.entities.IndustryBlueprint.update(active.id, { success_metrics: sm }).catch(() => {});
}

// ----------------------------------------------------------------
// PERSONALIZATION
// ----------------------------------------------------------------
// Resolve the full industry context for a business, and (when assign=true) persist
// the detection + blueprint assignment on the Business record so every downstream
// engine (Blueprint, Executives, KG) can consume it. Also marks the Knowledge Graph
// stale so the next rebuild reflects the industry assignment.
export async function personalizeBusiness(svc: any, business: any, opts: { assign?: boolean; markStale?: (svc: any, id: string, reason: string) => Promise<void> } = {}): Promise<any> {
  const detection = await detectIndustry(svc, { name: business.name, description: business.description, goal: (business.planner_profile && business.planner_profile.business_goal) || business.description, industry: business.industry });
  const blueprint = await getActiveBlueprint(svc, detection.industry_key, business.tenant_id);
  const patterns = await applicablePatterns(svc, detection.industry_key);
  const benchmark = await getBenchmark(svc, detection.industry_key);
  if (opts.assign !== false) {
    await svc.entities.Business.update(business.id, {
      industry_key: detection.industry_key,
      industry_detection: detection,
      industry_blueprint_id: blueprint?.id || null,
      industry_blueprint_version: blueprint?.version || null,
    }).catch(() => {});
    await bumpUsage(svc, detection.industry_key);
    if (opts.markStale) try { await opts.markStale(svc, business.id, "industry_assigned"); } catch {}
  }
  return { industry: { ...findIndustry(detection.industry_key), ...detection }, blueprint, patterns, benchmark };
}

// A compact, serializable slice for LLM context injection (Blueprint Engine, Executives).
export function blueprintContextSlice(blueprint: any): any {
  if (!blueprint) return null;
  return {
    industry_key: blueprint.industry_key,
    industry_label: blueprint.industry_label,
    business_model: blueprint.business_model,
    customer_personas: blueprint.customer_personas,
    typical_services: blueprint.typical_services,
    pricing_models: blueprint.pricing_models,
    sales_funnel: blueprint.sales_funnel,
    lead_sources: blueprint.lead_sources,
    website_structure: blueprint.website_structure,
    seo_strategy: blueprint.seo_strategy,
    crm_pipeline: blueprint.crm_pipeline,
    email_sequences: blueprint.email_sequences,
    marketing_calendar: blueprint.marketing_calendar,
    kpis: blueprint.kpis,
    compliance_reminders: blueprint.compliance_reminders,
    common_automations: blueprint.common_automations,
    typical_ai_employees: blueprint.typical_ai_employees,
    suggested_integrations: blueprint.suggested_integrations,
    business_risks: blueprint.business_risks,
    growth_strategies: blueprint.growth_strategies,
    expansion_strategies: blueprint.expansion_strategies,
  };
}

// ----------------------------------------------------------------
// BENCHMARKS (architecture placeholder; no external collection)
// ----------------------------------------------------------------
export async function getBenchmark(svc: any, industryKey: string, region = "global"): Promise<any | null> {
  const rows: any[] = await svc.entities.IndustryBenchmark.filter({ tenant_id: "system", industry_key: industryKey, region }).catch(() => []);
  return (rows && rows.sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0]) || null;
}

export async function upsertBenchmark(svc: any, opts: { industry_key: string; region?: string; metrics: any; confidence?: number }): Promise<any> {
  const region = opts.region || "global";
  const existing = await getBenchmark(svc, opts.industry_key, region);
  const payload = {
    tenant_id: "system", industry_key: opts.industry_key, region,
    version: existing ? (existing.version || 0) + 1 : 1,
    metrics: opts.metrics, data_source: "ai_estimate", ai_generated: true,
    confidence: opts.confidence ?? 0.5, collected_at: new Date().toISOString(),
    provenance: { source: "ai_estimate" },
  };
  if (existing) return await svc.entities.IndustryBenchmark.update(existing.id, payload).catch(() => existing);
  return await svc.entities.IndustryBenchmark.create(payload);
}

export async function listBenchmarks(svc: any): Promise<any[]> {
  const rows: any[] = await svc.entities.IndustryBenchmark.filter({ tenant_id: "system" }).catch(() => []);
  return (rows || []).sort((a: any, b: any) => a.industry_key.localeCompare(b.industry_key));
}

// ----------------------------------------------------------------
// CROSS-INDUSTRY PATTERNS
// ----------------------------------------------------------------
export async function applicablePatterns(svc: any, industryKey: string): Promise<any[]> {
  const rows: any[] = await svc.entities.BusinessPattern.filter({ tenant_id: "system", status: "active" }).catch(() => []);
  return (rows || []).filter((p: any) => p.origin_industry !== industryKey && (!p.applicable_industries || p.applicable_industries.length === 0 || p.applicable_industries.includes(industryKey)));
}

export async function listPatterns(svc: any): Promise<any[]> {
  const rows: any[] = await svc.entities.BusinessPattern.filter({ tenant_id: "system" }).catch(() => []);
  return rows || [];
}

export async function createPattern(svc: any, p: any, actor: string): Promise<any> {
  if (!p.pattern_key || !p.name || !p.category) throw Object.assign(new Error("pattern_key, name, category required"), { code: "BAD_REQUEST" });
  const existing: any[] = await svc.entities.BusinessPattern.filter({ tenant_id: "system", pattern_key: p.pattern_key }).catch(() => []);
  const row = {
    tenant_id: "system", pattern_key: p.pattern_key, name: p.name, description: p.description || "",
    category: p.category, origin_industry: p.origin_industry || "",
    applicable_industries: p.applicable_industries || [], mechanism: p.mechanism || "",
    implementation_hint: p.implementation_hint || "", evidence: p.evidence || [],
    status: p.status || "idea", version: existing && existing.length ? (existing[0].version || 0) + 1 : 1,
    ai_generated: p.ai_generated !== false, human_verified: !!p.human_verified,
    created_at: new Date().toISOString(), provenance: { actor },
  };
  if (existing && existing.length) return await svc.entities.BusinessPattern.update(existing[0].id, row).catch(() => existing[0]);
  return await svc.entities.BusinessPattern.create(row);
}

// AI suggests transferable patterns FROM another industry INTO this one.
export async function suggestPatterns(svc: any, industryKey: string): Promise<any[]> {
  const blueprint = await getActiveBlueprint(svc, industryKey);
  const all = INDUSTRIES.filter((i) => i.key !== industryKey).map((i) => `${i.key} (${i.label})`).join(", ");
  const schema = { type: "object", properties: { patterns: { type: "array", items: {
    type: "object", properties: {
      pattern_key: { type: "string" }, name: { type: "string" },
      origin_industry: { type: "string", enum: INDUSTRY_KEYS as any },
      category: { type: "string", enum: ["retention", "acquisition", "operations", "marketing", "support", "finance", "growth"] },
      mechanism: { type: "string" }, implementation_hint: { type: "string" }, rationale: { type: "string" },
    }, required: ["pattern_key", "name", "origin_industry", "category", "mechanism"] } } } };
  const prompt = `Suggest 2-4 proven business strategies from OTHER industries that would transfer well to a "${findIndustry(industryKey)?.label || industryKey}" business.
For each, give a snake_case pattern_key, a human name, the origin industry (one of: ${all}), a category, the mechanism (how it works), an implementation_hint (how to realize it on Launch OS: workflows, automations, emails), and a rationale.
TARGET INDUSTRY: ${findIndustry(industryKey)?.label || industryKey}
TARGET BUSINESS MODEL: ${blueprint?.business_model || "(unknown)"}`;
  let res: any;
  try { res = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }); }
  catch { res = { patterns: [] }; }
  return (res.patterns || []).filter((p: any) => p.pattern_key && p.name);
}

// ----------------------------------------------------------------
// SELF-IMPROVEMENT
// ----------------------------------------------------------------
// Learn from completed launches + approved recommendations + recent feedback, and
// propose an improved DRAFT version of an industry blueprint. Never overwrites —
// returns the new draft (caller publishes after review).
export async function selfImprove(svc: any, industryKey: string, actor: string): Promise<any> {
  // Gather signals: successful launches, approved recommendations, observations.
  const businesses: any[] = await svc.entities.Business.filter({ industry_key: industryKey }, "-created_date", 50).catch(() => []);
  const completedLaunches: any[] = [];
  const doneRecos: any[] = [];
  for (const b of businesses) {
    const runs: any[] = await svc.entities.LaunchPlan.filter({ business_id: b.id, status: "completed" }, "-created_date", 5).catch(() => []);
    completedLaunches.push(...(runs || []));
    const recos: any[] = await svc.entities.LaunchRecommendation.filter({ business_id: b.id, status: "done" }, "-generated_at", 20).catch(() => []);
    doneRecos.push(...(recos || []));
  }
  const base = await getActiveBlueprint(svc, industryKey) || {};
  const schema = { type: "object", additionalProperties: true, properties: {
    growth_strategies: { type: "array", items: { type: "string" } },
    common_automations: { type: "array", items: { type: "string" } },
    business_risks: { type: "array", items: { type: "string" } },
    kpis: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  } };
  const prompt = `You improve the Industry Blueprint for "${findIndustry(industryKey)?.label || industryKey}".
Using real outcomes from businesses in this industry, refine growth_strategies, common_automations, business_risks, and kpis. Keep existing good items, add new ones learned from the outcomes, and write a one-line summary of what changed.

COMPLETED LAUNCHES (${completedLaunches.length}): ${JSON.stringify(completedLaunches.slice(0, 15).map((r) => ({ goal: r.goal, tasks: r.total_steps })))}
APPROVED RECOMMENDATIONS (${doneRecos.length}): ${JSON.stringify(doneRecos.slice(0, 20).map((r) => r.title))}
CURRENT BLUEPRINT (merge, don't drop):
${JSON.stringify({ growth_strategies: base.growth_strategies, common_automations: base.common_automations, business_risks: base.business_risks, kpis: base.kpis })}`;
  let res: any;
  try { res = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema }); }
  catch { res = { growth_strategies: base.growth_strategies || [], common_automations: base.common_automations || [], business_risks: base.business_risks || [], kpis: base.kpis || [], summary: "No improvements available." }; }

  const version = await nextVersion(svc, industryKey, "system");
  const draft = await svc.entities.IndustryBlueprint.create({
    ...base,
    id: undefined, _id: undefined,
    tenant_id: "system", industry_key: industryKey, industry_label: findIndustry(industryKey)?.label || industryKey,
    category: findIndustry(industryKey)?.category || base.category,
    version, status: "draft", ai_generated: true,
    growth_strategies: res.growth_strategies || base.growth_strategies || [],
    common_automations: res.common_automations || base.common_automations || [],
    business_risks: res.business_risks || base.business_risks || [],
    kpis: res.kpis || base.kpis || [],
    last_updated: new Date().toISOString(), usage_count: 0, success_metrics: {},
    provenance: { actor, source: "self_improvement", parent_version: base.version, summary: res.summary, evidence: { completed_launches: completedLaunches.length, approved_recommendations: doneRecos.length } },
  });
  return { draft, summary: res.summary, evidence: { completed_launches: completedLaunches.length, approved_recommendations: doneRecos.length } };
}

// ----------------------------------------------------------------
// AI FULL-BLUEPRINT GENERATION
// ----------------------------------------------------------------
export async function generateBlueprint(svc: any, industryKey: string, actor: string): Promise<any> {
  const entry = findIndustry(industryKey);
  if (!entry) throw Object.assign(new Error(`Unknown industry: ${industryKey}`), { code: "BAD_INDUSTRY" });
  const base = await getActiveBlueprint(svc, industryKey) || {};
  const schema = { type: "object", additionalProperties: true, properties: {
    business_model: { type: "string" },
    customer_personas: { type: "array", items: { type: "object", additionalProperties: true, properties: { name: { type: "string" }, description: { type: "string" }, needs: { type: "array", items: { type: "string" } } } } },
    typical_services: { type: "array", items: { type: "string" } },
    pricing_models: { type: "array", items: { type: "string" } },
    sales_funnel: { type: "array", items: { type: "string" } },
    lead_sources: { type: "array", items: { type: "string" } },
    website_structure: { type: "array", items: { type: "object", additionalProperties: true, properties: { title: { type: "string" }, purpose: { type: "string" } } } },
    seo_strategy: { type: "object", additionalProperties: true, properties: { primary_keywords: { type: "array", items: { type: "string" } }, content_pillars: { type: "array", items: { type: "string" } }, location_strategy: { type: "string" } } },
    crm_pipeline: { type: "object", additionalProperties: true, properties: { stages: { type: "array", items: { type: "string" } }, lead_sources: { type: "array", items: { type: "string" } } } },
    email_sequences: { type: "array", items: { type: "object", additionalProperties: true, properties: { name: { type: "string" }, purpose: { type: "string" } } } },
    marketing_calendar: { type: "array", items: { type: "object", additionalProperties: true, properties: { month: { type: "string" }, focus: { type: "string" } } } },
    kpis: { type: "array", items: { type: "string" } },
    compliance_reminders: { type: "array", items: { type: "string" } },
    common_automations: { type: "array", items: { type: "string" } },
    typical_ai_employees: { type: "array", items: { type: "string" } },
    suggested_integrations: { type: "array", items: { type: "string" } },
    business_risks: { type: "array", items: { type: "string" } },
    growth_strategies: { type: "array", items: { type: "string" } },
    expansion_strategies: { type: "array", items: { type: "string" } },
  } };
  const prompt = `Generate a complete Industry Blueprint for a "${entry.label}" business.
Cover: business_model, 3-4 customer_personas, typical_services, pricing_models, sales_funnel steps, lead_sources, website_structure (page title + purpose), seo_strategy (primary_keywords, content_pillars, location_strategy), crm_pipeline (stages, lead_sources), email_sequences, marketing_calendar (12 months), kpis, compliance_reminders, common_automations, typical_ai_employees (suggested Launch OS executive roles), suggested_integrations, business_risks, growth_strategies, expansion_strategies.
Be concrete and practical. No placeholders.`;
  let res: any;
  try { res = await svc.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema, model: "claude_sonnet_4_6" }); }
  catch { res = curatedFallback(industryKey) || {}; }
  const version = await nextVersion(svc, industryKey, "system");
  const draft = await svc.entities.IndustryBlueprint.create({
    tenant_id: "system", industry_key: industryKey, industry_label: entry.label, category: entry.category,
    version, status: "draft", ai_generated: true, human_verified: false,
    last_updated: new Date().toISOString(), quality_score: 0, usage_count: 0, success_metrics: {},
    ...res, provenance: { actor, source: "ai_generate", parent_version: base?.version || null, generated_at: new Date().toISOString() },
  });
  return draft;
}

// ----------------------------------------------------------------
// SEED — ensure the managed library has an IndustryBlueprint for every catalog
// industry. Curated verticals get rich content (active v1); the rest get a
// minimal active stub that `generate-blueprint` upgrades later. Idempotent.
// ----------------------------------------------------------------
export async function seedLibrary(svc: any, actor = "system"): Promise<any> {
  let created = 0, skipped = 0;
  for (const entry of INDUSTRIES) {
    const existing = await getActiveBlueprint(svc, entry.key, "system");
    if (existing) { skipped++; continue; }
    const curated = curatedBlueprint(entry.key);
    const row = curated || {
      tenant_id: "system", industry_key: entry.key, industry_label: entry.label, category: entry.category,
      version: 1, status: "active", ai_generated: false, human_verified: false,
      last_updated: new Date().toISOString(), quality_score: 50, usage_count: 0, success_metrics: {},
      business_model: "", customer_personas: [], typical_services: [], pricing_models: [], sales_funnel: [],
      lead_sources: [], website_structure: [], seo_strategy: {}, crm_pipeline: {}, email_sequences: [],
      marketing_calendar: [], kpis: [], compliance_reminders: [], common_automations: [],
      typical_ai_employees: [], suggested_integrations: [], business_risks: [], growth_strategies: [],
      expansion_strategies: [], provenance: { source: "catalog_seed", actor },
    };
    if (!curated) row.provenance = { source: "catalog_seed", actor };
    await svc.entities.IndustryBlueprint.create(row);
    created++;
  }
  return { created, skipped, total: INDUSTRIES.length };
}