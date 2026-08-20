// SEO Prompt Registry entries — versioned, capability-scoped prompt definitions.
//
// The AI Orchestration Engine auto-prepends the Business Knowledge Graph context
// (the SEOGeneration capability slice) to every prompt, so the prompt CONTENT
// holds only the task instructions — no embedded business context assembly.
// Each prompt is registered per-tenant idempotently by the backend function.

export const SEO_PROMPTS = [
  {
    prompt_id: 'seo.keywords',
    capability: 'SEOGeneration',
    module: 'seo',
    content: `You are an enterprise keyword researcher. Produce the COMPLETE keyword intelligence set for this business using ONLY the Business Knowledge Graph context provided above.

Generate keywords across ALL 7 buckets:
1. PRIMARY — the core money keywords for the business's main services.
2. SECONDARY — supporting service / feature keywords.
3. LONG_TAIL — specific, lower-volume, high-intent phrases (3-6 words).
4. COMMERCIAL — buyer-intent keywords (…”near me”, “pricing”, “book”, “hire”, “best”).
5. LOCAL — geographic keywords derived from the business locations / service area.
6. QUESTION — who/what/where/why/how queries the audience searches.
7. INFORMATIONAL — research-stage queries.

Return a flat "keywords" array where EVERY entry has:
- keyword (lowercase)
- type (one of: primary, secondary, long_tail, commercial, local, question, informational)
- search_intent (informational | commercial | transactional | navigational)
- keyword_difficulty (0-100)
- priority (0-100)
- volume (estimated monthly searches, integer)
- cluster (topic cluster name)
- page_slug (assign to the most relevant published page slug from the context; empty string if none)
- rationale (one short phrase)

Also return the bucket summary arrays (primary, secondary, long_tail, question, commercial, local, competitor) for reporting.

Aim for 40-70 unique keywords. Derive local keywords from the business locations. Align commercial keywords to the sales pipeline stages and lead sources in the context. No placeholders, no invented facts beyond the context.`,
    variables: [],
    default_model: 'automatic',
    fallback_models: ['gpt_5_mini'],
    notes: 'Stage 1: Keyword Intelligence — 7 buckets with intent, difficulty, priority, volume, cluster, page assignment.',
  },
  {
    prompt_id: 'seo.clusters_local',
    capability: 'SEOGeneration',
    module: 'seo',
    content: `You are an SEO content strategist. Build the topic CLUSTER map (pillar → supporting) and the LOCAL SEO plan using ONLY the Business Knowledge Graph context above.

Return "clusters" — 4-8 clusters anchored to the business's core services. Each cluster:
- topic (pillar name, e.g. "Personal Training")
- pillar_keyword
- description
- supporting_pages (existing published page slugs from the context that belong to this cluster)
- blog_topics (3-6 article titles to write)
- internal_links (slugs from the context that should interlink within this cluster)
- priority (0-100)

Then return "location_pages" — ONLY if the business has a real geographic / service-area strategy visible in the context. Each:
- slug (kebab-case, unique)
- title
- keyword
- intent (informational | commercial | transactional | navigational)
- business_value (one line on why this page earns traffic/leads)
- priority (0-100)

Never create thin or duplicate location pages — every page must have distinct, defensible business value. If there is no local strategy in the context, return an empty location_pages array.`,
    variables: [],
    default_model: 'automatic',
    fallback_models: ['gpt_5_mini'],
    notes: 'Stages 2-3 + 7: Search intent (across keywords/pages), Topic Clusters, and Local SEO.',
  },
  {
    prompt_id: 'seo.page_seo',
    capability: 'SEOGeneration',
    module: 'seo',
    content: `You are a senior SEO specialist producing production metadata for a BATCH of pages. The Business Knowledge Graph context (brand + business + locations + pipeline + the FULL published sitemap shown above, which you may cross-reference for internal links and related pages) is provided above.

You are responsible ONLY for the pages listed in TARGET_PAGES below. You MUST return EXACTLY one entry per page in TARGET_PAGES — no more, no fewer. Do NOT skip, summarize, or omit any page in the list, even if it seems minor (pricing, FAQ, legal, etc.). If you run low on space, prioritize completing every page's required fields over optional fields.

TARGET_PAGES: {{target_pages}}

For each page in TARGET_PAGES produce:
- slug (MUST exactly match the page's slug from TARGET_PAGES)
- search_intent (exactly one: informational | commercial | transactional | navigational)
- primary_keyword
- secondary_keywords (3-6)
- seo_title (≤60 chars, keyword-leading)
- meta_description (≤160 chars, compelling, includes primary keyword)
- canonical (absolute URL ending with the page's slug)
- h1 (single, keyword-aware)
- headings (2-5 subheadings)
- breadcrumb (page hierarchy path as an array of slugs; every slug MUST exist in the sitemap shown in the context)
- related_pages (3-5 existing slugs from the sitemap)
- open_graph { title, description, image }
- twitter_card { title, description, image }
- image_alt_text (2-4 descriptive alts, keyword-aware)
- internal_links (array of { slug, anchor_text } — ALL slugs MUST exist in the sitemap)
- structured_data (a JSON-LD object for this page's primary schema)
- schemas (array of schema.org type strings; pick from: Organization, LocalBusiness, Service, Product, FAQ, Review, Article, Event, Breadcrumb, Person)

Return a "pages" array with one object per page in TARGET_PAGES, in the same order. Ground everything in the context only; do not invent pages or slugs.`,
    variables: ['target_pages'],
    default_model: 'automatic',
    fallback_models: ['gpt_5_mini'],
    notes: 'Stage 4 + 5: Metadata + Schema Engine, produced in chunked batches (one orchestrate call per ~5 pages) to keep output size reliable.',
  },
  {
    prompt_id: 'seo.image_seo',
    capability: 'SEOGeneration',
    module: 'seo',
    content: `You are an image SEO specialist. Using ONLY the Business Knowledge Graph context (pages + brand + business), produce image optimization recommendations for the published pages.

Return "images" — for each page, produce 2-4 entries. Each:
- page_slug (MUST exist in the context sitemap)
- original_ref (description of the intended image, e.g. "hero", "team", "service-icon")
- alt_text (descriptive, keyword-aware, ≤125 chars)
- title (image title attribute)
- caption (optional display caption)
- filename (seo-friendly kebab-case with the page's primary keyword, e.g. "personal-training-delhi.jpg")
- compression (lossless | webp | avif | resize_only)
- priority (0-100)

Ground alt text in the page's subject and the business's services. No placeholders.`,
    variables: [],
    default_model: 'automatic',
    fallback_models: ['gpt_5_mini'],
    notes: 'Stage: Image SEO — alt text, titles, filenames, compression per page.',
  },
  {
    prompt_id: 'seo.content_opportunities',
    capability: 'SEOGeneration',
    module: 'seo',
    content: `You are a content strategist identifying NEW content opportunities to expand organic reach. Use ONLY the Business Knowledge Graph context (pages, keywords, clusters, pipeline, lead sources) plus the generated clusters provided below.

GENERATED CLUSTERS: {{clusters}}
TOP KEYWORDS: {{keywords}}
EXISTING PAGE SLUGS: {{existing_slugs}}

Return "opportunities" (10-18) — NEW pages NOT already in the sitemap. Types: blog, landing_page, faq, case_study, testimonial, guide, comparison, pricing, industry, seasonal. Each:
- type
- title
- slug (kebab-case, unique, not in existing slugs)
- keyword (primary target)
- intent (informational | commercial | transactional | navigational)
- description (one line on business value)
- target_cluster (one of the generated cluster topics, or empty)
- priority (0-100)

Every opportunity must drive traffic or leads for THIS business against its real sales journey. No duplicates with existing slugs.`,
    variables: ['clusters', 'keywords', 'existing_slugs'],
    default_model: 'automatic',
    fallback_models: ['gpt_5_mini'],
    notes: 'Stage: Content Opportunities — new pages aligned to clusters, keywords, and CRM lead sources.',
  },
  {
    prompt_id: 'seo.recommendations',
    capability: 'SEOGeneration',
    module: 'seo',
    content: `You are an SEO growth lead. Produce a PRIORITIZED, actionable recommendation backlog using ONLY the Business Knowledge Graph context and the validation results provided below.

VALIDATION SUMMARY: {{validation_summary}}
VALIDATION FAILURES: {{validation_failures}}
PAGES: {{pages}}
CLUSTERS: {{clusters}}

Return "recommendations" (8-15). Each:
- title (action verb)
- description (1-2 sentences)
- category (content | technical | schema | internal_links | local | metadata)
- priority (urgent | high | medium | low)
- estimated_impact (low | medium | high)
- estimated_difficulty (easy | medium | hard)
- page_slug (optional specific page or empty)

Every recommendation must have clear business value and address a real finding from the validation results or the current state.`,
    variables: ['validation_summary', 'validation_failures', 'pages', 'clusters'],
    default_model: 'automatic',
    fallback_models: ['gpt_5_mini'],
    notes: 'Stage: Recommendation Engine — prioritized backlog from validation + current state.',
  },
];

import { latestPrompt, registerPrompt } from '../orchestration/index.ts';

/**
 * Idempotently register all SEO prompts for a tenant. Re-uses the active version
 * when it matches the seed; FORKS a new version (never overwrites) when seed
 * content changed, mirroring the Blueprint versioning discipline.
 */
export async function ensureSeoPrompts(svc: any, tenant_id: string): Promise<void> {
  for (const def of SEO_PROMPTS) {
    const existing = await latestPrompt(svc, def.prompt_id, tenant_id);
    if (!existing) {
      await registerPrompt(svc, {
        tenant_id,
        prompt_id: def.prompt_id,
        capability: def.capability,
        module: def.module,
        content: def.content,
        variables: def.variables || [],
        default_model: def.default_model || 'automatic',
        fallback_models: def.fallback_models || [],
        status: 'approved',
        notes: def.notes || '',
        created_by: 'seo-factory',
      } as any);
      continue;
    }
    // Content drift → publish a new version (registerPrompt auto-bumps the version number).
    if (existing.content !== def.content ||
        JSON.stringify(existing.variables || []) !== JSON.stringify(def.variables || [])) {
      await registerPrompt(svc, {
        tenant_id,
        prompt_id: def.prompt_id,
        capability: def.capability,
        module: def.module,
        content: def.content,
        variables: def.variables || [],
        default_model: def.default_model || 'automatic',
        fallback_models: def.fallback_models || [],
        status: 'approved',
        notes: def.notes || '',
        created_by: 'seo-factory',
      } as any);
    }
  }
}