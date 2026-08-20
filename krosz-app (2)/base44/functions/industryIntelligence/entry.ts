// Industry Intelligence — Phase 13 entry point.
//
// Exposes the Industry Intelligence Engine as an HTTP service:
//   Detection / personalization: detect | personalize | list-industries | list-categories
//   Library management (admin): seed | generate-blueprint | publish | verify | update |
//                               archive | self-improve | stats | feedback
//   Library reads: list-blueprints | get-blueprint | get-blueprint-version
//   Benchmarks (architecture): upsert-benchmark | get-benchmark | list-benchmarks
//   Cross-industry patterns: list-patterns | applicable-patterns | suggest-patterns |
//                            create-pattern | apply-pattern
// Downstream engines consume industry context via the shared engine module
// (blueprintContextSlice) — never via HTTP.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import {
  listCatalog, listCategories, detectIndustry, getActiveBlueprint, listVersions,
  listActiveBlueprints, allBlueprints, publishVersion, archiveVersion,
  personalizeBusiness, getBenchmark, upsertBenchmark, listBenchmarks,
  applicablePatterns, listPatterns, createPattern, suggestPatterns, selfImprove, generateBlueprint, seedLibrary,
} from "../../shared/industries/engine.ts";
import { markStale } from "../../shared/knowledge-graph/index.ts";
import { requireBusinessId, verifyTenant, actorOf } from "../../shared/ai/coo.ts";

const READ_ACTIONS = new Set(["detect", "list-industries", "list-categories", "list-blueprints", "get-blueprint", "get-blueprint-version", "get-benchmark", "list-benchmarks", "list-patterns", "applicable-patterns", "suggest-patterns", "stats"]);
const ADMIN_ACTIONS = new Set(["seed", "generate-blueprint", "publish", "verify", "update", "archive", "self-improve", "feedback", "upsert-benchmark", "create-pattern", "apply-pattern"]);

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    let user: any = null;
    try { user = await base44.auth.me(); } catch {}
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (!action) return Response.json({ error: "action is required" }, { status: 400 });
    if (user.role !== "admin" && ADMIN_ACTIONS.has(action)) return Response.json({ error: "Admin only" }, { status: 403 });
    const svc = base44.asServiceRole;
    const actor = actorOf(user, "industry_intelligence");
    const rd = user ? base44 : svc;

    // ---------- DETECTION / PERSONALIZATION ----------
    if (action === "detect") return Response.json(await detectIndustry(svc, { name: body.name, description: body.description, goal: body.goal, industry: body.industry }));
    if (action === "personalize") {
      const businessId = requireBusinessId(body);
      const business: any = await svc.entities.Business.get(businessId).catch(() => null);
      if (!business) throw Object.assign(new Error("Business not found"), { code: "BUSINESS_NOT_FOUND" });
      await verifyTenant(svc, businessId, user);
      return Response.json(await personalizeBusiness(svc, business, { assign: body.assign !== false, markStale }));
    }

    // ---------- CATALOG / LIBRARY READS ----------
    if (action === "list-industries") return Response.json({ industries: listCatalog(), categories: listCategories() });
    if (action === "list-categories") return Response.json({ categories: listCategories() });
    if (action === "list-blueprints") return Response.json({ blueprints: (await listActiveBlueprints(svc)).map(summary), all: (await allBlueprints(svc, body.status)).map(summary) });
    if (action === "get-blueprint") {
      if (!body.industry_key) return Response.json({ error: "industry_key is required" }, { status: 400 });
      const active = await getActiveBlueprint(svc, body.industry_key, body.tenant_id);
      return Response.json({ active: summary(active), versions: (await listVersions(svc, body.industry_key, body.tenant_id)).map(summary) });
    }
    if (action === "get-blueprint-version") {
      if (!body.version_id) return Response.json({ error: "version_id is required" }, { status: 400 });
      const v: any = await svc.entities.IndustryBlueprint.get(body.version_id);
      return Response.json({ version: v });
    }

    // ---------- LIBRARY MANAGEMENT (admin) ----------
    if (action === "seed") return Response.json(await seedLibrary(svc, actor));
    if (action === "generate-blueprint") {
      if (!body.industry_key) return Response.json({ error: "industry_key is required" }, { status: 400 });
      const draft = await generateBlueprint(svc, body.industry_key, actor);
      return Response.json({ draft });
    }
    if (action === "publish") {
      if (!body.version_id) return Response.json({ error: "version_id is required" }, { status: 400 });
      return Response.json({ blueprint: summary(await publishVersion(svc, body.version_id, actor)) });
    }
    if (action === "verify") {
      if (!body.version_id) return Response.json({ error: "version_id is required" }, { status: 400 });
      const v: any = await svc.entities.IndustryBlueprint.get(body.version_id);
      const updated = await svc.entities.IndustryBlueprint.update(body.version_id, { human_verified: body.verified ?? !v.human_verified, last_updated: new Date().toISOString() });
      return Response.json({ blueprint: summary(updated) });
    }
    if (action === "update") {
      if (!body.version_id || !body.patch) return Response.json({ error: "version_id and patch are required" }, { status: 400 });
      const v: any = await svc.entities.IndustryBlueprint.get(body.version_id);
      if (v.status === "active") return Response.json({ error: "Cannot edit an active version. Generate or fork a draft first." }, { status: 409 });
      const updated = await svc.entities.IndustryBlueprint.update(body.version_id, { ...body.patch, last_updated: new Date().toISOString() });
      return Response.json({ blueprint: summary(updated) });
    }
    if (action === "archive") return Response.json({ blueprint: summary(await archiveVersion(svc, body.version_id)) });
    if (action === "self-improve") {
      if (!body.industry_key) return Response.json({ error: "industry_key is required" }, { status: 400 });
      return Response.json(await selfImprove(svc, body.industry_key, actor));
    }
    if (action === "feedback") {
      if (!body.industry_key) return Response.json({ error: "industry_key is required" }, { status: 400 });
      const active = await getActiveBlueprint(svc, body.industry_key, "system");
      if (!active) return Response.json({ error: "No active blueprint for this industry." }, { status: 404 });
      const sm = active.success_metrics || {};
      sm.feedback_count = (sm.feedback_count || 0) + 1;
      if (body.rating) sm.feedback_avg = sm.feedback_avg ? Math.round(((sm.feedback_avg * (sm.feedback_count - 1)) + body.rating) / sm.feedback_count * 10) / 10 : body.rating;
      sm.feedback_notes = [...(sm.feedback_notes || []), { note: body.note || "", rating: body.rating || null, at: new Date().toISOString() }].slice(-50);
      await svc.entities.IndustryBlueprint.update(active.id, { success_metrics: sm }).catch(() => null);
      return Response.json({ recorded: true, feedback_count: sm.feedback_count });
    }
    if (action === "stats") {
      if (!body.industry_key) return Response.json({ error: "industry_key is required" }, { status: 400 });
      const active = await getActiveBlueprint(svc, body.industry_key, "system");
      const versions = await listVersions(svc, body.industry_key);
      const patterns = await applicablePatterns(svc, body.industry_key);
      const rows: any[] = await svc.entities.Business.filter({ industry_key: body.industry_key }).catch(() => []);
      return Response.json({ active: summary(active), version_count: versions.length, versions: versions.map(summary), patterns: patterns.length, detected_businesses: (rows || []).length });
    }

    // ---------- BENCHMARKS (architecture placeholder) ----------
    if (action === "upsert-benchmark") {
      if (!body.industry_key || !body.metrics) return Response.json({ error: "industry_key and metrics are required" }, { status: 400 });
      return Response.json({ benchmark: await upsertBenchmark(svc, { industry_key: body.industry_key, region: body.region, metrics: body.metrics, confidence: body.confidence }) });
    }
    if (action === "get-benchmark") {
      if (!body.industry_key) return Response.json({ error: "industry_key is required" }, { status: 400 });
      return Response.json({ benchmark: await getBenchmark(svc, body.industry_key, body.region) });
    }
    if (action === "list-benchmarks") return Response.json({ benchmarks: await listBenchmarks(svc) });

    // ---------- CROSS-INDUSTRY PATTERNS ----------
    if (action === "list-patterns") return Response.json({ patterns: await listPatterns(svc) });
    if (action === "applicable-patterns") {
      if (!body.industry_key) return Response.json({ error: "industry_key is required" }, { status: 400 });
      return Response.json({ patterns: await applicablePatterns(svc, body.industry_key) });
    }
    if (action === "suggest-patterns") {
      if (!body.industry_key) return Response.json({ error: "industry_key is required" }, { status: 400 });
      return Response.json({ patterns: await suggestPatterns(svc, body.industry_key) });
    }
    if (action === "create-pattern") return Response.json({ pattern: await createPattern(svc, { ...body, actor }, actor) });
    if (action === "apply-pattern") {
      if (!body.pattern_id) return Response.json({ error: "pattern_id is required" }, { status: 400 });
      const p: any = await svc.entities.BusinessPattern.get(body.pattern_id);
      if (!p) throw Object.assign(new Error("Pattern not found"), { code: "NOT_FOUND" });
      const apps = body.industry_key && !(p.applicable_industries || []).includes(body.industry_key) ? [...(p.applicable_industries || []), body.industry_key] : (p.applicable_industries || []);
      const updated = await svc.entities.BusinessPattern.update(body.pattern_id, { status: "active", applicable_industries: apps });
      return Response.json({ pattern: updated });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

function summary(b: any): any {
  if (!b) return null;
  return {
    id: b.id, tenant_id: b.tenant_id, industry_key: b.industry_key, industry_label: b.industry_label, category: b.category,
    version: b.version, status: b.status, ai_generated: b.ai_generated, human_verified: b.human_verified,
    last_updated: b.last_updated, quality_score: b.quality_score, usage_count: b.usage_count,
    success_metrics: b.success_metrics, business_model: b.business_model, field_count: countFields(b),
  };
}
function countFields(b: any): number {
  const keys = ["business_model", "customer_personas", "typical_services", "pricing_models", "sales_funnel", "lead_sources", "website_structure", "seo_strategy", "crm_pipeline", "email_sequences", "marketing_calendar", "kpis", "compliance_reminders", "common_automations", "typical_ai_employees", "suggested_integrations", "business_risks", "growth_strategies", "expansion_strategies"];
  return keys.reduce((n, k) => n + (b[k] && (Array.isArray(b[k]) ? b[k].length : Object.keys(b[k]).length) ? 1 : 0), 0);
}