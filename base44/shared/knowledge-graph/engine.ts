// Business Knowledge Graph — Entity Relationship Engine.
//
// This is the ONLY component that reads the source modules (Blueprint, Website,
// CRM, Domain, SEO) directly. It denormalizes them into ONE read-only, versioned
// graph object: nodes + cross-module relationships + a compact AI context snapshot
// + freshness metadata. Every other module (present and future: SEO, Marketing,
// Email, Support, Chatbot, Analytics, Automation) reads from this graph via the
// Shared Business Context API in ./index.ts — never from the source entities.
//
// This collapses all inter-module dependencies into a single dependency:
//
//   CRM        ┐
//   Website    ├─► Knowledge Graph   ◄─ SEO / Marketing / Email / Support / …
//   Blueprint  │
//   Domain     ┘
//
// No module imports another module. No circular dependencies. Future modules
// become trivial: `const ctx = await getBusinessContext(svc, businessId)`.

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  module: 'business' | 'blueprint' | 'website' | 'crm' | 'domain' | 'seo';
  source_ref: { entity: string; id: string; version?: number | null };
  attributes: Record<string, any>;
}

export interface GraphRelationship {
  source: string;
  target: string;
  type: string;
}

export interface SourceVersions {
  blueprint_id?: string | null;
  blueprint_version?: number | null;
  website_id?: string | null;
  website_version?: number | null;
  crm_version_id?: string | null;
  crm_version?: number | null;
  domain_id?: string | null;
  domain_status?: string | null;
  seo_version_id?: string | null;
  seo_version?: number | null;
}

export interface ModuleCoverage {
  blueprint?: { id: string; version: number; status: string; generated_at?: string } | null;
  website?: { id: string; version: number; status: string; page_count: number } | null;
  crm?: { id: string; version: number; status: string; health_score?: number; stage_count: number } | null;
  domain?: { id: string; domain_name: string; status: string } | null;
  seo?: { id: string; version: number; status: string; health_score?: number; keyword_count: number; cluster_count: number } | null;
}

export interface BusinessContext {
  business: { id: string; name: string; industry: string; country: string; city: string; service_area: string; description: string; contact_email: string; contact_phone: string };
  blueprint: { id: string; version: number; business_name: string; business_description: string; location_strategy: string } | null;
  brand: { name: string; primary_cta: string; color_palette: any[]; heading_font: string; body_font: string };
  services: string[];
  target_audience: string[];
  locations: string[];
  lead_sources: string[];
  value_proposition: string;
  differentiators: string[];
  domain: { domain_name: string; status: string } | null;
  pages: { slug: string; title: string; template: string; intent: string; primary_keyword: string; primary_cta: string }[];
  pipeline_stages: { key: string; name: string; owner_role: string; probability: number }[];
  owner_roles: string[];
  email_templates: { key: string; name: string; type: string; channel: string }[];
  keywords: { keyword: string; type: string; intent: string; cluster: string; page_slug: string }[];
  clusters: { topic: string; pillar_keyword: string; priority: number }[];
  content_opportunities: { type: string; title: string; slug: string; keyword: string; intent: string; target_cluster: string }[];
  source_versions: SourceVersions;
  generated_at: string;
}

export interface BuiltGraph {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  module_coverage: ModuleCoverage;
  context_snapshot: BusinessContext;
  stats: { node_count: number; relationship_count: number; by_type: Record<string, number> };
  source_versions: SourceVersions;
}

// ---------- helpers ----------
function pick(obj: any, keys: string[]): any {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) if (obj[k] != null && obj[k] !== '') return obj[k];
  return '';
}
function pickArr(obj: any, keys: string[]): any[] {
  if (!obj || typeof obj !== 'object') return [];
  for (const k of keys) if (Array.isArray(obj[k]) && obj[k].length) return obj[k];
  return [];
}

// ---------- SOURCE LOADING ----------
// Reads every source module for one business in parallel. Returns normalized
// `sources` consumed by buildGraph(). This is the single read boundary.
export async function loadSources(svc: any, businessId: string): Promise<any> {
  const business: any = await svc.entities.Business.get(businessId);

  const [bpAll, wsAll, crmProjects, domains, seoProjects, archAll] = await Promise.all([
    svc.entities.BusinessBlueprint.filter({ business_id: businessId }),
    svc.entities.Website.filter({ business_id: businessId }),
    svc.entities.CRMProject.filter({ business_id: businessId }),
    svc.entities.Domain.filter({ business_id: businessId }),
    svc.entities.SEOProject.filter({ business_id: businessId }),
    svc.entities.WebsiteArchitecture.filter({ business_id: businessId }),
  ]);

  const blueprint = (bpAll as any[]).find((r) => r.status === 'approved')
    || (bpAll as any[]).sort((a, b) => (b.version || 0) - (a.version || 0))[0]
    || null;

  const websiteRec = (wsAll as any[]).find((w) => w.status === 'published')
    || (wsAll as any[]).sort((a, b) => (b.version || 0) - (a.version || 0))[0]
    || null;
  const architecture = (archAll as any[])[0] || null;
  let pages: any[] = [];
  if (websiteRec) pages = await svc.entities.WebsitePage.filter({ website_id: websiteRec.id });

  const crmProject = (crmProjects as any[])[0] || null;
  let crm: any = null;
  if (crmProject) {
    const versions = (await svc.entities.CRMVersion.filter({ crm_project_id: crmProject.id }))
      .sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
    const crmVer = versions.find((v: any) => v.status === 'published')
      || versions.find((v: any) => v.status === 'approved')
      || versions[0] || null;
    if (crmVer) {
      const [pipelines, stages, scoreRules, automations, tasks, templates, widgets, reports] = await Promise.all([
        svc.entities.Pipeline.filter({ crm_version_id: crmVer.id }),
        svc.entities.PipelineStage.filter({ crm_version_id: crmVer.id }),
        svc.entities.LeadScoreRule.filter({ crm_version_id: crmVer.id }),
        svc.entities.AutomationRule.filter({ crm_version_id: crmVer.id }),
        svc.entities.TaskTemplate.filter({ crm_version_id: crmVer.id }),
        svc.entities.EmailTemplate.filter({ crm_version_id: crmVer.id }),
        svc.entities.DashboardWidget.filter({ crm_version_id: crmVer.id }),
        svc.entities.CRMReport.filter({ crm_version_id: crmVer.id }),
      ]);
      stages.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      crm = { project: crmProject, version: crmVer, pipeline: (pipelines as any[])[0] || null, stages, scoreRules, automations, tasks, templates, widgets, reports };
    }
  }

  const domain = (domains as any[]).find((d) => ['registered', 'active'].includes(d.status))
    || (domains as any[]).sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')))[0]
    || null;

  const seoProject = (seoProjects as any[])[0] || null;
  let seo: any = null;
  if (seoProject) {
    const versions = (await svc.entities.SEOVersion.filter({ seo_project_id: seoProject.id }))
      .sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
    const seoVer = versions.find((v: any) => v.status === 'published')
      || versions.find((v: any) => v.status === 'approved')
      || versions[0] || null;
    if (seoVer) {
      const [keywords, clusters, contentOpps, imageSeo] = await Promise.all([
        svc.entities.Keyword.filter({ seo_version_id: seoVer.id }),
        svc.entities.KeywordCluster.filter({ seo_version_id: seoVer.id }),
        svc.entities.ContentOpportunity.filter({ seo_version_id: seoVer.id }),
        svc.entities.ImageSEO.filter({ seo_version_id: seoVer.id }),
      ]);
      seo = { project: seoProject, version: seoVer, keywords, clusters, contentOpps, imageSeo, pageSeo: seoVer.page_seo || {} };
    }
  }

  return { business, blueprint, website: websiteRec ? { rec: websiteRec, architecture, pages } : null, crm, domain, seo };
}

// ---------- GRAPH BUILDING ----------
export function buildGraph(sources: any): BuiltGraph {
  const { business, blueprint, website, crm, domain, seo } = sources;
  const nodes: GraphNode[] = [];
  const rels: GraphRelationship[] = [];
  const nid = (m: string, t: string, id: string) => `${m}:${t}:${id}`;
  const addNode = (n: GraphNode) => nodes.push(n);
  const addRel = (s: string, t: string, type: string) => { if (s && t) rels.push({ source: s, target: t, type }); };

  // Business root
  const bizId = nid('business', 'business', business.id);
  addNode({ id: bizId, type: 'business', label: business.name, module: 'business', source_ref: { entity: 'Business', id: business.id }, attributes: { name: business.name, industry: business.industry, country: business.country, city: business.city, service_area: business.service_area, status: business.status, launch_stage: business.launch_stage } });

  // Blueprint
  let bpNodeId: string | null = null;
  if (blueprint) {
    bpNodeId = nid('blueprint', 'blueprint', blueprint.id);
    const bp = blueprint.blueprint || {};
    addNode({ id: bpNodeId, type: 'blueprint', label: `Blueprint v${blueprint.version}`, module: 'blueprint', source_ref: { entity: 'BusinessBlueprint', id: blueprint.id, version: blueprint.version }, attributes: { version: blueprint.version, status: blueprint.status, business_name: pick(bp.business_profile, ['business_name', 'name']), sections: Object.keys(bp) } });
    addRel(bizId, bpNodeId, 'has_blueprint');
  }

  // Website + pages
  let websiteNodeId: string | null = null;
  const pageNodeIds: Record<string, string> = {};
  if (website) {
    websiteNodeId = nid('website', 'website', website.rec.id);
    addNode({ id: websiteNodeId, type: 'website', label: `Website v${website.rec.version}`, module: 'website', source_ref: { entity: 'Website', id: website.rec.id, version: website.rec.version }, attributes: { version: website.rec.version, status: website.rec.status, name: website.rec.name, page_count: website.rec.page_count ?? website.pages.length } });
    addRel(bizId, websiteNodeId, 'has_website');
    for (const p of website.pages) {
      const pid = nid('website', 'page', p.id);
      pageNodeIds[p.slug] = pid;
      addNode({ id: pid, type: 'page', label: p.title || p.slug, module: 'website', source_ref: { entity: 'WebsitePage', id: p.id, version: p.version }, attributes: { slug: p.slug, title: p.title, template: p.template, intent: p.seo_intent, primary_cta: p.primary_cta } });
      addRel(websiteNodeId, pid, 'has_page');
    }
  }

  // CRM
  let crmNodeId: string | null = null;
  const stageNodeIds: Record<string, string> = {};
  if (crm) {
    crmNodeId = nid('crm', 'crm', crm.version.id);
    addNode({ id: crmNodeId, type: 'crm', label: `CRM v${crm.version.version}`, module: 'crm', source_ref: { entity: 'CRMVersion', id: crm.version.id, version: crm.version.version }, attributes: { version: crm.version.version, status: crm.version.status, health_score: crm.version.health_score, industry: crm.version.business_analysis?.industry } });
    addRel(bizId, crmNodeId, 'has_crm');
    // Pipeline + stages
    if (crm.pipeline) {
      const pipeId = nid('crm', 'pipeline', crm.pipeline.id);
      addNode({ id: pipeId, type: 'pipeline', label: crm.pipeline.name, module: 'crm', source_ref: { entity: 'Pipeline', id: crm.pipeline.id }, attributes: { name: crm.pipeline.name, total_stages: crm.pipeline.total_stages, stage_keys: crm.pipeline.stage_keys } });
      addRel(crmNodeId, pipeId, 'has_pipeline');
      for (const s of crm.stages) {
        const sid = nid('crm', 'stage', s.id);
        stageNodeIds[s.key] = sid;
        stageNodeIds[s.name] = sid;
        addNode({ id: sid, type: 'pipeline_stage', label: s.name, module: 'crm', source_ref: { entity: 'PipelineStage', id: s.id }, attributes: { key: s.key, name: s.name, order: s.order, owner_role: s.owner_role, probability: s.probability, sla_hours: s.sla_hours } });
        addRel(pipeId, sid, 'has_stage');
      }
    }
    for (const r of crm.scoreRules) {
      const rid = nid('crm', 'score_rule', r.id);
      addNode({ id: rid, type: 'score_rule', label: r.rule_key, module: 'crm', source_ref: { entity: 'LeadScoreRule', id: r.id }, attributes: { rule_key: r.rule_key, field: r.field, operator: r.operator, points: r.points, reason: r.reason } });
      addRel(crmNodeId, rid, 'has_score_rule');
    }
    for (const a of crm.automations) {
      const aid = nid('crm', 'automation', a.id);
      addNode({ id: aid, type: 'automation', label: a.name, module: 'crm', source_ref: { entity: 'AutomationRule', id: a.id }, attributes: { name: a.name, trigger: a.trigger, trigger_stage: a.trigger_stage, enabled: a.enabled } });
      addRel(crmNodeId, aid, 'has_automation');
      const ts = a.trigger_stage && stageNodeIds[a.trigger_stage];
      if (ts) addRel(ts, aid, 'stage_automated');
    }
    for (const t of crm.tasks) {
      const tid = nid('crm', 'task', t.id);
      addNode({ id: tid, type: 'task_template', label: t.name, module: 'crm', source_ref: { entity: 'TaskTemplate', id: t.id }, attributes: { name: t.name, type: t.type, trigger: t.trigger, owner_role: t.owner_role, due_offset_hours: t.due_offset_hours, priority: t.priority } });
      addRel(crmNodeId, tid, 'has_task');
      // link to stage if trigger mentions a stage name/key
      for (const s of crm.stages) {
        if (t.trigger && (t.trigger.includes(s.name) || t.trigger.includes(s.key))) { addRel(stageNodeIds[s.key], tid, 'stage_task'); break; }
      }
    }
    for (const t of crm.templates) {
      const tid = nid('crm', 'email_template', t.id);
      addNode({ id: tid, type: 'email_template', label: t.name, module: 'crm', source_ref: { entity: 'EmailTemplate', id: t.id }, attributes: { key: t.key, name: t.name, type: t.type, channel: t.channel, trigger: t.trigger } });
      addRel(crmNodeId, tid, 'has_email_template');
    }
    for (const w of crm.widgets) {
      const wid = nid('crm', 'widget', w.id);
      addNode({ id: wid, type: 'dashboard_widget', label: w.title, module: 'crm', source_ref: { entity: 'DashboardWidget', id: w.id }, attributes: { key: w.key, title: w.title, metric: w.metric, size: w.size } });
      addRel(crmNodeId, wid, 'has_widget');
    }
    for (const r of crm.reports) {
      const rid = nid('crm', 'report', r.id);
      addNode({ id: rid, type: 'crm_report', label: r.title, module: 'crm', source_ref: { entity: 'CRMReport', id: r.id }, attributes: { key: r.key, title: r.title, type: r.type, schedule: r.schedule } });
      addRel(crmNodeId, rid, 'has_report');
    }
  }

  // Domain
  let domainNodeId: string | null = null;
  if (domain) {
    domainNodeId = nid('domain', 'domain', domain.id);
    addNode({ id: domainNodeId, type: 'domain', label: domain.domain_name, module: 'domain', source_ref: { entity: 'Domain', id: domain.id }, attributes: { domain_name: domain.domain_name, status: domain.status, registered_at: domain.registered_at, expires_at: domain.expires_at, auto_renew: domain.auto_renew } });
    addRel(bizId, domainNodeId, 'has_domain');
  }

  // SEO
  let seoNodeId: string | null = null;
  const keywordNodeIds: Record<string, string> = {};
  const clusterNodeIds: Record<string, string> = {};
  if (seo) {
    seoNodeId = nid('seo', 'seo', seo.version.id);
    addNode({ id: seoNodeId, type: 'seo', label: `SEO v${seo.version.version}`, module: 'seo', source_ref: { entity: 'SEOVersion', id: seo.version.id, version: seo.version.version }, attributes: { version: seo.version.version, status: seo.version.status, health_score: seo.version.health_score, keyword_count: seo.version.keyword_count, cluster_count: seo.version.cluster_count } });
    addRel(bizId, seoNodeId, 'has_seo');
    for (const c of seo.clusters) {
      const cid = nid('seo', 'cluster', c.id);
      clusterNodeIds[c.topic] = cid;
      addNode({ id: cid, type: 'keyword_cluster', label: c.topic, module: 'seo', source_ref: { entity: 'KeywordCluster', id: c.id }, attributes: { topic: c.topic, pillar_keyword: c.pillar_keyword, priority: c.priority } });
      addRel(seoNodeId, cid, 'has_cluster');
    }
    for (const k of seo.keywords) {
      const kid = nid('seo', 'keyword', k.id);
      keywordNodeIds[String(k.keyword).toLowerCase()] = kid;
      addNode({ id: kid, type: 'keyword', label: k.keyword, module: 'seo', source_ref: { entity: 'Keyword', id: k.id }, attributes: { keyword: k.keyword, type: k.type, search_intent: k.search_intent, cluster: k.cluster, page_slug: k.page_slug, priority: k.priority } });
      addRel(seoNodeId, kid, 'has_keyword');
      if (k.cluster && clusterNodeIds[k.cluster]) addRel(kid, clusterNodeIds[k.cluster], 'belongs_to_cluster');
      if (k.page_slug && pageNodeIds[k.page_slug]) addRel(pageNodeIds[k.page_slug], kid, 'page_targets_keyword');
    }
    for (const o of seo.contentOpps) {
      const oid = nid('seo', 'content_opportunity', o.id);
      addNode({ id: oid, type: 'content_opportunity', label: o.title, module: 'seo', source_ref: { entity: 'ContentOpportunity', id: o.id }, attributes: { type: o.type, title: o.title, slug: o.slug, keyword: o.keyword, intent: o.intent, target_cluster: o.target_cluster, priority: o.priority } });
      addRel(seoNodeId, oid, 'has_content_opportunity');
      if (o.target_cluster && clusterNodeIds[o.target_cluster]) addRel(oid, clusterNodeIds[o.target_cluster], 'targets_cluster');
    }
    for (const im of seo.imageSeo) {
      const iid = nid('seo', 'image_seo', im.id);
      addNode({ id: iid, type: 'image_seo', label: im.alt_text || im.filename, module: 'seo', source_ref: { entity: 'ImageSEO', id: im.id }, attributes: { page_slug: im.page_slug, alt_text: im.alt_text, filename: im.filename, compression: im.compression } });
      addRel(seoNodeId, iid, 'has_image_seo');
    }
    // Cross-module: page ↔ primary keyword (from page_seo snapshot)
    for (const slug of Object.keys(seo.pageSeo)) {
      const ps = seo.pageSeo[slug];
      const pk = String(ps?.primary_keyword || '').toLowerCase();
      if (pk && pageNodeIds[slug] && keywordNodeIds[pk]) addRel(pageNodeIds[slug], keywordNodeIds[pk], 'primary_keyword');
    }
  }

  // Cross-module: CRM lead_sources ↔ blueprint/analysis (informational edge already on crm node)
  // Cross-module: website ↔ blueprint (provenance) — informational, captured via source_versions.

  const source_versions: SourceVersions = {
    blueprint_id: blueprint?.id ?? null,
    blueprint_version: blueprint?.version ?? null,
    website_id: website?.rec?.id ?? null,
    website_version: website?.rec?.version ?? null,
    crm_version_id: crm?.version?.id ?? null,
    crm_version: crm?.version?.version ?? null,
    domain_id: domain?.id ?? null,
    domain_status: domain?.status ?? null,
    seo_version_id: seo?.version?.id ?? null,
    seo_version: seo?.version?.version ?? null,
  };

  const module_coverage: ModuleCoverage = {
    blueprint: blueprint ? { id: blueprint.id, version: blueprint.version, status: blueprint.status, generated_at: blueprint.generated_at } : null,
    website: website ? { id: website.rec.id, version: website.rec.version, status: website.rec.status, page_count: website.pages.length } : null,
    crm: crm ? { id: crm.version.id, version: crm.version.version, status: crm.version.status, health_score: crm.version.health_score, stage_count: crm.stages.length } : null,
    domain: domain ? { id: domain.id, domain_name: domain.domain_name, status: domain.status } : null,
    seo: seo ? { id: seo.version.id, version: seo.version.version, status: seo.version.status, health_score: seo.version.health_score, keyword_count: seo.keywords.length, cluster_count: seo.clusters.length } : null,
  };

  const context_snapshot = buildContextSnapshot(sources, source_versions);

  const by_type: Record<string, number> = {};
  for (const n of nodes) by_type[n.type] = (by_type[n.type] || 0) + 1;

  return {
    nodes, relationships: rels, module_coverage, context_snapshot,
    stats: { node_count: nodes.length, relationship_count: rels.length, by_type },
    source_versions,
  };
}

// ---------- COMPACT AI CONTEXT SNAPSHOT ----------
// The single object every downstream AI stage receives. Bounded & token-efficient.
export function buildContextSnapshot(sources: any, source_versions: SourceVersions): BusinessContext {
  const { business, blueprint, website, crm, domain, seo } = sources;
  const bp = (blueprint && (blueprint.blueprint || {})) || {};
  const bpProfile = bp.business_profile || {};
  const bpSeo = bp.seo_blueprint || {};
  const analysis = crm?.version?.business_analysis || {};
  const cb = crm?.version?.crm_blueprint || {};

  const services = pickArr(analysis, ['services']).length ? analysis.services : pickArr(business, ['services_products']);
  const target_audience = pickArr(analysis, ['target_audience']).length ? analysis.target_audience : (business.target_customers ? [business.target_customers] : []);
  const lead_sources = pickArr(analysis, ['lead_sources']);
  const locations: string[] = [];
  if (bpSeo.location_strategy) locations.push(bpSeo.location_strategy);
  if (business.city) locations.push(business.city);
  if (business.service_area && business.service_area !== business.city) locations.push(business.service_area);
  const value_proposition = pick(bp, ['value_proposition', 'unique_value_proposition', 'value_prop']);
  const differentiators = pickArr(bp, ['differentiators', 'unique_selling_points', 'competitive_advantage', 'usps']);

  const arch = website?.architecture || {};
  const pageSeo = seo?.pageSeo || {};
  const pages = (website?.pages || []).map((p: any) => ({
    slug: p.slug, title: p.title, template: p.template, intent: p.seo_intent || pageSeo[p.slug]?.search_intent || '',
    primary_keyword: pageSeo[p.slug]?.primary_keyword || '', primary_cta: p.primary_cta || '',
  }));

  const pipeline_stages = (crm?.stages || []).map((s: any) => ({ key: s.key, name: s.name, owner_role: s.owner_role, probability: s.probability }));
  const owner_roles = pickArr(cb, ['owner_roles']);
  const email_templates = (crm?.templates || []).map((t: any) => ({ key: t.key, name: t.name, type: t.type, channel: t.channel }));
  const keywords = (seo?.keywords || []).slice(0, 30).map((k: any) => ({ keyword: k.keyword, type: k.type, intent: k.search_intent, cluster: k.cluster, page_slug: k.page_slug }));
  const clusters = (seo?.clusters || []).map((c: any) => ({ topic: c.topic, pillar_keyword: c.pillar_keyword, priority: c.priority }));
  const content_opportunities = (seo?.contentOpps || []).map((o: any) => ({ type: o.type, title: o.title, slug: o.slug, keyword: o.keyword, intent: o.intent, target_cluster: o.target_cluster }));

  return {
    business: {
      id: business.id, name: business.name, industry: business.industry || analysis.industry || '',
      country: business.country || '', city: business.city || '', service_area: business.service_area || '',
      description: business.description || pick(bpProfile, ['business_description', 'description']),
      contact_email: business.contact_email || '', contact_phone: business.contact_phone || '',
    },
    blueprint: blueprint ? {
      id: blueprint.id, version: blueprint.version,
      business_name: pick(bpProfile, ['business_name', 'name']) || business.name,
      business_description: pick(bpProfile, ['business_description', 'description']),
      location_strategy: bpSeo.location_strategy || '',
    } : null,
    brand: {
      name: pick(bpProfile, ['business_name', 'name']) || business.name,
      primary_cta: arch.primary_cta || pick(bp, ['primary_cta']),
      color_palette: arch.color_palette || [],
      heading_font: arch.typography?.heading_font || '', body_font: arch.typography?.body_font || '',
    },
    services, target_audience, locations, lead_sources, value_proposition, differentiators,
    domain: domain ? { domain_name: domain.domain_name, status: domain.status } : null,
    pages, pipeline_stages, owner_roles, email_templates, keywords, clusters, content_opportunities,
    source_versions,
    generated_at: new Date().toISOString(),
  };
}

// ---------- CHANGE DETECTION ----------
// Compares the persisted graph's source_versions to the freshly-read sources.
// If any upstream module advanced, the graph is stale and should be rebuilt.
export function detectStaleness(graph: { source_versions: SourceVersions; is_stale?: boolean } | null, sources: any): { stale: boolean; reasons: string[] } {
  if (!graph || !graph.source_versions) return { stale: true, reasons: ['No graph exists yet'] };
  const sv = graph.source_versions;
  const reasons: string[] = [];
  if (sources.blueprint && sv.blueprint_version !== sources.blueprint.version) reasons.push(`Blueprint changed (v${sv.blueprint_version} → v${sources.blueprint.version})`);
  if (sources.website?.rec && sv.website_version !== sources.website.rec.version) reasons.push(`Website changed (v${sv.website_version} → v${sources.website.rec.version})`);
  if (sources.crm?.version && sv.crm_version !== sources.crm.version.version) reasons.push(`CRM changed (v${sv.crm_version} → v${sources.crm.version.version})`);
  if (sources.domain && sv.domain_status !== sources.domain.status) reasons.push(`Domain changed (${sv.domain_status} → ${sources.domain.status})`);
  if (sources.seo?.version && sv.seo_version !== sources.seo.version.version) reasons.push(`SEO changed (v${sv.seo_version} → v${sources.seo.version.version})`);
  return { stale: reasons.length > 0, reasons };
}