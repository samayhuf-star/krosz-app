// AI Website Factory — shared pipeline stages.
// Consumed by the websiteFactory backend function and, later, by the
// Localization / Blog / Landing Page engines. Every stage is a pure function
// of (the approved Business Blueprint + prior stage outputs); stages never
// re-read the customer's raw input. This is what makes the factory reusable.

export const WF_PROMPT_VERSION = 'wf-prompt-v1';
export const WF_AI_PROVIDER = 'base44-core';
export const WF_AI_MODEL = 'automatic';

export type LLM = (prompt: string, schema: any) => Promise<any>;

const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const obj = (props: any, required: string[] = []) => ({ type: 'object', additionalProperties: true, properties: props, required });
const arr = (items: any) => ({ type: 'array', items });

export function blueprintContext(bp: any): string {
  const b = (bp && bp.blueprint) || bp || {};
  const biz = b.business_profile || {};
  const brand = b.branding || {};
  const services: any[] = b.services || [];
  const web = b.website_blueprint || {};
  const seo = b.seo_blueprint || {};
  return `APPROVED BUSINESS BLUEPRINT (single source of truth — ground every word here; never invent facts):
${JSON.stringify(b)}

Business: ${biz.business_name || ''} | ${biz.industry || ''} | ${biz.business_category || ''}
Description: ${biz.business_description || ''}
Mission: ${biz.mission || ''} | Vision: ${biz.vision || ''} | USP: ${biz.usp || ''}
Brand: tone=${brand.brand_tone || ''}, voice=${brand.brand_voice || ''}, colors=${(brand.suggested_colors || []).map((c: any) => `${c.name || ''}:${c.hex || ''}`).join(', ')}, fonts=${brand.suggested_font_style || ''}, cta style=${brand.cta_style || ''}
Services: ${services.map((s: any) => s.name).join(', ')}
Suggested pages: ${(web.pages || []).map((p: any) => p.title).join(', ')}
Primary keywords: ${(seo.primary_keywords || []).join(', ')}

Rules: No placeholders, no "TBD", no lorem ipsum, no commentary. Return ONLY the JSON object.`;
}

export const ARCHITECTURE_SCHEMA = obj({
  name: str,
  navigation: arr(obj({ label: str, url: str, order: num }, ['label', 'url'])),
  footer: obj({ columns: arr(obj({ title: str, links: arr(obj({ label: str, url: str }, ['label', 'url'])) })), copyright: str, social: arr(obj({ platform: str, url: str }, ['platform', 'url'])) }),
  primary_cta: str, secondary_cta: str,
  brand_theme: obj({ tone: str, personality: str, voice: str }),
  color_palette: arr(obj({ name: str, hex: str, role: str }, ['name', 'hex', 'role'])),
  typography: obj({ heading_font: str, body_font: str, scale: str }),
  spacing: str, grid_system: str, icon_style: str, image_style: str, animation_style: str,
  component_library: arr(obj({ key: str, name: str, description: str }, ['key', 'name'])),
  design_tokens: obj({}),
  responsive_rules: arr(str),
  accessibility_rules: arr(str),
}, ['name', 'navigation', 'primary_cta', 'secondary_cta', 'color_palette', 'typography', 'component_library']);

export async function stageArchitecture(llm: LLM, bp: any): Promise<any> {
  const data = await llm(
    `You are a senior website architect. Design the complete website architecture (design system + global layout) for this business. ${blueprintContext(bp)}
Produce JSON with: name; navigation (array of {label,url,order} — top-level menu, ≤8 items); footer {columns:[{title,links:[{label,url}]}], copyright, social:[{platform,url}]}; primary_cta and secondary_cta (short verbs); brand_theme {tone,personality,voice}; color_palette (5-7 swatches {name,hex,role} using the blueprint's colors); typography {heading_font, body_font, scale}; spacing (token scale e.g. "4 8 12 16 24 32 48 64"); grid_system; icon_style; image_style; animation_style; component_library — every reusable component you will compose pages from ({key,name,description}; include hero, cta, features, benefits, service_grid, pricing, testimonials, faq, gallery, contact_form, team, timeline, statistics, map, newsletter, footer, navigation, about, values, process, guarantee, locations); design_tokens (object of token:value); responsive_rules (array); accessibility_rules (array).`,
    ARCHITECTURE_SCHEMA,
  );
  if (!data || !data.name || !Array.isArray(data.component_library)) throw new Error('Architecture stage returned an incomplete result.');
  if (!data.navigation) data.navigation = [];
  return data;
}

export const SITEMAP_SCHEMA = obj({
  pages: arr(obj({
    title: str, slug: str, url: str, purpose: str, audience: str, primary_cta: str,
    seo_intent: str, parent: str, children: arr(str), priority: num, template: str,
  }, ['title', 'slug', 'purpose', 'template'])),
}, ['pages']);

export async function stageSitemap(llm: LLM, bp: any): Promise<any[]> {
  const data = await llm(
    `You are an SEO-savvy information architect. Produce the complete sitemap as a pages array. ${blueprintContext(bp)}
Each page: title; slug (kebab-case, unique); url (absolute path, "/" for homepage); purpose (one line); audience; primary_cta; seo_intent (informational|commercial|transactional|navigational); parent (parent slug or "" for top-level); children (slug list); priority (0.0-1.0, home highest); template — one of: home, about, services_overview, service_detail, pricing, faq, reviews, gallery, contact, blog_landing, blog_category, legal, location, industry, landing, career, partner, default.
Only include pages with real value for THIS business; create one service_detail page per service; include Home, About, Services overview, per-service pages, Pricing, FAQ, Reviews, Contact, Privacy, Terms; add blog_landing + a blog_category per blog category if relevant; add location pages only if the blueprint has a location strategy.`,
    SITEMAP_SCHEMA,
  );
  if (!data || !Array.isArray(data.pages) || !data.pages.length) throw new Error('Sitemap stage returned no pages.');
  return data.pages;
}

export const PAGE_SCHEMA = obj({
  components: arr(obj({
    key: str, name: str, order: num, visible: bool,
    properties: obj({ headline: str, subheadline: str, body: str, cta_text: str, faq: arr(str), image_suggestion: str, internal_links: arr(str) }),
    responsive: obj({ mobile: str, tablet: str, desktop: str }),
  }, ['key', 'name', 'order'])),
  seo: obj({
    seo_title: str, meta_description: str, slug: str, canonical: str,
    schema: obj({}), open_graph: obj({ title: str, description: str, image: str }),
    twitter_card: obj({ title: str, description: str, image: str }),
    image_alt_text: arr(str), breadcrumb: arr(str), internal_links: arr(str), robots: str,
  }, ['seo_title', 'meta_description', 'slug']),
}, ['components']);

export async function stagePage(llm: LLM, bp: any, architecture: any, page: any): Promise<any> {
  const data = await llm(
    `You are a senior content strategist and SEO specialist producing ONE production-ready page. ${blueprintContext(bp)}
Reusable component keys (compose the page from these — do not invent new keys): ${JSON.stringify((architecture.component_library || []).map((c: any) => c.key))}
Design guidance: ${JSON.stringify({ colors: architecture.color_palette, font: architecture.typography, voice: architecture.brand_theme })}
PAGE TO BUILD:
${JSON.stringify(page)}
Produce JSON with: components — an ordered array composing this page ({key from the library, name, order, visible true, properties {headline, subheadline, body (2-4 sentences), cta_text, faq array of "Q: … A: …", image_suggestion, internal_links (slug list)}, responsive {mobile, tablet, desktop notes}}); and SEO {seo_title ≤60 chars, meta_description ≤160 chars, slug = page slug, canonical full url, schema (JSON-LD object), open_graph {title, description, image suggestion}, twitter_card {...}, image_alt_text array, breadcrumb array, internal_links slug array, robots "index,follow"}. Ground every string in the blueprint.`,
    PAGE_SCHEMA,
  );
  return data || null;
}

export const MEDIA_SCHEMA = obj({
  items: arr(obj({ page_slug: str, section: str, component_key: str, media_type: str, purpose: str, aspect_ratio: str, image_prompt: str, alt_text: str }, ['page_slug', 'media_type', 'image_prompt'])),
}, ['items']);

export async function stageMedia(llm: LLM, bp: any, architecture: any, pages: any[]): Promise<any[]> {
  const data = await llm(
    `You are an art director. Build the MEDIA PLAN (descriptions only — never generate image bytes) for every visual needed. ${blueprintContext(bp)}
Image style: ${architecture.image_style || 'clean, professional, on-brand'}
Pages: ${JSON.stringify(pages.map((p: any) => ({ slug: p.slug, title: p.title, template: p.template })))}
Produce items array: page_slug; section; component_key; media_type (one of hero|gallery|icon|illustration|logo|background); purpose; aspect_ratio (e.g. 16:9, 1:1); image_prompt (a detailed visual brief an image generator could execute); alt_text (accessible). Include a hero per page, icons for feature/benefit grids, an og:image, a logo and a favicon concept.`,
    MEDIA_SCHEMA,
  );
  return (data && Array.isArray(data.items)) ? data.items : [];
}

export type ValCheck = { id: string; check: string; severity: 'error' | 'warning' | 'info'; status: 'pass' | 'fail'; message: string; location?: string };

export function validateWebsite(architecture: any, pages: any[], componentsByPage: Record<string, any[]>): { status: 'pass' | 'warning' | 'fail'; checks: ValCheck[]; summary: any } {
  const checks: ValCheck[] = [];
  const slugSet = new Set(pages.map((p: any) => p.slug));
  const ok = (id: string, check: string, message: string, loc?: string): void => checks.push({ id, check, severity: 'info', status: 'pass', message, location: loc });
  const warn = (id: string, check: string, message: string, loc?: string): void => checks.push({ id, check, severity: 'warning', status: 'fail', message, location: loc });
  const fail = (id: string, check: string, message: string, loc?: string): void => checks.push({ id, check, severity: 'error', status: 'fail', message, location: loc });

  const seen: Record<string, number> = {};
  pages.forEach((p: any) => { seen[p.slug] = (seen[p.slug] || 0) + 1; });
  Object.entries(seen).forEach(([slug, c]) => c > 1 ? fail('dup_slug', 'Duplicate slugs', `Slug "${slug}" appears ${c} times`, slug) : ok('dup_slug', 'Unique slugs', `Slug "${slug}" is unique`, slug));

  const seenT: Record<string, number> = {};
  pages.forEach((p: any) => { if (p.title) seenT[p.title] = (seenT[p.title] || 0) + 1; });
  Object.entries(seenT).forEach(([t, c]) => { if (c > 1) fail('dup_title', 'Duplicate titles', `"${t}" used ${c} times`, t); });

  let linkBroken = false;
  pages.forEach((p: any) => {
    const links: string[] = [];
    const seo = p.seo || {};
    if (Array.isArray(seo.internal_links)) links.push(...seo.internal_links);
    (componentsByPage[p.slug] || []).forEach((c: any) => { const il = c.properties && c.properties.internal_links; if (Array.isArray(il)) links.push(...il); });
    links.forEach((l: string) => {
      const target = (l || '').startsWith('/') ? l.slice(1) : l;
      if (target && !/^https?:/i.test(l) && !slugSet.has(target)) { fail('broken_link', 'Broken internal links', `Page "${p.slug}" links to missing "${l}"`, p.slug); linkBroken = true; }
    });
  });
  if (!linkBroken) ok('broken_link', 'Internal links', 'All internal link targets resolve', 'sitemap');

  pages.forEach((p: any) => {
    const comps = componentsByPage[p.slug] || [];
    const hasCta = !!p.primary_cta || comps.some((c: any) => c.properties && c.properties.cta_text);
    hasCta ? ok('cta', 'Page CTA', `Page "${p.slug}" has a CTA`, p.slug) : warn('cta', 'Missing CTA', `Page "${p.slug}" has no CTA`, p.slug);
    const seo = p.seo || {};
    (!seo.seo_title || !seo.meta_description) ? fail('seo', 'Missing SEO', `Page "${p.slug}" missing SEO title/description`, p.slug) : ok('seo', 'SEO metadata', `Page "${p.slug}" has meta`, p.slug);
    const n = comps.length;
    n === 0 ? fail('components', 'Missing components', `Page "${p.slug}" has no components`, p.slug) : ok('components', 'Components', `Page "${p.slug}" has ${n} components`, p.slug);
  });

  (architecture.navigation || []).forEach((n: any) => {
    const t = (n.url || '').replace(/^\//, '');
    if (t && !slugSet.has(t)) warn('nav', 'Navigation target', `Nav "${n.label}" → ${n.url} not in sitemap`, n.url);
  });

  (architecture.responsive_rules && architecture.responsive_rules.length) ? ok('responsive', 'Responsive rules', `${architecture.responsive_rules.length} responsive rules`, 'architecture') : warn('responsive', 'Responsive rules', 'No responsive rules defined', 'architecture');
  (architecture.accessibility_rules && architecture.accessibility_rules.length) ? ok('a11y', 'Accessibility rules', `${architecture.accessibility_rules.length} a11y rules`, 'architecture') : warn('a11y', 'Accessibility rules', 'No accessibility rules defined', 'architecture');

  const errors = checks.filter((c: any) => c.severity === 'error').length;
  const warnings = checks.filter((c: any) => c.severity === 'warning').length;
  const passed = checks.filter((c: any) => c.severity === 'info').length;
  const status = errors > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass';
  return { status, checks, summary: { errors, warnings, passed, total: checks.length, page_count: pages.length, component_count: Object.values(componentsByPage).reduce((a: number, c: any[]) => a + c.length, 0) } };
}