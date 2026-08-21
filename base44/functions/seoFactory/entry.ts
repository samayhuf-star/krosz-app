import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  stageKeywords, stageClustersLocal, stageAllPageSEO, globalSchemas,
  deriveInternalLinks, buildTechnicalReport, validateSEO, stageRecommendations,
  stageImageSEO, stageContentOpportunities, provenance, type Orchestrator,
} from '../../shared/seo/factory.ts';
import { ensureSeoPrompts } from '../../shared/seo/prompts.ts';
import { createModuleEngine, isModuleEnabled, bus, orchestrate, getBusinessContext, getGraph, type PlatformEventType } from '../../shared/sdk/index.ts';

// AI SEO Factory (Knowledge Graph Edition). Consumes ONLY the Business Knowledge
// Graph. All AI execution flows through the Orchestration Engine (prompt registry +
// KG context + validation + telemetry + cache). Produces recommendation records the
// Website Factory can apply later — it never edits the Website. Version lifecycle is
// owned by the shared Version Engine; events: SEOGenerated, SEOValidated, SEOPublished.

const seoEngine = createModuleEngine({
  name: 'seo', versionEntity: 'SEOVersion', projectIdField: 'seo_project_id',
  publishedEventType: 'SEOPublished' as PlatformEventType,
});

const actorName = (u: any) => (u && (u.full_name || u.email)) || (u && u.id) || 'system';

// Bound orchestrator — pre-fills tenant/business/module/actor; stashes per-stage telemetry.
function makeOrchestrator(base44: any, tenant_id: string, businessId: string, actor: string): { orch: Orchestrator; metas: any[] } {
  const metas: any[] = [];
  // Every orchestrate call reloads the Business Knowledge Graph context (entity reads)
  // even on cache hits. Sequential-but-bursty calls (esp. all-cache-hit re-runs) can
  // trip the entity-API rate limit, so space every call with a short pause.
  const orch: Orchestrator = async (req) => {
    await new Promise((r) => setTimeout(r, 500));
    const res = await orchestrate(base44, {
      capability: req.capability, moduleId: 'seo', promptId: req.promptId,
      businessId, tenantId: tenant_id, actor,
      schema: req.schema, stage: req.stage, variables: req.variables || {},
    });
    const meta = { ok: res.ok, stage: req.stage, promptId: res.promptId, promptVersion: res.promptVersion, kgVersion: res.kgVersion, provider: res.provider, model: res.model, fallbackUsed: res.fallbackUsed, retryCount: res.retryCount, latencyMs: res.latencyMs, estimatedCost: res.estimatedCost, validationStatus: res.validationStatus, cacheHit: res.cacheHit, error: res.error };
    metas.push(meta);
    if (!res.ok || res.data == null) throw new Error(res.error || `AI stage ${req.stage} failed`);
    return { data: res.data, meta };
  };
  return { orch, metas };
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const businessId = body.business_id;

    const assembleActive = async (project: any) => {
      const versions = (await base44.entities.SEOVersion.filter({ seo_project_id: project.id })).sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
      const active = versions.find((v: any) => v.status === 'published') || versions.find((v: any) => v.status === 'approved') || versions[0] || null;
      if (!active) return { project, versions, active: null };
      const [keywords, clusters, schemas, links, recs, imageSeo, contentOpps] = await Promise.all([
        base44.entities.Keyword.filter({ seo_version_id: active.id }),
        base44.entities.KeywordCluster.filter({ seo_version_id: active.id }),
        base44.entities.SchemaDefinition.filter({ seo_version_id: active.id }),
        base44.entities.InternalLink.filter({ seo_version_id: active.id }),
        base44.entities.SEORecommendation.filter({ seo_version_id: active.id }),
        base44.entities.ImageSEO.filter({ seo_version_id: active.id }),
        base44.entities.ContentOpportunity.filter({ seo_version_id: active.id }),
      ]);
      const [tech] = (await base44.entities.TechnicalSEOReport.filter({ seo_version_id: active.id }));
      const [val] = (await base44.entities.SEOValidation.filter({ seo_version_id: active.id }));
      return { project, versions, active: { version: active, keywords, clusters, schemas, links, recommendations: recs, technical: tech, validation: val, imageSeo, contentOpps } };
    };

    // ---------- STATUS (upstream visibility comes ONLY from the Knowledge Graph) ----------
    if (action === 'status') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const business: any = await base44.entities.Business.get(businessId);
      await getBusinessContext(svc, businessId); // self-heal if stale
      const graph: any = await getGraph(svc, businessId);
      const ctx = graph?.context_snapshot || null;
      const sv = graph?.source_versions || {};
      const cov = graph?.module_coverage || {};
      const projects = (await base44.entities.SEOProject.filter({ business_id: businessId })).sort((a: any, b: any) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
      const project = projects[0] || null;
      let payload: any = {
        business: { id: business.id, name: business.name },
        blueprint: sv.blueprint_id && cov.blueprint?.status === 'approved' ? { id: sv.blueprint_id, version: sv.blueprint_version } : null,
        website: sv.website_id && cov.website?.status === 'published' ? { id: sv.website_id, version: sv.website_version, status: 'published', page_count: cov.website.page_count } : (sv.website_id ? { id: sv.website_id, version: sv.website_version, status: cov.website?.status || 'draft', page_count: cov.website?.page_count || 0 } : null),
        crm: sv.crm_version_id && cov.crm?.status === 'published' ? { id: sv.crm_version_id, version: sv.crm_version, health: cov.crm.health_score } : null,
        project, versions: null, active: null,
        kg_version: graph?.version ?? null,
      };
      if (project) {
        const a = await assembleActive(project);
        payload.versions = a.versions.map((v: any) => ({ id: v.id, version: v.version, status: v.status, health_score: v.health_score, validation_status: v.validation_status, approved_at: v.approved_at, published_at: v.published_at }));
        payload.active = a.active ? {
          version: a.active.version, keywords: a.active.keywords, clusters: a.active.clusters, schemas: a.active.schemas, links: a.active.links,
          recommendations: a.active.recommendations, technical: a.active.technical, validation: a.active.validation, imageSeo: a.active.imageSeo, contentOpps: a.active.contentOpps,
        } : null;
      }
      return Response.json(payload);
    }

    // ---------- GENERATE ----------
    if (action === 'generate') {
      if (!businessId) return Response.json({ error: 'business_id is required' }, { status: 400 });
      const business: any = await base44.entities.Business.get(businessId);
      // The ONLY upstream read surface — the Business Knowledge Graph.
      await getBusinessContext(svc, businessId); // self-heal: rebuild if upstream advanced
      const graph: any = await getGraph(svc, businessId);
      const ctx: any = graph?.context_snapshot || null;
      if (!ctx) return Response.json({ error: 'Knowledge Graph not available. Rebuild it from the Knowledge Graph page first.' }, { status: 404 });
      const sv = graph?.source_versions || {};
      const cov = graph?.module_coverage || {};
      if (!sv.blueprint_id || cov.blueprint?.status !== 'approved') return Response.json({ error: 'No approved Business Blueprint in the Knowledge Graph. Approve a blueprint first.' }, { status: 404 });
      if (!sv.website_id || cov.website?.status !== 'published') return Response.json({ error: 'No published Website in the Knowledge Graph. Publish a website first.' }, { status: 404 });
      if (!sv.crm_version_id || cov.crm?.status !== 'published') return Response.json({ error: 'No published CRM in the Knowledge Graph. Publish a CRM first.' }, { status: 404 });
      const seoEnabled = await isModuleEnabled(svc, 'seo', businessId);
      if (!seoEnabled) return Response.json({ error: 'SEO module is disabled for this workspace.' }, { status: 403 });

      const pages = ctx.pages || [];
      if (!pages.length) return Response.json({ error: 'No published pages found in the Knowledge Graph.' }, { status: 404 });

      // Seed the Prompt Registry entries for this tenant (idempotent).
      await ensureSeoPrompts(svc, business.tenant_id);

      const t0 = Date.now();
      const { orch, metas } = makeOrchestrator(base44, business.tenant_id, businessId, actorName(user));

      // Stage 1 — Keyword Intelligence (consumes pipeline_stages + lead_sources from KG)
      const kwResult = await stageKeywords(orch);

      // Stages 2-3 + 7 — Clusters + Local SEO
      const clusterResult = await stageClustersLocal(orch);

      // Stage 4 + 5 — Metadata + Schema for ALL pages in ONE orchestrated call
      // (intent, schema, internal-link suggestions per page). One call keeps the
      // Knowledge Graph reload cost bounded instead of fanning out per page.
      const brandName = ctx.brand?.name || business.name;
      const pageSeoResult = await stageAllPageSEO(orch, pages, brandName);
      const slugSet = new Set(pages.map((p: any) => p.slug));
      const pageSeo: Record<string, any> = {};
      const aiPages = pageSeoResult.data.pages || [];
      const fallbackCount = aiPages.filter((p: any) => p._fallback).length;
      aiPages.forEach((ps: any, i: number) => {
        ps.internal_links = (ps.internal_links || []).filter((l: any) => slugSet.has(l.slug));
        ps.related_pages = (ps.related_pages || []).filter((s: string) => slugSet.has(s));
        ps.breadcrumb = (ps.breadcrumb || []).filter((s: string) => slugSet.has(s) || s === pages[i].slug);
        pageSeo[pages[i].slug] = { ...ps, slug: pages[i].slug, title: pages[i].title, template: pages[i].template };
      });

      // Stage 6 — Internal Linking (deterministic, from page SEO)
      const internalLinks = deriveInternalLinks(pageSeo, pages);

      // Stage 5 (global) — Organization + LocalBusiness schema (deterministic)
      const schemaDocs: any[] = globalSchemas(ctx, (clusterResult.data.location_pages || []).length > 0);
      // Per-page schema docs from the AI's `schemas` + `structured_data` fields.
      pages.forEach((p: any) => {
        const ps = pageSeo[p.slug];
        (ps.schemas || []).forEach((st: string) => {
          const base = { '@context': 'https://schema.org', '@type': st };
          const merged = (ps.structured_data && ps.structured_data['@type'] === st) ? ps.structured_data : base;
          schemaDocs.push({ schema_type: st, schema_data: merged, relevance: `Page-level ${st} schema.`, applied: false, priority: 80, scope: 'page', page_slug: p.slug });
        });
      });

      // Stage 8 — Technical SEO (deterministic)
      const technical = buildTechnicalReport(pages, pageSeo, internalLinks);

      // Stage 9 — Validation (deterministic)
      const validation = validateSEO(pages, pageSeo, kwResult.data.keywords, internalLinks, schemaDocs);
      await bus.dispatch('SEOValidated', { tenantId: business.tenant_id, businessId, actor: actorName(user), payload: { module: 'seo', status: validation.status, healthScore: validation.summary.health_score } });

      // Recommendation backlog (AI) — seeded with validation failures
      const recsResult = await stageRecommendations(orch, pages, kwResult.data.keywords, clusterResult.data.clusters, validation);
      const recs = recsResult.data.recommendations || [];
      if ((validation.summary.errors || 0) > 0) recs.unshift({ title: `Fix ${validation.summary.errors} SEO error(s)`, description: 'Resolve validation errors (cannibalization, broken links, duplicate metadata, missing keywords).', category: 'technical', priority: 'urgent', estimated_impact: 'high', estimated_difficulty: 'medium', page_slug: '' });

      // Image SEO (AI)
      const imageSeo = await stageImageSEO(orch, pages);

      // Content Opportunities (AI)
      const contentOpps = await stageContentOpportunities(orch, pages, kwResult.data.keywords, clusterResult.data.clusters);

      // Persist the SEOVersion first (page_seo embedded), then the child recommendation records.
      let project = (await base44.entities.SEOProject.filter({ business_id: businessId, website_id: sv.website_id }))[0] as any;
      if (!project) {
        project = await base44.entities.SEOProject.create({
          tenant_id: business.tenant_id, business_id: businessId, blueprint_id: sv.blueprint_id, blueprint_version: sv.blueprint_version,
          website_id: sv.website_id, website_version: sv.website_version, name: `${business.name} SEO`, status: 'active',
        });
      }
      const allVersions = await base44.entities.SEOVersion.filter({ seo_project_id: project.id });
      const version = (allVersions.reduce((m: number, r: any) => Math.max(m, r.version || 0), 0)) + 1;

      const versionRec: any = await base44.entities.SEOVersion.create({
        tenant_id: business.tenant_id, business_id: businessId, seo_project_id: project.id, website_id: sv.website_id, website_version: sv.website_version,
        blueprint_id: sv.blueprint_id, blueprint_version: sv.blueprint_version, version, status: 'draft',
        health_score: validation.summary.health_score, page_seo: pageSeo,
        keyword_count: kwResult.data.keywords.length, cluster_count: clusterResult.data.clusters.length, schema_count: schemaDocs.length,
        internal_link_count: internalLinks.length, recommendation_count: recs.length, validation_status: validation.status,
        summary: {
          types: { primary: kwResult.data.primary?.length || 0, secondary: kwResult.data.secondary?.length || 0, long_tail: kwResult.data.long_tail?.length || 0, question: kwResult.data.question?.length || 0, commercial: kwResult.data.commercial?.length || 0, local: kwResult.data.local?.length || 0, competitor: kwResult.data.competitor?.length || 0 },
          location_pages: clusterResult.data.location_pages || [], location_pages_count: (clusterResult.data.location_pages || []).length,
          fallback_pages: fallbackCount,
          technical_summary: technical.summary, validation_summary: validation.summary,
          image_seo_count: imageSeo.data.images.length, content_opportunity_count: contentOpps.data.opportunities.length,
          crm_version: sv.crm_version, kg_version: metas[0]?.kgVersion,
        },
        generated_by: actorName(user), generated_at: new Date().toISOString(),
        provenance: provenance(t0, metas, 'complete'),
      });

      await bus.dispatch('SEOGenerated', { tenantId: business.tenant_id, businessId, actor: actorName(user), payload: { module: 'seo', versionId: versionRec.id, version, keywords: kwResult.data.keywords.length, contentOpportunities: contentOpps.data.opportunities.length, health: validation.summary.health_score } });

      if (kwResult.data.keywords.length) await base44.entities.Keyword.bulkCreate(kwResult.data.keywords.map((k: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, seo_project_id: project.id, seo_version_id: versionRec.id,
        keyword: k.keyword, type: k.type, search_intent: k.search_intent, keyword_difficulty: k.keyword_difficulty, priority: k.priority, volume: k.volume, cluster: k.cluster, page_slug: k.page_slug, rationale: k.rationale,
      })));
      if (clusterResult.data.clusters.length) await base44.entities.KeywordCluster.bulkCreate(clusterResult.data.clusters.map((c: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, seo_project_id: project.id, seo_version_id: versionRec.id,
        topic: c.topic, pillar_keyword: c.pillar_keyword, description: c.description, supporting_pages: c.supporting_pages || [], blog_topics: c.blog_topics || [], internal_links: c.internal_links || [], priority: c.priority || 50,
        provenance: provenance(t0, metas, 'complete'),
      })));
      if (schemaDocs.length) await base44.entities.SchemaDefinition.bulkCreate(schemaDocs.map((s: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, seo_project_id: project.id, seo_version_id: versionRec.id,
        page_id: null, page_slug: s.page_slug || '', scope: s.scope || 'page', schema_type: s.schema_type, schema_data: s.schema_data, relevance: s.relevance, applied: false, priority: s.priority || 50,
        provenance: provenance(t0, metas, 'complete'),
      })));
      if (internalLinks.length) await base44.entities.InternalLink.bulkCreate(internalLinks.map((l: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, seo_project_id: project.id, seo_version_id: versionRec.id,
        source_page_id: null, source_page_slug: l.source_page_slug, target_page_id: null, target_page_slug: l.target_page_slug, anchor_text: l.anchor_text, link_type: l.link_type, status: l.status, priority: l.priority || 50,
        provenance: provenance(t0, metas, 'complete'),
      })));
      if (recs.length) await base44.entities.SEORecommendation.bulkCreate(recs.map((r: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, seo_project_id: project.id, seo_version_id: versionRec.id,
        title: r.title, description: r.description || '', category: r.category, priority: r.priority, estimated_impact: r.estimated_impact || 'medium', estimated_difficulty: r.estimated_difficulty || 'medium', page_slug: r.page_slug || '', status: 'pending',
        provenance: provenance(t0, metas, 'complete'),
      })));
      if (imageSeo.data.images.length) await base44.entities.ImageSEO.bulkCreate(imageSeo.data.images.map((i: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, seo_project_id: project.id, seo_version_id: versionRec.id,
        page_slug: i.page_slug, original_ref: i.original_ref || '', alt_text: i.alt_text, title: i.title || '', caption: i.caption || '', filename: i.filename, compression: i.compression || 'webp', priority: i.priority ?? 50,
        provenance: provenance(t0, metas, 'complete'),
      })));
      if (contentOpps.data.opportunities.length) await base44.entities.ContentOpportunity.bulkCreate(contentOpps.data.opportunities.map((o: any) => ({
        tenant_id: business.tenant_id, business_id: businessId, seo_project_id: project.id, seo_version_id: versionRec.id,
        type: o.type, title: o.title, slug: o.slug, keyword: o.keyword, intent: o.intent || 'informational', description: o.description || '', target_cluster: o.target_cluster || '', priority: o.priority ?? 50,
        provenance: provenance(t0, metas, 'complete'),
      })));

      await base44.entities.TechnicalSEOReport.create({
        tenant_id: business.tenant_id, business_id: businessId, seo_project_id: project.id, seo_version_id: versionRec.id,
        sitemap: technical.sitemap, robots_txt: technical.robots_txt, canonical_issues: technical.canonical_issues, redirects: technical.redirects,
        duplicate_titles: technical.duplicate_titles, duplicate_descriptions: technical.duplicate_descriptions, broken_links: technical.broken_links,
        missing_h1: technical.missing_h1, accessibility: technical.accessibility, page_speed: technical.page_speed, core_web_vitals: technical.core_web_vitals,
        summary: technical.summary, provenance: provenance(t0, metas, 'complete'),
      });
      await base44.entities.SEOValidation.create({
        tenant_id: business.tenant_id, business_id: businessId, seo_project_id: project.id, seo_version_id: versionRec.id,
        status: validation.status, checks: validation.checks, summary: validation.summary, provenance: provenance(t0, metas, 'complete'),
      });

      await base44.entities.SEOProject.update(project.id, { current_version: version, health_score: validation.summary.health_score, active_seo_version_id: null });

      const a = await assembleActive(project);
      return Response.json({
        version: a.active ? a.active.version : versionRec,
        keywords: kwResult.data.keywords.length, clusters: clusterResult.data.clusters.length, schemas: schemaDocs.length,
        internal_links: internalLinks.length, recommendations: recs.length, image_seo: imageSeo.data.images.length,
        content_opportunities: contentOpps.data.opportunities.length, local_pages: (clusterResult.data.location_pages || []).length,
        health_score: validation.summary.health_score, validation_status: validation.status,
        kg_version: metas[0]?.kgVersion, telemetry: provenance(t0, metas, 'complete'),
      });
    }

    // ---------- APPROVE ----------
    if (action === 'approve') {
      const { version_id } = body;
      if (!version_id) return Response.json({ error: 'version_id is required' }, { status: 400 });
      const v: any = await base44.entities.SEOVersion.get(version_id);
      if (v.status !== 'draft') return Response.json({ error: 'Only draft SEO versions can be approved.' }, { status: 409 });
      await seoEngine.approve(base44, version_id, actorName(user));
      return Response.json({ version: await base44.entities.SEOVersion.get(version_id) });
    }

    // ---------- PUBLISH ----------
    if (action === 'publish') {
      const { version_id } = body;
      if (!version_id) return Response.json({ error: 'version_id is required' }, { status: 400 });
      const v: any = await base44.entities.SEOVersion.get(version_id);
      if (v.status !== 'approved') return Response.json({ error: 'Only approved SEO versions can be published.' }, { status: 409 });
      await seoEngine.publish(base44, version_id, actorName(user));
      await base44.entities.SEOProject.update(v.seo_project_id, { active_seo_version_id: version_id, current_version: v.version, health_score: v.health_score });
      return Response.json({ version: await base44.entities.SEOVersion.get(version_id) });
    }

    // ---------- REJECT ----------
    if (action === 'reject') {
      const { version_id } = body;
      if (!version_id) return Response.json({ error: 'version_id is required' }, { status: 400 });
      const v: any = await base44.entities.SEOVersion.get(version_id);
      if (v.status !== 'draft') return Response.json({ error: 'Only draft SEO versions can be rejected.' }, { status: 409 });
      return Response.json({ version: await base44.entities.SEOVersion.update(version_id, { status: 'rejected' }) });
    }

    // ---------- UPDATE (edit draft page metadata) ----------
    if (action === 'update') {
      const { version_id, page_seo } = body;
      if (!version_id) return Response.json({ error: 'version_id is required' }, { status: 400 });
      const v: any = await base44.entities.SEOVersion.get(version_id);
      if (v.status !== 'draft') return Response.json({ error: 'Only draft SEO versions are editable.' }, { status: 409 });
      const merged = { ...(v.page_seo || {}), ...(page_seo || {}) };
      return Response.json({ version: await base44.entities.SEOVersion.update(version_id, { page_seo: merged }) });
    }

    // ---------- UPDATE RECOMMENDATION STATUS ----------
    if (action === 'update_recommendation') {
      const { recommendation_id, status } = body;
      if (!recommendation_id || !['pending', 'approved', 'rejected', 'applied'].includes(status)) return Response.json({ error: 'recommendation_id and valid status required' }, { status: 400 });
      return Response.json({ recommendation: await base44.entities.SEORecommendation.update(recommendation_id, { status }) });
    }

    // ---------- ROLLBACK ----------
    if (action === 'rollback') {
      const { version_id } = body;
      if (!version_id) return Response.json({ error: 'version_id is required' }, { status: 400 });
      const v: any = await base44.entities.SEOVersion.get(version_id);
      if (v.status === 'published') return Response.json({ error: 'This version is already active.' }, { status: 409 });
      if (v.status !== 'approved' && v.status !== 'superseded') return Response.json({ error: 'Only previously approved/published versions can be rolled back to.' }, { status: 409 });
      await seoEngine.rollback(base44, version_id);
      await base44.entities.SEOProject.update(v.seo_project_id, { active_seo_version_id: version_id, current_version: v.version, health_score: v.health_score });
      return Response.json({ version: await base44.entities.SEOVersion.get(version_id) });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as any).message }, { status: 500 });
  }
}