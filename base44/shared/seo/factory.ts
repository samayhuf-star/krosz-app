// AI SEO Factory (Knowledge Graph Edition) — shared pipeline stages.
//
// CONSUMES ONLY the Business Knowledge Graph context snapshot provided by the
// AI Orchestration Engine. It NEVER reads Website, Blueprint, or CRM entities
// directly, and NEVER calls an AI provider directly. Every AI stage is executed
// through the Orchestration Engine (prompt registry + KG context + validation +
// telemetry + cache). Deterministic post-processors (internal links, technical
// report, validation) operate on the snapshot + the AI outputs only.
//
// All structured outputs are slug-keyed RECOMMENDATIONS the Website Factory can
// apply later — the SEO Factory never edits the Website.

export const SEO_AI_PROVIDER = 'ai_orchestration';
export const SEO_AI_MODEL = 'orchestrated';

export type Orchestrator = (req: {
  promptId: string;
  capability: string;
  schema: any;
  stage: string;
  variables?: Record<string, any>;
}) => Promise<{ data: any; meta: any }>;

export type StageResult = { data: any; meta: any };

const str = { type: 'string' };
const obj = (props: any, required: string[] = []) => ({ type: 'object', additionalProperties: true, properties: props, required });
const arr = (items: any) => ({ type: 'array', items });

// ---------- STAGE 1: KEYWORD INTELLIGENCE ----------
export const KEYWORDS_SCHEMA = obj({
  primary: arr(str), secondary: arr(str), long_tail: arr(str),
  question: arr(str), commercial: arr(str), local: arr(str), competitor: arr(str),
  keywords: arr(obj({
    keyword: str, type: { type: 'string', enum: ['primary', 'secondary', 'long_tail', 'question', 'commercial', 'local', 'informational', 'competitor'] },
    search_intent: { type: 'string', enum: ['informational', 'commercial', 'transactional', 'navigational'] },
    keyword_difficulty: { type: 'number' }, priority: { type: 'number' }, volume: { type: 'number' },
    cluster: str, page_slug: str, rationale: str,
  }, ['keyword', 'type'])),
}, ['primary', 'keywords']);

export async function stageKeywords(orch: Orchestrator): Promise<StageResult> {
  const r = await orch({ promptId: 'seo.keywords', capability: 'SEOGeneration', schema: KEYWORDS_SCHEMA, stage: 'seo.keywords' });
  if (!r.data || !Array.isArray(r.data.keywords) || !r.data.keywords.length) throw new Error('Keyword Intelligence stage returned no keywords.');
  const seen = new Set<string>();
  r.data.keywords = r.data.keywords.filter((k: any) => {
    if (!k.keyword) return false;
    k.keyword = String(k.keyword).toLowerCase();
    if (seen.has(k.keyword)) return false;
    seen.add(k.keyword);
    return true;
  });
  return r;
}

// ---------- STAGES 2-3 + 7: CLUSTERS + LOCAL ----------
export const CLUSTERS_SCHEMA = obj({
  clusters: arr(obj({
    topic: str, pillar_keyword: str, description: str,
    supporting_pages: arr(str), blog_topics: arr(str), internal_links: arr(str), priority: { type: 'number' },
  }, ['topic', 'pillar_keyword'])),
  location_pages: arr(obj({
    slug: str, title: str, keyword: str, intent: { type: 'string', enum: ['informational', 'commercial', 'transactional', 'navigational'] },
    business_value: str, priority: { type: 'number' },
  }, ['slug', 'title', 'keyword'])),
}, ['clusters']);

export async function stageClustersLocal(orch: Orchestrator): Promise<StageResult> {
  const r = await orch({ promptId: 'seo.clusters_local', capability: 'SEOGeneration', schema: CLUSTERS_SCHEMA, stage: 'seo.clusters_local' });
  if (!r.data || !Array.isArray(r.data.clusters)) throw new Error('Cluster stage returned no clusters.');
  return r;
}

// ---------- STAGE 4 + 5: PAGE SEO (ALL pages, one orchestrated call) ----------
const PAGE_ENTRY_SCHEMA = obj({
  slug: str,
  search_intent: { type: 'string', enum: ['informational', 'commercial', 'transactional', 'navigational'] },
  primary_keyword: str, secondary_keywords: arr(str),
  seo_title: str, meta_description: str, canonical: str, h1: str, headings: arr(str),
  breadcrumb: arr(str), related_pages: arr(str),
  open_graph: obj({ title: str, description: str, image: str }, ['title', 'description']),
  twitter_card: obj({ title: str, description: str, image: str }, ['title', 'description']),
  image_alt_text: arr(str),
  internal_links: arr(obj({ slug: str, anchor_text: str }, ['slug', 'anchor_text'])),
  structured_data: obj({}),
  schemas: arr(str),
}, ['slug', 'search_intent', 'primary_keyword', 'seo_title', 'meta_description']);

export const PAGE_SEO_ALL_SCHEMA = obj({ pages: arr(PAGE_ENTRY_SCHEMA) }, ['pages']);

// Clamp a single-line string to a max length on a word boundary (SEO best practice;
// search engines truncate ~60 / ~160 anyway, so this prevents mid-word cuts).
function clampLine(s: any, max: number): string {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, Math.max(1, max - 1));
  const lastSpace = cut.lastIndexOf(' ');
  const base = (lastSpace > Math.floor(max * 0.6) ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:|–-]+$/, '');
  return base + '…';
}

// Build a deterministic fallback entry for any page the AI skipped or failed for.
function fallbackPageSEO(page: any, brandName: string): any {
  return {
    slug: page.slug,
    search_intent: page.intent || 'informational', primary_keyword: '', secondary_keywords: [],
    seo_title: page.title ? (brandName ? `${page.title} | ${brandName}` : page.title) : '',
    meta_description: '', canonical: `/${page.slug}`, h1: page.title || '', headings: [],
    breadcrumb: [page.slug], related_pages: [],
    open_graph: { title: page.title || '', description: '', image: '' },
    twitter_card: { title: page.title || '', description: '', image: '' },
    image_alt_text: [], internal_links: [], structured_data: {}, schemas: [], _fallback: true,
  };
}

// Chunks of pages per orchestrate call. A single call over a full sitemap makes the
// model truncate its output (observed: 1 of 16 pages returned). Per-page calls (16
// calls) overwhelm the entity API. ~4 pages/call is the reliable middle ground.
const PAGE_SEO_BATCH = 4;

export async function stageAllPageSEO(orch: Orchestrator, pages: any[], brandName: string): Promise<StageResult> {
  const bySlug: Record<string, any> = {};
  let lastMeta: any = { ok: true, fallback: false, latencyMs: 0 };
  for (let i = 0; i < pages.length; i += PAGE_SEO_BATCH) {
    const chunk = pages.slice(i, i + PAGE_SEO_BATCH).map((p: any) => ({ slug: p.slug, title: p.title, intent: p.intent || '', template: p.template || '' }));
    try {
      const r = await orch({
        promptId: 'seo.page_seo', capability: 'SEOGeneration', schema: PAGE_SEO_ALL_SCHEMA, stage: 'seo.page_seo',
        variables: { target_pages: JSON.stringify(chunk) },
      });
      lastMeta = r.meta;
      for (const p of (r.data?.pages || [])) { if (p && p.slug) bySlug[String(p.slug)] = p; }
    } catch (e) {
      lastMeta = { ok: false, fallback: true, latencyMs: 0, error: (e as any).message };
      // Missing pages in this chunk fall through to deterministic fallback below.
    }
  }
  // Deterministic cannibalization fix: no two pages may share a primary_keyword.
  // Promote a distinct secondary_keyword when the AI reused a primary across pages.
  const usedPrimaries = new Set<string>();
  const normKw = (s: any) => String(s || '').toLowerCase().trim();
  for (const p of pages) {
    const got = bySlug[p.slug];
    if (!got) continue;
    let pk = normKw(got.primary_keyword);
    if (pk && usedPrimaries.has(pk)) {
      const secs = Array.isArray(got.secondary_keywords) ? got.secondary_keywords.map((s: any) => String(s || '')) : [];
      const replacement = secs.find((s: string) => s && !usedPrimaries.has(normKw(s)));
      if (replacement) {
        got.primary_keyword = replacement;
        got.secondary_keywords = secs.filter((s: string) => normKw(s) !== normKw(replacement));
        pk = normKw(replacement);
      }
    }
    if (pk) usedPrimaries.add(pk);
  }

  // Preserve sitemap order; fill any gap with a deterministic fallback so every page is covered.
  const data = {
    pages: pages.map((p: any) => {
      const got = bySlug[p.slug];
      if (!got || !got.seo_title) return fallbackPageSEO(p, brandName);
      // Deterministic structured_data: if the AI declared schema types but left the
      // JSON-LD object empty, synthesize a minimal valid object from the page metadata.
      let structuredData = got.structured_data && Object.keys(got.structured_data || {}).length
        ? got.structured_data
        : null;
      const schemaTypes: string[] = Array.isArray(got.schemas) ? got.schemas : [];
      if (!structuredData && schemaTypes.length) {
        structuredData = {
          '@context': 'https://schema.org',
          '@type': schemaTypes[0],
          name: got.h1 || p.title || '',
          description: got.meta_description || '',
          url: got.canonical || `/${p.slug}`,
        };
      }
      return {
        slug: p.slug,
        search_intent: got.search_intent || p.intent || 'informational',
        primary_keyword: got.primary_keyword || '', secondary_keywords: got.secondary_keywords || [],
        seo_title: clampLine(got.seo_title, 60), meta_description: clampLine(got.meta_description, 160), canonical: got.canonical || `/${p.slug}`,
        h1: got.h1 || p.title || '', headings: got.headings || [], breadcrumb: got.breadcrumb || [p.slug], related_pages: got.related_pages || [],
        open_graph: got.open_graph || { title: p.title || '', description: '', image: '' },
        twitter_card: got.twitter_card || { title: p.title || '', description: '', image: '' },
        image_alt_text: got.image_alt_text || [], internal_links: got.internal_links || [],
        structured_data: structuredData || {}, schemas: schemaTypes,
        _fallback: false,
      };
    }),
  };
  return { data, meta: lastMeta };
}

// ---------- STAGE 5 (global schemas): Organization + LocalBusiness ----------
export function globalSchemas(ctx: any, hasLocal: boolean): any[] {
  const b = ctx?.business || {};
  const bp = ctx?.blueprint || {};
  const org = { '@context': 'https://schema.org', '@type': 'Organization', name: b.name || bp.business_name, description: b.description || bp.business_description || '', url: '', logo: '' };
  const out = [{ schema_type: 'Organization', schema_data: org, relevance: 'Global organization identity for Knowledge Panel.', priority: 95, scope: 'global', page_slug: '' }];
  if (hasLocal) {
    out.push({
      schema_type: 'LocalBusiness',
      schema_data: { ...org, '@type': 'LocalBusiness', address: { '@type': 'PostalAddress', addressCountry: b.country || '', addressLocality: (ctx.locations || []).join(', ') || b.city || '' }, areaServed: (ctx.locations || []).map((l: string) => l) },
      relevance: 'Local business presence for Maps & local pack.', priority: 90, scope: 'global', page_slug: '',
    });
  }
  return out;
}

// ---------- STAGE 6: INTERNAL LINKING (deterministic, snapshot pages) ----------
export function deriveInternalLinks(pageSeo: Record<string, any>, pages: any[]): any[] {
  const slugSet = new Set(pages.map((p: any) => p.slug));
  const links: any[] = [];
  for (const slug of Object.keys(pageSeo)) {
    const ps = pageSeo[slug];
    if (!slugSet.has(slug)) continue;
    const seenLinks = new Set<string>();
    const push = (l: any) => { const k = `${l.source_page_slug}|${l.target_page_slug}|${l.link_type}`; if (seenLinks.has(k)) return; seenLinks.add(k); links.push(l); };
    (ps.internal_links || []).forEach((l: any) => {
      push({ source_page_slug: slug, source_page_id: null, target_page_slug: l.slug, target_page_id: null, anchor_text: l.anchor_text || '', link_type: 'contextual', status: slugSet.has(l.slug) ? 'recommended' : 'broken' });
    });
    (ps.related_pages || []).forEach((t: string) => {
      if (t === slug) return;
      push({ source_page_slug: slug, source_page_id: null, target_page_slug: t, target_page_id: null, anchor_text: '', link_type: 'related', status: slugSet.has(t) ? 'recommended' : 'broken' });
    });
    (ps.breadcrumb || []).forEach((t: string) => {
      if (t === slug || !slugSet.has(t)) return;
      push({ source_page_slug: t, source_page_id: null, target_page_slug: slug, target_page_id: null, anchor_text: '', link_type: 'parent', status: 'recommended' });
    });
  }
  return links;
}

// ---------- STAGE 8: TECHNICAL SEO (deterministic, snapshot pages) ----------
export function buildTechnicalReport(pages: any[], pageSeo: Record<string, any>, internalLinks: any[]): any {
  const sitemap = pages.map((p: any) => ({ slug: p.slug, url: `/${p.slug}`, priority: 0.5, changefreq: p.template === 'home' ? 'weekly' : 'monthly', lastmod: new Date().toISOString().slice(0, 10) }));
  const robots_txt = `User-agent: *\nAllow: /\n\nSitemap: /sitemap.xml`;
  const canonical_issues: any[] = [];
  pages.forEach((p: any) => { const c = pageSeo[p.slug]?.canonical; if (!c || c.trim() === '') canonical_issues.push({ slug: p.slug, issue: 'missing' }); });
  const titleCounts: Record<string, string[]> = {}, descCounts: Record<string, string[]> = {};
  pages.forEach((p: any) => {
    const t = (pageSeo[p.slug]?.seo_title || '').toLowerCase();
    const d = (pageSeo[p.slug]?.meta_description || '').toLowerCase();
    if (t) (titleCounts[t] ||= []).push(p.slug);
    if (d) (descCounts[d] ||= []).push(p.slug);
  });
  const duplicate_titles = Object.entries(titleCounts).filter(([, v]) => v.length > 1).map(([t, slugs]) => ({ title: t, slugs }));
  const duplicate_descriptions = Object.entries(descCounts).filter(([, v]) => v.length > 1).map(([d, slugs]) => ({ description: d, slugs }));
  const broken_links = internalLinks.filter((l: any) => l.status === 'broken').map((l: any) => ({ source: l.source_page_slug, target: l.target_page_slug }));
  const missing_h1 = pages.filter((p: any) => !pageSeo[p.slug]?.h1).map((p: any) => ({ slug: p.slug, title: p.title }));
  const accessibility = ['Images require descriptive alt text (see Image SEO plan).', 'Ensure WCAG 2.1 AA color contrast.', 'Form fields need labels & aria attributes.', 'Maintain logical heading order (single H1 per page).'];
  const page_speed = ['Compress hero images and serve next-gen formats (WebP/AVIF).', 'Defer non-critical JavaScript.', 'Inline critical CSS.', 'Lazy-load below-the-fold media.'];
  const core_web_vitals = ['LCP < 2.5s — optimize hero image & font loading.', 'CLS < 0.1 — reserve dimensions for images/ads.', 'INP < 200ms — avoid long main-thread tasks.', 'Use a CDN and HTTP/2.'];
  const summary = { sitemap_entries: sitemap.length, canonical_issues: canonical_issues.length, duplicate_titles: duplicate_titles.length, duplicate_descriptions: duplicate_descriptions.length, broken_links: broken_links.length, missing_h1: missing_h1.length };
  return { sitemap, robots_txt, canonical_issues, redirects: [], duplicate_titles, duplicate_descriptions, broken_links, missing_h1, accessibility, page_speed, core_web_vitals, summary };
}

// ---------- STAGE 9: SEO VALIDATOR (deterministic, snapshot pages) ----------
export type SeoCheck = { id: string; check: string; severity: 'error' | 'warning' | 'info'; status: 'pass' | 'fail'; message: string; location?: string };

export function validateSEO(pages: any[], pageSeo: Record<string, any>, keywords: any[], internalLinks: any[], schemas: any[]): { status: 'pass' | 'warning' | 'fail'; checks: SeoCheck[]; summary: any } {
  const checks: SeoCheck[] = [];
  const add = (id: string, severity: 'error' | 'warning' | 'info', check: string, pass: boolean, message: string, location?: string) => checks.push({ id, check, severity, status: pass ? 'pass' : 'fail', message, location });

  const kwSeen: Record<string, number> = {};
  keywords.forEach((k: any) => { kwSeen[k.keyword] = (kwSeen[k.keyword] || 0) + 1; });
  const dupKw = Object.entries(kwSeen).filter(([, c]) => c > 1);
  add('dup_keywords', 'warning', 'Duplicate keywords', !dupKw.length, dupKw.length ? `${dupKw.length} duplicated across entries` : 'All keywords unique', 'keywords');

  const missingKw = pages.filter((p: any) => !pageSeo[p.slug]?.primary_keyword).map((p: any) => p.slug);
  add('missing_keyword', 'error', 'Missing primary keyword', !missingKw.length, missingKw.length ? `${missingKw.length} pages lack a primary keyword` : 'All pages have a primary keyword', missingKw.join(',') || 'pages');

  const pkPages: Record<string, string[]> = {};
  pages.forEach((p: any) => { const k = pageSeo[p.slug]?.primary_keyword; if (k) (pkPages[k] ||= []).push(p.slug); });
  const cannibal = Object.entries(pkPages).filter(([, v]) => v.length > 1);
  add('cannibalization', 'error', 'Keyword cannibalization', !cannibal.length, cannibal.length ? `${cannibal.length} primary keywords reused on multiple pages` : 'No cannibalization detected', 'pages');

  const brokenLk = internalLinks.filter((l: any) => l.status === 'broken');
  add('broken_links', 'error', 'Broken internal links', !brokenLk.length, brokenLk.length ? `${brokenLk.length} broken links detected` : 'All internal link targets resolve', 'internal_links');

  const dTitles = Object.entries(pages.reduce((acc: Record<string, string[]>, p: any) => { const t = (pageSeo[p.slug]?.seo_title || '').toLowerCase(); if (t) (acc[t] ||= []).push(p.slug); return acc; }, {})).filter(([, v]) => v.length > 1);
  add('dup_metadata', 'error', 'Duplicate metadata', !dTitles.length, dTitles.length ? `${dTitles.length} duplicate SEO titles` : 'Metadata is unique', 'pages');

  const noSchema = pages.filter((p: any) => !(pageSeo[p.slug]?.schemas?.length)).map((p: any) => p.slug);
  add('missing_schema', 'warning', 'Missing schema', !noSchema.length, noSchema.length ? `${noSchema.length} pages have no schema applied` : 'All pages have schema', noSchema.join(',') || 'pages');

  // Legal / policy pages legitimately have no CTA — exclude them from this check.
  const isLegalPage = (p: any) => /privacy|terms|legal|cookie|disclaimer/i.test(String(p.slug || '')) || p.template === 'legal';
  const noCta = pages.filter((p: any) => !isLegalPage(p) && !p.primary_cta).map((p: any) => p.slug);
  add('missing_cta', 'warning', 'Missing CTA', !noCta.length, noCta.length ? `${noCta.length} pages lack a primary CTA` : 'All pages declare a CTA', noCta.join(',') || 'pages');

  const inbound = new Set(internalLinks.filter((l: any) => l.status !== 'broken').map((l: any) => l.target_page_slug));
  const orphan = pages.filter((p: any) => p.slug !== pages[0]?.slug && !inbound.has(p.slug)).map((p: any) => p.slug);
  add('orphan_pages', 'warning', 'Orphan pages', !orphan.length, orphan.length ? `${orphan.length} pages have no inbound internal links` : 'No orphan pages', orphan.join(',') || 'pages');

  const longTitles = pages.filter((p: any) => (pageSeo[p.slug]?.seo_title || '').length > 60).map((p: any) => p.slug);
  add('title_length', 'warning', 'Title length (≤60 chars)', !longTitles.length, longTitles.length ? `${longTitles.length} titles exceed 60 chars` : 'All titles within 60 chars', longTitles.join(',') || 'pages');
  const longDesc = pages.filter((p: any) => (pageSeo[p.slug]?.meta_description || '').length > 160).map((p: any) => p.slug);
  add('meta_length', 'warning', 'Meta description length (≤160 chars)', !longDesc.length, longDesc.length ? `${longDesc.length} descriptions exceed 160 chars` : 'All descriptions within 160 chars', longDesc.join(',') || 'pages');

  const noStruct = pages.filter((p: any) => !(pageSeo[p.slug]?.structured_data && Object.keys(pageSeo[p.slug]?.structured_data || {}).length)).map((p: any) => p.slug);
  add('structured_data', 'warning', 'Structured data populated', !noStruct.length, noStruct.length ? `${noStruct.length} pages have empty structured data` : 'All pages have structured data', noStruct.join(',') || 'pages');

  const errors = checks.filter((c) => c.severity === 'error' && c.status === 'fail').length;
  const warnings = checks.filter((c) => c.severity === 'warning' && c.status === 'fail').length;
  const passed = checks.filter((c) => c.status === 'pass').length;
  const status = errors > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass';
  const health = Math.max(0, Math.round(100 - errors * 6 - warnings * 2));
  const schemaCoverage = pages.length ? Math.round((pages.filter((p: any) => pageSeo[p.slug]?.schemas?.length).length / pages.length) * 100) : 0;
  return { status, checks, summary: { errors, warnings, passed, total: checks.length, health_score: health, schema_coverage: schemaCoverage, keyword_count: keywords.length, internal_link_count: internalLinks.length, schema_count: schemas.length } };
}

// ---------- STAGE: IMAGE SEO ----------
export const IMAGE_SEO_SCHEMA = obj({
  images: arr(obj({
    page_slug: str, original_ref: str, alt_text: str, title: str, caption: str, filename: str,
    compression: { type: 'string', enum: ['lossless', 'webp', 'avif', 'resize_only'] }, priority: { type: 'number' },
  }, ['page_slug', 'alt_text', 'filename'])),
}, ['images']);

export async function stageImageSEO(orch: Orchestrator, pages: any[]): Promise<StageResult> {
  const r = await orch({ promptId: 'seo.image_seo', capability: 'SEOGeneration', schema: IMAGE_SEO_SCHEMA, stage: 'seo.image_seo' });
  if (!r.data || !Array.isArray(r.data.images)) return { data: { images: [] }, meta: r.meta };
  const norm = (s: string) => String(s || '').toLowerCase().replace(/^\/+|\/+$/g, '');
  const slugSet = new Set(pages.map((p: any) => norm(p.slug)));
  r.data.images = (r.data.images as any[]).map((i: any) => ({ ...i, page_slug: norm(i.page_slug) })).filter((i: any) => i.page_slug && slugSet.has(i.page_slug));
  return r;
}

// ---------- STAGE: CONTENT OPPORTUNITIES ----------
export const CONTENT_OPPS_SCHEMA = obj({
  opportunities: arr(obj({
    type: { type: 'string', enum: ['blog', 'landing_page', 'faq', 'case_study', 'testimonial', 'guide', 'comparison', 'pricing', 'industry', 'seasonal'] },
    title: str, slug: str, keyword: str, intent: { type: 'string', enum: ['informational', 'commercial', 'transactional', 'navigational'] },
    description: str, target_cluster: str, priority: { type: 'number' },
  }, ['type', 'title', 'slug', 'keyword'])),
}, ['opportunities']);

export async function stageContentOpportunities(orch: Orchestrator, pages: any[], keywords: any[], clusters: any[]): Promise<StageResult> {
  const r = await orch({
    promptId: 'seo.content_opportunities', capability: 'SEOGeneration', schema: CONTENT_OPPS_SCHEMA, stage: 'seo.content_opportunities',
    variables: {
      clusters: (clusters || []).map((c: any) => ({ topic: c.topic, pillar_keyword: c.pillar_keyword })),
      keywords: (keywords || []).slice(0, 20).map((k: any) => k.keyword),
      existing_slugs: pages.map((p: any) => p.slug),
    },
  });
  const existing = new Set(pages.map((p: any) => p.slug));
  const seen = new Set<string>();
  r.data.opportunities = ((r.data?.opportunities) || []).filter((o: any) => {
    const k = String(o.slug || '').toLowerCase();
    if (!k || existing.has(k) || seen.has(k)) return false;
    seen.add(k); return true;
  });
  return r;
}

// ---------- STAGE: RECOMMENDATIONS ----------
export const RECS_SCHEMA = obj({
  recommendations: arr(obj({
    title: str, description: str,
    category: { type: 'string', enum: ['content', 'technical', 'schema', 'internal_links', 'local', 'metadata'] },
    priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
    estimated_impact: { type: 'string', enum: ['low', 'medium', 'high'] },
    estimated_difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
    page_slug: str,
  }, ['title', 'category', 'priority'])),
}, ['recommendations']);

export async function stageRecommendations(orch: Orchestrator, pages: any[], keywords: any[], clusters: any[], validation: any): Promise<StageResult> {
  const r = await orch({
    promptId: 'seo.recommendations', capability: 'SEOGeneration', schema: RECS_SCHEMA, stage: 'seo.recommendations',
    variables: {
      validation_summary: JSON.stringify(validation.summary),
      validation_failures: JSON.stringify((validation.checks || []).filter((c: any) => c.status === 'fail').map((c: any) => ({ id: c.check, msg: c.message }))),
      pages: JSON.stringify(pages.map((p: any) => ({ slug: p.slug, title: p.title, template: p.template, intent: p.intent }))),
      clusters: JSON.stringify((clusters || []).map((c: any) => ({ topic: c.topic, blog_topics: (c.blog_topics || []).length }))),
    },
  });
  if (!r.data || !Array.isArray(r.data.recommendations)) r.data = { recommendations: [] };
  return r;
}

// ---------- PROVENANCE (aggregated orchestration telemetry) ----------
export function provenance(t0: number, stageMetas: any[], status = 'complete') {
  const okMetas = stageMetas.filter((m: any) => m && m.ok !== false);
  const promptVersions = [...new Set(okMetas.map((m: any) => `${m.promptId}@v${m.promptVersion}`))].join(', ');
  const models = [...new Set(okMetas.map((m: any) => m.model).filter(Boolean))].join(', ');
  const providers = [...new Set(okMetas.map((m: any) => m.provider).filter(Boolean))].join(', ');
  const totalLatency = okMetas.reduce((s: number, m: any) => s + (m.latencyMs || 0), 0);
  const totalCost = +(okMetas.reduce((s: number, m: any) => s + (m.estimatedCost || 0), 0)).toFixed(4);
  const retries = okMetas.reduce((s: number, m: any) => s + (m.retryCount || 0), 0);
  const validationStatuses = okMetas.map((m: any) => m.validationStatus).filter(Boolean);
  return {
    ai_provider: providers || SEO_AI_PROVIDER,
    ai_model: models || SEO_AI_MODEL,
    prompt_version: promptVersions || 'seo-prompts-v1',
    kg_version: okMetas[0]?.kgVersion ?? null,
    generation_time_ms: Date.now() - t0,
    token_usage: { llm_calls: okMetas.length, estimated_tokens: okMetas.length * 1500, is_estimated: true },
    estimated_cost: totalCost,
    is_estimated: true,
    generation_status: status,
    retries,
    validation_status: validationStatuses.includes('fail') ? 'fail' : validationStatuses.includes('pass') ? 'pass' : 'none',
    stages: okMetas.map((m: any) => ({ stage: m.stage, promptId: m.promptId, promptVersion: m.promptVersion, model: m.model, latencyMs: m.latencyMs, cost: m.estimatedCost, validation: m.validationStatus, cacheHit: m.cacheHit })),
  };
}