// Real Orchestrator adapter for `generate_seo`.
//
// Reuses the pure SEO Factory pipeline stages (keywords → clusters → page_seo →
// recommendations → image_seo → content_opportunities + the deterministic
// internal-links / schema / technical / validation post-processors) but executes
// every AI call through the orchestrator's truthful provider path (runStructuredAI).
// The stage logic is UNCHANGED — only the LLM transport + provenance are truthful.
//
// SEO consumes the approved Website output THROUGH THE DAG (prior_task_outputs),
// not by independently rediscovering it. The full buildContextSnapshot() +
// prior_task_outputs reach this adapter via `context`.
//
// Records per-stage AIExecution checkpoints, supports retry/resume without
// recomputing completed stages, and writes SEOProject/SEOVersion + every child
// recommendation record with runtime-truthful provenance (the provider that
// ACTUALLY executed, never the resolved one).
//
// Returns the dispatch contract shape engine.dispatchTask already expects:
//   { status: 'completed'|'failed', output, error, last_stage, executionIds }

import {
  stageKeywords, stageClustersLocal, stageAllPageSEO, stageRecommendations,
  stageImageSEO, stageContentOpportunities, globalSchemas, deriveInternalLinks,
  buildTechnicalReport, validateSEO, type Orchestrator,
} from "../../seo/factory.ts";
import { ensureSeoPrompts } from "../../seo/prompts.ts";
import { latestPrompt } from "../../orchestration/index.ts";
import { recordExecution, hashOf } from "../adapterContract.ts";
import { runStructuredAI } from "../ai_provider.ts";
import { bus } from "../../events/bus.ts";
import type { Adapter } from "../adapters.ts";

interface ProvInfo { provider_id: string; provider_key: string; adapter_key: string; model: string }

const SEO_PROMPT_VERSION = "seo-prompts-v1";

// Map the factory stage-id (fine, per-call) → the resume-checkpoint coarse stage.
const FINE_TO_COARSE: Record<string, string> = {
  "seo.keywords": "keywords",
  "seo.clusters_local": "clusters",
  "seo.page_seo": "page_seo",
  "seo.recommendations": "recommendations",
  "seo.image_seo": "image_seo",
  "seo.content_opportunities": "content_opportunities",
};

// Minimal {{var}} renderer — mirrors orchestrate's renderTemplate so the SEO
// prompt registry templates resolve identically without depending on the KG.
function renderTemplate(tpl: string, variables: Record<string, any>): string {
  return tpl.replace(/{{\s*([\w.]+)\s*}}/g, (_, k: string) => {
    const parts = k.split(".");
    let v: any = variables;
    for (const p of parts) { v = v?.[p]; if (v == null) break; }
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  });
}

// Build the SEOGeneration capability slice from the DAG context snapshot + the
// approved Business Blueprint + the approved Website's pages. This is the exact
// shape `loadCapabilityContext('SEOGeneration', ...)` would produce from the KG,
// so the unchanged SEO prompts ("using ONLY the context provided above") work
// without a Knowledge Graph dependency.
function buildSeoSlice(business: any, blue: any, pages: any[]): any {
  const bp = (blue && blue.blueprint) || {};
  const brand = bp.branding || (business.planner_profile && business.planner_profile.branding) || {};
  const services = bp.services || [];
  const ta = bp.target_audience || {};
  const crm = bp.crm_blueprint || {};
  const sa = String(business.service_area || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const locations = sa.length ? sa : (bp.seo_blueprint && bp.seo_blueprint.location_strategy ? [bp.seo_blueprint.location_strategy] : (business.city ? [business.city] : []));
  return {
    business: {
      name: business.name, industry: business.industry, country: business.country, city: business.city,
      service_area: business.service_area, target_customers: business.target_customers,
      services_products: business.services_products || [], description: business.description || "",
    },
    brand, services,
    pages: pages.map((p) => ({ slug: p.slug, title: p.title, template: p.template, intent: p.seo_intent || p.purpose || "", purpose: p.purpose || "", primary_cta: p.primary_cta || "" })),
    locations, target_audience: ta,
    pipeline_stages: crm.lead_stages || [],
    lead_sources: crm.lead_sources || [],
    owner_roles: [],
  };
}

export function createSeoAdapter(): Adapter {
  return async (input) => {
    const { svc, run, task, context, resolvedProvider, actor } = input as any;
    const base44 = (svc && svc.__base44) || svc;
    const attempt = task.attempt || 1;
    const t0 = Date.now();
    const execIds: string[] = [];
    const stageProviders: Record<string, ProvInfo> = {};
    const callProviders: Record<string, ProvInfo> = {};
    const metas: any[] = [];

    // Resume-from-checkpoint: stages whose AIExecution already succeeded.
    const doneRows = await svc.entities.AIExecution.filter({ task_id: task.id, success: true }).catch(() => []);
    const done = new Set((doneRows || []).map((e: any) => e.stage));
    // Restore runtime-truthful provider info for AI stages already checkpointed on a
    // prior attempt, so the persisted version's primary provenance + stage_providers
    // reflect the actual runtime executor even when an AI stage is skipped on resume.
    const AI_STAGES = ["keywords", "clusters", "page_seo", "recommendations", "image_seo", "content_opportunities"];
    for (const e of (doneRows || [])) {
      if (AI_STAGES.includes(e.stage) && e.success && e.provider) {
        stageProviders[e.stage] = { provider_id: e.provider_id, provider_key: e.provider, adapter_key: e.adapter_key, model: e.model };
      }
    }
    const ckptOf = async (stage: string): Promise<any | null> => {
      const rows = (doneRows || []).filter((e: any) => e.stage === stage).sort((a: any, b: any) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
      if (!rows.length) return null;
      const out = rows[0].output || null;
      // Stage functions return { data, meta }; the checkpoint stores the `.data` payload.
      // Unwrap any legacy checkpoint that stored the whole {data,meta} wrapper.
      if (out && out.data != null && out.meta != null) return out.data;
      return out;
    };

    const providerRef = (stage: string): any => {
      const p = stageProviders[stage] || ({} as ProvInfo);
      return {
        provider_id: p.provider_id || resolvedProvider?.provider_id || "",
        provider_key: p.provider_key || resolvedProvider?.key || resolvedProvider?.provider_key || "",
        adapter_key: p.adapter_key || resolvedProvider?.adapter_key || "",
        name: p.provider_key || resolvedProvider?.name || "",
        category: "", via: resolvedProvider?.via || "",
      };
    };
    const modelOf = (stage: string) => (stageProviders[stage] || ({} as ProvInfo)).model || "";

    const checkpoint = async (stage: string, success: boolean, output: any, durationMs: number, errorCode = "", errorMessage = "", retryable = false) => {
      const outObj: any = output == null ? {} : (Array.isArray(output) ? { items: output, count: output.length } : (typeof output === "object" ? output : { value: output }));
      const id = await recordExecution(svc, {
        run, task, attempt, stage, operation: `generate_seo.${stage}`,
        capability: task.provider_capability || "ai_generation",
        provider: providerRef(stage), model: modelOf(stage),
        inputHash: task.input_hash, outputHash: hashOf(outObj),
        success, errorCode, errorMessage, retryable, durationMs, actor, output: outObj,
      });
      execIds.push(id);
    };

    const failed = (code: string, message: string, lastStage: string, retryable = true) => ({
      status: "failed" as const, output: null,
      error: { code, message, retryable }, last_stage: lastStage, executionIds: execIds, provider: resolvedProvider,
    });

    // --- Load approved blueprint (single source of truth), like the website adapter. ---
    const blue: any = await (async () => {
      const ctxBp = context?.business?.approved_blueprint;
      if (ctxBp && ctxBp.id) { try { return await svc.entities.BusinessBlueprint.get(ctxBp.id); } catch {} }
      const all = await svc.entities.BusinessBlueprint.filter({ business_id: run.business_id });
      return (all || []).filter((x: any) => x.status === "approved").sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0] || null;
    })();
    if (!blue) {
      await checkpoint("keywords", false, null, 0, "VALIDATION_FAILED", "No approved Business Blueprint yet — approve a blueprint first.", false);
      return failed("VALIDATION_FAILED", "No approved Business Blueprint yet — approve a blueprint first.", "keywords", false);
    }

    // --- Consume the approved Website output THROUGH THE DAG (prior_task_outputs). ---
    const websiteOut = (context?.prior_task_outputs && context.prior_task_outputs["website"]) || null;
    let websiteId = websiteOut?.website_id || null;
    let websiteVersion = websiteOut?.version || null;
    let website: any = null;
    if (websiteId) { try { website = await svc.entities.Website.get(websiteId); } catch {} }
    if (!website) {
      // Fallback: most recent Website for this business (draft or published).
      const all = await svc.entities.Website.filter({ business_id: run.business_id }).catch(() => []);
      website = (all || []).sort((a: any, b: any) => (b.version || 0) - (a.version || 0))[0] || null;
      websiteId = website?.id || null; websiteVersion = website?.version || null;
    }
    if (!website) {
      await checkpoint("keywords", false, null, 0, "VALIDATION_FAILED", "No Website output found in the DAG — generate + approve the website first.", false);
      return failed("VALIDATION_FAILED", "No Website output found in the DAG — generate + approve the website first.", "keywords", false);
    }

    // --- The pages SEO operates on — read from the approved website draft. ---
    const pageRows = await svc.entities.WebsitePage.filter({ website_id: website.id }).catch(() => []);
    const pages = (pageRows || []).map((p: any) => ({ slug: p.slug, title: p.title, template: p.template, purpose: p.purpose, seo_intent: p.seo_intent, primary_cta: p.primary_cta }));
    if (!pages.length) {
      await checkpoint("keywords", false, null, 0, "VALIDATION_FAILED", "The approved Website has no pages — cannot run SEO.", false);
      return failed("VALIDATION_FAILED", "The approved Website has no pages — cannot run SEO.", "keywords", false);
    }

    // --- Seed the SEO Prompt Registry for this tenant (idempotent). ---
    await ensureSeoPrompts(svc, run.tenant_id);

    const business: any = await svc.entities.Business.get(run.business_id);
    const ctxSlice = buildSeoSlice(business || { id: run.business_id, name: website.name || run.business_id, industry: "", country: "", city: "", service_area: "", target_customers: "", services_products: [], description: "" }, blue, pages);
    const brandName = (ctxSlice.brand && ctxSlice.brand.name) || business?.name || "";

    // --- Truthful Orchestrator transport: render registered prompt + slice, run via executeAIChat. ---
    const orch: Orchestrator = async (req) => {
      const coarse = FINE_TO_COARSE[req.stage] || req.stage;
      const prompt = await latestPrompt(svc, req.promptId, run.tenant_id);
      if (!prompt) throw new Error(`No active prompt for ${req.promptId}`);
      const rendered = renderTemplate(prompt.content, req.variables || {});
      const finalPrompt = `## BUSINESS KNOWLEDGE GRAPH CONTEXT (read-only, single source of truth)\n${JSON.stringify(ctxSlice)}\n\n## TASK\n${rendered}`;
      const r = await runStructuredAI(base44, svc, { tenantId: run.tenant_id, businessId: run.business_id, prompt: finalPrompt, schema: req.schema, stage: req.stage });
      const info: ProvInfo = { provider_id: r.provider_id, provider_key: r.provider_key, adapter_key: r.adapter_key, model: r.model };
      stageProviders[coarse] = info;
      callProviders[req.stage] = info;
      const meta = { ok: r.ok, stage: req.stage, promptId: prompt.prompt_id, promptVersion: prompt.version, provider: r.provider_key, model: r.model, fallback_used: r.fallback_used, latencyMs: r.latency_ms };
      metas.push(meta);
      if (!r.ok || r.data == null) throw new Error(r.error_message || `${req.stage} AI stage failed`);
      return { data: r.data, meta };
    };

    const runStage = async (coarse: string, fn: () => Promise<any>) => {
      if (done.has(coarse)) return await ckptOf(coarse);
      const t = Date.now();
      try {
        // SEO stage functions return { data, meta } — checkpoint + return the `.data` payload.
        const res: any = await fn();
        const payload = res && res.data != null && res.meta != null ? res.data : res;
        await checkpoint(coarse, true, payload, Date.now() - t);
        return payload;
      }
      catch (e: any) { await checkpoint(coarse, false, { error: e.message }, Date.now() - t, "FACTORY_FAILED", e.message, true); throw e; }
    };

    // --- Stage: keywords ---
    let kwData: any;
    try { kwData = await runStage("keywords", () => stageKeywords(orch)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "keywords"); }

    // --- Stage: clusters ---
    let clusterData: any;
    try { clusterData = await runStage("clusters", () => stageClustersLocal(orch)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "clusters"); }

    // --- Stage: page_seo (batched internally by the factory stage) ---
    let pageSeoData: any;
    try { pageSeoData = await runStage("page_seo", () => stageAllPageSEO(orch, pages, brandName)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "page_seo"); }

    // --- Deterministic post-processing (recomputed every attempt from page_seo). ---
    const slugSet = new Set(pages.map((p) => p.slug));
    const pageSeo: Record<string, any> = {};
    const aiPages = (pageSeoData && pageSeoData.pages) || [];
    const fallbackCount = aiPages.filter((p) => p._fallback).length;
    aiPages.forEach((ps, i) => {
      ps.internal_links = (ps.internal_links || []).filter((l) => slugSet.has(l.slug));
      ps.related_pages = (ps.related_pages || []).filter((s) => slugSet.has(s));
      ps.breadcrumb = (ps.breadcrumb || []).filter((s) => slugSet.has(s) || s === pages[i].slug);
      pageSeo[pages[i].slug] = { ...ps, slug: pages[i].slug, title: pages[i].title, template: pages[i].template };
    });

    const globalCtx = { business: ctxSlice.business, blueprint: blue.blueprint, locations: ctxSlice.locations };
    const schemaDocs: any[] = globalSchemas(globalCtx, (clusterData.location_pages || []).length > 0);
    pages.forEach((p) => {
      const ps = pageSeo[p.slug];
      (ps.schemas || []).forEach((st) => {
        const base = { "@context": "https://schema.org", "@type": st };
        const merged = (ps.structured_data && ps.structured_data["@type"] === st) ? ps.structured_data : base;
        schemaDocs.push({ schema_type: st, schema_data: merged, relevance: `Page-level ${st} schema.`, applied: false, priority: 80, scope: "page", page_slug: p.slug });
      });
    });
    const internalLinks = deriveInternalLinks(pageSeo, pages);
    const technical = buildTechnicalReport(pages, pageSeo, internalLinks);
    const validation = validateSEO(pages, pageSeo, kwData.keywords, internalLinks, schemaDocs);
    const dt = Date.now() - t0;
    await checkpoint("validation", true, { status: validation.status, summary: validation.summary }, dt);
    try { await bus.dispatch("SEOValidated", { tenantId: run.tenant_id, businessId: run.business_id, actor, payload: { module: "seo", status: validation.status, healthScore: validation.summary.health_score } }); } catch {}

    // --- Stage: recommendations (consumes validation) ---
    let recsData: any;
    try { recsData = await runStage("recommendations", () => stageRecommendations(orch, pages, kwData.keywords, clusterData.clusters, validation)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "recommendations"); }
    let recs = recsData.recommendations || [];
    if ((validation.summary.errors || 0) > 0) recs.unshift({ title: `Fix ${validation.summary.errors} SEO error(s)`, description: "Resolve validation errors (cannibalization, broken links, duplicate metadata, missing keywords).", category: "technical", priority: "urgent", estimated_impact: "high", estimated_difficulty: "medium", page_slug: "" });

    // --- Stage: image_seo ---
    let imageSeoData: any;
    try { imageSeoData = await runStage("image_seo", () => stageImageSEO(orch, pages)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "image_seo"); }

    // --- Stage: content_opportunities ---
    let contentOppsData: any;
    try { contentOppsData = await runStage("content_opportunities", () => stageContentOpportunities(orch, pages, kwData.keywords, clusterData.clusters)); }
    catch (e: any) { return failed("FACTORY_FAILED", e.message, "content_opportunities"); }

    // --- Truthful provenance for every persisted record. ---
    const stageOrder = ["keywords", "clusters", "page_seo", "recommendations", "image_seo", "content_opportunities"];
    const primary = stageProviders["keywords"] || ({} as ProvInfo);
    const providerKeys = [...new Set(stageOrder.map((s) => stageProviders[s]?.provider_key).filter(Boolean))];
    const models = [...new Set(stageOrder.map((s) => stageProviders[s]?.model).filter(Boolean))];
    const llmCalls = metas.length;
    const seoProvenance = {
      ai_provider: primary.provider_key || resolvedProvider?.key || "base44-core",
      ai_model: models.join(", ") || primary.model || "",
      prompt_version: SEO_PROMPT_VERSION,
      provider_id: primary.provider_id || resolvedProvider?.provider_id || "",
      adapter_key: primary.adapter_key || resolvedProvider?.adapter_key || "",
      run_id: run.id, task_id: task.id, attempt,
      generation_status: "complete",
      fallback_used: providerKeys.length > 1 || (providerKeys[0] && resolvedProvider && providerKeys[0] !== (resolvedProvider.key || resolvedProvider.provider_key)),
      stage_providers: Object.fromEntries(stageOrder.map((s) => [s, stageProviders[s] || {}])),
      generation_time_ms: Date.now() - t0,
      token_usage: { llm_calls: llmCalls, estimated_tokens: llmCalls * 1500, is_estimated: true },
      validation_status: validation.status,
    };

    // --- Persist: SEOProject + SEOVersion + every child record (single implementation
    //     shared-shape with the HTTP SEO Factory; provenance is runtime-truthful here). ---
    let project: any = (await svc.entities.SEOProject.filter({ business_id: run.business_id, website_id: website.id }).catch(() => []))[0] || null;
    if (!project) {
      project = await svc.entities.SEOProject.create({
        tenant_id: run.tenant_id, business_id: run.business_id, blueprint_id: blue.id, blueprint_version: blue.version,
        website_id: website.id, website_version: websiteVersion, name: `${business?.name || run.business_id} SEO`, status: "active",
      });
    }
    const allVersions = await svc.entities.SEOVersion.filter({ seo_project_id: project.id }).catch(() => []);
    const version = (allVersions || []).reduce((m, r) => Math.max(m, r.version || 0), 0) + 1;
    const versionRec: any = await svc.entities.SEOVersion.create({
      tenant_id: run.tenant_id, business_id: run.business_id, seo_project_id: project.id, website_id: website.id, website_version: websiteVersion,
      blueprint_id: blue.id, blueprint_version: blue.version, version, status: "draft",
      health_score: validation.summary.health_score, page_seo: pageSeo,
      keyword_count: kwData.keywords.length, cluster_count: clusterData.clusters.length, schema_count: schemaDocs.length,
      internal_link_count: internalLinks.length, recommendation_count: recs.length, validation_status: validation.status,
      summary: {
        types: {
          primary: (kwData.primary || []).length, secondary: (kwData.secondary || []).length, long_tail: (kwData.long_tail || []).length,
          question: (kwData.question || []).length, commercial: (kwData.commercial || []).length, local: (kwData.local || []).length, competitor: (kwData.competitor || []).length,
        },
        location_pages: clusterData.location_pages || [], location_pages_count: (clusterData.location_pages || []).length,
        fallback_pages: fallbackCount, technical_summary: technical.summary, validation_summary: validation.summary,
        image_seo_count: (imageSeoData.images || []).length, content_opportunity_count: (contentOppsData.opportunities || []).length,
      },
      generated_by: actor, generated_at: new Date().toISOString(), provenance: seoProvenance,
    });
    try { await bus.dispatch("SEOGenerated", { tenantId: run.tenant_id, businessId: run.business_id, actor, payload: { module: "seo", versionId: versionRec.id, version, keywords: kwData.keywords.length, contentOpportunities: (contentOppsData.opportunities || []).length, health: validation.summary.health_score } }); } catch {}

    if (kwData.keywords.length) await svc.entities.Keyword.bulkCreate(kwData.keywords.map((k) => ({ tenant_id: run.tenant_id, business_id: run.business_id, seo_project_id: project.id, seo_version_id: versionRec.id, keyword: k.keyword, type: k.type, search_intent: k.search_intent, keyword_difficulty: k.keyword_difficulty, priority: k.priority, volume: k.volume, cluster: k.cluster, page_slug: k.page_slug, rationale: k.rationale })));
    if (clusterData.clusters.length) await svc.entities.KeywordCluster.bulkCreate(clusterData.clusters.map((c) => ({ tenant_id: run.tenant_id, business_id: run.business_id, seo_project_id: project.id, seo_version_id: versionRec.id, topic: c.topic, pillar_keyword: c.pillar_keyword, description: c.description, supporting_pages: c.supporting_pages || [], blog_topics: c.blog_topics || [], internal_links: c.internal_links || [], priority: c.priority || 50, provenance: seoProvenance })));
    if (schemaDocs.length) await svc.entities.SchemaDefinition.bulkCreate(schemaDocs.map((s) => ({ tenant_id: run.tenant_id, business_id: run.business_id, seo_project_id: project.id, seo_version_id: versionRec.id, page_id: null, page_slug: s.page_slug || "", scope: s.scope || "page", schema_type: s.schema_type, schema_data: s.schema_data, relevance: s.relevance, applied: false, priority: s.priority || 50, provenance: seoProvenance })));
    if (internalLinks.length) await svc.entities.InternalLink.bulkCreate(internalLinks.map((l) => ({ tenant_id: run.tenant_id, business_id: run.business_id, seo_project_id: project.id, seo_version_id: versionRec.id, source_page_id: null, source_page_slug: l.source_page_slug, target_page_id: null, target_page_slug: l.target_page_slug, anchor_text: l.anchor_text, link_type: l.link_type, status: l.status, priority: l.priority || 50, provenance: seoProvenance })));
    if (recs.length) await svc.entities.SEORecommendation.bulkCreate(recs.map((r) => ({ tenant_id: run.tenant_id, business_id: run.business_id, seo_project_id: project.id, seo_version_id: versionRec.id, title: r.title, description: r.description || "", category: r.category, priority: r.priority, estimated_impact: r.estimated_impact || "medium", estimated_difficulty: r.estimated_difficulty || "medium", page_slug: r.page_slug || "", status: "pending", provenance: seoProvenance })));
    if ((imageSeoData.images || []).length) await svc.entities.ImageSEO.bulkCreate(imageSeoData.images.map((i) => ({ tenant_id: run.tenant_id, business_id: run.business_id, seo_project_id: project.id, seo_version_id: versionRec.id, page_slug: i.page_slug, original_ref: i.original_ref || "", alt_text: i.alt_text, title: i.title || "", caption: i.caption || "", filename: i.filename, compression: i.compression || "webp", priority: i.priority ?? 50, provenance: seoProvenance })));
    if ((contentOppsData.opportunities || []).length) await svc.entities.ContentOpportunity.bulkCreate(contentOppsData.opportunities.map((o) => ({ tenant_id: run.tenant_id, business_id: run.business_id, seo_project_id: project.id, seo_version_id: versionRec.id, type: o.type, title: o.title, slug: o.slug, keyword: o.keyword, intent: o.intent || "informational", description: o.description || "", target_cluster: o.target_cluster || "", priority: o.priority ?? 50, provenance: seoProvenance })));
    await svc.entities.TechnicalSEOReport.create({ tenant_id: run.tenant_id, business_id: run.business_id, seo_project_id: project.id, seo_version_id: versionRec.id, sitemap: technical.sitemap, robots_txt: technical.robots_txt, canonical_issues: technical.canonical_issues, redirects: technical.redirects, duplicate_titles: technical.duplicate_titles, duplicate_descriptions: technical.duplicate_descriptions, broken_links: technical.broken_links, missing_h1: technical.missing_h1, accessibility: technical.accessibility, page_speed: technical.page_speed, core_web_vitals: technical.core_web_vitals, summary: technical.summary, provenance: seoProvenance });
    await svc.entities.SEOValidation.create({ tenant_id: run.tenant_id, business_id: run.business_id, seo_project_id: project.id, seo_version_id: versionRec.id, status: validation.status, checks: validation.checks, summary: validation.summary, provenance: seoProvenance });
    await svc.entities.SEOProject.update(project.id, { current_version: version, health_score: validation.summary.health_score, active_seo_version_id: null });

    return {
      status: "completed" as const,
      output: { seo_version_id: versionRec.id, version, website_id: website.id, keyword_count: kwData.keywords.length, cluster_count: clusterData.clusters.length, schema_count: schemaDocs.length, internal_link_count: internalLinks.length, recommendation_count: recs.length, content_opportunity_count: (contentOppsData.opportunities || []).length, health_score: validation.summary.health_score, validation_status: validation.status, ai_provider: primary.provider_key, provider_id: primary.provider_id, adapter_key: primary.adapter_key },
      last_stage: "validation",
      executionIds: execIds,
      provider: resolvedProvider,
    };
  };
}